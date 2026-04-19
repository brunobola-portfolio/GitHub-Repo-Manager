/*
 * GitHub Repo Manager - AI Routes
 *
 * Handles all /api/ai/* endpoints including:
 * - Chat with AI assistant
 * - Repository suggestions
 * - README generation and enhancement
 * - Repository indexing and semantic search
 * - Quality reports
 * - Batch indexing
 * - AI metadata retrieval
 *
 * Also handles /api/config/ai-status
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../db.js';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, createRequireAI, safeError, isValidGitHubFullName } from '../middleware/auth.js';
import { validate, aiChatSchema, aiIndexSchema, migrationSizeStrategySchema, migrationDescriptionSchema } from '../lib/validators.js';
import { defaultRepoDescription, sanitizeRepoDescription, REPO_DESCRIPTION_MAX } from '../lib/repo-description.js';
import { aiService, sanitizeForPrompt } from '../ai-service.js';
import { safeJsonParse } from '../lib/utils.js';
import { checkUsageLimit, incrementUsage, checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../lib/usage-meter.js';
import { auditLog } from '../lib/audit.js';
import { initSSE, streamGeminiToSSE, streamToSSE } from './ai-streaming.js';
import { AIError, AI_ERROR_CODE } from '../lib/ai-provider.js';

const router = express.Router();

// Create requireAI middleware from the factory
const requireAI = createRequireAI(aiService);

/** Shared AI error handler — maps common AI errors to user-friendly responses. */
function handleAIError(res, error, fallbackMessage = 'Failed to generate AI response. Please try again later.') {
    // Prefer typed AIError codes; fall back to legacy string/status matching for
    // errors that haven't been converted yet (e.g. raw SDK errors on legacy paths).
    const code = error instanceof AIError ? error.code : null;

    if (code === AI_ERROR_CODE.NOT_FOUND || (!code && (error.message?.includes('not found') || error.status === 404))) {
        return res.status(404).json({
            error: 'The configured AI model is not available. Please verify the GEMINI_MODEL setting.',
            code: 'MODEL_NOT_FOUND'
        });
    }
    if (code === AI_ERROR_CODE.AUTH || (!code && (error.message?.includes('API key') || error.status === 401))) {
        return res.status(401).json({
            error: 'Invalid or expired Gemini API key. Please check your GEMINI_API_KEY in .env file.',
            code: 'INVALID_API_KEY'
        });
    }
    if (code === AI_ERROR_CODE.QUOTA || (!code && (error.message?.includes('quota') || error.status === 429))) {
        return res.status(429).json({
            error: 'API quota exceeded. Please try again later or check your Gemini API usage limits.',
            code: 'QUOTA_EXCEEDED'
        });
    }
    if (code === AI_ERROR_CODE.OVERLOAD || (!code && (error.status === 503 || /overload|unavailable|high demand/i.test(error.message || '')))) {
        return res.status(503).json({
            error: 'Gemini is under heavy load right now. Give it a moment and try again.',
            code: 'AI_OVERLOADED'
        });
    }
    return res.status(500).json({ error: fallbackMessage, code: 'AI_REQUEST_FAILED' });
}

/**
 * Invoke model.generateContent with one automatic retry on transient 503 overload.
 * Keeps total added latency bounded (~400ms) so user-facing requests don't stall.
 * Works with both raw SDK model objects and AIError-typed errors.
 */
async function generateWithRetry(model, request, { retries = 1, delayMs = 400 } = {}) {
    let lastError
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await model.generateContent(request)
        } catch (err) {
            lastError = err
            const isOverload = (err instanceof AIError && err.code === AI_ERROR_CODE.OVERLOAD)
                || err?.status === 503
                || /overload|unavailable|high demand/i.test(err?.message || '')
            if (!isOverload || attempt === retries) break
            await new Promise(r => setTimeout(r, delayMs))
        }
    }
    throw lastError
}

// ------------------------------------------------------------------
// AI Configuration Status
// ------------------------------------------------------------------

// Check AI Configuration Status (mounted at /config/ai-status from index.js)
// Note: This is also available via the router's own mount point
router.get('/config/ai-status', (req, res) => {
    const configured = !!process.env.GEMINI_API_KEY || !!aiService.model;
    res.json({ configured, provider: configured ? 'gemini' : null });
});

// ------------------------------------------------------------------
// AI Chat
// ------------------------------------------------------------------

