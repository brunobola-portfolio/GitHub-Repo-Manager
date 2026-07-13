/*
 * GitHub Repo Manager - AI Migration Routes
 *
 * Endpoints:
 *   POST /ai/issue-to-plan
 *   POST /ai/migration-risk
 *   POST /ai/migration-size-strategy
 *   POST /ai/migration-description
 */

import express from 'express';
import { githubApi } from '../../lib/github-api.js';
import { requireAuth, isValidGitHubFullName } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/api-key-auth.js';
import { aiIssueToPlanSchema, migrationSizeStrategySchema, migrationDescriptionSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { REPO_DESCRIPTION_MAX } from '../../lib/repo-description.js';
import { sanitizeForPrompt } from '../../ai-service.js';
import { safeJsonParse } from '../../lib/utils.js';
import { parseSizeStrategyResponse, parseDescriptionResponse } from '../../lib/migration-ai-parsers.js';
import { checkUsageLimit, incrementUsage, checkAIFeatureLimit, incrementAIUsage, quotaExceededResponse } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { requireAI, handleAIError, guardedGenerate } from './shared.js';

const router = express.Router();

// ------------------------------------------------------------------
// AI Issue-to-PR Planner (plan-only)
// ------------------------------------------------------------------
// Takes a GitHub issue and produces a structured implementation plan:
// approach, files to touch, suggested tests, estimated effort. It does
// NOT create a branch or PR — that's a future phase. This is opt-in per
// request and counts against the `ai_queries` quota.

const ISSUE_PLAN_MAX_BODY_CHARS = 4000;
const ISSUE_PLAN_MAX_COMMENTS = 6;
const ISSUE_PLAN_MAX_STRUCTURE_ENTRIES = 40;

function normaliseIssuePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const norm = {
        title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : null,
        approach: typeof raw.approach === 'string' ? raw.approach.slice(0, 4000) : null,
        files: [],
        tests: typeof raw.tests === 'string' ? raw.tests.slice(0, 2000) : null,
        risks: typeof raw.risks === 'string' ? raw.risks.slice(0, 1500) : null,
        estimatedHours: Number.isFinite(raw.estimatedHours)
            ? Math.max(0, Math.min(200, Number(raw.estimatedHours)))
            : null,
    };
    if (Array.isArray(raw.files)) {
        norm.files = raw.files.slice(0, 25).map(f => ({
            path: typeof f?.path === 'string' ? f.path.slice(0, 200) : '',
            action: ['create', 'modify', 'delete', 'rename'].includes(f?.action) ? f.action : 'modify',
            notes: typeof f?.notes === 'string' ? f.notes.slice(0, 500) : '',
        })).filter(f => f.path);
    }
    if (!norm.title && !norm.approach && norm.files.length === 0) return null;
    return norm;
}

