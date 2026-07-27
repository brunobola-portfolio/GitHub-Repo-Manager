// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board AI summary generator — cross-provider.
 *
 * Builds a compact fact sheet of the user's queue, asks the BYOK completion
 * provider for a headline + bullets + urgency score, and returns the parsed
 * response. Tolerates provider text-drift via a best-effort JSON extractor.
 */
import { createProviderForUser, AI_ERROR_CODE, isServerKeyProvider } from './ai-provider.js';

export const SYSTEM_PROMPT = `You are a senior engineering lead reviewing a developer's cross-repo work board.
Produce a concise, actionable headline + 3-5 bullets that surface the single
most important thing they should do next.

Rules:
- <= 120 chars in the headline. No emoji. No hedging. Active voice.
- Each bullet <= 160 chars. Reference specific repos, PR numbers, people when helpful.
- Severity: "high" only if it blocks others or is past SLA; "medium" for old-but-not-blocking; "info" for observations.
- urgencyScore 0..1: 0.0 = quiet day, 1.0 = drop everything.
- Never invent items. If the input has no urgent work, say so and propose one quick win.
- If trend data is present, lead the headline with the single most significant week-over-week change (e.g. "Stale PRs up 50% — 3 in org/api untouched for 14+ days"). Do not mention trend if no snapshots provided.
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
                    // Gemini requires `type: 'string'` alongside `enum` — a bare enum
                    // is rejected with "only allowed for STRING type". Anthropic /
                    // OpenAI ignore the redundant hint.
                    severity: { type: 'string', enum: ['high', 'medium', 'info'] },
                    link: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['pr', 'issue'] },
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

export function buildFactSheet({ reviews = [], stalePRs = [], issues = [], techDebt = { items: [], hotspots: [] }, trend7d } = {}) {
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

    if (Array.isArray(trend7d) && trend7d.length >= 2) {
        lines.push('');
        lines.push('trend 7d (daily snapshots, oldest first):');
        trend7d.forEach(s => {
            const d = s.snappedAt.slice(0, 10);
            lines.push(`  ${d}: reviews=${s.reviews} stale=${s.stalePRs} issues=${s.issues} debt=${s.techDebt}`);
        });
        const first = trend7d[0];
        const last = trend7d[trend7d.length - 1];
        const delta = (fKey) => {
            const a = first[fKey];
            const b = last[fKey];
            if (a === 0) return b === 0 ? '+0%' : '+∞';
            const pct = Math.round(((b - a) / a) * 100);
            return pct >= 0 ? `+${pct}%` : `${pct}%`;
        };
        lines.push(`delta vs 7d ago: reviews=${delta('reviews')} stale_prs=${delta('stalePRs')} issues=${delta('issues')} tech_debt=${delta('techDebt')}`);
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

// ---------------------------------------------------------------------------
// Bullet normalisation
// ---------------------------------------------------------------------------
//
// Schema-following providers (Claude, GPT-4.x, Gemini Pro) emit bullets in
// our exact shape: { text, severity, link?: { type, repo, number } }.
//
// Free-tier / non-compliant models routinely improvise common field names —
// `content`, `body`, `description` for the text; `repo` + `prNumber` /
// `issueNumber` at the top level instead of a nested `link`. Without
// normalisation those bullets render as empty dots in the UI (the actual bug
// the user hit with minimax-m2.5:free — see screenshot 2026-05-12).
//
// We canonicalise into our shape and drop empty bullets so the UI never
// shows degenerate dots.

const BULLET_TEXT_ALIASES = ['text', 'content', 'body', 'description', 'message', 'bullet', 'point'];
const BULLET_LINK_NUMBER_ALIASES = ['number', 'prNumber', 'issueNumber', 'pr_number', 'issue_number', 'id'];
const BULLET_LINK_REPO_ALIASES = ['repo', 'repoFullName', 'repository', 'repo_full_name'];

function pickFirstString(obj, keys) {
    for (const k of keys) {
        const v = obj?.[k];
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return null;
}

function pickFirstInt(obj, keys) {
    for (const k of keys) {
        const v = obj?.[k];
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) return n;
    }
    return null;
}

function normalizeBullet(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const text = pickFirstString(raw, BULLET_TEXT_ALIASES);
    if (!text) return null;

    const severityRaw = typeof raw.severity === 'string' ? raw.severity.toLowerCase() : null;
    const severity = ['high', 'medium', 'info'].includes(severityRaw) ? severityRaw : 'info';

    // Link: prefer existing nested link object, otherwise hoist top-level
    // repo + number into the canonical shape. Type defaults to 'pr' when a
    // PR-flavoured key was used and 'issue' when it was; otherwise null.
    let link = null;
    if (raw.link && typeof raw.link === 'object') {
        const repo = pickFirstString(raw.link, BULLET_LINK_REPO_ALIASES);
        const number = pickFirstInt(raw.link, BULLET_LINK_NUMBER_ALIASES);
        const typeRaw = typeof raw.link.type === 'string' ? raw.link.type.toLowerCase() : null;
        const type = typeRaw === 'pr' || typeRaw === 'issue' ? typeRaw : null;
        if (repo && number) link = { type: type || 'pr', repo, number };
    }
    if (!link) {
        const repo = pickFirstString(raw, BULLET_LINK_REPO_ALIASES);
        const number = pickFirstInt(raw, BULLET_LINK_NUMBER_ALIASES);
        if (repo && number) {
            const inferIssue = 'issueNumber' in raw || 'issue_number' in raw;
            link = { type: inferIssue ? 'issue' : 'pr', repo, number };
        }
    }

    return link ? { text, severity, link } : { text, severity };
}

function normalizeBullets(rawBullets) {
    if (!Array.isArray(rawBullets)) return [];
    const out = [];
    for (const b of rawBullets) {
        const n = normalizeBullet(b);
        if (n) out.push(n);
        if (out.length === 5) break;
    }
    return out;
}

function isValidSummaryShape(parsed) {
    return parsed
        && typeof parsed.headline === 'string'
        && parsed.headline.trim().length > 0
        && Array.isArray(parsed.bullets)
        && parsed.bullets.length > 0;
}

/**
 * Resolve the provider this summary would run on, without generating anything.
 *
 * The route needs it before it can decide whether the operator's spend cap
 * applies (it does not for BYOK), and resolving twice would double the
 * endpoint-safety DNS checks in createProviderForUser.
 */
export async function resolveSummaryProvider(userId) {
    return createProviderForUser(userId, 'completion', { featureKey: 'WORK_BOARD_SUMMARY' });
}

/**
 * @param {{ userId: number, dataSources: { reviews, stalePRs, issues, techDebt },
 *           provider?: object }} args — `provider` reuses one the caller already
 *           resolved via resolveSummaryProvider; omitted, it is resolved here.
 */
export async function generateSummary({ userId, dataSources, provider: preResolved }) {
    const provider = preResolved || await resolveSummaryProvider(userId);
    if (!provider) throw makeAIError('ai_not_configured', 'AI is not configured for this user');

    const prompt = buildFactSheet(dataSources);
    const baseArgs = { prompt, systemPrompt: SYSTEM_PROMPT };

    // First pass — ask the provider to honour the structured schema. Compliant
    // providers (Claude, GPT-4.x, Gemini Pro, paid OpenRouter routes) return
    // parseable JSON here. Free-tier models often emit prose around the JSON
    // or ignore response_format entirely and trip the provider's strict
    // JSON.parse — that path raises AIError(INVALID_RESPONSE).
    let parsed = null;
    let costUSD = null;
    try {
        const result = await provider.generate({ ...baseArgs, schema: SUMMARY_SCHEMA });
        parsed = result?.parsed || extractJsonFromText(result?.text);
        costUSD = result?.costUSD ?? null;
    } catch (firstErr) {
        // Auth, rate-limit, quota, network, timeout — rethrow as-is so the
        // route can map them to the right HTTP status. Only INVALID_RESPONSE
        // is recoverable via a schema-less retry.
        const isParseFailure = firstErr?.name === 'AIError'
            && firstErr.code === AI_ERROR_CODE.INVALID_RESPONSE;
        if (!isParseFailure) throw firstErr;
    }

    // Pre-normalise bullets so models that improvise field names (content,
    // body, repo+prNumber at top level…) still produce a useful card.
    let normalizedBullets = parsed ? normalizeBullets(parsed.bullets) : [];

    if (!isValidSummaryShape(parsed) || normalizedBullets.length === 0) {
        // Second pass — drop the response_format constraint and rely on
        // extractJsonFromText to peel JSON out of code fences or surrounding
        // prose. This is the "free-tier-model lifeboat": it keeps the AI
        // summary working when the model can answer the prompt but cannot
        // follow structured-output instructions reliably.
        try {
            const fallbackResult = await provider.generate(baseArgs);
            parsed = extractJsonFromText(fallbackResult?.text);
            costUSD = fallbackResult?.costUSD ?? costUSD;
        } catch (secondErr) {
            // A second-attempt failure on a non-parse axis (auth, network…)
            // is the *real* error — preserve its AIError code.
            if (secondErr?.name === 'AIError') throw secondErr;
            throw makeAIError('ai_invalid_response', 'AI provider returned an invalid response');
        }
        normalizedBullets = parsed ? normalizeBullets(parsed.bullets) : [];
        if (!isValidSummaryShape(parsed) || normalizedBullets.length === 0) {
            throw makeAIError('ai_invalid_response', 'AI provider returned an invalid response');
        }
    }

    return {
        headline: String(parsed.headline).slice(0, 200),
        bullets: normalizedBullets,
        urgencyScore: Math.min(1, Math.max(0, Number(parsed.urgencyScore) || 0)),
        model: provider.modelName || null,
        provider: provider.type || null,
        // Additive — the route strips this before caching/responding; it
        // exists so the caller can record the monthly AI spend cap without
        // this module reaching the spend-cap ledger itself.
        costUSD,
        // Whether that cost landed on the operator's bill. The provider is
        // resolved in here, so the route cannot work this out for itself, and
        // recording a BYOK user's spend against the operator's cap would
        // throttle someone costing the operator nothing.
        billsOperator: isServerKeyProvider(provider),
    };
}
