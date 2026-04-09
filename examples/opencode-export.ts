// file: examples/opencode-export.ts
// description: Export credentials for OpenCode and other AI tools
// reference: src/opencode.ts

import { Effect } from 'effect';
import { checkCredentialValidity, exportToEnvironment, generateOpenCodeConfigFile, getOpenCodeConfig, writeOpenCodeConfig } from '../src/index.ts';

const main = Effect.gen(function*() {
  console.log(' OpenCode Credential Export\n');

  // 1. Check credential validity
  console.log('1.  Checking credential validity...');
  const validity = yield* checkCredentialValidity();

  if (!validity.valid) {
    console.log('[ERROR] No valid credentials found');
    console.log('\nPlease run: bun run dev');
    console.log('Then choose option 1, 2, or 3 to login\n');
    return yield* Effect.fail(new Error('No credentials'));
  }

  console.log('[OK] Credentials valid');
  if (validity.expiresIn !== undefined) {
    const hours = Math.floor(validity.expiresIn / 3600);
    const minutes = Math.floor((validity.expiresIn % 3600) / 60);
    console.log(`   Expires in: ${hours}h ${minutes}m\n`);
  } else {
    console.log('   Type: API key (no expiration)\n');
  }

  // 2. Get config object
  console.log('2.  Getting OpenCode configuration...');
  const config = yield* getOpenCodeConfig();
  console.log('[OK] Config retrieved');
  console.log(`   Provider: ${config.provider}`);
  console.log(`   Model: ${config.model}`);
  console.log(`   API Key: [REDACTED]\n`);

  // 3. Export to environment
  console.log('3.  Exporting to environment variables...');
  yield* exportToEnvironment();

  // Verify environment variables
  console.log('\n   Environment variables set:');
  console.log(`   - ANTHROPIC_API_KEY: ${process.env['ANTHROPIC_API_KEY'] ? '[REDACTED]' : 'not set'}`);
  console.log(`   - OPENCODE_PROVIDER: ${process.env['OPENCODE_PROVIDER']}`);
  console.log(`   - OPENCODE_MODEL: ${process.env['OPENCODE_MODEL']}\n`);

  // 4. Generate config file content
  console.log('4.  Generating config file content...');
  const configContent = yield* generateOpenCodeConfigFile();
  console.log('[OK] Config content generated\n');
  console.log('   Preview:');
  console.log(configContent.split('\n').map(line => `   ${line}`).join('\n'));
  console.log();

  // 5. Write config file
  console.log('5.  Writing config to .opencode/config.json...');
  yield* writeOpenCodeConfig();

  console.log('\n[OK] OpenCode export complete!');
  console.log('\nYou can now use these credentials in:');
  console.log('  - OpenCode AI tools (via environment variables)');
  console.log('  - Config file at .opencode/config.json');
  console.log('  - Any tool that reads ANTHROPIC_API_KEY\n');
});

await Effect.runPromise(main.pipe(Effect.catchAll(error =>
  Effect.sync(() => {
    console.error('\n[ERROR] Export failed:', error.message);
    process.exit(1);
  })
)));
