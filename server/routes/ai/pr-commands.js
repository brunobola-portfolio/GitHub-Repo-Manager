// SPDX-License-Identifier: Apache-2.0
/*
 * PR-context AI slash commands routes. Free tier (2026-07-18 rebalance),
 * metered against prCommandPerMonth.
 *
 *   POST   /:owner/:repo/:pr/:command            — generate (or refresh) cached result
 *   GET    /:owner/:repo/:pr/:command            — fetch cached result (no LLM call)
 *   POST   /:owner/:repo/:pr/describe/publish    — PATCH PR body via GitHub
 *
 * Mounted at `/api/ai/pr-commands` from server/routes/ai.js.
 *
 * Every handler reads `req.session.userId` directly — never trusts a body or
 * query param to identify the caller. The store enforces ownership via
 * `WHERE user_id = ?` so cross-user IDOR is structurally impossible.
 */

import express from 'express';
import { reserveAIQuota } from '../ai-quota.js';
import { createHash } from 'crypto';

import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import { readThrough } from '../../lib/gh-cache.js';
import { executeViaOutbox } from '../../lib/outbox-helper.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { quotaExceededResponse } from '../../lib/usage-meter.js';
import { denyIfSpendCapReached, recordStreamCompletion } from './shared.js';
import { runPRCommand, isSupportedCommand } from '../../lib/ai-features/pr-commands.js';
import {
    saveResult,
    getResult,
    deleteResult,
} from '../../lib/ai-pr-command-store.js';
import logger from '../../lib/logger.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory per-user rate limiter mirroring the deep-review pattern.
// 20 generations per hour per user (Pro feature so the cap is more generous
// than deep-review's 10/min — but the window is hour-scaled because each
// command is cheaper than a full deep review).
// ---------------------------------------------------------------------------

const generateRateBuckets = new Map(); // userId -> [timestamps]
const RATE_WINDOW_MS = 60 * 60_000; // 1 hour
const RATE_LIMIT_PER_WINDOW = 20;
const SWEEP_INTERVAL_MS = 5 * 60_000;

export function _runRateLimitSweep() {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [userId, bucket] of generateRateBuckets) {
        const fresh = bucket.filter((t) => t > cutoff);
        if (fresh.length === 0) {
            generateRateBuckets.delete(userId);
        } else if (fresh.length !== bucket.length) {
            generateRateBuckets.set(userId, fresh);
        }
    }
}

// Lazily install the sweep interval on first rate-limited request so module
// import (notably inside vitest workers) does not spawn a background timer
// that keeps Node alive or fires across unrelated tests.
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
            `Rate limit: max ${RATE_LIMIT_PER_WINDOW} AI commands per hour. Retry in ${retryAfter}s.`,
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
router.param('command', (req, res, next, val) => {
    if (!isSupportedCommand(val)) {
        return errorResponse(res, 400, 'Invalid command. Expected describe, test_plan, or improve.', 'INVALID_COMMAND');
    }
    next();
});

// ---------------------------------------------------------------------------
// Shared PR/files fetcher (reads through gh-cache for SWR semantics).
// ---------------------------------------------------------------------------

async function fetchPRContext(req, owner, repo, pr) {
    const userId = req.session.userId;
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
    return { prData: prResult.data, files: filesResult.data };
}

// ---------------------------------------------------------------------------
// POST — generate (or refresh) a cached result
// ---------------------------------------------------------------------------

router.post('/:owner/:repo/:pr/:command', requireAuth, generateRateLimit, async (req, res) => {
    const { owner, repo, pr, command } = req.params;
    const userId = req.session.userId;

    // Short-circuit the publish sub-route which lives at the same path depth.
    // Express dispatches the more specific `/describe/publish` handler
    // registered later first, so this is purely defensive.
    if (command === 'publish') {
        return errorResponse(res, 400, 'Invalid command. Expected describe, test_plan, or improve.', 'INVALID_COMMAND');
    }

    // PR commands moved off the Pro paywall to Free (2026-07-18 rebalance) —
    // meter against prCommandPerMonth AND the global ai_queries pool, and
    // enforce the monthly spend cap, all BEFORE any provider call (OWASP LLM10).
    const quota = reserveAIQuota(req, res, 'ai_pr_command');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse(quota));
    }
    if (denyIfSpendCapReached(req, res)) return;

    let provider;
    try {
        provider = await createProviderForUser(userId, 'completion', { featureKey: 'PR_COMMAND' });
    } catch (err) {
        logger.warn({ err, userId }, 'Failed to resolve AI provider for PR command');
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

    let prData;
    let files;
    try {
        ({ prData, files } = await fetchPRContext(req, owner, repo, pr));
    } catch (err) {
        logger.warn({ err: err?.message, owner, repo, pr }, 'Failed to fetch PR data for command');
        const status = err?.status === 404 ? 404 : 502;
        const code = err?.status === 404 ? 'PR_NOT_FOUND' : 'GITHUB_FETCH_FAILED';
        return errorResponse(res, status, err?.message || 'Failed to fetch PR data from GitHub.', code);
    }

    if (!prData?.head?.sha) {
        return errorResponse(res, 502, 'PR data is missing the head commit SHA.', 'GITHUB_FETCH_FAILED');
    }

    const diffPatch = (files || [])
        .map((f) => `--- ${f.filename}\n${f.patch || ''}`)
        .join('\n\n');

    let result;
    try {
        result = await runPRCommand({
            provider,
            userId,
            command,
            repoFullName: `${owner}/${repo}`,
            prMetadata: {
                title: prData.title,
                author: prData.user?.login,
                body: prData.body,
                additions: prData.additions,
                deletions: prData.deletions,
            },
            fileManifest: files,
            diffPatch,
        });
    } catch (err) {
        logger.warn({ err: err?.message, code: err?.code, owner, repo, pr, command }, 'PR command engine failed');
        const status = err?.status || 500;
        const code = err?.code || 'PR_COMMAND_FAILED';
        return errorResponse(res, status, err?.message || 'AI command generation failed.', code);
    }

    if (!result) {
        return errorResponse(res, 503, 'AI features are disabled on this server.', 'AI_DISABLED');
    }

    const id = saveResult(
        userId,
        owner,
        repo,
        Number(pr),
        command,
        prData.head.sha,
        result.output,
        result.costUsd ?? null,
        result.modelUsed,
    );

    // Meter the query + record spend + write a PII-safe cost audit.
    recordStreamCompletion(req, {
        feature: 'pr_command',
        action: 'ai.pr_command',
        model: result.modelUsed,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        costUSD: result.costUsd ?? null,
        extraMeta: { command, repo: `${owner}/${repo}`, pr: Number(pr) },
    });

    res.json({
        id,
        command,
        output: result.output,
        modelUsed: result.modelUsed,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        lastHeadSha: prData.head.sha,
    });
});

