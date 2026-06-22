/*
 * Shared AI route helpers — common imports, the requireAI middleware, the
 * unified AI error responder, and the provider-neutral retry wrapper.
 *
 * Each sub-router under server/routes/ai/ imports from here so we don't
 * duplicate the AIError → HTTP mapping or re-instantiate requireAI in
 * every file. The barrel at ../ai.js is still the public entry point for
 * the application; this module is considered internal.
 */

import { createRequireAI } from '../../middleware/auth.js';
import { aiService } from '../../ai-service.js';
import { AIError, AI_ERROR_CODE, toAIError } from '../../lib/ai-provider.js';
import logger from '../../lib/logger.js';
import { resolveMaxOutputTokens } from '../../lib/ai-output-budget.js';
import { checkAISpendCap, recordAISpend } from '../../lib/ai-spend-cap.js';
import { buildAIAuditMeta } from '../../lib/ai-audit.js';
import { auditLog } from '../../lib/audit.js';

// ---------------------------------------------------------------------------
// requireAI — factory-built middleware, instantiated once per process.
// ---------------------------------------------------------------------------
export const requireAI = createRequireAI(aiService);

// ---------------------------------------------------------------------------
// handleAIError — normalises provider / SDK errors into the Express response.
// ---------------------------------------------------------------------------
/**
 * Shared AI error handler — maps common AI errors to user-friendly responses.
 * Prefers typed AIError codes; falls back to string/status matching for
 * errors that haven't been converted yet (e.g. raw SDK errors on legacy paths).
 */
export function handleAIError(res, error, fallbackMessage = 'Failed to generate AI response. Please try again later.') {
    const code = error instanceof AIError ? error.code : null;

    // Monthly spend cap hit (thrown by guardedGenerate) — surface as a 429 with
    // the same structured shape the chat route uses.
    if (error?.code === 'AI_SPEND_CAP_REACHED') {
        return res.status(429).json({
            error: error.message || 'Monthly AI spend limit reached.',
            code: 'AI_SPEND_CAP_REACHED',
            spent_cents: error.spendInfo?.spentCents,
            cap_cents: error.spendInfo?.capCents,
        });
    }

    if (code === AI_ERROR_CODE.NOT_FOUND || (!code && (error.message?.includes('not found') || error.status === 404))) {
        return res.status(404).json({
            error: 'The configured AI model is not available. Please verify the GEMINI_MODEL setting.',
            code: 'MODEL_NOT_FOUND',
        });
    }
    if (code === AI_ERROR_CODE.AUTH || (!code && (error.message?.includes('API key') || error.status === 401))) {
        // Use HTTP 422 (Unprocessable Entity) — NOT 401 — so the frontend's
        // session-expiry middleware doesn't treat an upstream provider key
        // failure as a logged-out session and force a re-auth. The 401 status
        // is reserved for our own session cookie expiry.
        return res.status(422).json({
            error: 'Invalid or expired API key for the configured AI provider. Check your provider key.',
            code: 'INVALID_API_KEY',
        });
    }
    if (code === AI_ERROR_CODE.RATE_LIMITED) {
        return res.status(429).json({
            error: 'AI provider rate limit hit. Please try again in a moment.',
            code: 'RATE_LIMITED',
        });
    }
    if (code === AI_ERROR_CODE.QUOTA || (!code && (error.message?.includes('quota') || error.status === 429))) {
        return res.status(429).json({
            error: 'API quota exceeded for the configured AI provider. Try again later.',
            code: 'QUOTA_EXCEEDED',
        });
    }
    if (code === AI_ERROR_CODE.TIMEOUT) {
        return res.status(504).json({
            error: 'AI provider request timed out. Please try again.',
            code: 'AI_TIMEOUT',
        });
    }
    if (code === AI_ERROR_CODE.NETWORK) {
        return res.status(502).json({
            error: 'Could not reach the AI provider. Please try again.',
            code: 'AI_NETWORK_ERROR',
        });
    }
    if (code === AI_ERROR_CODE.OVERLOAD || (!code && (error.status === 503 || /overload|unavailable|high demand/i.test(error.message || '')))) {
        return res.status(503).json({
            error: 'The AI provider is under heavy load right now. Give it a moment and try again.',
            code: 'AI_OVERLOADED',
        });
    }
    return res.status(500).json({ error: fallbackMessage, code: 'AI_REQUEST_FAILED' });
}

