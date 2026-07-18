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

// ------------------------------------------------------------------
// Cancellation registry for the simple/URL import path (migration_jobs).
//
// Mirrors MigrationEngine._cancelledPlans: an in-memory flag checked by
// importRepository's isCancelled() callback at every phase boundary and by
// its AbortController watcher (server/import-service.js). In-memory only —
// cancellation can't survive a restart because the child git process it's
// meant to interrupt dies with the process anyway; recoverInterruptedImportJobs()
// below is the belt-and-braces crash path for that case.
// ------------------------------------------------------------------
const cancelledJobs = new Set();

export function requestJobCancel(jobId) {
    cancelledJobs.add(jobId);
}

export function isJobCancelled(jobId) {
    return cancelledJobs.has(jobId);
}

export function clearJobCancel(jobId) {
    cancelledJobs.delete(jobId);
}

/**
 * Marks any migration_jobs row still 'running' or 'pending' at process start
 * as 'interrupted'. A crash (OOM/SIGKILL, or any hard restart) leaves these
 * rows with no live git clone/push process backing them — and unlike
 * migration_plans/migration_tasks there is no task model or stored
 * credentials to resume from, so honest recovery here means surfacing the
 * interruption (never silently resetting to 'pending', which would relaunch
 * nothing) and letting the user re-run the import. Mirrors the terminal-
 * status guarantee MigrationEngine.recoverInterruptedPlans() gives Azure
 * plans, scaled down to this path's simpler (task-less) shape.
 *
 * Idempotent and safe to call once at server startup.
 * @returns {{ recovered: number }}
 */
export function recoverInterruptedImportJobs() {
    const result = db.prepare(
        "UPDATE migration_jobs SET status = 'interrupted', completed_at = datetime('now'), error_message = COALESCE(error_message, 'Interrupted by a server restart') WHERE status IN ('running', 'pending')"
    ).run();
    return { recovered: result.changes };
}
