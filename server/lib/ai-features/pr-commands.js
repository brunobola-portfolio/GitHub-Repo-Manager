// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PR-context AI slash commands engine (slice 3).
 *
 *   /describe   → { title?, body }              — generate or improve PR description (markdown)
 *   /test_plan  → { summary, cases[] }          — structured test plan, max 15 cases
 *   /improve    → { summary, suggestions[] }    — code-quality improvement suggestions, max 20
 *
 * Honors `DISABLE_AI_REVIEW=true` as a kill switch (returns null), mirroring
 * pr-deep-review.js. Throws AIError({code:AUTH}) when no provider is supplied.
 *
 * Each command resolves its own prompt-registry entry (`pr_command_describe`,
 * `pr_command_test_plan`, `pr_command_improve`) and uses Gemini-style
 * structured output (responseMimeType + responseSchema) so the parsed payload
 * lands as JSON ready to persist.
 */

import { sanitizeForPrompt } from './sanitize.js';
import { getResolvedPrompt } from '../ai-prompt-registry.js';
import { AIError, AI_ERROR_CODE } from '../ai-provider.js';

export const MAX_TEST_CASES = 15;
export const MAX_IMPROVEMENTS = 20;
export const MAX_DESCRIBE_BODY = 8000;
export const MAX_DESCRIBE_TITLE = 200;
const MAX_DIFF_CHARS = 60000;
const MAX_BODY_CHARS = 1500;
const FENCE_ESCAPE_RE = /`{7,}/;

const SUPPORTED_COMMANDS = Object.freeze(['describe', 'test_plan', 'improve']);

export const DESCRIBE_SCHEMA = {
    type: 'object',
    properties: {
        title: { type: 'string' },
        body: { type: 'string' },
    },
    required: ['body'],
};

export const TEST_PLAN_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string' },
        cases: {
            type: 'array',
            maxItems: MAX_TEST_CASES,
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['unit', 'integration', 'e2e'] },
                    steps: { type: 'array', items: { type: 'string' } },
                    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['name', 'type', 'steps', 'priority'],
            },
        },
    },
    required: ['summary', 'cases'],
};

export const IMPROVE_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string' },
        suggestions: {
            type: 'array',
            maxItems: MAX_IMPROVEMENTS,
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    line: { type: ['integer', 'null'] },
                    severity: { type: 'string', enum: ['info', 'suggestion', 'warning'] },
                    body: { type: 'string' },
                    suggestion: { type: 'string' },
                },
                required: ['path', 'severity', 'body'],
            },
        },
    },
    required: ['summary', 'suggestions'],
};

const COMMAND_REGISTRY = Object.freeze({
    describe: {
        promptKey: 'pr_command_describe',
        schema: DESCRIBE_SCHEMA,
        postProcess: postProcessDescribe,
    },
    test_plan: {
        promptKey: 'pr_command_test_plan',
        schema: TEST_PLAN_SCHEMA,
        postProcess: postProcessTestPlan,
    },
    improve: {
        promptKey: 'pr_command_improve',
        schema: IMPROVE_SCHEMA,
        postProcess: postProcessImprove,
    },
});

export function isSupportedCommand(command) {
    return typeof command === 'string' && Object.prototype.hasOwnProperty.call(COMMAND_REGISTRY, command);
}

export const SUPPORTED_PR_COMMANDS = SUPPORTED_COMMANDS;

/**
 * Run one of the PR-context AI slash commands.
 *
 * @param {object} ctx
 * @param {object} ctx.provider           — resolved via createProviderForUser
 * @param {number} ctx.userId             — for prompt registry override lookup
 * @param {'describe'|'test_plan'|'improve'} ctx.command
 * @param {string} ctx.repoFullName       — '<owner>/<repo>'
 * @param {object} ctx.prMetadata         — { title, author, body, additions, deletions }
 * @param {Array}  ctx.fileManifest       — GitHub /files API rows
 * @param {string} ctx.diffPatch          — concatenated patch text (already truncated by caller)
 * @returns {Promise<object|null>}        — { command, output, modelUsed, costUsd, inputTokens, outputTokens } or null when disabled
 */
export async function runPRCommand({ provider, userId, command, repoFullName, prMetadata, fileManifest, diffPatch }) {
    if (process.env.DISABLE_AI_REVIEW === 'true') return null;
    if (!isSupportedCommand(command)) {
        throw new AIError({
            code: AI_ERROR_CODE.NOT_FOUND,
            message: `Unknown PR command: ${command}. Expected one of: ${SUPPORTED_COMMANDS.join(', ')}.`,
            status: 400,
        });
    }
    if (!provider?.model || typeof provider.generate !== 'function') {
        throw new AIError({
            code: AI_ERROR_CODE.AUTH,
            message: 'AI provider not initialized for the calling user.',
            status: 401,
        });
    }

    const entry = COMMAND_REGISTRY[command];

    const systemPrompt = getResolvedPrompt(userId, entry.promptKey, {
        repo_full_name: sanitizeForPrompt(repoFullName, 100),
        pr_title: sanitizeForPrompt(prMetadata?.title, 200),
        author: sanitizeForPrompt(prMetadata?.author, 100),
    });

    const prContext = `PR title: ${sanitizeForPrompt(prMetadata?.title, 200)}
