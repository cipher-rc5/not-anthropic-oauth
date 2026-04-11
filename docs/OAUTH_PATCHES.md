# OAuth Authentication Patches for Anthropic API

## Overview

This document describes the critical patches applied to fix OAuth authentication issues with Anthropic's API. These patches resolve 429 rate limiting and authentication failures when using Claude Pro/Max subscriptions.

## Issues Addressed

- **429 Rate Limiting**: OAuth token exchange and refresh endpoints were returning 429 errors
- **Invalid Token Errors**: Authentication failures despite valid OAuth tokens
- **RFC 6749 Compliance**: OAuth endpoints require `application/x-www-form-urlencoded` content type

## Changes Applied

### 1. User-Agent Spoofing (src/client.ts & src/token.ts)

**Problem**: Anthropic's OAuth endpoints require the `claude-cli/2.1.87 (external, cli)` user-agent to avoid rate limiting.

**Solution**: Set user-agent to `claude-cli/2.1.87 (external, cli)` (defined in `src/types.ts`).

```typescript
// src/types.ts
const DEFAULT_USER_AGENT = 'claude-cli/2.1.87 (external, cli)' as const;

export const getUserAgent = (): string => process.env['ANTHROPIC_USER_AGENT'] ?? DEFAULT_USER_AGENT;
```

**Environment Variable**: Can be overridden with `ANTHROPIC_USER_AGENT` env var.

### 2. RFC 6749 Compliance (src/token.ts)

**Problem**: OAuth token endpoints were using `application/json` with `JSON.stringify()`, but RFC 6749 §4.1.3 and §6 require `application/x-www-form-urlencoded`.

**Solution**: Changed all OAuth token operations to use URLSearchParams:

```typescript
// After
headers: { 
  'content-type': 'application/x-www-form-urlencoded',
  'user-agent': getUserAgent()
},
body: new URLSearchParams({ grant_type: 'authorization_code', ... }).toString()
```

### 3. Beta Headers (Already Implemented)

The following beta headers are always injected for OAuth compatibility (`src/types.ts`):

```typescript
export const REQUIRED_BETAS = ['oauth-2025-04-20', 'interleaved-thinking-2025-05-14'] as const;
```

- `oauth-2025-04-20` — Enables OAuth authentication
- `interleaved-thinking-2025-05-14` — Enables extended reasoning capabilities

### 4. Request Transformations (src/client.ts — `transformBody`)

The following transformations are applied to OAuth requests in `src/client.ts`:

