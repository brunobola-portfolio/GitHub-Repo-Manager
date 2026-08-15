// SPDX-License-Identifier: Apache-2.0
/**
 * Work Board AI Assistant routes. Mounted at /api/v1/work-board/ai.
 * Every route requires requireAuth + requireWorkBoardAI.
 */

import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkBoardAI } from '../middleware/work-board-ai-gate.js';
import { computeSuggestions, dismissSuggestion } from '../lib/work-board-suggestions-engine.js';
import { createProviderForUser } from '../lib/ai-provider.js';
import { loadPrompt } from '../lib/ai-features/work-board-assistant/prompts/index.js';
import { signDiffToken, verifyDiffToken } from '../lib/work-board-ai-hmac.js';
import { recordSpend, getMonthlySpend, getCurrentMonthKey } from '../lib/work-board-ai-cost.js';
import { estimateCallCostCents } from '../lib/provider-pricing.js';
import { bulkUpdate } from '../lib/work-board-tracking.js';
import db from '../db.js';

const router = express.Router();

const VALID_ACTIONS = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);

// Per-user rate limit on /interpret: each call fires a billable LLM request,
// and requireWorkBoardAI only enforces a *monthly* cap (and only when one is
// set), so without this a tight request loop could burn the whole budget in
// seconds. Keyed on userId so one user can't exhaust another's allowance.
const interpretLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30,
    keyGenerator: (req) => `wb-ai-interpret:${req.session?.userId ?? ipKeyGenerator(req)}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many AI requests — slow down and try again shortly', code: 'rate_limited' },
    skip: (req) => !req.session?.userId,
});

function listTrackedReposForPrompt(userId) {
    return db.prepare(
        'SELECT repo_full_name, is_pinned, is_muted, source_signal FROM work_board_tracked_repos WHERE user_id = ?'
    ).all(userId);
}

function extractJsonBlob(text) {
    const trimmed = (text ?? '').trim();
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
}

// GET /status — lightweight enablement probe used by the UI to avoid firing
// gated endpoints when the feature is off. Never returns 403/404 itself; the
// client reads `enabled` and decides.
router.get('/status', requireAuth, (req, res) => {
    const featureFlagEnabled = process.env.WORK_BOARD_AI_ENABLED === 'true';
    if (!featureFlagEnabled) {
        return res.json({ enabled: false, reason: 'AI_FEATURE_FLAG_OFF' });
    }

    const prefs = db.prepare(
        'SELECT ai_assistant_enabled, ai_monthly_cap_cents FROM work_board_prefs WHERE user_id = ?'
    ).get(req.session.userId);

    const userEnabled = !!prefs && prefs.ai_assistant_enabled === 1;
    if (!userEnabled) {
        return res.json({ enabled: false, reason: 'AI_ASSISTANT_DISABLED' });
    }

    let capReached = false;
    if (prefs.ai_monthly_cap_cents > 0) {
        const month = new Date().toISOString().slice(0, 7);
        const spendRow = db.prepare(
            'SELECT cents FROM work_board_ai_spend WHERE user_id = ? AND month = ?'
        ).get(req.session.userId, month);
        const spent = spendRow?.cents ?? 0;
        capReached = spent >= prefs.ai_monthly_cap_cents;
    }

    res.json({
        enabled: !capReached,
        reason: capReached ? 'AI_COST_CAP_REACHED' : 'OK',
        capCents: prefs.ai_monthly_cap_cents || 0,
    });
});

router.get('/suggestions', requireAuth, requireWorkBoardAI, (req, res) => {
    const suggestions = computeSuggestions(req.session.userId);
    res.json({ suggestions });
});

router.post('/dismiss-suggestion', requireAuth, requireWorkBoardAI, (req, res) => {
    const { pattern_key, repo_full_name } = req.body ?? {};
    if (!pattern_key || typeof pattern_key !== 'string') {
        return res.status(400).json({ error: 'pattern_key required (string)' });
    }
    dismissSuggestion(req.session.userId, pattern_key, repo_full_name ?? '');
    res.json({ dismissed: true });
});

router.post('/interpret', requireAuth, interpretLimiter, requireWorkBoardAI, async (req, res) => {
    const { prompt } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.length < 3) {
        return res.status(400).json({ error: 'prompt required (string, >= 3 chars)' });
    }

    const userId = req.session.userId;

    let provider;
    try {
        provider = await createProviderForUser(userId, 'completion');
    } catch (e) {
        return res.status(503).json({ code: 'AI_PROVIDER_UNAVAILABLE', error: e.message });
    }
    if (!provider) {
        return res.status(403).json({ code: 'AI_NOT_CONFIGURED', error: 'Configure a provider in AI Configuration' });
    }

    const tracked = listTrackedReposForPrompt(userId);
    const systemPrompt = loadPrompt('interpret');
    const userPrompt = `User request: ${prompt}\n\nTracked repositories:\n${JSON.stringify(tracked)}`;

    let llmText;
    try {
        const result = await provider.generate({
            prompt: userPrompt,
            systemPrompt,
            generationConfig: { maxOutputTokens: 1500, max_tokens: 1500 },
        });
        llmText = result?.text;
    } catch (e) {
        return res.status(502).json({ code: 'AI_PROVIDER_ERROR', error: e.message });
    }

    const parsed = extractJsonBlob(llmText);
    if (!parsed || !Array.isArray(parsed.actions)) {
        return res.status(502).json({ code: 'AI_INVALID_RESPONSE', error: 'LLM did not return a valid diff' });
    }

    const trackedSet = new Set(tracked.map(r => r.repo_full_name));
    const validActions = parsed.actions.filter(a =>
        a && typeof a.repo === 'string' && VALID_ACTIONS.has(a.action) && trackedSet.has(a.repo)
    );

    // Estimate cost from the actual prompt + response sizes and the provider's
    // model. This replaces the previous flat 1¢ that ignored both. The
    // estimate uses ~4 chars/token and per-model pricing in provider-pricing.js
    // so the per-user monthly cap reflects real usage within an order of
    // magnitude (vs. always 1¢).
    const callCostCents = estimateCallCostCents({
        modelName: provider.getModelName?.() ?? null,
        promptChars: (systemPrompt?.length ?? 0) + userPrompt.length,
        responseChars: llmText?.length ?? 0,
    });
    recordSpend(userId, callCostCents);

    const validity_token = signDiffToken({ userId, actions: validActions });

    res.json({
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        actions: validActions,
        validity_token,
        skipped: parsed.actions.length - validActions.length,
    });
});

router.post('/apply', requireAuth, requireWorkBoardAI, (req, res) => {
    const { validity_token } = req.body ?? {};
    if (typeof validity_token !== 'string') {
        return res.status(400).json({ error: 'validity_token required' });
    }
    const verified = verifyDiffToken(validity_token);
    if (!verified.valid) {
        return res.status(400).json({ code: 'INVALID_TOKEN', reason: verified.reason });
    }
    if (verified.payload.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Token belongs to another user' });
    }

    const actions = verified.payload.actions ?? [];
    if (actions.length === 0) {
        return res.json({ applied: 0, operation_id: null });
    }

    const byAction = new Map();
    for (const a of actions) {
        if (!byAction.has(a.action)) byAction.set(a.action, []);
        byAction.get(a.action).push(a.repo);
    }

    let applied = 0;
    let operationId = null;
    for (const [action, repos] of byAction.entries()) {
        const result = bulkUpdate(req.session.userId, repos, action);
        applied += result.updated;
        if (!operationId) operationId = result.operationId;
    }

    res.json({ applied, operation_id: operationId });
});

router.get('/activity', requireAuth, requireWorkBoardAI, (req, res) => {
    const spent_cents = getMonthlySpend(req.session.userId);
    res.json({
        month: getCurrentMonthKey(),
        spent_cents,
        cap_cents: req.aiPrefs.ai_monthly_cap_cents,
    });
});

export default router;
