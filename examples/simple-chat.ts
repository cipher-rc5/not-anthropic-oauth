// file: examples/simple-chat.ts
// description: Simple chat application using OAuth credentials with Effect-TS
// reference: src/client.ts, src/opencode.ts

import { Effect } from 'effect';
import { authenticatedFetch, exportToEnvironment, getDefaultModel } from '../src/index.ts';

interface Message {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface ChatRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: readonly Message[];
}

interface ChatResponse {
  readonly id: string;
  readonly content: ReadonlyArray<{ readonly text: string }>;
}

// authenticatedFetch handles credential validation and auto-refresh internally.
// No need to call checkCredentialValidity() — it will surface InvalidCredentialsError
// if credentials are missing, or TokenRefreshError if a refresh fails.
const sendMessage = (message: string, model = getDefaultModel()): Effect.Effect<string, Error> =>
  Effect.gen(function*() {
    const request: ChatRequest = { model, max_tokens: 1024, messages: [{ role: 'user', content: message }] };

    const response = yield* authenticatedFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error('Failed to read error response')
      });
      return yield* Effect.fail(new Error(`API error ${response.status}: ${errorText}`));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<ChatResponse>,
      catch: () => new Error('Failed to parse response JSON')
    });

    const textContent = data.content[0];
    return textContent ? textContent.text : '';
  });

const main = Effect.gen(function*() {
  console.log(' Simple Chat with Claude\n');

  // Export credentials to environment (if needed by other tools)
  yield* exportToEnvironment().pipe(Effect.catchAll(e =>
    Effect.sync(() => {
      console.log('[WARN]  Could not export to environment:', e.message);
      console.log('Continuing with stored credentials...\n');
    })
  ));

  // Send a test message
  console.log('You: Hello, Claude!\n');

  const response = yield* sendMessage('Hello, Claude! Tell me a fun fact about TypeScript.');

  console.log('Claude:', response);
  console.log('\n[OK] Chat complete!');
});

// Run the program
await Effect.runPromise(main.pipe(Effect.catchAll(error =>
  Effect.sync(() => {
    console.error('\n[ERROR] Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Run: bun run dev');
    console.error('  2. Choose option 1, 2, or 3 to login');
    console.error('  3. Try again');
    process.exit(1);
  })
)));
