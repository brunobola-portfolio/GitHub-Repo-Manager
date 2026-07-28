// SPDX-License-Identifier: AGPL-3.0-only
/*
 * PR Chat routes. Free tier (2026-07-18 rebalance), metered against
 * prChatMessagesPerMonth.
 *
 *   GET    /:owner/:repo/:pr   — fetch persisted conversation history
 *   POST   /:owner/:repo/:pr   — SSE-stream a new turn (body: { message })
 *   DELETE /:owner/:repo/:pr   — clear conversation
 *
 * Mounted at `/api/ai/pr-chat` from server/routes/ai.js.
 *
 * Every handler reads `req.session.userId` directly. The store enforces
 * ownership via `WHERE user_id = ?` so cross-user IDOR is structurally
 * impossible.
 *
 * NOTE: this slice ships the "no tools" version of the chat — the assistant
 * answers from the system prompt + persisted history only. See pr-chat.js
 * for the TODO on threading read-only tools through provider adapters.
 */

import express from 'express';

import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import { readThrough } from '../../lib/gh-cache.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { initSSE, streamToSSEWithUsage } from '../ai-streaming.js';
import { denyIfSpendCapReached, recordStreamCompletion } from './shared.js';
import {
    appendMessage,
    listMessages,
    clearConversation,
} from '../../lib/ai-pr-chat-store.js';
import {
    buildSystemPrompt,
    compactHistory,
    renderHistoryAsPrompt,
    MAX_USER_MESSAGE_LEN,
} from '../../lib/ai-features/pr-chat.js';
import { getDraft } from '../../lib/ai-pr-review-store.js';
import { resolveMaxOutputTokens } from '../../lib/ai-output-budget.js';
import logger from '../../lib/logger.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Per-user rate limit: 30 messages per hour. Mirrors pr-commands' lazy sweep.
// ---------------------------------------------------------------------------

const generateRateBuckets = new Map();
const RATE_WINDOW_MS = 60 * 60_000;
const RATE_LIMIT_PER_WINDOW = 30;
const SWEEP_INTERVAL_MS = 5 * 60_000;

export function _runRateLimitSweep() {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [userId, bucket] of generateRateBuckets) {
        const fresh = bucket.filter((t) => t > cutoff);
        if (fresh.length === 0) generateRateBuckets.delete(userId);
        else if (fresh.length !== bucket.length) generateRateBuckets.set(userId, fresh);
    }
}

let _sweepInterval = null;
export function ensureSweepInterval() {
    if (_sweepInterval || process.env.NODE_ENV === 'test') return;
    _sweepInterval = setInterval(_runRateLimitSweep, SWEEP_INTERVAL_MS);
    if (typeof _sweepInterval.unref === 'function') _sweepInterval.unref();
}

