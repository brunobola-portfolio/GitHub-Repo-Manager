/*
 * GitHub Repo Manager - AI Indexing Routes
 *
 * Endpoints:
 *   POST /ai/index
 *   GET  /ai/search
 *   GET  /ai/metadata/:repoId
 *   POST /ai/batch-index
 */

import express from 'express';
import db from '../../db.js';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/api-key-auth.js';
import { aiIndexSchema, aiBatchIndexSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { aiService } from '../../ai-service.js';
import {
    checkUsageLimit,
    checkAIFeatureLimit,
    incrementAIUsage,
    quotaExceededResponse,
    guardedIncrementAIUsage,
    releaseGuardedAIUsage,
} from '../../lib/usage-meter.js';
import { checkAISpendCap, recordAISpend } from '../../lib/ai-spend-cap.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI, handleAIError } from './shared.js';

// Uniform 429 body for a monthly spend-cap denial — mirrors the shape used by
// /ai/chat and guardedGenerate() so the frontend's cap-reached handling works
// identically across every AI surface.
function spendCapDeniedResponse(spend) {
    return {
        code: 'AI_SPEND_CAP_REACHED',
        error: 'Monthly AI spend limit reached. Try again next month or raise the cap.',
        spent_cents: spend.spentCents,
        cap_cents: spend.capCents,
    };
}

const router = express.Router();

// ------------------------------------------------------------------
// AI Indexing & Search
// ------------------------------------------------------------------

// Trigger Indexing (Summarize + Embed)
router.post('/ai/index', requireAuth, requireScope('ai'), validateBody(aiIndexSchema), requireAI, async (req, res) => {
    const { repo } = req.validatedBody; // Full repo object from GitHub
    if (!repo) return res.status(400).json({ error: 'Repo data required' });

    const userId = req.session.userId;
    // Atomic guarded reserve (not a read-only check) — closes the
    // check-then-increment TOCTOU race a plain checkAIFeatureLimit() +
    // later incrementAIUsage() pairing has across the awaited provider calls
    // below. Reserved BEFORE any provider work; released on any failure path.
    const reserved = guardedIncrementAIUsage(userId, 'ai_insights');
    if (!reserved.allowed) return res.status(429).json(quotaExceededResponse(reserved));

    // Monthly spend cap — this endpoint calls the provider twice (analyze +
    // embed) with no per-call count limit for Pro/Enterprise (their count
    // quotas resolve to Infinity), so the spend cap is the only cost guard.
    const spend = checkAISpendCap(userId);
    if (!spend.allowed) {
        releaseGuardedAIUsage(userId, 'ai_insights');
        return res.status(429).json(spendCapDeniedResponse(spend));
    }

    try {
        req.log.info({ repo: repo.full_name }, 'AI indexing started');

        // 1+2. Fetch README and file structure in parallel — both are
        // independent GitHub API calls, no reason to serialise. Each leg
        // soft-fails so a missing README or contents doesn't tank the
        // indexing run.
        const [readmeResult, contentsResult] = await Promise.allSettled([
            githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken),
        ]);

        let readmeContent = '';
        if (readmeResult.status === 'fulfilled') {
            try {
                readmeContent = Buffer.from(readmeResult.value.data.content, 'base64').toString('utf-8');
            } catch (e) {
                req.log.warn({ repo: repo.full_name, err: e }, 'README content decode failed');
            }
        } else {
            // Promise.allSettled buries the real error; inspect reason.status so
            // a "no README" (404) doesn't warn as loudly as an auth/rate-limit
            // failure that actually degrades the indexing prompt.
            const reason = readmeResult.reason;
            if (reason?.status === 404) {
                req.log.debug({ repo: repo.full_name }, 'No README yet on repo (expected)');
            } else {
                req.log.warn({ err: reason, repo: repo.full_name }, 'README fetch failed');
            }
        }

        let fileStructure = [];
        if (contentsResult.status === 'fulfilled') {
            fileStructure = contentsResult.value.data.map(f => ({ name: f.name, type: f.type }));
        } else {
            const reason = contentsResult.reason;
            if (reason?.status === 404) {
                req.log.debug({ repo: repo.full_name }, 'Repo has no top-level contents (empty repo)');
            } else {
                req.log.warn({ err: reason, repo: repo.full_name }, 'contents fetch failed');
            }
        }

        // 3. Generate Analysis (Summary, Health Score, Topics)
        const analysis = await aiService.analyzeRepo(repo, readmeContent, fileStructure);

        // 4. Generate Embedding (Description + Summary + Readme excerpt)
        const textToEmbed = `${repo.name} ${repo.description || ''} ${analysis.summary} ${analysis.suggested_topics.join(' ')}`;
        const embedding = await aiService.embedText(textToEmbed);

        // 5. Save to DB (scoped by user_id for multi-tenancy)
        const stmtMeta = db.prepare(`
            INSERT INTO repo_metadata (repo_id, user_id, summary, topics, health_score, last_indexed)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, repo_id) DO UPDATE SET
                summary = excluded.summary,
                topics = excluded.topics,
                health_score = excluded.health_score,
                last_indexed = CURRENT_TIMESTAMP
        `);

        const stmtEmbed = db.prepare(`
            INSERT INTO repo_embeddings (repo_id, user_id, embedding, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, repo_id) DO UPDATE SET
                embedding = excluded.embedding,
                updated_at = CURRENT_TIMESTAMP
        `);

        db.transaction(() => {
            stmtMeta.run(repo.id, userId, analysis.summary, JSON.stringify(analysis.suggested_topics), analysis.health_score);
            stmtEmbed.run(repo.id, userId, JSON.stringify(embedding));
        })();

        // embedText() has no cost/usage data to surface (Gemini's embed API
        // reports no usageMetadata) — analysis._costUSD (from the analyzeRepo
        // completion call) is the only spend this call can account for.
        recordAISpend(userId, analysis._costUSD);
        // Usage was already reserved atomically above — no separate
        // incrementAIUsage() call (that would double-count this request).
        auditLog(req, 'ai.index', 'ai', repo.id, { repoName: repo.full_name });
        res.json({ success: true, analysis });

    } catch (error) {
        // The reservation succeeded but the guarded work failed — give the
        // unit back so a failed call doesn't permanently burn the user's quota.
        releaseGuardedAIUsage(userId, 'ai_insights');
        req.log.error({ err: error }, 'AI indexing failed');
        handleAIError(res, error, 'Indexing failed');
    }
});

