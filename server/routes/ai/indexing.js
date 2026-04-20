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
import { validate, aiIndexSchema } from '../../lib/validators.js';
import { aiService } from '../../ai-service.js';
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI } from './shared.js';

const router = express.Router();

// ------------------------------------------------------------------
// AI Indexing & Search
// ------------------------------------------------------------------

// Trigger Indexing (Summarize + Embed)
router.post('/ai/index', requireAuth, validate(aiIndexSchema), requireAI, async (req, res) => {
    const { repo } = req.body; // Full repo object from GitHub
    if (!repo) return res.status(400).json({ error: 'Repo data required' });

    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_insights');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

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

        incrementAIUsage(userId, 'ai_insights');
        auditLog(req, 'ai.index', 'ai', repo.id, { repoName: repo.full_name });
        res.json({ success: true, analysis });

    } catch (error) {
        req.log.error({ err: error }, 'AI indexing failed');
        res.status(500).json({ error: safeError(error, 'Indexing failed') });
    }
});

// Semantic Search — available on Free tier (capped by per-feature quota, default 50/month)
router.get('/ai/search', requireAuth, requireAI, async (req, res) => {
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
            return res.status(500).json({ error: safeError(err, 'Similarity search failed') })
        }
    }

    const { q } = req.query;
    if (!q) return res.json([]);

    try {
        const userId = req.session.userId;
        const check = checkAIFeatureLimit(userId, 'ai_semantic_search');
        if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

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
        res.status(500).json({ error: safeError(error, 'Search failed') });
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

// Batch Index - Index multiple repos at once
router.post('/ai/batch-index', requireAuth, requireAI, async (req, res) => {
    const { repos } = req.body; // Array of repo objects
    if (!repos || !Array.isArray(repos)) {
        return res.status(400).json({ error: 'Array of repos required' });
    }

    const userId = req.session.userId;
    const batchCount = Math.min(repos.length, 10);
    const check = checkAIFeatureLimit(userId, 'ai_insights');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    const results = [];
    const limit = batchCount; // Max 10 at a time

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
        skipped: repos.length > 10 ? repos.length - 10 : 0
    });
});

export default router;
