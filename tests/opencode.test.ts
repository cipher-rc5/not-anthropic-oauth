// file: tests/opencode.test.ts
// description: Tests for OpenCode integration — getOpenCodeConfig, checkCredentialValidity,
//              exportToEnvironment, and getDefaultModel env override.
// reference: src/opencode.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Effect, Logger, LogLevel } from 'effect';
import { checkCredentialValidity, exportToEnvironment, getDefaultModel, getOpenCodeConfig } from '../src/opencode.ts';
import { clearCredentials, saveCredentials } from '../src/store.ts';
import type { Credentials } from '../src/types.ts';

const TMP_HOME = `/tmp/anthropic-oauth-opencode-test-${process.pid}`;

beforeEach(async () => {
  process.env['HOME'] = TMP_HOME;
  await Bun.$`mkdir -p ${TMP_HOME}/.config/anthropic-oauth`.quiet();
  // Flush module-level credential cache between tests
  await Effect.runPromise(clearCredentials);
});

afterEach(async () => {
  await Bun.$`rm -rf ${TMP_HOME}`.quiet();
  delete process.env['ANTHROPIC_DEFAULT_MODEL'];
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['OPENCODE_PROVIDER'];
  delete process.env['OPENCODE_MODEL'];
});

// ---------------------------------------------------------------------------
// getDefaultModel
// ---------------------------------------------------------------------------

describe('getDefaultModel', () => {
  test('returns built-in default when env var is not set', () => {
    delete process.env['ANTHROPIC_DEFAULT_MODEL'];
    expect(getDefaultModel()).toBe('claude-sonnet-4-20250514');
  });

  test('returns env var when ANTHROPIC_DEFAULT_MODEL is set', () => {
    process.env['ANTHROPIC_DEFAULT_MODEL'] = 'claude-opus-4-20260101';
    expect(getDefaultModel()).toBe('claude-opus-4-20260101');
  });
});

// ---------------------------------------------------------------------------
// getOpenCodeConfig
// ---------------------------------------------------------------------------

describe('getOpenCodeConfig', () => {
  test('fails with Error when no credentials exist', async () => {
    const result = await Effect.runPromise(getOpenCodeConfig().pipe(Effect.either));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(Error);
      expect((result.left as Error).message).toContain('No credentials found');
    }
  });

  test('returns config with apiKey for API key credentials', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-mykey' };
    await Effect.runPromise(saveCredentials(cred));

    const config = await Effect.runPromise(getOpenCodeConfig());
    expect(config.apiKey).toBe('sk-ant-mykey');
    expect(config.provider).toBe('anthropic');
  });

  test('returns config with access token as apiKey for OAuth credentials', async () => {
    const cred: Credentials = {
      type: 'oauth',
      access: 'oauth-access-token',
      refresh: 'ref',
      expires: Date.now() + 3600_000
    };
    await Effect.runPromise(saveCredentials(cred));

    const config = await Effect.runPromise(getOpenCodeConfig());
    expect(config.apiKey).toBe('oauth-access-token');
  });

  test('uses provided model argument', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-x' };
    await Effect.runPromise(saveCredentials(cred));

    const config = await Effect.runPromise(getOpenCodeConfig('claude-custom-model'));
    expect(config.model).toBe('claude-custom-model');
  });

  test('uses getDefaultModel() when no model argument is provided', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-x' };
    await Effect.runPromise(saveCredentials(cred));

    process.env['ANTHROPIC_DEFAULT_MODEL'] = 'claude-env-override';
    const config = await Effect.runPromise(getOpenCodeConfig());
    expect(config.model).toBe('claude-env-override');
  });
});

// ---------------------------------------------------------------------------
// checkCredentialValidity
// ---------------------------------------------------------------------------

describe('checkCredentialValidity', () => {
  test('returns { valid: false } when no credentials exist', async () => {
    const result = await Effect.runPromise(checkCredentialValidity());
    expect(result.valid).toBe(false);
  });

  test('returns { valid: true } for API key credentials (no expiry)', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-valid' };
    await Effect.runPromise(saveCredentials(cred));

    const result = await Effect.runPromise(checkCredentialValidity());
    expect(result.valid).toBe(true);
    // API key credentials have no expiry — expiresIn field should be absent
    expect('expiresIn' in result ? result.expiresIn : undefined).toBeUndefined();
  });

  test('returns { valid: true, expiresIn } for a non-expired OAuth token', async () => {
    const cred: Credentials = { type: 'oauth', access: 'acc', refresh: 'ref', expires: Date.now() + 3600_000 };
    await Effect.runPromise(saveCredentials(cred));

    const result = await Effect.runPromise(checkCredentialValidity());
    expect(result.valid).toBe(true);
    expect('expiresIn' in result ? result.expiresIn : undefined).toBeGreaterThan(0);
  });

  test('returns { valid: false, expiresIn < 0 } for an expired OAuth token', async () => {
    const cred: Credentials = { type: 'oauth', access: 'acc', refresh: 'ref', expires: Date.now() - 1000 };
    await Effect.runPromise(saveCredentials(cred));

    const result = await Effect.runPromise(checkCredentialValidity());
    expect(result.valid).toBe(false);
    expect('expiresIn' in result ? result.expiresIn : 1).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// exportToEnvironment
// ---------------------------------------------------------------------------

// Suppress Effect logger output during exportToEnvironment tests — the function
// uses Effect.logInfo which would otherwise print to test stdout.
const silent = Logger.withMinimumLogLevel(LogLevel.None);

describe('exportToEnvironment', () => {
  test('sets ANTHROPIC_API_KEY in process.env', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-export' };
    await Effect.runPromise(saveCredentials(cred));

    await Effect.runPromise(exportToEnvironment().pipe(silent));
    expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-export');
  });

  test('sets OPENCODE_PROVIDER to anthropic', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-x' };
    await Effect.runPromise(saveCredentials(cred));

    await Effect.runPromise(exportToEnvironment().pipe(silent));
    expect(process.env['OPENCODE_PROVIDER']).toBe('anthropic');
  });

  test('sets OPENCODE_MODEL from default', async () => {
    const cred: Credentials = { type: 'api_key', key: 'sk-ant-x' };
    await Effect.runPromise(saveCredentials(cred));

    await Effect.runPromise(exportToEnvironment().pipe(silent));
    expect(process.env['OPENCODE_MODEL']).toBe(getDefaultModel());
  });

  test('fails with Error when no credentials exist', async () => {
    const result = await Effect.runPromise(exportToEnvironment().pipe(Effect.either, silent));
    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(Error);
    }
  });
});
