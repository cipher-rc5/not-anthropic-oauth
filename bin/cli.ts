// file: bin/cli.ts
// description: Interactive CLI for Anthropic OAuth — demonstrates all three
//              login methods and exercises the authenticated fetch client.
//              UI output (menu, prompts, credential display) uses process.stdout
//              directly. Status and error messages inside Effect chains use
//              Effect.log* so Logger layers can control formatting.
// reference: src/service.ts, src/client.ts

import { Effect, Option } from 'effect';
import { authenticatedFetch } from '../src/client.ts';
import { checkCredentialValidity, exportToEnvironment } from '../src/opencode.ts';
import { beginOAuth, completeApiKeyLogin, completeOAuthLogin, getStoredCredentials, logout, saveApiKey } from '../src/service.ts';
import type { Credentials } from '../src/types.ts';

// ---------------------------------------------------------------------------
// stdin reading — single implementation
// ---------------------------------------------------------------------------

const readLine = (): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      const newlineIdx = str.indexOf('\n');
      if (newlineIdx !== -1) {
        chunks.push(Buffer.from(str.slice(0, newlineIdx)));
        process.stdin.off('data', onData);
        resolve(Buffer.concat(chunks).toString().trim());
      } else {
        chunks.push(chunk);
      }
    };
    const onError = (err: Error) => {
      process.stdin.off('data', onData);
      reject(err);
    };
    process.stdin.on('data', onData);
    process.stdin.once('error', onError);
    process.stdin.resume();
  });

const ask = async (question: string): Promise<string> => {
  process.stdout.write(question + ' ');
  return readLine();
};

const askEffect = (question: string): Effect.Effect<string, Error> =>
  Effect.tryPromise({ try: () => ask(question), catch: () => new Error('Failed to read input') });

// ---------------------------------------------------------------------------
// Credential display — intentional interactive UI, stdout is correct here
// ---------------------------------------------------------------------------

const printCredentials = (creds: Credentials | null): void => {
  if (!creds) {
    process.stdout.write('No credentials stored.\n');
    return;
  }
  if (creds.type === 'oauth') {
    const now = Date.now();
    const expiresAt = new Date(creds.expires);
    const expiresIn = Math.floor((creds.expires - now) / 1000);
    const isExpired = expiresIn <= 0;
    process.stdout.write(`Type    : oauth\n`);
    process.stdout.write(`Expires : ${expiresAt.toISOString()}\n`);
    process.stdout.write(
      `Status  : ${isExpired ? '[EXPIRED]' : '[Valid]'} (${isExpired ? 'expired' : `expires in ${expiresIn}s`})\n`
    );
    process.stdout.write(`Access  : ${creds.access}\n`);
    process.stdout.write(`Refresh : ${creds.refresh}\n`);
  } else {
    process.stdout.write(`Type    : api_key\n`);
    process.stdout.write(`Status  : [Valid] (no expiration)\n`);
    process.stdout.write(`Key     : ${creds.key}\n`);
    // to cover api-key use:
    // process.stdout.write(`Key     : ${creds.key}\n`);
  }
};

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

