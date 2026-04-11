// file: examples/multi-turn-chat.ts
// description: Multi-turn conversation with automatic token refresh
// reference: src/client.ts, src/token.ts

import { Effect } from 'effect';
import { authenticatedFetch, getDefaultModel } from '../src/index.ts';

interface Message {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface ChatResponse {
  readonly id: string;
  readonly content: ReadonlyArray<{ readonly text: string }>;
}

class ConversationManager {
  private messages: Message[] = [];

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
  }

  getMessages(): readonly Message[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
  }
}

// authenticatedFetch handles credential validation and auto-refresh internally.
const sendChatMessage = (conversation: ConversationManager, userMessage: string): Effect.Effect<string, Error> =>
  Effect.gen(function*() {
    // Add user message to conversation
    conversation.addUserMessage(userMessage);

    // Make API request with full conversation history.
    // authenticatedFetch will surface InvalidCredentialsError or TokenRefreshError
    // on credential problems — no need to pre-check validity manually.
    const response = yield* authenticatedFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: getDefaultModel(), max_tokens: 2048, messages: conversation.getMessages() })
    }).pipe(Effect.mapError(e => new Error(String(e))));

    if (!response.ok) {
      const errorText = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error('Failed to read error')
      }).pipe(Effect.mapError(e => new Error(String(e))));
      return yield* Effect.fail(new Error(`API error: ${errorText}`));
    }

    const data = yield* Effect.tryPromise({
      try: () => response.json() as Promise<ChatResponse>,
      catch: () => new Error('Failed to parse JSON')
    }).pipe(Effect.mapError(e => new Error(String(e))));

    const assistantMessage = data.content[0]?.text ?? '';

    // Add assistant response to conversation
    conversation.addAssistantMessage(assistantMessage);

    return assistantMessage;
  });

const main = Effect.gen(function*() {
  console.log(' Multi-Turn Chat\n');

  const conversation = new ConversationManager();

  // Turn 1
  console.log('You: What is Effect-TS?\n');
  const response1 = yield* sendChatMessage(conversation, 'What is Effect-TS? Answer in 2 sentences.');
  console.log(`Claude: ${response1}\n`);

  // Turn 2
  console.log('You: Can you give me a code example?\n');
  const response2 = yield* sendChatMessage(conversation, 'Can you give me a code example?');
  console.log(`Claude: ${response2}\n`);

  // Turn 3
  console.log('You: How does it compare to Promises?\n');
  const response3 = yield* sendChatMessage(conversation, 'How does it compare to Promises?');
  console.log(`Claude: ${response3}\n`);

  console.log(`\n[OK] Conversation complete! (${conversation.getMessages().length} messages total)`);
});

await Effect.runPromise(main.pipe(Effect.catchAll(error =>
  Effect.sync(() => {
    console.error('[ERROR] Error:', error.message);
    process.exit(1);
  })
)));