// ---------------------------------------------------------------------------
// providerGenerateWithRetry — retry wrapper that works with any provider.
// ---------------------------------------------------------------------------
/*
 * Retry policy (mirrors server/lib/github-api.js):
 *   - 3 retries (total 4 attempts) for the options.retries default
 *   - Backoff: 400 ms, 800 ms, 1600 ms, ... with ±20% jitter
 *   - Retry-After (from 429 AIError.retryAfterMs) is honoured and CLAMPED to 60 s
 *   - Retryable codes: OVERLOAD, TIMEOUT, RATE_LIMITED, NETWORK
 *   - Non-retryable: AUTH, QUOTA, NOT_FOUND, INVALID_RESPONSE, CANCELED, UNKNOWN
 *
 * Streaming note: this wrapper is ONLY used with provider.generate() (blocking).
 * We intentionally do NOT retry provider.generateStream() — retrying mid-stream
 * would replay chunks the client has already consumed. If a stream errors
 * mid-flight the caller surfaces that to the client; a full retry is the
 * client's choice, not ours.
 */

const RETRYABLE_CODES = new Set([
    AI_ERROR_CODE.OVERLOAD,
    AI_ERROR_CODE.TIMEOUT,
    AI_ERROR_CODE.RATE_LIMITED,
    AI_ERROR_CODE.NETWORK,
]);

const DEFAULT_RETRIES = 3;
// Tests can collapse the backoff to ~1ms by setting AI_RETRY_BASE_DELAY_MS=1
// — keeps retry-path tests fast without bypassing the real retry logic.
const DEFAULT_BASE_DELAY_MS = Number.parseInt(process.env.AI_RETRY_BASE_DELAY_MS ?? '400', 10);
const MAX_RETRY_AFTER_MS = 60_000;

function computeBackoff(attempt, baseDelayMs) {
    // attempt is 1-indexed: 1 → base, 2 → base*2, 3 → base*4, ...
    const base = baseDelayMs * Math.pow(2, attempt - 1);
    const jitter = 0.8 + Math.random() * 0.4; // 0.8 .. 1.2
    return Math.round(base * jitter);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Invoke provider.generate() with retry on transient AI errors.
 *
 * @param {object} provider         — AIProvider instance
 * @param {object} opts             — forwarded to provider.generate
 * @param {object} [cfg]
 * @param {number} [cfg.retries]    — number of retries (default 3 → 4 attempts)
 * @param {number} [cfg.delayMs]    — base backoff delay (default 400)
 */
export async function providerGenerateWithRetry(
    provider,
    opts,
    { retries = DEFAULT_RETRIES, delayMs = DEFAULT_BASE_DELAY_MS } = {},
) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await provider.generate(opts);
        } catch (rawErr) {
            // Normalise raw SDK errors so we can dispatch on a stable code.
            const err = rawErr instanceof AIError ? rawErr : toAIError(rawErr);
            lastError = err;

            const isRetryable = RETRYABLE_CODES.has(err.code);
            if (!isRetryable || attempt === retries) break;

            // Prefer server-supplied Retry-After on 429 when present; otherwise
            // exponential backoff with jitter. Either way we clamp to 60s.
            let waitMs;
            if (err.code === AI_ERROR_CODE.RATE_LIMITED && typeof err.retryAfterMs === 'number') {
                waitMs = Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS);
            } else {
                waitMs = Math.min(computeBackoff(attempt + 1, delayMs), MAX_RETRY_AFTER_MS);
            }

            logger.warn(
                { attempt: attempt + 1, code: err.code, status: err.status, waitMs },
                'AI provider transient error, retrying',
            );
            await sleep(waitMs);
        }
    }

    throw lastError;
}

