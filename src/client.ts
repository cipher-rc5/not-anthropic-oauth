// file: src/client.ts
// description: Authenticated HTTP client that injects OAuth bearer tokens or API keys,
//              merges beta headers, transparently refreshes expired tokens, transforms
//              request bodies (CCH billing header, system prompt sanitization, tool name
//              prefixing), rewrites URLs for ANTHROPIC_BASE_URL proxying, and strips
//              mcp_ tool prefixes from streaming responses.
//              Uses a module-level refresh mutex to prevent concurrent token refresh races.
// reference: plugin source - auth.loader fetch interceptor

import { Effect, Option } from 'effect';
import { buildBillingHeaderValue } from './cch.ts';
import { InvalidCredentialsError, StorageError, TokenRefreshError } from './errors.ts';
import { loadCredentials, saveCredentials } from './store.ts';
import { refreshAccessToken } from './token.ts';
import type { Credentials, OAuthCredentials } from './types.ts';
import { CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_IDENTITY, getBaseUrl, getUserAgent, INTERLEAVED_THINKING_BETA, OPENCODE_IDENTITY, PARAGRAPH_REMOVAL_ANCHORS, REQUIRED_BETAS, TEXT_REPLACEMENTS } from './types.ts';

const TOOL_PREFIX = 'mcp_';
const MESSAGES_PATH = '/v1/messages';

// ---------------------------------------------------------------------------
// Beta header merging
// ---------------------------------------------------------------------------

const mergeBetaHeaders = (existing: string | null, enableInterleavedThinking: boolean): string => {
  const incoming = existing ? existing.split(',').map(b => b.trim()).filter(Boolean) : [];
  const base = enableInterleavedThinking ? [...REQUIRED_BETAS, INTERLEAVED_THINKING_BETA] : [...REQUIRED_BETAS];
  return [...new Set([...base, ...incoming])].join(',');
};

// ---------------------------------------------------------------------------
// Auth header injection
// ---------------------------------------------------------------------------

const buildHeaders = (
  source: HeadersInit | undefined,
  credentials: Credentials,
  enableInterleavedThinking: boolean
): Headers => {
  const headers = new Headers();

  if (source instanceof Headers) {
    source.forEach((v, k) => headers.set(k, v));
  } else if (Array.isArray(source)) {
    for (const [k, v] of source) {
      if (typeof v !== 'undefined') headers.set(k, String(v));
    }
  } else if (source) {
    for (const [k, v] of Object.entries(source)) {
      if (typeof v !== 'undefined') headers.set(k, String(v));
    }
  }

  if (credentials.type === 'oauth') {
    headers.set('authorization', `Bearer ${credentials.access}`);
    headers.delete('x-api-key');
  } else {
    headers.set('x-api-key', credentials.key);
    headers.delete('authorization');
  }

  if (!headers.has('anthropic-version')) {
    headers.set('anthropic-version', '2023-06-01');
  }
  headers.set('anthropic-beta', mergeBetaHeaders(headers.get('anthropic-beta'), enableInterleavedThinking));
  headers.set('user-agent', getUserAgent());

  return headers;
};

// ---------------------------------------------------------------------------
// Typed message body shapes — eliminates `any` in the transformation pipeline
// ---------------------------------------------------------------------------

interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly name: string;
  readonly [key: string]: unknown;
}

interface SystemBlock {
  readonly type: string;
  readonly text: string;
  readonly [key: string]: unknown;
}

type ContentBlock = TextBlock | ToolUseBlock | Record<string, unknown>;

