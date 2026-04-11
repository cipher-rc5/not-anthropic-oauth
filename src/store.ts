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

export const loadCredentials: Effect.Effect<Option.Option<Credentials>, StorageError> = Effect.gen(function*() {
  // Return cached value if available — avoids disk I/O on every API call
  if (credentialCache !== null) return credentialCache;

  let raw: string;
  try {
    const file = Bun.file(getCredentialsPath());
    raw = yield* Effect.tryPromise({ try: () => file.text(), catch: () => Option.none<Credentials>() });
  } catch {
    // File does not exist or is unreadable — treat as no credentials
    credentialCache = Option.none();
    return credentialCache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    credentialCache = Option.none();
    return credentialCache;
  }

  if (!isCredentials(parsed)) {
    // File exists but has an unrecognised shape — warn so the user can
    // diagnose why re-authentication is required.
    yield* Effect.logWarning(
      `Credential file at ${getCredentialsPath()} has an unrecognised format and will be ignored. ` +
        'Please re-authenticate.'
    );
    credentialCache = Option.none();
    return credentialCache;
  }

  // Warn when an OAuth token is already expired at load time.
  // The token is still returned so the client layer can attempt a refresh.
  if (parsed.type === 'oauth' && parsed.expires <= Date.now()) {
    yield* Effect.logWarning(
      'Stored OAuth token is expired. An automatic refresh will be attempted on the next request.'
    );
  }

  credentialCache = Option.some(parsed);
  return credentialCache;
}).pipe(Effect.catchAll(cause => Effect.fail(new StorageError({ message: 'Failed to load credentials', cause }))));

export const saveCredentials = (credentials: Credentials): Effect.Effect<void, StorageError> =>
  Effect.tryPromise({
    try: async () => {
      const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
      const configDir = `${home}/.config/anthropic-oauth`;

      // Ensure directory exists using Bun shell
      await Bun.$`mkdir -p ${configDir}`.quiet();

      const credPath = getCredentialsPath();
      const tmpPath = `${credPath}.tmp.${process.pid}`;

      // Atomic write: write to a temp file, chmod it, then rename into place.
      // This eliminates the TOCTOU window where a world-readable file could
      // be observed between Bun.write and the subsequent chmod.
      await Bun.write(tmpPath, JSON.stringify(credentials, null, 2));
      await Bun.$`chmod 600 ${tmpPath}`.quiet();
      await Bun.$`mv -f ${tmpPath} ${credPath}`.quiet();

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
