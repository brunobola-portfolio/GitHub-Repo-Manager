/*
 * GitHub Repo Manager - AI Suggest Name & Description Route
 *
 * Endpoints:
 *   POST /ai/suggest-name-description — propose a concrete name and description
 *     for a repository, with AI as the primary path and a deterministic
 *     heuristic generator as a silent fallback. Response shape is uniform
 *     regardless of source; only the `source: 'ai' | 'deterministic'` field
 *     differs.
 */

import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { checkUsageLimit, incrementUsage } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { githubApi } from '../../lib/github-api.js';
import { safeJsonParse } from '../../lib/utils.js';
import { generateDeterministic } from '../../lib/suggest-name-description.js';
import { sanitizeForPrompt } from '../../ai-service.js';
import db from '../../db.js';

const router = express.Router();

const bodySchema = z.object({
    repoId: z.coerce.number().int().positive(),
});

const README_EXCERPT_BYTES = 1500;

async function fetchRepoMetadata(repoId, accessToken) {
    const { data } = await githubApi(`/repositories/${repoId}`, accessToken);
    return data;
}

// GitHub's canonical README endpoint resolves README.md / README / readme.md /
// Readme.markdown / etc. transparently, so we don't have to probe candidates.
async function fetchReadmeExcerpt(owner, name, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${name}/readme`, accessToken);
        if (data?.content && data?.encoding === 'base64') {
            const decoded = Buffer.from(data.content, 'base64').toString('utf8');
            return decoded.slice(0, README_EXCERPT_BYTES);
        }
    } catch {
        // README endpoint returns 404 when the repo has no README — treat as empty.
    }
    return '';
}

// Returns the indexed AI metadata row for (userId, repoId), or null when the
// repo has not been indexed by this user. Schema columns of interest:
// `summary`, `topics` (JSON-encoded string).
function loadIndexedAiMetadata(userId, repoId) {
    try {
        const row = db
            .prepare('SELECT summary, topics FROM repo_metadata WHERE user_id = ? AND repo_id = ?')
            .get(userId, repoId);
        if (!row) return null;
        return { summary: row.summary || null };
    } catch {
        return null;
    }
}

function buildAIPrompt({ name, description, language, isPrivate, topics, readmeExcerpt }) {
    return [
        'You are renaming a GitHub repo. Given the metadata below, propose:',
        '- name: kebab-case, 3-5 words, descriptive of WHAT it does (not generic).',
        "  Keep current name if already good (don't rename for the sake of it).",
        '- description: ONE sentence, max 120 chars, no marketing fluff,',
        '  starts with a verb or noun (not "A repo that…").',
        '- rationale: 1 sentence explaining what signals you used.',
        '',
        'Return JSON only: { "name": "...", "description": "...", "rationale": "..." }',
        '',
        `Repo: ${sanitizeForPrompt(name, 100)} (${sanitizeForPrompt(language || 'unknown', 50)}, ${isPrivate ? 'private' : 'public'})`,
        `Current description: ${sanitizeForPrompt(description || 'none', 500)}`,
        `Topics: ${sanitizeForPrompt(topics?.length ? topics.join(', ') : 'none', 200)}`,
        `README excerpt: ${sanitizeForPrompt(readmeExcerpt || 'none', 1500)}`,
    ].join('\n');
}

function clampString(s, max) {
    if (typeof s !== 'string') return '';
    const t = s.trim();
    return t.length > max ? t.slice(0, max) : t;
}

function shapeResponse({ source, current, generated }) {
    const proposedName = clampString(generated.proposed.name || current.name, 100);
    const proposedDesc = clampString(generated.proposed.description ?? '', 500);
    return {
        source,
        current: { name: current.name, description: current.description || '' },
        proposed: { name: proposedName, description: proposedDesc },
        rationale: clampString(generated.rationale || 'Suggestion generated.', 280),
        noChange: {
            name: proposedName === current.name,
            description: (proposedDesc || '') === (current.description || ''),
        },
    };
}

// Note on the absence of `requireAI` middleware: this endpoint is intentionally
// available to users WITHOUT an AI provider configured. The deterministic
// generator works from GitHub data alone (repo metadata + README + indexed
// AI metadata when present) and never requires an AI provider. When a provider
// IS available, the handler attempts an AI suggestion and silently falls back
// to deterministic on parse / network / quota failure.
router.post(
    '/ai/suggest-name-description',
    requireAuth,
    validateBody(bodySchema),
    async (req, res) => {
        const userId = req.session.userId;
        const quota = checkUsageLimit(userId, 'ai_queries');
        if (!quota.allowed) {
            return res.status(429).json({
                error: 'AI query limit exceeded',
                limit: quota.limit,
                current: quota.current,
                upgradeUrl: '/pricing',
            });
        }

        const { repoId } = req.validatedBody;
        let repo;
        try {
            repo = await fetchRepoMetadata(repoId, req.session.accessToken);
        } catch (error) {
            const status = error.status || 500;
            req.log.warn({ err: error, repoId }, 'suggest-name-description: repo lookup failed');
            return res.status(status === 404 ? 404 : 500).json({
                error: status === 404 ? 'Repository not found or no access.' : 'Failed to load repository.',
            });
        }

        const owner = repo.owner?.login;
        const name = repo.name;
        const readmeExcerpt = await fetchReadmeExcerpt(owner, name, req.session.accessToken).catch(() => '');
        const aiMetadata = loadIndexedAiMetadata(userId, repoId);

        const generatorInput = {
            name,
            description: repo.description || '',
            language: repo.language || null,
            topics: Array.isArray(repo.topics) ? repo.topics : [],
            readmeExcerpt,
            aiMetadata,
        };

        let source = 'deterministic';
        let generated = generateDeterministic(generatorInput);

        // Resolve the AI provider lazily — this endpoint is NOT gated by
        // requireAI, so an unconfigured user reaches the handler and gets
        // the deterministic suggestion. When a provider exists, attempt an
        // AI suggestion and override; any failure leaves `source` and
        // `generated` at their deterministic values.
        let provider = req.aiProvider || null;
        if (!provider && typeof req.getAIProvider === 'function') {
            provider = await req.getAIProvider('completion').catch(() => null);
        }

        if (provider) {
            try {
                const prompt = buildAIPrompt({
                    name,
                    description: repo.description,
                    language: repo.language,
                    isPrivate: !!repo.private,
                    topics: generatorInput.topics,
                    readmeExcerpt,
                });
                const { text } = await provider.generate({ prompt, maxTokens: 200 });
                const parsed = safeJsonParse(text);
                if (
                    parsed &&
                    typeof parsed.name === 'string' &&
                    typeof parsed.description === 'string' &&
                    typeof parsed.rationale === 'string'
                ) {
                    source = 'ai';
                    generated = {
                        proposed: { name: parsed.name, description: parsed.description },
                        rationale: parsed.rationale,
                        // noChange computed downstream in shapeResponse
                        noChange: { name: false, description: false },
                    };
                } else {
                    req.log.warn({ repoId }, 'suggest-name-description: AI response invalid, using deterministic');
                }
            } catch (error) {
                req.log.warn({ err: error, repoId }, 'suggest-name-description: AI failed, using deterministic');
            }
        }

        incrementUsage(userId, 'ai_queries');
        const body = shapeResponse({
            source,
            current: { name, description: repo.description || '' },
            generated,
        });
        auditLog(req, 'ai.suggest_name_description', 'repo', `${owner}/${name}`, { source });
        return res.json(body);
    },
);

export default router;
