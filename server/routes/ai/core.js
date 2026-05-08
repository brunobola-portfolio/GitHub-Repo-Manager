/*
 * GitHub Repo Manager - AI Core Routes
 *
 * Endpoints:
 *   GET  /config/ai-status
 *   POST /ai/chat
 *   POST /ai/suggest
 *   POST /ai/readme
 *   POST /ai/readme/enhance
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth } from '../../middleware/auth.js';
import {
    aiChatSchema,
    attentionNarrativeSchema,
    aiTranslateSearchSchema,
    aiSuggestSchema,
    aiReadmeSchema,
    aiReadmeEnhanceSchema,
} from '../../lib/validators.js';
import { isValidGitHubFullName } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { aiService, sanitizeForPrompt } from '../../ai-service.js';
import { safeJsonParse } from '../../lib/utils.js';
import { checkUsageLimit, incrementUsage, checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI, handleAIError, providerGenerateWithRetry } from './shared.js';
import { buildChatPrompt } from '../../lib/ai-chat-prompt.js';
import { getKeyHealth, probeAndCache } from '../../lib/ai-health-probe.js';
import {
    buildPrompt as buildNarrativePrompt,
    shapeNarrative,
    readCachedNarrative,
    writeCachedNarrative,
    ATTENTION_NARRATIVE_LIMITS,
} from '../../lib/attention-narrative.js';
import {
    buildPrompt as buildTranslatePrompt,
    shapeTranslation,
    readCachedTranslation,
    writeCachedTranslation,
    TRANSLATE_SEARCH_LIMITS,
} from '../../lib/translate-search.js';

const router = express.Router();

// ------------------------------------------------------------------
// AI Configuration Status
// ------------------------------------------------------------------

// Check AI Configuration Status (mounted at /config/ai-status from index.js)
// Note: This is also available via the router's own mount point
//
// Returns:
//   configured        — boolean — does any provider exist (BYOK or server fallback)
//   provider          — string  — provider id when configured
//   keyHealth         — string  — 'ok' | 'invalid' | 'unreachable' | 'unknown'
//   lastCheckedAt     — ISO     — when keyHealth was last refreshed (null if never)
//
// keyHealth is updated via an in-memory probe (see lib/ai-health-probe.js).
// The endpoint never blocks on the probe — first call returns 'unknown' and
// kicks off the background refresh; later calls within 5 min return cached
// state. Pass `?probe=1` to wait for a fresh probe (used by the Settings UI
// after a Test Connection success so the cache reflects the new state).
//
// Optional `?feature=` accepts 'completion' (default), 'chat', or
// 'embedding' so a user with separate BYOK keys per feature can probe
// each independently. Backwards compatible: omitting the param probes
// the completion key, which is what the existing UI reads.
router.get('/config/ai-status', async (req, res) => {
    const configured = !!process.env.GEMINI_API_KEY || !!aiService.model;
    if (!configured) {
        return res.json({ configured: false, provider: null, keyHealth: 'unknown', lastCheckedAt: null });
    }

    const userId = req.session?.userId ?? null;
    const feature = typeof req.query?.feature === 'string' ? req.query.feature : 'completion';
    const resolveProvider = async (kind = feature) => {
        // Reuse the per-request resolver when available so BYOK paths probe
        // the user's key (per-feature). Otherwise fall back to the server-wide
        // aiService (Gemini env key) as the thing to probe.
        if (typeof req.getAIProvider === 'function') {
            const p = await req.getAIProvider(kind).catch(() => null);
            if (p) return p;
        }
        return aiService?.provider ?? null;
    };

    const force = req.query?.probe === '1';
    const health = force
        ? await probeAndCache({ userId, resolveProvider, feature })
        : getKeyHealth({ userId, resolveProvider, feature });

    // Resolve the actual provider id so BYOK users see their configured
    // provider in the Settings UI (Anthropic, OpenAI, OpenRouter, …) instead
    // of a stale "gemini" label. We probe the resolver synchronously: BYOK
    // resolvers cache the per-user record, so the cost is a single DB read.
    let providerId = aiService?.provider?.id || aiService?.provider?.name || 'gemini';
    try {
        const resolved = await resolveProvider(feature);
        if (resolved?.id) providerId = resolved.id;
        else if (resolved?.name) providerId = resolved.name;
    } catch {
        // Fall through to the server-wide default — never block the status call.
    }

    res.json({
        configured: true,
        provider: providerId,
        keyHealth: health.state,
        lastCheckedAt: health.checkedAt,
    });
});

// ------------------------------------------------------------------
// AI Chat
// ------------------------------------------------------------------

router.post('/ai/chat', requireAuth, validateBody(aiChatSchema), requireAI, async (req, res) => {
    try {
        // Check usage limits — use the canonical quota response so the
        // frontend's <QuotaExceededState /> primitive can render a uniform
        // upgrade CTA (code: 'QUOTA_EXCEEDED' + structured fields).
        const usage = checkUsageLimit(req.session.userId, 'ai_queries');
        if (!usage.allowed) {
            return res.status(429).json(quotaExceededResponse({ ...usage, metric: 'ai_queries' }));
        }

        const { message, context } = req.validatedBody;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: 'Please provide a message to send to the AI assistant.',
                code: 'MESSAGE_REQUIRED'
            });
        }

        // Provider-neutral path via req.aiProvider — works with Gemini,
        // Anthropic, OpenAI, OpenRouter, LocalProvider. Structured output
        // uses `schema` which every provider implementation handles
        // (for JSON-incapable providers the implementation coerces via
        // system prompt + JSON parse).
        const systemPrompt = buildChatPrompt({ message, context, userId: req.session.userId });

        const schema = {
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
        };

        const { text, parsed: parsedFromProvider } = await providerGenerateWithRetry(
            req.aiProvider,
            { prompt: systemPrompt, schema },
        );

        // Prefer the provider's parsed payload (when it returns one) but fall
        // back to a JSON reparse so providers that only return text still work.
        const parsed = parsedFromProvider || safeJsonParse(text);
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
// AI Attention Narrative — one-line "why this repo needs you" for the
// dashboard top item. 1h cache per (user, repo, kind, signal-hash).
// ------------------------------------------------------------------

router.post('/ai/attention-narrative', requireAuth, validateBody(attentionNarrativeSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const { repo, kind, signal } = req.validatedBody;

    // Cache hit short-circuit — never burns tokens on repeat loads.
    const cached = readCachedNarrative({ userId, repo, kind, signal });
    if (cached) {
        return res.json({ narrative: cached.narrative, cached: true, model: cached.model });
    }

    // Quota gate — same bucket as ai_queries so the cap-reached banner stays
    // accurate. The narrative is small (~80 output tokens) but still counted.
    const usage = checkUsageLimit(userId, 'ai_queries');
    if (!usage.allowed) {
        return res.status(429).json(quotaExceededResponse(usage));
    }

    try {
        const prompt = buildNarrativePrompt({ repo, kind, signal });
        const { text } = await providerGenerateWithRetry(req.aiProvider, {
            prompt,
            maxOutputTokens: ATTENTION_NARRATIVE_LIMITS.maxOutputTokens,
        });

        const narrative = shapeNarrative(text);
        if (!narrative) {
            return res.status(502).json({
                error: 'AI returned an empty narrative.',
                code: 'AI_PARSE_ERROR',
            });
        }

        const model = req.aiProvider?.modelId || 'unknown';
        writeCachedNarrative({ userId, repo, kind, signal }, { narrative, model });
        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai.attention_narrative', 'ai', null, { repo, kind });

        res.json({ narrative, cached: false, model });
    } catch (error) {
        req.log.error({ err: error, repo, kind }, 'AI attention-narrative failed');
        handleAIError(res, error);
    }
});

// ------------------------------------------------------------------
// AI Translate Search — turns natural language into GitHub search queries
// the existing /search/github endpoint can run. 5min cache per (user, q).
// ------------------------------------------------------------------

const TRANSLATE_SEARCH_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string' },
        queries: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    type:    { type: 'string' },
                    ghQuery: { type: 'string' },
                },
                required: ['type', 'ghQuery'],
            },
        },
    },
    required: ['summary', 'queries'],
};

router.post('/ai/translate-search', requireAuth, validateBody(aiTranslateSearchSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const { q } = req.validatedBody;

    const cached = readCachedTranslation({ userId, q });
    if (cached) {
        return res.json({ ...cached, cached: true });
    }

    const usage = checkUsageLimit(userId, 'ai_queries');
    if (!usage.allowed) {
        return res.status(429).json(quotaExceededResponse(usage));
    }

    try {
        const prompt = buildTranslatePrompt({ q });
        const { text, parsed } = await providerGenerateWithRetry(req.aiProvider, {
            prompt,
            schema: TRANSLATE_SEARCH_SCHEMA,
            maxOutputTokens: TRANSLATE_SEARCH_LIMITS.maxOutputTokens,
        });

        const payload = parsed || safeJsonParse(text);
        const shaped = shapeTranslation(payload);

        writeCachedTranslation({ userId, q }, shaped);
        incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai.translate_search', 'ai', null, { qLength: q.length, queryCount: shaped.queries.length });

        res.json({ ...shaped, cached: false });
    } catch (error) {
        req.log.error({ err: error, qLength: q.length }, 'AI translate-search failed');
        handleAIError(res, error);
    }
});

// ------------------------------------------------------------------
// AI Suggestions
// ------------------------------------------------------------------

router.post('/ai/suggest', requireAuth, validateBody(aiSuggestSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkUsageLimit(userId, 'ai_queries');
    if (!check.allowed) {
        return res.status(429).json(quotaExceededResponse({ ...check, metric: 'ai_queries' }));
    }
    try {
        const { repo } = req.validatedBody;

        // Whitelist + sanitize the fields that go into the prompt. Never
        // serialize the raw repo object — that surface is a prompt-injection
        // sink. Each field is length-capped and stripped of control chars
        // by `sanitizeForPrompt`.
        const safeRepo = {
            name: sanitizeForPrompt(repo.name || '', 200),
            full_name: sanitizeForPrompt(repo.full_name || '', 200),
            description: sanitizeForPrompt(repo.description || '', 1000),
            language: sanitizeForPrompt(repo.language || '', 100),
            topics: sanitizeForPrompt(Array.isArray(repo.topics) ? repo.topics.join(', ') : '', 500),
            license: sanitizeForPrompt(typeof repo.license === 'string' ? repo.license : (repo.license?.name || repo.license?.spdx_id || ''), 100),
            visibility: sanitizeForPrompt(repo.visibility || (repo.private ? 'private' : 'public'), 20),
            stargazers_count: Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : 0,
            open_issues_count: Number.isFinite(repo.open_issues_count) ? repo.open_issues_count : 0,
        };

        const prompt = `Analyze this GitHub repository metadata and suggest 3 concrete improvements.
    Focus on: Description clarity, Topics (SEO), and Community standards (License, Contributing).

    Repository: ${JSON.stringify(safeRepo, null, 2)}

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

router.post('/ai/readme', requireAuth, validateBody(aiReadmeSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_readme');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const body = req.validatedBody;
        const repo = body.repo || {};
        const repoName = repo.name || body.name;
        if (!repoName) return res.status(400).json({ error: 'repo required' });

        const cleanName = sanitizeForPrompt(repoName, 200);
        const cleanDescription = sanitizeForPrompt(repo.description || body.description || '', 500);
        const cleanLanguage = sanitizeForPrompt(repo.language || body.language || '', 100);
        const rawTopics = repo.topics || body.topics;
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
        handleAIError(res, err, 'Failed to generate README. Please try again later.');
    }
});

// Enhanced README endpoint - Improve existing README
router.post('/ai/readme/enhance', requireAuth, validateBody(aiReadmeEnhanceSchema), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_readme');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const { repo } = req.validatedBody;
        // Defence in depth — Zod already validates `repo.full_name` against
        // the GitHub-shape regex, but we also reject anything that fails the
        // canonical username/repo validator before it touches GitHub URLs.
        if (!isValidGitHubFullName(repo.full_name)) {
            return res.status(400).json({ error: 'Invalid repo.full_name', code: 'validation_failed' });
        }
        const safeFullName = encodeURI(repo.full_name);

        // Fetch current README. 404 is expected ("no README yet") and fine;
        // any other failure (401, 429, 5xx) means the prompt context will be
        // degraded, so distinguish and log at the right level.
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${safeFullName}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            if (e?.status === 404) {
                req.log.debug({ repo: repo.full_name }, 'No README yet on repo (expected)');
            } else {
                req.log.warn({ err: e, repo: repo.full_name }, 'README fetch failed — continuing without README context');
            }
        }

        // Fetch file structure — same pattern.
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${safeFullName}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            if (e?.status === 404) {
                req.log.debug({ repo: repo.full_name }, 'Repo has no top-level contents (empty repo)');
            } else {
                req.log.warn({ err: e, repo: repo.full_name }, 'contents fetch failed — continuing with empty file structure');
            }
        }

        const result = await aiService.enhanceReadme(readmeContent, repo, fileStructure);
        incrementAIUsage(userId, 'ai_readme');
        auditLog(req, 'ai.readme.enhance', 'ai', null, { repoName: repo.full_name });
        res.json({ success: true, ...result, currentReadme: readmeContent });

    } catch (error) {
        req.log.error({ err: error }, 'README enhancement failed');
        handleAIError(res, error, 'Failed to enhance README. Please try again later.');
    }
});

export default router;