const runMenu = async (): Promise<void> => {
  // Iterative loop — avoids unbounded call-stack growth from self-recursion
  // on platforms or long-running sessions where the stack depth would matter.
  while (true) {
    process.stdout.write('\nAnthropic OAuth CLI\n');
    process.stdout.write('-------------------\n');
    process.stdout.write('1) Login via Claude Pro/Max (OAuth) - For web interface only\n');
    process.stdout.write('2) Login via Console (creates API key) - For API usage\n');
    process.stdout.write('3) Enter API key manually - For API usage\n');
    process.stdout.write('4) Show stored credentials\n');
    process.stdout.write('5) Test authenticated request\n');
    process.stdout.write('6) Logout\n');
    process.stdout.write('0) Exit\n');
    process.stdout.write('\nNote: Options 2 or 3 required for /v1/messages API\n');

    const choice = await ask('\nChoice:');

  switch (choice) {
    case '1': {
      const run = Effect.gen(function*() {
        const { url, verifier } = yield* beginOAuth('max');
        // URL display is interactive UI, not a log message
        process.stdout.write('\nOpen this URL in your browser:\n\n');
        process.stdout.write(url + '\n');
        const code = yield* askEffect('\nPaste the authorization code:');
        const creds = yield* completeOAuthLogin(code, verifier);
        yield* Effect.logInfo('Login successful. Credentials saved.');
        return creds;
      });

      const result = await Effect.runPromise(run.pipe(Effect.catchAll(e =>
        Effect.gen(function*() {
          yield* Effect.logError(`Login failed: ${String(e)}`);
          return null;
        })
      )));

      if (result) {
        printCredentials(result);
        await Effect.runPromise(
          exportToEnvironment().pipe(Effect.catchAll(e => Effect.logWarning(`OpenCode export failed: ${String(e)}`)))
        );
      }
      break;
    }

    case '2': {
      const run = Effect.gen(function*() {
        const { url, verifier } = yield* beginOAuth('console');
        process.stdout.write('\nOpen this URL in your browser:\n\n');
        process.stdout.write(url + '\n');
        const code = yield* askEffect('\nPaste the authorization code:');
        const creds = yield* completeApiKeyLogin(code, verifier);
        yield* Effect.logInfo('API key created and saved.');
        return creds;
      });

      const result = await Effect.runPromise(run.pipe(Effect.catchAll(e =>
        Effect.gen(function*() {
          yield* Effect.logError(`Login failed: ${String(e)}`);
          return null;
        })
      )));

      if (result) {
        printCredentials(result);
        await Effect.runPromise(
          exportToEnvironment().pipe(Effect.catchAll(e => Effect.logWarning(`OpenCode export failed: ${String(e)}`)))
        );
      }
      break;
    }

    case '3': {
      const key = await ask('Paste your API key:');
      const saved = await Effect.runPromise(
        Effect.gen(function*() {
          const creds = yield* saveApiKey(key);
          yield* Effect.logInfo('API key saved.');
          return creds;
        }).pipe(Effect.catchAll(e =>
          Effect.gen(function*() {
            yield* Effect.logError(`Save failed: ${String(e)}`);
            return null;
          })
        ))
      );

      if (saved) {
        await Effect.runPromise(
          exportToEnvironment().pipe(Effect.catchAll(e => Effect.logWarning(`OpenCode export failed: ${String(e)}`)))
        );
      }
      break;
    }

    case '4': {
      const creds = await Effect.runPromise(
        getStoredCredentials.pipe(
          Effect.map(Option.getOrNull),
          Effect.catchAll(e =>
            Effect.gen(function*() {
              yield* Effect.logError(`Storage error: ${String(e)}`);
              return null;
            })
          )
        )
      );
      printCredentials(creds);

      if (creds) {
        const validity = await Effect.runPromise(
          checkCredentialValidity().pipe(Effect.catchAll(e =>
            Effect.gen(function*() {
              yield* Effect.logWarning(`Validity check failed: ${String(e)}`);
              return { valid: false as const };
            })
          ))
        );
        if ('expiresIn' in validity && validity.expiresIn !== undefined) {
          await Effect.runPromise(
            Effect.logInfo(`Token will expire in ${Math.floor(validity.expiresIn / 60)} minutes`)
          );
        }
      }
      break;
    }

    case '5': {
      process.stdout.write('\nSending test request to /v1/messages...\n');

      const testCreds = await Effect.runPromise(
        getStoredCredentials.pipe(Effect.map(Option.getOrNull), Effect.catchAll(() => Effect.succeed(null)))
      );

      if (!testCreds) {
        await Effect.runPromise(Effect.logError('No credentials stored. Login first.'));
        break;
      }

      const testModel = 'claude-haiku-4-5';

      await Effect.runPromise(
        Effect.gen(function*() {
          yield* Effect.logInfo(`Auth type: ${testCreds.type}`);
          yield* Effect.logInfo(`Model: ${testModel}`);

          const res = yield* authenticatedFetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: testModel,
              max_tokens: 64,
              messages: [{ role: 'user', content: 'Say hello in one sentence.' }]
            })
          });

          const json: unknown = yield* Effect.tryPromise({
            try: () => res.json() as Promise<unknown>,
            catch: () => new Error('parse failed')
          });

          yield* Effect.logInfo(`HTTP Status: ${res.status}`);
          // Response body is interactive output, not a structured log
          process.stdout.write('Response:\n' + JSON.stringify(json, null, 2) + '\n');
        }).pipe(Effect.catchAll(e => Effect.logError(`Request failed: ${String(e)}`)))
      );
      break;
    }

    case '6': {
      await Effect.runPromise(
        Effect.gen(function*() {
          yield* logout;
          yield* Effect.logInfo('Logged out.');
        }).pipe(Effect.catchAll(e => Effect.logError(`Logout error: ${String(e)}`)))
      );
      break;
    }

    case '0':
      process.exit(0);

    default:
      process.stdout.write('Unknown option.\n');
  }
  } // end while
};

await runMenu();
