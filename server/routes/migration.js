import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { MigrationEngine } from '../migration-engine.js';
import { createPlanSchema, updatePlanSchema } from '../lib/validators.js';
import { analyzeMigration } from '../migration-planner.js';
import db from '../db.js';

const router = express.Router();
const engine = new MigrationEngine(db);

// POST /api/migration/plans — Create a new plan
router.post('/migration/plans', requireAuth, async (req, res) => {
  try {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { source, tasks, targetOrg, schedule } = parsed.data;
    const planId = engine.createPlan(req.session.userId, source, tasks, { targetOrg, isDryRun: schedule?.isDryRun });
    if (schedule?.mode === 'scheduled' && schedule?.scheduledAt) {
      const credentials = {
        githubToken: req.session.accessToken,
        azurePat: req.body.source?.pat || null,
        azureOrg: source.org,
        azureProject: source.project
      };
      engine.schedulePlan(planId, schedule.scheduledAt, credentials);
    }
    res.json({ planId });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/migration/plans/:id — Get plan with all tasks
router.get('/migration/plans/:id', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    res.json(plan);
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Cannot delete')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/migration/plans/:id/execute — Start execution
router.post('/migration/plans/:id/execute', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });

    // Extract credentials from session for immediate execution
    const azurePat = typeof req.body.azurePat === 'string' ? req.body.azurePat : null;
    const credentials = {
      githubToken: req.session.accessToken,
      azurePat,
      azureOrg: plan.source_org,
      azureProject: plan.source_project
    };

    // Start execution asynchronously
    engine.executePlan(parseInt(req.params.id), credentials).catch(err => {
      console.error('Plan execution error:', err);
    });
    res.json({ success: true, message: 'Execution started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/migration/plans/:id/resume
router.post('/migration/plans/:id/resume', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    engine.resumePlan(parseInt(req.params.id)).catch(err => {
      console.error('Plan resume error:', err);
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/migration/plans/:id/tasks/:taskId/retry
router.post('/migration/plans/:id/tasks/:taskId/retry', requireAuth, async (req, res) => {
  try {
    const plan = engine.getPlanStatus(parseInt(req.params.id));
    if (plan.user_id !== req.session.userId) return res.status(403).json({ error: 'Forbidden' });
    engine.retryTask(parseInt(req.params.id), parseInt(req.params.taskId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      taskId: t.id, type: t.type, error: t.error_message || 'Unknown error', suggestion: ''
    }));
    res.json({
      plan: { id: plan.id, status: plan.status, startedAt, completedAt, durationSeconds },
      summary, tasks, errors, generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
