// file: examples/test-credentials.ts
// description: Simple test to verify credentials work with raw fetch
// reference: src/opencode.ts

import { Effect } from 'effect';
import { getStoredCredentials } from '../src/index.ts';

const main = Effect.gen(function*() {
  console.log('[INFO] Testing credentials with raw fetch\n');

  const stored = yield* getStoredCredentials;
  if (stored._tag === 'None') {
    console.log('[ERROR] No credentials found');
    console.log('Run: bun run dev\n');
    return yield* Effect.fail(new Error('No credentials'));
  }

  const credentials = stored.value;
  console.log(`[INFO] Credential type: ${credentials.type}`);

  // Build auth header based on type
  const authHeader = credentials.type === 'oauth' ?
    { authorization: `Bearer ${credentials.access}` } :
    { 'x-api-key': credentials.key };

  console.log('[INFO] Making API request...\n');

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          ...authHeader,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        } as unknown as Record<string, string>,
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Say hello in one sentence.' }]
        })
      }),
    catch: (e) => new Error(`Fetch failed: ${String(e)}`)
  });

  console.log(`[INFO] Response status: ${response.status}`);

  if (!response.ok) {
    const error = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => new Error('Failed to read error')
    });
    console.log('[ERROR] API error:');
    console.log(error);
    return yield* Effect.fail(new Error(`API error: ${response.status}`));
  }

  const data = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{ content: Array<{ text: string }> }>,
    catch: () => new Error('Parse failed')
  });

  console.log('[OK] Success!');
  console.log(`Response: ${data.content[0]?.text}\n`);
});

await Effect.runPromise(main.pipe(Effect.catchAll((error) =>
  Effect.sync(() => {
    console.error(`\n[ERROR] ${error.message}\n`);
    process.exit(1);
  })
)));
