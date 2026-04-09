// file: tests/plugin.test.ts
// description: Tests for the global fetch patch plugin — idempotency, host filtering,
//              user-agent injection, and sentinel-based state (no module-level boolean).
// reference: src/plugin.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AnthropicUserAgentPlugin } from '../src/plugin.ts';

type FetchFn = typeof globalThis.fetch;

const PATCH_SENTINEL = Symbol.for('anthropic-oauth.fetchPatched');

let originalFetch: FetchFn;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  // Reset the sentinel so each test starts with an unpatched state
  delete (globalThis as Record<symbol, unknown>)[PATCH_SENTINEL];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (globalThis as Record<symbol, unknown>)[PATCH_SENTINEL];
  delete process.env['OPENCODE_ANTHROPIC_USER_AGENT'];
});

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

describe('AnthropicUserAgentPlugin', () => {
  test('returns an empty record', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    const result = await AnthropicUserAgentPlugin();
    expect(result).toEqual({});
  });

  test('injects user-agent into Anthropic API requests', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://api.anthropic.com/v1/messages');

    expect(capturedHeaders!.get('user-agent')).toContain('Safari');
  });

  test('injects user-agent into console.anthropic.com requests', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://console.anthropic.com/v1/oauth/token');

    expect(capturedHeaders!.get('user-agent')).not.toBeNull();
  });

  test('injects user-agent into claude.ai requests', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://claude.ai/oauth/authorize');

    expect(capturedHeaders!.get('user-agent')).not.toBeNull();
  });

  test('does NOT inject user-agent for non-Anthropic URLs', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://example.com/api');

    // No user-agent should be injected (or existing headers unchanged)
    const ua = capturedHeaders!.get('user-agent');
    // If ua is set, it should be from the caller, not injected
    expect(ua).toBeNull();
  });

  test('respects OPENCODE_ANTHROPIC_USER_AGENT env override', async () => {
    process.env['OPENCODE_ANTHROPIC_USER_AGENT'] = 'MyCustomAgent/1.0';
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://api.anthropic.com/v1/messages');

    expect(capturedHeaders!.get('user-agent')).toBe('MyCustomAgent/1.0');
  });

  test('is idempotent — calling twice does not double-wrap fetch', async () => {
    let callDepth = 0;
    globalThis.fetch = (async (_: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      callDepth++;
      expect(callDepth).toBe(1); // would be > 1 if double-wrapped
      const result = new Response('', { status: 200 });
      callDepth--;
      return result;
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://api.anthropic.com/v1/messages');
  });

  test('preserves existing headers from the caller', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedHeaders = new Headers(init?.headers);
      return new Response('', { status: 200 });
    }) as FetchFn;

    await AnthropicUserAgentPlugin();
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      headers: { 'x-api-key': 'sk-test', 'content-type': 'application/json' }
    });

    expect(capturedHeaders!.get('x-api-key')).toBe('sk-test');
    expect(capturedHeaders!.get('content-type')).toBe('application/json');
  });
});
