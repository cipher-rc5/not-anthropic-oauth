// file: src/types.ts
// description: Shared domain types, constants, and environment helpers for the Anthropic OAuth flow

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

// ---------------------------------------------------------------------------
// Client ID
// ---------------------------------------------------------------------------

// Overridable via ANTHROPIC_CLIENT_ID environment variable to support
// alternative OAuth application registrations without a code change.
const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e' as const;

export const getClientId = (): string => process.env['ANTHROPIC_CLIENT_ID'] ?? DEFAULT_CLIENT_ID;

// ---------------------------------------------------------------------------
// OAuth endpoints — platform.claude.com domain
// ---------------------------------------------------------------------------

export const ANTHROPIC_OAUTH_URL = 'https://platform.claude.com/v1/oauth/token' as const;

export const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback' as const;

// ---------------------------------------------------------------------------
// Beta headers
// ---------------------------------------------------------------------------

// Betas always injected for OAuth compatibility.
export const REQUIRED_BETAS = ['oauth-2025-04-20'] as const;

// The interleaved-thinking beta activates Claude's extended thinking feature.
// It is opt-in: pass `enableInterleavedThinking: true` to `authenticatedFetch`
// options, or include a `thinking` block in your request body.
// Reference: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
export const INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14' as const;

// ---------------------------------------------------------------------------
// User-Agent
// ---------------------------------------------------------------------------

const DEFAULT_USER_AGENT = 'claude-cli/2.1.87 (external, cli)' as const;

/** Returns the User-Agent string to send with Anthropic API requests. */
export const getUserAgent = (): string => process.env['ANTHROPIC_USER_AGENT'] ?? DEFAULT_USER_AGENT;

// ---------------------------------------------------------------------------
// Identity strings — system prompt sanitization
// ---------------------------------------------------------------------------

/** Identity line injected by OpenCode (detected and removed during sanitization). */
export const OPENCODE_IDENTITY = 'You are OpenCode, the best coding agent on the planet.' as const;

/** Identity block prepended to the system prompt in its place. */
export const CLAUDE_CODE_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK." as const;

/** Paragraphs that contain any of these substrings are dropped from system prompts. */
export const PARAGRAPH_REMOVAL_ANCHORS = ['github.com/anomalyco/opencode', 'opencode.ai/docs'] as const;

export interface TextReplacement {
  readonly match: string;
  readonly replacement: string;
}

/** Inline text replacements applied after paragraph-level filtering. */
export const TEXT_REPLACEMENTS: readonly TextReplacement[] = [{
  match: 'if OpenCode honestly',
  replacement: 'if the assistant honestly'
}] as const;

// ---------------------------------------------------------------------------
// Content Consistency Hashing — billing header
// ---------------------------------------------------------------------------

export const CCH_SALT = '59cf53e54c78' as const;
export const CCH_POSITIONS = [4, 7, 20] as const;
export const CLAUDE_CODE_VERSION = '2.1.87' as const;
export const CLAUDE_CODE_ENTRYPOINT = 'sdk-cli' as const;

// ---------------------------------------------------------------------------
// ANTHROPIC_BASE_URL — proxy / alternative endpoint support
// ---------------------------------------------------------------------------

/**
 * Parse ANTHROPIC_BASE_URL from the environment.
 * Returns a valid HTTP(S) URL instance, or null when unset or malformed.
 *
 * When set, `authenticatedFetch` and `makeOAuthFetch` override the protocol
 * and host of all outgoing API requests to this base, enabling local proxies,
 * test doubles, and custom deployments without code changes.
 *
 * @example
 * ANTHROPIC_BASE_URL=http://localhost:8080  # redirect to local proxy
 */
export const getBaseUrl = (): URL | null => {
  const raw = process.env['ANTHROPIC_BASE_URL']?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Only accept plain http/https — reject credentials, exotic schemes
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};
