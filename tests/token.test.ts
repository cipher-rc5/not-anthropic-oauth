// file: tests/token.test.ts
// description: Tests for token exchange, refresh, and API key creation with
//              mocked fetch — verifies retry logic, typed response guards, and error paths.
// reference: src/token.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { ApiKeyCreationError, TokenExchangeError, TokenRefreshError } from '../src/errors.ts';
import { createApiKey, exchangeCode, refreshAccessToken } from '../src/token.ts';

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;

// Cast is required: Bun's FetchFn includes a `preconnect` property that plain
// async functions don't carry. The cast is safe here because tests only use
// the call signature and never invoke preconnect.
const makeMockFetch = (responses: Array<Response | Error>): FetchFn => {
  let call = 0;
  return (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const item = responses[call++];
    if (!item) throw new Error('Unexpected extra fetch call');
    if (item instanceof Error) throw item;
    return item;
  }) as FetchFn;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const textResponse = (body: string, status: number): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

let originalFetch: FetchFn;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// exchangeCode
// ---------------------------------------------------------------------------

describe('exchangeCode', () => {
  const VALID_RESPONSE = { access_token: 'acc-token', refresh_token: 'ref-token', expires_in: 14400 };

  test('returns OAuthCredentials on success', async () => {
    globalThis.fetch = makeMockFetch([jsonResponse(VALID_RESPONSE)]);

    const before = Date.now();
    const creds = await Effect.runPromise(exchangeCode('mycode', 'myverifier'));
    const after = Date.now();

    expect(creds.type).toBe('oauth');
    expect(creds.access).toBe('acc-token');
    expect(creds.refresh).toBe('ref-token');
    expect(creds.expires).toBeGreaterThanOrEqual(before + 14400 * 1000);
    expect(creds.expires).toBeLessThanOrEqual(after + 14400 * 1000);
  });

  test('strips the state fragment from code before sending', async () => {
    let sentBody: string | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      sentBody = typeof init?.body === 'string' ? init.body : null;
      return jsonResponse(VALID_RESPONSE);
    }) as FetchFn;

    await Effect.runPromise(exchangeCode('cleancode#stateval', 'ver'));
    expect(sentBody).not.toBeNull();
    const params = new URLSearchParams(sentBody!);
    expect(params.get('code')).toBe('cleancode');
    expect(params.get('state')).toBe('stateval');
  });

  test('fails with TokenExchangeError on 4xx', async () => {
    globalThis.fetch = makeMockFetch([textResponse('invalid_grant', 400)]);

    const result = await Effect.runPromise(exchangeCode('bad', 'ver').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TokenExchangeError);
      expect((result.left as TokenExchangeError).status).toBe(400);
    }
  });

  test('fails with TokenExchangeError when response shape is wrong', async () => {
    globalThis.fetch = makeMockFetch([jsonResponse({ wrong: 'shape' })]);

    const result = await Effect.runPromise(exchangeCode('code', 'ver').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TokenExchangeError);
    }
  });

  test('retries on 5xx and succeeds on subsequent attempt', async () => {
    let callCount = 0;
    globalThis.fetch = (async (): Promise<Response> => {
      callCount++;
      if (callCount < 2) return textResponse('server error', 500);
      return jsonResponse(VALID_RESPONSE);
    }) as unknown as FetchFn;

    const creds = await Effect.runPromise(exchangeCode('code', 'ver'));
    expect(creds.access).toBe('acc-token');
    expect(callCount).toBe(2);
  });

  test('fails with TokenExchangeError after exhausting retries on 5xx', async () => {
    globalThis.fetch = (async (): Promise<Response> => textResponse('server error', 500)) as unknown as FetchFn;

    const result = await Effect.runPromise(exchangeCode('code', 'ver').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TokenExchangeError);
    }
  });

  test('fails with TokenExchangeError on network failure', async () => {
    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error('Network unreachable');
    }) as unknown as FetchFn;

    const result = await Effect.runPromise(exchangeCode('code', 'ver').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TokenExchangeError);
      expect((result.left as TokenExchangeError).status).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// refreshAccessToken
