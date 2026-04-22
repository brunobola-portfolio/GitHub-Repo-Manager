import { sanitizeForPrompt } from './sanitize.js';

/**
 * JSON schema for the structured PR review response. Exported so routes /
 * tests can assert on it if needed; consumed by the provider for Gemini's
 * structured output mode.
 */
export const PR_REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        overview: { type: 'string' },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        keyChanges: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5
        },
        fileRisks: {
            type: 'array',
            maxItems: 30,
            items: {
                type: 'object',
                properties: {
                    file: { type: 'string' },
                    risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                    reason: { type: 'string' }
                },
                required: ['file', 'risk', 'reason']
            }
        },
        suggestedReviewOrder: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 15
        },
        estimatedReviewTime: { type: 'string' }
    },
    required: ['overview', 'riskLevel', 'keyChanges', 'fileRisks', 'suggestedReviewOrder', 'estimatedReviewTime']
};

/**
 * Generate an AI-powered review summary for a GitHub pull request.
 *
 * Honors DISABLE_AI_REVIEW=true as a kill switch (returns null).
 *
 * @param {object} ctx
 * @param {object} ctx.provider
 * @param {Array} fileManifest - Array of file change objects from GitHub /files API
 * @param {string} topFilePatches - Raw diff patch text for key files
 * @param {object} prMetadata - PR metadata
 * @returns {Promise<object|null>} Structured review summary, or null if disabled
 */
export async function reviewPullRequest(ctx, fileManifest, topFilePatches, prMetadata) {
    if (process.env.DISABLE_AI_REVIEW === 'true') {
        return null;
    }

    const provider = ctx?.provider;
    if (!provider?.model) {
        throw new Error('AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.');
    }

    const systemPrompt = `You are an expert code reviewer analyzing a GitHub pull request.
Provide a structured review summary to help reviewers understand the scope, risk, and focus areas of this PR.
Be concise and actionable. Focus on architectural impact, potential bugs, and review priority.`;

    const prContext = `PR Title: ${sanitizeForPrompt(prMetadata.title, 200)}
Author: ${sanitizeForPrompt(prMetadata.author || prMetadata.user?.login, 100)}
Base branch: ${sanitizeForPrompt(prMetadata.base?.ref || prMetadata.base, 100)}
Head branch: ${sanitizeForPrompt(prMetadata.head?.ref || prMetadata.head, 100)}
Description: ${sanitizeForPrompt(prMetadata.body, 1000) || 'No description provided.'}
Files changed: ${fileManifest?.length || 0}
Additions: ${prMetadata.additions || 'unknown'}
Deletions: ${prMetadata.deletions || 'unknown'}

File manifest (name, status, changes):
${sanitizeForPrompt(JSON.stringify(
    (fileManifest || []).map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes
    })),
    null, 2
), 3000)}`;

    // Two-part contents preserves anti-injection partitioning.
    // We pass parts + generationConfig directly to keep the Gemini-structured
    // response path; the schema triggers JSON parsing in the provider.
    const parts = [
        { text: systemPrompt + '\n\n' + prContext },
        // Diff content is a separate part to mitigate prompt injection
        { text: 'Diff patches for key files:\n```diff\n' + sanitizeForPrompt(topFilePatches, 80000) + '\n```' }
    ];

    const { parsed } = await provider.generate({
        parts,
        schema: PR_REVIEW_SCHEMA,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: PR_REVIEW_SCHEMA,
        },
    });

    return parsed;
}
