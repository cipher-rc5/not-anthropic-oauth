// file: tests/pkce.test.ts
// description: Tests for PKCE challenge generation and authorization URL construction
// reference: src/pkce.ts

import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { buildAuthorizationUrl, buildPkceFlow, generateChallenge } from '../src/pkce.ts';

describe('generateChallenge', () => {
  test('returns an object with verifier and challenge strings', async () => {
    const pkce = await Effect.runPromise(generateChallenge);
    expect(typeof pkce.verifier).toBe('string');
    expect(typeof pkce.challenge).toBe('string');
    expect(pkce.verifier.length).toBeGreaterThan(0);
    expect(pkce.challenge.length).toBeGreaterThan(0);
  });

  test('verifier and challenge differ', async () => {
    const pkce = await Effect.runPromise(generateChallenge);
    expect(pkce.verifier).not.toBe(pkce.challenge);
  });

  test('each call returns unique values', async () => {
    const [a, b] = await Promise.all([Effect.runPromise(generateChallenge), Effect.runPromise(generateChallenge)]);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe('buildAuthorizationUrl', () => {
  const fakePkce = { verifier: 'test-verifier-abc', challenge: 'test-challenge-xyz' };

  test('builds a valid URL for max mode targeting claude.ai', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('claude.ai');
    expect(parsed.pathname).toBe('/oauth/authorize');
  });

  test('builds a valid URL for console mode targeting console.anthropic.com', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('console', fakePkce));
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('console.anthropic.com');
    expect(parsed.pathname).toBe('/oauth/authorize');
  });

  test('includes response_type=code', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    expect(new URL(url).searchParams.get('response_type')).toBe('code');
  });

  test('includes code_challenge_method=S256', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    expect(new URL(url).searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('embeds the challenge in the URL', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    expect(new URL(url).searchParams.get('code_challenge')).toBe(fakePkce.challenge);
  });

  test('embeds the verifier as state', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    expect(new URL(url).searchParams.get('state')).toBe(fakePkce.verifier);
  });

  test('includes redirect_uri', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    const redirectUri = new URL(url).searchParams.get('redirect_uri');
    expect(redirectUri).not.toBeNull();
    expect(redirectUri).toContain('anthropic.com');
  });

  test('includes scope', async () => {
    const url = await Effect.runPromise(buildAuthorizationUrl('max', fakePkce));
    const scope = new URL(url).searchParams.get('scope');
    expect(scope).not.toBeNull();
    expect(scope!.length).toBeGreaterThan(0);
  });
});

describe('buildPkceFlow', () => {
  test('returns url and verifier for max mode', async () => {
    const result = await Effect.runPromise(buildPkceFlow('max'));
    expect(typeof result.url).toBe('string');
    expect(typeof result.verifier).toBe('string');
    expect(new URL(result.url).hostname).toBe('claude.ai');
  });

  test('returns url and verifier for console mode', async () => {
    const result = await Effect.runPromise(buildPkceFlow('console'));
    expect(new URL(result.url).hostname).toBe('console.anthropic.com');
  });

  test('verifier in result matches state param in URL', async () => {
    const result = await Effect.runPromise(buildPkceFlow('max'));
    const state = new URL(result.url).searchParams.get('state');
    expect(state).toBe(result.verifier);
  });
});