router.post('/ai/chat', requireAuth, validate(aiChatSchema), requireAI, async (req, res) => {
    try {
        // Check usage limits
        const usage = checkUsageLimit(req.session.userId, 'ai_queries');
        if (!usage.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `You've used ${usage.current}/${usage.limit} AI queries this month`,
                remaining: usage.remaining,
            });
        }

        const { message, context } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: 'Please provide a message to send to the AI assistant.',
                code: 'MESSAGE_REQUIRED'
            });
        }

        // Use configured model from environment or default
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

        // Legacy path: req.aiProvider is the new abstraction; req.genAI is the raw SDK.
        // ai/chat still uses generateWithRetry for its retry semantics, so we use
        // req.genAI.getGenerativeModel to get a model handle for that helper.
        let model;
        try {
            model = req.genAI.getGenerativeModel({ model: modelName });
        } catch (modelError) {
            req.log.error({ err: modelError, model: modelName }, 'Failed to load AI model');
            return res.status(503).json({
                error: `AI model "${modelName}" is not available. Please check your configuration.`,
                code: 'MODEL_UNAVAILABLE'
            });
        }

        const systemPrompt = `You are an expert GitHub Repository Manager Assistant.
Your goal is to help users manage their repositories, analyze code, and suggest improvements.

You ALWAYS reply as JSON matching this exact shape:
{
  "reply": "<markdown text, concise and professional>",
  "actions": [ { "type": "<action>", "label": "<short button text in the user's language>" } ]
}

The "actions" array is OPTIONAL. Include an action ONLY when the user's request maps clearly to one of the whitelisted types below. Never invent action types. Never include more than one action of the same type. Keep labels short (max 32 chars) and localized to the user's language.

Whitelisted action types:
- "open_migration_wizard": opens the Azure DevOps → GitHub migration wizard. Use when the user wants to migrate, import, or move repositories from Azure DevOps.
- "open_migration_history": shows past migration jobs. Use when the user asks about past migrations, status, logs, or history.
- "open_create_repo": opens the create repository modal. Use when the user wants to create, start, or initialize a new repository.
- "open_transfer": opens the repository transfer modal. Use when the user wants to transfer ownership of a repo to another org/user.
- "open_settings": opens the app settings modal. Use when the user wants to change preferences, configure API keys, or adjust the app.

If the user just asks a question, answer in "reply" and omit "actions".

Current context: ${JSON.stringify(context || {}, null, 2)}

User message: ${message}`;

        const result = await generateWithRetry(model, {
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'object',
                    properties: {
                        reply: { type: 'string' },
                        actions: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string' },
                                    label: { type: 'string' },
                                },
                                required: ['type', 'label'],
                            },
                        },
                    },
                    required: ['reply'],
                },
            },
        });
        const response = await result.response;
        const text = response.text();

        const parsed = safeJsonParse(text);
        if (!parsed || typeof parsed.reply !== 'string') {
            req.log.warn({ text }, 'AI chat returned non-JSON or missing reply');
            return res.status(502).json({
                error: 'AI returned an invalid response. Please retry.',
                code: 'AI_PARSE_ERROR',
            });
        }

        incrementUsage(req.session.userId, 'ai_queries');
        auditLog(req, 'ai.chat', 'ai', null, { messageLength: message.length });

        res.json({
            reply: parsed.reply,
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        });
    } catch (error) {
        req.log.error({ err: error }, 'AI chat failed');
        handleAIError(res, error);
    }
});

// ------------------------------------------------------------------
// AI Suggestions
// ------------------------------------------------------------------

router.post('/ai/suggest', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkUsageLimit(userId, 'ai_queries');
    if (!check.allowed) {
        return res.status(429).json({
            error: 'AI query limit exceeded',
            limit: check.limit,
            current: check.current,
            upgradeUrl: '/pricing'
        });
    }
    try {
        const { repo } = req.body;

        if (!repo) {
            return res.status(400).json({
                error: 'Repository data is required for suggestions.',
                code: 'REPO_REQUIRED'
            });
        }

        const prompt = `Analyze this GitHub repository metadata and suggest 3 concrete improvements.
    Focus on: Description clarity, Topics (SEO), and Community standards (License, Contributing).

    Repository: ${JSON.stringify(repo, null, 2)}

    Return the response as a JSON object with this structure:
    {
      "suggestions": [
        { "title": "...", "description": "...", "type": "improvement" }
      ],
      "analysis": "Brief summary of the repo's current state"
    }
    Do not include markdown formatting in the JSON output, just raw JSON.`;

        const { text } = await req.aiProvider.generate({ prompt });

        const parsed = safeJsonParse(text);
        if (!parsed) {
            return res.status(502).json({ error: 'AI returned an invalid response. Please retry.', code: 'AI_PARSE_ERROR' });
        }
        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai.suggest', 'ai', null, { repoName: repo?.name });
        res.json(parsed);
    } catch (error) {
        req.log.error({ err: error }, 'AI suggest failed');
        handleAIError(res, error, 'Failed to generate suggestions. Please try again later.');
    }
});

// ------------------------------------------------------------------
// AI README Generation
// ------------------------------------------------------------------

