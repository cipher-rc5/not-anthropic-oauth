# PRODUCTION_READY

All export * statements replaced with explicit named exports:

- errors.ts — 7 error classes
- opencode.ts — 6 functions + OpenCodeConfig interface (type-only)
- service.ts — 6 functions + AuthorizationRequest interface (type-only)
- types.ts — 3 values/constants + 7 types (type-only)
  ▣ Build · claude-sonnet-4-6 · 20.3s
  conduct a critical higher level technical analysis provide me a score 1-10 for how close this codebase is to production grade
  │ Task Analyze codebase for production readiness
  └ 20 toolcalls · 1m 0s
  ctrl+x down view subagents
  │ Task Deep codebase exploration
  └ 53 toolcalls · 3m 46s
  ctrl+x down view subagents
  Here is the analysis:

---
Production Readiness: 6.5 / 10
---

## What's strongType safety (9/10)The tsconfig.json is at maximum strictness — noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, noUncheckedSideEffectImports (TS 6 flag). No any casts found in source. Discriminated union on Credentials is clean.Error modeling (8/10)Effect-TS Data.TaggedError for all 7 error types gives typed, exhaustive error handling. Error propagation through the entire call stack is explicit and visible in return types.Concurrent token refresh (8/10)The module-level refreshInFlight: Promise | null mutex in client.ts correctly serializes concurrent refreshes. This is a non-obvious race condition that many production libraries get wrong.Test coverage (7.5/10)100 tests across all 8 modules. The client.test.ts concurrent mutex test is particularly good. Temp HOME isolation prevents test pollution. Retry exhaustion, corrupt JSON, and idempotency cases are covered.Documentation (8/10)Extensive docs/ with Mermaid architecture diagrams, OAuth patch rationale, and integration guides. .opencode/rules.md documents conventions comprehensively.

## What's weakNot publishable as a library (critical)No exports field in package.json, no main, no types, no build step to strip .ts extensions for consumers. The allowImportingTsExtensions + direct .ts imports means this only works under Bun. Any npm consumer would get broken imports.Credential leak in tracked file.opencode/config.json contains a live (though likely expired) OAuth token and is not gitignored at the repo root level. The .opencode/.gitignore ignores only node_modules/package.json/bun.lock, not config.json. This token has been committed.process.env used directly everywhereThe .opencode/rules.md explicitly says "no direct process.env — use Effect Config module", but types.ts, client.ts, opencode.ts, and plugin.ts all call process.env[...] directly. The codified standard is not followed.Unused dependency@effect/platform 0.96.0 is in dependencies but is not imported anywhere in the source. Dead weight that inflates the install footprint.No CI/CDZero .github/workflows/ or equivalent. There is no automated gate that runs bun test or bun run lint on PRs. The entire quality enforcement is manual/honor-system.Schema not used at API boundariesThe rules mandate Schema.decodeUnknown at external boundaries, but token.ts uses hand-rolled isTokenResponse/isApiKeyResponse type guards instead. Fine as a workaround, but inconsistent with the stated architecture.Body transform hardcodes string literalsclient.ts:transformBody replaces "OpenCode" → "Claude Code" via substring matching. This is fragile string munging rather than a proper transform layer.bin/sync-to-opencode.ts reads raw JSON without validationReads auth.json with JSON.parse and casts directly without using isCredentials or any schema. One malformed file breaks the entire sync silently.No token expiry on loadstore.ts:loadCredentials returns credentials as-is. The first check for expiry happens in client.ts:ensureFreshToken. If credentials are loaded via getStoredCredentials in user code (e.g. checkCredentialValidity), the caller is responsible for expiry checking — there is no single enforcement point.

Score breakdown
Dimension	Score
Type safety	9
Error handling	8
Test coverage	7.5
Security	5 (credential leak, no token validation at load)
Publishability / packaging	3 (no build pipeline, Bun-only)
CI/CD & automation	2
Architecture consistency	6 (rules not followed re: Config, Schema)
Dependencies	7 (one unused dep, pinned versions are good)
Overall: 6.5/10 — Solid internal tooling / prototype quality. The core OAuth logic is well-implemented and the type system usage is above average. The gap to production is primarily packaging, the credential leak, missing CI, and the delta between documented conventions and actual code.
