# OpenCode Rules - Anthropic OAuth

## Runtime & Package Manager

**Strictly use Bun runtime and APIs**:

- Use `Bun.*` APIs instead of Node.js equivalents
- Package management: `bun install`, `bun add`, `bun remove`
- Script execution: `bun run <script>`
- Never use `npm`, `yarn`, `pnpm`, or Node.js-specific APIs

---

## TypeScript Standards

**ESNext with strict type safety**:

> **TypeScript version**: This project uses TypeScript 6.0.2 (installed as a devDependency).
> `ESNext` target, `noUncheckedSideEffectImports`, and removal of `esModuleInterop: false`
> are all supported and required. Do not downgrade these settings.

- Target: ESNext, Module: ESNext
- All files must use `.ts` extension
- Use explicit TypeScript imports (no `.js` in import paths, rely on `allowImportingTsExtensions`)
- Enable all strict compiler options including `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`, and `verbatimModuleSyntax`
- No `any` types - use `Schema.decodeUnknown` at boundaries, discriminated unions internally
- No raw type assertions (`as Foo`) - use `Schema` constructors or brand constructors only
- Array access returns `T | undefined` (via `noUncheckedIndexedAccess`)
- `"types": ["bun-types"]` must be explicit — TS 6.0 defaults `types` to `[]` (no auto-discovery)
- `esModuleInterop: false` is deprecated in TS 6.0 and must not be set

**Recommended `tsconfig.json` compiler options**:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext", "DOM"],
    "moduleResolution": "bundler",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noUncheckedSideEffectImports": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "types": ["bun-types"],
    "noEmit": true
  }
}
```

**File header template** (required on all `.ts` files):

```typescript
// file: {relative_path_from_project_root}
// description: {one_line_description}
// reference: {related_files_or_external_docs}
```

---

## Effect-TS Patterns

**Core principles**:

- Use `Effect<A, E, R>` for all effectful operations
- Errors extend `Data.TaggedError` for typed error handling
- Services use `Effect.Tag` pattern for dependency injection
- Compose with `Effect.gen` for readable async flows
- Layer composition for resource management

**Tagged errors**:

```typescript
import { Data } from 'effect';

export class ParseError extends Data.TaggedError('ParseError')<{ readonly message: string, readonly cause: unknown }> {}

export class NetworkError extends Data.TaggedError('NetworkError')<{ readonly url: string, readonly status: number }> {}
```

**Services**:

```typescript
import { Effect } from 'effect';

class MyService
  extends Effect.Tag('MyService')<
    MyService,
    { readonly doSomething: (input: string) => Effect.Effect<string, MyError> }
  >() {}
```

**Effect composition**:

```typescript
const program = Effect.gen(function*() {
  const service = yield* MyService;
  const result = yield* service.doSomething('input');
  return result;
});
```

**Schema for boundary validation** (replaces `unknown` + manual type guards):

Use `Schema` at all external boundaries — API responses, WebSocket frames, file I/O, env vars. After decoding, types are fully guaranteed downstream; `unknown` never propagates into business logic.

```typescript
import { Schema } from 'effect';

const MarketEvent = Schema.Struct({
  id: Schema.String,
  outcome: Schema.Literal('yes', 'no'),
  price: Schema.Number.pipe(Schema.between(0, 1))
});

type MarketEvent = Schema.Schema.Type<typeof MarketEvent>;

const decode = Schema.decodeUnknown(MarketEvent);

const result = decode(raw_payload).pipe(
  Effect.mapError((e) => new ParseError({ message: 'invalid market event', cause: e }))
);
```

**Branded types for domain primitives**:

Use `Schema.brand` to prevent mixing structurally identical types (e.g. `Price` vs `Probability`, both `number`):

```typescript
import { Schema } from 'effect';

const Price = Schema.Number.pipe(Schema.between(0, 1), Schema.brand('Price'));
const Probability = Schema.Number.pipe(Schema.brand('Probability'));

type Price = Schema.Schema.Type<typeof Price>;
type Probability = Schema.Schema.Type<typeof Probability>;
```

**Discriminated unions for internal state**:

Never use `unknown` for data you fully control. Model it explicitly and get exhaustiveness checking via `Match`:

```typescript
import { Match, Schema } from 'effect';

const OracleResult = Schema.Union(
  Schema.TaggedStruct('ok', { price: Price, source: Schema.String }),
  Schema.TaggedStruct('stale', { last_updated: Schema.Number }),
  Schema.TaggedStruct('error', { reason: Schema.String })
);

type OracleResult = Schema.Schema.Type<typeof OracleResult>;

