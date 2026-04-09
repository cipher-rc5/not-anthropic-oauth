// file: src/plugin.ts
// description: OpenCode-compatible fetch plugin that patches global fetch with user-agent.
//              Uses a WeakRef-keyed symbol on globalThis to avoid module-state issues
//              across test resets and multi-load edge cases.
// reference: https://opencode.ai/docs/plugins

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15';

const ANTHROPIC_HOSTS = new Set(['api.anthropic.com', 'console.anthropic.com', 'claude.ai']);

// Use a Symbol stored on globalThis rather than a module-level boolean so that
// the patch is idempotent even when the module is loaded multiple times or
// when test harnesses re-import it.
const PATCH_SENTINEL = Symbol.for('anthropic-oauth.fetchPatched');

function getUserAgent(): string {
  return process.env['OPENCODE_ANTHROPIC_USER_AGENT'] ?? DEFAULT_USER_AGENT;
}

function resolveUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string' || input instanceof URL) {
      return new URL(input.toString());
    }
    if (input instanceof Request) {
      return new URL(input.url);
    }
  } catch {
    // Invalid URL — treated as non-Anthropic
  }
  return null;
}

function buildHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers();

  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  if (init?.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  } else if (Array.isArray(init?.headers)) {
    for (const [key, value] of init.headers) {
      if (typeof value !== 'undefined') headers.set(key, String(value));
    }
  } else if (init?.headers) {
    for (const [key, value] of Object.entries(init.headers)) {
      if (typeof value !== 'undefined') headers.set(key, String(value));
    }
  }

  return headers;
}

function isPatched(g: typeof globalThis): boolean {
  return (g as Record<symbol, unknown>)[PATCH_SENTINEL] === true;
}

function markPatched(g: typeof globalThis): void {
  (g as Record<symbol, unknown>)[PATCH_SENTINEL] = true;
}

type FetchFn = typeof globalThis.fetch;

function patchFetch(): void {
  if (isPatched(globalThis)) return;
  markPatched(globalThis);

  const originalFetch: FetchFn = globalThis.fetch.bind(globalThis);

  const patchedFetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = resolveUrl(input);
    if (!url || !ANTHROPIC_HOSTS.has(url.hostname)) {
      return originalFetch(input, init);
    }

    const headers = buildHeaders(input, init);
    headers.set('user-agent', getUserAgent());

    return originalFetch(input, { ...(init ?? {}), headers });
  };

  // Bun's `typeof fetch` is a merged function + namespace (for `fetch.preconnect`).
  // Carry the preconnect property forward so the assignment satisfies Bun's types.
  Object.assign(patchedFetch, { preconnect: originalFetch.preconnect });
  globalThis.fetch = patchedFetch as unknown as typeof globalThis.fetch;
}

/**
 * Portable OpenCode plugin that injects a configurable User-Agent into fetch
 * requests targeting Anthropic endpoints.
 *
 * Default:
 *   Uses the built-in Safari/macOS user-agent.
 *
 * Override:
 *   OPENCODE_ANTHROPIC_USER_AGENT='your user agent'
 *
 * Usage:
 *   import { AnthropicUserAgentPlugin } from 'anthropic-oauth/plugin';
 *   await AnthropicUserAgentPlugin();
 */
export const AnthropicUserAgentPlugin = async (): Promise<Record<string, never>> => {
  patchFetch();
  return {};
};

export default AnthropicUserAgentPlugin;
