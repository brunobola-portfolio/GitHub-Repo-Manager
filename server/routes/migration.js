import express from 'express';
import logger from '../lib/logger.js';
import { requireAuth, safeError } from '../middleware/auth.js';
import { MigrationEngine } from '../migration-engine.js';
import { createPlanSchema, updatePlanSchema } from '../lib/validators.js';
import { analyzeMigration } from '../migration-planner.js';
import db from '../db.js';

const router = express.Router();
const engine = new MigrationEngine(db);

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
router.post('/migration/plans', requireAuth, async (req, res) => {
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      logger.warn({ errors: flat }, 'Migration plan validation failed');
      return res.status(400).json({ error: 'Validation failed', details: flat });
    }
    const { source, tasks, targetOrg, schedule } = parsed.data;
    const planId = engine.createPlan(req.session.userId, source, tasks, { targetOrg, isDryRun: schedule?.isDryRun });
    if (schedule?.mode === 'scheduled' && schedule?.scheduledAt) {
      const credentials = {
        githubToken: req.session.accessToken,
        azurePat: source.pat || null,
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
router.get('/migration/plans', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page) || 20));
    const offset = (page - 1) * perPage;
    const plans = db.prepare(
      'SELECT * FROM migration_plans WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(req.session.userId, perPage, offset);
    const total = db.prepare('SELECT COUNT(*) as count FROM migration_plans WHERE user_id = ?').get(req.session.userId);
    res.json({ plans, total: total.count, page, perPage });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/plans/:id — Get plan with all tasks
router.get('/migration/plans/:id', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    res.json(plan);
  } catch (err) {
    if (err.message?.includes('not found')) return res.status(404).json({ error: 'Plan not found' });
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// PUT /api/migration/plans/:id — Update plan (before execution)
router.put('/migration/plans/:id', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    if (plan.status !== 'draft') return res.status(400).json({ error: 'Can only update draft plans' });
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// DELETE /api/migration/plans/:id
router.delete('/migration/plans/:id', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    engine.deletePlan(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    if (err.message?.includes('Cannot delete')) return res.status(400).json({ error: 'Cannot delete an active plan' });
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/validate — Pre-flight validation
router.post('/migration/plans/:id/validate', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    const result = engine.validatePlan(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/execute — Start execution
router.post('/migration/plans/:id/execute', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });

    // Extract credentials from session for immediate execution
    const body = req.body || {};
    const azurePat = typeof body.azurePat === 'string' ? body.azurePat : null;
    const credentials = {
      githubToken: req.session.accessToken,
      azurePat,
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };

    // Start execution asynchronously
    engine.executePlan(parseInt(req.params.id), credentials).catch(err => {
      logger.error({ err, planId: req.params.id }, 'Plan execution error');
    });
    res.json({ success: true, message: 'Execution started' });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/cancel
router.post('/migration/plans/:id/cancel', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    engine.cancelPlan(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/pause
router.post('/migration/plans/:id/pause', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    engine.pausePlan(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/resume
router.post('/migration/plans/:id/resume', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    const resumeBody = req.body || {};
    const resumeCredentials = {
      githubToken: req.session.accessToken,
      azurePat: typeof resumeBody.azurePat === 'string' ? resumeBody.azurePat : null,
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };
    engine.resumePlan(parseInt(req.params.id), resumeCredentials).catch(err => {
      logger.error({ err, planId: req.params.id }, 'Plan resume error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// POST /api/migration/plans/:id/tasks/:taskId/retry
router.post('/migration/plans/:id/tasks/:taskId/retry', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    const retryBody = req.body || {};
    const retryCredentials = {
      githubToken: req.session.accessToken,
      azurePat: typeof retryBody.azurePat === 'string' ? retryBody.azurePat : null,
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };
    engine.retryTask(parseInt(req.params.id), parseInt(req.params.taskId), retryCredentials).catch(err => {
      logger.error({ err, planId: req.params.id, taskId: req.params.taskId }, 'Task retry error');
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err, 'Operation failed') });
  }
});

// GET /api/migration/stream/:id — SSE stream
router.get('/migration/stream/:id', requireAuth, (req, res) => {
  engine.handleSSEConnection(parseInt(req.params.id), req.session.userId, req, res);
});

// POST /api/migration/analyze — AI-powered or fallback analysis
router.post('/migration/analyze', requireAuth, async (req, res) => {
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
router.get('/migration/plans/:id/report', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
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

export default router;