interface MessageBody {
  system?: unknown;
  tools?: Array<{ name?: string } & Record<string, unknown>>;
  messages?: Array<{ role?: string, content?: ContentBlock[], [key: string]: unknown }>;
  [key: string]: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isTextBlock = (v: unknown): v is TextBlock =>
  isObject(v) && v['type'] === 'text' && typeof v['text'] === 'string';

const isToolUseBlock = (v: unknown): v is ToolUseBlock =>
  isObject(v) && v['type'] === 'tool_use' && typeof v['name'] === 'string';

const isContentBlockArray = (v: unknown): v is ContentBlock[] => Array.isArray(v);

const isMessageBody = (v: unknown): v is MessageBody => isObject(v);

// ---------------------------------------------------------------------------
// System prompt sanitization
// ---------------------------------------------------------------------------

/**
 * Remove OpenCode branding from a system prompt text block:
 * 1. Drops the exact OPENCODE_IDENTITY line (its paragraph or the whole block).
 * 2. Removes paragraphs containing known OpenCode URL anchors.
 * 3. Applies targeted inline text replacements.
 * Returns the text unchanged when no OpenCode identity is present.
 */
const sanitizeSystemText = (text: string): string => {
  if (!text.includes(OPENCODE_IDENTITY)) return text;

  // Split into blank-line-separated paragraphs for structural removal
  const paragraphs = text.split(/\n\n+/);

  const filtered = paragraphs.filter(paragraph => {
    // Remove a paragraph that is solely the identity line
    if (paragraph.trim() === OPENCODE_IDENTITY) return false;
    // Remove paragraphs that contain any known OpenCode URL anchor
    for (const anchor of PARAGRAPH_REMOVAL_ANCHORS) {
      if (paragraph.includes(anchor)) return false;
    }
    return true;
  });

  // Remove any inline occurrence that survived inside a larger paragraph
  let result = filtered.join('\n\n');
  result = result.replace(OPENCODE_IDENTITY, '').replace(/\n{3,}/g, '\n\n');

  // Targeted inline replacements
  for (const rule of TEXT_REPLACEMENTS) {
    result = result.replace(rule.match, rule.replacement);
  }

  return result.trim();
};

/**
 * Coerce an arbitrary system entry into a sanitized SystemBlock.
 */
const sanitizeBlock = (item: unknown): SystemBlock => {
  if (typeof item === 'string') {
    return { type: 'text', text: sanitizeSystemText(item) };
  }
  if (isObject(item) && item['type'] === 'text' && typeof item['text'] === 'string') {
    return { ...item, type: 'text', text: sanitizeSystemText(item['text']) } as SystemBlock;
  }
  return { type: 'text', text: String(item) };
};

/**
 * Wrap the request's system value into a block array with:
 * 1. The Claude Code identity block (with CCH billing header) as the first entry.
 * 2. All original system blocks sanitized after it.
 *
 * Idempotent: if the first block already carries the identity text it is
 * updated in-place rather than prepended again.
 */
const prependIdentityBlock = (system: unknown, billingHeader: string | null): SystemBlock[] => {
  const identityText = billingHeader ? `${billingHeader}\n\n${CLAUDE_CODE_IDENTITY}` : CLAUDE_CODE_IDENTITY;
  const identityBlock: SystemBlock = { type: 'text', text: identityText };

  if (system == null) return [identityBlock];

  if (typeof system === 'string') {
    const sanitized = sanitizeSystemText(system);
    return sanitized ? [identityBlock, { type: 'text', text: sanitized }] : [identityBlock];
  }

  if (!Array.isArray(system)) {
    // Single block object
    if (isObject(system)) {
      const text = typeof system['text'] === 'string' ? sanitizeSystemText(system['text']) : '';
      return text ? [identityBlock, { ...system, type: 'text', text } as SystemBlock] : [identityBlock];
    }
    return [identityBlock];
  }

  const blocks = system as unknown[];

  // Idempotency check — update existing identity block rather than double-prepend
  const firstBlock = blocks[0];
  if (isObject(firstBlock) && typeof firstBlock['text'] === 'string') {
    const existingText: string = firstBlock['text'];
    if (existingText === CLAUDE_CODE_IDENTITY || existingText.endsWith(CLAUDE_CODE_IDENTITY)) {
      return [{ ...firstBlock, text: identityText } as SystemBlock, ...blocks.slice(1).map(sanitizeBlock)];
    }
  }

  return [identityBlock, ...blocks.map(sanitizeBlock)];
};

// ---------------------------------------------------------------------------
// Thinking detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the request body explicitly opts into extended thinking
 * via a `thinking: { type: "enabled" }` block.
 */
const bodyRequestsThinking = (parsed: MessageBody): boolean => {
  const thinking = parsed['thinking'];
  return isObject(thinking) && thinking['type'] === 'enabled';
};

// ---------------------------------------------------------------------------
// Request body transformation
// ---------------------------------------------------------------------------

const transformBody = (raw: string): { body: string, hasThinking: boolean } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: raw, hasThinking: false };
  }

  if (!isMessageBody(parsed)) return { body: raw, hasThinking: false };

  const hasThinking = bodyRequestsThinking(parsed);

  // CCH billing header — requires at least one user turn in messages
  const rawMessages = parsed['messages'];
  const billingHeader =
    Array.isArray(rawMessages) && (rawMessages as Array<{ role?: unknown }>).some(m => m.role === 'user') ?
      buildBillingHeaderValue(
        rawMessages as Array<{ role?: string, content?: unknown }>,
        undefined,
        CLAUDE_CODE_ENTRYPOINT
      ) :
      null;

  // Sanitize system prompt and prepend the Claude Code identity block
  parsed['system'] = prependIdentityBlock(parsed['system'], billingHeader);

  // Prefix tool definitions with mcp_ (idempotent — skips if already prefixed)
  if (Array.isArray(parsed['tools'])) {
    parsed['tools'] = (parsed['tools'] as Array<{ name?: string } & Record<string, unknown>>).map(tool =>
      typeof tool['name'] === 'string' && !tool['name'].startsWith(TOOL_PREFIX) ?
        { ...tool, name: `${TOOL_PREFIX}${tool['name']}` } :
        tool
    );
  }

  // Prefix tool_use content blocks with mcp_ (idempotent)
  if (Array.isArray(parsed['messages'])) {
    parsed['messages'] = (parsed['messages'] as Array<Record<string, unknown>>).map(msg => {
      if (!isContentBlockArray(msg['content'])) return msg;
      return {
        ...msg,
        content: msg['content'].map(block =>
          isToolUseBlock(block) && !block['name'].startsWith(TOOL_PREFIX) ?
            { ...block, name: `${TOOL_PREFIX}${block['name']}` } :
            block
        )
      };
    });
  }

  return { body: JSON.stringify(parsed), hasThinking };
};

