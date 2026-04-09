// file: src/errors.ts
// description: Tagged error types for the OAuth flow
// reference: effect-ts tagged error pattern

import { Data } from 'effect';

export class PkceGenerationError extends Data.TaggedError('PkceGenerationError')<{ readonly cause: unknown }> {}

export class AuthorizationUrlError extends Data.TaggedError('AuthorizationUrlError')<{ readonly message: string }> {}

export class TokenExchangeError
  extends Data.TaggedError('TokenExchangeError')<{ readonly status: number, readonly body: string }> {}

export class TokenRefreshError
  extends Data.TaggedError('TokenRefreshError')<{ readonly status: number, readonly body: string }> {}

export class ApiKeyCreationError
  extends Data.TaggedError('ApiKeyCreationError')<{ readonly status: number, readonly body: string }> {}

export class StorageError
  extends Data.TaggedError('StorageError')<{ readonly message: string, readonly cause: unknown }> {}

export class InvalidCredentialsError
  extends Data.TaggedError('InvalidCredentialsError')<{ readonly message: string }> {}
