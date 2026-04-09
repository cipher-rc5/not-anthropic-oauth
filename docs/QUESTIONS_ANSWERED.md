# Questions Answered

## Q1: How are credentials passed to OpenCode?

[OK] **SOLVED**: Credentials are **automatically exported** after successful login.

### What Happens

After any login method (OAuth/Console/Manual API key):

1. Credentials saved to `~/.config/anthropic-oauth/credentials.json`
2. Automatically exported to environment variables:
   - `ANTHROPIC_API_KEY` - The access token or API key
   - `OPENCODE_PROVIDER` - Set to `"anthropic"`
   - `OPENCODE_MODEL` - Set to `"claude-sonnet-4-20250514"`

### Example Output

```
[OK] Login successful. Credentials saved.
Type    : oauth
Status  : [OK] Valid (expires in 14400s)

[OK] Credentials exported to environment:
   ANTHROPIC_API_KEY=sk-ant-oat01...
   OPENCODE_PROVIDER=anthropic
   OPENCODE_MODEL=claude-sonnet-4-20250514
```

### Usage in Code

```typescript
import { exportToEnvironment } from 'anthropic-oauth';

// Export credentials for OpenCode
await Effect.runPromise(exportToEnvironment());

// Now accessible via process.env
const apiKey = process.env['ANTHROPIC_API_KEY'];
```

See [OPENCODE_USAGE.md](./OPENCODE_USAGE.md) for detailed integration examples.

---

## Q2: Are credentials expiring immediately?

[OK] **ANSWERED**: No! The timestamp shows **when it will expire** (future time).

### Understanding the Output

```
Expires : 2026-03-20T15:23:20.950Z
Status  : [OK] Valid (expires in 14400s)
```

**This means:**

- Token expires **AT** 2026-03-20T15:23:20.950Z (future timestamp)
- Currently **VALID** for the next 14400 seconds (4 hours)
- Not expired, not expiring immediately

### How Expiration Works

1. **API returns**: `expires_in: 14400` (seconds)
2. **We calculate**: `Date.now() + 14400 * 1000` = future timestamp
3. **We display**: ISO string of that future timestamp

### Token Lifecycle

```
Login ──► Valid for 4 hours ──► Auto-refresh ──► Valid for 4 more hours
         └─ 2026-03-20T11:23    └─ Before expiry   └─ New token
```

### Checking Token Status

Use CLI option `4` to see current status:

```
Type    : oauth
Expires : 2026-03-20T15:23:20.950Z
Status  : [OK] Valid (expires in 14400s)

[INFO]  Token will expire in 240 minutes
```

If you see `[ERROR] EXPIRED`, the token has passed its expiration time and needs refresh.

### Automatic Refresh

The `authenticatedFetch` function automatically refreshes tokens before they expire:

```typescript
// This handles token refresh automatically
const response = await Effect.runPromise(
  authenticatedFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({/* ... */}) })
);
```

**You don't need to manually refresh** - it's handled automatically!

---

## Summary

| Question                                 | Answer                                                          |
| ---------------------------------------- | --------------------------------------------------------------- |
| **How to pass credentials to OpenCode?** | Auto-exported to `process.env['ANTHROPIC_API_KEY']` after login |
| **Are tokens expiring immediately?**     | No! Timestamp is FUTURE expiration (4 hours from login)         |
| **How to refresh tokens?**               | Automatic via `authenticatedFetch()`                            |
| **How to check validity?**               | CLI option 4 or `checkCredentialValidity()`                     |

---

## Examples

- [Simple Chat](../examples/simple-chat.ts) - Basic usage with validity check
- [Multi-turn Chat](../examples/multi-turn-chat.ts) - Conversation with auto-refresh
- [OpenCode Export](../examples/opencode-export.ts) - Full credential export demo

Run any example:

```bash
bun run examples/simple-chat.ts
bun run examples/opencode-export.ts
```
