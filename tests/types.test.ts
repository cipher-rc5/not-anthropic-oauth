// file: tests/types.test.ts
// description: Tests for domain types, constants, and getClientId() env override
// reference: src/types.ts

import { afterEach, describe, expect, test } from 'bun:test';
import { getClientId } from '../src/types.ts';

describe('getClientId', () => {
  const ORIGINAL = process.env['ANTHROPIC_CLIENT_ID'];

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['ANTHROPIC_CLIENT_ID'];
    } else {
      process.env['ANTHROPIC_CLIENT_ID'] = ORIGINAL;
    }
  });

  test('returns the default client ID when env var is not set', () => {
    delete process.env['ANTHROPIC_CLIENT_ID'];
    expect(getClientId()).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
  });

  test('returns the env var value when ANTHROPIC_CLIENT_ID is set', () => {
    process.env['ANTHROPIC_CLIENT_ID'] = 'custom-client-id';
    expect(getClientId()).toBe('custom-client-id');
  });

  test('returns empty string when env var is explicitly empty', () => {
    process.env['ANTHROPIC_CLIENT_ID'] = '';
    expect(getClientId()).toBe('');
  });
});
