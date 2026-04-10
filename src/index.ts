// file: src/index.ts
// description: Public API surface for the anthropic-oauth package
// reference: all src modules

export { authenticatedFetch } from './client.ts';
export type { AuthenticatedFetchOptions } from './client.ts';
export { ApiKeyCreationError, AuthorizationUrlError, InvalidCredentialsError, PkceGenerationError, StorageError, TokenExchangeError, TokenRefreshError } from './errors.ts';
export { checkCredentialValidity, exportToEnvironment, generateOpenCodeConfigFile, getDefaultModel, getOpenCodeConfig, writeOpenCodeConfig } from './opencode.ts';
export type { OpenCodeConfig } from './opencode.ts';
export { AnthropicUserAgentPlugin, default } from './plugin.ts';
export { beginOAuth, completeApiKeyLogin, completeOAuthLogin, getStoredCredentials, logout, saveApiKey } from './service.ts';
export type { AuthorizationRequest } from './service.ts';
export { isCredentials } from './store.ts';
export { ANTHROPIC_OAUTH_URL, getClientId, INTERLEAVED_THINKING_BETA, REQUIRED_BETAS } from './types.ts';
export type { ApiKeyCredentials, ApiKeyResponse, AuthMode, Credentials, OAuthCredentials, PkceChallenge, TokenResponse } from './types.ts';