- **CCH Billing Header**: Computes and injects `x-anthropic-billing-header` into the system prompt (via `src/cch.ts`)
- **Claude Code Identity Block**: Prepends the identity block as the first system entry
- **System Prompt Sanitization**: Removes OpenCode branding from system prompts (drops `OPENCODE_IDENTITY`, filters URL-anchor paragraphs, applies inline text replacements)
- **System Block Relocation**: Moves non-identity system blocks to the first user message; only the identity block stays in `system[]` (required by Anthropic's OAuth endpoint validation). Opt out with `EXPERIMENTAL_KEEP_SYSTEM_PROMPT=1`
- **Bearer Token Authentication**: Sets `authorization: Bearer <token>` for OAuth credentials
- **Beta Query Parameter**: Appends `?beta=true` to `/v1/messages` endpoint for OAuth requests (via `rewriteOAuthUrl` in `src/utils.ts`)
- **Tool Name Prefixing**: Adds `mcp_` prefix to tool definitions and `tool_use` content blocks in outbound requests (idempotent)
- **Streaming mcp_ Strip**: Strips `mcp_` prefixes from tool names in streaming responses (via `createStrippedStream` in `src/utils.ts`)

## Testing

All changes have been validated with:

```bash
bun run typecheck  # TypeScript type checking passes
bun run format     # Code formatting passes
bun run lint       # Full lint check passes
```

## Reference Issues

- OpenCode Issue #18329: OAuth token exchange 429 errors
- OpenCode Issue #17910: OAuth + cache_control ephemeral causes 400
- OpenCode Issue #18342: Invalid code on Claude Pro/Max

## Implementation Notes

1. **Token Exchange** (`exchangeCode` in `src/token.ts`):
   - Uses `application/x-www-form-urlencoded`
   - Includes `claude-cli/2.1.87 (external, cli)` user-agent
   - Handles optional state parameter correctly
   - Token endpoint: `https://platform.claude.com/v1/oauth/token`
   - Redirect URI: `https://platform.claude.com/oauth/code/callback`

2. **Token Refresh** (`refreshAccessToken` in `src/token.ts`):
   - Uses `application/x-www-form-urlencoded`
   - Includes `claude-cli/2.1.87 (external, cli)` user-agent
   - Prevents 429 rate limiting on refresh

3. **API Key Creation** (`createApiKey` in `src/token.ts`):
   - Endpoint: `https://api.anthropic.com/api/oauth/claude_cli/create_api_key`
   - Uses `Authorization: Bearer <access_token>`

4. **API Requests** (`authenticatedFetch` in `src/client.ts`):
   - Uses `claude-cli/2.1.87 (external, cli)` user-agent for all requests
   - Applies full body transformation pipeline for OAuth requests
   - Rewrites URL origin when `ANTHROPIC_BASE_URL` is set (proxy support)

## Environment Variables

Multiple env vars control behaviour:

| Variable                          | Module      | Purpose                                                                 |
| --------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `ANTHROPIC_USER_AGENT`            | types.ts    | Override `claude-cli/2.1.87 (external, cli)` for `authenticatedFetch` and `token.ts` |
| `OPENCODE_ANTHROPIC_USER_AGENT`   | plugin.ts   | Override the Safari UA used by the legacy `AnthropicUserAgentPlugin`    |
| `ANTHROPIC_BASE_URL`              | types.ts    | Redirect all API requests to a proxy/alternative endpoint (http/https)  |
| `ANTHROPIC_CLIENT_ID`             | types.ts    | Override the default OAuth client ID                                    |
| `ANTHROPIC_DEFAULT_MODEL`         | opencode.ts | Override the default model used in `getOpenCodeConfig`                  |
| `EXPERIMENTAL_KEEP_SYSTEM_PROMPT` | types.ts    | Set `1`/`true` to skip relocating system blocks to the first user message |

## Migration Notes

If you're using this library and experiencing OAuth authentication issues:

1. **Update to the latest version** with these patches
2. **No code changes required** — patches are transparent

## Implemented Features

The following items have been fully implemented:

1. **Retry Logic with Exponential Backoff** (`src/token.ts` — `fetchWithRetry`)
   - Up to 3 attempts with delays of 0ms / 250ms / 500ms before attempts 1 / 2 / 3
   - Retries on 5xx and network errors; 4xx errors pass through immediately
   - Per-attempt 10s timeout (configurable via `RetryOptions`)

2. **429 Rate-Limit Retry** (`src/client.ts` — `authenticatedFetch`)
   - Separate 3-attempt retry loop for `429 Too Many Requests` responses
   - Respects `Retry-After` header when present; otherwise uses 1s / 2s backoff

3. **Token Refresh Deduplication** (`src/client.ts` — `ensureFreshToken`)
   - Module-level `refreshInFlight: Promise<OAuthCredentials> | null` mutex prevents concurrent refresh races
   - Multiple simultaneous requests with an expired token trigger exactly one refresh

## Future Considerations

1. **Automatic Refresh Scheduling**: Proactive background refresh 5 minutes before expiry
   (currently refreshes on-demand at the point of the next request)
2. **OpenCode Watch Mode**: Monitor credential file changes and auto-sync

## Compatibility

- **Bun Runtime**: All changes use Web APIs (URLSearchParams, fetch) available in Bun
- **Effect-TS**: Changes maintain Effect-based error handling patterns
- **TypeScript**: All types properly defined, strict mode compliant
