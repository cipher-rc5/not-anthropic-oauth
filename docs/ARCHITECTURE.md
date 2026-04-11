# Architecture Documentation

This document provides a comprehensive overview of the anthropic-oauth library architecture, including system design, data flow, and component interactions.

> **Platform notice**: Tested and confirmed working on **macOS** with **OpenCode v1.2.27**.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [OAuth Flow](#oauth-flow)
3. [Token Lifecycle](#token-lifecycle)
4. [Request Pipeline](#request-pipeline)
5. [Error Handling](#error-handling)
6. [OpenCode Integration](#opencode-integration)

---

## System Architecture

### High-Level Component Diagram

```mermaid
graph TB
    subgraph "User Interface"
        CLI[Interactive CLI<br/>bin/cli.ts]
        Sync[OpenCode Sync<br/>bin/sync-to-opencode.ts]
    end

    subgraph "Service Layer"
        Service[Service API<br/>src/service.ts]
    end

    subgraph "Core Modules"
        Client[Authenticated Client<br/>src/client.ts]
        Token[Token Operations<br/>src/token.ts]
        Store[Credential Store<br/>src/store.ts]
        PKCE[PKCE Generator<br/>src/pkce.ts]
        Plugin[OpenCode Plugin<br/>src/plugin.ts]
    end

    subgraph "Utilities"
        CCH[CCH Billing Header<br/>src/cch.ts]
        Utils[Shared Utilities<br/>src/utils.ts]
    end

    subgraph "Domain"
        Types[Types & Constants<br/>src/types.ts]
        Errors[Tagged Errors<br/>src/errors.ts]
    end

    subgraph "External Systems"
        Anthropic[Anthropic OAuth API<br/>platform.claude.com]
        OpenCode[OpenCode<br/>~/.local/share/opencode]
        FileSystem[File System<br/>~/.config/anthropic-oauth]
    end

    CLI --> Service
    Sync --> Store
    Service --> Client
    Service --> Token
    Service --> Store
    Client --> Token
    Client --> Store
    Client --> CCH
    Client --> Utils
    Plugin --> Utils
    Token --> Anthropic
    Store --> FileSystem
    Sync --> OpenCode
    Client --> Types
    Client --> Errors
    Token --> Types
    Token --> Errors
    Store --> Types
    Store --> Errors
    CCH --> Types
    Utils --> Types

    style CLI fill:#e1f5ff
    style Sync fill:#e1f5ff
    style Service fill:#fff4e1
    style Client fill:#f0f0f0
    style Token fill:#f0f0f0
    style Store fill:#f0f0f0
    style PKCE fill:#f0f0f0
    style Plugin fill:#f0f0f0
    style CCH fill:#f5f0ff
    style Utils fill:#f5f0ff
    style Types fill:#e8f5e9
    style Errors fill:#e8f5e9
    style Anthropic fill:#ffebee
    style OpenCode fill:#ffebee
    style FileSystem fill:#ffebee
```

### Module Responsibilities

| Module                | Responsibility                          | Dependencies                      |
| --------------------- | --------------------------------------- | --------------------------------- |
| `cli.ts`              | Interactive user interface              | service, Effect                   |
| `sync-to-opencode.ts` | Sync credentials to OpenCode            | store, Effect                     |
| `service.ts`          | High-level API facade                   | client, token, store              |
| `client.ts`           | Authenticated HTTP requests             | token, store, cch, utils, types, errors |
| `token.ts`            | OAuth token operations                  | types, errors                     |
| `store.ts`            | Credential persistence                  | types, errors, Bun.file           |
| `pkce.ts`             | PKCE challenge generation               | @openauthjs/openauth              |
| `plugin.ts`           | OpenCode server plugin & fetch patcher  | utils, types                      |
| `cch.ts`              | Content Consistency Hashing (billing header) | types                        |
| `utils.ts`            | Header merging, URL rewriting, stream stripping | types                     |
| `types.ts`            | Domain types & constants                | -                                 |
| `errors.ts`           | Tagged error definitions                | Effect.Data                       |

---

## OAuth Flow

### Complete OAuth Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI
    participant Service
    participant Token
    participant PKCE
    participant Browser
    participant Anthropic as Anthropic OAuth<br/>platform.claude.com

    User->>CLI: Choose OAuth login (option 1 or 2)
    CLI->>Service: beginOAuth(mode)
    Service->>PKCE: generateChallenge()
    PKCE-->>Service: {verifier, challenge}
    
    Service->>Service: Build authorization URL<br/>client_id, challenge, scope, redirect_uri
    Service-->>CLI: {url, verifier}
    
    CLI->>User: Display OAuth URL
    User->>Browser: Open URL
    Browser->>Anthropic: GET /oauth/authorize
    
    Anthropic->>Browser: Show consent page
    User->>Browser: Click "Authorize"
    Browser->>Anthropic: POST /oauth/authorize
    
    Anthropic-->>Browser: Redirect with code
    Browser-->>User: Display authorization code
    
    User->>CLI: Paste code
    
    alt OAuth Token (mode: max)
        CLI->>Service: completeOAuthLogin(code, verifier)
        Service->>Token: exchangeCode(code, verifier)
        Token->>Anthropic: POST /v1/oauth/token<br/>Content-Type: application/x-www-form-urlencoded<br/>User-Agent: claude-cli/2.1.87 (external, cli)
        Anthropic-->>Token: {access_token, refresh_token, expires_in}
        Token-->>Service: OAuthCredentials
    else API Key (mode: console)
        CLI->>Service: completeApiKeyLogin(code, verifier)
        Service->>Token: exchangeCode(code, verifier)
        Token->>Anthropic: POST /v1/oauth/token
        Anthropic-->>Token: {access_token, refresh_token}
        Token->>Token: createApiKey(access_token)
        Token->>Anthropic: POST /api/oauth/claude_cli/create_api_key<br/>(api.anthropic.com)
        Anthropic-->>Token: {raw_key}
        Token-->>Service: ApiKeyCredentials
    end
    
    Service->>Store: saveCredentials(credentials)
    Store-->>Service: Success
    Service-->>CLI: Credentials
    CLI-->>User: Login successful
```

### OAuth Authorization URL Structure

```mermaid
graph LR
    BaseMax["max mode: https://claude.ai/oauth/authorize"] --> ClientID[?client_id=9d1c250a...]
    BaseConsole["console mode: https://platform.claude.com/oauth/authorize"] --> ClientID
    ClientID --> ResponseType[&response_type=code]
    ResponseType --> Challenge[&code_challenge=...]
    Challenge --> Method[&code_challenge_method=S256]
    Method --> Redirect["&redirect_uri=https://platform.claude.com/oauth/code/callback"]
    Redirect --> Scope[&scope=user:profile...]
    
    style BaseMax fill:#e3f2fd
    style BaseConsole fill:#e3f2fd
    style Scope fill:#e3f2fd
```

---

## Token Lifecycle

### Token States and Transitions

```mermaid
stateDiagram-v2
    [*] --> NoCredentials: Initial State
    
    NoCredentials --> OAuthLogin: User chooses OAuth
    NoCredentials --> ApiKeyLogin: User chooses API Key
    NoCredentials --> ManualKey: User enters key manually
    
    OAuthLogin --> ValidToken: Exchange code<br/>for tokens
    ApiKeyLogin --> ValidApiKey: Exchange code<br/>for API key
    ManualKey --> ValidApiKey: Save key
    
    ValidToken --> TokenExpiring: Time passes<br/>(< 5min until expiry)
    TokenExpiring --> Refreshing: Auto-refresh triggered
    Refreshing --> ValidToken: Refresh success
    Refreshing --> Expired: Refresh failed
    
    ValidToken --> Expired: Time passes<br/>(> expiry time)
    Expired --> NoCredentials: User logs out
    
    ValidApiKey --> [*]: Permanent<br/>(no expiry)
    
    ValidToken --> NoCredentials: User logs out
    ValidApiKey --> NoCredentials: User logs out
    
    note right of ValidToken
        OAuth Token
        - Expires in ~4 hours
        - Auto-refreshes
        - Stored in ~/.config/anthropic-oauth
    end note
    
    note right of ValidApiKey
        API Key
        - No expiration
        - No refresh needed
        - Stored in ~/.config/anthropic-oauth
    end note
```

### Token Refresh Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant Client
    participant Store
    participant Token
    participant Anthropic

    App->>Client: authenticatedFetch(url, init)
    Client->>Store: loadCredentials (Effect value)
    Store-->>Client: OAuthCredentials
    
    Client->>Client: Check expiry<br/>expires > Date.now()?
    
    alt Token still valid
        Client->>Client: Use existing token
    else Token expired or expiring
        Client->>Token: refreshAccessToken(refresh_token)
        Token->>Anthropic: POST /v1/oauth/token<br/>grant_type=refresh_token<br/>User-Agent: claude-cli/2.1.87 (external, cli)
        Anthropic-->>Token: {access_token, refresh_token, expires_in}
        Token-->>Client: New OAuthCredentials
        Client->>Store: saveCredentials(new credentials)
        Store-->>Client: Success
    end
    
    Client->>Client: buildHeaders(credentials)<br/>+ transformBody() (OAuth only)<br/>+ rewriteOAuthUrl()
    Client->>Anthropic: fetch(url) with Bearer token<br/>(retry on 429, up to 3 attempts)
    Anthropic-->>Client: Response
    Client->>Client: createStrippedStream()<br/>(strip mcp_ from tool names, OAuth only)
    Client-->>App: Response
```

---

## Request Pipeline

### Authenticated Request Flow

```mermaid
flowchart TD
    Start([authenticatedFetch called]) --> LoadCreds[Load credentials<br/>from store]
    
    LoadCreds --> CheckCreds{Credentials<br/>exist?}
    CheckCreds -->|No| Error1[Fail: InvalidCredentialsError]
    CheckCreds -->|Yes| CheckType{Credential<br/>type?}
    
    CheckType -->|OAuth| CheckExpiry{Token<br/>expired?}
    CheckType -->|API Key| BuildHeaders
    
    CheckExpiry -->|Yes| Refresh[Refresh token<br/>ensureFreshToken]
    CheckExpiry -->|No| BuildHeaders[Build request headers<br/>Authorization + betas + user-agent]
    
    Refresh --> RefreshSuccess{Success?}
    RefreshSuccess -->|Yes| SaveNew[Save new credentials]
    RefreshSuccess -->|No| Error2[Fail: TokenRefreshError]
    
    SaveNew --> BuildHeaders
    
    BuildHeaders --> TransformBody{OAuth +<br/>string body?}
    TransformBody -->|Yes| Transform["Transform request body (transformBody):<br/>1. Compute CCH billing header<br/>2. Prepend Claude Code identity block<br/>3. Sanitize system prompt (remove OpenCode branding)<br/>4. Relocate extra system blocks to first user msg<br/>5. Prefix tool definitions with mcp_<br/>6. Prefix tool_use content blocks with mcp_"]
    TransformBody -->|No| RewriteURL
    
    Transform --> RewriteURL{OAuth?}
    RewriteURL -->|Yes| RewriteOAuth["rewriteOAuthUrl:<br/>- Override origin via ANTHROPIC_BASE_URL<br/>- Append ?beta=true to /v1/messages"]
    RewriteURL -->|No| Fetch
    
    RewriteOAuth --> Fetch["Execute fetch<br/>(429 retry loop: 3 attempts,<br/>Retry-After or 1s/2s backoff)"]
    Fetch --> CheckStatus{Response<br/>status 429?}
    CheckStatus -->|Yes, retry| Fetch
    CheckStatus -->|No or exhausted| StripStream{OAuth?}
    
    StripStream -->|Yes| Strip["createStrippedStream:<br/>strip mcp_ prefixes from<br/>tool names in response"]
    StripStream -->|No| Return
    Strip --> Return([Return Response])
    
    Error1 --> ErrorEnd([Effect.fail])
    Error2 --> ErrorEnd
    
    style Start fill:#e1f5ff
    style Return fill:#e1f5ff
    style ErrorEnd fill:#ffebee
    style LoadCreds fill:#f0f0f0
    style BuildHeaders fill:#f0f0f0
    style Transform fill:#fff4e1
    style RewriteOAuth fill:#fff4e1
    style Fetch fill:#f0f0f0
    style Strip fill:#f5f0ff
```

### Request Header Construction

```mermaid
graph TB
    Start[Input: HeadersInit + Credentials] --> CopyHeaders[Copy existing headers]
    
    CopyHeaders --> CheckType{Credential type?}
    
    CheckType -->|OAuth| SetBearer["Set authorization:<br/>Bearer token (lowercase key)"]
    CheckType -->|API Key| SetApiKey[Set x-api-key:<br/>API key]
    
    SetBearer --> DeleteApiKey[Delete x-api-key]
    SetApiKey --> DeleteBearer[Delete authorization]
    
    DeleteApiKey --> CheckVersion{Has anthropic-version?}
    DeleteBearer --> CheckVersion
    
    CheckVersion -->|No| SetVersion[Set anthropic-version:<br/>2023-06-01]
    CheckVersion -->|Yes| MergeBetas
    
    SetVersion --> MergeBetas["Merge anthropic-beta:<br/>oauth-2025-04-20,<br/>interleaved-thinking-2025-05-14"]
    
    MergeBetas --> SetUserAgent["Set user-agent:<br/>claude-cli/2.1.87 (external, cli)<br/>(or ANTHROPIC_USER_AGENT override)"]
    
    SetUserAgent --> Done[Return Headers]
    
    style Start fill:#e1f5ff
    style Done fill:#e1f5ff
    style SetBearer fill:#fff4e1
    style SetApiKey fill:#fff4e1
    style MergeBetas fill:#fff4e1
    style SetUserAgent fill:#fff4e1
```

---

## Error Handling

### Error Hierarchy

```mermaid
classDiagram
    class Data~TaggedError~ {
        <<Effect-TS>>
        +_tag: string
        +message: string
    }
    
    class StorageError {
        +_tag: "StorageError"
        +message: string
        +cause: unknown
    }
    
    class TokenExchangeError {
        +_tag: "TokenExchangeError"
        +status: number
        +body: string
    }
    
    class TokenRefreshError {
        +_tag: "TokenRefreshError"
        +status: number
        +body: string
    }
    
    class ApiKeyCreationError {
        +_tag: "ApiKeyCreationError"
        +status: number
        +body: string
    }
    
    class InvalidCredentialsError {
        +_tag: "InvalidCredentialsError"
        +message: string
    }

    class PkceGenerationError {
        +_tag: "PkceGenerationError"
        +cause: unknown
    }

    class AuthorizationUrlError {
        +_tag: "AuthorizationUrlError"
        +message: string
    }

    class NetworkError {
        +_tag: "NetworkError"
        +message: string
        +cause: unknown
    }
    
    Data~TaggedError~ <|-- StorageError
    Data~TaggedError~ <|-- TokenExchangeError
    Data~TaggedError~ <|-- TokenRefreshError
    Data~TaggedError~ <|-- ApiKeyCreationError
    Data~TaggedError~ <|-- InvalidCredentialsError
    Data~TaggedError~ <|-- PkceGenerationError
    Data~TaggedError~ <|-- AuthorizationUrlError
    Data~TaggedError~ <|-- NetworkError
```

### Error Handling Flow

```mermaid
flowchart TD
    Start[Function Call] --> Execute[Execute Effect]
    
    Execute --> Result{Success?}
    
    Result -->|Yes| Success[Return value]
    Result -->|No| CheckError{Error type?}
    
    CheckError -->|StorageError| HandleStorage[Log file system error<br/>Suggest checking permissions]
    CheckError -->|TokenExchangeError| HandleExchange[Log OAuth exchange failure<br/>Check code validity]
    CheckError -->|TokenRefreshError| HandleRefresh[Log refresh failure<br/>Suggest re-login]
    CheckError -->|ApiKeyCreationError| HandleApiKey[Log API key creation error<br/>Check account permissions]
    CheckError -->|InvalidCredentialsError| HandleInvalid[Log missing credentials<br/>Suggest login flow]
    CheckError -->|NetworkError| HandleNetwork[Log network failure<br/>Check connectivity]
    CheckError -->|PkceGenerationError| HandlePkce[Log PKCE error]
    CheckError -->|AuthorizationUrlError| HandleUrl[Log URL construction error]
    
    HandleStorage --> Propagate[Effect.fail with tagged error]
    HandleExchange --> Propagate
    HandleRefresh --> Propagate
    HandleApiKey --> Propagate
    HandleInvalid --> Propagate
    HandleNetwork --> Propagate
    HandlePkce --> Propagate
    HandleUrl --> Propagate
    
    Propagate --> Caller[Caller handles or propagates]
    
    style Start fill:#e1f5ff
    style Success fill:#e8f5e9
    style Propagate fill:#ffebee
    style Caller fill:#f0f0f0
```

---

## OpenCode Integration

### Credential Synchronization Flow

```mermaid
sequenceDiagram
    participant User
    participant Sync as sync-to-opencode.ts
    participant Store as Credential Store
    participant FS as File System
    participant OpenCode

    User->>Sync: bun run sync
    Sync->>Store: loadCredentials (Effect value)
    Store->>FS: Read ~/.config/anthropic-oauth/credentials.json
    FS-->>Store: JSON content
    Store-->>Sync: OAuthCredentials
    
    Sync->>Sync: Validate credentials type<br/>(must be OAuth)
    
    Sync->>FS: Read ~/.local/share/opencode/auth.json
    FS-->>Sync: Existing auth config
    
    Sync->>Sync: Merge credentials:<br/>existingAuth['anthropic'] = {<br/>  type: 'oauth',<br/>  access: token,<br/>  refresh: token,<br/>  expires: timestamp<br/>}
    
    Sync->>FS: Write updated auth.json
    FS-->>Sync: Success
    
    Sync-->>User: Display success message<br/>with token preview & expiry
    
    User->>OpenCode: Use Anthropic Claude
    OpenCode->>FS: Read ~/.local/share/opencode/auth.json
    FS-->>OpenCode: OAuth credentials
    OpenCode->>OpenCode: Use credentials for API calls
```

### Storage Locations

```mermaid
graph TB
    subgraph "anthropic-oauth Storage"
        Config[~/.config/anthropic-oauth/<br/>credentials.json]
        Format1["<br/>{<br/>  type: 'oauth',<br/>  access: 'sk-ant-oat01-...',<br/>  refresh: 'sk-ant-ort01-...',<br/>  expires: 1774104649219<br/>}<br/>"]
        Config --> Format1
    end
    
    subgraph "OpenCode Storage"
        OpenCodeAuth[~/.local/share/opencode/<br/>auth.json]
        Format2["<br/>{<br/>  anthropic: {<br/>    type: 'oauth',<br/>    access: 'sk-ant-oat01-...',<br/>    refresh: 'sk-ant-ort01-...',<br/>    expires: 1774104649219<br/>  },<br/>  openai: {...}<br/>}<br/>"]
        OpenCodeAuth --> Format2
    end
    
    Sync[sync-to-opencode.ts] --> Config
    Sync --> OpenCodeAuth
    
    style Config fill:#e1f5ff
    style OpenCodeAuth fill:#fff4e1
    style Sync fill:#e8f5e9
```

---

## Technology Stack

### Runtime & Language

```mermaid
graph LR
    subgraph "Runtime"
        Bun["Bun >=1.3.12"]
    end
    
    subgraph "Language"
        TS[TypeScript 6.0.2<br/>ESNext, Strict Mode]
    end
    
    subgraph "Core Libraries"
        Effect[Effect-TS 3.21.0<br/>Functional error handling]
    end
    
    subgraph "OAuth"
        OpenAuth[@openauthjs/openauth 0.4.3<br/>PKCE generation]
    end
    
    subgraph "External APIs"
        Anthropic["Anthropic OAuth API<br/>platform.claude.com (OAuth/token)<br/>api.anthropic.com (API key creation)"]
    end
    
    TS --> Bun
    Effect --> TS
    OpenAuth --> Effect
    Bun --> Anthropic
    
    style Bun fill:#e1f5ff
    style TS fill:#e1f5ff
    style Effect fill:#fff4e1
    style OpenAuth fill:#fff4e1
    style Anthropic fill:#ffebee
```

---

## Design Principles

### 1. Effect-Based Error Handling

All async operations return `Effect<Success, Error, Requirements>` for type-safe error propagation.

### 2. Tagged Errors

Errors extend `Data.TaggedError` for exhaustive pattern matching and clear error boundaries.

### 3. Bun-First Runtime

Uses Bun APIs exclusively (no Node.js dependencies) for maximum performance.

### 4. Immutable Data

All domain types are readonly, preventing accidental mutations.

### 5. Zero-Cost Abstractions

Effect-TS compiles to efficient JavaScript with minimal runtime overhead.

### 6. Single Responsibility

Each module has one clear purpose, making the codebase easy to navigate and maintain.

---

## Performance Considerations

### Credential Caching

- Credentials loaded once and cached in-memory (`credentialCache` in `store.ts`)
- Cache invalidated on write or clear
- File I/O only on first load, login, and logout

### Token Refresh Strategy

- Reactive refresh: triggered when token is expired at request time
- Single refresh per expiry window via `refreshInFlight` Promise mutex
- Prevents concurrent requests from each triggering a separate refresh

### Effect Optimization

- Lazy evaluation of Effect chains
- Automatic resource cleanup
- Minimal allocations for error cases

---

## Security Considerations

### Credential Storage

- OAuth tokens: `~/.config/anthropic-oauth/credentials.json`
- File permissions: `0600` (owner read/write only)
- Atomic write via temp file + rename (eliminates TOCTOU window)
- Never logged or exposed in error messages

### Token Exposure Prevention

- Display max 16 characters of tokens in UI
- Truncate tokens in logs: `sk-ant-oat01-...`
- Clear credentials on logout

### Request Security

- HTTPS-only communication
- PKCE flow for OAuth (prevents interception attacks)
- User-agent validation (prevents impersonation)

---

## Environment Variables

| Variable                        | Module        | Purpose                                                      |
| ------------------------------- | ------------- | ------------------------------------------------------------ |
| `ANTHROPIC_USER_AGENT`          | types.ts      | Override the default `claude-cli/2.1.87 (external, cli)` UA |
| `ANTHROPIC_CLIENT_ID`           | types.ts      | Override the default OAuth client ID                         |
| `ANTHROPIC_BASE_URL`            | types.ts      | Redirect all API requests to a proxy/alternative endpoint    |
| `ANTHROPIC_DEFAULT_MODEL`       | opencode.ts   | Override the default model (`claude-sonnet-4-20250514`)      |
| `OPENCODE_ANTHROPIC_USER_AGENT` | plugin.ts     | Override the Safari UA used by `AnthropicUserAgentPlugin`    |
| `EXPERIMENTAL_KEEP_SYSTEM_PROMPT` | types.ts    | Set `1`/`true` to skip relocating system blocks to user msg  |

---

## Future Enhancements

### Planned Features

1. **OpenCode Watch Mode**
   - Monitor credential changes
   - Auto-sync to OpenCode on update

2. **Multi-Account Support**
   - Store multiple OAuth profiles
   - Switch between accounts easily

3. **Automatic Token Refresh Scheduling**
   - Background process to refresh tokens 5 minutes before expiry
   - Prevents interactive re-authentication

---

## References

- [Effect-TS Documentation](https://effect.website)
- [Bun Documentation](https://bun.sh/docs)
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [Anthropic API Documentation](https://docs.anthropic.com)
