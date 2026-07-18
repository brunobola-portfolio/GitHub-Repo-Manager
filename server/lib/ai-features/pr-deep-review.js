import { sanitizeForPrompt } from './sanitize.js';
import { getResolvedPrompt } from '../ai-prompt-registry.js';
import { AIError, AI_ERROR_CODE } from '../ai-provider.js';
import { resolveMaxOutputTokens } from '../ai-output-budget.js';

const MAX_LINE_COMMENTS = 25;
const MAX_DIFF_CHARS = 80000;
const MAX_SUGGESTION_CHARS = 4096;
const FENCE_ESCAPE_RE = /`{7,}/;

const SEVERITY_ORDER = { info: 0, suggestion: 1, warning: 2, critical: 3 };

export const DEEP_REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        walkthrough: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                perFileTable: {
                    type: 'array',
                    maxItems: 30,
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            change: { type: 'string', enum: ['added', 'modified', 'deleted'] },
                            summary: { type: 'string' },
                        },
                        required: ['path', 'change', 'summary'],
                    },
                },
                mermaid: { type: 'string' },
                estimatedReviewTime: { type: 'string' },
                riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            },
            required: ['summary', 'perFileTable', 'estimatedReviewTime', 'riskLevel'],
        },
        lineComments: {
            type: 'array',
            maxItems: 25,
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
                    line: { type: 'integer' },
                    startLine: { type: ['integer', 'null'] },
                    severity: { type: 'string', enum: ['info', 'suggestion', 'warning', 'critical'] },
                    body: { type: 'string' },
                    suggestion: { type: 'string' },
                },
                required: ['path', 'side', 'line', 'severity', 'body'],
            },
        },
    },
    required: ['walkthrough', 'lineComments'],
};

/**
 * Run the AI Deep Review.
 *
 * Honors DISABLE_AI_REVIEW=true as a kill switch (returns null).
 *
 * @param {object} ctx
 * @param {object} ctx.provider           — resolved via createProviderForUser
 * @param {number} ctx.userId             — for prompt registry override lookup
 * @param {string} ctx.repoFullName       — '<owner>/<repo>'
 * @param {object} ctx.prMetadata         — { title, author, body, additions, deletions }
 * @param {Array}  ctx.fileManifest       — GitHub /files API rows
 * @param {string} ctx.diffPatch          — concatenated patch text (already truncated by caller)
 * @param {object} [ctx.resolvedPrompt]   — optional output of `resolvePromptForGenerate`
 *   When supplied, the route layer has already composed the system prompt
 *   (base + active preset + style-guide substitution). The engine uses it
 *   verbatim, then enforces the preset's `severityFloor` in postProcess and
 *   appends per-file `pathRules.extraPrompt` text to the user-context turn.
 *   Backwards-compatible: if absent, the engine falls back to the slice-1a
 *   behaviour (call `getResolvedPrompt` with no preset).
 * @returns {Promise<object|null>}        — DeepReview JSON, or null when disabled
 */
export async function runDeepReview({ provider, userId, repoFullName, prMetadata, fileManifest, diffPatch, resolvedPrompt }) {
    if (process.env.DISABLE_AI_REVIEW === 'true') return null;
    if (!provider?.model || typeof provider.generate !== 'function') {
        throw new AIError({
            code: AI_ERROR_CODE.AUTH,
            message: 'AI provider not initialized for the calling user.',
            status: 401,
        });
    }

    const systemPrompt = resolvedPrompt?.systemPrompt
        ?? getResolvedPrompt(userId, 'pr_deep_review', {
            repo_full_name: sanitizeForPrompt(repoFullName, 100),
            pr_title: sanitizeForPrompt(prMetadata.title, 200),
            author: sanitizeForPrompt(prMetadata.author, 100),
        });

    const prContext = `PR description:
${sanitizeForPrompt(prMetadata.body || 'No description provided.', 1500)}

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

    const pathExtras = applyPathRules(resolvedPrompt?.pathRules, fileManifest);
    const fullContext = prContext + pathExtras;

    const parts = [
        { text: systemPrompt + '\n\n' + fullContext },
        { text: 'Diff:\n```diff\n' + sanitizeForPrompt(diffPatch || '', MAX_DIFF_CHARS) + '\n```' },
    ];

    const { parsed, usage, costUSD } = await provider.generate({
        parts,
        schema: DEEP_REVIEW_SCHEMA,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: DEEP_REVIEW_SCHEMA,
            maxOutputTokens: resolveMaxOutputTokens(),
        },
    });

    return postProcess(parsed, provider, { usage, costUSD }, resolvedPrompt?.severityFloor ?? null);
}

