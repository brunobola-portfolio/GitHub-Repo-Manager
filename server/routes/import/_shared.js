import db from '../../db.js';

export const updateJobProgress = db.transaction((status, message, pct, jobId) => {
    // Canonical terminal status is 'completed' (matches the new engine + bulk
    // mirror). `status` here is the internal progress phase ('complete') emitted
    // by import-service/wiki-service; we persist it as 'completed'.
    const dbStatus = status === 'complete' ? 'completed' : status === 'failed' ? 'failed' : 'running';
    db.prepare(`
        UPDATE migration_jobs SET status = ?, progress_message = ?, progress_pct = ?
        WHERE id = ?
    `).run(dbStatus, message, pct, jobId);

    if (status === 'complete' || status === 'failed') {
        db.prepare(`UPDATE migration_jobs SET completed_at = datetime('now') WHERE id = ?`).run(jobId);
    }
});
