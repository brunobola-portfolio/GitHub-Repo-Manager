/**
 * server/evals/adapters/repo-advisor-chat.js
 *
 * Eval adapter for the Repo Advisor chat handler's parse/validation contract.
 * Mirrors POST /ai/chat: build the system prompt, call the provider (mock),
 * then parse + shape the `{ reply, actions }` payload exactly as the route does.
 *
 * This validates the response CONTRACT deterministically against fixed mock
 * responses (no real LLM). Model / grounding QUALITY is out of scope until the
 * `--real` mode lands (it needs a provider key + budget). Building the prompt
 * here also exercises the error-KB grounding path so it can't throw.
 */

import { buildChatPrompt } from '../../lib/ai-chat-prompt.js';
import { safeJsonParse } from '../../lib/utils.js';

export const feature = 'repo-advisor-chat';

/**
 * Run a single eval case through the chat handler's prompt + parse logic.
 * @param {{ input: { message: string, context?: object }, provider: object }} opts
 * @returns {Promise<{ reply: string, actions: Array } | null>}
 */
export async function runCase({ input, provider }) {
    // Build the prompt as the route does — verifies it doesn't throw and
    // exercises the error-KB grounding branch for error-referencing messages.
    buildChatPrompt({ message: input.message, context: input.context });

    // Mock provider ignores the prompt and returns the case's mockResponse.
    const { text } = await provider.generate({ prompt: 'eval-prompt' });

    // Mirror the route's parse contract: valid only with a string `reply`.
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed.reply !== 'string') return null;
    return { reply: parsed.reply, actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
}
