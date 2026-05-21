import express from 'express';
import logger from '../lib/logger.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { getUserTier } from '../middleware/require-tier.js';
import { getTierOrder } from '../lib/feature-flags.js';
import { MigrationEngine } from '../migration-engine.js';
import { createPlanSchema, updatePlanSchema } from '../lib/validators.js';
import { analyzeMigration } from '../migration-planner.js';
import { validateAzureHost } from '../lib/azure-host-validator.js';
import db from '../db.js';

const router = express.Router();
const engine = new MigrationEngine(db);

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

// Free users can create plans but only in dry-run mode. Real execution (and
// resume/retry of anything that wasn't a dry-run) requires Pro+.
function requireProOrDryRunPlan(req, res, next) {
  const id = parseInt(req.params.id);
  const plan = db.prepare('SELECT is_dry_run FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const userOrder = getTierOrder(getUserTier(req.session.userId));
  const proOrder = getTierOrder('pro');
  if (plan.is_dry_run || userOrder >= proOrder) return next();
  return res.status(403).json({
    error: 'upgrade_required',
    message: 'Real migration execution requires the Pro plan. Free users can create and run dry-run plans only.',
    currentTier: getUserTier(req.session.userId),
    requiredTier: 'pro',
    upgradeUrl: '/pricing',
  });
}

/**
 * Generate a human-friendly suggestion for a migration error
 */
function getSuggestionForError(errorMsg, type) {
  if (!errorMsg) return '';
  const msg = errorMsg.toLowerCase();
  // Auth errors
  if (msg.includes('authentication') || msg.includes('401') || msg.includes('403') || msg.includes('pat is required'))
    return 'Your access token may have expired or lacks the required permissions. Verify the token is valid and has repository read access.';
  // Not found
  if (msg.includes('not found') || msg.includes('404'))
    return 'The source repository could not be found. Verify the organization, project, and repository name are correct.';
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
    const { source, tasks, targetOrg, schedule } = parsed.data;
    // Free tier gate — "real migration execution requires Pro" per pricing page.
    // Previously this silently coerced isDryRun=true when a Free user explicitly
    // requested a real run; that was surprising (the API appeared to accept the
    // payload but produced a dry-run plan). Now we reject the request outright
    // so the contract is explicit.
    const userOrder = getTierOrder(getUserTier(req.session.userId));
    const isFree = userOrder < getTierOrder('pro');
    if (isFree && schedule?.isDryRun === false) {
      return res.status(403).json({
        error: 'upgrade_required',
        message: 'Real migration execution requires the Pro plan. Free-tier users can still create and run dry-run plans.',
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
        return res.status(400).json({ error: 'invalid_host', message: `Source host rejected: ${hostCheck.reason}` });
      }
    }
    const isDryRun = isFree ? true : !!schedule?.isDryRun;
    const planId = engine.createPlan(req.session.userId, source, tasks, { targetOrg, isDryRun });
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
        return res.status(400).json({ error: 'invalid_host', message: `Source host rejected: ${hostCheck.reason}` });
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
router.post('/plans/:id/execute', requireAuth, requireProOrDryRunPlan, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Atomic status transition to prevent double-execute race condition
    const updated = db.prepare('UPDATE migration_plans SET status = ? WHERE id = ? AND status IN (?, ?)').run('running', id, 'draft', 'paused');
    if (updated.changes === 0) {
      return res.status(409).json({ error: 'Plan is already running or cannot be executed' });
    }

    // Extract credentials from session for immediate execution
    const body = req.body || {};
    const azurePat = typeof body.azurePat === 'string' ? body.azurePat : null;
    const credentials = {
      githubToken: req.session.accessToken,
      azurePat,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };

    // Start execution asynchronously
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
router.post('/plans/:id/resume', requireAuth, requireProOrDryRunPlan, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const resumeBody = req.body || {};
    const resumeCredentials = {
      githubToken: req.session.accessToken,
      azurePat: typeof resumeBody.azurePat === 'string' ? resumeBody.azurePat : null,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };
    engine.resumePlan(id, resumeCredentials).catch(err => {
      logger.error({ err, planId: req.params.id }, 'Plan resume error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/tasks/:taskId/retry
router.post('/plans/:id/tasks/:taskId/retry', requireAuth, requireProOrDryRunPlan, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = db.prepare('SELECT * FROM migration_plans WHERE id = ? AND user_id = ?').get(id, req.session.userId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const retryBody = req.body || {};
    const retryCredentials = {
      githubToken: req.session.accessToken,
      azurePat: typeof retryBody.azurePat === 'string' ? retryBody.azurePat : null,
      azureHost: plan.azure_host || 'dev.azure.com',
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };
    engine.retryTask(id, parseInt(req.params.taskId), retryCredentials).catch(err => {
      logger.error({ err, planId: req.params.id, taskId: req.params.taskId }, 'Task retry error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/stream/:id — SSE stream
router.get('/stream/:id', requireAuth, (req, res) => {
  engine.handleSSEConnection(parseInt(req.params.id), req.session.userId, req, res);
});

// POST /api/migration/analyze — AI-powered or fallback analysis
router.post('/analyze', requireAuth, async (req, res) => {
  try {
    const context = req.body;
    if (!context || !Array.isArray(context.repos) || context.repos.length > 200) {
      return res.status(400).json({ error: 'Invalid context: repos array required (max 200)' });
    }
    const result = await analyzeMigration(context);
    res.json(result);
  } catch (err) {
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
      taskId: t.id, type: t.type, error: t.error_message || 'Unknown error',
      suggestion: getSuggestionForError(t.error_message, t.type)
    }));
    res.json({
      plan: { id: plan.id, status: plan.status, isDryRun: !!plan.is_dry_run, startedAt, completedAt, durationSeconds },
      summary, tasks, errors, generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

export { engine };
export default router;
