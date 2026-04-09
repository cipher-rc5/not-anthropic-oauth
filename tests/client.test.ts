// file: tests/client.test.ts
// description: Tests for the authenticated fetch client — header injection,
//              body transformation, OAuth URL mutation, token refresh, and
//              the concurrent refresh mutex.
// reference: src/client.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { authenticatedFetch } from '../src/client.ts';
import { InvalidCredentialsError } from '../src/errors.ts';
import { saveCredentials } from '../src/store.ts';
import type { Credentials } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Shared setup — isolated HOME so tests don't touch the real credential file
// ---------------------------------------------------------------------------

const TMP_HOME = `/tmp/anthropic-oauth-client-test-${process.pid}`;
const FUTURE_EXPIRY = Date.now() + 60 * 60 * 1000; // 1 hour from now

type FetchFn = typeof globalThis.fetch;

let originalFetch: FetchFn;

const makeOk = (body: unknown = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  process.env['HOME'] = TMP_HOME;
  await Bun.$`mkdir -p ${TMP_HOME}/.config/anthropic-oauth`.quiet();
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Bun.$`rm -rf ${TMP_HOME}`.quiet();
});

// ---------------------------------------------------------------------------
// No credentials
// ---------------------------------------------------------------------------

describe('authenticatedFetch — no credentials', () => {
  test('fails with InvalidCredentialsError when no credentials are stored', async () => {
    const result = await Effect.runPromise(
      authenticatedFetch('https://api.anthropic.com/v1/messages').pipe(Effect.either)
    );
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(InvalidCredentialsError);
    }
  });
});

// ---------------------------------------------------------------------------
// API key credential path
// ---------------------------------------------------------------------------

describe('authenticatedFetch — API key credentials', () => {
  const apiKeyCred: Credentials = { type: 'api_key', key: 'sk-ant-test-key' };

  beforeEach(() => Effect.runPromise(saveCredentials(apiKeyCred)));

  test('sets x-api-key header', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(capturedHeaders!.get('x-api-key')).toBe('sk-ant-test-key');
    expect(capturedHeaders!.get('authorization')).toBeNull();
  });

  test('sets anthropic-version header', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(capturedHeaders!.get('anthropic-version')).toBe('2023-06-01');
  });

  test('merges required anthropic-beta headers', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    const betas = capturedHeaders!.get('anthropic-beta')!.split(',');
    expect(betas).toContain('oauth-2025-04-20');
    expect(betas).toContain('interleaved-thinking-2025-05-14');
  });

  test('does NOT add ?beta=true for API key path', async () => {
    let capturedUrl: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      capturedUrl = input.toString();
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(capturedUrl!).not.toContain('beta=true');
  });

  test('does NOT transform the body for API key path', async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      return makeOk();
    }) as FetchFn;

    const originalBody = JSON.stringify({ tools: [{ name: 'read_file' }] });
    await Effect.runPromise(
      authenticatedFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: originalBody })
    );
    // Tool names must NOT be prefixed for API key mode
    expect(capturedBody!).toBe(originalBody);
  });
});

// ---------------------------------------------------------------------------
// OAuth credential path
// ---------------------------------------------------------------------------

