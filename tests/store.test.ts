// file: tests/store.test.ts
// description: Tests for credential store — runtime guards, file I/O, permissions
// reference: src/store.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Effect, Option } from 'effect';
import { clearCredentials, isCredentials, loadCredentials, saveCredentials } from '../src/store.ts';
import type { ApiKeyCredentials, Credentials, OAuthCredentials } from '../src/types.ts';

// ---------------------------------------------------------------------------
// isCredentials — runtime type guard
// ---------------------------------------------------------------------------

describe('isCredentials', () => {
  test('accepts a valid OAuthCredentials object', () => {
    const v: OAuthCredentials = { type: 'oauth', access: 'acc', refresh: 'ref', expires: 9999 };
    expect(isCredentials(v)).toBe(true);
  });

  test('accepts a valid ApiKeyCredentials object', () => {
    const v: ApiKeyCredentials = { type: 'api_key', key: 'sk-ant-test' };
    expect(isCredentials(v)).toBe(true);
  });

  test('rejects null', () => {
    expect(isCredentials(null)).toBe(false);
  });

  test('rejects undefined', () => {
    expect(isCredentials(undefined)).toBe(false);
  });

  test('rejects a plain string', () => {
    expect(isCredentials('oauth')).toBe(false);
  });

  test('rejects an empty object', () => {
    expect(isCredentials({})).toBe(false);
  });

  test('rejects oauth shape missing access', () => {
    expect(isCredentials({ type: 'oauth', refresh: 'ref', expires: 0 })).toBe(false);
  });

  test('rejects oauth shape with non-numeric expires', () => {
    expect(isCredentials({ type: 'oauth', access: 'a', refresh: 'r', expires: 'tomorrow' })).toBe(false);
  });

  test('rejects api_key shape missing key', () => {
    expect(isCredentials({ type: 'api_key' })).toBe(false);
  });

  test('rejects api_key shape with non-string key', () => {
    expect(isCredentials({ type: 'api_key', key: 42 })).toBe(false);
  });

  test('rejects unknown type', () => {
    expect(isCredentials({ type: 'bearer', token: 'abc' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Credential store — uses a temp file path to avoid touching real config
// ---------------------------------------------------------------------------

const TMP_HOME = `/tmp/anthropic-oauth-test-${process.pid}`;

describe('credential store', () => {
  beforeEach(async () => {
    process.env['HOME'] = TMP_HOME;
    await Bun.$`mkdir -p ${TMP_HOME}/.config/anthropic-oauth`.quiet();
  });

  afterEach(async () => {
    await Bun.$`rm -rf ${TMP_HOME}`.quiet();
  });

  test('loadCredentials returns None when file does not exist', async () => {
    const result = await Effect.runPromise(loadCredentials);
    expect(Option.isNone(result)).toBe(true);
  });

  test('saveCredentials + loadCredentials round-trips an API key', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-round-trip' };
    await Effect.runPromise(saveCredentials(cred));
    const loaded = await Effect.runPromise(loadCredentials);
    expect(Option.isSome(loaded)).toBe(true);
    if (Option.isSome(loaded)) {
      expect(loaded.value).toEqual(cred);
    }
  });

  test('saveCredentials + loadCredentials round-trips OAuth credentials', async () => {
    const cred: Credentials = { type: 'oauth', access: 'acc123', refresh: 'ref456', expires: 9_000_000 };
    await Effect.runPromise(saveCredentials(cred));
    const loaded = await Effect.runPromise(loadCredentials);
    expect(Option.isSome(loaded)).toBe(true);
    if (Option.isSome(loaded)) {
      expect(loaded.value).toEqual(cred);
    }
  });

  test('saveCredentials sets file permissions to 0600', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-perms' };
    await Effect.runPromise(saveCredentials(cred));
    const path = `${TMP_HOME}/.config/anthropic-oauth/credentials.json`;
    const stat = await Bun.$`stat -f %Lp ${path}`.text();
    expect(stat.trim()).toBe('600');
  });

  test('loadCredentials returns None for corrupt JSON', async () => {
    const path = `${TMP_HOME}/.config/anthropic-oauth/credentials.json`;
    await Bun.write(path, '{ not valid json }');
    const result = await Effect.runPromise(loadCredentials);
    expect(Option.isNone(result)).toBe(true);
  });

  test('loadCredentials returns None for valid JSON but wrong shape', async () => {
    const path = `${TMP_HOME}/.config/anthropic-oauth/credentials.json`;
    await Bun.write(path, JSON.stringify({ type: 'unknown', token: 'abc' }));
    const result = await Effect.runPromise(loadCredentials);
    expect(Option.isNone(result)).toBe(true);
  });

  test('clearCredentials removes the file', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-clear' };
    await Effect.runPromise(saveCredentials(cred));

    // Confirm file exists
    const before = await Effect.runPromise(loadCredentials);
    expect(Option.isSome(before)).toBe(true);

    await Effect.runPromise(clearCredentials);

    const after = await Effect.runPromise(loadCredentials);
    expect(Option.isNone(after)).toBe(true);
  });

  test('clearCredentials is idempotent when no file exists', async () => {
    // Should not throw
    await expect(Effect.runPromise(clearCredentials)).resolves.toBeUndefined();
  });
});
