// file: src/store.ts
// description: File-backed credential store with Effect-based read/write using Bun APIs,
//              runtime type validation, and secure file permissions (0600).
// reference: https://bun.sh/docs/api/file-io, ~/.config/anthropic-oauth/credentials.json

import { Effect, Option } from 'effect';

import { StorageError } from './errors.ts';
import type { ApiKeyCredentials, Credentials, OAuthCredentials } from './types.ts';

// Resolved lazily on each call so that tests can override HOME via process.env
// without the path being frozen at module load time.
const getCredentialsPath = (): string => {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
  return `${home}/.config/anthropic-oauth/credentials.json`;
};

// ---------------------------------------------------------------------------
// Runtime type guards — prevents silently accepting corrupted credential files
// ---------------------------------------------------------------------------

const isOAuthCredentials = (v: unknown): v is OAuthCredentials =>
  typeof v === 'object' &&
  v !== null &&
  (v as Record<string, unknown>)['type'] === 'oauth' &&
  typeof (v as Record<string, unknown>)['access'] === 'string' &&
  typeof (v as Record<string, unknown>)['refresh'] === 'string' &&
  typeof (v as Record<string, unknown>)['expires'] === 'number';

const isApiKeyCredentials = (v: unknown): v is ApiKeyCredentials =>
  typeof v === 'object' &&
  v !== null &&
  (v as Record<string, unknown>)['type'] === 'api_key' &&
  typeof (v as Record<string, unknown>)['key'] === 'string';

export const isCredentials = (v: unknown): v is Credentials => isOAuthCredentials(v) || isApiKeyCredentials(v);

// ---------------------------------------------------------------------------
// In-memory credential cache
// Eliminates a disk read from the hot path of every authenticatedFetch call.
// Invalidated whenever credentials are written or cleared.
// ---------------------------------------------------------------------------

let credentialCache: Option.Option<Credentials> | null = null;

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const loadCredentials: Effect.Effect<Option.Option<Credentials>, StorageError> = Effect.tryPromise({
  try: async () => {
    // Return cached value if available — avoids disk I/O on every API call
    if (credentialCache !== null) return credentialCache;

    try {
      const file = Bun.file(getCredentialsPath());
      const raw = await file.text();
      const parsed: unknown = JSON.parse(raw);
      if (!isCredentials(parsed)) {
        // Corrupt or unknown format — treat as missing rather than throwing
        credentialCache = Option.none();
        return credentialCache;
      }
      credentialCache = Option.some(parsed);
      return credentialCache;
    } catch {
      credentialCache = Option.none();
      return credentialCache;
    }
  },
  catch: cause => new StorageError({ message: 'Failed to load credentials', cause })
});

export const saveCredentials = (credentials: Credentials): Effect.Effect<void, StorageError> =>
  Effect.tryPromise({
    try: async () => {
      const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
      const configDir = `${home}/.config/anthropic-oauth`;

      // Ensure directory exists using Bun shell
      await Bun.$`mkdir -p ${configDir}`.quiet();

      const credPath = getCredentialsPath();
      await Bun.write(credPath, JSON.stringify(credentials, null, 2));

      // Restrict to owner read/write only — documentation claimed 0600 but code never set it
      await Bun.$`chmod 600 ${credPath}`.quiet();

      // Update cache so subsequent loadCredentials calls don't re-read disk
      credentialCache = Option.some(credentials);
    },
    catch: cause => new StorageError({ message: 'Failed to save credentials', cause })
  });

export const clearCredentials: Effect.Effect<void, StorageError> = Effect.tryPromise({
  try: async () => {
    await Bun.$`rm -f ${getCredentialsPath()}`.quiet();
    // Invalidate cache
    credentialCache = Option.none();
  },
  catch: cause => new StorageError({ message: 'Failed to clear credentials', cause })
});
