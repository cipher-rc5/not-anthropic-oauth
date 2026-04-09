# OAuth Authentication Patches for Anthropic API

## Overview

This document describes the critical patches applied to fix OAuth authentication issues with Anthropic's API. These patches resolve 429 rate limiting and authentication failures when using Claude Pro/Max subscriptions.

## Issues Addressed

- **429 Rate Limiting**: OAuth token exchange and refresh endpoints were returning 429 errors
- **Invalid Token Errors**: Authentication failures despite valid OAuth tokens
- **RFC 6749 Compliance**: OAuth endpoints require `application/x-www-form-urlencoded` content type

## Changes Applied

### 1. User-Agent Spoofing (src/client.ts & src/token.ts)

**Problem**: Anthropic's OAuth endpoints require the `claude-cli/2.1.2` user-agent to avoid rate limiting.

**Solution**: Changed user-agent from Safari browser string to `claude-cli/2.1.2`.

```typescript
// Before
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...';

// After
const DEFAULT_USER_AGENT = 'claude-cli/2.1.2';
```

**Environment Variable**: Can be overridden with `ANTHROPIC_USER_AGENT` env var.

### 2. RFC 6749 Compliance (src/token.ts)

**Problem**: OAuth token endpoints were using `application/json` with `JSON.stringify()`, but RFC 6749 §4.1.3 and §6 require `application/x-www-form-urlencoded`.

**Solution**: Changed all OAuth token operations to use URLSearchParams:

```typescript
// Before
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ grant_type: 'authorization_code', ... })

// After
headers: { 
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': OAUTH_USER_AGENT 
},
body: new URLSearchParams({ grant_type: 'authorization_code', ... }).toString()
```

### 3. Beta Headers (Already Implemented)

The following beta headers are already correctly implemented:

- `oauth-2025-04-20` - Enables OAuth authentication
- `interleaved-thinking-2025-05-14` - Enables extended reasoning capabilities

### 4. Request Transformations (Already Implemented)

The following transformations are already correctly implemented in `src/client.ts`:

- **Bearer Token Authentication**: Sets `Authorization: Bearer <token>` for OAuth credentials
- **Beta Query Parameter**: Appends `?beta=true` to `/v1/messages` endpoint for OAuth requests
- **Tool Name Prefixing**: Adds `mcp_` prefix to tool names in outbound requests
- **System Prompt Sanitization**: Replaces "OpenCode" with "Claude Code" in system prompts

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

1. **Token Exchange** (`exchangeCode`):
   - Now uses `application/x-www-form-urlencoded`
   - Includes `claude-cli/2.1.2` user-agent
   - Handles optional state parameter correctly

2. **Token Refresh** (`refreshAccessToken`):
   - Now uses `application/x-www-form-urlencoded`
   - Includes `claude-cli/2.1.2` user-agent
   - Prevents 429 rate limiting on refresh

3. **API Requests** (`authenticatedFetch`):
   - Uses `claude-cli/2.1.2` user-agent for all requests
   - Maintains existing request body transformations
   - Properly handles OAuth vs API key authentication

## Environment Variables

Two separate env vars control user-agent behaviour in different modules:

- `ANTHROPIC_USER_AGENT`: Override the `claude-cli/2.1.2` user-agent used by `src/client.ts` (`authenticatedFetch`) and `src/token.ts`. Not recommended.
- `OPENCODE_ANTHROPIC_USER_AGENT`: Override the Safari user-agent used by `src/plugin.ts` (`AnthropicUserAgentPlugin`) when patching global fetch for OpenCode.

## Migration Notes

If you're using this library and experiencing OAuth authentication issues:

1. **Update to the latest version** with these patches
2. **No code changes required** - patches are transparent

## Implemented Features

The following items have been fully implemented:

1. **Retry Logic with Exponential Backoff** (`src/token.ts` — `fetchWithRetry`)
   - Up to 3 attempts with 250ms/500ms/1000ms delays
   - Retries on 5xx and network errors; 4xx errors pass through immediately

2. **Token Refresh Deduplication** (`src/client.ts` — `ensureFreshToken`)
   - Module-level `refreshInFlight` mutex prevents concurrent refresh races
   - Multiple simultaneous requests with an expired token trigger exactly one refresh

## Future Considerations

1. **Automatic Refresh Scheduling**: Proactive background refresh 5 minutes before expiry
   (currently refreshes on-demand at the point of the next request)
2. **OpenCode Watch Mode**: Monitor credential file changes and auto-sync

## Compatibility

- **Bun Runtime**: All changes use Web APIs (URLSearchParams, fetch) available in Bun
- **Effect-TS**: Changes maintain Effect-based error handling patterns
- **TypeScript**: All types properly defined, strict mode compliant
