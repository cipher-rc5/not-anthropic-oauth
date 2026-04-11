# Anthropic OAuth

Type-safe OAuth 2.0 authentication for Anthropic's API using Bun runtime and Effect-TS.

> **Platform notice**: This project has been tested and confirmed working on **macOS** with
> **OpenCode v1.2.27**. Other platforms and OpenCode versions may work but are untested.
> See [docs/VERSION_DOWNGRADE.md](./docs/VERSION_DOWNGRADE.md) for instructions on pinning
> OpenCode to v1.2.27 via Homebrew.

## Features

- **Three Login Methods**:
- Claude Pro/Max OAuth (4-hour tokens with auto-refresh)
- Console OAuth → API Key (permanent)
- Manual API Key entry
- **Bun Runtime** - Fast, modern JavaScript runtime
- **Effect-TS** - Type-safe functional error handling
- **Automatic Token Refresh** - OAuth tokens refresh before expiry
- **OpenCode Integration** - Sync credentials directly to OpenCode's auth store
- **Strict TypeScript** - ESNext with maximum type safety (TypeScript 6.0)

## Installation

```bash
bun install
```

## Quick Start

### Interactive CLI

```bash
bun run dev
```

**Menu:**

```
1) Login via Claude Pro/Max (OAuth)    # 4-hour token, auto-refresh
2) Login via Console (creates API key) # Permanent API key
3) Enter API key manually              # Use existing key
4) Show stored credentials             # View current login
5) Test authenticated request          # Send test message
6) Logout                              # Clear credentials
0) Exit
```

### Programmatic Usage

```typescript
import { authenticatedFetch, beginOAuth, completeOAuthLogin, exportToEnvironment } from 'anthropic-oauth';
import { Effect } from 'effect';

// OAuth login flow
const login = Effect.gen(function*() {
  const { url, verifier } = yield* beginOAuth('max');

  console.log('Visit:', url);
  const code = prompt('Paste code:');

  const credentials = yield* completeOAuthLogin(code, verifier);

  // Auto-export for OpenCode
  yield* exportToEnvironment();

  return credentials;
});

await Effect.runPromise(login);

// Make authenticated requests
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

const data = await response.json();
console.log(data);
```

## Understanding Token Expiration

### What You See After Login

```
[OK] Login successful. Credentials saved.
Type    : oauth
Expires : 2026-03-20T15:23:20.950Z  ← Future timestamp
Status  : [OK] Valid (expires in 14400s)  ← 4 hours from now
Access  : sk-ant-oat01...
Refresh : sk-ant-ort01...
```

**The token is NOT expired immediately.** Here's what's happening:

1. **expires_in from API**: Anthropic returns `14400` (seconds) = 4 hours
2. **Calculation**: `Date.now() + 14400 * 1000` = future timestamp
3. **Display**: Shows the exact expiration time in ISO format

### Token Lifecycle

```
Login → Valid for 4 hours → Auto-refresh → Valid for 4 more hours → ...
```

The `authenticatedFetch` function automatically refreshes tokens **before** they expire, so you never hit expired credentials.

### Checking Token Status

```bash
# In CLI, choose option 4
Type    : oauth
Expires : 2026-03-20T15:23:20.950Z
Status  : [OK] Valid (expires in 14400s)  ← Still valid!

[INFO]  Token will expire in 240 minutes    ← Human-readable
```

If you see `[ERROR] EXPIRED`, re-run option 1 to login again.

## OpenCode Integration

Sync your OAuth credentials to OpenCode in two steps:

```bash
# Step 1: Authenticate with Anthropic
bun run dev  # Choose option 1 or 2

# Step 2: Sync credentials to OpenCode
bun run sync
```

**Output:**

```
[INFO] Loading credentials from ~/.config/anthropic-oauth/credentials.json
[INFO] Reading existing OpenCode auth.json
[INFO] Writing updated auth.json to OpenCode
[OK] Successfully synced OAuth credentials to OpenCode
[OK] Access token: sk-ant-oat01-...
[OK] Expires: 2026-03-21T14:50:49.219Z
```

This fixes the "x-api-key header is required" error in OpenCode by writing your OAuth credentials
to `~/.local/share/opencode/auth.json` in the correct format.

See [docs/OPENCODE_INTEGRATION.md](./docs/OPENCODE_INTEGRATION.md) for the detailed integration guide.

## Documentation

- **[Architecture](./docs/ARCHITECTURE.md)** - System architecture, diagrams, and design patterns
- **[OpenCode Integration](./docs/OPENCODE_INTEGRATION.md)** - Complete OpenCode sync guide
- **[OAuth Patches](./docs/OAUTH_PATCHES.md)** - Details on authentication fixes
- **[Version Downgrade](./docs/VERSION_DOWNGRADE.md)** - Pinning OpenCode to v1.2.27

## Development

### Scripts

```bash
bun run dev       # Interactive CLI
bun run sync      # Sync credentials to OpenCode
bun run build     # Bundle to dist/ (target: bun)
bun run typecheck # Type checking (TypeScript 6.0)
bun run format    # Auto-format with dprint
bun run lint      # Typecheck + format check
bun run ci        # Full CI gate: lint + test + build
```

