// SPDX-License-Identifier: AGPL-3.0-only
/*
 * AI Prompt Studio routes. Free tier (2026-07-18 rebalance).
 *
 *   GET    /presets                          — list visible presets (built-ins + user's custom)
 *   GET    /presets/:id                      — full preset body
 *   POST   /presets                          — create custom (capped at promptPresetsMax)
 *   PATCH  /presets/:id                      — edit
 *   DELETE /presets/:id                      — delete
 *   POST   /presets/:id/test                 — run on a fixed sample diff (metered ai_prompt_test, 1/10s/user)
 *   POST   /presets/:id/set-default          — mark as scope default
 *
 * Mounted at `/api/ai/prompt-studio` from server/routes/ai.js.
 *
 * All endpoints require only `requireAuth` — preset CRUD moved off the Pro
 * paywall to Free (2026-07-18), with the *count* of saved presets capped at
 * `promptPresetsMax` (mirrors teams.js's teamsMax pattern) and the /test
 * sandbox metered against `promptStudioTestPerMonth`. Built-in keys
 * (general/security/...) are reserved — POST /presets returns 409
 * RESERVED_KEY rather than letting a custom row shadow a built-in.
 *
 * The store enforces ownership via `WHERE user_id = ?` on every read /
 * update / delete, so a numeric id collision still fails the user check —
 * cross-user IDOR is structurally impossible.
 */

import express from 'express';
import db from '../../db.js';
import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { createCooldownLimiter } from '../../lib/in-memory-rate-limiter.js';
import { validateBody } from '../../middleware/validate-request.js';
import { promptPresetCreateSchema, promptPresetUpdateSchema } from '../../lib/validators.js';
import {
    listPresets,
    listOrgScopedPresets,
    getPresetById,
    getOrgPresetById,
    savePreset,
    updatePreset,
    deletePreset,
    setDefault,
} from '../../lib/ai-prompt-store.js';
import { BUILTIN_PRESETS, BUILTIN_KEYS, isBuiltinKey } from '../../lib/ai-features/builtin-prompts.js';
import { resolvePromptForGenerate } from '../../lib/ai-features/prompt-registry.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { getFeatures } from '../../lib/feature-flags.js';
import { denyIfSpendCapReached, recordStreamCompletion } from './shared.js';
import { runDeepReview } from '../../lib/ai-features/pr-deep-review.js';
import {
    isOrgMember,
    getCurrentUserOrgs,
    filterOrgsByMembership,
} from '../../lib/github-org-membership.js';
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

// Cooldown limiter from the shared helper: 1 call per 10s per user, with a
// background sweeper so the per-user bucket Map doesn't grow forever. The
// previous local Map had no sweeper — every user who ever hit /test added a
// permanent entry.
const testCooldown = createCooldownLimiter({
    cooldownMs: 10_000,
    code: 'RATE_LIMITED',
    label: 'test',
});
const testRateLimit = testCooldown.middleware;

/**
 * Test-only helper: clear the per-user /test cooldown buckets between tests.
 * Not exported via the router; consumers must `import { _resetTestBuckets }`
 * directly from this module.
 */
export function _resetTestBuckets() {
    testCooldown.reset();
}

// ---------------------------------------------------------------------------
// GET /presets — list visible presets for the caller
// ---------------------------------------------------------------------------

router.get('/presets', requireAuth, async (req, res) => {
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
        ownedByUser: true,
    }));

    // Org-shared presets — visible to anyone who is an active member of the
    // owning org, but only the AUTHOR can edit/delete (the `ownedByUser` flag
    // tells the UI which actions to render). Other-author org rows are
    // de-duplicated against the user's own custom rows since `listPresets`
    // already returned any org rows the user authored themselves.
    let orgPresets = [];
    try {
        const userOrgs = await getCurrentUserOrgs({ session: req.session });
        const visibleOrgs = await filterOrgsByMembership({ session: req.session, orgs: userOrgs });
        const ownedIds = new Set(custom.map((p) => p.id));
        orgPresets = listOrgScopedPresets(visibleOrgs)
            .filter((p) => !ownedIds.has(p.id))
            .map((p) => ({
                id: p.id,
                builtin: false,
                shared: true,
                name: p.name,
                scope: 'org',
                scopeTarget: p.scopeTarget,
                presetKey: p.presetKey,
                severityFloor: p.severityFloor,
                isDefault: p.isDefault,
                ownedByUser: p.userId === userId,
            }));
    } catch (err) {
        // Org membership lookups should never break the list — log and continue.
        logger.warn({ err: err?.message, userId }, 'Failed to enrich presets with org-shared rows');
    }

    res.json({ presets: [...builtins, ...custom, ...orgPresets] });
});

// ---------------------------------------------------------------------------
// GET /presets/:id — full preset body (built-in or owned custom)
// ---------------------------------------------------------------------------

