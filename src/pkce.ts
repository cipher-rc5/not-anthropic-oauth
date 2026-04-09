// file: src/pkce.ts
// description: PKCE challenge generation and authorization URL construction
// reference: https://claude.ai/oauth/authorize

import { generatePKCE } from '@openauthjs/openauth/pkce';
import { Effect } from 'effect';
import { AuthorizationUrlError, PkceGenerationError } from './errors.ts';
import type { AuthMode, PkceChallenge } from './types.ts';
import { getClientId } from './types.ts';

export const generateChallenge: Effect.Effect<PkceChallenge, PkceGenerationError> = Effect.tryPromise({
  try: () => generatePKCE(),
  catch: cause => new PkceGenerationError({ cause })
});

export const buildAuthorizationUrl = (
  mode: AuthMode,
  pkce: PkceChallenge
): Effect.Effect<string, AuthorizationUrlError> =>
  Effect.try({
    try: () => {
      const base = mode === 'console' ? 'https://console.anthropic.com' : 'https://claude.ai';

      const url = new URL(`${base}/oauth/authorize`);
      url.searchParams.set('code', 'true');
      url.searchParams.set('client_id', getClientId());
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback');
      url.searchParams.set('scope', 'org:create_api_key user:profile user:inference');
      url.searchParams.set('code_challenge', pkce.challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', pkce.verifier);

      return url.toString();
    },
    catch: cause => new AuthorizationUrlError({ message: `Failed to construct authorization URL: ${String(cause)}` })
  });

export const buildPkceFlow = (
  mode: AuthMode
): Effect.Effect<{ url: string, verifier: string }, PkceGenerationError | AuthorizationUrlError> =>
  Effect.gen(function*() {
    const pkce = yield* generateChallenge;
    const url = yield* buildAuthorizationUrl(mode, pkce);
    return { url, verifier: pkce.verifier };
  });