### Project Structure

```
src/
├── types.ts     # Domain types, constants, env helpers
├── errors.ts    # Tagged error definitions (8 classes)
├── pkce.ts      # PKCE challenge generation
├── token.ts     # OAuth token operations
├── store.ts     # Credential storage (Bun APIs)
├── cch.ts       # Content Consistency Hashing (billing header)
├── utils.ts     # Header merging, URL rewriting, stream stripping
├── client.ts    # Authenticated fetch with auto-refresh
├── service.ts   # High-level service API
├── opencode.ts  # OpenCode integration helpers
├── plugin.ts    # OpenCode server plugin + legacy fetch patcher
└── index.ts     # Public exports
```

### Conventions

- **Runtime**: Bun only (no Node.js)
- **TypeScript**: ESNext strict mode (TypeScript 6.0.2)
- **Formatting**: dprint (single quotes, semicolons)
- **Error Handling**: Effect-TS with tagged errors
- **Commits**: Conventional Commits specification

See [.opencode/rules.md](./.opencode/rules.md) for detailed conventions.

## API Reference

### OAuth Flow

```typescript
// Step 1: Get authorization URL
const { url, verifier } = await Effect.runPromise(beginOAuth('max'));

// Step 2a: Exchange code for OAuth token
const oauthCreds = await Effect.runPromise(completeOAuthLogin(code, verifier));

// Step 2b: Exchange code for permanent API key
const apiKeyCreds = await Effect.runPromise(completeApiKeyLogin(code, verifier));

// Or: Save API key manually
const creds = await Effect.runPromise(saveApiKey('sk-ant-...'));
```

### Authenticated Requests

```typescript
import { authenticatedFetch } from 'anthropic-oauth';

// Automatically handles:
// - OAuth token refresh
// - Beta header injection
// - User-agent setting
const response = await Effect.runPromise(authenticatedFetch(url, init));
```

### OpenCode Integration

```typescript
import { checkCredentialValidity, exportToEnvironment, generateOpenCodeConfigFile, getDefaultModel, getOpenCodeConfig, writeOpenCodeConfig } from 'anthropic-oauth';

// Get config object
const config = await Effect.runPromise(getOpenCodeConfig());

// Export to environment
await Effect.runPromise(exportToEnvironment());

// Check if valid
const { valid, expiresIn } = await Effect.runPromise(checkCredentialValidity());

// Write .opencode/config.json
await Effect.runPromise(writeOpenCodeConfig());

// Get default model (respects ANTHROPIC_DEFAULT_MODEL env var)
const model = getDefaultModel(); // 'claude-sonnet-4-20250514'
```

### OpenCode Server Plugin

```typescript
// anthropic-oauth/server (or anthropic-oauth/plugin)
import AnthropicOAuthPlugin from 'anthropic-oauth/server';

// Used as an OpenCode plugin — opencode calls: await plugin(input)
export default AnthropicOAuthPlugin;
```

### Utility Types & Guards

```typescript
import type { AuthenticatedFetchOptions } from 'anthropic-oauth';
import { isCredentials } from 'anthropic-oauth';

// Type guard for stored credential JSON
const raw = JSON.parse(await Bun.file('creds.json').text());
if (isCredentials(raw)) {
  // raw is Credentials (OAuthCredentials | ApiKeyCredentials)
}
```

## Troubleshooting

### "No credentials found"

**Solution:** Run `bun run dev` and login (option 1, 2, or 3).

### "Token expired"

**Solution:**

- OAuth tokens expire after 4 hours
- Use `authenticatedFetch` which auto-refreshes
- Or re-login via CLI

### Environment variables not set

**Solution:**

```typescript
import { exportToEnvironment } from 'anthropic-oauth';

// Call at app startup
await Effect.runPromise(exportToEnvironment());
```

### OpenCode not picking up credentials

**Solution:** Run `bun run sync` after each login to push credentials to
`~/.local/share/opencode/auth.json`. Make sure OpenCode is pinned to v1.2.27
(see [docs/VERSION_DOWNGRADE.md](./docs/VERSION_DOWNGRADE.md)).

## Resources

- [Architecture Documentation](./docs/ARCHITECTURE.md) - Complete system design with diagrams
- [Setup Guide](./docs/SETUP_SUMMARY.md) - Initial configuration
- [OpenCode Integration](./docs/OPENCODE_INTEGRATION.md) - Detailed usage guide
- [Version Downgrade Guide](./docs/VERSION_DOWNGRADE.md) - Pinning OpenCode to v1.2.27
- [Bun Documentation](https://bun.sh/docs)
- [Effect-TS Documentation](https://effect.website)
- [Conventional Commits](https://www.conventionalcommits.org)

## License

MIT

## Contributing

1. Follow conventional commits
2. Run `bun run lint` before committing
3. Use Bun APIs only (no Node.js)
4. Follow Effect-TS patterns

See [.opencode/rules.md](./.opencode/rules.md) for coding standards.
