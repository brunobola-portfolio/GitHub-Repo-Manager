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
import { requireAuth, safeError } from '../../middleware/auth.js';
import { validate, aiChatSchema } from '../../lib/validators.js';
import { aiService, sanitizeForPrompt } from '../../ai-service.js';
import { safeJsonParse } from '../../lib/utils.js';
import { checkUsageLimit, incrementUsage, checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI, handleAIError, providerGenerateWithRetry } from './shared.js';

const router = express.Router();

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

        // Provider-neutral path via req.aiProvider — works with Gemini,
        // Anthropic, OpenAI, OpenRouter, LocalProvider. Structured output
        // uses `schema` which every provider implementation handles
        // (for JSON-incapable providers the implementation coerces via
        // system prompt + JSON parse).
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

// Enhanced README endpoint - Improve existing README
router.post('/ai/readme/enhance', requireAuth, requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_readme');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

        // Fetch current README. 404 is expected ("no README yet") and fine;
        // any other failure (401, 429, 5xx) means the prompt context will be
        // degraded, so distinguish and log at the right level.
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
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
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
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
        res.status(500).json({ error: safeError(error, 'Failed to enhance README') });
    }
});

export default router;