function generateRateLimit(req, res, next) {
    ensureSweepInterval();
    const userId = req.session?.userId;
    if (!userId) return next();
    const now = Date.now();
    const bucket = (generateRateBuckets.get(userId) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (bucket.length >= RATE_LIMIT_PER_WINDOW) {
        const retryAfter = Math.ceil((RATE_WINDOW_MS - (now - bucket[0])) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return errorResponse(
            res,
            429,
            `Rate limit: max ${RATE_LIMIT_PER_WINDOW} chat messages per hour. Retry in ${retryAfter}s.`,
            'RATE_LIMITED',
        );
    }
    bucket.push(now);
    generateRateBuckets.set(userId, bucket);
    next();
}

export function _resetRateLimits() {
    generateRateBuckets.clear();
}

// ---------------------------------------------------------------------------
// Param validators
// ---------------------------------------------------------------------------

const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

router.param('owner', (req, res, next, val) => {
    if (typeof val !== 'string' || val.length > 39 || !GITHUB_NAME_RE.test(val)) {
        return errorResponse(res, 400, 'Invalid owner', 'INVALID_PARAM');
    }
    next();
});
router.param('repo', (req, res, next, val) => {
    if (typeof val !== 'string' || val.length > 100 || !GITHUB_NAME_RE.test(val)) {
        return errorResponse(res, 400, 'Invalid repo', 'INVALID_PARAM');
    }
    next();
});
router.param('pr', (req, res, next, val) => {
    if (!/^\d{1,10}$/.test(val)) {
        return errorResponse(res, 400, 'Invalid PR number', 'INVALID_PARAM');
    }
    next();
});

// ---------------------------------------------------------------------------
// GET — return persisted history (no LLM call)
// ---------------------------------------------------------------------------

router.get('/:owner/:repo/:pr', requireAuth, (req, res) => {
    const { owner, repo, pr } = req.params;
    const messages = listMessages(req.session.userId, owner, repo, Number(pr));
    res.json({ messages });
});

// ---------------------------------------------------------------------------
// DELETE — wipe the conversation
// ---------------------------------------------------------------------------

router.delete('/:owner/:repo/:pr', requireAuth, (req, res) => {
    const { owner, repo, pr } = req.params;
    const removed = clearConversation(req.session.userId, owner, repo, Number(pr));
    res.json({ cleared: removed });
});

// ---------------------------------------------------------------------------
// POST — SSE stream a new turn.
// ---------------------------------------------------------------------------

router.post('/:owner/:repo/:pr', requireAuth, generateRateLimit, async (req, res) => {
    const { owner, repo, pr } = req.params;
    const userId = req.session.userId;

    const userMessage = String(req.body?.message ?? '').trim();
    if (!userMessage) {
        return errorResponse(res, 400, 'message is required', 'INVALID_INPUT');
    }
    if (userMessage.length > MAX_USER_MESSAGE_LEN) {
        return errorResponse(res, 400, `message exceeds ${MAX_USER_MESSAGE_LEN} characters`, 'INVALID_INPUT');
    }

    // PR Chat moved off the Pro paywall to Free (2026-07-18 rebalance) — meter
    // against prChatMessagesPerMonth AND the global ai_queries pool, and
    // enforce the monthly spend cap — both BEFORE any provider call or GitHub
    // fetch (OWASP LLM10). We have not opened the SSE stream yet, so a 429
    // JSON envelope is correct.
    const quota = checkAIFeatureLimit(userId, 'ai_pr_chat');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse(quota));
    }
    if (denyIfSpendCapReached(req, res)) return;

    let provider;
    try {
        provider = await createProviderForUser(userId, 'completion', { featureKey: 'PR_CHAT' });
    } catch (err) {
        logger.warn({ err, userId }, 'Failed to resolve AI provider for PR chat');
        return errorResponse(res, 500, 'Failed to load AI provider configuration.', 'PROVIDER_LOOKUP_FAILED');
    }
    if (!provider) {
        return errorResponse(
            res,
            404,
            'No AI provider configured. Set up your API key in Settings → AI.',
            'NO_AI_PROVIDER',
        );
    }

    // Fetch PR metadata + files (SWR via gh-cache).
    let prData;
    let files;
    try {
        const prResult = await readThrough({
            userId,
            resourceType: 'pulls',
            resourceKey: `${owner}/${repo}#${pr}`,
            ttlMs: 60_000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/pulls/${pr}`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        prData = prResult.data;
        const filesResult = await readThrough({
            userId,
            resourceType: 'pull_files',
            resourceKey: `${owner}/${repo}#${pr}`,
            ttlMs: 60_000,
            fetcher: ({ ifNoneMatch }) => githubApi(
                `/repos/${owner}/${repo}/pulls/${pr}/files?per_page=100`,
                req.session.accessToken,
                ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {},
            ),
        });
        files = filesResult.data;
    } catch (err) {
        logger.warn({ err: err?.message, owner, repo, pr }, 'Failed to fetch PR data for chat');
        const status = err?.status === 404 ? 404 : 502;
        const code = err?.status === 404 ? 'PR_NOT_FOUND' : 'GITHUB_FETCH_FAILED';
        return errorResponse(res, status, err?.message || 'Failed to fetch PR data from GitHub.', code);
    }

    // Optional walkthrough excerpt from a prior deep-review draft.
    let walkthroughText = '';
    try {
        const draft = getDraft(userId, owner, repo, Number(pr));
        if (draft?.draft?.walkthrough?.summary) {
            walkthroughText = String(draft.draft.walkthrough.summary);
        }
    } catch (err) {
        logger.debug({ err: err?.message }, 'PR chat: no prior walkthrough available');
    }

    // Persist the user turn FIRST so the conversation reflects the request
    // even if the model errors mid-stream.
    appendMessage(userId, owner, repo, Number(pr), { role: 'user', content: userMessage });

    const history = listMessages(userId, owner, repo, Number(pr));
    const compacted = compactHistory(history);

    const systemPrompt = buildSystemPrompt({
        repoFullName: `${owner}/${repo}`,
        prMetadata: {
            number: Number(pr),
            title: prData?.title,
            author: prData?.user?.login,
            body: prData?.body,
        },
        walkthrough: walkthroughText,
        fileManifest: files,
    });

    const transcript = renderHistoryAsPrompt(compacted);
    const fullPrompt = `${transcript}\n\nAssistant:`;

    const sse = initSSE(res, req);

    let assistantText = '';
    let streamUsage = null;
    let streamCostUSD = null;
    let streamPartial = false;
    try {
        if (typeof provider.generateStream !== 'function') {
            throw new Error('Configured AI provider does not support streaming.');
        }
        const stream = provider.generateStream({
            prompt: fullPrompt,
            systemPrompt,
            signal: sse.signal,
            generationConfig: { maxOutputTokens: resolveMaxOutputTokens() },
        });
        const completed = await streamToSSEWithUsage(stream, sse);
        assistantText = completed.text;
        streamUsage = completed.usage;
        streamCostUSD = completed.costUSD;
        streamPartial = completed.partial;
    } catch (err) {
        logger.warn({ err: err?.message, code: err?.code, owner, repo, pr }, 'PR chat stream failed');
        if (!sse.isAborted) {
            sse.sendError(err?.message || 'Chat stream failed.');
        }
        return;
    }

    // Meter the AI query + record monthly spend + a PII-safe audit entry
    // (OWASP LLM10). Usage/cost come from the stream and may be null when the
    // provider reported none — recordAISpend no-ops on null. A client that
    // disconnected mid-stream still bills for what it consumed, flagged partial.
    incrementAIUsage(userId, 'ai_pr_chat');
    recordStreamCompletion(req, {
        feature: 'pr_chat',
        model: provider?._modelName ?? null,
        usage: streamUsage,
        costUSD: streamCostUSD,
        partial: streamPartial,
    });

    // Persist assistant reply (best-effort; partial reply still useful).
    if (assistantText) {
        try {
            appendMessage(userId, owner, repo, Number(pr), {
                role: 'assistant',
                content: assistantText,
                modelUsed: provider?._modelName ?? null,
            });
        } catch (err) {
            logger.warn({ err: err?.message }, 'Failed to persist assistant chat message');
        }
    }

    sse.sendDone(assistantText);
});

export default router;
