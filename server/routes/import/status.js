import express from 'express';
import db from '../../db.js';
import * as importService from '../../import-service.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { safeJsonParse } from '../../lib/utils.js';

const router = express.Router();

router.get('/import/git-status', requireAuth, async (req, res) => {
    try {
        const result = await importService.checkGitInstalled();
        res.json(result);
    } catch (error) {
        res.json({ installed: false, error: 'Git is not available or failed to respond' });
    }
});

router.get('/import/status/:id', requireAuth, async (req, res) => {
    try {
        const job = db.prepare(`
            SELECT * FROM migration_jobs WHERE id = ? AND user_id = ?
        `).get(req.params.id, req.session.userId);

        if (!job) {
            return errorResponse(res, 404, 'Migration job not found', 'NOT_FOUND');
        }

        res.json({
            id: job.id,
            sourceType: job.source_type,
            sourceName: job.source_name,
            targetRepo: job.target_repo,
            targetFullName: job.target_full_name,
            status: job.status,
            progressPct: job.progress_pct,
            progressMessage: job.progress_message,
            errorMessage: job.error_message,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            metadata: safeJsonParse(job.metadata)
        });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

router.get('/migrations', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 20;
        const offset = (page - 1) * perPage;

        const jobs = db.prepare(`
            SELECT * FROM migration_jobs WHERE user_id = ?
            ORDER BY started_at DESC LIMIT ? OFFSET ?
        `).all(req.session.userId, perPage, offset);

        const total = db.prepare('SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ?')
            .get(req.session.userId);

        res.json({
            migrations: jobs.map(j => ({
                id: j.id,
                sourceType: j.source_type,
                sourceName: j.source_name,
                sourceUrl: j.source_url,
                targetRepo: j.target_repo,
                targetFullName: j.target_full_name,
                status: j.status,
                progressPct: j.progress_pct,
                progressMessage: j.progress_message,
                errorMessage: j.error_message,
                startedAt: j.started_at,
                completedAt: j.completed_at,
                metadata: safeJsonParse(j.metadata)
            })),
            total: total.count,
            page,
            totalPages: Math.ceil(total.count / perPage)
        });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// ------------------------------------------------------------------
// Migration stats summary for dashboard
// ------------------------------------------------------------------
router.get('/migrations/stats', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const total = db.prepare('SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ?').get(userId);
        // Tolerate the legacy 'complete'/'completed' split during rollout: count
        // both spellings as the terminal-success state so bulk-mirrored jobs
        // (which write 'completed') no longer vanish from the Successful count.
        const completed = db.prepare("SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ? AND status IN ('complete', 'completed')").get(userId);
        const failed = db.prepare("SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ? AND status = 'failed'").get(userId);
        const running = db.prepare("SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ? AND status IN ('pending', 'running')").get(userId);
        const tfvc = db.prepare("SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ? AND source_type = 'azure-tfvc'").get(userId);
        const recent = db.prepare(`
            SELECT id, source_type, source_name, target_repo, target_full_name, status, progress_pct, progress_message, started_at, completed_at, metadata
            FROM migration_jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT 5
        `).all(userId);

        res.json({
            total: total.count,
            completed: completed.count,
            failed: failed.count,
            running: running.count,
            tfvc: tfvc.count,
            recent: recent.map(j => ({
                id: j.id,
                sourceType: j.source_type,
                sourceName: j.source_name,
                targetRepo: j.target_repo,
                targetFullName: j.target_full_name,
                status: j.status,
                progressPct: j.progress_pct,
                progressMessage: j.progress_message,
                startedAt: j.started_at,
                completedAt: j.completed_at,
                metadata: safeJsonParse(j.metadata)
            }))
        });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Failed to get migration stats'));
    }
});

export default router;
