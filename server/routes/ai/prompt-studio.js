// SPDX-License-Identifier: AGPL-3.0-only
/*
 * AI Prompt Studio routes (slice 1b — premium)
 *
 *   GET    /presets                          — list visible presets (built-ins + user's custom)
 *   GET    /presets/:id                      — full preset body
 *   POST   /presets                          — create custom (Pro)
 *   PATCH  /presets/:id                      — edit (Pro)
 *   DELETE /presets/:id                      — delete (Pro)
 *   POST   /presets/:id/test                 — run on a fixed sample diff (Pro, 1/10s/user)
 *   POST   /presets/:id/set-default          — mark as scope default (Pro)
 *
 * Mounted at `/api/ai/prompt-studio` from server/routes/ai.js.
 *
 * GET endpoints are free (only requireAuth) so the UI can render the picker
 * for every tier; mutations and the /test sandbox are gated behind
 * `requireTier('pro')`. Built-in keys (general/security/...) are reserved —
 * POST /presets returns 409 RESERVED_KEY rather than letting a custom row
 * shadow a built-in.
 *
 * The store enforces ownership via `WHERE user_id = ?` on every read /
 * update / delete, so a numeric id collision still fails the user check —
 * cross-user IDOR is structurally impossible.
 */

import express from 'express';
import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { requireTier } from '../../middleware/require-tier.js';
import { validateBody } from '../../middleware/validate-request.js';
import { promptPresetCreateSchema, promptPresetUpdateSchema } from '../../lib/validators.js';
import {
    listPresets,
    getPresetById,
    savePreset,
    updatePreset,
    deletePreset,
    setDefault,
} from '../../lib/ai-prompt-store.js';
import { BUILTIN_PRESETS, BUILTIN_KEYS, isBuiltinKey } from '../../lib/ai-features/builtin-prompts.js';
import { resolvePromptForGenerate } from '../../lib/ai-features/prompt-registry.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { runDeepReview } from '../../lib/ai-features/pr-deep-review.js';
import logger from '../../lib/logger.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Param validator — `:id` is either a built-in string key (`general`, `security`,
// ...) or a positive numeric id pointing at an `ai_review_prompts` row. Anything
// else fails fast with 400 so the handlers never see junk.
// ---------------------------------------------------------------------------

router.param('id', (req, res, next, val) => {
    if (!isBuiltinKey(val) && !/^\d+$/.test(val)) {
        return errorResponse(res, 400, 'Invalid preset id', 'INVALID_PARAM');
    }
    next();
});

// ---------------------------------------------------------------------------
// In-memory rate limiter for /presets/:id/test — 1 call per 10s per user.
// The /test endpoint runs a real LLM round-trip; without throttling a single
// user could trivially burn provider quota by hammering the button.
// ---------------------------------------------------------------------------

const testBuckets = new Map();
const TEST_COOLDOWN_MS = 10_000;

function testRateLimit(req, res, next) {
    const userId = req.session?.userId;
    if (!userId) return next();
    const last = testBuckets.get(userId) ?? 0;
    const now = Date.now();
    if (now - last < TEST_COOLDOWN_MS) {
        const retryAfter = Math.ceil((TEST_COOLDOWN_MS - (now - last)) / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return errorResponse(res, 429, `Wait ${retryAfter}s before testing again`, 'RATE_LIMITED');
    }
    testBuckets.set(userId, now);
    next();
}

/**
 * Test-only helper: clear the per-user /test cooldown buckets between tests.
 * Not exported via the router; consumers must `import { _resetTestBuckets }`
 * directly from this module.
 */
export function _resetTestBuckets() {
    testBuckets.clear();
}

// ---------------------------------------------------------------------------
// GET /presets — list visible presets for the caller
// ---------------------------------------------------------------------------

router.get('/presets', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const builtins = BUILTIN_KEYS.map((k) => ({
        id: k,
        builtin: true,
        name: BUILTIN_PRESETS[k].name,
        scope: 'builtin',
        severityFloor: BUILTIN_PRESETS[k].severityFloor,
    }));
    const custom = listPresets(userId).map((p) => ({
        id: p.id,
        builtin: false,
        name: p.name,
        scope: p.scope,
        scopeTarget: p.scopeTarget,
        presetKey: p.presetKey,
        severityFloor: p.severityFloor,
        isDefault: p.isDefault,
    }));
    res.json({ presets: [...builtins, ...custom] });
});

// ---------------------------------------------------------------------------
// GET /presets/:id — full preset body (built-in or owned custom)
// ---------------------------------------------------------------------------

router.get('/presets/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    if (isBuiltinKey(id)) {
        const b = BUILTIN_PRESETS[id];
        return res.json({
            id,
            builtin: true,
            name: b.name,
            body: b.body,
            severityFloor: b.severityFloor,
            scope: 'builtin',
        });
    }
    const preset = getPresetById(req.session.userId, Number(id));
    if (!preset) return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
    res.json({
        id: preset.id,
        builtin: false,
        name: preset.name,
        body: preset.systemPrompt,
        scope: preset.scope,
        scopeTarget: preset.scopeTarget,
        presetKey: preset.presetKey,
        pathRules: preset.pathRules,
        severityFloor: preset.severityFloor,
        isDefault: preset.isDefault,
    });
});

