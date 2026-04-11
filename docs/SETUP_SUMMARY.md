# Anthropic OAuth - Setup Summary

> **Platform notice**: Tested and confirmed working on **macOS** with **OpenCode v1.2.27**.
> See [VERSION_DOWNGRADE.md](./VERSION_DOWNGRADE.md) for instructions on pinning to that version.

## Completed Setup

Your Bun + Effect-TS codebase is configured with strict type safety and modern tooling.

### Configuration Files

- **tsconfig.json** - ESNext target, TypeScript 6.0, all strict safety flags enabled
- **dprint.json** - Code formatting (single quotes, semicolons, 2-space indent)
- **.opencode/rules.md** - OpenCode AI coding standards for Bun + Effect
- **.gitmessage** - Conventional commit message template
- **.gitignore** - Comprehensive ignore rules for Bun projects

### Code Quality

**Type Safety**: All strict TypeScript flags enabled

- `noUncheckedIndexedAccess` - Array access returns `T | undefined`
- `noUncheckedSideEffectImports` - Catches typos in side-effect-only imports
- `exactOptionalPropertyTypes` - Strict optional property handling
- `noImplicitReturns` - All code paths must return
- `noPropertyAccessFromIndexSignature` - Use bracket notation for index signatures

**Bun-Only APIs**: No Node.js dependencies

- File I/O uses `Bun.file()` and `Bun.write()`
- Shell commands use `Bun.$`
- Environment variables via `process.env['VAR']`

**Effect-TS Patterns**: Functional error handling

- All errors extend `Data.TaggedError`
- Async operations use `Effect.gen`
- No raw Promises (wrapped with `Effect.tryPromise`)

### Available Scripts

```bash
# Development
bun run dev              # Run interactive CLI
bun run sync             # Sync credentials to OpenCode

# Build
bun run build            # Bundle src/index.ts to dist/ (target: bun)

# Code Quality
bun run typecheck        # Type checking — TypeScript 6.0 (no emit)
bun run format           # Format all files with dprint
bun run format:check     # Check formatting without changes
bun run lint             # Run typecheck + format check
bun run ci               # Full CI gate: lint + test + build
```

### File Header Template

All `.ts` files include this header:

```typescript
// file: {relative_path}
// description: {one_line_description}
// reference: {related_files_or_docs}
```

### Git Workflow

1. Make changes to TypeScript files
2. Run `bun run lint` to validate
3. Run `bun run format` to auto-format
4. Commit with conventional commit message

**Commit Types**:

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style (no logic change)
- `refactor` - Code refactoring
- `test` - Tests
- `chore` - Maintenance
- `perf` - Performance

**Example Commit**:

```
feat(auth): add token refresh logic

Implement automatic token refresh before expiry.
Tokens refresh on the next request after expiration.
```

### Project Structure

```
anthropic-oauth/
├── bin/
│   ├── cli.ts                  # Interactive CLI
│   └── sync-to-opencode.ts     # OpenCode credential sync
├── src/
│   ├── types.ts                # Domain types, constants, env helpers
│   ├── errors.ts               # Tagged error definitions (8 classes)
│   ├── pkce.ts                 # PKCE challenge generation
│   ├── token.ts                # OAuth token operations
│   ├── store.ts                # Credential storage (Bun APIs)
│   ├── cch.ts                  # Content Consistency Hashing (billing header)
│   ├── utils.ts                # Header merging, URL rewriting, stream stripping
│   ├── client.ts               # Authenticated fetch client
│   ├── service.ts              # High-level service API
│   ├── opencode.ts             # OpenCode integration helpers
│   ├── plugin.ts               # OpenCode server plugin + legacy fetch patcher
│   └── index.ts                # Public exports
├── tests/                      # Bun test suite
├── examples/                   # Usage examples
├── docs/                       # Documentation
├── .opencode/
│   └── rules.md                # OpenCode AI standards
├── tsconfig.json               # TypeScript 6.0 configuration
├── dprint.json                 # Formatting rules
├── .gitmessage                 # Commit template
└── package.json                # Bun package config (engines: bun >=1.3.12)
```

### Key Conventions

**TypeScript**:

- Target: ESNext (TypeScript 6.0.2)
- Module: ESNext
- No `any` types (use `unknown` with type guards or `Schema.decodeUnknown`)
- All imports use `.ts` extension

**Code Style**:

- Single quotes for strings
- Semicolons required
- Trailing commas everywhere
- 120 character line width

**Effect Patterns**:

```typescript
// Tagged errors
class MyError extends Data.TaggedError('MyError')<{ readonly message: string }> {}

// Effect composition
const program = Effect.gen(function*() {
  const result = yield* someEffect;
  return result;
});

// Run effects
await Effect.runPromise(program);
```

### Next Steps

1. Explore the CLI: `bun run dev`
2. Sync credentials to OpenCode: `bun run sync`
3. Review `.opencode/rules.md` for AI coding standards
4. Check `src/` files to see the patterns in action

### Resources

- Bun Documentation: https://bun.sh/docs
- Effect-TS Documentation: https://effect.website
- Conventional Commits: https://www.conventionalcommits.org
- OpenCode Rules: https://opencode.ai/docs/rules/

---

**Status**: All type checks pass, code formatted, git initialized
**Runtime**: Bun only (no Node.js)
**TypeScript**: ESNext strict mode (TypeScript 6.0.2)
**Error Handling**: Effect-TS with tagged errors
**Tested On**: macOS with OpenCode v1.2.27