router.post(
    '/ai/issue-to-plan',
    requireAuth,
    requireScope('ai'),
    validateBody(aiIssueToPlanSchema),
    requireAI,
    async (req, res) => {
        const userId = req.session.userId;
        const usage = checkUsageLimit(userId, 'ai_queries');
        if (!usage.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `You've used ${usage.current}/${usage.limit} AI queries this month`,
                upgradeUrl: '/pricing',
            });
        }

        const { repoFullName, issueNumber, extraContext } = req.validatedBody;
        if (!isValidGitHubFullName(repoFullName)) {
            return res.status(400).json({
                error: 'Invalid repoFullName',
                code: 'VALIDATION_ERROR',
            });
        }

        try {
            // 1. Fetch issue + up to N recent comments + repo structure
            const [issueRes, commentsRes, contentsRes] = await Promise.all([
                githubApi(`/repos/${repoFullName}/issues/${issueNumber}`, req.session.accessToken),
                githubApi(
                    `/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=${ISSUE_PLAN_MAX_COMMENTS}`,
                    req.session.accessToken,
                ).catch(() => ({ data: [] })),
                githubApi(`/repos/${repoFullName}/contents`, req.session.accessToken)
                    .catch(() => ({ data: [] })),
            ]);

            const issue = issueRes.data;
            if (!issue || issue.pull_request) {
                return res.status(404).json({
                    error: 'Issue not found or is a pull request',
                    code: 'ISSUE_NOT_FOUND',
                });
            }

            const labels = (issue.labels || [])
                .map(l => (typeof l === 'string' ? l : l?.name))
                .filter(Boolean)
                .slice(0, 15);

            const comments = (commentsRes.data || [])
                .slice(0, ISSUE_PLAN_MAX_COMMENTS)
                .map(c => ({
                    author: c.user?.login || 'unknown',
                    body: (c.body || '').slice(0, 1000),
                }));

            const structure = (contentsRes.data || [])
                .slice(0, ISSUE_PLAN_MAX_STRUCTURE_ENTRIES)
                .map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`)
                .join('\n');

            // 2. Build prompt — strictly JSON-out, defensive on length
            const issueTitle = sanitizeForPrompt(issue.title || '', 300);
            const issueBody = sanitizeForPrompt(
                issue.body || '',
                ISSUE_PLAN_MAX_BODY_CHARS,
            );
            const extra = sanitizeForPrompt(extraContext || '', 2000);
            const commentsBlock = comments.length === 0
                ? '(no comments)'
                : comments.map((c, i) => `Comment ${i + 1} by @${c.author}:\n${sanitizeForPrompt(c.body, 1000)}`).join('\n\n');

            const prompt = `You are a senior engineer triaging a GitHub issue. Produce a concise, actionable **plan only** — do not generate code.

Repository: ${repoFullName}
Top-level layout:
${structure || '(empty or inaccessible)'}

Issue #${issueNumber}: ${issueTitle}
Labels: ${labels.join(', ') || 'none'}

Issue body:
${issueBody || '(no body)'}

Recent discussion:
${commentsBlock}

${extra ? `Extra context from requester:\n${extra}\n` : ''}
Respond with **only** valid JSON (no prose, no markdown fences) matching this shape:
{
  "title": "short imperative title for the plan",
  "approach": "2-5 sentence high-level approach",
  "files": [
    { "path": "src/...", "action": "create" | "modify" | "delete" | "rename", "notes": "why/what to change" }
  ],
  "tests": "what new tests or assertions should validate this",
  "risks": "biggest risks / migration concerns / follow-ups",
  "estimatedHours": <integer 1..40>
}
Keep "files" to at most 12 entries. If the issue is too vague to plan, return:
{ "title": "Needs clarification", "approach": "<what's missing>", "files": [], "tests": "", "risks": "", "estimatedHours": 0 }`;

            const { text } = await guardedGenerate(req, { prompt }, { feature: 'issue_to_plan' });
            const parsed = safeJsonParse(text);
            const plan = normaliseIssuePlan(parsed);

            if (!plan) {
                return res.status(502).json({
                    error: 'AI returned an invalid plan. Please retry.',
                    code: 'AI_PARSE_ERROR',
                });
            }

            incrementUsage(userId, 'ai_queries');
            auditLog(req, 'ai.issue_to_plan', 'ai', null, {
                repoFullName,
                issueNumber,
                fileCount: plan.files.length,
            });

            res.json({
                plan,
                issue: {
                    number: issue.number,
                    title: issue.title,
                    url: issue.html_url,
                    state: issue.state,
                    labels,
                },
            });
        } catch (error) {
            if (error.status === 404) {
                return res.status(404).json({
                    error: 'Issue or repository not found',
                    code: 'ISSUE_NOT_FOUND',
                });
            }
            req.log.error({ err: error, repoFullName, issueNumber }, 'AI issue-to-plan failed');
            handleAIError(res, error, 'Failed to generate issue plan. Please try again later.');
        }
    },
);

// ------------------------------------------------------------------
// Migration Risk Analysis (AI)
// ------------------------------------------------------------------
// Analyzes a source repo's migration risk to a target platform (GitHub, Azure DevOps,
// or another org) before the actual migration runs. Returns a structured risk report
// so users can triage blockers before spending time on a migration plan.
//
// Available to Free tier (capped at migrationRiskPerMonth, default 5/month).

router.post('/ai/migration-risk', requireAuth, requireScope('ai'), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'ai_migration_risk');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    try {
        const { repo, source = 'github', target = 'github' } = req.body;
        if (!repo || !repo.full_name) {
            return res.status(400).json({ error: 'repo.full_name is required', code: 'VALIDATION_ERROR' });
        }
        // Full-name is spliced into GitHub API URLs below — reject anything that
        // would let a caller escape the intended repo scope.
        if (!isValidGitHubFullName(repo.full_name)) {
            return res.status(400).json({ error: 'Invalid repo.full_name format', code: 'VALIDATION_ERROR' });
        }
        const allowedPlatforms = new Set(['github', 'azure-devops', 'gitlab', 'bitbucket', 'other']);
        const safeSource = allowedPlatforms.has(source) ? source : 'other';
        const safeTarget = allowedPlatforms.has(target) ? target : 'other';

        // Pull a handful of signals that strongly predict migration pain.
        // Each call is soft-failing — missing data just weakens the analysis,
        // it doesn't block the whole report.
        const [branchesResult, lfsResult, workflowsResult, languagesResult] = await Promise.allSettled([
            githubApi(`/repos/${repo.full_name}/branches?per_page=100`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/contents/.gitattributes`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/actions/workflows`, req.session.accessToken),
            githubApi(`/repos/${repo.full_name}/languages`, req.session.accessToken),
        ]);

        const branches = branchesResult.status === 'fulfilled' ? (branchesResult.value.data || []) : [];
        const workflowCount = workflowsResult.status === 'fulfilled' ? (workflowsResult.value.data?.total_count ?? 0) : 0;
        const languages = languagesResult.status === 'fulfilled' ? (languagesResult.value.data || {}) : {};

        let hasLFS = false;
        if (lfsResult.status === 'fulfilled') {
            try {
                const gitattrs = Buffer.from(lfsResult.value.data.content, 'base64').toString('utf-8');
                hasLFS = /filter=lfs/i.test(gitattrs);
            } catch { /* ignore */ }
        }

        const sizeMB = Math.round((repo.size || 0) / 1024);
        const signals = {
            sizeMB,
            branches: branches.length,
            openIssues: repo.open_issues_count ?? 0,
            hasLFS,
            workflowCount,
            languages: Object.keys(languages),
            private: !!repo.private,
            archived: !!repo.archived,
            hasWiki: !!repo.has_wiki,
            hasPages: !!repo.has_pages,
        };

        // Ask the AI for a structured risk report.
        const systemPrompt = `You are a repository migration expert. Given the repository signals below, produce a structured migration risk analysis.

Repository: ${sanitizeForPrompt(repo.full_name, 200)}
Source platform: ${sanitizeForPrompt(safeSource, 40)}
Target platform: ${sanitizeForPrompt(safeTarget, 40)}
Signals: ${JSON.stringify(signals)}

Respond with ONLY valid JSON matching this schema — no code fences, no prose:
{
  "overallRisk": "low | medium | high | critical",
  "score": 0,
  "summary": "one-sentence executive summary",
  "blockers": ["specific blockers that must be resolved first"],
  "warnings": ["things that will slow the migration or need manual intervention"],
  "recommendations": ["concrete next steps, ordered by priority"],
  "estimatedDurationMinutes": 0
}

Rules:
- score is 0 (no risk) to 100 (critical, do not migrate).
- Flag LFS, >1GB size, >50 branches, active CI/CD, GitHub Pages, and wikis as warnings or blockers as appropriate.
- Be specific, not generic. Reference the actual signals.`;

        const { text: raw } = await guardedGenerate(req, { prompt: systemPrompt }, { feature: 'migration_risk' });

        let parsed = null;
        let parseError = false;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parseError = true;
            parsed = {};
        }

        // Explicitly coerce each field to its expected type — spread of raw AI
        // output would let Gemini hiccups leak null/string-where-array through
        // to the UI and crash `.map()` calls on the client.
        const ALLOWED_RISK = new Set(['low', 'medium', 'high', 'critical', 'unknown']);
        const asStringArray = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.slice(0, 400)) : [];
        const clampedScore = typeof parsed.score === 'number' && Number.isFinite(parsed.score)
            ? Math.max(0, Math.min(100, Math.round(parsed.score)))
            : 0;
        const normalizedRisk = ALLOWED_RISK.has(parsed.overallRisk) ? parsed.overallRisk : 'unknown';

        const report = {
            repo: repo.full_name,
            source: safeSource,
            target: safeTarget,
            signals,
            overallRisk: parseError ? 'unknown' : normalizedRisk,
            score: parseError ? 0 : clampedScore,
            summary: typeof parsed.summary === 'string'
                ? parsed.summary.slice(0, 500)
                : (parseError
                    ? 'AI returned an unparseable response. Review signals manually or retry.'
                    : ''),
            blockers: asStringArray(parsed.blockers),
            warnings: parseError
                ? [`AI parse error. Raw preview: ${raw.slice(0, 300)}`]
                : asStringArray(parsed.warnings),
            recommendations: parseError
                ? ['Retry the analysis', 'Or review the signals manually']
                : asStringArray(parsed.recommendations),
            estimatedDurationMinutes: typeof parsed.estimatedDurationMinutes === 'number' && Number.isFinite(parsed.estimatedDurationMinutes)
                ? Math.max(0, Math.round(parsed.estimatedDurationMinutes))
                : 0,
            parseError,
        };

        incrementAIUsage(userId, 'ai_migration_risk');
        auditLog(req, 'ai.migration_risk', 'ai', repo.full_name, {
            source: safeSource,
            target: safeTarget,
            overallRisk: report.overallRisk,
            parseError,
        });
        res.json({ success: true, report });
    } catch (error) {
        req.log.error({ err: error }, 'Migration risk analysis failed');
        handleAIError(res, error, 'Failed to analyze migration risk.');
    }
});

// ------------------------------------------------------------------
// AI Migration Size Strategy
// ------------------------------------------------------------------

router.post('/ai/migration-size-strategy', requireAuth, requireScope('ai'), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'migration_assist');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    const parsed = migrationSizeStrategySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { repoId, size, hasLfsMarker, branches, lastCommitDate } = parsed.data;

    const sizeGb = (size / (1024 * 1024)).toFixed(1);
    const prompt = `You are a migration assistant helping decide the best strategy for a repository that exceeds GitHub's 10 GB push limit.

Repository facts (no names or business context provided):
- Size: ${sizeGb} GB
- Has LFS markers in .gitattributes: ${hasLfsMarker ? 'yes' : 'no'}
- Branch count: ${branches}
- Last commit date: ${sanitizeForPrompt(lastCommitDate || 'unknown', 50)}

Choose exactly one strategy from: "exclude" or "lfs-migrate".
- "exclude": the repository is stale, archival, or too unwieldy; skip it.
- "lfs-migrate": run git-lfs migrate import --above=100MiB before pushing; appropriate when the size is caused by large binary assets.

Respond with strict JSON only, no prose outside the JSON:
{"strategy": "exclude" | "lfs-migrate", "rationale": "one short sentence", "confidence": 0.0-1.0}`;

    try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        // Provider strips markdown fences centrally — no manual replace needed.
        const { text } = await guardedGenerate(req, { prompt }, { feature: 'migration_size' });

        const sizeStrategyResult = parseSizeStrategyResponse(text);
        if (!sizeStrategyResult) {
            return res.status(502).json({ error: 'Unexpected AI response shape' });
        }

        incrementAIUsage(userId, 'migration_assist');
        auditLog(req, 'ai.migration-size-strategy', 'ai', null, { repoId, size, model: modelName });
        res.json(sizeStrategyResult);
    } catch (err) {
        req.log?.error({ err }, 'migration-size-strategy failed');
        handleAIError(res, err, 'Failed to generate size strategy. Please try again later.');
    }
});

// ------------------------------------------------------------------
// AI Migration Description
// ------------------------------------------------------------------

router.post('/ai/migration-description', requireAuth, requireScope('ai'), requireAI, async (req, res) => {
    const userId = req.session.userId;
    const check = checkAIFeatureLimit(userId, 'migration_assist');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));

    const parsed = migrationDescriptionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { repoId, repoName, language, size, branches, hasLfsMarker, lastCommitDate, source } = parsed.data;

    const facts = [
        `Repo name: ${sanitizeForPrompt(repoName, 100)}`,
        language ? `Primary language: ${sanitizeForPrompt(language, 50)}` : null,
        `Size: ${size} KB`,
        `Branch count: ${branches}`,
        `LFS markers present: ${hasLfsMarker ? 'yes' : 'no'}`,
        lastCommitDate ? `Last commit: ${sanitizeForPrompt(lastCommitDate, 50)}` : null,
        source.isTfvc
            ? `Source: Azure DevOps TFVC folder "${sanitizeForPrompt(source.tfvcPath || '', 200)}" in project "${sanitizeForPrompt(source.project, 100)}"`
            : `Source: Azure DevOps Git repo in ${sanitizeForPrompt(source.org, 100)}/${sanitizeForPrompt(source.project, 100)}`,
    ].filter(Boolean).join('\n- ');

    const prompt = `You write short, professional GitHub repository descriptions.

Context about the repository being migrated:
- ${facts}

Rules:
- Single line, max ${REPO_DESCRIPTION_MAX} characters.
- No markdown, no code blocks, no line breaks, no emoji.
- English only.
- Ground the description in the facts above. Do not invent features or stack details not listed.
- If the source is Azure DevOps TFVC, mention it came from TFVC so readers understand the history.

Respond with strict JSON only, no prose outside the JSON:
{"description": "..."}`;

    try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        // Provider strips markdown fences centrally — text is clean.
        const { text } = await guardedGenerate(req, { prompt }, { feature: 'migration_description' });

        // Fall through to deterministic template on any unexpected shape — keep the
        // endpoint's contract simple: always return a usable { description }.
        const descriptionResult = parseDescriptionResponse(text, { repoName, source });

        incrementAIUsage(userId, 'migration_assist');
        auditLog(req, 'ai.migration-description', 'ai', null, { repoId, model: modelName });
        res.json(descriptionResult);
    } catch (err) {
        req.log?.error({ err }, 'migration-description failed');
        handleAIError(res, err, 'Failed to generate description. Please try again later.');
    }
});

export default router;
