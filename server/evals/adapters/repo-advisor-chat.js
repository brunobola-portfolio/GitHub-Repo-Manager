/**
 * server/evals/adapters/repo-advisor-chat.js
 *
 * Eval adapter for the Repo Advisor chat handler's parse/validation contract.
 * Mirrors POST /ai/chat: build the system prompt, call the provider (mock),
 * then parse + shape the `{ reply, actions }` payload exactly as the route does.
 *
 * In mock mode this validates the response CONTRACT deterministically against
 * fixed mock responses. In `--real` mode the same prompt is sent to a real
 * model and graded by the case's structural scorers + any `judge` rubric.
 * Building the prompt also exercises the error-KB grounding path so it can't
 * throw.
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
    // Build the prompt exactly as the route does — exercises the error-KB
    // grounding branch and feeds the REAL prompt to the model in --real mode.
    // (The mock provider ignores it and returns the case's mockResponse.)
    const prompt = buildChatPrompt({ message: input.message, context: input.context });

    const { text } = await provider.generate({ prompt });

    // Mirror the route's parse contract: valid only with a string `reply`.
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed.reply !== 'string') return null;
    return { reply: parsed.reply, actions: Array.isArray(parsed.actions) ? parsed.actions : [] };
}