Author: ${sanitizeForPrompt(prMetadata?.author, 100)}
Existing description:
${sanitizeForPrompt(prMetadata?.body || 'No description provided.', MAX_BODY_CHARS)}

File manifest:
${sanitizeForPrompt(JSON.stringify(
        (fileManifest || []).map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
        })),
        null, 2,
    ), 4000)}`;

    const parts = [
        { text: systemPrompt + '\n\n' + prContext },
        { text: 'Diff:\n```diff\n' + sanitizeForPrompt(diffPatch || '', MAX_DIFF_CHARS) + '\n```' },
    ];

    const { parsed, usage, costUSD } = await provider.generate({
        parts,
        schema: entry.schema,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: entry.schema,
        },
    });

    const output = entry.postProcess(parsed);

    return {
        command,
        output,
        modelUsed: provider._modelName
            || provider.getModelName?.()
            || 'unknown',
        costUsd: costUSD ?? null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
    };
}

// ---------------------------------------------------------------------------
// Per-command post-processing (caps, sanitisation)
// ---------------------------------------------------------------------------

function postProcessDescribe(parsed) {
    const out = parsed && typeof parsed === 'object' ? { ...parsed } : {};
    if (typeof out.title === 'string') {
        out.title = out.title.slice(0, MAX_DESCRIBE_TITLE);
    }
    let body = typeof out.body === 'string' ? out.body : '';
    if (body.length > MAX_DESCRIBE_BODY) {
        body = body.slice(0, MAX_DESCRIBE_BODY - 32) + '\n\n_…[truncated]_';
    }
    out.body = body;
    return out;
}

function postProcessTestPlan(parsed) {
    const summary = typeof parsed?.summary === 'string' ? parsed.summary : '';
    let cases = Array.isArray(parsed?.cases) ? parsed.cases : [];
    cases = cases.map((c) => ({
        name: String(c?.name ?? '').slice(0, 200),
        type: ['unit', 'integration', 'e2e'].includes(c?.type) ? c.type : 'unit',
        steps: Array.isArray(c?.steps) ? c.steps.slice(0, 20).map((s) => String(s).slice(0, 500)) : [],
        priority: ['high', 'medium', 'low'].includes(c?.priority) ? c.priority : 'medium',
    }));
    if (cases.length > MAX_TEST_CASES) cases = cases.slice(0, MAX_TEST_CASES);
    return { summary, cases };
}

function postProcessImprove(parsed) {
    const summary = typeof parsed?.summary === 'string' ? parsed.summary : '';
    let suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    suggestions = suggestions.map((s) => {
        const out = {
            path: String(s?.path ?? '').slice(0, 300),
            severity: ['info', 'suggestion', 'warning'].includes(s?.severity) ? s.severity : 'suggestion',
            body: String(s?.body ?? '').slice(0, 2000),
        };
        if (s?.line != null && Number.isFinite(Number(s.line))) {
            out.line = Number(s.line);
        }
        if (typeof s?.suggestion === 'string'
            && s.suggestion.length > 0
            && !FENCE_ESCAPE_RE.test(s.suggestion)
            && s.suggestion.length <= 4096) {
            out.suggestion = s.suggestion;
        }
        return out;
    });
    if (suggestions.length > MAX_IMPROVEMENTS) suggestions = suggestions.slice(0, MAX_IMPROVEMENTS);
    return { summary, suggestions };
}
