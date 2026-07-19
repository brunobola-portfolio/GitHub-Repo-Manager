/*
 * GitHub Repo Manager - Actions / Webhooks / Community / Dev Toolkit Routes
 *
 * Endpoints:
 *   Webhooks:
 *     GET    /:owner/:repo/hooks
 *     POST   /:owner/:repo/hooks
 *     PATCH  /:owner/:repo/hooks/:hook_id
 *     DELETE /:owner/:repo/hooks/:hook_id
 *     POST   /:owner/:repo/hooks/:hook_id/pings
 *
 *   Dev Toolkit:
 *     GET /:owner/:repo/commits/style
 *     GET /:owner/:repo/pr-template
 *     GET /:owner/:repo/codeowners
 *     GET /:owner/:repo/codeowners/suggest
 *
 *   Actions:
 *     GET  /:owner/:repo/actions/workflows
 *     POST /:owner/:repo/actions/workflows/:id/dispatches
 *     GET  /:owner/:repo/actions/runs
 *     POST /:owner/:repo/actions/sync
 *     GET  /:owner/:repo/actions/stats
 *     GET  /:owner/:repo/workflows/:workflowId/stats
 *
 *   Community:
 *     GET /:owner/:repo/community-health
 *     POST /:owner/:repo/community-health/generate
 *     POST /:owner/:repo/community-health/commit-fix
 *     POST /:owner/:repo/agent-rules/generate
 *     POST /:owner/:repo/agent-rules/commit
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../../db.js';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { actionsService } from '../../actions-service.js';
import { communityHealthService } from '../../community-health-service.js';
import { safeJsonParse } from '../../lib/utils.js';
import {
    webhookCreateSchema,
    webhookUpdateSchema,
    workflowDispatchSchema,
    communityHealthGenerateSchema,
    communityHealthCommitFixSchema,
    agentRulesGenerateSchema,
    agentRulesCommitSchema,
    emptyBodySchema,
} from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { requireScope } from '../../middleware/api-key-auth.js';
import { auditLog } from '../../lib/audit.js';
import { FILE_GENERATORS, commitOrOpenPR } from '../../lib/ai-features/community-health-fix.js';
import {
    detectRepoSignals,
    generateAgentRules,
    buildDeterministicAgentRules,
    buildClaudeImportContent,
} from '../../lib/ai-features/agent-rules.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { mapAIErrorToResponse } from '../../middleware/ai-error-mapper.js';
import { checkUsageLimit, incrementUsage, checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { checkAISpendCap, recordAISpend } from '../../lib/ai-spend-cap.js';
import { applyOwnerRepoParamValidators } from './_shared.js';

const router = express.Router();
applyOwnerRepoParamValidators(router);

// hook_id is interpolated into GitHub API URLs — keep it strictly numeric so
// a crafted value cannot rewrite the path/querystring on its way to GitHub.
router.param('hook_id', (req, res, next, val) => {
    if (!/^\d{1,15}$/.test(val)) {
        return errorResponse(res, 400, 'Invalid hook_id', 'INVALID_PARAM');
    }
    next();
});

// ------------------------------------------------------------------
// Webhooks Management
// ------------------------------------------------------------------

// List webhooks
router.get('/:owner/:repo/hooks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'List webhooks failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Create webhook
router.post('/:owner/:repo/hooks', requireAuth, validateBody(webhookCreateSchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { config, events, active = true } = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ name: 'web', config, events, active })
        });
        res.json({ success: true, hook: data });
    } catch (error) {
        req.log.error({ err: error }, 'Create webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update webhook
router.patch('/:owner/:repo/hooks/:hook_id', requireAuth, validateBody(webhookUpdateSchema), async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        const { config, events, active, add_events, remove_events } = req.validatedBody;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ config, events, active, add_events, remove_events })
        });
        res.json(data);
    } catch (error) {
        req.log.error({ err: error }, 'Update webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Delete webhook
router.delete('/:owner/:repo/hooks/:hook_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Webhook deleted' });
    } catch (error) {
        req.log.error({ err: error }, 'Delete webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Ping webhook (test) — no body; reject stray fields.
router.post('/:owner/:repo/hooks/:hook_id/pings', requireAuth, validateBody(emptyBodySchema), async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}/pings`, req.session.accessToken, {
            method: 'POST'
        });
        res.json({ success: true, message: 'Ping sent' });
    } catch (error) {
        req.log.error({ err: error }, 'Ping webhook failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// ------------------------------------------------------------------
// Dev Toolkit Endpoints
// ------------------------------------------------------------------

// Detect commit message style (heuristic, no AI)
router.get('/:owner/:repo/commits/style', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/commits?per_page=20`,
            req.session.accessToken
        );
        const messages = data.map(c => c.commit?.message).filter(Boolean);

        const { detectCommitStyle } = await import('../../lib/commit-style-detector.js');
        const result = detectCommitStyle(messages);
        res.json(result);
    } catch (error) {
        req.log.error({ err: error }, 'Detect commit style failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Fetch PR template
router.get('/:owner/:repo/pr-template', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/contents/.github/PULL_REQUEST_TEMPLATE.md`,
            req.session.accessToken
        );
        const template = Buffer.from(data.content, 'base64').toString('utf-8');
        res.json({ found: true, template, path: data.path });
    } catch (error) {
        if (error.status === 404) {
            return res.json({ found: false, template: null, path: null });
        }
        req.log.error({ err: error }, 'Fetch PR template failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Parse CODEOWNERS
router.get('/:owner/:repo/codeowners', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        let data;
        try {
            ({ data } = await githubApi(
                `/repos/${owner}/${repo}/contents/.github/CODEOWNERS`,
                req.session.accessToken
            ));
        } catch (err) {
            if (err.status === 404) {
                ({ data } = await githubApi(
                    `/repos/${owner}/${repo}/contents/CODEOWNERS`,
                    req.session.accessToken
                ));
            } else {
                throw err;
            }
        }
        const raw = Buffer.from(data.content, 'base64').toString('utf-8');
        const rules = raw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
                const parts = line.split(/\s+/);
                return { pattern: parts[0], owners: parts.slice(1) };
            });
        res.json({ found: true, rules });
    } catch (error) {
        if (error.status === 404) {
            return res.json({ found: false, rules: [] });
        }
        req.log.error({ err: error }, 'Parse CODEOWNERS failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Parse CODEOWNERS failed') });
    }
});

// ------------------------------------------------------------------
// Suggest CODEOWNERS rules (read-only generator)
// ------------------------------------------------------------------
// Walks the N most recent commits and groups their authors by the top-level
// path they touched. Produces a `rules` array suggesting 1–3 owners per
// directory plus a generated preview body the caller can diff against an
// existing CODEOWNERS file. Strictly advisory — we never write anything to
// the repo from this endpoint.

router.get('/:owner/:repo/codeowners/suggest', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const commitLimit = Math.min(
            200,
            Math.max(20, Number.parseInt(req.query.commits, 10) || 100),
        );
        const minTouchesPerOwner = Math.max(
            1,
            Number.parseInt(req.query.minTouches, 10) || 2,
        );
        const maxOwnersPerPath = Math.min(
            5,
            Math.max(1, Number.parseInt(req.query.maxOwners, 10) || 3),
        );

        // 1. Fetch recent commits — we only need sha + author login.
        const { data: commits } = await githubApi(
            `/repos/${owner}/${repo}/commits?per_page=${commitLimit}`,
            req.session.accessToken,
        );
        if (!Array.isArray(commits) || commits.length === 0) {
            return res.json({
                found: false,
                rules: [],
                preview: '',
                analyzedCommits: 0,
                note: 'Repository has no accessible commits — nothing to suggest.',
            });
        }

        // 2. For each commit, grab its file list. Use allSettled + a tight
        //    concurrency cap so one bad commit doesn't sink the whole batch.
        const BATCH = 5;
        const pathOwnerCounts = new Map(); // `topLevel` → Map<login, count>

        for (let i = 0; i < commits.length; i += BATCH) {
            const slice = commits.slice(i, i + BATCH);
            const results = await Promise.allSettled(
                slice.map((c) => githubApi(
                    `/repos/${owner}/${repo}/commits/${c.sha}`,
                    req.session.accessToken,
                )),
            );
            for (const r of results) {
                if (r.status !== 'fulfilled') continue;
                const detail = r.value.data;
                const login = detail?.author?.login || detail?.committer?.login;
                if (!login || login === 'web-flow') continue;
                for (const file of detail.files || []) {
                    if (!file.filename) continue;
                    // Use first path segment; fall back to root '/' for top-
                    // level files so they still get an owner suggestion.
                    const top = file.filename.includes('/')
                        ? file.filename.split('/')[0] + '/'
                        : '/';
                    if (!pathOwnerCounts.has(top)) pathOwnerCounts.set(top, new Map());
                    const bucket = pathOwnerCounts.get(top);
                    bucket.set(login, (bucket.get(login) || 0) + 1);
                }
            }
        }

        // 3. Rank owners per directory and emit a CODEOWNERS-style rule.
        const rules = [];
        for (const [pattern, bucket] of pathOwnerCounts) {
            const owners = [...bucket.entries()]
                .filter(([, count]) => count >= minTouchesPerOwner)
                .sort((a, b) => b[1] - a[1])
                .slice(0, maxOwnersPerPath)
                .map(([login]) => `@${login}`);
            if (owners.length === 0) continue;
            rules.push({ pattern, owners });
        }
        // Stable ordering: root last, alphabetical otherwise.
        rules.sort((a, b) => {
            if (a.pattern === '/' && b.pattern !== '/') return 1;
            if (b.pattern === '/' && a.pattern !== '/') return -1;
            return a.pattern.localeCompare(b.pattern);
        });

        const preview = [
            '# Auto-suggested CODEOWNERS rules',
            `# Derived from the last ${commits.length} commits on ${owner}/${repo}.`,
            '# Review each rule before committing — this is a starting point, not a final policy.',
            '',
            ...rules.map(r => `${r.pattern.padEnd(24)} ${r.owners.join(' ')}`),
            '',
        ].join('\n');

        auditLog(req, 'codeowners.suggest', 'repo', `${owner}/${repo}`, {
            commitsScanned: commits.length,
            rulesProduced: rules.length,
        });

        res.json({
            found: rules.length > 0,
            rules,
            preview,
            analyzedCommits: commits.length,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Suggest CODEOWNERS failed');
        res.status(error.status || 500).json({
            error: safeError(error, 'Failed to suggest CODEOWNERS'),
        });
    }
});

// ------------------------------------------------------------------
// GitHub Actions (per-repo)
// ------------------------------------------------------------------

// List Workflows
router.get('/:owner/:repo/actions/workflows', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/actions/workflows`, req.session.accessToken);
        res.json(result.data.workflows || []);
    } catch (error) {
        req.log.error({ err: error }, 'List workflows failed');
        res.status(500).json({ error: 'Failed to list workflows' });
    }
});

// Trigger Workflow Dispatch
router.post('/:owner/:repo/actions/workflows/:id/dispatches', requireAuth, validateBody(workflowDispatchSchema), async (req, res) => {
    try {
        const { owner, repo, id } = req.params;
        const { ref = 'main', inputs = {} } = req.validatedBody;

        await githubApi(`/repos/${owner}/${repo}/actions/workflows/${id}/dispatches`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref, inputs })
        });

        res.json({ message: 'Workflow triggered successfully' });
    } catch (error) {
        req.log.error({ err: error }, 'Trigger workflow failed');
        res.status(500).json({ error: 'Failed to trigger workflow' });
    }
});

// List Workflow Runs
router.get('/:owner/:repo/actions/runs', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/actions/runs?per_page=10`, req.session.accessToken);
        res.json(result.data.workflow_runs || []);
    } catch (error) {
        req.log.error({ err: error }, 'List workflow runs failed');
        res.status(500).json({ error: 'Failed to list workflow runs' });
    }
});

// Sync workflow runs for a repository — no body; reject stray fields.
router.post('/:owner/:repo/actions/sync', requireAuth, validateBody(emptyBodySchema), async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const repoFullName = `${owner}/${repo}`;

        const result = await actionsService.syncWorkflowRuns(repoFullName, req.session.accessToken, req.session.userId);

        if (result.success) {
            res.json({ success: true, message: `Synced ${result.synced} workflow runs` });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        req.log.error({ err: error }, 'Sync workflow runs failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// Get statistics for a repository
router.get('/:owner/:repo/actions/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { days = 30 } = req.query;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const stats = actionsService.getRepoStats(repoId, parseInt(days), req.session.userId);
        const trends = actionsService.getDailyTrends(repoId, parseInt(days), req.session.userId);

        res.json({ stats, trends, repo: `${owner}/${repo}` });
    } catch (error) {
        req.log.error({ err: error }, 'Get actions stats failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// Get workflow-specific statistics
router.get('/:owner/:repo/workflows/:workflowId/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo, workflowId } = req.params;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const stats = actionsService.getWorkflowStats(repoId, parseInt(workflowId), req.session.userId);

        res.json(stats);
    } catch (error) {
        req.log.error({ err: error }, 'Get workflow stats failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// ------------------------------------------------------------------
// Community Health (per-repo)
// ------------------------------------------------------------------

// Get community health analysis
router.get('/:owner/:repo/community-health', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { refresh = false } = req.query;

        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;

        const userId = req.session.userId;

        if (!refresh) {
            const cached = db.prepare('SELECT * FROM community_health_cache WHERE user_id = ? AND repo_id = ?').get(userId, repoId);
            if (cached) {
                return res.json({
                    score: cached.health_score,
                    metrics: safeJsonParse(cached.metrics, {}),
                    recommendations: safeJsonParse(cached.recommendations, []),
                    lastUpdated: cached.analyzed_at,
                    cached: true
                });
            }
        }

        const analysis = await communityHealthService.analyzeRepository(owner, repo, req.session.accessToken);
        communityHealthService.cacheResults(repoId, analysis.metrics, analysis.recommendations, userId);

        res.json({
            score: analysis.metrics.healthScore,
            metrics: analysis.metrics,
            recommendations: analysis.recommendations,
            lastUpdated: analysis.analyzedAt,
            cached: false
        });
    } catch (error) {
        req.log.error({ err: error }, 'Community health analysis failed');
        res.status(500).json({ error: safeError(error, 'Operation failed') });
    }
});

// ------------------------------------------------------------------
// Community Health AI Auto-Fix (per-repo)
//   POST /:owner/:repo/community-health/generate    — returns generated content (no commit)
//   POST /:owner/:repo/community-health/commit-fix  — commits user-confirmed content
// ------------------------------------------------------------------

router.post('/:owner/:repo/community-health/generate', requireAuth, validateBody(communityHealthGenerateSchema), async (req, res) => {
    const { owner, repo } = req.params;
    const { fileType, overrides = {} } = req.validatedBody;

    // Semantic check the schema can't express: is there a generator registered
    // for this fileType? The registry is the single source of truth and emits a
    // specific `invalid_file_type` code (distinct from `validation_failed`).
    const gen = FILE_GENERATORS[fileType];
    if (!gen) {
        return res.status(400).json({ error: `unknown fileType: ${fileType}`, code: 'invalid_file_type' });
    }

    try {
        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);

        // Deterministic branch — no AI provider needed.
        if (gen.deterministic) {
            const out = fileType === 'license'
                ? gen.generator({
                    licenseId: overrides.licenseId || 'MIT',
                    owner: repoData?.owner?.login || owner,
                    year: new Date().getFullYear(),
                })
                : gen.generator({
                    email: overrides.email || req.session.userEmail || 'admin@example.com',
                });
            return res.json(out);
        }

        // AI branch. Meter the AI query BEFORE resolving a provider — mirrors
        // ai/deep-review.js and ai/pr-chat.js's quota-check-first order. The
        // deterministic branch above never reaches here, so template-only
        // generations (license, gitignore) never consume the ai_queries quota.
        const userId = req.session.userId;
        const quota = checkUsageLimit(userId, 'ai_queries');
        if (!quota.allowed) {
            return res.status(429).json(quotaExceededResponse({ ...quota, metric: 'ai_queries' }));
        }

        // Monthly AI spend cap (OWASP LLM10) — additive to the ai_queries
        // quota above; mirrors the manual checkAISpendCap/recordAISpend pair
        // used across the AI surface wherever a route can't go through
        // guardedGenerate directly (see server/routes/ai/core.js's /ai/chat
        // for the canonical shape).
        const spend = checkAISpendCap(userId);
        if (!spend.allowed) {
            return res.status(429).json({
                code: 'AI_SPEND_CAP_REACHED',
                error: 'Monthly AI spend limit reached. Try again next month or raise the cap.',
                spent_cents: spend.spentCents,
                cap_cents: spend.capCents,
            });
        }

        const provider = await createProviderForUser(userId, 'completion', { featureKey: 'COMMUNITY_HEALTH_FIX' });
        if (!provider) {
            return res.status(403).json({ error: 'AI is not configured for this user', code: 'ai_not_configured' });
        }

        const { costUSD, ...out } = await gen.generator({
            repo: repoData,
            email: overrides.email || req.session.userEmail,
            provider,
        });
        incrementUsage(userId, 'ai_queries');
        recordAISpend(userId, costUSD);
        res.json(out);
    } catch (e) {
        const mapped = mapAIErrorToResponse(res, e);
        if (mapped) return mapped;
        errorResponse(res, 500, safeError(e, 'community health fix generation failed'));
    }
});

router.post('/:owner/:repo/community-health/commit-fix', requireAuth, validateBody(communityHealthCommitFixSchema), async (req, res) => {
    const { owner, repo } = req.params;
    const { fileType, content, commitMessage, mode = 'direct' } = req.validatedBody;

    // Presence check kept inline: it emits the domain-specific `invalid_body`
    // code the route contract established (the schema only bounds/strict-checks).
    if (!fileType || !content || !commitMessage) {
        return res.status(400).json({ error: 'missing required fields', code: 'invalid_body' });
    }

    // filePath is ALWAYS derived server-side from the fileType registry —
    // this used to accept req.body.filePath directly, letting a tampered
    // request pick an arbitrary destination inside the repo for the write
    // (2026-07-19 hardening, item A4). Same registry the /generate route
    // above already uses, so the two endpoints can never disagree on a
    // fileType's canonical path.
    const gen = FILE_GENERATORS[fileType];
    if (!gen) {
        return res.status(400).json({ error: `unknown fileType: ${fileType}`, code: 'invalid_file_type' });
    }
    const filePath = gen.path;

    try {
        const result = await commitOrOpenPR({
            owner, repo, token: req.session.accessToken,
            filePath, content, commitMessage, mode, githubApi,
        });

        // Invalidate the health cache so the next dashboard open re-fetches.
        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        if (repoData?.id) {
            db.prepare('DELETE FROM community_health_cache WHERE user_id = ? AND repo_id = ?')
                .run(req.session.userId, repoData.id);
        }

        res.json({ committed: true, ...result });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'community health fix commit failed'));
    }
});

// ------------------------------------------------------------------
// Agent Rules Generator (per-repo) — AGENTS.md / CLAUDE.md
//   POST /:owner/:repo/agent-rules/generate — returns generated content (no commit)
//   POST /:owner/:repo/agent-rules/commit   — commits user-confirmed content
//
// `generate` NEVER hard-fails when AI is unavailable: it resolves a provider
// the same way requireAI would but, on failure (not configured, spend cap
// reached, or a provider error even after guardedGenerate's built-in retry),
// falls back to a deterministic, zero-AI-cost template built directly from
// the detected repo signals (Addendum 6b.2, docs/specs/2026-07-18-
// community-wow-wave6.md). The response's `deterministic` flag tells the
// client which path was taken; `files` always contains a full preview for
// every requested target file — nothing is ever written without the
// separate, explicit `commit` call below.
// ------------------------------------------------------------------

function buildAgentRulesFiles(targetFiles, agentsMarkdown) {
    const files = { 'AGENTS.md': agentsMarkdown };
    if (targetFiles.includes('CLAUDE.md')) files['CLAUDE.md'] = buildClaudeImportContent();
    return files;
}

function summarizeAgentRulesSignals(signals) {
    return {
        isMonorepo: signals.isMonorepo,
        truncated: signals.truncated,
        stack: signals.stack,
        packageManager: signals.packageManager,
        testRunner: signals.testRunner,
        lintConfigured: (signals.lintConfigFiles || []).length > 0,
        license: signals.license?.matched ? signals.license.spdxId : null,
        workflowJobs: signals.workflowJobs,
        existingTargets: Object.keys(signals.existingFiles || {}),
    };
}

router.post('/:owner/:repo/agent-rules/generate', requireAuth, requireScope('ai'), validateBody(agentRulesGenerateSchema), async (req, res) => {
    const { owner, repo } = req.params;
    const { targetFiles, mode, sections, strictness } = req.validatedBody;
    const userId = req.session.userId;

    try {
        const signals = await detectRepoSignals({ owner, repo, token: req.session.accessToken, githubApi, log: req.log });

        const notes = [];
        if (signals.isMonorepo) notes.push('This looks like a monorepo — nested AGENTS.md not yet supported; only a root-level AGENTS.md was generated.');
        if (signals.truncated) notes.push('The file listing used for detection is truncated (large repo) — generated content is based on a partial signal set.');

        const existing = {};
        if (mode === 'refresh') {
            for (const f of targetFiles) existing[f] = signals.existingFiles?.[f] || null;
        }

        const deterministicResult = buildDeterministicAgentRules(signals, { sections });
        const deterministicFiles = buildAgentRulesFiles(targetFiles, deterministicResult.markdown);

        // Resolve a provider WITHOUT hard-failing (unlike requireAI) so an
        // unconfigured AI never blocks this feature — falls through to the
        // deterministic template instead.
        let provider = req.aiProvider;
        if (!provider && typeof req.getAIProvider === 'function') {
            provider = await req.getAIProvider('completion').catch(() => null);
        }

        if (!provider) {
            return res.json({
                deterministic: true, reason: 'ai_not_configured',
                files: deterministicFiles, existing, notes,
                signals: summarizeAgentRulesSignals(signals),
            });
        }
        req.aiProvider = provider;

        const quota = checkAIFeatureLimit(userId, 'ai_agent_rules');
        if (!quota.allowed) {
            // Quota-exceeded still ships the deterministic path (Addendum 6b.2)
            // so the user isn't fully blocked just because their AI quota ran out.
            return res.status(429).json({
                ...quotaExceededResponse(quota),
                deterministic: true, files: deterministicFiles, existing, notes,
            });
        }

        try {
            const { text, sections: usedSections } = await generateAgentRules(req, signals, { targetFiles, mode, sections, strictness });
            incrementAIUsage(userId, 'ai_agent_rules');
            auditLog(req, 'ai.generate_agent_rules', 'ai', null, { repo: `${owner}/${repo}`, targetFiles, mode });
            res.json({
                deterministic: false,
                files: buildAgentRulesFiles(targetFiles, text),
                sections: usedSections,
                existing, notes,
                signals: summarizeAgentRulesSignals(signals),
            });
        } catch (aiErr) {
            // Provider error even after guardedGenerate's built-in retry (or
            // the spend cap was hit) — degrade to the deterministic template
            // rather than surfacing a hard error (Addendum 6b.2).
            req.log.warn({ err: aiErr }, 'agent rules AI generation failed — falling back to deterministic template');
            res.json({
                deterministic: true,
                reason: aiErr?.code === 'AI_SPEND_CAP_REACHED' ? 'spend_cap_reached' : 'ai_error',
                files: deterministicFiles, existing, notes,
                signals: summarizeAgentRulesSignals(signals),
            });
        }
    } catch (e) {
        req.log.error({ err: e }, 'Agent rules generation failed');
        errorResponse(res, 500, safeError(e, 'agent rules generation failed'));
    }
});

router.post('/:owner/:repo/agent-rules/commit', requireAuth, validateBody(agentRulesCommitSchema), async (req, res) => {
    const { owner, repo } = req.params;
    const { files, mode } = req.validatedBody;

    try {
        const results = [];
        for (const f of files) {
            const result = await commitOrOpenPR({
                owner, repo, token: req.session.accessToken,
                filePath: f.filePath, content: f.content, commitMessage: f.commitMessage, mode, githubApi,
            });
            results.push({ filePath: f.filePath, ...result });
        }
        auditLog(req, 'ai.commit_agent_rules', 'repo', `${owner}/${repo}`, { files: files.map((f) => f.filePath), mode });
        res.json({ committed: true, results });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'agent rules commit failed'));
    }
});

export default router;