// ---------------------------------------------------------------------------

describe('refreshAccessToken', () => {
  const VALID_RESPONSE = { access_token: 'new-acc', refresh_token: 'new-ref', expires_in: 3600 };

  test('returns refreshed OAuthCredentials on success', async () => {
    globalThis.fetch = makeMockFetch([jsonResponse(VALID_RESPONSE)]);

    const creds = await Effect.runPromise(refreshAccessToken('old-refresh'));
    expect(creds.type).toBe('oauth');
    expect(creds.access).toBe('new-acc');
    expect(creds.refresh).toBe('new-ref');
  });

  test('sends grant_type=refresh_token in body', async () => {
    let sentBody: string | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      sentBody = typeof init?.body === 'string' ? init.body : null;
      return jsonResponse(VALID_RESPONSE);
    }) as FetchFn;

    await Effect.runPromise(refreshAccessToken('tok'));
    const params = new URLSearchParams(sentBody!);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('tok');
  });

  test('fails with TokenRefreshError on 401', async () => {
    globalThis.fetch = makeMockFetch([textResponse('token_expired', 401)]);

    const result = await Effect.runPromise(refreshAccessToken('old').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TokenRefreshError);
      expect((result.left as TokenRefreshError).status).toBe(401);
    }
  });

  test('fails with TokenRefreshError when response shape is wrong', async () => {
    globalThis.fetch = makeMockFetch([jsonResponse({ access_token: 'x' })]);

    const result = await Effect.runPromise(refreshAccessToken('tok').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(TokenRefreshError);
    }
  });

  test('retries once on 500 and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async (): Promise<Response> => {
      calls++;
      return calls === 1 ? textResponse('error', 500) : jsonResponse(VALID_RESPONSE);
    }) as unknown as FetchFn;

    const creds = await Effect.runPromise(refreshAccessToken('tok'));
    expect(creds.access).toBe('new-acc');
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// createApiKey
// ---------------------------------------------------------------------------

describe('createApiKey', () => {
  test('returns ApiKeyCredentials on success', async () => {
    globalThis.fetch = makeMockFetch([jsonResponse({ raw_key: 'sk-ant-created' })]);

    const creds = await Effect.runPromise(createApiKey('bearer-token'));
    expect(creds.type).toBe('api_key');
    expect(creds.key).toBe('sk-ant-created');
  });

  test('sends Authorization Bearer header', async () => {
    let authHeader: string | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      authHeader = headers.get('authorization');
      return new Response(JSON.stringify({ raw_key: 'sk-ant-x' }), { status: 200 });
    }) as FetchFn;

    await Effect.runPromise(createApiKey('my-access-token'));
    expect(authHeader!).toBe('Bearer my-access-token');
  });

  test('fails with ApiKeyCreationError on 403', async () => {
    globalThis.fetch = makeMockFetch([textResponse('forbidden', 403)]);

    const result = await Effect.runPromise(createApiKey('tok').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(ApiKeyCreationError);
      expect((result.left as ApiKeyCreationError).status).toBe(403);
    }
  });

  test('fails with ApiKeyCreationError when raw_key is missing', async () => {
    globalThis.fetch = makeMockFetch([jsonResponse({ key: 'sk-wrong-field' })]);

    const result = await Effect.runPromise(createApiKey('tok').pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(ApiKeyCreationError);
    }
  });

  test('retries on 500 and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async (): Promise<Response> => {
      calls++;
      return calls === 1 ?
        new Response('error', { status: 500 }) :
        new Response(JSON.stringify({ raw_key: 'sk-ant-retry' }), { status: 200 });
    }) as unknown as FetchFn;

    const creds = await Effect.runPromise(createApiKey('tok'));
    expect(creds.key).toBe('sk-ant-retry');
    expect(calls).toBe(2);
  });
});
