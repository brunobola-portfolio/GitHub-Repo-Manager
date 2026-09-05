import express from 'express';
import { reserveAIQuota } from './ai-quota.js';
import logger from '../lib/logger.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { requireScope } from '../middleware/api-key-auth.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getTierOrder, getFeatures } from '../lib/feature-flags.js';
import { getCurrentUsage, incrementUsage, releaseGuardedAIUsage, quotaExceededResponse } from '../lib/usage-meter.js';
import { migrationQuotaDecision } from '../lib/migration-quota.js';
import { handlePlanComplete } from '../lib/migration-plan-complete.js';
import { MigrationEngine } from '../migration-engine.js';
import { createPlanSchema, updatePlanSchema } from '../lib/validators.js';
import { analyzeMigration } from '../migration-planner.js';
import { guardedGenerate, handleAIError } from './ai/shared.js';
import { validateAzureHost } from '../lib/azure-host-validator.js';
import { auditLog } from '../lib/audit.js';
import { withReplaceOnConflict, withLfsMigrate } from '../lib/migration-task-config.js';
import { resolveAzurePat } from '../lib/pat-resolver.js';
import db from '../db.js';
import { createMigrationTaggingService } from '../migration-tagging-service.js';
import { createGithubWriter } from '../lib/tagging/github-writer.js';
import { createAzureWriter } from '../lib/tagging/azure-writer.js';
import { createGitTagWriter } from '../lib/tagging/git-tag-writer.js';
import { createHttpShim } from '../lib/tagging/http-shim.js';
import { createTaggingWorkdirResolver } from '../lib/tagging/tagging-workdir-resolver.js';
import { assertReady } from '../lib/env/readiness.js';

/**
 * Map a migration job descriptor to the tool capabilities it requires and
 * assert those tools are present. Throws EnvironmentError (code: 'ENV_TOOL_MISSING')
 * on the first missing tool so callers can surface a clear, actionable message.
 *
 * @param {{ sourceType?: string, hasLFS?: boolean, sizeStrategy?: string }} job
 * @param {object} [opts]  Passed through to assertReady (supports { runner, platform, force })
 */
export async function preflightTooling(job, opts = {}) {
  const caps = ['git-import'];
  if (job.sourceType === 'azure-tfvc') caps.push('tfvc', 'tfvc-clone');
  if (job.hasLFS || job.sizeStrategy === 'lfs-migrate') caps.push('lfs', 'lfs-migrate');
  await assertReady(caps, opts);
}

/**
 * Aggregate the migration tooling a plan needs from its tasks.
 * TFVC is per-task (type 'repo-tfvc'); lfs-migrate lives in each task's
 * config JSON. `hasLFS` (source already uses LFS) is only knowable at
 * clone time — the lazy ensureGitLfs check still guards that path — so the
 * pre-clone signal we can assert here is the chosen lfs-migrate strategy.
 * @param {object} plan - migration_plans row (has source_type)
 * @param {Array<{type:string, config:string}>} tasks - migration_tasks rows
 * @returns {{ sourceType: string, hasLFS: boolean, sizeStrategy: string|null }}
 */
export function migrationJobFromPlan(plan, tasks = []) {
  const anyTfvc = plan.source_type === 'azure-tfvc' || tasks.some((t) => t.type === 'repo-tfvc');
  const anyLfsMigrate = tasks.some((t) => {
    try { return JSON.parse(t.config || '{}')?.sizeStrategy === 'lfs-migrate'; }
    catch { return false; }
  });
  return {
    sourceType: anyTfvc ? 'azure-tfvc' : plan.source_type,
    hasLFS: false,
    sizeStrategy: anyLfsMigrate ? 'lfs-migrate' : null,
  };
}

/**
 * Resolve the Azure PAT for a plan execute/resume/retry request via the
 * shared resolver (vault > pasted > session > env — same order as the
 * Azure API routes).
 *
 * A `null` PAT is still a valid outcome (git-only plans never need one;
 * the engine surfaces a clear "PAT missing" error if a TFVC task can't
 * authenticate). The one case that MUST fail loudly is an explicit
 * `savedCredentialId` that can't be resolved — silently substituting the
 * env cloud PAT produces a confusing 401 against the on-prem host the
 * saved credential targeted. Returns `{ pat }` or `{ abort: true }` after
 * writing the HTTP error.
 */