// ---------------------------------------------------------------------------
// GET — fetch cached result (no LLM call)
// ---------------------------------------------------------------------------

router.get('/:owner/:repo/:pr/:command', requireAuth, (req, res) => {
    const { owner, repo, pr, command } = req.params;
    const got = getResult(req.session.userId, owner, repo, Number(pr), command);
    if (!got) return errorResponse(res, 404, 'No cached result.', 'NOT_FOUND');
    res.json({
        id: got.id,
        command: got.command,
        output: got.output,
        modelUsed: got.modelUsed,
        costUsd: got.costUsd,
        lastHeadSha: got.lastHeadSha,
        updatedAt: got.updatedAt,
    });
});

// ---------------------------------------------------------------------------
// DELETE — discard a cached result
// ---------------------------------------------------------------------------

router.delete('/:owner/:repo/:pr/:command', requireAuth, (req, res) => {
    const { owner, repo, pr, command } = req.params;
    const changes = deleteResult(req.session.userId, owner, repo, Number(pr), command);
    if (changes === 0) return errorResponse(res, 404, 'No cached result.', 'NOT_FOUND');
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /describe/publish — PATCH the PR body via the GitHub API.
//
// Validates that the cached `last_head_sha` still matches the current head,
// so we never overwrite the PR body on top of a stale review.
// ---------------------------------------------------------------------------

router.post('/:owner/:repo/:pr/describe/publish', requireAuth, async (req, res) => {
    const { owner, repo, pr } = req.params;
    const userId = req.session.userId;

    const got = getResult(userId, owner, repo, Number(pr), 'describe');
    if (!got) return errorResponse(res, 404, 'No describe result to publish.', 'NOT_FOUND');

    const newBody = got.output?.body;
    if (typeof newBody !== 'string' || newBody.length === 0) {
        return errorResponse(res, 422, 'Describe result is missing a body.', 'INVALID_DESCRIBE');
    }
    const newTitle = typeof got.output?.title === 'string' && got.output.title.trim().length > 0
        ? got.output.title
        : null;

    // Re-fetch the PR head SHA to detect a stale describe result. We don't
    // reject on mismatch — that's the caller's choice — we just include the
    // current vs cached SHA in the response so the UI can prompt the user.
    let currentHeadSha;
    try {
        const { prData } = await fetchPRContext(req, owner, repo, pr);
        currentHeadSha = prData?.head?.sha ?? null;
    } catch (err) {
        logger.warn({ err: err?.message, owner, repo, pr }, 'Failed to refresh PR data before describe publish');
        // We continue — the user explicitly clicked publish, and stale data
        // is a soft signal not a hard block.
    }

    const payload = { body: newBody };
    if (newTitle) payload.title = newTitle;

    // Include a hash of the published body in the idempotency key so a
    // regenerate-then-republish cycle (same row id + same head SHA, but new
    // body content) is treated as a NEW outbox row. Without this, the second
    // publish would silently dedupe against the first one and the user's
    // refreshed description would never reach GitHub.
    const bodyHash = createHash('sha256')
        .update(`${newTitle || ''}\n${newBody}`)
        .digest('hex')
        .slice(0, 12);

    let queuedInfo = null;
    let prResp;
    try {
        const result = await executeViaOutbox(req, {
            method: 'PATCH',
            url: `/repos/${owner}/${repo}/pulls/${pr}`,
            body: payload,
            idempotencyKey: `pr-command-describe:${got.id}:${got.lastHeadSha}:${bodyHash}`,
        });
        if (result.queued) {
            queuedInfo = { queued: true, outboxId: result.outboxId };
        } else {
            prResp = result.data;
        }
    } catch (err) {
        logger.warn({ err: err?.message, owner, repo, pr }, 'GitHub PATCH failed for /describe publish');
        const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 502;
        return errorResponse(res, status, err?.message || 'Failed to publish description to GitHub.', 'PUBLISH_FAILED');
    }

    if (queuedInfo) {
        return res.status(202).json({
            id: got.id,
            ...queuedInfo,
            staleHead: currentHeadSha && currentHeadSha !== got.lastHeadSha,
            message: 'Describe publish queued — will sync when GitHub is reachable.',
        });
    }

    res.json({
        id: got.id,
        prNumber: Number(pr),
        title: prResp?.title ?? null,
        bodyApplied: typeof prResp?.body === 'string',
        staleHead: currentHeadSha && currentHeadSha !== got.lastHeadSha,
    });
});

export default router;
