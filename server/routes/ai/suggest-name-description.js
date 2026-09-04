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
import logger from '../../lib/logger.js';
import { requireAuth, safeError } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { checkUsageLimit, incrementUsage } from '../../lib/usage-meter.js';
import { checkAISpendCap, recordAISpend } from '../../lib/ai-spend-cap.js';
import { isServerKeyProvider } from '../../lib/ai-provider.js';
import { auditLog } from '../../lib/audit.js';
import { githubApi } from '../../lib/github-api.js';
import { safeJsonParse } from '../../lib/utils.js';
import { generateDeterministic } from '../../lib/suggest-name-description.js';
import { sanitizeForPrompt } from '../../ai-service.js';
import { getResolvedPrompt } from '../../lib/ai-prompt-registry.js';
import { buildContext } from '../../lib/repo-context-builder.js';
import db from '../../db.js';

const router = express.Router();

const bodySchema = z.object({
    repoId: z.coerce.number().int().positive(),
    context: z.object({
        signals: z.object({
            readme: z.boolean().default(true),
            manifest: z.boolean().default(true),
            entrypoints: z.boolean().default(false),
            folderStructure: z.boolean().default(false),
            topics: z.boolean().default(true),
            language: z.boolean().default(true),
        }).default({}),
        customFiles: z.array(z.string().min(1).max(255)).max(5).default([]),
    }).default({}),
});

async function fetchRepoMetadata(repoId, accessToken) {
    const { data } = await githubApi(`/repositories/${repoId}`, accessToken);
    return data;
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
    } catch (e) {
        // SQLite read failure is rare (corrupted db, schema mismatch). Log
        // for observability so a chronic indexing-table problem isn't masked
        // by the graceful null fallback.
        logger.warn({ err: e, userId, repoId }, 'suggest-name-description: repo_metadata lookup failed');
        return null;
    }
}

function buildAIPrompt(userId, { name, description, language, isPrivate, topics, readmeExcerpt, signalsBlock }) {
    return getResolvedPrompt(userId, 'suggest_name_description', {
        name: sanitizeForPrompt(name, 100),
        description: sanitizeForPrompt(description || 'none', 500),
        language: sanitizeForPrompt(language || 'unknown', 50),
        visibility: isPrivate ? 'private' : 'public',
        topics: sanitizeForPrompt(topics?.length ? topics.join(', ') : 'none', 200),
        readme: sanitizeForPrompt(readmeExcerpt || 'none', 1500),
        signals_block: sanitizeForPrompt(signalsBlock || 'none', 8192),
    });
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
        const aiMetadata = loadIndexedAiMetadata(userId, repoId);

        let ctx;
        try {
            ctx = await buildContext({
                accessToken: req.session.accessToken,
                owner: repo.owner?.login,
                repo: repo.name,
                signals: req.validatedBody.context.signals,
                customFiles: req.validatedBody.context.customFiles,
                topicsLanguageInputs: {
                    topics: Array.isArray(repo.topics) ? repo.topics : [],
                    language: repo.language || null,
                },
            });
        } catch (err) {
            // Builder throws on budget violations — surface as 400. The
            // message can name repository file paths, so it goes through
            // safeError rather than straight to the client.
            return res.status(400).json({
                error: safeError(err, 'The selected context exceeds the allowed size. Deselect some signals and retry.'),
                code: 'context_budget_exceeded',
            });
        }

        // Build a concatenated signals block for the prompt template.
        const signalsBlock = ctx.sections.length === 0
            ? '(no signals selected)'
            : ctx.sections.map((s) => `--- ${s.label} (${s.kind}, ${s.bytes}B) ---\n${s.content}`).join('\n\n');

        const generatorInput = {
            name,
            description: repo.description || '',
            language: repo.language || null,
            topics: Array.isArray(repo.topics) ? repo.topics : [],
            readmeExcerpt: (ctx.sections.find((s) => s.kind === 'readme')?.content) || '',
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

        // Monthly spend cap — this route doesn't fit guardedGenerate (its
        // deterministic-fallback flow means a denial should silently drop to
        // the deterministic generator, not error out). Skip the AI attempt
        // entirely when over cap; `source` stays 'deterministic'.
        // BYOK is exempt from the operator's cap — `provider` here is the
        // user's own when they configured a key, so denying them would throttle
        // spend the operator never incurs.
        const billsOperator = isServerKeyProvider(provider);
        if (provider && !checkAISpendCap(userId, { billsOperator }).allowed) {
            req.log.info({ repoId }, 'suggest-name-description: AI spend cap reached, using deterministic');
            provider = null;
        }

        if (provider) {
            try {
                const prompt = buildAIPrompt(userId, {
                    name,
                    description: repo.description,
                    language: repo.language,
                    isPrivate: !!repo.private,
                    topics: ctx.sections.find((s) => s.kind === 'topicsLanguage') ? Array.isArray(repo.topics) ? repo.topics : [] : [],
                    readmeExcerpt: (ctx.sections.find((s) => s.kind === 'readme')?.content) || '',
                    signalsBlock,
                });
                const { text, costUSD } = await provider.generate({ prompt, generationConfig: { maxOutputTokens: 200 } });
                if (billsOperator) recordAISpend(userId, costUSD);
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
        body.confidence = ctx.confidence;
        body.signalsUsed = ctx.signalsUsed;
        body.redactions = ctx.redactions;
        if (ctx.skippedCustomFiles.length > 0) body.skippedCustomFiles = ctx.skippedCustomFiles;
        auditLog(req, 'ai.suggest_name_description', 'repo', `${owner}/${name}`, { source, confidence: ctx.confidence });
        return res.json(body);
    },
);

export default router;
