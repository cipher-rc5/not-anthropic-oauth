// file: src/opencode.ts
// description: OpenCode integration for exporting Anthropic API credentials.
//              Uses Effect.logInfo/logWarning/logError instead of console.log
//              so callers can control log formatting via Logger layers.
// reference: https://opencode.ai/docs/integrations

import { Effect, Option } from 'effect';

import { StorageError } from './errors.ts';
import { getStoredCredentials } from './service.ts';
import type { Credentials } from './types.ts';

export interface OpenCodeConfig {
  readonly apiKey: string;
  readonly provider: 'anthropic';
  readonly model?: string;
}

// ---------------------------------------------------------------------------
// Default model — overridable via env so callers don't need a code change
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-4-20250514' as const;

export const getDefaultModel = (): string => process.env['ANTHROPIC_DEFAULT_MODEL'] ?? DEFAULT_MODEL;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const extractApiKey = (credentials: Credentials): string => {
  if (credentials.type === 'api_key') {
    return credentials.key;
  }
  return credentials.access;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get OpenCode-compatible configuration from stored credentials.
 * Propagates StorageError when the credential file cannot be read.
 */
export const getOpenCodeConfig = (model?: string): Effect.Effect<OpenCodeConfig, StorageError | Error> =>
  Effect.gen(function*() {
    const maybeCredentials = yield* getStoredCredentials;

    if (Option.isNone(maybeCredentials)) {
      return yield* Effect.fail(new Error('No credentials found. Please login first using the CLI.'));
    }

    const credentials = maybeCredentials.value;
    const apiKey = extractApiKey(credentials);

    return { apiKey, provider: 'anthropic', model: model ?? getDefaultModel() };
  });

/**
 * Export credentials as environment variables for OpenCode.
 */
export const exportToEnvironment = (): Effect.Effect<void, StorageError | Error> =>
  Effect.gen(function*() {
    const config = yield* getOpenCodeConfig();

    process.env['ANTHROPIC_API_KEY'] = config.apiKey;
    process.env['OPENCODE_PROVIDER'] = config.provider;
    if (config.model) {
      process.env['OPENCODE_MODEL'] = config.model;
    }

    yield* Effect.logInfo('Credentials exported to environment');
    yield* Effect.logDebug('ANTHROPIC_API_KEY=[REDACTED]');
    yield* Effect.logDebug(`OPENCODE_PROVIDER=${config.provider}`);
    yield* Effect.logDebug(`OPENCODE_MODEL=${config.model ?? 'default'}`);
  });

/**
 * Generate OpenCode configuration file content.
 */
export const generateOpenCodeConfigFile = (): Effect.Effect<string, StorageError | Error> =>
  Effect.gen(function*() {
    const config = yield* getOpenCodeConfig();

    return JSON.stringify(
      { provider: config.provider, apiKey: config.apiKey, model: config.model, temperature: 0.7, maxTokens: 4096 },
      null,
      2
    );
  });

/**
 * Write OpenCode configuration to file.
 */
export const writeOpenCodeConfig = (path = '.opencode/config.json'): Effect.Effect<void, StorageError | Error> =>
  Effect.gen(function*() {
    const configContent = yield* generateOpenCodeConfigFile();

    yield* Effect.tryPromise({
      try: async () => {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir) await Bun.$`mkdir -p ${dir}`.quiet();
        await Bun.write(path, configContent);
      },
      catch: cause => new Error(`Failed to write OpenCode config: ${String(cause)}`)
    });

    yield* Effect.logInfo(`OpenCode config written to ${path}`);
  });

/**
 * Check if stored credentials are still valid.
 * Returns a typed result — StorageError is surfaced rather than collapsed to { valid: false }.
 */
export const checkCredentialValidity = (): Effect.Effect<
  { valid: boolean, expiresIn?: number },
  StorageError | Error
> =>
  Effect.gen(function*() {
    const maybeCredentials = yield* getStoredCredentials;

    if (Option.isNone(maybeCredentials)) {
      return { valid: false };
    }

    const credentials = maybeCredentials.value;

    if (credentials.type === 'api_key') {
      return { valid: true }; // API keys don't expire
    }

    const now = Date.now();
    const expiresIn = credentials.expires - now;

    return {
      valid: expiresIn > 0,
      expiresIn: Math.floor(expiresIn / 1000) // seconds
    };
  });
