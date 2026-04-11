// file: src/utils.ts
// description: Shared utilities used by both client.ts and plugin.ts —
//              header merging, OAuth URL rewriting, and streaming response
//              transformation. Extracted here to avoid cross-module peer
//              dependencies and duplicate code.

import { getBaseUrl, MESSAGES_PATH } from './types.ts';

// ---------------------------------------------------------------------------
// Header merging
// ---------------------------------------------------------------------------

/**
 * Merge headers from a `HeadersInit` source (or a Request object) into a
 * new `Headers` instance. Handles all three `HeadersInit` shapes:
 *   - `Headers` instance
 *   - `[string, string][]` array
 *   - `Record<string, string>` plain object
 *
 * When `request` is provided its headers are merged first, then `init`
 * headers override them (matching standard fetch semantics).
 */
export const mergeHeadersFromInit = (init?: RequestInit, request?: Request): Headers => {
  const headers = new Headers();

  // Copy headers from the Request object first (lowest priority)
  if (request) {
    request.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  // Then apply init.headers (higher priority, may override Request headers)
  const source = init?.headers;
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

  return headers;
};

// ---------------------------------------------------------------------------
// OAuth URL rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrite a URL for OAuth routing:
 * 1. Override origin from `ANTHROPIC_BASE_URL` env var when set (proxy support).
 * 2. Append `?beta=true` to `/v1/messages` requests for Pro/Max quota routing.
 *
 * Returns `null` when the URL cannot be parsed (caller should pass through unchanged).
 */
export const rewriteOAuthUrl = (rawUrl: string): URL | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const baseUrl = getBaseUrl();
  if (baseUrl) {
    url.protocol = baseUrl.protocol;
    url.host = baseUrl.host;
  }

  if (url.pathname === MESSAGES_PATH && !url.searchParams.has('beta')) {
    url.searchParams.set('beta', 'true');
  }

  return url;
};

// ---------------------------------------------------------------------------
// Streaming response — strip mcp_ prefix from tool names
// ---------------------------------------------------------------------------

// The longest prefix of the pattern that could appear at the end of a chunk
// and be completed by the next chunk.  We keep this many characters of
// carry-over so the regex is never split across a chunk boundary.
// Worst case: `"name":"mcp_` = 13 chars, plus surrounding whitespace variants.
const STRIP_CARRY_LEN = 32;
const STRIP_PATTERN = /"name"\s*:\s*"mcp_([^"]+)"/g;

/**
 * Wrap a Response so that `mcp_` prefixes are stripped from tool name fields
 * as the body streams through. Safe to call on non-streaming responses too.
 *
 * A carry-over buffer of the last STRIP_CARRY_LEN chars is prepended to each
 * decoded chunk before matching, then trimmed from the output, ensuring the
 * pattern is never silently missed when a chunk boundary falls inside a field.
 */
export const createStrippedStream = (response: Response): Response => {
  if (!response.body) return response;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = '';

  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush any remaining carry — strip and emit it.
        if (carry.length > 0) {
          controller.enqueue(encoder.encode(carry.replace(STRIP_PATTERN, '"name": "$1"')));
        }
        controller.close();
        return;
      }

      // Prepend carry so the pattern can match across the previous boundary.
      const raw = carry + decoder.decode(value, { stream: true });
      const stripped = raw.replace(STRIP_PATTERN, '"name": "$1"');

      // Keep the last STRIP_CARRY_LEN chars as carry for the next chunk,
      // emit everything before that immediately.
      if (stripped.length <= STRIP_CARRY_LEN) {
        carry = stripped;
        // Nothing safe to emit yet — wait for more data.
      } else {
        const safeEnd = stripped.length - STRIP_CARRY_LEN;
        controller.enqueue(encoder.encode(stripped.slice(0, safeEnd)));
        carry = stripped.slice(safeEnd);
      }
    }
  });

  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
};