// ---------------------------------------------------------------------------
// Streaming response — strip mcp_ prefix from tool names
// ---------------------------------------------------------------------------

/**
 * Wrap a Response so that `mcp_` prefixes are stripped from tool name fields
 * as the body streams through. Safe to call on non-streaming responses too.
 */
export const createStrippedStream = (response: Response): Response => {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      const text = decoder.decode(value, { stream: true }).replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"');
      controller.enqueue(encoder.encode(text));
    }
  });

  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
};

// ---------------------------------------------------------------------------
// Token refresh mutex — prevents concurrent refreshes from racing
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<OAuthCredentials> | null = null;

const ensureFreshToken = (
  credentials: OAuthCredentials
): Effect.Effect<OAuthCredentials, TokenRefreshError | StorageError> =>
  Effect.gen(function*() {
    if (credentials.access && credentials.expires > Date.now()) {
      return credentials;
    }

    // If a refresh is already in-flight, wait for it instead of starting another.
    // This prevents concurrent requests from each triggering a separate refresh
    // and potentially invalidating each other's refresh tokens.
    if (refreshInFlight !== null) {
      const result = yield* Effect.tryPromise({
        try: () => refreshInFlight as Promise<OAuthCredentials>,
        catch: cause => new TokenRefreshError({ status: 0, body: String(cause) })
      });
      return result;
    }

    let resolve!: (v: OAuthCredentials) => void;
    let reject!: (e: unknown) => void;
    refreshInFlight = new Promise<OAuthCredentials>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    try {
      const refreshed = yield* refreshAccessToken(credentials.refresh);
      yield* saveCredentials(refreshed);
      resolve(refreshed);
      return refreshed;
    } catch (e) {
      reject(e);
      throw e;
    } finally {
      refreshInFlight = null;
    }
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuthenticatedFetchOptions extends RequestInit {
  /**
   * Opt into Claude's extended thinking (interleaved-thinking) feature.
   * When true, the `interleaved-thinking-2025-05-14` beta header is added.
   * This is also auto-enabled when the request body contains a `thinking`
   * block with `type: "enabled"`.
   * Reference: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
   */
  enableInterleavedThinking?: boolean;
}

export const authenticatedFetch = (
  input: RequestInfo | URL,
  init?: AuthenticatedFetchOptions
): Effect.Effect<Response, InvalidCredentialsError | TokenRefreshError | StorageError> =>
  Effect.gen(function*() {
    const stored = yield* loadCredentials;
    const credentials = Option.getOrNull(stored);

    if (!credentials) {
      return yield* Effect.fail(
        new InvalidCredentialsError({ message: 'No credentials found. Run the login flow first.' })
      );
    }

    // Refresh OAuth tokens if needed
    let finalCredentials: Credentials = credentials;
    if (credentials.type === 'oauth') {
      finalCredentials = yield* ensureFreshToken(credentials);
    }

    const requestInit = init ?? {};
    const { enableInterleavedThinking: explicitThinking, ...fetchInit } = requestInit;

    // Transform request body for OAuth compatibility; detect thinking opt-in
    let body = fetchInit.body;
    let bodyRequestedThinking = false;
    if (credentials.type === 'oauth' && body && typeof body === 'string') {
      const result = transformBody(body);
      body = result.body;
      bodyRequestedThinking = result.hasThinking;
    }

    const useThinking = explicitThinking === true || bodyRequestedThinking;
    const headers = buildHeaders(fetchInit.headers, finalCredentials, useThinking);

    // Rewrite URL: override origin when ANTHROPIC_BASE_URL is set, then
    // append ?beta=true for OAuth /v1/messages requests.
    let requestInput: RequestInfo | URL = input;
    if (finalCredentials.type === 'oauth') {
      try {
        const rawUrl = typeof input === 'string' || input instanceof URL ? input.toString() : (input as Request).url;
        const url = new URL(rawUrl);

        const baseUrl = getBaseUrl();
        if (baseUrl) {
          url.protocol = baseUrl.protocol;
          url.host = baseUrl.host;
        }

        if (url.pathname === MESSAGES_PATH && !url.searchParams.has('beta')) {
          url.searchParams.set('beta', 'true');
        }

        requestInput = input instanceof Request ? new Request(url.toString(), input) : url;
      } catch {
        // Non-parseable URL — pass through unchanged
      }
    }

    const response = yield* Effect.tryPromise({
      try: () => fetch(requestInput, { ...fetchInit, ...(body !== undefined ? { body } : {}), headers }),
      catch: cause => new InvalidCredentialsError({ message: String(cause) })
    });

    // Strip mcp_ tool name prefixes from streaming responses (OAuth only)
    return finalCredentials.type === 'oauth' ? createStrippedStream(response) : response;
  });
