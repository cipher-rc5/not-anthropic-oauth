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

**Option 1: Use `authenticatedFetch` (Recommended)**

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

**Option 2: Use the default export server plugin (OpenCode plugin API)**

```typescript
import AnthropicOAuthPlugin from 'anthropic-oauth';
// or: import AnthropicOAuthPlugin from 'anthropic-oauth/server';

// opencode calls this as: await plugin(input)
export default AnthropicOAuthPlugin;
```

This plugin handles full OAuth routing: swaps `x-api-key` for `Authorization: Bearer`, appends
`?beta=true`, strips `mcp_` prefixes from streaming responses, and exposes an OAuth login method
in OpenCode's provider auth UI.

**Option 3: Patch global fetch (legacy — deprecated)**

```typescript
import { AnthropicUserAgentPlugin } from 'anthropic-oauth';

// @deprecated — use the default export plugin above for full OAuth routing
await AnthropicUserAgentPlugin();
```

This only injects the user-agent into global fetch calls targeting Anthropic hosts. It does not
handle OAuth token injection, URL rewriting, or streaming transformations.

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

- Injects `authorization: Bearer` (OAuth) or `x-api-key` (API key) automatically
- Refreshes expired OAuth tokens transparently (with concurrent-refresh deduplication)
- Computes and injects the CCH billing header into the system prompt
- Prepends the Claude Code identity block to `system[]`
- Sanitizes system prompts that reference OpenCode branding
- Relocates non-identity system blocks to the first user message (required by OAuth endpoint)
- Prefixes tool definitions and `tool_use` blocks with `mcp_`
- Appends `?beta=true` to `/v1/messages` for OAuth requests
- Strips `mcp_` prefixes from tool names in streaming responses
- Retries on 429 with Retry-After / exponential backoff (up to 3 attempts)

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

**Type signature:**

```typescript
authenticatedFetch(
  input: RequestInfo | URL,
  init?: AuthenticatedFetchOptions
): Effect.Effect<Response, InvalidCredentialsError | NetworkError | TokenRefreshError | StorageError>
```

### `AnthropicUserAgentPlugin()` (deprecated)

> **Deprecated**: Use the default export server plugin instead for full OAuth routing.

Patches `globalThis.fetch` to inject a user-agent for Anthropic API calls.

```typescript
import { AnthropicUserAgentPlugin } from 'anthropic-oauth';

// @deprecated
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

- `ANTHROPIC_API_KEY` — Access token or API key
- `OPENCODE_PROVIDER` — Set to `"anthropic"`
- `OPENCODE_MODEL` — Set to `"claude-sonnet-4-20250514"` (or `ANTHROPIC_DEFAULT_MODEL` env var)

```typescript
import { exportToEnvironment } from 'anthropic-oauth';
import { Effect } from 'effect';

await Effect.runPromise(exportToEnvironment());
```

**Type signature:**

```typescript
exportToEnvironment(): Effect.Effect<void, StorageError | Error>
```

### `getOpenCodeConfig(model?)`

Returns an OpenCode-compatible configuration object.

```typescript
{
  apiKey: string;
  provider: 'anthropic';
  model?: string;
}
```

```typescript
import { getOpenCodeConfig } from 'anthropic-oauth';
import { Effect } from 'effect';

const config = await Effect.runPromise(getOpenCodeConfig());
// { apiKey: 'sk-ant-...', provider: 'anthropic', model: 'claude-sonnet-4-20250514' }
```

**Type signature:**

```typescript
getOpenCodeConfig(model?: string): Effect.Effect<OpenCodeConfig, StorageError | Error>
```

### `checkCredentialValidity()`

Checks if stored credentials are still valid.

**Type signature:**

```typescript
checkCredentialValidity(): Effect.Effect<{ valid: boolean, expiresIn?: number }, StorageError | Error>
```

### `writeOpenCodeConfig(path?)`

Writes OpenCode configuration to a JSON file.

```typescript
import { writeOpenCodeConfig } from 'anthropic-oauth';
import { Effect } from 'effect';

await Effect.runPromise(writeOpenCodeConfig()); // defaults to .opencode/config.json
```

**Type signature:**

```typescript
writeOpenCodeConfig(path?: string): Effect.Effect<void, StorageError | Error>
// default path: '.opencode/config.json'
```

### `generateOpenCodeConfigFile()`

Generates the OpenCode configuration file content as a JSON string (without writing to disk).

**Type signature:**

```typescript
generateOpenCodeConfigFile(): Effect.Effect<string, StorageError | Error>
```

### `getDefaultModel()`

Returns the default model string, respecting the `ANTHROPIC_DEFAULT_MODEL` env var.

```typescript
import { getDefaultModel } from 'anthropic-oauth';

const model = getDefaultModel(); // 'claude-sonnet-4-20250514' or env override
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

**Solution**: Use `authenticatedFetch` (which sets `claude-cli/2.1.87 (external, cli)` automatically), or:

```bash
export ANTHROPIC_USER_AGENT='claude-cli/2.1.87 (external, cli)'
```

### Credentials not persisting across OpenCode restarts

`bun run sync` must be re-run whenever your OAuth token is refreshed or after a new login.
The sync is a one-shot write — it does not watch for changes.

## Security Notes

- Credentials stored at `~/.config/anthropic-oauth/credentials.json` with `0600` permissions
- Atomic write (temp file + rename) eliminates the TOCTOU race window
- API keys displayed with max 8 characters in the CLI: `sk-ant-o...`
- OAuth tokens auto-refresh before expiry (4-hour lifetime)
- The sync script only updates the `anthropic` key in OpenCode's auth.json — other providers are preserved

## References

- [OPENCODE_USAGE.md](./OPENCODE_USAGE.md) - Credential lifecycle and API reference
- [OAUTH_PATCHES.md](./OAUTH_PATCHES.md) - Authentication fix details
- [VERSION_DOWNGRADE.md](./VERSION_DOWNGRADE.md) - Pinning OpenCode to v1.2.27
- [Main README](../README.md) - Quick start
