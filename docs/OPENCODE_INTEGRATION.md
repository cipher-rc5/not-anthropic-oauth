# OpenCode Integration Guide

> **Platform notice**: Tested and confirmed working on **macOS** with **OpenCode v1.2.27**.
> See [VERSION_DOWNGRADE.md](./VERSION_DOWNGRADE.md) for instructions on pinning to that version.

## Overview

This library syncs OAuth credentials to OpenCode's authentication store, letting you use your
Claude Pro/Max subscription with OpenCode without the "x-api-key header is required" error.

- Direct credential sync to `~/.local/share/opencode/auth.json`
- User-agent patching for Anthropic API compliance
- Support for both OAuth tokens and API keys

## Quick Start

### 1. Login via CLI

```bash
bun run dev
# Choose option 1, 2, or 3 to login
```

### 2. Sync credentials to OpenCode

```bash
bun run sync
```

**Output:**

```
timestamp=... level=INFO msg="Loading credentials from ~/.config/anthropic-oauth/credentials.json"
timestamp=... level=INFO msg="Reading existing OpenCode auth.json"
timestamp=... level=INFO msg="Writing updated auth.json to OpenCode"
timestamp=... level=INFO msg="Successfully synced OAuth credentials to OpenCode"
```

### 3. Verify OpenCode Integration

Open OpenCode and try using Anthropic Claude. Authentication should now work without
"x-api-key header is required" errors.

## How It Works

### Credential Types

The package supports both credential types:

**OAuth Token (4-hour expiry)**:

```
authorization: Bearer sk-ant-oat01...
```

**API Key (permanent)**:

```
x-api-key: sk-ant-api03...
```

`authenticatedFetch` automatically uses the correct header based on credential type.

### User-Agent Handling

Anthropic's API requires specific user-agent headers. Two options:

**Option 1: Use authenticatedFetch (Recommended)**

```typescript
import { authenticatedFetch } from 'anthropic-oauth';
import { Effect } from 'effect';

const response = await Effect.runPromise(
  authenticatedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }]
    })
  })
);
```

**Option 2: Patch Global Fetch (OpenCode Plugin)**

```typescript
import { AnthropicUserAgentPlugin } from 'anthropic-oauth';

// Call once at app startup
await AnthropicUserAgentPlugin();

// All fetch calls to Anthropic endpoints now have the correct user-agent
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': process.env['ANTHROPIC_API_KEY'], 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
```

**Custom user-agent override:**

```bash
export OPENCODE_ANTHROPIC_USER_AGENT='MyApp/1.0'
```

## Credential Storage Locations

### This Library

- **Path**: `~/.config/anthropic-oauth/credentials.json`
- **Format**:
  ```json
  { "type": "oauth", "access": "sk-ant-oat01-...", "refresh": "sk-ant-ort01-...", "expires": 1774104649219 }
  ```

### OpenCode

- **Path**: `~/.local/share/opencode/auth.json`
- **Format**:
  ```json
  {
    "anthropic": {
      "type": "oauth",
      "access": "sk-ant-oat01-...",
      "refresh": "sk-ant-ort01-...",
      "expires": 1774104649219
    },
    "openai": {}
  }
  ```

## How the Sync Works

The `bun run sync` command (`bin/sync-to-opencode.ts`):

1. **Reads** your OAuth credentials from `~/.config/anthropic-oauth/credentials.json`
2. **Loads** the existing OpenCode auth.json (preserving other providers like OpenAI)
3. **Updates** only the `anthropic` section with the current OAuth credentials
4. **Writes** back to `~/.local/share/opencode/auth.json`

## API Reference

### `authenticatedFetch(input, init?)`

Effect-based wrapper around `fetch` that:

- Injects `Authorization: Bearer` (OAuth) or `x-api-key` (API key) automatically
- Refreshes expired OAuth tokens transparently
- Appends `?beta=true` to `/v1/messages` for OAuth requests
- Prefixes tool names with `mcp_` in the request body
- Sanitizes system prompts that reference OpenCode

```typescript
import { authenticatedFetch } from 'anthropic-oauth';
import { Effect } from 'effect';

const program = Effect.gen(function*() {
  const response = yield* authenticatedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }]
    })
  });

  const data = yield* Effect.tryPromise({ try: () => response.json(), catch: () => new Error('Parse failed') });
  return data;
});

const result = await Effect.runPromise(program);
```

### `AnthropicUserAgentPlugin()`

Patches `globalThis.fetch` to inject user-agent for Anthropic API calls.

```typescript
import { AnthropicUserAgentPlugin } from 'anthropic-oauth';

// Call once at startup
await AnthropicUserAgentPlugin();
```

**Behavior:**

- Only patches requests to `api.anthropic.com`, `console.anthropic.com`, `claude.ai`
- Other fetch calls remain unaffected
- User-agent overridable via `OPENCODE_ANTHROPIC_USER_AGENT` env var
- Idempotent — safe to call multiple times

### `exportToEnvironment()`

Exports credentials as environment variables for OpenCode.

**Sets:**

- `ANTHROPIC_API_KEY` - Access token or API key
- `OPENCODE_PROVIDER` - Set to `"anthropic"`
- `OPENCODE_MODEL` - Set to `"claude-sonnet-4-20250514"` (or `ANTHROPIC_DEFAULT_MODEL` env var)

```typescript
import { exportToEnvironment } from 'anthropic-oauth';
import { Effect } from 'effect';

await Effect.runPromise(exportToEnvironment());
```

### `getOpenCodeConfig(model?)`

Returns an OpenCode-compatible configuration object.

```typescript
{
  apiKey: string;
  provider: 'anthropic';
  model: string;
}
```

```typescript
import { getOpenCodeConfig } from 'anthropic-oauth';
import { Effect } from 'effect';

const config = await Effect.runPromise(getOpenCodeConfig());
// { apiKey: 'sk-ant-...', provider: 'anthropic', model: 'claude-sonnet-4-20250514' }
```

## Troubleshooting

### "x-api-key invalid" or "x-api-key header is required"

**Problem**: OpenCode cannot authenticate with Anthropic.

**Solution**:

1. Login via the CLI: `bun run dev` (option 1, 2, or 3)
2. Sync to OpenCode: `bun run sync`
3. Confirm OpenCode is on v1.2.27: `opencode -v`

### "No credentials found"

**Problem**: `authenticatedFetch` or `bun run sync` fails with no credentials.

**Solution**: Run `bun run dev` and complete a login flow first.

### User-agent issues (403 errors)

**Solution**: Use `authenticatedFetch` (which sets `claude-cli/2.1.2` automatically), or:

```bash
export ANTHROPIC_USER_AGENT='claude-cli/2.1.2'
```

### Credentials not persisting across OpenCode restarts

`bun run sync` must be re-run whenever your OAuth token is refreshed or after a new login.
The sync is a one-shot write — it does not watch for changes.

## Security Notes

- Credentials stored at `~/.config/anthropic-oauth/credentials.json` with `0600` permissions
- API keys displayed with max 8 characters in the CLI: `sk-ant-o...`
- OAuth tokens auto-refresh before expiry (4-hour lifetime)
- The sync script only updates the `anthropic` key in OpenCode's auth.json — other providers are preserved

## References

- [OPENCODE_USAGE.md](./OPENCODE_USAGE.md) - Credential lifecycle and API reference
- [OAUTH_PATCHES.md](./OAUTH_PATCHES.md) - Authentication fix details
- [VERSION_DOWNGRADE.md](./VERSION_DOWNGRADE.md) - Pinning OpenCode to v1.2.27
- [Main README](../README.md) - Quick start
