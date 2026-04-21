// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board AI summary generator — cross-provider.
 *
 * Builds a compact fact sheet of the user's queue, asks the BYOK completion
 * provider for a headline + bullets + urgency score, and returns the parsed
 * response. Tolerates provider text-drift via a best-effort JSON extractor.
 */
import { createProviderForUser } from './ai-provider.js';

export const SYSTEM_PROMPT = `You are a senior engineering lead reviewing a developer's cross-repo work board.
Produce a concise, actionable headline + 3-5 bullets that surface the single
most important thing they should do next.

Rules:
- <= 120 chars in the headline. No emoji. No hedging. Active voice.
- Each bullet <= 160 chars. Reference specific repos, PR numbers, people when helpful.
- Severity: "high" only if it blocks others or is past SLA; "medium" for old-but-not-blocking; "info" for observations.
- urgencyScore 0..1: 0.0 = quiet day, 1.0 = drop everything.
- Never invent items. If the input has no urgent work, say so and propose one quick win.
- Output ONLY valid JSON matching the provided schema. No prose.`;

export const SUMMARY_SCHEMA = {
    type: 'object',
    required: ['headline', 'bullets', 'urgencyScore'],
    properties: {
        headline: { type: 'string', maxLength: 200 },
        bullets: {
            type: 'array', minItems: 1, maxItems: 5,
            items: {
                type: 'object',
                required: ['text', 'severity'],
                properties: {
                    text: { type: 'string', maxLength: 240 },
                    severity: { enum: ['high', 'medium', 'info'] },
                    link: {
                        type: 'object',
                        properties: {
                            type: { enum: ['pr', 'issue'] },
                            repo: { type: 'string' },
                            number: { type: 'integer' },
                        },
                    },
                },
            },
        },
        urgencyScore: { type: 'number', minimum: 0, maximum: 1 },
    },
};

function topN(arr, n = 5) { return Array.isArray(arr) ? arr.slice(0, n) : []; }

export function buildFactSheet({ reviews = [], stalePRs = [], issues = [], techDebt = { items: [], hotspots: [] } } = {}) {
    const lines = [];
    lines.push(`pending reviews: ${reviews.length}`);
    topN(reviews).forEach(r => lines.push(`  ${r.repoFullName}#${r.prNumber} "${r.title || ''}" by ${r.authorLogin || '?'} age=${r.ageHours ?? '?'}h`));
    lines.push(`stale PRs: ${stalePRs.length}`);
    topN(stalePRs).forEach(p => lines.push(`  ${p.repoFullName}#${p.prNumber} "${p.title || ''}" age=${p.ageDays ?? '?'}d`));
    lines.push(`open issues: ${issues.length}`);
    topN(issues).forEach(i => lines.push(`  ${i.repoFullName}#${i.issueNumber} "${i.title || ''}" labels=[${(i.labels || []).join(',')}] age=${i.ageDays ?? '?'}d`));
    const items = techDebt?.items || [];
    lines.push(`tech debt: ${items.length}`);
    topN(items).forEach(i => lines.push(`  ${i.repoFullName}#${i.issueNumber} "${i.title || ''}" age=${i.ageDays ?? '?'}d`));
    const hotspots = techDebt?.hotspots || [];
    if (hotspots.length > 0) {
        lines.push(`debt hotspots: ${hotspots.slice(0, 3).map(h => `${h.repoFullName}(${h.count})`).join(', ')}`);
    }
    return lines.join('\n');
}

function extractJsonFromText(text) {
    if (typeof text !== 'string') return null;
    const fence = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(text);
    const candidate = fence ? fence[1] : text;
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first === -1 || last === -1 || last < first) return null;
    try { return JSON.parse(candidate.slice(first, last + 1)); }
    catch { return null; }
}

function makeAIError(code, message) {
    const err = new Error(message ? `${code}: ${message}` : code);
    err.code = code;
    return err;
}

/**
 * @param {{ userId: number, dataSources: { reviews, stalePRs, issues, techDebt } }} args
 */
export async function generateSummary({ userId, dataSources }) {
    const provider = await createProviderForUser(userId, 'completion', { featureKey: 'WORK_BOARD_SUMMARY' });
    if (!provider) throw makeAIError('ai_not_configured', 'AI is not configured for this user');

    const prompt = buildFactSheet(dataSources);
    const result = await provider.generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        schema: SUMMARY_SCHEMA,
    });

    const parsed = result?.parsed || extractJsonFromText(result?.text);
    if (!parsed || typeof parsed.headline !== 'string' || !Array.isArray(parsed.bullets) || parsed.bullets.length === 0) {
        throw makeAIError('ai_invalid_response', 'AI provider returned an invalid response');
    }

    return {
        headline: String(parsed.headline).slice(0, 200),
        bullets: parsed.bullets.slice(0, 5),
        urgencyScore: Math.min(1, Math.max(0, Number(parsed.urgencyScore) || 0)),
        model: provider.modelName || null,
        provider: provider.type || null,
    };
}
