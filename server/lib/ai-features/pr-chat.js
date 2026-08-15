// SPDX-License-Identifier: Apache-2.0
/**
 * PR Chat engine (slice 2 — Pro).
 *
 * This is the MID/MIN version: plain streaming Q&A about a PR with no
 * server-side tool execution. The model answers from the system prompt
 * (PR metadata + walkthrough excerpt + diff manifest) plus the persisted
 * conversation history.
 *
 * TODO(slice-2-tools): wire `read_pr_file` + `list_pr_comments` tools through
 * a provider-agnostic tool-use loop. The provider adapters (anthropic.js,
 * gemini.js) need a `tools` parameter on `generateStream` first; deferring
 * here keeps slice 2 shipping. Persisted message rows already have
 * `tool_name` / `tool_input_json` / `tool_output_json` columns so the data
 * model is forward-compatible.
 *
 * Defence-in-depth for prompt injection:
 *   - Every PR-derived string (title, body, walkthrough, file list,
 *     conversation history) is run through `sanitizeForPrompt` with a
 *     conservative cap.
 *   - The system prompt instructs the model to stay on-topic for THIS PR.
 */

import { sanitizeForPrompt } from './sanitize.js';

export const MAX_HISTORY_TURNS = 10;
export const MAX_USER_MESSAGE_LEN = 4000;

/**
 * Build the system prompt for PR chat.
 *
 * @param {object} opts
 * @param {string} opts.repoFullName
 * @param {object} opts.prMetadata
 * @param {number} opts.prMetadata.number
 * @param {string} opts.prMetadata.title
 * @param {string} opts.prMetadata.author
 * @param {string} [opts.prMetadata.body]
 * @param {string} [opts.walkthrough] — optional excerpt from the deep-review draft
 * @param {Array}  [opts.fileManifest] — array of { filename, additions, deletions, status }
 * @returns {string}
 */
export function buildSystemPrompt({ repoFullName, prMetadata, walkthrough, fileManifest } = {}) {
    const safeRepo = sanitizeForPrompt(repoFullName, 100);
    const number = prMetadata?.number ?? '?';
    const safeTitle = sanitizeForPrompt(prMetadata?.title || '(untitled)', 200);
    const safeAuthor = sanitizeForPrompt(prMetadata?.author || '?', 100);
    const safeBody = sanitizeForPrompt(prMetadata?.body || '(no description)', 800);

    const walkBlock = walkthrough
        ? `\nPrior AI walkthrough:\n${sanitizeForPrompt(walkthrough, 1500)}\n`
        : '';

    let manifestBlock = '';
    if (Array.isArray(fileManifest) && fileManifest.length > 0) {
        const lines = fileManifest.slice(0, 60).map((f) => {
            const name = sanitizeForPrompt(f?.filename || '?', 200);
            const adds = Number.isFinite(f?.additions) ? f.additions : 0;
            const dels = Number.isFinite(f?.deletions) ? f.deletions : 0;
            const status = sanitizeForPrompt(f?.status || 'modified', 20);
            return `- ${name} (${status}, +${adds}/-${dels})`;
        });
        manifestBlock = `\nChanged files (${fileManifest.length}):\n${lines.join('\n')}\n`;
        if (fileManifest.length > 60) manifestBlock += `... (${fileManifest.length - 60} more)\n`;
    }

    return `You are an AI assistant helping a developer review a GitHub Pull Request.

Repository: ${safeRepo}
PR: #${number} — ${safeTitle}
Author: ${safeAuthor}
Description: ${safeBody}
${walkBlock}${manifestBlock}
Rules:
- Keep replies focused and concise (under 400 words unless the user asks for more).
- Cite file:line when referring to code.
- Stay on-topic for THIS PR. If the user asks about something unrelated, politely redirect.
- Markdown formatting is supported.
- Do not invent file paths or function names — if you are unsure, say so.
`;
}

/**
 * Trim history to fit within turn limit. Old messages are collapsed into a
 * single placeholder turn so context-window budgets stay bounded.
 *
 * @param {Array} messages — chronologically ordered messages
 * @param {number} [maxTurns=MAX_HISTORY_TURNS]
 * @returns {Array}
 */
export function compactHistory(messages, maxTurns = MAX_HISTORY_TURNS) {
    if (!Array.isArray(messages)) return [];
    const cap = Math.max(1, Math.floor(maxTurns)) * 2;
    if (messages.length <= cap) return messages.slice();
    const recent = messages.slice(-cap);
    const dropped = messages.length - recent.length;
    return [
        { role: 'user', content: `(${dropped} earlier messages omitted to fit context window)` },
        ...recent,
    ];
}

/**
 * Render the persisted history as a single textual transcript suitable for
 * appending to the system prompt. Intentionally provider-agnostic so the
 * route works against any provider that exposes a plain-text `generateStream`.
 *
 * Tool / assistant / user roles each get a labelled prefix. User messages are
 * sanitised to the per-message cap before interpolation.
 *
 * @param {Array} messages
 * @returns {string}
 */
export function renderHistoryAsPrompt(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    const lines = messages.map((m) => {
        const safe = sanitizeForPrompt(String(m?.content ?? ''), MAX_USER_MESSAGE_LEN);
        if (m.role === 'assistant') return `Assistant: ${safe}`;
        if (m.role === 'tool') {
            const tool = sanitizeForPrompt(m.toolName || 'tool', 60);
            return `Tool(${tool}): ${safe}`;
        }
        return `User: ${safe}`;
    });
    return lines.join('\n\n');
}
