/*
 * GitHub Repo Manager - Auth Middleware & Utilities
 *
 * Shared module providing:
 * - Input validation helpers (GitHub username)
 * - Webhook signature verification (HMAC-SHA256, timing-safe)
 * - Safe error sanitization for client responses
 * - Express middleware: requireAuth, requireAI (via factory)
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { apiKeyAuth } from './api-key-auth.js';

/**
 * Validate GitHub username format.
 * GitHub usernames: alphanumeric, hyphens, max 39 chars, no consecutive hyphens.
 *
 * @param {string} username
 * @returns {boolean}
 */
export function isValidGitHubUsername(username) {
    return typeof username === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(username);
}

/**
 * Validate an "owner/repo" full-name string before splicing into GitHub API URLs.
 * Blocks traversal (`..`), query hijacking (`?`, `&`), path injection, and
 * unexpected characters. Repo names allow dots and underscores.
 *
 * @param {string} fullName
 * @returns {boolean}
 */
export function isValidGitHubFullName(fullName) {
    if (typeof fullName !== 'string') return false;
    const parts = fullName.split('/');
    if (parts.length !== 2) return false;
    const [owner, repo] = parts;
    if (!isValidGitHubUsername(owner)) return false;
    // Repo name: alnum + . _ -, 1-100 chars, not starting with a dot.
    return /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,99}$/.test(repo);
}

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256).
 * Uses timing-safe comparison to prevent timing attacks.
 * Reads WEBHOOK_SECRET from process.env at call time.
 *
 * @param {Buffer|string|object} payload - Raw request body. Accepts Buffer
 *   (express.raw — what real GitHub deliveries produce), string (legacy),
 *   or object (legacy). JSON.stringify(buffer) would produce a garbage
 *   "{\"type\":\"Buffer\",...}" string and fail verification against GitHub's
 *   bytes-level signature.
 * @param {string} signature - Value of the X-Hub-Signature-256 header
 * @returns {boolean}
 */
export function verifyWebhookSignature(payload, signature, secretOverride) {
    // `secretOverride` is the per-tenant ingest secret (webhook_ingest_tokens).
    // Without it this verifies against the instance-wide WEBHOOK_SECRET — the
    // right key for a self-hosted box, and the wrong one the moment two
    // tenants share the instance, which is why the SaaS path always passes
    // the override and never falls back.
    const WEBHOOK_SECRET = secretOverride ?? process.env.WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) {
        if (secretOverride !== undefined) return false; // empty per-tenant secret never passes
        // In development, accept unsigned webhooks so local ngrok testing works.
        // Production MUST set WEBHOOK_SECRET (enforced by startup-secrets-check).
        if (process.env.NODE_ENV !== 'production') {
            return true;
        }
        return false;
    }
    if (!signature) return false;

    const bytes = Buffer.isBuffer(payload)
        ? payload
        : typeof payload === 'string'
            ? payload
            : JSON.stringify(payload);

    const expected = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET)
        .update(bytes)
        .digest('hex');

    try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

/**
 * Sanitize error for client response (avoid leaking internals).
 * In production only the fallback message is returned.
 *
 * @param {Error|unknown} error
 * @param {string} fallbackMessage
 * @returns {string}
 */
export function safeError(error, fallbackMessage = 'An internal error occurred') {
    if (config.nodeEnv === 'production') {
        return fallbackMessage;
    }
    return error?.message || fallbackMessage;
}

/**
 * Standardized error response helper.
 * Produces a consistent JSON shape: { error, code? }
 *
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code
 * @param {string} message - Human-readable error message
 * @param {string|null} code - Optional machine-readable error code
 * @returns {import('express').Response}
 */
export function errorResponse(res, status, message, code = null) {
    return res.status(status).json({ error: message, ...(code && { code }) });
}

/**
 * Express middleware: reject requests that have no active session token
 * or valid API key.
 *
 * Flow:
 * 1. If request has `Authorization: Bearer grm_live_...` -> validate API key
 * 2. If request has session with accessToken -> use session
 * 3. Otherwise -> 401
 */
export const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer grm_live_')) {
        return apiKeyAuth(req, res, (err) => {
            if (err) return next(err);
            // apiKeyAuth sets req.session.userId if valid; if it didn't 401 already, we're good
            if (req.apiKeyId) return next();
            return res.status(401).json({ error: 'Invalid API key' });
        });
    }

    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    next();
};

