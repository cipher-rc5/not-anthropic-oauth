#!/usr/bin/env bun
// file: bin/sync-to-opencode.ts
// description: Syncs OAuth credentials from anthropic-oauth to OpenCode's auth.json format.
//              Uses Effect.log* instead of console.log so output respects Logger layers.
// reference: ~/.local/share/opencode/auth.json

import { Effect } from 'effect';
import { loadCredentials } from '../src/store.ts';

const OPENCODE_AUTH_PATH = `${process.env['HOME']}/.local/share/opencode/auth.json`;

const syncToOpenCode = Effect.gen(function*() {
  yield* Effect.logInfo('Loading credentials from ~/.config/anthropic-oauth/credentials.json');
  const maybeCredentials = yield* loadCredentials;

  if (maybeCredentials._tag === 'None') {
    yield* Effect.logError('No credentials found. Run the login flow first.');
    return yield* Effect.fail(new Error('No credentials found'));
  }

  const credentials = maybeCredentials.value;

  if (credentials.type !== 'oauth') {
    yield* Effect.logError('Only OAuth credentials can be synced to OpenCode');
    return yield* Effect.fail(new Error('Not OAuth credentials'));
  }

  yield* Effect.logInfo('Reading existing OpenCode auth.json');
  const existingAuth = yield* Effect.tryPromise({
    try: async () => {
      try {
        const file = Bun.file(OPENCODE_AUTH_PATH);
        const text = await file.text();
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    },
    catch: () => new Error('Failed to read OpenCode auth.json')
  });

  const hadExisting = Object.keys(existingAuth).length > 0;
  if (!hadExisting) {
    yield* Effect.logWarning('No existing auth.json found, creating new one');
  }

  // Update the anthropic section with OAuth credentials
  existingAuth['anthropic'] = {
    type: 'oauth',
    access: credentials.access,
    refresh: credentials.refresh,
    expires: credentials.expires
  };

  yield* Effect.logInfo('Writing updated auth.json to OpenCode');
  yield* Effect.tryPromise({
    try: () => Bun.write(OPENCODE_AUTH_PATH, JSON.stringify(existingAuth, null, 2)),
    catch: () => new Error('Failed to write OpenCode auth.json')
  });

  yield* Effect.logInfo('Successfully synced OAuth credentials to OpenCode');
  yield* Effect.logDebug(`Access token: ${credentials.access.substring(0, 16)}...`);
  yield* Effect.logDebug(`Expires: ${new Date(credentials.expires).toISOString()}`);
});

Effect.runPromise(syncToOpenCode).catch(err => {
  // Top-level catch: Effect logging is not available outside the runtime,
  // so console.error is correct here as a last-resort handler.
  console.error('[ERROR]', err);
  process.exit(1);
});