/**
 * Build the path-scoped guidance block appended to the user context.
 *
 * For each rule, find files whose path matches the glob and emit a one-shot
 * block listing the matched files plus the rule's `extraPrompt`. We do this
 * once per generate call (not per file) so token cost stays linear in the
 * number of rules, not files × rules.
 *
 * @param {Array<{glob:string, extraPrompt:string}>|undefined} rules
 * @param {Array<{filename:string}>|undefined} fileManifest
 * @returns {string}  '' when no rules match, otherwise a leading-newline block.
 */
function applyPathRules(rules, fileManifest) {
    if (!rules?.length || !fileManifest?.length) return '';
    const matched = [];
    for (const rule of rules) {
        if (!rule?.glob || !rule?.extraPrompt) continue;
        const matchingFiles = fileManifest
            .filter((f) => globMatches(rule.glob, f.filename))
            .map((f) => f.filename);
        if (matchingFiles.length > 0) {
            matched.push(`Files matching "${rule.glob}": ${matchingFiles.join(', ')}\n${rule.extraPrompt}`);
        }
    }
    return matched.length ? '\n\n--- Path-scoped guidance ---\n' + matched.join('\n\n') : '';
}

/**
 * Minimal glob matcher supporting `*`, `**`, and literal segments.
 * Sufficient for typical patterns like `src/components/**`, `*.test.js`,
 * `server/**` without pulling in a `picomatch` dependency. `**` matches any
 * characters including `/`; `*` matches any characters except `/`.
 */
function globMatches(glob, path) {
    const re = new RegExp(
        '^' + glob.split('').map((c) => {
            if (c === '*') return '__STAR__';
            return c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        }).join('').replace(/__STAR____STAR__/g, '.*').replace(/__STAR__/g, '[^/]*') + '$'
    );
    return re.test(path);
}

/**
 * Cap, sanitise, and stamp metadata on the parsed response.
 * Pure function — easy to unit-test in isolation.
 *
 * @param {object} parsed
 * @param {object} provider
 * @param {{ usage?: ({inputTokens?: number|null, outputTokens?: number|null}|null), costUSD?: number|null }} [meta]
 * @param {'info'|'suggestion'|'warning'|'critical'|null} [severityFloor]
 *   When non-null, drop comments whose severity ranks below the floor.
 *   Applied AFTER the overflow cap so the user keeps the highest-priority
 *   findings even when the model returned more than 25.
 */
function postProcess(parsed, provider, meta = {}, severityFloor = null) {
    const walkthrough = { ...parsed.walkthrough };
    let lineComments = Array.isArray(parsed.lineComments) ? parsed.lineComments : [];

    // Drop comments whose suggestion contains a fence-escape attack
    lineComments = lineComments.map((c) => {
        if (c.suggestion && (FENCE_ESCAPE_RE.test(c.suggestion) || c.suggestion.length > MAX_SUGGESTION_CHARS)) {
            const { suggestion, ...rest } = c;
            return rest;
        }
        return c;
    });

    // Cap at 25 — fold the rest into the walkthrough summary
    if (lineComments.length > MAX_LINE_COMMENTS) {
        const overflow = lineComments.length - MAX_LINE_COMMENTS;
        walkthrough.summary = (walkthrough.summary || '')
            + `\n\n_${overflow} additional minor findings were folded into this summary to keep the review focused. Increase the line-comment cap in the prompt if you want them inline._`;
        lineComments = lineComments.slice(0, MAX_LINE_COMMENTS);
    }

    // Severity floor (preset-driven). Applied after the overflow cap so the
    // user sees the higher-priority comments rather than 25 below-floor noise.
    if (severityFloor) {
        const floor = SEVERITY_ORDER[severityFloor] ?? 0;
        lineComments = lineComments.filter((c) => (SEVERITY_ORDER[c.severity] ?? 0) >= floor);
    }

    return {
        walkthrough,
        lineComments,
        modelUsed: provider._modelName
            || provider.getModelName?.()
            || 'unknown',
        // Defensive reads: providers that can't surface usage (local SDKs,
        // some OpenAI-compatible passthroughs) return null for both fields.
        // Persisting null is meaningful — "we ran but don't know the cost" —
        // versus 0 which would falsely imply a free call.
        costUsd: meta.costUSD ?? null,
        inputTokens: meta.usage?.inputTokens ?? null,
        outputTokens: meta.usage?.outputTokens ?? null,
    };
}
