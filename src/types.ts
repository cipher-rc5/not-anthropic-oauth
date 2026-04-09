// file: src/types.ts
// description: Shared domain types for the Anthropic OAuth flow
// reference: https://console.anthropic.com/v1/oauth/token

export interface PkceChallenge {
  readonly verifier: string;
  readonly challenge: string;
}

export type AuthMode = 'max' | 'console';

export interface OAuthCredentials {
  readonly type: 'oauth';
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
}

export interface ApiKeyCredentials {
  readonly type: 'api_key';
  readonly key: string;
}

export type Credentials = OAuthCredentials | ApiKeyCredentials;

export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

export interface ApiKeyResponse {
  readonly raw_key: string;
}

// Overridable via ANTHROPIC_CLIENT_ID environment variable to support
// alternative OAuth application registrations without a code change.
const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e' as const;

export const getClientId = (): string => process.env['ANTHROPIC_CLIENT_ID'] ?? DEFAULT_CLIENT_ID;

export const ANTHROPIC_OAUTH_URL = 'https://console.anthropic.com/v1/oauth/token' as const;

export const REQUIRED_BETAS = ['oauth-2025-04-20', 'interleaved-thinking-2025-05-14'] as const;
