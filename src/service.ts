// file: src/service.ts
// description: High-level OAuth service composing PKCE, token exchange,
//              credential storage, and the three login methods.
// reference: plugin source - auth.methods

import { Effect } from 'effect';
import { Option } from 'effect';
import type { ApiKeyCreationError, AuthorizationUrlError, PkceGenerationError, StorageError, TokenExchangeError } from './errors.ts';
import { buildPkceFlow } from './pkce.ts';
import { clearCredentials, loadCredentials, saveCredentials } from './store.ts';
import { createApiKey, exchangeCode } from './token.ts';
import type { AuthMode, Credentials } from './types.ts';

export interface AuthorizationRequest {
  readonly url: string;
  readonly verifier: string;
}

// Step 1 — get the URL to send the user to
export const beginOAuth = (
  mode: AuthMode
): Effect.Effect<AuthorizationRequest, PkceGenerationError | AuthorizationUrlError> => buildPkceFlow(mode);

// Step 2a — exchange the code for an OAuth token (Pro/Max mode)
export const completeOAuthLogin = (
  code: string,
  verifier: string
): Effect.Effect<Credentials, TokenExchangeError | StorageError> =>
  Effect.gen(function*() {
    const credentials = yield* exchangeCode(code, verifier);
    yield* saveCredentials(credentials);
    return credentials;
  });

// Step 2b — exchange code -> access token -> create permanent API key
export const completeApiKeyLogin = (
  code: string,
  verifier: string
): Effect.Effect<Credentials, TokenExchangeError | ApiKeyCreationError | StorageError> =>
  Effect.gen(function*() {
    const oauth = yield* exchangeCode(code, verifier);
    const api_key = yield* createApiKey(oauth.access);
    yield* saveCredentials(api_key);
    return api_key;
  });

// Manual API key (no PKCE needed)
export const saveApiKey = (key: string): Effect.Effect<Credentials, StorageError> => {
  const credentials: Credentials = { type: 'api_key', key };
  return saveCredentials(credentials).pipe(Effect.as(credentials));
};

export const getStoredCredentials: Effect.Effect<Option.Option<Credentials>, StorageError> = loadCredentials;

export const logout: Effect.Effect<void, StorageError> = clearCredentials;
