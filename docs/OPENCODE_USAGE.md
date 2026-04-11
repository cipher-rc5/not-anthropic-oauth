# OpenCode Integration Guide

## Automatic Credential Export

After logging in through the CLI, your Anthropic credentials are **automatically exported** to environment variables for OpenCode usage.

### What Happens After Login

When you successfully login (any method), the CLI automatically:

1. [OK] Saves credentials to `~/.config/anthropic-oauth/credentials.json`
2. [OK] Exports to `process.env['ANTHROPIC_API_KEY']`
3. [OK] Sets `OPENCODE_PROVIDER=anthropic`
4. [OK] Sets `OPENCODE_MODEL=claude-sonnet-4-20250514`

### Example Login Flow

```bash
$ bun run dev

Anthropic OAuth CLI
-------------------
1) Login via Claude Pro/Max (OAuth)
2) Login via Console (creates API key)
3) Enter API key manually
4) Show stored credentials
5) Test authenticated request
6) Logout
0) Exit

Choice: 1

Open this URL in your browser:
https://claude.ai/oauth/authorize?code=true&client_id=...

Paste the authorization code: YOUR_CODE_HERE

[OK] Login successful. Credentials saved.
Type    : oauth
Expires : 2026-03-20T19:23:20.950Z
Status  : [OK] Valid (expires in 14400s)
Access  : sk-ant-oat01-xxxxx...
Refresh : sk-ant-ort01-xxxxx...

[OK] Credentials exported to environment:
   ANTHROPIC_API_KEY=sk-ant-oat01-xxxxx...
   OPENCODE_PROVIDER=anthropic
   OPENCODE_MODEL=claude-sonnet-4-20250514
```

## Using with OpenCode

### Option 1: Environment Variables (Automatic)

After running the CLI, your credentials are available in `process.env`:

```typescript
import { exportToEnvironment } from 'anthropic-oauth';
import { Effect } from 'effect';

// Run once at app startup
await Effect.runPromise(exportToEnvironment());

// Now OpenCode can access:
// - process.env['ANTHROPIC_API_KEY']
// - process.env['OPENCODE_PROVIDER']
// - process.env['OPENCODE_MODEL']
```

### Option 2: Programmatic Access

```typescript
import { getOpenCodeConfig } from 'anthropic-oauth';
import { Effect } from 'effect';

const config = await Effect.runPromise(getOpenCodeConfig());

console.log(config);
// {
//   apiKey: 'sk-ant-oat01-xxxxx...',
//   provider: 'anthropic',
//   model: 'claude-sonnet-4-20250514'
// }
```

### Option 3: Generate Config File

```typescript
import { writeOpenCodeConfig } from 'anthropic-oauth';
import { Effect } from 'effect';

// Writes to .opencode/config.json (default path)
await Effect.runPromise(writeOpenCodeConfig());

// Or specify a custom path
await Effect.runPromise(writeOpenCodeConfig('.opencode/config.json'));
```

**Generated config.json:**

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-oat01-xxxxx...",
  "model": "claude-sonnet-4-20250514",
  "temperature": 0.7,
  "maxTokens": 4096
}
```

## Credential Validity

### Check Token Expiration

```typescript
import { checkCredentialValidity } from 'anthropic-oauth';
import { Effect } from 'effect';

const validity = await Effect.runPromise(checkCredentialValidity());

if (validity.valid) {
  console.log('Credentials are valid [OK]');

  if (validity.expiresIn) {
    const minutes = Math.floor(validity.expiresIn / 60);
    console.log(`Expires in ${minutes} minutes`);
  } else {
    console.log('API key (no expiration)');
  }
} else {
  console.log('Credentials expired or missing [ERROR]');
}
```

### CLI Credential Status

Use option `4` in the CLI to view credential details:

```
Choice: 4

Type    : oauth
Expires : 2026-03-20T19:23:20.950Z
Status  : [OK] Valid (expires in 14400s)
Access  : sk-ant-oat01-xxxxx...
Refresh : sk-ant-ort01-xxxxx...