router.post('/ai/readme', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_readme');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const repo = req.body.repo || req.body;
        const repoName = repo?.name || req.body.name;
        if (!repoName) return res.status(400).json({ error: 'repo required' });

        const cleanName = sanitizeForPrompt(repoName, 200);
        const cleanDescription = sanitizeForPrompt(repo?.description || req.body.description || '', 500);
        const cleanLanguage = sanitizeForPrompt(repo?.language || req.body.language || '', 100);
        const rawTopics = repo?.topics || req.body.topics;
        const cleanTopics = sanitizeForPrompt(Array.isArray(rawTopics) ? rawTopics.join(', ') : (rawTopics || ''), 500);

        const prompt = `Generate a professional, high-quality README.md for a GitHub repository.

    Project Name: ${cleanName}
    Description: ${cleanDescription || 'No description provided.'}
    Primary Language: ${cleanLanguage || 'Not specified'}
    Topics: ${cleanTopics || 'None'}

    Structure:
    1. Title & Badges
    2. Project Description (Expanded)
    3. Key Features
    4. Installation & Usage
    5. Contributing
    6. License

    Make it sound exciting and professional.`;

        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const { text } = await req.aiProvider.generate({ prompt });

        incrementAIUsage(userId, 'ai_readme');
        auditLog(req, 'ai.readme', 'ai', null, { repoName: cleanName, model: modelName });
        res.json({ success: true, readme: text, model: modelName });
    } catch (err) {
        req.log.error({ err }, 'AI README generation failed');
        res.status(500).json({ error: safeError(err, 'Failed to generate README') });
    }
});

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
            req.log.warn({ repo: repo.full_name }, 'No README found');
        }

        let fileStructure = [];
        if (contentsResult.status === 'fulfilled') {
            fileStructure = contentsResult.value.data.map(f => ({ name: f.name, type: f.type }));
        } else {
            req.log.warn({ repo: repo.full_name }, 'Could not fetch contents');
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

// Enhanced README endpoint - Improve existing README
router.post('/ai/readme/enhance', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_readme');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

        // Fetch current README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            req.log.warn({ repo: repo.full_name }, 'No README found');
        }

        // Fetch file structure
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            req.log.warn({ repo: repo.full_name }, 'Could not fetch contents');
        }

        const result = await aiService.enhanceReadme(readmeContent, repo, fileStructure);
        incrementAIUsage(userId, 'ai_readme');
        auditLog(req, 'ai.readme.enhance', 'ai', null, { repoName: repo.full_name });
        res.json({ success: true, ...result, currentReadme: readmeContent });

    } catch (error) {
        req.log.error({ err: error }, 'README enhancement failed');
        res.status(500).json({ error: safeError(error, 'Failed to enhance README') });
    }
});

// Quality Report - Comprehensive repo health analysis
router.post('/ai/quality-report', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_insights');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

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

        const report = await aiService.generateQualityReport(repo, readmeContent, fileStructure);
        incrementAIUsage(userId, 'ai_insights');
        auditLog(req, 'ai.quality_report', 'ai', null, { repoName: repo.full_name });
        res.json({ success: true, report, repo: repo.full_name });

    } catch (error) {
        req.log.error({ err: error }, 'Quality report generation failed');
        res.status(500).json({ error: safeError(error, 'Failed to generate quality report') });
    }
});

// ------------------------------------------------------------------
// AI PR Review Summary
// ------------------------------------------------------------------

