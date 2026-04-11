# PRODUCTION_READY

All export `*` statements replaced with explicit named exports:

- `errors.ts` — 8 error classes: `PkceGenerationError`, `AuthorizationUrlError`, `TokenExchangeError`, `TokenRefreshError`, `ApiKeyCreationError`, `StorageError`, `InvalidCredentialsError`, `NetworkError`
- `opencode.ts` — 6 functions + `OpenCodeConfig` interface (type-only): `checkCredentialValidity`, `exportToEnvironment`, `generateOpenCodeConfigFile`, `getDefaultModel`, `getOpenCodeConfig`, `writeOpenCodeConfig`
- `service.ts` — 6 functions + `AuthorizationRequest` interface (type-only): `beginOAuth`, `completeApiKeyLogin`, `completeOAuthLogin`, `getStoredCredentials`, `logout`, `saveApiKey`
- `types.ts` — 3 values/constants + 7 types (type-only)
- `plugin.ts` — default export `AnthropicOAuthPlugin` (OpenCode server plugin) + deprecated `AnthropicUserAgentPlugin`
- `client.ts` — `authenticatedFetch` + `AuthenticatedFetchOptions` type
- `store.ts` — `isCredentials` type guard

---

Production Readiness: 6.5 / 10

## What's strong

**Type safety (9/10)**: The tsconfig.json is at maximum strictness — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports` (TS 6 flag). No `any` casts found in source. Discriminated union on `Credentials` is clean.

**Error modeling (8/10)**: Effect-TS `Data.TaggedError` for all 8 error types gives typed, exhaustive error handling. Error propagation through the entire call stack is explicit and visible in return types.

**Concurrent token refresh (8/10)**: The module-level `refreshInFlight: Promise<OAuthCredentials> | null` mutex in `client.ts` correctly serializes concurrent refreshes. This is a non-obvious race condition that many production libraries get wrong.

**Test coverage (7.5/10)**: Tests across all modules. The `client.test.ts` concurrent mutex test is particularly good. Temp `HOME` isolation prevents test pollution. Retry exhaustion, corrupt JSON, and idempotency cases are covered.

**Documentation (8/10)**: Extensive `docs/` with Mermaid architecture diagrams, OAuth patch rationale, and integration guides. `.opencode/rules.md` documents conventions comprehensively.

## What's weak

**Not publishable as a library (critical)**: The `allowImportingTsExtensions` + direct `.ts` imports means this only works under Bun without a build step for consumers on other runtimes. The `exports` field is present (`"."`, `"./server"`, `"./plugin"`) but all entries point to `.ts` source files. An npm consumer would get broken imports without Bun or a transpile step.

**`process.env` used directly everywhere**: The `.opencode/rules.md` explicitly says "no direct `process.env` — use Effect Config module", but `types.ts`, `client.ts`, `opencode.ts`, and `plugin.ts` all call `process.env[...]` directly. The codified standard is not followed.

**No CI/CD**: Zero `.github/workflows/` or equivalent. There is no automated gate that runs `bun test` or `bun run lint` on PRs. The entire quality enforcement is manual/honor-system.

**Schema not used at API boundaries**: The rules mandate `Schema.decodeUnknown` at external boundaries, but `token.ts` uses hand-rolled `isTokenResponse`/`isApiKeyResponse` type guards instead. Fine as a workaround, but inconsistent with the stated architecture.

**Body transform hardcodes string literals**: `client.ts:transformBody` performs OpenCode identity detection and replacement via substring/regex matching. This is a deliberate design choice (fast, zero-dependency) but fragile if Anthropic's system prompt format changes.

**No token expiry enforcement on load**: `store.ts:loadCredentials` returns credentials as-is (logging a warning when expired). The first expiry check happens in `client.ts:ensureFreshToken`. If credentials are loaded via `getStoredCredentials` in user code (e.g. `checkCredentialValidity`), callers see the raw expired token.

## Score breakdown

| Dimension                      | Score |
| ------------------------------ | ----- |
| Type safety                    | 9     |
| Error handling                 | 8     |
| Test coverage                  | 7.5   |
| Security                       | 6     |
| Publishability / packaging     | 4     |
| CI/CD & automation             | 2     |
| Architecture consistency       | 6     |
| Dependencies                   | 8     |

**Overall: 6.5/10** — Solid internal tooling / prototype quality. The core OAuth logic is well-implemented and the type system usage is above average. The gap to production is primarily packaging, missing CI, and the delta between documented conventions and actual code.
