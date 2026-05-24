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
import { invalidate as invalidateAIHealth, recordState as recordAIHealth } from '../lib/ai-health-probe.js';
import { formatAIErrorForUser, getProviderLabel } from '../lib/ai-error-format.js';
import logger from '../lib/logger.js';
import { createCooldownLimiter } from '../lib/in-memory-rate-limiter.js';

const router = express.Router();

// Cooldown limiter for /test — 1 call per 10s per user. Backed by the shared
// helper so the per-user bucket Map gets swept (previous local Map had no
// sweeper, leaking one entry per unique user forever).
//
// `testLastCall` remains exported as a back-compat shim for tests that called
// .clear() — it now points at the helper's internal Map.
const testCooldown = createCooldownLimiter({
    cooldownMs: 10_000,
    code: 'RATE_LIMITED',
    label: 'test',
});
export const testLastCall = testCooldown._lastCall;
const testRateLimiter = testCooldown.middleware;

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

    // Bust the per-user keyHealth cache so the next /config/ai-status read
    // probes the new credentials instead of returning a stale result.
    invalidateAIHealth(req.session.userId);

    res.status(204).end();
});

// ---------------------------------------------------------------------------
// DELETE /api/user/ai-config
// ---------------------------------------------------------------------------

router.delete('/', requireAuth, (req, res) => {
    deleteUserAIConfig(req.session.userId);
    invalidateAIHealth(req.session.userId);
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
        return res.json({
            ok: false,
            code: 'PROVIDER_ERROR',
            error: 'Failed to build provider',
            title: 'Provider could not be constructed',
            message: 'Failed to build provider',
            hint: 'Open the configuration above, re-check the provider, model, and API key, save, then retry.',
            httpStatus: null,
            providerName: null,
            model: null,
            kind,
            upstreamProvider: null,
            upstreamRaw: null,
            errorType: null,
        });
    }

    if (!provider) {
        return res.json({
            ok: false,
            code: 'NOT_CONFIGURED',
            error: 'No AI provider configured for this user. Save your API key first, then retry.',
            title: 'No provider configured',
            message: 'No AI provider configured for this user. Save your API key first, then retry.',
            hint: 'Pick a provider above, paste your API key, click Save, then run Test Connection again.',
            httpStatus: null,
            providerName: null,
            model: null,
            kind,
            upstreamProvider: null,
            upstreamRaw: null,
            errorType: null,
        });
    }

    const providerName = getProviderLabel(provider);
    const modelUsed = (kind === 'embedding'
        ? provider._embeddingModelName
        : provider.getModelName?.()) || null;

    const t0 = Date.now();

    try {
        if (kind === 'completion') {
            const { text } = await provider.generate({
                prompt: 'Reply with exactly: ok',
                generationConfig: { max_tokens: 10, maxOutputTokens: 10 },
            });
            const latencyMs = Date.now() - t0;
            // Warm the keyHealth cache so the next /config/ai-status read
            // returns 'ok' without needing a separate probe call.
            recordAIHealth(userId, 'ok');
            return res.json({
                ok: true,
                latencyMs,
                modelUsed,
                providerName,
                response: text?.slice(0, 100),
            });
        }

        if (kind === 'embedding') {
            const embedding = await provider.embed('test');
            const latencyMs = Date.now() - t0;
            return res.json({
                ok: true,
                latencyMs,
                modelUsed,
                providerName,
                dimensions: embedding.length,
            });
        }

        return res.status(400).json({ ok: false, error: 'Invalid kind', code: 'INVALID_KIND' });
    } catch (err) {
        const latencyMs = Date.now() - t0;

        // Record health state from the test failure so /config/ai-status
        // reflects what we just learned without re-probing.
        const status = err?.status ?? err?.cause?.status;
        if (status === 401 || status === 403 || err?.code === 'AUTH') {
            recordAIHealth(userId, 'invalid');
        } else if (err?.code === 'NETWORK' || err?.code === 'TIMEOUT') {
            recordAIHealth(userId, 'unreachable');
        }

        const payload = formatAIErrorForUser(err, { providerName, model: modelUsed, kind });

        logger.warn({
            code: payload.code,
            status: payload.httpStatus,
            message: payload.message,
            upstreamProvider: payload.upstreamProvider,
            userId,
            kind,
        }, 'AI config test call failed');

        return res.json({ ...payload, latencyMs });
    }
});

export default router;