/**
 * Attach per-user AI provider helpers to every authenticated request.
 *
 * `req.getAIProvider(kind)` — async, cached per-request.
 * `req.aiProvider` and `req.genAI` — shimmed for backward compat with
 *   call-sites that haven't been migrated to the provider abstraction yet.
 *   They are populated as a side effect of the FIRST `getAIProvider('completion')`
 *   call, so a route that never asks for a provider never pays for one; any
 *   route reading them directly must resolve through the accessor first
 *   (requireAI does this for every gated AI route).
 *
 * Call this middleware AFTER session is populated.
 *
 * @returns {(req, res, next) => void}
 */
export function attachAIProvider() {
    return (req, _res, next) => {
        // Skip eager resolution when there's no user session and no server-wide
        // fallback key. Keeps /api/health and similar unauthenticated endpoints
        // from triggering a DB lookup on every poll.
        if (!req.session?.userId && !process.env.GEMINI_API_KEY) {
            return next();
        }

        // Lazy per-request provider resolver with Promise-level caching.
        // Storing the Promise (not the resolved value) prevents double-invocation
        // when two concurrent awaits race before the first DB lookup completes.
        req.getAIProvider = async (kind = 'completion') => {
            if (!req._aiProviderCache) req._aiProviderCache = new Map();
            if (req._aiProviderCache.has(kind)) return req._aiProviderCache.get(kind);
            const promise = (async () => {
                const { createProviderForUser } = await import('../lib/ai-provider.js');
                return createProviderForUser(req.session?.userId, kind).catch((err) => {
                    // The user still gets a clean AI_NOT_CONFIGURED from
                    // requireAI, but the operator used to get nothing at all:
                    // a misconfigured or unreachable credential store produced
                    // zero log lines anywhere in the process. Debug level keeps
                    // it out of prod noise while making it reachable via
                    // LOG_LEVEL.
                    req.log?.debug?.({ err, kind }, 'AI provider resolution failed');
                    return null;
                });
            })();
            req._aiProviderCache.set(kind, promise);
            // Populating the legacy shim is a side effect of the first
            // resolution, not of every request. This used to be an eager
            // `await` here in the middleware, which cost a prepared statement,
            // a user_ai_config read, an AES-GCM decrypt and — for a BYOK
            // endpointUrl — an uncached dns.lookup() on 100% of /api/* traffic,
            // including /api/auth/session and /api/repos, for a value most
            // routes never read. requireAI (and the two routes that resolve a
            // provider themselves) re-resolve through this same cached
            // accessor, so nothing downstream changed except who pays.
            promise.then((p) => {
                if (!p) return;
                if (kind === 'completion' && !req.aiProvider) req.aiProvider = p;
                // rawSDK is only defined on GeminiProvider; null for other providers.
                if (kind === 'completion' && !req.genAI) req.genAI = p.rawSDK ?? null;
            }).catch(() => { /* the awaiting caller owns this rejection */ });
            return promise;
        };

        next();
    };
}

/**
 * Factory for the requireAI middleware.
 * Returns an Express middleware that guards AI-dependent routes.
 *
 * Checks whether the request has a resolved AI provider (user BYOK or
 * server-wide env fallback). Accepts `aiService` for backward compat
 * with existing callers but no longer relies on it.
 *
 * @param {object} [aiService] - Legacy aiService singleton (ignored, kept for compat)
 * @returns {(req, res, next) => Promise<void>}
 */
export function createRequireAI(_aiService) {
    return async (req, res, next) => {
        // req.aiProvider is populated by attachAIProvider() but may be absent
        // when the middleware wasn't applied (e.g. API-key auth paths that skip
        // the session middleware). Re-resolve if needed.
        let provider = req.aiProvider;
        if (!provider && typeof req.getAIProvider === 'function') {
            provider = await req.getAIProvider('completion').catch(() => null);
        }

        if (!provider) {
            // `error` is the human string and `code` the machine slug — the
            // house contract (lib/response-shapes.js). Inverted, every client
            // in src/api/ rendered the literal text "AI_NOT_CONFIGURED" to the
            // user, since they all read body.error as the display message.
            return res.status(400).json({
                error: 'AI features require a provider API key. Configure one in Settings → AI Configuration.',
                code: 'AI_NOT_CONFIGURED',
                configureUrl: '/settings#ai',
            });
        }

        // Ensure legacy fields are set for unmigrated call-sites.
        if (!req.aiProvider) req.aiProvider = provider;
        if (!req.genAI && provider.rawSDK) req.genAI = provider.rawSDK;

        next();
    };
}