// ---------------------------------------------------------------------------
// POST /presets — create a custom preset (Pro)
// ---------------------------------------------------------------------------

router.post('/presets', requireAuth, requireTier('pro'), validateBody(promptPresetCreateSchema), (req, res) => {
    const userId = req.session.userId;
    const { scope, scopeTarget, presetKey, name, systemPrompt, pathRules, severityFloor } = req.validatedBody;
    if (isBuiltinKey(presetKey)) {
        return errorResponse(res, 409, `presetKey "${presetKey}" is a built-in name`, 'RESERVED_KEY');
    }
    try {
        const id = savePreset(userId, {
            scope,
            scopeTarget: scopeTarget ?? null,
            presetKey,
            name,
            systemPrompt,
            pathRules: pathRules ?? [],
            severityFloor: severityFloor ?? null,
            isDefault: false,
        });
        res.status(201).json({ id });
    } catch (err) {
        logger.warn({ err: err?.message, userId }, 'Failed to save preset');
        return errorResponse(res, 500, 'Failed to save preset', 'SAVE_FAILED');
    }
});

// ---------------------------------------------------------------------------
// PATCH /presets/:id — partial update of an owned preset (Pro)
// ---------------------------------------------------------------------------

router.patch('/presets/:id', requireAuth, requireTier('pro'), validateBody(promptPresetUpdateSchema), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 400, 'Cannot edit a built-in preset', 'BUILTIN');
    const changes = updatePreset(req.session.userId, id, req.validatedBody);
    if (changes === 0) return errorResponse(res, 404, 'Preset not found or not owned', 'NOT_FOUND');
    res.json({ id, changes });
});

// ---------------------------------------------------------------------------
// DELETE /presets/:id — discard an owned preset (Pro)
// ---------------------------------------------------------------------------

router.delete('/presets/:id', requireAuth, requireTier('pro'), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 400, 'Cannot delete a built-in preset', 'BUILTIN');
    const changes = deletePreset(req.session.userId, id);
    if (changes === 0) return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /presets/:id/set-default — mark as scope default (Pro)
// ---------------------------------------------------------------------------

router.post('/presets/:id/set-default', requireAuth, requireTier('pro'), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 400, 'Cannot mark a built-in as default', 'BUILTIN');
    const changes = setDefault(req.session.userId, id);
    if (changes === 0) return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
    res.json({ id });
});

// ---------------------------------------------------------------------------
// POST /presets/:id/test — sandbox-run the preset against a fixed sample diff
// ---------------------------------------------------------------------------
// We deliberately keep the sample tiny and deterministic so the cost of a
// /test call is predictable and low. Resolving the preset through the same
// `resolvePromptForGenerate` path as the real generate route means the
// preview reflects exactly what a real review would see (including style-
// guide substitution and severity floor).

const SAMPLE_DIFF = `--- src/sample.js
@@ -1,5 +1,5 @@
-function compare(a, b) { return a == b; }
+function compare(a, b) { return a === b; }
`;
const SAMPLE_FILE = { filename: 'src/sample.js', status: 'modified', additions: 1, deletions: 1, changes: 2 };
const SAMPLE_PR = { title: 'Use strict equality', author: 'tester', body: 'Sample PR', additions: 1, deletions: 1 };

router.post('/presets/:id/test', requireAuth, requireTier('pro'), testRateLimit, async (req, res) => {
    const id = req.params.id;
    const userId = req.session.userId;

    let provider;
    try {
        provider = await createProviderForUser(userId, 'completion', { featureKey: 'PR_DEEP_REVIEW' });
    } catch (err) {
        logger.warn({ err: err?.message, userId }, 'Failed to resolve AI provider for preset /test');
        return errorResponse(res, 500, 'Failed to load AI provider configuration.', 'PROVIDER_LOOKUP_FAILED');
    }
    if (!provider) {
        return errorResponse(res, 404, 'No AI provider configured', 'NO_AI_PROVIDER');
    }

    let resolved;
    try {
        resolved = await resolvePromptForGenerate({
            userId,
            repoOwner: 'sample',
            repoName: 'repo',
            presetKey: id,
            session: req.session,
            prTitle: SAMPLE_PR.title,
            author: SAMPLE_PR.author,
        });
    } catch (err) {
        if (err?.code === 'PRESET_NOT_FOUND') {
            return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
        }
        logger.warn({ err: err?.message, userId, id }, 'resolvePromptForGenerate failed in /test');
        return errorResponse(res, 500, 'Failed to resolve preset', 'RESOLVE_FAILED');
    }

    let result;
    try {
        result = await runDeepReview({
            provider,
            userId,
            repoFullName: 'sample/repo',
            prMetadata: SAMPLE_PR,
            fileManifest: [SAMPLE_FILE],
            diffPatch: SAMPLE_DIFF,
            resolvedPrompt: resolved,
        });
    } catch (err) {
        logger.warn({ err: err?.message, code: err?.code, userId, id }, 'runDeepReview failed in /test');
        const status = err?.status || 500;
        const code = err?.code || 'TEST_FAILED';
        return errorResponse(res, status, err?.message || 'Preset test failed', code);
    }

    if (!result) return errorResponse(res, 503, 'AI Deep Review disabled', 'AI_DISABLED');
    res.json({ presetName: resolved.name, source: resolved.source, sample: result });
});

export default router;
