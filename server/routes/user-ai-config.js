/**
 * User AI Config Routes — BYOK (Bring Your Own Key)
 *
 * Mounted at /api/user/ai-config  (and /api/v1/user/ai-config via v1 router)
 *
 * Endpoints:
 *  GET    /api/user/ai-config        — public shape (no keys)
 *  POST   /api/user/ai-config        — save config (encrypted)
 *  DELETE /api/user/ai-config        — wipe config
 *  POST   /api/user/ai-config/test   — test a live call to verify credentials
 *
 * All routes require auth. /test is rate-limited to 1 call per 10 s per user.
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { userAIConfigSchema, testAIConfigSchema } from '../lib/validators.js';
import { validateBody } from '../middleware/validate-request.js';
import {
    getUserAIConfig,
    setUserAIConfig,
    deleteUserAIConfig,
    getDecryptedConfig,
} from '../lib/user-ai-config.js';
import { createProviderForUser } from '../lib/ai-provider.js';
import logger from '../lib/logger.js';
import { redactSecrets } from '../lib/redact-secrets.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Simple per-user in-memory rate limiter for /test
// Maps userId → last call timestamp (ms)
// ---------------------------------------------------------------------------
export const testLastCall = new Map();
const TEST_COOLDOWN_MS = 10_000; // 10 seconds

function testRateLimiter(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return next(); // auth will reject below

    const now = Date.now();
    const last = testLastCall.get(userId) ?? 0;

    if (now - last < TEST_COOLDOWN_MS) {
        const retryAfter = Math.ceil((TEST_COOLDOWN_MS - (now - last)) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
            error: 'Too many test requests. Wait a moment before testing again.',
            code: 'RATE_LIMITED',
            retryAfterSeconds: retryAfter,
        });
    }

    testLastCall.set(userId, now);
    next();
}

// ---------------------------------------------------------------------------
// GET /api/user/ai-config
// ---------------------------------------------------------------------------

router.get('/', requireAuth, (req, res) => {
    const config = getUserAIConfig(req.session.userId);

    // serverFallbackAvailable: true iff no user config AND server has GEMINI_API_KEY
    // AND AI_REQUIRE_USER_CONFIG is not forcing BYOK-only mode.
    const serverFallbackAvailable = !config &&
        !!process.env.GEMINI_API_KEY &&
        process.env.AI_REQUIRE_USER_CONFIG !== 'true';

    if (!config) {
        // Return a null-shape so the frontend always has a consistent object
        return res.json({
            userId: req.session.userId,
            completionProvider: null,
            completionModel: null,
            hasCompletionKey: false,
            embeddingProvider: null,
            embeddingModel: null,
            hasEmbeddingKey: false,
            featureOverrides: {},
            updatedAt: null,
            serverFallbackAvailable,
        });
    }

    res.json({ ...config, serverFallbackAvailable });
});

// ---------------------------------------------------------------------------
// POST /api/user/ai-config
// ---------------------------------------------------------------------------

router.post('/', requireAuth, validateBody(userAIConfigSchema), (req, res) => {
    const {
        completionProvider,
        completionModel,
        completionApiKey,
        completionEndpointUrl,
        embeddingProvider,
        embeddingModel,
        embeddingApiKey,
        embeddingEndpointUrl,
        featureOverrides,
    } = req.validatedBody;

    // Build credential objects from individual fields.
    // undefined fields are left as-is (partial update semantics).
    // null fields explicitly clear stored credentials.

    let completionCredentials;
    if (completionApiKey !== undefined || completionEndpointUrl !== undefined) {
        if (completionApiKey === null && completionEndpointUrl === null) {
            completionCredentials = null; // explicit clear
        } else {
            // Fetch existing to merge if needed
            const existing = getDecryptedConfig(req.session.userId);
            const existingCreds = existing?.completionCredentials ?? {};
            completionCredentials = { ...existingCreds };
            if (completionApiKey !== undefined) completionCredentials.apiKey = completionApiKey;
            if (completionEndpointUrl !== undefined) completionCredentials.endpointUrl = completionEndpointUrl;
        }
    }

    let embeddingCredentials;
    if (embeddingApiKey !== undefined || embeddingEndpointUrl !== undefined) {
        if (embeddingApiKey === null && embeddingEndpointUrl === null) {
            embeddingCredentials = null; // explicit clear
        } else {
            const existing = getDecryptedConfig(req.session.userId);
            const existingEmbCreds = existing?.embeddingCredentials ?? {};
            embeddingCredentials = { ...existingEmbCreds };
            if (embeddingApiKey !== undefined) embeddingCredentials.apiKey = embeddingApiKey;
            if (embeddingEndpointUrl !== undefined) embeddingCredentials.endpointUrl = embeddingEndpointUrl;
        }
    }

    setUserAIConfig(req.session.userId, {
        completionProvider,
        completionModel,
        completionCredentials,
        embeddingProvider,
        embeddingModel,
        embeddingCredentials,
        featureOverrides,
    });

    res.status(204).end();
});

// ---------------------------------------------------------------------------
// DELETE /api/user/ai-config
// ---------------------------------------------------------------------------

router.delete('/', requireAuth, (req, res) => {
    deleteUserAIConfig(req.session.userId);
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /api/user/ai-config/test
// ---------------------------------------------------------------------------

router.post('/test', requireAuth, testRateLimiter, validateBody(testAIConfigSchema), async (req, res) => {
    const { kind } = req.validatedBody;
    const userId = req.session.userId;

    let provider;
    try {
        // noServerFallback: the user is testing THEIR credentials. Never
        // silently fall back to the server's GEMINI_API_KEY — that would
        // hide a misconfigured BYOK and show a misleading success/error
        // for the wrong provider.
        provider = await createProviderForUser(userId, kind, { noServerFallback: true });
    } catch (err) {
        logger.warn({ err, userId, kind }, 'createProviderForUser threw during /test');
        return res.json({ ok: false, error: 'Failed to build provider', code: 'PROVIDER_ERROR' });
    }

    if (!provider) {
        return res.json({
            ok: false,
            error: 'No AI provider configured for this user. Save your API key first, then retry.',
            code: 'NOT_CONFIGURED',
        });
    }

    const t0 = Date.now();

    try {
        if (kind === 'completion') {
            const { text } = await provider.generate({
                prompt: 'Reply with exactly: ok',
                generationConfig: { max_tokens: 10, maxOutputTokens: 10 },
            });
            const latencyMs = Date.now() - t0;
            return res.json({
                ok: true,
                latencyMs,
                modelUsed: provider.getModelName?.() || null,
                response: text?.slice(0, 100),
            });
        }

        if (kind === 'embedding') {
            const embedding = await provider.embed('test');
            const latencyMs = Date.now() - t0;
            return res.json({
                ok: true,
                latencyMs,
                modelUsed: provider._embeddingModelName || provider.getModelName?.() || null,
                dimensions: embedding.length,
            });
        }

        return res.status(400).json({ ok: false, error: 'Invalid kind', code: 'INVALID_KIND' });
    } catch (err) {
        const latencyMs = Date.now() - t0;

        // Redact first — do NOT include the raw err object (may carry auth headers in err.cause)
        const safeMessage = redactSecrets(err?.message || 'Test call failed').slice(0, 200) || 'Test call failed';

        logger.warn({
            code: err?.code,
            status: err?.status,
            message: safeMessage,
            userId,
            kind,
        }, 'AI config test call failed');

        return res.json({
            ok: false,
            error: safeMessage,
            code: err?.code || 'UNKNOWN',
            latencyMs,
        });
    }
});

export default router;
