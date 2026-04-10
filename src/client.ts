// file: src/client.ts
// description: Authenticated HTTP client that injects OAuth bearer tokens or API keys,
//              merges beta headers, transparently refreshes expired tokens, and applies
//              request body transformations required by Anthropic's OAuth endpoints.
//              Uses a module-level refresh mutex to prevent concurrent token refresh races.
// reference: plugin source - auth.loader fetch interceptor

import { Effect, Option } from 'effect';
import { InvalidCredentialsError, StorageError, TokenRefreshError } from './errors.ts';
import { loadCredentials, saveCredentials } from './store.ts';
import { refreshAccessToken } from './token.ts';
import type { Credentials, OAuthCredentials } from './types.ts';
import { INTERLEAVED_THINKING_BETA, REQUIRED_BETAS } from './types.ts';

// Anthropic's OAuth endpoints require claude-cli user-agent to avoid 429 rate limiting
// Reference: https://github.com/anomalyco/opencode/issues/18329
const DEFAULT_USER_AGENT = 'claude-cli/2.1.2';

const getUserAgent = (): string => process.env['ANTHROPIC_USER_AGENT'] ?? DEFAULT_USER_AGENT;

const mergeBetaHeaders = (existing: string | null, enableInterleavedThinking: boolean): string => {
  const incoming = existing ? existing.split(',').map(b => b.trim()).filter(Boolean) : [];
  const base = enableInterleavedThinking
    ? [...REQUIRED_BETAS, INTERLEAVED_THINKING_BETA]
    : [...REQUIRED_BETAS];
  return [...new Set([...base, ...incoming])].join(',');
};

const buildHeaders = (source: HeadersInit | undefined, credentials: Credentials, enableInterleavedThinking: boolean): Headers => {
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

  // Set authentication header based on credential type
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

type ContentBlock = TextBlock | ToolUseBlock | Record<string, unknown>;

interface MessageBody {
  system?: ContentBlock[];
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

const TOOL_PREFIX = 'mcp_';

/**
 * Returns true if the parsed request body contains a `thinking` configuration
 * block, indicating the caller has explicitly opted into extended thinking.
 * Used to auto-enable the interleaved-thinking beta header.
 */
const bodyRequestsThinking = (parsed: MessageBody): boolean => {
  const thinking = parsed['thinking'];
  return (
    isObject(thinking) &&
    (thinking as Record<string, unknown>)['type'] === 'enabled'
  );
};

const transformBody = (raw: string): { body: string; hasThinking: boolean } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: raw, hasThinking: false };
  }

  if (!isMessageBody(parsed)) return { body: raw, hasThinking: false };

  // Short-circuit: skip transform if none of the affected keys are present
  const hasSystem = 'system' in parsed;
  const hasTools = 'tools' in parsed;
  const hasMessages = 'messages' in parsed;
  const hasThinking = bodyRequestsThinking(parsed);

  if (!hasSystem && !hasTools && !hasMessages) {
    return { body: raw, hasThinking };
  }

  // Sanitize system prompt — server blocks "OpenCode" string
  if (hasSystem && isContentBlockArray(parsed['system'])) {
    parsed['system'] = parsed['system'].map(item =>
      isTextBlock(item) ?
        { ...item, text: item.text.replace(/OpenCode/g, 'Claude Code').replace(/opencode/gi, 'Claude') } :
        item
    );
  }

  // Prefix tool definitions with mcp_ (idempotent — skip if already prefixed)
  if (hasTools && Array.isArray(parsed['tools'])) {
    parsed['tools'] = (parsed['tools'] as Array<{ name?: string } & Record<string, unknown>>).map(tool =>
      typeof tool['name'] === 'string' && !tool['name'].startsWith(TOOL_PREFIX)
        ? { ...tool, name: `${TOOL_PREFIX}${tool['name']}` }
        : tool
    );
  }

  // Prefix tool_use content blocks with mcp_ (idempotent)
  if (hasMessages && Array.isArray(parsed['messages'])) {
    parsed['messages'] = (parsed['messages'] as Array<Record<string, unknown>>).map(msg => {
      if (!isContentBlockArray(msg['content'])) return msg;
      const transformedContent: ContentBlock[] = msg['content'].map(block =>
        isToolUseBlock(block) && !block['name'].startsWith(TOOL_PREFIX)
          ? { ...block, name: `${TOOL_PREFIX}${block['name']}` }
          : block
      );
      return { ...msg, content: transformedContent };
    });
  }

  return { body: JSON.stringify(parsed), hasThinking };
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

    let resolve: (v: OAuthCredentials) => void;
    let reject: (e: unknown) => void;
    refreshInFlight = new Promise<OAuthCredentials>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    try {
      const refreshed = yield* refreshAccessToken(credentials.refresh);
      yield* saveCredentials(refreshed);
      resolve!(refreshed);
      return refreshed;
    } catch (e) {
      reject!(e);
      throw e;
    } finally {
      refreshInFlight = null;
    }
  });

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

    let requestInput = input;
    if (finalCredentials.type === 'oauth') {
      try {
        const rawUrl = typeof input === 'string' || input instanceof URL ? input.toString() : (input as Request).url;
        const url = new URL(rawUrl);
        if (url.pathname === '/v1/messages' && !url.searchParams.has('beta')) {
          url.searchParams.set('beta', 'true');
          requestInput = input instanceof Request ? new Request(url.toString(), input) : url;
        }
      } catch {
        // non-parseable URL — pass through unchanged
      }
    }

    return yield* Effect.tryPromise({
      try: () => fetch(requestInput, { ...fetchInit, ...(body !== undefined ? { body } : {}), headers }),
      catch: cause => new InvalidCredentialsError({ message: String(cause) })
    });
  });