// Generate an AI-powered PR review summary
router.post('/ai/review-summary', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkUsageLimit(userId, 'ai_queries');
    if (!check.allowed) {
        return res.status(429).json({
            error: 'AI query limit exceeded',
            limit: check.limit,
            current: check.current,
            upgradeUrl: '/pricing'
        });
    }

    try {
        if (process.env.DISABLE_AI_REVIEW === 'true') {
            return res.status(404).json({
                error: 'AI review summaries are disabled on this server.',
                code: 'AI_REVIEW_DISABLED'
            });
        }

        const { fileManifest, topFilePatches, prMetadata } = req.body;

        if (!fileManifest || !prMetadata) {
            return res.status(400).json({
                error: 'fileManifest and prMetadata are required.',
                code: 'VALIDATION_ERROR'
            });
        }

        if (req.query.stream === 'true') {
            // Streaming branch: build prompt inline, stream raw text, parse on completion
            const sse = initSSE(res);
            try {
                const systemPrompt = `You are an expert code reviewer analyzing a GitHub pull request.
Provide a structured review summary. Respond with ONLY valid JSON:
{"overview":"...","riskLevel":"low|medium|high|critical","keyChanges":["..."],"fileRisks":[{"file":"...","risk":"low|medium|high","reason":"..."}],"suggestedReviewOrder":["..."],"estimatedReviewTime":"..."}`;

                const prContext = `PR: ${sanitizeForPrompt(prMetadata.title, 200)}
Files: ${fileManifest?.length || 0}, +${prMetadata.additions || 0} -${prMetadata.deletions || 0}
File manifest: ${sanitizeForPrompt(JSON.stringify((fileManifest || []).map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))), 3000)}`;

                const patchText = sanitizeForPrompt(
                    (topFilePatches || []).map(f => `${f.filename}:\n${f.patch || ''}`).join('\n---\n'),
                    80000
                );

                const textStream = req.aiProvider.generateStream({
                    prompt: systemPrompt + '\n\n' + prContext + '\n\nDiff:\n' + patchText,
                    signal: sse.signal,
                });
                const raw = await streamToSSE(textStream, sse);

                let parsed;
                try {
                    parsed = JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
                } catch {
                    parsed = { overview: raw, riskLevel: 'medium', keyChanges: [], fileRisks: [], suggestedReviewOrder: [], estimatedReviewTime: 'unknown' };
                }

                // Normalize field names to match QuickSummary expectations
                const normalized = {
                    overallRisk: parsed.riskLevel || parsed.overallRisk || 'medium',
                    overview: parsed.overview || '',
                    keyChanges: parsed.keyChanges || [],
                    fileRisks: (parsed.fileRisks || []).map(f => ({
                        filename: f.file || f.filename || '',
                        level: f.risk || f.level || 'low',
                        reason: f.reason || '',
                    })),
                    suggestedReviewOrder: parsed.suggestedReviewOrder || [],
                    estimatedReviewTime: parsed.estimatedReviewTime || '',
                };

                incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai.review_summary', 'ai', null, { repo: prMetadata?.repo, fileCount: fileManifest?.length, streamed: true });

                sse.sendDone(normalized);
            } catch (err) {
                sse.sendError('Failed to generate review summary');
            }
            return;
        }

        // Non-streaming (existing behavior)
        const summary = await aiService.reviewPullRequest(fileManifest, topFilePatches, prMetadata);

        if (summary === null) {
            return res.status(404).json({
                error: 'AI review summaries are disabled on this server.',
                code: 'AI_REVIEW_DISABLED'
            });
        }

        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai.review_summary', 'ai', null, {
            repo: prMetadata?.repo,
            prNumber: prMetadata?.number,
            fileCount: fileManifest?.length
        });
        res.json({ success: true, summary });
    } catch (error) {
        req.log.error({ err: error }, 'AI PR review summary failed');
        res.status(500).json({ error: safeError(error, 'Failed to generate review summary') });
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

// ------------------------------------------------------------------
// Dev Toolkit — Generate Commit Message
// ------------------------------------------------------------------

router.post('/ai/generate-commit', requireAuth, requireAI, async (req, res) => {
    try {
        const { diff, format = 'conventional', repo_style, repo_context } = req.body;

        if (!diff || typeof diff !== 'string' || diff.trim().length === 0) {
            return res.status(400).json({ error: 'diff is required' });
        }

        const userId = req.session.userId;
        const limit = checkAIFeatureLimit(userId, 'ai_commit');
        if (!limit.allowed) return res.status(429).json(quotaExceededResponse(limit));

        const formatInstructions = {
            conventional: 'Use Conventional Commits format: type(scope): description. Types: feat, fix, chore, refactor, docs, style, perf, test, build, ci, revert.',
            gitmoji: 'Use Gitmoji format: :emoji: description. Use standard gitmoji codes like :sparkles:, :bug:, :recycle:, :memo:, :art:, etc.',
            descriptive: 'Use a clear, descriptive sentence in imperative mood. Example: "Add user login functionality with JWT tokens".',
            'repo-convention': repo_style
                ? `Mimic this repository's commit style. Detected pattern: "${repo_style.pattern}". Examples from repo: ${(repo_style.examples || []).join('; ')}.`
                : 'Use Conventional Commits format as fallback.',
        };

        const safeDiff = sanitizeForPrompt(diff, 12000);
        const contextLine = repo_context?.name
            ? `Repository: ${repo_context.name}${repo_context.description ? ` — ${repo_context.description}` : ''}\n`
            : '';

        const systemPrompt = `You are a commit message generator. ${formatInstructions[format] || formatInstructions.conventional}

${contextLine}Respond with ONLY valid JSON in this exact shape:
{"subject": "the commit subject line", "body": "optional multi-line body or empty string"}

Rules:
- subject must be under 72 characters
- body uses bullet points with "- " prefix if present
- No markdown fences, no explanation, ONLY the JSON object`;

        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: '{"subject": "", "body": ""}' }] }] });

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const streamResult = await chat.sendMessageStream(`Generate a commit message for this diff:\n\n${safeDiff}`);
                const raw = await streamGeminiToSSE(streamResult, sse);

                let parsed;
                try {
                    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    parsed = JSON.parse(cleaned);
                } catch {
                    parsed = { subject: raw.split('\n')[0], body: '' };
                }
                const message = parsed.body ? `${parsed.subject}\n\n${parsed.body}` : parsed.subject;

                incrementAIUsage(userId, 'ai_commit');
                auditLog(req, 'ai_generate_commit', 'ai', null, { format, diff_length: diff.length, streamed: true });

                sse.sendDone({ message, subject: parsed.subject, body: parsed.body || '', format_used: format });
            } catch (err) {
                sse.sendError('Failed to generate commit message');
            }
            return;
        }

        const result = await chat.sendMessage(`Generate a commit message for this diff:\n\n${safeDiff}`);
        const raw = result.response.text().trim();

        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            parsed = JSON.parse(cleaned);
        } catch {
            parsed = { subject: raw.split('\n')[0], body: '' };
        }

        const message = parsed.body
            ? `${parsed.subject}\n\n${parsed.body}`
            : parsed.subject;

        incrementAIUsage(userId, 'ai_commit');
        auditLog(req, 'ai_generate_commit', 'ai', null, { format, diff_length: diff.length });

        res.json({
            message,
            subject: parsed.subject,
            body: parsed.body || '',
            format_used: format,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Generate commit message failed');
        res.status(500).json({ error: safeError(error, 'Failed to generate commit message') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Generate PR Description
// ------------------------------------------------------------------

router.post('/ai/generate-pr', requireAuth, requireAI, async (req, res) => {
    try {
        const { commits, diff_summary, top_patches, template, repo_context } = req.body;

        if (!commits || !Array.isArray(commits) || commits.length === 0) {
            return res.status(400).json({ error: 'commits array is required' });
        }

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `AI query limit reached. Resets ${limit.resetDate || 'next month'}.`,
                remaining: 0,
            });
        }

        const commitList = commits.map(c => `- ${c.message}`).join('\n');
        const filesInfo = diff_summary?.files
            ? diff_summary.files.map(f => `${f.filename} (+${f.additions} -${f.deletions})`).join('\n')
            : '';
        const safePatches = sanitizeForPrompt(top_patches || '', 15000);
        const templateInstruction = template
            ? `\nUse this PR template as the structure for the summary:\n${template}\n`
            : '';
        const repoLine = repo_context?.name ? `Repository: ${repo_context.name}\n` : '';

        const systemPrompt = `You are a PR description generator. ${repoLine}${templateInstruction}

Respond with ONLY valid JSON in this exact shape:
{
  "title": "short PR title under 70 chars",
  "summary": "## Summary\\nmarkdown bullet points",
  "test_plan": "## Test plan\\n- [ ] checklist items",
  "breaking_changes": null or "## Breaking Changes\\n...",
  "related_issues": [{"number": 123, "relation": "closes|fixes|relates"}],
  "suggested_labels": ["label1", "label2"],
  "suggested_reviewers": ["username1"]
}

Rules:
- Extract issue references from commit messages (#NNN, fixes #NNN, closes #NNN)
- Suggest labels based on file paths and commit types
- Suggest reviewers is best-effort, return empty array if unsure
- breaking_changes should be null if none detected
- No markdown fences in the response, ONLY the JSON object`;

        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: '{}' }] }] });

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const streamResult = await chat.sendMessageStream(
                    `Generate a PR description.\n\nCommits:\n${commitList}\n\nFiles changed:\n${filesInfo}\n\nPatches:\n${safePatches}`
                );
                const raw = await streamGeminiToSSE(streamResult, sse);

                let parsed;
                try {
                    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                    parsed = JSON.parse(cleaned);
                } catch {
                    parsed = { title: commits[0]?.message?.split('\n')[0] || 'Update', summary: raw, test_plan: '', breaking_changes: null, related_issues: [], suggested_labels: [], suggested_reviewers: [] };
                }

                incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_generate_pr', 'ai', null, { commit_count: commits.length, streamed: true });

                sse.sendDone({
                    title: parsed.title || '', summary: parsed.summary || '', test_plan: parsed.test_plan || '',
                    breaking_changes: parsed.breaking_changes || null, related_issues: parsed.related_issues || [],
                    suggested_labels: parsed.suggested_labels || [], suggested_reviewers: parsed.suggested_reviewers || [],
                });
            } catch (err) {
                sse.sendError('Failed to generate PR description');
            }
            return;
        }

        const result = await chat.sendMessage(
            `Generate a PR description.\n\nCommits:\n${commitList}\n\nFiles changed:\n${filesInfo}\n\nPatches:\n${safePatches}`
        );
        const raw = result.response.text().trim();

        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            parsed = JSON.parse(cleaned);
        } catch {
            parsed = {
                title: commits[0]?.message?.split('\n')[0] || 'Update',
                summary: raw,
                test_plan: '',
                breaking_changes: null,
                related_issues: [],
                suggested_labels: [],
                suggested_reviewers: [],
            };
        }

        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_generate_pr', 'ai', null, { commit_count: commits.length });

        res.json({
            title: parsed.title || '',
            summary: parsed.summary || '',
            test_plan: parsed.test_plan || '',
            breaking_changes: parsed.breaking_changes || null,
            related_issues: parsed.related_issues || [],
            suggested_labels: parsed.suggested_labels || [],
            suggested_reviewers: parsed.suggested_reviewers || [],
        });
    } catch (error) {
        req.log.error({ err: error }, 'Generate PR description failed');
        res.status(500).json({ error: safeError(error, 'Failed to generate PR description') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Refine Content
// ------------------------------------------------------------------

router.post('/ai/refine', requireAuth, requireAI, async (req, res) => {
    try {
        const { original_content, original_diff, instruction, content_type } = req.body;

        if (!original_content || typeof original_content !== 'string') {
            return res.status(400).json({ error: 'original_content is required' });
        }
        if (!instruction || typeof instruction !== 'string') {
            return res.status(400).json({ error: 'instruction is required' });
        }

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `AI query limit reached. Resets ${limit.resetDate || 'next month'}.`,
                remaining: 0,
            });
        }

        const refinementInstructions = {
            shorter: 'Make this shorter and more concise. Remove the body if present, keep only the subject line.',
            more_detail: 'Add more detail. Include a multi-line body with bullet points explaining the changes.',
            add_body: 'Keep the subject line as-is but add an explanatory body paragraph below it.',
            breaking_change: 'Add a BREAKING CHANGE: footer explaining what breaks and how to migrate.',
            more_cases: 'Add more test cases to cover additional scenarios.',
            edge_cases: 'Add edge case test scenarios (empty inputs, boundary values, error conditions).',
            e2e_focus: 'Rewrite the test plan focusing on end-to-end user workflows.',
            architecture_notes: 'Add a section about the architectural decisions and technical approach.',
            more_context: 'Add more context about what changed and why. Include background information and motivation.',
        };

        const ALLOWED_CONTENT_TYPES = ['commit', 'pr_summary', 'pr_test_plan'];
        const safeContentType = ALLOWED_CONTENT_TYPES.includes(content_type) ? content_type : 'content';

        const instructionText = refinementInstructions[instruction] || instruction;
        const safeDiff = original_diff ? sanitizeForPrompt(original_diff, 8000) : '';
        const diffContext = safeDiff ? `\n\nOriginal diff for context:\n${safeDiff}` : '';

        const systemPrompt = `You are refining ${safeContentType}. Apply the requested change to the content below.
Return ONLY the refined content, no explanation, no markdown fences.`;

        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: 'Ready.' }] }] });

        if (req.query.stream === 'true') {
            const sse = initSSE(res);
            try {
                const streamResult = await chat.sendMessageStream(
                    `Refinement instruction: ${instructionText}\n\nOriginal content:\n${original_content}${diffContext}`
                );
                const raw = await streamGeminiToSSE(streamResult, sse);

                incrementUsage(userId, 'ai_queries');
                auditLog(req, 'ai_refine', 'ai', null, { instruction, content_type, streamed: true });

                sse.sendDone({ refined_content: raw.trim() });
            } catch (err) {
                sse.sendError('Failed to refine content');
            }
            return;
        }

        const result = await chat.sendMessage(
            `Refinement instruction: ${instructionText}\n\nOriginal content:\n${original_content}${diffContext}`
        );
        const refined = result.response.text().trim();

        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_refine', 'ai', null, { instruction, content_type });

        res.json({ refined_content: refined });
    } catch (error) {
        req.log.error({ err: error }, 'Refine content failed');
        res.status(500).json({ error: safeError(error, 'Failed to refine content') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Analyze Context (Smart Bar)
// ------------------------------------------------------------------

const contextCache = new Map();
const CONTEXT_CACHE_TTL = 30000;

router.post('/ai/analyze-context', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo, diff_summary, commits, file_list } = req.body;

        if (!repo || !diff_summary) {
            return res.status(400).json({ error: 'repo and diff_summary are required' });
        }

        const cacheKey = `${repo}_${diff_summary.files}_${diff_summary.additions}_${diff_summary.deletions}`;
        const cached = contextCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) {
            return res.json(cached.data);
        }

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({ error: 'usage_limit_exceeded', message: 'AI query limit reached.' });
        }

        const commitMessages = (commits || []).map(c => c.message).join('\n');
        const files = (file_list || []).join(', ');

        const prompt = `Classify this code change. Respond with ONLY valid JSON:
{"changeType": "feature|bugfix|refactor|breaking|chore", "complexity": "low|medium|high", "breakingChanges": true|false}

Files: ${sanitizeForPrompt(files, 2000)}
Commits: ${sanitizeForPrompt(commitMessages, 2000)}
Stats: ${diff_summary.files} files, +${diff_summary.additions} -${diff_summary.deletions}`;

        const { text: raw } = await req.aiProvider.generate({ prompt });

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = { changeType: 'chore', complexity: 'medium', breakingChanges: false };
        }

        const suggestions = [];
        if (commits && commits.length > 0) {
            suggestions.push({ type: 'generate_pr', message: `${commits.length} commit${commits.length > 1 ? 's' : ''} — generate PR description?`, tab: 'pr' });
        }
        if (parsed.breakingChanges) {
            suggestions.push({ type: 'breaking', message: 'Breaking changes detected — mark in commit', tab: 'commits' });
        }

        const responseData = {
            changeType: parsed.changeType || 'chore',
            complexity: parsed.complexity || 'medium',
            suggestions,
            breakingChanges: parsed.breakingChanges || false,
        };

        incrementUsage(userId, 'ai_queries');
        contextCache.set(cacheKey, { data: responseData, timestamp: Date.now() });

        res.json(responseData);
    } catch (error) {
        req.log.error({ err: error }, 'Analyze context failed');
        res.status(500).json({ error: safeError(error, 'Failed to analyze context') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit — Conversational Refine (always streaming)
// ------------------------------------------------------------------

router.post('/ai/chat-refine', requireAuth, requireAI, async (req, res) => {
    try {
        const { message, current_output, original_diff, content_type, history } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'message is required' });
        }

        const userId = req.session.userId;
        const limit = checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({ error: 'usage_limit_exceeded', message: 'AI query limit reached.' });
        }

        const CONTENT_TYPE_LABELS = {
            commit: 'commit message',
            pr_summary: 'PR summary',
            pr_test_plan: 'PR test plan',
            review_qa: 'code review Q&A',
        };
        const typeLabel = CONTENT_TYPE_LABELS[content_type] || 'content';

        const safeDiff = original_diff ? sanitizeForPrompt(original_diff, 8000) : '';
        const diffCtx = safeDiff ? `\n\nDiff context:\n${safeDiff}` : '';

        const systemPrompt = `You are a helpful AI assistant refining ${typeLabel}. Apply the user's instruction to improve the content. Return ONLY the refined content, no explanation.${diffCtx}`;

        const chatHistory = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: 'Ready to help refine.' }] },
        ];

        const safeHistory = Array.isArray(history) ? history.slice(-10) : [];
        for (const entry of safeHistory) {
            chatHistory.push({
                role: entry.role === 'user' ? 'user' : 'model',
                parts: [{ text: sanitizeForPrompt(entry.content, 4000) }],
            });
        }

        const model = aiService.model;
        const chat = model.startChat({ history: chatHistory });

        const userMessage = current_output
            ? `Current content:\n${sanitizeForPrompt(current_output, 6000)}\n\nInstruction: ${message}`
            : message;

        const sse = initSSE(res);
        try {
            const streamResult = await chat.sendMessageStream(userMessage);
            const raw = await streamGeminiToSSE(streamResult, sse);

            incrementUsage(userId, 'ai_queries');
            auditLog(req, 'ai_chat_refine', 'ai', null, { content_type, message_length: message.length });

            sse.sendDone({ refined_content: raw.trim() });
        } catch (err) {
            sse.sendError('Failed to refine content');
        }
    } catch (error) {
        req.log.error({ err: error }, 'Chat refine failed');
        if (!res.headersSent) {
            res.status(500).json({ error: safeError(error, 'Failed to chat refine') });
        }
    }
});

