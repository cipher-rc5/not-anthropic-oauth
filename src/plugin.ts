// file: src/plugin.ts
// description: OpenCode server plugin that routes Anthropic OAuth credentials through
//              the Claude Pro/Max quota endpoint instead of the standard API billing path.
//
//              The auth.loader intercepts opencode's provider resolution for the built-in
//              anthropic provider and returns SDK options that:
//                1. Pass the OAuth access token as apiKey (satisfies createAnthropic())
//                2. Inject Authorization: Bearer instead of x-api-key
//                3. Append ?beta=true to /v1/messages to route through the Pro/Max quota path
//                4. Set claude-cli/2.1.2 user-agent (required to avoid 429 rate limiting)
//
// reference: https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts
// note: opencode v1.2.27 calls the default export directly as plugin(input) — the export
//       must be the server function itself, not an object with a server property.

import { getUserAgent } from './types.ts';
import { createStrippedStream, mergeHeadersFromInit, rewriteOAuthUrl } from './utils.ts';

// ---------------------------------------------------------------------------
// Legacy fetch-patch (backwards compat — used by AnthropicUserAgentPlugin)
// ---------------------------------------------------------------------------

const WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15';

const ANTHROPIC_HOSTS = new Set(['api.anthropic.com', 'console.anthropic.com', 'claude.ai']);

const PATCH_SENTINEL = Symbol.for('anthropic-oauth.fetchPatched');

function getWebUserAgent(): string {
  return process.env['OPENCODE_ANTHROPIC_USER_AGENT'] ?? WEB_USER_AGENT;
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

    const headers = mergeHeadersFromInit(init, input instanceof Request ? input : undefined);
    headers.set('user-agent', getWebUserAgent());

    return originalFetch(input, { ...(init ?? {}), headers });
  };

  Object.assign(patchedFetch, { preconnect: originalFetch.preconnect });
  globalThis.fetch = patchedFetch as unknown as typeof globalThis.fetch;
}

/**
 * Portable OpenCode plugin that injects a configurable User-Agent into fetch
 * requests targeting Anthropic endpoints.
 *
 * @deprecated Use the default export server plugin instead for full OAuth routing.
 */
export const AnthropicUserAgentPlugin = async (): Promise<Record<string, never>> => {
  patchFetch();
  return {};
};

// ---------------------------------------------------------------------------
// OAuth fetch interceptor — returned as the SDK's custom fetch by auth.loader
// ---------------------------------------------------------------------------

function makeOAuthFetch(accessToken: string) {
  return async function oauthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let urlStr: string;
    if (typeof input === 'string') {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.toString();
    } else {
      urlStr = (input as Request).url;
    }

    const rewritten = rewriteOAuthUrl(urlStr);
    if (rewritten === null) {
      return fetch(input, init);
    }

    // Merge caller headers, then swap x-api-key → Authorization: Bearer
    const headers = mergeHeadersFromInit(init, input instanceof Request ? input : undefined);
    headers.delete('x-api-key');
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set('user-agent', getUserAgent());

    const updatedInput = input instanceof Request ? new Request(rewritten.toString(), input) : rewritten.toString();
    const response = await fetch(updatedInput, { ...(init ?? {}), headers });

    // Strip mcp_ prefixes from tool names in streaming responses
    return createStrippedStream(response);
  };
}

// ---------------------------------------------------------------------------
// OpenCode server plugin — default export
//
// opencode v1.2.27 calls the default export directly as: await plugin(input)
// The return value is the Hooks object pushed into the hooks array.
// ---------------------------------------------------------------------------

const AnthropicOAuthPlugin = async (_input: unknown) => ({
  auth: {
    provider: 'anthropic',

    // Called by opencode to resolve createAnthropic() SDK options when an
    // anthropic credential is stored in auth.json.
    // provider (second arg) is passed by newer opencode versions and exposes
    // the model registry — we zero out costs for OAuth users since usage is
    // covered by their Pro/Max subscription.
    loader: async (
      getAuth: () => Promise<{ type: string, access?: string, key?: string } | undefined>,
      provider?: { models?: Record<string, { cost: unknown }> }
    ) => {
      const auth = await getAuth();

      if (!auth) return {};

      if (auth.type === 'oauth' && auth.access) {
        // Zero out per-token costs — Pro/Max subscription covers usage
        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            model.cost = { input: 0, output: 0, cache: { read: 0, write: 0 } };
          }
        }

        return {
          // apiKey is required by createAnthropic() — our custom fetch never
          // sends it as x-api-key; it sends Authorization: Bearer instead.
          apiKey: auth.access,
          fetch: makeOAuthFetch(auth.access)
        };
      }

      if (auth.type === 'api' && auth.key) {
        return { apiKey: auth.key };
      }

      return {};
    },

    // OAuth login method exposed in opencode's provider auth UI
    methods: [{
      type: 'oauth' as const,
      label: 'Login with Claude Pro/Max',
      authorize: async () => {
        const { beginOAuth } = await import('./service.ts');
        const { Effect } = await import('effect');
        const { url, verifier } = await Effect.runPromise(beginOAuth('max'));
        return {
          url,
          method: 'code' as const,
          instructions: 'Open the URL in your browser, complete login, then paste the authorization code.',
          callback: async (code: string) => {
            const { completeOAuthLogin } = await import('./service.ts');
            try {
              const creds = await Effect.runPromise(completeOAuthLogin(code, verifier));
              if (creds.type !== 'oauth') return { type: 'failed' as const };
              return { type: 'success' as const, access: creds.access, refresh: creds.refresh, expires: creds.expires };
            } catch {
              return { type: 'failed' as const };
            }
          }
        };
      }
    }]
  }
});

export default AnthropicOAuthPlugin;