function resolvePlanExecutionPat(req, res) {
  const result = resolveAzurePat(req, { patField: 'azurePat' });
  if (req.body?.savedCredentialId && !result.pat) {
    res.status(401).json({ error: result.error });
    return { abort: true, pat: null };
  }
  return { abort: false, pat: result.pat };
}

const router = express.Router();
const engine = new MigrationEngine(db);

// Wire preflight into the engine so every executePlan call (execute, resume,
// retry, scheduled) checks required tooling before the plan transitions to
// 'running'. The engine._preflight seam is null by default so engine unit
// tests are unaffected; only the live route process sees real tool detection.
engine._preflight = (plan) => {
  const tasks = db.prepare('SELECT type, config FROM migration_tasks WHERE plan_id = ?').all(plan.id);
  return preflightTooling(migrationJobFromPlan(plan, tasks));
};

// Tagging service: wired post-execution so the engine stays focused on
// plan/task orchestration. Failure of marks NEVER aborts the migration —
// the engine has already committed the plan as completed by the time we run.
const githubApi = createHttpShim({ baseURL: 'https://api.github.com' });
const rawHttp = createHttpShim();
const taggingService = createMigrationTaggingService({
  db,
  credentialsResolver: async (plan) => {
    const stored = engine.credentials.retrieve(plan.id);
    if (!stored) return {};
    return {
      github: stored.githubToken || null,
      azure: stored.azurePat ? { pat: stored.azurePat } : null
    };
  },
  writersFactory: ({ plan, credentials }) => ({
    github: credentials.github ? createGithubWriter({ api: githubApi, token: credentials.github }) : null,
    azure: credentials.azure?.pat
      ? createAzureWriter({ api: rawHttp, host: plan.azure_host || 'dev.azure.com', org: plan.source_org, pat: credentials.azure.pat })
      : null,
    gitTag: createGitTagWriter()
  }),
  // Resolver builds a transient shallow clone of the destination repo so the
  // git-tag writer can attach + push an annotated tag. The import-service
  // tears down its own workdir in `finally` before plan-complete fires, so
  // we re-acquire one on demand here. Resolver returns null when no GitHub
  // token is available, gracefully degrading to "no git-tag mark".
  repoDirResolver: async ({ plan, task, meta }) => {
    const stored = engine.credentials.retrieve(plan.id);
    if (!stored?.githubToken) return null;
    const resolve = createTaggingWorkdirResolver({
      credentials: { github: stored.githubToken },
      logger
    });
    return resolve({ plan, task, meta });
  },
  logger
});

// Post-completion side effects (tagging marks + credential forget) live in a
// pure, db-free module so they can be unit-tested in isolation.
engine.on('plan-complete', (event) =>
  handlePlanComplete(event, { taggingService, credentials: engine.credentials, logger })
);

function parseJsonField(value) {
  if (value == null || typeof value === 'object') return value ?? null;
  try { return JSON.parse(value); } catch { return value; }
}

// Maps a `migration_plans` row (snake_case) to the API/UI shape (camelCase,
// nested `source` object). Keep the engine's `getPlanStatus` shape unchanged —
// SSE consumers and engine tests rely on the raw row shape.
function formatPlanForApi(row, { taskCount, tasks } = {}) {
  if (!row) return null;
  const formatted = {
    id: row.id,
    status: row.status,
    source: {
      type: row.source_type || 'azure',
      host: row.azure_host || 'dev.azure.com',
      org: row.source_org || null,
      project: row.source_project || null,
    },
    targetOrg: row.target_org || null,
    isDryRun: !!row.is_dry_run,
    scheduledAt: row.scheduled_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    aiAnalysis: parseJsonField(row.ai_analysis),
    summary: parseJsonField(row.summary),
  };
  if (typeof taskCount === 'number') formatted.taskCount = taskCount;
  if (Array.isArray(tasks)) {
    formatted.tasks = tasks.map(formatTaskForApi);
    formatted.taskCount = tasks.length;
  }
  return formatted;
}

function formatTaskForApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    executionOrder: row.execution_order,
    sourceRef: row.source_ref,
    targetRef: row.target_ref || null,
    repoName: row.source_ref,
    config: parseJsonField(row.config),
    status: row.status,
    progressPct: row.progress_pct ?? 0,
    progressMessage: row.progress_message || null,
    errorMessage: row.error_message || null,
    retries: row.retries ?? 0,
    maxRetries: row.max_retries ?? 0,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    metadata: parseJsonField(row.metadata),
    createdAt: row.created_at || null,
  };
}

export { formatPlanForApi, formatTaskForApi };

// Free-tier migration meter: dry-run plans are always free + unmetered; full
// (non-dry-run) plans are free up to migrationFullPerMonth per calendar month,
// then Pro. The monthly unit is charged ONCE per plan (quota_charged) at
// execute time, so resume/retry of the SAME plan never re-charge. The decision
// is the pure migrationQuotaDecision(); this middleware only feeds it the live
// db/tier state and defers a 'charge' to the execute handler.
function requireMigrationQuota(req, res, next) {
  const id = parseInt(req.params.id);
  const plan = db.prepare('SELECT is_dry_run, quota_charged FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const tier = getUserTier(req.session.userId);
  const isPro = getTierOrder(tier) >= getTierOrder('pro');
  const cap = getFeatures(tier).migrationFullPerMonth ?? Infinity;
  const currentCount = isPro ? 0 : getCurrentUsage(req.session.userId, 'migration_full_executions');
  const decision = migrationQuotaDecision({
    isDryRun: !!plan.is_dry_run,
    isPro,
    quotaCharged: !!plan.quota_charged,
    currentCount,
    cap,
  });
  if (decision === 'deny') {
    return res.status(403).json({
      error: 'upgrade_required',
      code: 'MIGRATION_QUOTA_EXCEEDED',
      message: `The Free plan includes ${cap} full migration${cap === 1 ? '' : 's'} per month (dry-runs are unlimited). You've used this month's allowance — upgrade to Pro for unlimited migrations.`,
      currentTier: tier,
      requiredTier: 'pro',
      upgradeUrl: '/pricing',
    });
  }
  // Apply 'charge' only after the plan actually starts (execute handler) so a
  // 409/validation failure doesn't burn a monthly unit.
  req.migrationShouldCharge = decision === 'charge';
  next();
}

// Idempotently consume one monthly full-migration unit for a plan. The guarded
// UPDATE bumps the counter at most once per plan, even under retries or
// concurrent execute calls.
const chargeMigrationQuotaTxn = db.transaction((userId, planId) => {
  const r = db.prepare('UPDATE migration_plans SET quota_charged = 1 WHERE id = ? AND quota_charged = 0').run(planId);
  if (r.changes > 0) incrementUsage(userId, 'migration_full_executions');
});
function chargeMigrationQuota(userId, planId) {
  chargeMigrationQuotaTxn(userId, planId);
}

/**
 * Generate a human-friendly suggestion for a migration error.
 *
 * Accepts the failed task's config so we can tailor the message — e.g. in-place
 * TFVC conversion needs Code (Read, Write & Manage) on the destination project,
 * which a "read-only" PAT does not provide.
 */
function getSuggestionForError(errorMsg, type, config = null) {
  if (!errorMsg) return '';
  const msg = errorMsg.toLowerCase();
  const cfg = (() => {
    try { return typeof config === 'string' ? JSON.parse(config) : (config || {}); } catch { return {}; }
  })();
  const isInPlace = !!cfg.inPlace;
  // Auth errors
  if (msg.includes('authentication') || msg.includes('401') || msg.includes('403') || msg.includes('pat is required')) {
    if (type === 'repo-tfvc' && isInPlace) {
      return 'The Azure DevOps PAT was rejected. For TFVC → Git in-place conversion the PAT must (1) come from the SAME Azure DevOps / TFS server as the destination, (2) be valid and not expired, and (3) include the "Code (Read, Write & Manage)" scope — a read-only PAT is enough to list repos but cannot create the destination Git repo or trigger the Import API.';
    }
    if (type === 'repo-tfvc') {
      return 'The Azure DevOps PAT was rejected. Verify it is not expired and includes "Code (Read, Write & Manage)" — the TFVC → Git flow creates a temporary Git repo in Azure before pushing.';
    }
    return 'Your access token may have expired or lacks the required permissions. Verify the token is valid and has the right scopes (Code: Read on the source; Code: Read, Write & Manage on the destination).';
  }
  // Not found
  if (msg.includes('not found') || msg.includes('404'))
    return 'The source repository could not be found. Verify the organization, project, and repository name are correct.';
  // Git LFS not installed on the server (lfs-migrate path)
  if (msg.includes('git lfs is not installed') || msg.includes('git-lfs'))
    return 'Install git-lfs on the migration server (https://git-lfs.com) so files over 100 MB can be converted to LFS, then retry. Alternatively, exclude this repository.';
  // Target already exists
  if (msg.includes('already exists'))
    return 'A repository with the same name already exists on the target. Rename the target or delete the existing repository first.';
  // Invalid target repo name
  if (msg.includes('invalid target repository name'))
    return 'The target repository name is invalid. Names cannot start with _ or ., end with ., or contain special characters. Rename and try again.';
  // URL/network issues
  if (msg.includes('url rejected') || msg.includes('bad hostname'))
    return 'The clone URL was rejected — this can happen with special characters in the project name. Try re-running the migration.';
  if (msg.includes('private or internal network') || msg.includes('resolves to a private'))
    return 'The repository URL was blocked because it resolved to a private or internal network address. Verify the source URL is a public Azure DevOps address.';
  // Timeouts
  if (msg.includes('timeout') || msg.includes('timed out'))
    return 'The operation timed out. This can happen with very large repositories. Try again or consider migrating during off-peak hours.';
  // TFVC conversion
  if (msg.includes('tfvc conversion failed'))
    return 'The TFVC-to-Git conversion failed on the Azure DevOps side. Verify the TFVC path exists and the project supports Git imports.';
  // Rate limiting
  if (msg.includes('rate limit'))
    return 'A rate limit was hit. Wait a few minutes and retry the migration.';
  // Wiki-specific
  if (msg.includes('could not retrieve wiki clone url'))
    return 'The wiki could not be found in Azure DevOps. Verify the wiki ID is correct and the project has an active wiki.';
  // Type-specific fallbacks (must remain after more specific patterns above)
  if (type === 'work-items')
    return 'Work item migration encountered an error. Verify the Azure DevOps project has accessible work items and the token has work item read permissions.';
  if (type === 'wiki')
    return 'Wiki migration failed. Verify the wiki exists and is accessible with your current credentials.';
  return '';
}

// POST /api/migration/plans — Create a new plan
router.post('/plans', requireAuth, async (req, res) => {
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      logger.warn({ errors: flat }, 'Migration plan validation failed');
      return res.status(400).json({ error: 'Validation failed', details: flat });
    }
    const { source, tasks, targetOrg, schedule, taggingPolicy } = parsed.data;
    // Free tier: creating a full (non-dry-run) plan is allowed — the monthly
    // quota is enforced at execute time (requireMigrationQuota). The one thing
    // Free cannot do is SCHEDULE a full migration to auto-run later, because a
    // scheduled run bypasses the interactive execute meter; that stays Pro.
    const userOrder = getTierOrder(getUserTier(req.session.userId));
    const isFree = userOrder < getTierOrder('pro');
    if (isFree && schedule?.isDryRun === false && schedule?.mode === 'scheduled') {
      return res.status(403).json({
        error: 'Scheduling a full migration requires the Pro plan. Free-tier users can run one full migration per month immediately, or schedule unlimited dry-runs.',
        code: 'upgrade_required',
        requiredTier: 'pro',
        upgradeUrl: '/pricing',
      });
    }
    // Gate the source host against the allowlist before persisting. Without
    // this check a user could store an arbitrary hostname in the plan that
    // bypasses the per-request allowlist enforcement applied to /azure/* and
    // /import/azure-tfvc routes.
    if (source.host) {
      const hostCheck = await validateAzureHost(source.host);
      if (!hostCheck.ok) {
        return res.status(400).json({ error: `Source host rejected: ${hostCheck.reason}`, code: 'invalid_host' });
      }
    }
    const isDryRun = !!schedule?.isDryRun;
    const planId = engine.createPlan(req.session.userId, source, tasks, { targetOrg, isDryRun });
    if (taggingPolicy) {
      try {
        db.prepare('UPDATE migration_plans SET tagging_policy = ? WHERE id = ?')
          .run(JSON.stringify(taggingPolicy), planId);
      } catch (err) {
        logger.warn({ err, planId }, 'failed to persist tagging_policy on plan; using defaults');
      }
    }
    if (schedule?.mode === 'scheduled' && schedule?.scheduledAt) {
      const credentials = {
        githubToken: req.session.accessToken,
        azurePat: source.pat || null,
        azureHost: source.host || 'dev.azure.com',
        azureOrg: source.org,
        azureProject: source.project
      };
      engine.schedulePlan(planId, schedule.scheduledAt, credentials);
    }
    res.json({ planId });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/plans — List user's plans (paginated)
router.get('/plans', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page) || 20));
    const offset = (page - 1) * perPage;
    const rows = db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM migration_tasks t WHERE t.plan_id = p.id) AS task_count
       FROM migration_plans p
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`
    ).all(req.session.userId, perPage, offset);
    const total = db.prepare('SELECT COUNT(*) as count FROM migration_plans WHERE user_id = ?').get(req.session.userId);
    const plans = rows.map(row => formatPlanForApi(row, { taskCount: row.task_count ?? 0 }));
    res.json({ plans, total: total.count, page, perPage });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/plans/:id — Get plan with all tasks
router.get('/plans/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const fullPlan = engine.getPlanStatus(id);
    res.json(formatPlanForApi(fullPlan, { tasks: fullPlan.tasks || [] }));
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// PUT /api/migration/plans/:id — Update plan (before execution)
router.put('/plans/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.status !== 'draft') return res.status(400).json({ error: 'Can only update draft plans' });
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    if (parsed.data.source?.host) {
      const hostCheck = await validateAzureHost(parsed.data.source.host);
      if (!hostCheck.ok) {
        return res.status(400).json({ error: `Source host rejected: ${hostCheck.reason}`, code: 'invalid_host' });
      }
    }
    engine.updatePlan(id, parsed.data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// DELETE /api/migration/plans/:id
router.delete('/plans/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    engine.deletePlan(id);
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('Cannot delete')) return res.status(400).json({ error: 'Cannot delete an active plan' });
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/validate — Pre-flight validation
router.post('/plans/:id/validate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const result = engine.validatePlan(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/execute — Start execution
router.post('/plans/:id/execute', requireAuth, requireMigrationQuota, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Resolve the PAT BEFORE the status transition + quota charge so a
    // broken saved credential fails the request without stranding the
    // plan 'running' or consuming a migration unit.
    const patResolution = resolvePlanExecutionPat(req, res);
    if (patResolution.abort) return;

    // Preflight required migration tooling BEFORE transitioning to 'running',
    // so a missing tool (e.g. git-lfs) returns an actionable error instead of
    // stranding the plan mid-run. Guarded: the seam is null in unit harnesses.
    if (typeof engine._preflight === 'function') {
      try {
        await engine._preflight(plan);
      } catch (toolErr) {
        if (toolErr?.code === 'ENV_TOOL_MISSING') {
          return res.status(422).json({
            error: toolErr.message,
            code: toolErr.code,
            fix: toolErr.fix,
            docsUrl: toolErr.docsUrl,
          });
        }
        throw toolErr;
      }
    }

    // Atomic status transition to prevent double-execute race condition
    const updated = db.prepare('UPDATE migration_plans SET status = ? WHERE id = ? AND status IN (?, ?)').run('running', id, 'draft', 'paused');
    if (updated.changes === 0) {
      return res.status(409).json({ error: 'Plan is already running or cannot be executed' });
    }

    // The plan is now genuinely running — consume the monthly full-migration
    // unit (idempotent per plan; only set when the meter decided to charge).
    // If charging throws, roll the status back to its prior value so the plan
    // isn't stranded 'running' but uncharged (the user can retry; the meter
    // re-evaluates). The atomic transition above stays first as the race guard.
    if (req.migrationShouldCharge) {
      try {
        chargeMigrationQuota(req.session.userId, id);
      } catch (chargeErr) {
        db.prepare('UPDATE migration_plans SET status = ? WHERE id = ?').run(plan.status, id);
        throw chargeErr;
      }
    }

    // Extract credentials from session for immediate execution. Accepts either
    // a pasted PAT or a savedCredentialId — the latter is decrypted from the
    // per-user vault server-side so the raw secret never round-trips through
    // the browser at execute time.
    const azurePat = patResolution.pat;
    const credentials = {
      githubToken: req.session.accessToken,
      azurePat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };

    // Start execution asynchronously. `executePlan` now stashes credentials
    // itself so the tagging service (and any other plan-complete consumer)
    // can retrieve them in the async listener path.
    engine.executePlan(id, credentials).catch(err => {
      logger.error({ err, planId: req.params.id }, 'Plan execution error');
    });
    res.json({ success: true, message: 'Execution started' });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/cancel
router.post('/plans/:id/cancel', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    engine.cancelPlan(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/pause
router.post('/plans/:id/pause', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    engine.pausePlan(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/resume
router.post('/plans/:id/resume', requireAuth, requireMigrationQuota, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const resumePat = resolvePlanExecutionPat(req, res);
    if (resumePat.abort) return;
    const resumeCredentials = {
      githubToken: req.session.accessToken,
      azurePat: resumePat.pat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };
    auditLog(req, 'migration.plan.resume', 'migration_plan', id, { status: plan.status });
    engine.resumePlan(id, resumeCredentials).catch(err => {
      logger.error({ err, planId: req.params.id }, 'Plan resume error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/tasks/:taskId/retry
router.post('/plans/:id/tasks/:taskId/retry', requireAuth, requireMigrationQuota, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const retryPat = resolvePlanExecutionPat(req, res);
    if (retryPat.abort) return;
    const retryCredentials = {
      githubToken: req.session.accessToken,
      azurePat: retryPat.pat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };
    auditLog(req, 'migration.task.retry', 'migration_task', parseInt(req.params.taskId), { planId: id });
    engine.retryTask(id, parseInt(req.params.taskId), retryCredentials).catch(err => {
      logger.error({ err, planId: req.params.id, taskId: req.params.taskId }, 'Task retry error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// Rolls back a destructive config mutation (onConflict='replace' / LFS
// sizeStrategy) written by replace-retry / retry-lfs, but ONLY if the retry
// never actually began. engine.retryTask() validates plan/task status
// BEFORE resetting the task to 'pending' (migration-engine.js); every one of
// its guard-clause rejections happens before that reset, so on rejection the
// task's live status is still whatever it was when the route read it
// (normally 'failed'; 'completed' for the lfsPushFailed-recovery retry-lfs
// case below). In that case the config write above was wasted — the retry
// never ran with it — and leaving it persisted would have a later plain
// /retry silently inherit onConflict='replace' (or the LFS strategy) for an
// attempt that never happened. If the task DID transition out of that status
// (a genuine attempt started and failed later, deeper in execution), the
// config is left as-is — that persistence is intentional (mirrors the
// execute handler's charge rollback at ~line 503).
function rollbackConfigIfRetryNeverStarted(taskId, previousConfig, previousStatus = 'failed') {
  try {
    const current = db.prepare('SELECT status FROM migration_tasks WHERE id = ?').get(taskId);
    if (current && current.status === previousStatus) {
      db.prepare('UPDATE migration_tasks SET config = ? WHERE id = ?').run(previousConfig, taskId);
    }
  } catch (rollbackErr) {
    logger.error({ err: rollbackErr, taskId }, 'Failed to roll back destructive retry config');
  }
}

// POST /api/migration/plans/:id/tasks/:taskId/replace-retry — destructive
// recovery for a repo task that failed on an "already exists" conflict.
// Patches the stored config with onConflict='replace' then re-runs the task,
// so the importer deletes + recreates the target. Works on pre-existing failed
// plans too (this path does not go through createPlanSchema).
router.post('/plans/:id/tasks/:taskId/replace-retry', requireAuth, requireMigrationQuota, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const taskId = parseInt(req.params.taskId);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const task = db.prepare('SELECT * FROM migration_tasks WHERE id = ? AND plan_id = ?').get(taskId, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'failed') return res.status(409).json({ error: 'Only failed tasks can be replace-retried' });
    if (task.type !== 'repo' && task.type !== 'repo-tfvc') {
      return res.status(400).json({ error: 'Replace only applies to repository tasks' });
    }
    const retryPat = resolvePlanExecutionPat(req, res);
    if (retryPat.abort) return;
    // Carry the destructive intent into the stored config so retryTask, which
    // re-reads task.config from the DB, deletes and recreates the target.
    const previousConfig = task.config;
    db.prepare('UPDATE migration_tasks SET config = ? WHERE id = ?')
      .run(withReplaceOnConflict(task.config), taskId);
    auditLog(req, 'migration.task.replace-retry', 'migration_task', taskId, { planId: id, targetRef: task.target_ref });
    const retryCredentials = {
      githubToken: req.session.accessToken,
      azurePat: retryPat.pat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project,
    };
    engine.retryTask(id, taskId, retryCredentials).catch(err => {
      logger.error({ err, planId: id, taskId }, 'Replace-retry error');
      rollbackConfigIfRetryNeverStarted(taskId, previousConfig);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/tasks/:taskId/retry-lfs — recovery for a repo
// task's Git LFS story. Two recoverable shapes share this one endpoint:
//   (1) the task itself FAILED (e.g. the oversized-blob pre-check rejected
//       the push before anything was created on the target) — patches the
//       config with sizeStrategy='lfs-migrate' and re-runs. Nothing exists on
//       GitHub yet, so no destructive step is needed.
//   (2) the task COMPLETED but its LFS push failed after 3 retries
//       (import-service.js sets metadata.lfsPushFailed) — the repo content is
//       already live on GitHub, so a bare re-run would hit "already exists".
//       Recovering here reuses the same 'replace' delete+recreate path as
//       replace-retry, PLUS sizeStrategy='lfs-migrate', so the re-run lands
//       fresh with LFS wired in from the start. There is no narrower "push
//       only the missing LFS objects" runner today — the wizard's own
//       ReplaceConfirmModal gate is what the client shows before calling this
//       for shape (2), since it is a genuinely destructive action.
router.post('/plans/:id/tasks/:taskId/retry-lfs', requireAuth, requireMigrationQuota, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const taskId = parseInt(req.params.taskId);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const task = db.prepare('SELECT * FROM migration_tasks WHERE id = ? AND plan_id = ?').get(taskId, id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.type !== 'repo' && task.type !== 'repo-tfvc') {
      return res.status(400).json({ error: 'Git LFS migration only applies to repository tasks' });
    }
    let lfsPushFailedOnCompleted = false;
    if (task.status === 'completed') {
      try { lfsPushFailedOnCompleted = !!JSON.parse(task.metadata || '{}')?.lfsPushFailed; }
      catch { /* malformed metadata — treat as not eligible */ }
    }
    if (task.status !== 'failed' && !lfsPushFailedOnCompleted) {
      return res.status(409).json({ error: 'Only failed tasks, or completed tasks whose LFS upload failed, can be retried' });
    }
    const retryPat = resolvePlanExecutionPat(req, res);
    if (retryPat.abort) return;
    const previousConfig = task.config;
    const previousStatus = task.status;
    const nextConfig = lfsPushFailedOnCompleted
      ? withReplaceOnConflict(withLfsMigrate(task.config))
      : withLfsMigrate(task.config);
    db.prepare('UPDATE migration_tasks SET config = ? WHERE id = ?')
      .run(nextConfig, taskId);
    auditLog(req, 'migration.task.retry-lfs', 'migration_task', taskId, {
      planId: id, targetRef: task.target_ref, deleteAndRecreate: lfsPushFailedOnCompleted,
    });
    const retryCredentials = {
      githubToken: req.session.accessToken,
      azurePat: retryPat.pat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project,
    };
    engine.retryTask(id, taskId, retryCredentials, { allowLfsPushFailedRetry: lfsPushFailedOnCompleted }).catch(err => {
      logger.error({ err, planId: id, taskId }, 'LFS-retry error');
      rollbackConfigIfRetryNeverStarted(taskId, previousConfig, previousStatus);
    });
    res.json({ success: true, deleteAndRecreate: lfsPushFailedOnCompleted });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/stream/:id — SSE stream
router.get('/stream/:id', requireAuth, (req, res) => {
  engine.handleSSEConnection(parseInt(req.params.id), req.session.userId, req, res);
});

// POST /api/migration/analyze — AI-powered or fallback analysis
//
// AI is opportunistic here: when a per-user provider is available the
// response is enriched with a grounded risk/suggestion analysis (metered
// against the same ai_migration_risk quota as the sibling POST /ai/migration-risk
// endpoint); when it isn't, or the provider call fails for a transient
// reason, the endpoint still returns a full deterministic analysis via
// fallbackAnalysis() so the wizard never blocks on AI availability. Only a
// monthly spend-cap denial is NOT swallowed into that fallback — it must
// surface as a real 429 (OWASP LLM10: a request left unmetered here could
// ride up to 200 repos' worth of prompt on the server's key for free).
//
// requireScope('ai') is NOT paired with an AI_GENERATION_ROUTE_PATHS entry:
// this route lives in server/routes/migration.js, not the server/routes/ai/*
// barrel the parity test in ai-key-scope-enforcement.test.js walks, so it
// falls outside that allowlist's carve-out mechanism entirely (mirrors
// server/routes/v1/repos-security.js's /security/summary, which is in the
// same position). The practical effect: only session users and admin-scoped
// API keys can reach this route; a write-only key no longer can.
router.post('/analyze', requireAuth, requireScope('ai'), async (req, res) => {
  try {
    const context = req.body;
    if (!context || !Array.isArray(context.repos) || context.repos.length > 200) {
      return res.status(400).json({ error: 'Invalid context: repos array required (max 200)' });
    }

    const userId = req.session.userId;
    let generate;
    let reservedAI = false;
    // attachAIProvider() only populates req.aiProvider as a side effect of a
    // prior req.getAIProvider('completion') call (see middleware/auth.js) —
    // this route has no requireAI middleware to trigger that resolution, so
    // without this explicit call req.aiProvider is always undefined and the
    // AI-powered path below silently never runs, degrading to
    // fallbackAnalysis() on every request regardless of provider config.
    if (!req.aiProvider && typeof req.getAIProvider === 'function') {
      req.aiProvider = await req.getAIProvider('completion').catch(() => null);
    }
    if (req.aiProvider) {
      const check = reserveAIQuota(req, res, 'ai_migration_risk');
      if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
      reservedAI = true;
      generate = (opts) => guardedGenerate(req, opts, { feature: 'migration_analyze' });
    }

    const { aiUsed, ...result } = await analyzeMigration(context, generate);
    // This route answers 200 even when it falls back to the deterministic
    // analysis, so the automatic refund (4xx/5xx only) does not apply — hand
    // the unit back explicitly when no AI call actually happened.
    if (reservedAI && !aiUsed) releaseGuardedAIUsage(userId, 'ai_migration_risk');
    res.json(result);
  } catch (err) {
    if (err?.code === 'AI_SPEND_CAP_REACHED') return handleAIError(res, err);
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/plans/:id/report — Export report
router.get('/plans/:id/report', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ownership = db.prepare('SELECT id FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!ownership) return res.status(404).json({ error: 'Plan not found' });
    const plan = engine.getPlanStatus(id);
    const startedAt = plan.started_at;
    const completedAt = plan.completed_at;
    const durationSeconds = startedAt && completedAt
      ? Math.round((new Date(completedAt) - new Date(startedAt)) / 1000) : 0;
    const summary = plan.summary || { total: 0, success: 0, failed: 0, skipped: 0 };
    const tasks = plan.tasks.map(t => ({
      id: t.id, type: t.type, sourceRef: t.source_ref, targetRef: t.target_ref,
      status: t.status,
      durationSeconds: t.started_at && t.completed_at
        ? Math.round((new Date(t.completed_at) - new Date(t.started_at)) / 1000) : 0,
      metadata: t.metadata || {}
    }));
    const errors = plan.tasks.filter(t => t.status === 'failed').map(t => ({
      taskId: t.id, type: t.type, targetRef: t.target_ref, error: t.error_message || 'Unknown error',
      suggestion: getSuggestionForError(t.error_message, t.type, t.config),
    }));
    res.json({
      plan: { id: plan.id, status: plan.status, isDryRun: !!plan.is_dry_run, startedAt, completedAt, durationSeconds },
      summary, tasks, errors, generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

export { engine, taggingService };
export default router;
