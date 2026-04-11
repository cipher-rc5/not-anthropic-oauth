// file: src/cch.ts
// description: Content Consistency Hashing for Anthropic billing headers.
//              Computes the x-anthropic-billing-header value that Anthropic uses
//              to route and verify OAuth subscription traffic.
// reference: https://github.com/ex-machina-co/opencode-anthropic-auth

import { CCH_POSITIONS, CCH_SALT, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_VERSION } from './types.ts';

export interface CchMessage {
  readonly role?: string;
  // content is typed as unknown so this interface is compatible with any
  // message array shape — type guards in extractFirstUserMessageText handle
  // the concrete string / block-array cases at runtime.
  readonly content?: unknown;
}

/**
 * Extract the text from the first user message's first text block.
 * Returns an empty string when no user message exists.
 */
export const extractFirstUserMessageText = (messages: readonly CchMessage[]): string => {
  const userMsg = messages.find(m => m.role === 'user');
  if (!userMsg) return '';

  const { content } = userMsg;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const textBlock = (content as ReadonlyArray<Record<string, unknown>>).find(b => b['type'] === 'text');
    if (textBlock && typeof textBlock['text'] === 'string') return textBlock['text'];
  }

  return '';
};

/**
 * Compute cch: first 5 hex characters of SHA-256(messageText).
 */
export const computeCCH = (messageText: string): string =>
  new Bun.CryptoHasher('sha256').update(messageText).digest('hex').slice(0, 5);

/**
 * Compute the 3-char version suffix from sampled positions in the message text.
 * Uses CCH_SALT + sampled chars + version as the hash input.
 */
export const computeVersionSuffix = (messageText: string, version: string = CLAUDE_CODE_VERSION): string => {
  const chars = CCH_POSITIONS.map(i => messageText[i] ?? '0').join('');
  return new Bun.CryptoHasher('sha256').update(`${CCH_SALT}${chars}${version}`).digest('hex').slice(0, 3);
};

/**
 * Build the complete billing header string for injection into the system prompt.
 * Format: `x-anthropic-billing-header: cc_version=V.S; cc_entrypoint=E; cch=HHHHH;`
 */
export const buildBillingHeaderValue = (
  messages: readonly CchMessage[],
  version: string = CLAUDE_CODE_VERSION,
  entrypoint: string = CLAUDE_CODE_ENTRYPOINT
): string => {
  const text = extractFirstUserMessageText(messages);
  const suffix = computeVersionSuffix(text, version);
  const cch = computeCCH(text);
  return ('x-anthropic-billing-header: ' +
    `cc_version=${version}.${suffix}; ` +
    `cc_entrypoint=${entrypoint}; ` +
    `cch=${cch};`);
};
