import { sanitizeForPrompt } from './sanitize.js';
import { getResolvedPrompt } from '../ai-prompt-registry.js';

const MAX_LINE_COMMENTS = 25;
const MAX_DIFF_CHARS = 80000;
const MAX_SUGGESTION_CHARS = 4096;
const FENCE_ESCAPE_RE = /`{7,}/;

export const DEEP_REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        walkthrough: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                perFileTable: {
                    type: 'array',
                    maxItems: 50,
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
            maxItems: 50,
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
 * @returns {Promise<object|null>}        — DeepReview JSON, or null when disabled
 */
export async function runDeepReview({ provider, userId, repoFullName, prMetadata, fileManifest, diffPatch }) {
    if (process.env.DISABLE_AI_REVIEW === 'true') return null;
    if (!provider?.model || typeof provider.generate !== 'function') {
        throw new Error('AI provider not initialized for the calling user.');
    }

    const systemPrompt = getResolvedPrompt(userId, 'pr_deep_review', {
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

    const parts = [
        { text: systemPrompt + '\n\n' + prContext },
        { text: 'Diff:\n```diff\n' + sanitizeForPrompt(diffPatch || '', MAX_DIFF_CHARS) + '\n```' },
    ];

    const { parsed } = await provider.generate({
        parts,
        schema: DEEP_REVIEW_SCHEMA,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: DEEP_REVIEW_SCHEMA,
        },
    });

    return postProcess(parsed, provider);
}

/**
 * Cap, sanitise, and stamp metadata on the parsed response.
 * Pure function — easy to unit-test in isolation.
 */
function postProcess(parsed, provider) {
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

    return {
        walkthrough,
        lineComments,
        modelUsed: provider._modelName || provider.constructor?.name || 'unknown',
    };
}