// ---------------------------------------------------------------------------
// guardedGenerate — providerGenerateWithRetry + uniform cost/audit guards.
// ---------------------------------------------------------------------------
/**
 * Run a non-streaming AI generation with the uniform OWASP-LLM10 guards applied,
 * so individual routes can't accidentally omit them:
 *   - spend cap CHECK before the call → throws `AI_SPEND_CAP_REACHED` (handleAIError maps it to 429)
 *   - per-call output-token cap injected (the global ceiling always wins)
 *   - spend RECORD + PII-safe audit AFTER the call
 *
 * Quota checks stay in the route (their metric varies). Use this instead of
 * `providerGenerateWithRetry` / `provider.generate` for every blocking AI call.
 *
 * @param {object} req — Express request (needs session.userId + aiProvider)
 * @param {object} opts — forwarded to provider.generate ({ prompt, schema, ... })
 * @param {{ feature: string }} meta — audit/feature label
 * @returns {Promise<{ text: string, parsed?: any, usage?: object, costUSD?: number }>}
 */
export async function guardedGenerate(req, opts, { feature } = {}) {
    const userId = req.session?.userId;

    const spend = checkAISpendCap(userId);
    if (!spend.allowed) {
        const err = new Error('Monthly AI spend limit reached. Try again next month or raise the cap.');
        err.code = 'AI_SPEND_CAP_REACHED';
        err.spendInfo = spend;
        throw err;
    }

    // Output cap is a hard ceiling: it overrides any route-supplied value.
    const generationConfig = { ...(opts?.generationConfig || {}), maxOutputTokens: resolveMaxOutputTokens() };
    const result = await providerGenerateWithRetry(req.aiProvider, { ...opts, generationConfig });

    recordAISpend(userId, result?.costUSD);
    auditLog(req, `ai.${feature || 'generate'}`, 'ai', null, buildAIAuditMeta({
        feature: feature || 'generate',
        model: req.aiProvider?.model,
        usage: result?.usage,
        costUSD: result?.costUSD,
    }));

    return result;
}

// ---------------------------------------------------------------------------
// Streaming guards — guardedGenerate's guards, split for the SSE call shape.
// ---------------------------------------------------------------------------
/**
 * Pre-stream spend-cap CHECK. Streaming routes call this BEFORE `initSSE`
 * (which commits a 200 + SSE headers) so an over-cap user gets a clean 429 JSON
 * envelope instead of an SSE error. Mirrors the check inside guardedGenerate.
 *
 * @param {object} req — Express request (needs session.userId)
 * @param {object} res — Express response
 * @returns {boolean} true if the request was denied (a 429 was sent); the
 *                    caller must `return` without streaming.
 */
export function denyIfSpendCapReached(req, res) {
    const spend = checkAISpendCap(req.session?.userId);
    if (spend.allowed) return false;
    res.status(429).json({
        error: 'Monthly AI spend limit reached. Try again next month or raise the cap.',
        code: 'AI_SPEND_CAP_REACHED',
        spent_cents: spend.spentCents,
        cap_cents: spend.capCents,
    });
    return true;
}

/**
 * Post-stream bookkeeping for an SSE AI call: record spend + emit a PII-safe
 * audit entry. The streaming analogue of guardedGenerate's tail.
 *
 * `usage`/`costUSD` come from `streamToSSEWithUsage` and may be null (provider
 * reported no usage, or the client disconnected) — `recordAISpend` no-ops on
 * null cost and the audit still records feature + model. Pass `extraMeta` to
 * merge route-specific fields (repo, commit_count, streamed:true) into the
 * audit meta; `action` overrides the default `ai.<feature>` audit action so
 * existing audit-log action names are preserved.
 *
 * @param {object} req
 * @param {object} opts
 * @param {string} [opts.feature]
 * @param {string} [opts.model]     — resolved model id (the streaming provider
 *                                     may differ from req.aiProvider, e.g. pr-chat)
 * @param {object|null} [opts.usage]
 * @param {number|null} [opts.costUSD]
 * @param {string} [opts.action]    — explicit audit action name
 * @param {object} [opts.extraMeta] — route-specific audit fields to merge
 */
export function recordStreamCompletion(req, { feature, model, usage, costUSD, action, extraMeta } = {}) {
    recordAISpend(req.session?.userId, costUSD);
    auditLog(req, action || `ai.${feature || 'stream'}`, 'ai', null, {
        ...(extraMeta || {}),
        ...buildAIAuditMeta({ feature, model, usage, costUSD }),
    });
}
