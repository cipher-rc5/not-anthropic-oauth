// file: tests/errors.test.ts
// description: Tests for tagged error constructors and discriminant tags
// reference: src/errors.ts

import { describe, expect, test } from 'bun:test';
import { ApiKeyCreationError, AuthorizationUrlError, InvalidCredentialsError, PkceGenerationError, StorageError, TokenExchangeError, TokenRefreshError } from '../src/errors.ts';

describe('tagged errors', () => {
  test('PkceGenerationError has correct _tag', () => {
    const err = new PkceGenerationError({ cause: new Error('oops') });
    expect(err._tag).toBe('PkceGenerationError');
    expect(err).toBeInstanceOf(PkceGenerationError);
  });

  test('AuthorizationUrlError carries message', () => {
    const err = new AuthorizationUrlError({ message: 'bad url' });
    expect(err._tag).toBe('AuthorizationUrlError');
    expect(err.message).toBe('bad url');
  });

  test('TokenExchangeError carries status and body', () => {
    const err = new TokenExchangeError({ status: 400, body: 'invalid_grant' });
    expect(err._tag).toBe('TokenExchangeError');
    expect(err.status).toBe(400);
    expect(err.body).toBe('invalid_grant');
  });

  test('TokenRefreshError carries status and body', () => {
    const err = new TokenRefreshError({ status: 401, body: 'expired' });
    expect(err._tag).toBe('TokenRefreshError');
    expect(err.status).toBe(401);
    expect(err.body).toBe('expired');
  });

  test('ApiKeyCreationError carries status and body', () => {
    const err = new ApiKeyCreationError({ status: 403, body: 'forbidden' });
    expect(err._tag).toBe('ApiKeyCreationError');
    expect(err.status).toBe(403);
    expect(err.body).toBe('forbidden');
  });

  test('StorageError carries message and cause', () => {
    const cause = new Error('disk full');
    const err = new StorageError({ message: 'save failed', cause });
    expect(err._tag).toBe('StorageError');
    expect(err.message).toBe('save failed');
    expect(err.cause).toBe(cause);
  });

  test('InvalidCredentialsError carries message', () => {
    const err = new InvalidCredentialsError({ message: 'no creds' });
    expect(err._tag).toBe('InvalidCredentialsError');
    expect(err.message).toBe('no creds');
  });

  test('errors are discriminable via _tag switch', () => {
    const errors = [
      new PkceGenerationError({ cause: null }),
      new AuthorizationUrlError({ message: '' }),
      new TokenExchangeError({ status: 0, body: '' }),
      new TokenRefreshError({ status: 0, body: '' }),
      new ApiKeyCreationError({ status: 0, body: '' }),
      new StorageError({ message: '', cause: null }),
      new InvalidCredentialsError({ message: '' })
    ];

    const tags = errors.map(e => e._tag);
    expect(new Set(tags).size).toBe(7); // all unique
  });
});