router.get('/presets/:id', requireAuth, async (req, res) => {
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
    const numericId = Number(id);
    const userId = req.session.userId;
    let preset = getPresetById(userId, numericId);
    let ownedByUser = !!preset;

    // Fall back to org-shared lookup: the row may belong to another author in
    // an org the caller is a member of. `getOrgPresetById` ignores user_id but
    // returns null for non-org rows, so the IDOR guard remains tight — only
    // org-scoped rows are reachable through this path.
    if (!preset) {
        const orgRow = getOrgPresetById(numericId);
        if (!orgRow || !orgRow.scopeTarget) {
            return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
        }
        const isMember = await isOrgMember({ session: req.session, org: orgRow.scopeTarget });
        if (!isMember) return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
        preset = orgRow;
        ownedByUser = orgRow.userId === userId;
    }

    res.json({
        id: preset.id,
        builtin: false,
        shared: preset.scope === 'org',
        name: preset.name,
        body: preset.systemPrompt,
        scope: preset.scope,
        scopeTarget: preset.scopeTarget,
        presetKey: preset.presetKey,
        pathRules: preset.pathRules,
        severityFloor: preset.severityFloor,
        isDefault: preset.isDefault,
        ownedByUser,
    });
});

// ---------------------------------------------------------------------------
// POST /presets — create a custom preset (Free, capped at promptPresetsMax)
// ---------------------------------------------------------------------------

router.post('/presets', requireAuth, validateBody(promptPresetCreateSchema), async (req, res) => {
    const userId = req.session.userId;
    const { scope, scopeTarget, presetKey, name, systemPrompt, pathRules, severityFloor } = req.validatedBody;
    if (isBuiltinKey(presetKey)) {
        return errorResponse(res, 409, `presetKey "${presetKey}" is a built-in name`, 'RESERVED_KEY');
    }
    // Free tier is capped at promptPresetsMax OWNED presets; Pro/Enterprise
    // are uncapped. Mirrors teams.js's teamsMax count-check pattern — presets
    // themselves cost nothing until tested, so this guards row growth, not $ cost.
    const flags = getFeatures(req.userTier || 'free');
    if (flags.promptPresetsMax !== undefined && flags.promptPresetsMax !== Infinity) {
        const owned = db.prepare('SELECT COUNT(*) as n FROM ai_review_prompts WHERE user_id = ?').get(userId).n;
        if (owned >= flags.promptPresetsMax) {
            return errorResponse(
                res,
                403,
                `Preset limit reached (${flags.promptPresetsMax}). Upgrade to Pro for unlimited presets.`,
                'tier_limit_exceeded',
            );
        }
    }
    // Org-shared presets require an active membership in the target org. We
    // verify via GitHub before persisting so non-members can't pollute another
    // org's shared preset list. Membership check is cached for 5 min.
    if (scope === 'org') {
        const member = await isOrgMember({ session: req.session, org: scopeTarget });
        if (!member) {
            return errorResponse(
                res,
                403,
                `You must be a member of ${scopeTarget} to create org-shared presets`,
                'NOT_ORG_MEMBER',
            );
        }
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
// NOTE (slice 5): edit/delete/set-default remain author-only even for
// org-shared presets — the store's `WHERE user_id = ?` clause naturally
// rejects non-author updates with 0 changes (→ 404 here). Org-admin override
// is intentionally out of scope for this slice; non-author org members can
// READ but cannot WRITE.

router.patch('/presets/:id', requireAuth, validateBody(promptPresetUpdateSchema), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 400, 'Cannot edit a built-in preset', 'BUILTIN');
    const changes = updatePreset(req.session.userId, id, req.validatedBody);
    if (changes === 0) return errorResponse(res, 404, 'Preset not found or not owned', 'NOT_FOUND');
    res.json({ id, changes });
});

// ---------------------------------------------------------------------------
// DELETE /presets/:id — discard an owned preset (Pro)
// ---------------------------------------------------------------------------

router.delete('/presets/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return errorResponse(res, 400, 'Cannot delete a built-in preset', 'BUILTIN');
    const changes = deletePreset(req.session.userId, id);
    if (changes === 0) return errorResponse(res, 404, 'Preset not found', 'NOT_FOUND');
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /presets/:id/set-default — mark as scope default (Pro)
// ---------------------------------------------------------------------------

router.post('/presets/:id/set-default', requireAuth, (req, res) => {
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

router.post('/presets/:id/test', requireAuth, testRateLimit, async (req, res) => {
    const id = req.params.id;
    const userId = req.session.userId;

    // A preset test runs a full deep review on a sample PR — Prompt Studio's
    // /test moved off the Pro paywall to Free (2026-07-18 rebalance). Meter
    // against promptStudioTestPerMonth AND the global ai_queries pool, and
    // enforce the spend cap before any provider call (OWASP LLM10).
    const quota = checkAIFeatureLimit(userId, 'ai_prompt_test');
    if (!quota.allowed) {
        return res.status(429).json(quotaExceededResponse(quota));
    }
    if (denyIfSpendCapReached(req, res)) return;

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

    // Meter the query + record spend + write a PII-safe cost audit.
    incrementAIUsage(userId, 'ai_prompt_test');
    recordStreamCompletion(req, {
        feature: 'prompt_test',
        action: 'ai.prompt_test',
        model: result.modelUsed,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        costUSD: result.costUsd ?? null,
        extraMeta: { presetId: id },
    });

    res.json({ presetName: resolved.name, source: resolved.source, sample: result });
});

export default router;