describe('authenticatedFetch — OAuth credentials', () => {
  const oauthCred: Credentials = { type: 'oauth', access: 'acc-token', refresh: 'ref-token', expires: FUTURE_EXPIRY };

  beforeEach(() => Effect.runPromise(saveCredentials(oauthCred)));

  test('sets Authorization: Bearer header', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(capturedHeaders!.get('authorization')).toBe('Bearer acc-token');
    expect(capturedHeaders!.get('x-api-key')).toBeNull();
  });

  test('appends ?beta=true to /v1/messages URL', async () => {
    let capturedUrl: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, _?: RequestInit): Promise<Response> => {
      capturedUrl = input instanceof URL ? input.toString() : String(input);
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(capturedUrl!).toContain('beta=true');
  });

  test('does NOT duplicate ?beta=true if already present', async () => {
    let capturedUrl: string | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, _?: RequestInit): Promise<Response> => {
      capturedUrl = input instanceof URL ? input.toString() : String(input);
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages?beta=true'));
    const params = new URL(capturedUrl!).searchParams.getAll('beta');
    expect(params.length).toBe(1);
  });

  test('prefixes tool names with mcp_ in request body', async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(
      authenticatedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: [{ name: 'read_file', description: 'reads a file' }] })
      })
    );

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.tools[0].name).toBe('mcp_read_file');
  });

  test('prefixes tool_use block names with mcp_ in messages', async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      return makeOk();
    }) as FetchFn;

    const body = JSON.stringify({
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'bash', id: '123', input: {} }] }]
    });

    await Effect.runPromise(
      authenticatedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })
    );

    const parsed = JSON.parse(capturedBody!);
    expect(parsed.messages[0].content[0].name).toBe('mcp_bash');
  });

  test('sanitizes OpenCode string from system prompt', async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = typeof init?.body === 'string' ? init.body : null;
      return makeOk();
    }) as FetchFn;

    const body = JSON.stringify({
      system: [{ type: 'text', text: 'You are running inside OpenCode editor by opencode team.' }]
    });

    await Effect.runPromise(
      authenticatedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })
    );

    const parsed = JSON.parse(capturedBody!);
    const systemText: string = parsed.system[0].text;
    expect(systemText).not.toContain('OpenCode');
    expect(systemText).not.toContain('opencode');
  });

  test('passes through non-JSON body unchanged', async () => {
    let capturedBody: unknown = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body;
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(
      authenticatedFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: 'plain text body' })
    );
    expect(capturedBody).toBe('plain text body');
  });
});

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

describe('authenticatedFetch — token refresh', () => {
  test('refreshes an expired token before making the request', async () => {
    const expiredCred: Credentials = {
      type: 'oauth',
      access: 'expired-acc',
      refresh: 'valid-ref',
      expires: Date.now() - 1000 // already expired
    };
    await Effect.runPromise(saveCredentials(expiredCred));

    let requestCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requestCount++;
      const url = input instanceof URL ? input.toString() : String(input);

      if (url.includes('oauth/token')) {
        // Token refresh call
        return new Response(JSON.stringify({ access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Actual API call — verify new token is used
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer new-acc');
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(requestCount).toBe(2); // 1 refresh + 1 API call
  });

  test('does not refresh a valid token', async () => {
    const validCred: Credentials = { type: 'oauth', access: 'valid-acc', refresh: 'ref', expires: FUTURE_EXPIRY };
    await Effect.runPromise(saveCredentials(validCred));

    let tokenRefreshCalled = false;
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes('oauth/token')) tokenRefreshCalled = true;
      return makeOk();
    }) as FetchFn;

    await Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'));
    expect(tokenRefreshCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Concurrent refresh mutex
// ---------------------------------------------------------------------------

describe('authenticatedFetch — concurrent refresh mutex', () => {
  test('two concurrent calls with expired token only trigger one refresh', async () => {
    const expiredCred: Credentials = {
      type: 'oauth',
      access: 'expired-acc',
      refresh: 'valid-ref',
      expires: Date.now() - 1000
    };
    await Effect.runPromise(saveCredentials(expiredCred));

    let refreshCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes('oauth/token')) {
        refreshCount++;
        // Simulate a slow refresh
        await new Promise(r => setTimeout(r, 20));
        return new Response(JSON.stringify({ access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return makeOk();
    }) as FetchFn;

    // Fire two concurrent authenticated fetches
    await Promise.all([
      Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages')),
      Effect.runPromise(authenticatedFetch('https://api.anthropic.com/v1/messages'))
    ]);

    // Only one of the two should have initiated a refresh
    expect(refreshCount).toBeLessThanOrEqual(1);
  });
});
