// file: src/token.ts
// description: OAuth token exchange, refresh, and API key creation with
//              exponential backoff retry on transient failures (5xx / network errors).
// reference: https://console.anthropic.com/v1/oauth/token

import { Effect } from 'effect';
import { ApiKeyCreationError, TokenExchangeError, TokenRefreshError } from './errors.ts';
import type { ApiKeyCredentials, ApiKeyResponse, OAuthCredentials, TokenResponse } from './types.ts';
import { ANTHROPIC_OAUTH_URL, getClientId, getUserAgent, OAUTH_REDIRECT_URI } from './types.ts';

// ---------------------------------------------------------------------------
// Typed response guards — prevents unsafe `as T` casts on JSON.parse results
// ---------------------------------------------------------------------------

const isTokenResponse = (v: unknown): v is TokenResponse =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Record<string, unknown>)['access_token'] === 'string' &&
  typeof (v as Record<string, unknown>)['refresh_token'] === 'string' &&
  typeof (v as Record<string, unknown>)['expires_in'] === 'number';

const isApiKeyResponse = (v: unknown): v is ApiKeyResponse =>
  typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)['raw_key'] === 'string';

// ---------------------------------------------------------------------------
// Retry helper — exponential backoff for transient network / 5xx errors
// ---------------------------------------------------------------------------

interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  /** Per-attempt timeout in ms. Defaults to 10 000ms (10s). */
  readonly timeoutMs: number;
}

const DEFAULT_RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 250, timeoutMs: 10_000 };

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wraps a fetch call with exponential-backoff retry and a per-attempt timeout.
 * Retries on network errors (status 0), 5xx server errors, and timeouts.
 * 4xx errors are not retried (they indicate a client-side problem).
 */
const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  opts: RetryOptions = DEFAULT_RETRY
): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0;attempt < opts.maxAttempts;attempt++) {
    if (attempt > 0) {
      // 2^(attempt-1) * baseDelayMs: 250ms, 500ms, 1000ms, …
      await sleep(opts.baseDelayMs * Math.pow(2, attempt - 1));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      // Do not retry client errors (4xx) — they need a code-level fix
      if (response.status >= 400 && response.status < 500) return response;
      // Retry server errors
      if (response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return response;
    } catch (err) {
      clearTimeout(timer);
      // Network-level failure (DNS, connection refused, timeout / abort)
      lastError = err instanceof Error && err.name === 'AbortError' ?
        new Error(`Request timed out after ${opts.timeoutMs}ms`) :
        err;
    }
  }
  throw lastError;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseCode = (raw: string): Effect.Effect<{ code: string, state: string }, TokenExchangeError> => {
  const [code, state = ''] = raw.split('#');
  const clean = code ?? '';
  if (!clean) {
    return Effect.fail(
      new TokenExchangeError({ status: 0, body: 'Invalid authorization code: value must not be empty' })
    );
  }
  return Effect.succeed({ code: clean, state });
};

const toOAuthCredentials = (json: TokenResponse): OAuthCredentials => ({
  type: 'oauth',
  access: json.access_token,
  refresh: json.refresh_token,
  expires: Date.now() + json.expires_in * 1000
});

/**
 * Read the error body text from a non-ok response and produce a typed Effect failure.
 * Centralises the three-step (text → fail) pattern used in every token operation.
 */
const failWithBody = <E>(
  response: Response,
  mkError: (params: { status: number, body: string }) => E
): Effect.Effect<never, E> =>
  Effect.gen(function*() {
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => mkError({ status: response.status, body: '' })
    });
    return yield* Effect.fail(mkError({ status: response.status, body }));
  });

// Common headers for all token endpoint requests.
const tokenHeaders = (): Record<string, string> => ({
  'content-type': 'application/x-www-form-urlencoded',
  'user-agent': getUserAgent()
});

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export const exchangeCode = (code: string, verifier: string): Effect.Effect<OAuthCredentials, TokenExchangeError> =>
  Effect.gen(function*() {
    const { code: clean, state } = yield* parseCode(code);

    // Per RFC 6749 §4.1.3, OAuth token endpoints require application/x-www-form-urlencoded
    const params = new URLSearchParams({
      code: clean,
      grant_type: 'authorization_code',
      client_id: getClientId(),
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: verifier
    });
    if (state) params.set('state', state);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchWithRetry(ANTHROPIC_OAUTH_URL, { method: 'POST', headers: tokenHeaders(), body: params.toString() }),
      catch: cause => new TokenExchangeError({ status: 0, body: String(cause) })
    });

    if (!response.ok) {
      return yield* failWithBody(response, p => new TokenExchangeError(p));
    }

    const raw = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: cause => new TokenExchangeError({ status: response.status, body: String(cause) })
    });

    if (!isTokenResponse(raw)) {
      return yield* Effect.fail(
        new TokenExchangeError({ status: response.status, body: 'Unexpected token response shape' })
      );
    }

    return toOAuthCredentials(raw);
  });

export const refreshAccessToken = (refresh_token: string): Effect.Effect<OAuthCredentials, TokenRefreshError> =>
  Effect.gen(function*() {
    // Per RFC 6749 §6, token refresh also requires application/x-www-form-urlencoded
    const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: getClientId() });

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchWithRetry(ANTHROPIC_OAUTH_URL, { method: 'POST', headers: tokenHeaders(), body: params.toString() }),
      catch: cause => new TokenRefreshError({ status: 0, body: String(cause) })
    });

    if (!response.ok) {
      return yield* failWithBody(response, p => new TokenRefreshError(p));
    }

    const raw = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: cause => new TokenRefreshError({ status: response.status, body: String(cause) })
    });

    if (!isTokenResponse(raw)) {
      return yield* Effect.fail(
        new TokenRefreshError({ status: response.status, body: 'Unexpected token response shape' })
      );
    }

    return toOAuthCredentials(raw);
  });

export const createApiKey = (access_token: string): Effect.Effect<ApiKeyCredentials, ApiKeyCreationError> =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetchWithRetry('https://api.anthropic.com/api/oauth/claude_cli/create_api_key', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${access_token}`,
            'user-agent': getUserAgent()
          }
        }),
      catch: cause => new ApiKeyCreationError({ status: 0, body: String(cause) })
    });

    if (!response.ok) {
      return yield* failWithBody(response, p => new ApiKeyCreationError(p));
    }

    const raw = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: cause => new ApiKeyCreationError({ status: response.status, body: String(cause) })
    });

    if (!isApiKeyResponse(raw)) {
      return yield* Effect.fail(
        new ApiKeyCreationError({ status: response.status, body: 'Unexpected API key response shape' })
      );
    }

    return { type: 'api_key', key: raw.raw_key } as const;
  });