// Semantic Search — available on Free tier (capped by per-feature quota, default 50/month)
router.get('/ai/search', requireAuth, requireScope('ai'), requireAI, async (req, res) => {
    // --- mode=similar-by-id: cosine similarity lookup by repo ID ---
    if (req.query.mode === 'similar-by-id') {
        const repoId = req.query.repoId
        if (!repoId) return res.status(400).json({ error: 'repoId required' })
        try {
            const userId = req.session.userId
            const check = checkAIFeatureLimit(userId, 'ai_semantic_search');
            if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
            const similar = await aiService.findSimilarById(repoId, { topK: 5, excludeSelf: true, userId })
            if (!similar) return res.status(404).json({ error: 'Repository not indexed' })
            incrementAIUsage(userId, 'ai_semantic_search');
            auditLog(req, 'ai.compare', 'ai', repoId, { resultCount: similar.length })
            return res.json({ mode: 'similar-by-id', similar })
        } catch (err) {
            req.log.error({ err }, 'similar-by-id lookup failed')
            // Route AIError through the friendly mapper so quota / rate-limit /
            // overload codes hit the UI as actionable JSON instead of raw text.
            return handleAIError(res, err, 'Similarity search failed')
        }
    }

    const { q } = req.query;
    if (!q) return res.json([]);

    try {
        const userId = req.session.userId;
        const check = checkAIFeatureLimit(userId, 'ai_semantic_search');
        if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

        // Monthly spend cap — semanticSearch() calls embedText() under the
        // hood, an uncapped provider call for Pro/Enterprise. (embed() has no
        // cost/usage data to record post-call — the pre-check is the guard.)
        const spend = checkAISpendCap(userId);
        if (!spend.allowed) return res.status(429).json(spendCapDeniedResponse(spend));

        // Get generic results (repo_ids and scores) scoped by user
        const results = await aiService.semanticSearch(q, 10, userId);

        if (results.length === 0) return res.json([]);

        // Determine which IDs to fetch
        const repoIds = results.map(r => r.repo_id);
        const safeIds = repoIds.slice(0, 100);

        const placeholders = safeIds.map(() => '?').join(',');
        const metas = db.prepare(`SELECT * FROM repo_metadata WHERE user_id = ? AND repo_id IN (${placeholders})`).all(userId, ...safeIds);

        // Merge score + metadata
        const enriched = results.map(r => {
            const meta = metas.find(m => m.repo_id === r.repo_id);
            return { ...r, ...meta };
        });

        incrementAIUsage(userId, 'ai_semantic_search');
        auditLog(req, 'ai.search', 'ai', null, { query: q, resultCount: enriched.length });
        res.json(enriched);

    } catch (error) {
        req.log.error({ err: error }, 'Semantic search failed');
        // semanticSearch can throw AIError (embedding quota, rate-limit, etc.)
        // — route through the same mapper used by other AI endpoints.
        return handleAIError(res, error, 'Search failed');
    }
});

