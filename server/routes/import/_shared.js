import db from '../../db.js';

export const updateJobProgress = db.transaction((status, message, pct, jobId) => {
    const dbStatus = status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'running';
    db.prepare(`
        UPDATE migration_jobs SET status = ?, progress_message = ?, progress_pct = ?
        WHERE id = ?
    `).run(dbStatus, message, pct, jobId);

    if (status === 'complete' || status === 'failed') {
        db.prepare(`UPDATE migration_jobs SET completed_at = datetime('now') WHERE id = ?`).run(jobId);
    }
});