const handle = (result: OracleResult) =>
  Match.value(result).pipe(
    Match.tag('ok', ({ price }) => Effect.succeed(price)),
    Match.tag('stale', ({ last_updated }) => Effect.fail(new StaleError({ last_updated }))),
    Match.tag('error', ({ reason }) => Effect.fail(new OracleError({ reason }))),
    Match.exhaustive
  );
```

**Config/env vars** via the `Config` module — never read `process.env` directly:

```typescript
import { Config, Effect } from 'effect';

const program = Effect.gen(function*() {
  const api_key = yield* Config.string('API_KEY');
  const port = yield* Config.number('PORT').pipe(Config.withDefault(3000));
  return { api_key, port };
});
```

**Avoid**:

- No `Promise` unless interfacing with external libraries
- No `try/catch` - use `Effect.tryPromise` or `Effect.try`
- No callbacks - convert to `Effect` with `Effect.async`
- No `Schema.decodeUnsafeSync` at runtime boundaries - use `Schema.decodeUnknown` so errors surface in the Effect error channel
- R type is covariant union, not intersection

---

## Code Style

**Formatting with dprint**:

- Single quotes for strings
- Semicolons required
- Trailing commas everywhere
- 2-space indentation
- 120 character line width
- Run `bun run format` before commits

**Naming conventions**:

- PascalCase: Types, Interfaces, Classes, Effect Tags, Schema definitions
- snake_case: Functions, variables, parameters, object properties
- SCREAMING_SNAKE_CASE: Constants
- Prefix private fields with `_` (if needed)

---

## Project Structure

```
src/
  ├── types.ts       # Domain types and constants
  ├── errors.ts      # Tagged error definitions
  ├── pkce.ts        # PKCE challenge generation
  ├── token.ts       # OAuth token operations
  ├── store.ts       # Credential persistence
  ├── client.ts      # Authenticated HTTP client
  ├── service.ts     # High-level service API
  ├── opencode.ts    # OpenCode integration helpers
  ├── plugin.ts      # Global fetch user-agent plugin
  └── index.ts       # Public API surface
bin/               # Executable scripts
```

---

## Import Organization

**Order** (separated by blank lines):

1. Bun imports (if any)
2. `effect` core imports
3. Third-party libraries
4. Local imports (relative paths)

**Example**:

```typescript
import { Config, Data, Effect, Layer, Match, Schema } from 'effect';

import { MyService } from './service.ts';
import type { MyType } from './types.ts';
```

---

## Git Commit Messages

**Follow Conventional Commits specification**:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code change that neither fixes bug nor adds feature
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (deps, config, etc.)

**Examples**:

```
feat(auth): add OAuth token refresh logic

Implement automatic token refresh before expiry using Effect.schedule.
Tokens are refreshed 5 minutes before expiration.

Closes #123
```

```
fix(pkce): correct base64url encoding for challenge

The previous implementation did not properly handle padding removal.
Now uses Bun built-in crypto for spec-compliant PKCE.
```

---

## Type Checking

**Run before every commit**:

```bash
bun run typecheck
```

This executes `bun tsc --noEmit` to validate type safety without emitting files.

---

## Testing Philosophy

- Prefer Effect's `TestClock` and `TestRandom` for deterministic tests
- Use layers for test dependency injection
- Mock external services with test layer implementations
- Test error cases explicitly — Effect makes this natural
- Use `Schema` test fixtures to generate valid typed inputs at boundaries

---

## Performance Guidelines

- Use Bun native APIs (faster than polyfills)
- Leverage Effect request batching and caching
- Prefer `Effect.gen` over deeply nested pipes for readability
- Use `Layer.memoize` for expensive resource initialization
- Profile with `bun:test` built-in benchmarking

---

## What NOT to Do

- Node.js APIs (`process.env` direct access, `fs`, `path` from `node:*`)
- CommonJS (`require`, `module.exports`)
- `any` types
- Raw type assertions (`as Foo`) outside of Schema/brand constructors
- `unknown` propagating beyond the decoding boundary — decode immediately with `Schema.decodeUnknown`
- `Schema.decodeUnsafeSync` at runtime boundaries — errors must surface in the Effect error channel
- Untyped errors (`throw new Error(...)`) — use `Data.TaggedError`
- Promises without Effect wrapper
- `try/catch` blocks — use `Effect.try` or `Effect.tryPromise`
- Non-conventional commit messages
- Code without file headers
- Reading env vars via `process.env` — use the `Config` module
- Emojis in code or console output — use text prefixes: `[OK]`, `[ERROR]`, `[WARN]`, `[INFO]`
- Displaying more than 20 characters of API keys or secrets

---

## References

- Bun documentation: https://bun.sh/docs
- Effect-TS documentation: https://effect.website
- Effect Schema: https://effect.website/docs/schema/introduction
- Conventional Commits: https://www.conventionalcommits.org
