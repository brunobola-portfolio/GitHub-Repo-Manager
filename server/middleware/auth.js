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
 * Verify GitHub webhook signature (X-Hub-Signature-256).
 * Uses timing-safe comparison to prevent timing attacks.
 * Reads WEBHOOK_SECRET from process.env at call time.
 *
 * @param {string|object} payload - Raw request body (string) or parsed object
 * @param {string} signature - Value of the X-Hub-Signature-256 header
 * @returns {boolean}
 */
export function verifyWebhookSignature(payload, signature) {
    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) return false; // Reject if no secret configured
    if (!signature) return false;

    const expected = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET)
        .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
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
    if (process.env.NODE_ENV === 'production') {
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
 * Factory for the requireAI middleware.
 * Returns an Express middleware that guards AI-dependent routes.
 * Checks both the GEMINI_API_KEY env var and that aiService has been
 * successfully initialized (aiService.genAI is truthy).
 *
 * @param {object} aiService - The imported aiService singleton
 * @returns {(req, res, next) => void}
 */
export function createRequireAI(aiService) {
    return (req, res, next) => {
        if (!process.env.GEMINI_API_KEY) {
            return res.status(503).json({
                error: 'AI_NOT_CONFIGURED',
                message: 'AI features are not configured. Please set GEMINI_API_KEY in server/.env file.'
            });
        }

        if (!aiService.genAI) {
            return res.status(503).json({
                error: 'AI_NOT_INITIALIZED',
                message: 'AI service failed to initialize. Please check your GEMINI_API_KEY.'
            });
        }

        req.genAI = aiService.genAI;
        next();
    };
}