[INFO]  Token will expire in 240 minutes
```

## OAuth Token Lifecycle

### Token Expiration

OAuth tokens from Claude Pro/Max expire after **4 hours** (14400 seconds).

The `authenticatedFetch` client automatically refreshes tokens when:

- Token is expired at request time

**Example:**

```typescript
import { authenticatedFetch } from 'anthropic-oauth';
import { Effect } from 'effect';

// This automatically handles token refresh
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

### Manual Token Refresh

Tokens are automatically refreshed by `authenticatedFetch`. Manual refresh is not exposed in the public API — if you need to force a re-authentication, run the CLI again:

```bash
bun run dev
# Choose option 1 or 2 to re-authenticate
```

## API Key vs OAuth Token

### API Key (Console Method)

- [OK] **No expiration**
- [OK] Simpler to use
- [OK] Works anywhere
- [ERROR] Requires Console access

### OAuth Token (Pro/Max Method)

- [OK] Ties to your Claude Pro/Max subscription
- [OK] Automatic refresh
- [ERROR] Expires after 4 hours
- [ERROR] Requires refresh token management

## Best Practices

1. **Use OAuth for interactive apps** — Automatic refresh handles long-running sessions
2. **Use API keys for scripts** — No expiration, no refresh needed
3. **Check validity before long tasks** — Avoid mid-operation expiration
4. **Store refresh tokens securely** — They provide long-term access

## Troubleshooting

### "No credentials found"

Run the CLI and login first:

```bash
bun run dev
# Choose option 1, 2, or 3 to login
```

### "Credentials expired"

For OAuth tokens, the CLI automatically refreshes them. If manual refresh fails:

```bash
bun run dev
# Choose option 1 or 2 to re-authenticate
```

### Environment variables not set

The export only works for the **current process**. For persistent export:

**In your code:**

```typescript
import { exportToEnvironment } from 'anthropic-oauth';

// Call at app startup
await Effect.runPromise(exportToEnvironment());
```

**Or write to config file:**

```typescript
import { writeOpenCodeConfig } from 'anthropic-oauth';

await Effect.runPromise(writeOpenCodeConfig('.opencode/config.json'));
```

## API Reference

### `exportToEnvironment(): Effect<void, StorageError | Error>`

Exports credentials to `process.env`:

- `ANTHROPIC_API_KEY`
- `OPENCODE_PROVIDER`
- `OPENCODE_MODEL`

### `getOpenCodeConfig(model?: string): Effect<OpenCodeConfig, StorageError | Error>`

Returns OpenCode configuration object.

**Parameters:**

- `model` — Override model (default: `ANTHROPIC_DEFAULT_MODEL` env var, or `'claude-sonnet-4-20250514'`)

**`OpenCodeConfig` type:**

```typescript
interface OpenCodeConfig {
  readonly apiKey: string;
  readonly provider: 'anthropic';
  readonly model?: string; // optional
}
```

### `checkCredentialValidity(): Effect<{ valid: boolean; expiresIn?: number }, StorageError | Error>`

Checks if stored credentials are valid.

**Returns:**

- `valid` — Whether credentials are valid
- `expiresIn` — Seconds until expiration (OAuth only)

### `writeOpenCodeConfig(path?: string): Effect<void, StorageError | Error>`

Writes OpenCode config to JSON file.

**Parameters:**

- `path` — File path (default: `'.opencode/config.json'`)

### `generateOpenCodeConfigFile(): Effect<string, StorageError | Error>`

Returns the config file content as a JSON string without writing to disk.

### `getDefaultModel(): string`

Returns the default model string. Respects `ANTHROPIC_DEFAULT_MODEL` env var.

---

**Status:** [OK] Automatic export after all login methods
**OAuth Tokens:** Expire after 4 hours, auto-refresh in `authenticatedFetch`
**API Keys:** No expiration