// ------------------------------------------------------------------
// Migration Risk Analysis (AI)
// ------------------------------------------------------------------
// Analyzes a source repo's migration risk to a target platform (GitHub, Azure DevOps,
// or another org) before the actual migration runs. Returns a structured risk report
// so users can triage blockers before spending time on a migration plan.
//
// Available to Free tier (capped at migrationRiskPerMonth, default 5/month).

router.post('/ai/migration-risk', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_migration_risk');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    try {
        const { repo, source = 'github', target = 'github' } = req.body;
        if (!repo || !repo.full_name) {
            return res.status(400).json({ error: 'repo.full_name is required', code: 'VALIDATION_ERROR' });
        }
        // Full-name is spliced into GitHub API URLs below — reject anything that
        // would let a caller escape the intended repo scope.
        if (!isValidGitHubFullName(repo.full_name)) {
            return res.status(400).json({ error: 'Invalid repo.full_name format', code: 'VALIDATION_ERROR' });
        }
        const allowedPlatforms = new Set(['github', 'azure-devops', 'gitlab', 'bitbucket', 'other']);
        const safeSource = allowedPlatforms.has(source) ? source : 'other';
        const safeTarget = allowedPlatforms.has(target) ? target : 'other';

        // Pull a handful of signals that strongly predict migration pain.
        // Each call is soft-failing — missing data just weakens the analysis,
        // it doesn't block the whole report.
        const [branchesResult, lfsResult, workflowsResult, languagesResult] = await Promise.allSettled([
            githubApi(`/repos/${repo.full_name}/branches?per_page=100`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/contents/.gitattributes`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/actions/workflows`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/languages`, req.session.accessToken),
        ]);

        const branches = branchesResult.status === 'fulfilled' ? (branchesResult.value.data || []) : [];
        const workflowCount = workflowsResult.status === 'fulfilled' ? (workflowsResult.value.data?.total_count ?? 0) : 0;
        const languages = languagesResult.status === 'fulfilled' ? (languagesResult.value.data || {}) : {};

        let hasLFS = false;
        if (lfsResult.status === 'fulfilled') {
            try {
                const gitattrs = Buffer.from(lfsResult.value.data.content, 'base64').toString('utf-8');
                hasLFS = /filter=lfs/i.test(gitattrs);
            } catch { /* ignore */ }
        }

        const sizeMB = Math.round((repo.size || 0) / 1024);
        const signals = {
            sizeMB,
            branches: branches.length,
            openIssues: repo.open_issues_count ?? 0,
            hasLFS,
            workflowCount,
            languages: Object.keys(languages),
            private: !!repo.private,
            archived: !!repo.archived,
            hasWiki: !!repo.has_wiki,
            hasPages: !!repo.has_pages,
        };

        // Ask the AI for a structured risk report.
        const systemPrompt = `You are a repository migration expert. Given the repository signals below, produce a structured migration risk analysis.

Repository: ${sanitizeForPrompt(repo.full_name, 200)}
Source platform: ${sanitizeForPrompt(safeSource, 40)}
Target platform: ${sanitizeForPrompt(safeTarget, 40)}
Signals: ${JSON.stringify(signals)}

Respond with ONLY valid JSON matching this schema — no code fences, no prose:
{
  "overallRisk": "low | medium | high | critical",
  "score": 0,
  "summary": "one-sentence executive summary",
  "blockers": ["specific blockers that must be resolved first"],
  "warnings": ["things that will slow the migration or need manual intervention"],
  "recommendations": ["concrete next steps, ordered by priority"],
  "estimatedDurationMinutes": 0
}

Rules:
- score is 0 (no risk) to 100 (critical, do not migrate).
- Flag LFS, >1GB size, >50 branches, active CI/CD, GitHub Pages, and wikis as warnings or blockers as appropriate.
- Be specific, not generic. Reference the actual signals.`;

        const { text: raw } = await req.aiProvider.generate({ prompt: systemPrompt });

        let parsed = null;
        let parseError = false;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parseError = true;
            parsed = {};
        }

        // Explicitly coerce each field to its expected type — spread of raw AI
        // output would let Gemini hiccups leak null/string-where-array through
        // to the UI and crash `.map()` calls on the client.
        const ALLOWED_RISK = new Set(['low', 'medium', 'high', 'critical', 'unknown']);
        const asStringArray = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.slice(0, 400)) : [];
        const clampedScore = typeof parsed.score === 'number' && Number.isFinite(parsed.score)
            ? Math.max(0, Math.min(100, Math.round(parsed.score)))
            : 0;
        const normalizedRisk = ALLOWED_RISK.has(parsed.overallRisk) ? parsed.overallRisk : 'unknown';

        const report = {
            repo: repo.full_name,
            source: safeSource,
            target: safeTarget,
            signals,
            overallRisk: parseError ? 'unknown' : normalizedRisk,
            score: parseError ? 0 : clampedScore,
            summary: typeof parsed.summary === 'string'
                ? parsed.summary.slice(0, 500)
                : (parseError
                    ? 'AI returned an unparseable response. Review signals manually or retry.'
                    : ''),
            blockers: asStringArray(parsed.blockers),
            warnings: parseError
                ? [`AI parse error. Raw preview: ${raw.slice(0, 300)}`]
                : asStringArray(parsed.warnings),
            recommendations: parseError
                ? ['Retry the analysis', 'Or review the signals manually']
                : asStringArray(parsed.recommendations),
            estimatedDurationMinutes: typeof parsed.estimatedDurationMinutes === 'number' && Number.isFinite(parsed.estimatedDurationMinutes)
                ? Math.max(0, Math.round(parsed.estimatedDurationMinutes))
                : 0,
            parseError,
        };

        incrementAIUsage(userId, 'ai_migration_risk');
        auditLog(req, 'ai.migration_risk', 'ai', repo.full_name, {
            source: safeSource,
            target: safeTarget,
            overallRisk: report.overallRisk,
            parseError,
        });
        res.json({ success: true, report });
    } catch (error) {
        req.log.error({ err: error }, 'Migration risk analysis failed');
        handleAIError(res, error, 'Failed to analyze migration risk.');
    }
});

// ------------------------------------------------------------------
// AI Migration Size Strategy
// ------------------------------------------------------------------

router.post('/ai/migration-size-strategy', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'migration_assist');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    const parsed = migrationSizeStrategySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { repoId, size, hasLfsMarker, branches, lastCommitDate } = parsed.data;

    const sizeGb = (size / (1024 * 1024)).toFixed(1);
    const prompt = `You are a migration assistant helping decide the best strategy for a repository that exceeds GitHub's 10 GB push limit.

Repository facts (no names or business context provided):
- Size: ${sizeGb} GB
- Has LFS markers in .gitattributes: ${hasLfsMarker ? 'yes' : 'no'}
- Branch count: ${branches}
- Last commit date: ${sanitizeForPrompt(lastCommitDate || 'unknown', 50)}

Choose exactly one strategy from: "exclude" or "lfs-migrate".
- "exclude": the repository is stale, archival, or too unwieldy; skip it.
- "lfs-migrate": run git-lfs migrate import --above=100M before pushing; appropriate when the size is caused by large binary assets.

Respond with strict JSON only, no prose outside the JSON:
{"strategy": "exclude" | "lfs-migrate", "rationale": "one short sentence", "confidence": 0.0-1.0}`;

    try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        // Provider strips markdown fences centrally — no manual replace needed.
        const { text } = await req.aiProvider.generate({ prompt });

        const parsedResponse = safeJsonParse(text);
        if (!parsedResponse || !['exclude', 'lfs-migrate'].includes(parsedResponse.strategy)) {
            return res.status(502).json({ error: 'Unexpected AI response shape' });
        }

        incrementAIUsage(userId, 'migration_assist');
        auditLog(req, 'ai.migration-size-strategy', 'ai', null, { repoId, size, model: modelName });
        res.json({
            strategy: parsedResponse.strategy,
            rationale: String(parsedResponse.rationale || '').slice(0, 500),
            confidence: Math.max(0, Math.min(1, Number(parsedResponse.confidence) || 0)),
        });
    } catch (err) {
        req.log?.error({ err }, 'migration-size-strategy failed');
        handleAIError(res, err, 'Failed to generate size strategy. Please try again later.');
    }
});

// ------------------------------------------------------------------
// AI Migration Description
// ------------------------------------------------------------------

router.post('/ai/migration-description', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'migration_assist');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    const parsed = migrationDescriptionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { repoId, repoName, language, size, branches, hasLfsMarker, lastCommitDate, source } = parsed.data;

    const facts = [
        `Repo name: ${sanitizeForPrompt(repoName, 100)}`,
        language ? `Primary language: ${sanitizeForPrompt(language, 50)}` : null,
        `Size: ${size} KB`,
        `Branch count: ${branches}`,
        `LFS markers present: ${hasLfsMarker ? 'yes' : 'no'}`,
        lastCommitDate ? `Last commit: ${sanitizeForPrompt(lastCommitDate, 50)}` : null,
        source.isTfvc
            ? `Source: Azure DevOps TFVC folder "${sanitizeForPrompt(source.tfvcPath || '', 200)}" in project "${sanitizeForPrompt(source.project, 100)}"`
            : `Source: Azure DevOps Git repo in ${sanitizeForPrompt(source.org, 100)}/${sanitizeForPrompt(source.project, 100)}`,
    ].filter(Boolean).join('\n- ');

    const prompt = `You write short, professional GitHub repository descriptions.

Context about the repository being migrated:
- ${facts}

Rules:
- Single line, max ${REPO_DESCRIPTION_MAX} characters.
- No markdown, no code blocks, no line breaks, no emoji.
- English only.
- Ground the description in the facts above. Do not invent features or stack details not listed.
- If the source is Azure DevOps TFVC, mention it came from TFVC so readers understand the history.

Respond with strict JSON only, no prose outside the JSON:
{"description": "..."}`;

    try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        // Provider strips markdown fences centrally — text is clean.
        const { text } = await req.aiProvider.generate({ prompt });

        const parsedResponse = safeJsonParse(text);
        const rawDescription = parsedResponse?.description;
        // Fall through to deterministic template on any unexpected shape — keep the
        // endpoint's contract simple: always return a usable { description }.
        const description = typeof rawDescription === 'string' && rawDescription.trim()
            ? sanitizeRepoDescription(rawDescription)
            : defaultRepoDescription({ repoName, source });

        incrementAIUsage(userId, 'migration_assist');
        auditLog(req, 'ai.migration-description', 'ai', null, { repoId, model: modelName });
        res.json({ description });
    } catch (err) {
        req.log?.error({ err }, 'migration-description failed');
        handleAIError(res, err, 'Failed to generate description. Please try again later.');
    }
});

export default router;