// Get Cached Metadata for a Repo
router.get('/ai/metadata/:repoId', requireAuth, (req, res) => {
    try {
        const meta = db.prepare('SELECT * FROM repo_metadata WHERE user_id = ? AND repo_id = ?').get(req.session.userId, req.params.repoId);
        res.json(meta || null);
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Failed to fetch metadata') });
    }
});

// Get All Cached Metadata for the User
//
// Bulk fetch for surfaces that render many repos at once (RepoList grid,
// Dashboard cards) — one network round-trip instead of N. Returns an array
// of { repo_id, health_score, summary, topics, last_indexed } limited to
// repos the user has indexed (no row = repo never indexed).
router.get('/ai/metadata', requireAuth, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT repo_id, health_score, summary, topics, last_indexed
            FROM repo_metadata
            WHERE user_id = ?
        `).all(req.session.userId);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Failed to fetch metadata index') });
    }
});

// Batch Index - Index multiple repos at once
router.post('/ai/batch-index', requireAuth, requireScope('ai'), validateBody(aiBatchIndexSchema), requireAI, async (req, res) => {
    const { repos } = req.validatedBody; // validated array of repo objects (each full_name regex-checked)

    const userId = req.session.userId;
    const requested = Math.min(repos.length, 10);

    // Quota: each repo consumes one ai_insights + one ai_queries (incrementAIUsage
    // bumps both). A single up-front check let a near-cap user process the whole
    // batch; instead cap the batch to the user's *binding* remaining allowance so
    // N embeds can never exceed the quota the check approved.
    const insightsCheck = checkUsageLimit(userId, 'ai_insights');
    const queriesCheck = checkUsageLimit(userId, 'ai_queries');
    const remaining = Math.max(0, Math.min(insightsCheck.remaining, queriesCheck.remaining));
    if (remaining === 0) {
        const limiting = insightsCheck.remaining <= queriesCheck.remaining
            ? { ...insightsCheck, metric: 'ai_insights' }
            : { ...queriesCheck, metric: 'ai_queries' };
        return res.status(429).json(quotaExceededResponse(limiting));
    }

    const results = [];
    const limit = Math.min(requested, remaining); // Max 10 per call, capped by quota

    // Prepare statements outside the loop for better performance
    const insertMetadata = db.prepare(`
        INSERT INTO repo_metadata (repo_id, user_id, summary, topics, health_score, last_indexed)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_id) DO UPDATE SET
            summary = excluded.summary, topics = excluded.topics,
            health_score = excluded.health_score, last_indexed = CURRENT_TIMESTAMP
    `);

    const insertEmbedding = db.prepare(`
        INSERT INTO repo_embeddings (repo_id, user_id, embedding, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_id) DO UPDATE SET embedding = excluded.embedding, updated_at = CURRENT_TIMESTAMP
    `);

    // Transaction wrapper for batch inserts (100x faster than individual inserts)
    const batchInsertRepos = db.transaction((repoDataArray) => {
        for (const repoData of repoDataArray) {
            insertMetadata.run(
                repoData.repo.id,
                userId,
                repoData.analysis.summary,
                JSON.stringify(repoData.analysis.suggested_topics),
                repoData.analysis.health_score
            );
            insertEmbedding.run(
                repoData.repo.id,
                userId,
                JSON.stringify(repoData.embedding)
            );
        }
    });

    // Collect analyzed data for batch insert
    const analyzedRepos = [];

    for (let i = 0; i < limit; i++) {
        const repo = repos[i];

        // Monthly spend cap — re-checked per item (not just once up front)
        // since a single batch call can make up to 20 provider calls (analyze
        // + embed per repo), which can burn through the remaining allowance
        // partway through a batch that started under cap. Stop processing
        // further repos this call; already-analyzed repos are still saved
        // below and count toward `processed`.
        const spend = checkAISpendCap(userId);
        if (!spend.allowed) {
            req.log.warn({ repo: repo.full_name }, 'Batch index stopped: monthly AI spend cap reached');
            break;
        }

        try {
            // Fetch README
            let readmeContent = '';
            try {
                const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
                readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
            } catch (e) { /* No README */ }

            // Fetch file structure
            let fileStructure = [];
            try {
                const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
                fileStructure = data.map(f => ({ name: f.name, type: f.type }));
            } catch (e) { /* No contents */ }

            // Generate analysis
            const analysis = await aiService.analyzeRepo(repo, readmeContent, fileStructure);

            // Generate embedding
            const textToEmbed = `${repo.name} ${repo.description || ''} ${analysis.summary} ${analysis.suggested_topics?.join(' ') || ''}`;
            const embedding = await aiService.embedText(textToEmbed);

            // Record this item's spend (embedText has no cost data to add —
            // see the /ai/index comment above).
            recordAISpend(userId, analysis._costUSD);

            // Store for batch insert
            analyzedRepos.push({ repo, analysis, embedding });
            results.push({ repo: repo.full_name, success: true, health_score: analysis.health_score });

        } catch (error) {
            req.log.error({ err: error, repo: repo.full_name }, 'Batch index failed for repo');
            results.push({ repo: repo.full_name, success: false, error: safeError(error, 'Analysis failed') });
        }
    }

    // Batch insert all successfully analyzed repos in a single transaction
    try {
        if (analyzedRepos.length > 0) {
            batchInsertRepos(analyzedRepos);
        }
    } catch (error) {
        req.log.error({ err: error }, 'Batch insert failed');
        return res.status(500).json({ error: 'Failed to save indexed data' });
    }

    // Increment usage by number of repos actually processed (not just requested)
    for (let i = 0; i < analyzedRepos.length; i++) {
        incrementAIUsage(userId, 'ai_insights');
    }
    auditLog(req, 'ai.batch_index', 'ai', null, { repoCount: analyzedRepos.length });

    res.json({
        success: true,
        processed: results.length,
        results,
        // Anything not processed this call — over the per-call max of 10,
        // beyond the user's remaining quota, or the spend cap was reached
        // partway through (every attempted repo pushes exactly one results
        // entry, success or failure, so this is exact either way).
        skipped: Math.max(0, repos.length - results.length)
    });
});

export default router;
