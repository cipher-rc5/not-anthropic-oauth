// file: examples/opencode-setup.ts
// description: Complete OpenCode setup with user-agent plugin and credential export
// reference: src/plugin.ts, src/opencode.ts

import { Effect } from 'effect';
import { AnthropicUserAgentPlugin, authenticatedFetch, exportToEnvironment, getDefaultModel } from '../src/index.ts';

const setupPlugin = Effect.tryPromise({
  try: () => AnthropicUserAgentPlugin(),
  catch: () => new Error('Failed to patch global fetch')
});

const main = Effect.gen(function*() {
  console.log('[INFO] OpenCode Setup\n');

  // Step 1: Patch global fetch with user-agent
  console.log('[INFO] Patching global fetch with user-agent...');
  yield* setupPlugin;
  console.log('[OK] Global fetch patched\n');

  // Step 2: Export credentials to environment
  console.log('[INFO] Exporting credentials to environment...');
  yield* exportToEnvironment();

  // Verify setup
  console.log('\n[INFO] Verifying setup...');
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const provider = process.env['OPENCODE_PROVIDER'];
  const model = process.env['OPENCODE_MODEL'];

  if (!apiKey) {
    console.log('[ERROR] No API key found in environment');
    console.log('Please run: bun run dev');
    console.log('Then choose option 1, 2, or 3 to login\n');
    return yield* Effect.fail(new Error('No credentials'));
  }

  console.log('[OK] Environment variables set:');
  console.log(`  ANTHROPIC_API_KEY: ${apiKey ? '[REDACTED]' : 'not set'}`);
  console.log(`  OPENCODE_PROVIDER: ${provider}`);
  console.log(`  OPENCODE_MODEL: ${model}\n`);

  // Test with authenticatedFetch (handles both OAuth and API keys correctly)
  console.log('[INFO] Testing authenticated request...');
  const testResponse = yield* authenticatedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model ?? getDefaultModel(),
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Say "Hello from OpenCode setup" in one sentence.' }]
    })
  });

  if (!testResponse.ok) {
    const errorText = yield* Effect.tryPromise({
      try: () => testResponse.text(),
      catch: () => new Error('Failed to read error')
    });
    console.log(`[ERROR] API request failed: ${testResponse.status}`);
    console.log(`Response: ${errorText}\n`);
    return yield* Effect.fail(new Error(`API error: ${testResponse.status}`));
  }

  const data = yield* Effect.tryPromise({
    try: () => testResponse.json() as Promise<{ content: Array<{ text: string }> }>,
    catch: () => new Error('Failed to parse JSON')
  });

  console.log('[OK] Test request successful');
  console.log(`Response: ${data.content[0]?.text}\n`);

  console.log('[OK] OpenCode setup complete!');
  console.log('\nYour OpenCode instance can now:');
  console.log('  1. Use authenticatedFetch() for automatic header handling');
  console.log('  2. Access credentials via process.env["ANTHROPIC_API_KEY"]');
  console.log('  3. Make fetch calls with correct user-agent (via plugin)');
  console.log('  4. Works with both OAuth tokens and API keys\n');
  console.log('Note: OAuth tokens use "authorization: Bearer", API keys use "x-api-key"');
  console.log('      authenticatedFetch() handles this automatically!\n');
});

await Effect.runPromise(main.pipe(Effect.catchAll((error) =>
  Effect.sync(() => {
    console.error('\n[ERROR] Setup failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Run: bun run dev');
    console.error('  2. Choose option 1, 2, or 3 to login');
    console.error('  3. Run this script again\n');
    process.exit(1);
  })
)));
