import db from './db.js';
import logger from './lib/logger.js';

class ActionsService {
    /**
     * Store or update a workflow run
     * @param {object} runData - GitHub workflow run data
     * @param {number} [userId=0] - Tenant user ID for multi-tenancy
     */
    storeWorkflowRun(runData, userId = 0) {
        const stmt = db.prepare(`
            INSERT INTO workflow_runs (
                github_run_id, repo_id, user_id, workflow_id, workflow_name,
                run_number, status, conclusion, started_at, completed_at,
                duration_seconds, commit_sha, branch, event_type,
                actor_login, html_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(github_run_id) DO UPDATE SET
                status = excluded.status,
                conclusion = excluded.conclusion,
                completed_at = excluded.completed_at,
                duration_seconds = excluded.duration_seconds,
                updated_at = CURRENT_TIMESTAMP
        `);

        const duration = runData.completed_at && runData.started_at
            ? Math.floor((new Date(runData.completed_at) - new Date(runData.started_at)) / 1000)
            : null;

        stmt.run(
            runData.id,
            runData.repository?.id || runData.repo_id,
            userId,
            runData.workflow_id,
            runData.name,
            runData.run_number,
            runData.status,
            runData.conclusion || null,
            runData.run_started_at || runData.created_at,
            runData.completed_at || null,
            duration,
            runData.head_sha,
            runData.head_branch,
            runData.event,
            runData.actor?.login || null,
            runData.html_url
        );
    }

    /**
     * Get stats for a specific repository
     * @param {number} repoId
     * @param {number} [days=30]
     * @param {number} [userId] - Tenant user ID (omit for unscoped)
     */
    getRepoStats(repoId, days = 30, userId) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoff = cutoffDate.toISOString();

        let stats;
        if (userId !== undefined && userId !== null) {
            stats = db.prepare(`
                SELECT
                    COUNT(*) as total_runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                    SUM(CASE WHEN conclusion = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
                    AVG(duration_seconds) as avg_duration,
                    MAX(started_at) as last_run_at
                FROM workflow_runs
                WHERE repo_id = ? AND user_id = ? AND started_at >= ?
            `).get(repoId, userId, cutoff);
        } else {
            stats = db.prepare(`
                SELECT
                    COUNT(*) as total_runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                    SUM(CASE WHEN conclusion = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
                    AVG(duration_seconds) as avg_duration,
                    MAX(started_at) as last_run_at
                FROM workflow_runs
                WHERE repo_id = ? AND started_at >= ?
            `).get(repoId, cutoff);
        }

        const successRate = stats.total_runs > 0
            ? (stats.success_count / stats.total_runs)
            : 0;

        return {
            totalRuns: stats.total_runs || 0,
            successCount: stats.success_count || 0,
            failureCount: stats.failure_count || 0,
            cancelledCount: stats.cancelled_count || 0,
            successRate: +(successRate * 100).toFixed(2),
            avgDuration: Math.round(stats.avg_duration || 0),
            lastRunAt: stats.last_run_at
        };
    }

    /**
     * Get daily trend data
     * @param {number} repoId
     * @param {number} [days=30]
     * @param {number} [userId] - Tenant user ID (omit for unscoped)
     */
    getDailyTrends(repoId, days = 30, userId) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoff = cutoffDate.toISOString();

        let trends;
        if (userId !== undefined && userId !== null) {
            trends = db.prepare(`
                SELECT
                    DATE(started_at) as date,
                    COUNT(*) as runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as successes,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failures,
                    AVG(duration_seconds) as avg_duration
                FROM workflow_runs
                WHERE repo_id = ? AND user_id = ? AND started_at >= ?
                GROUP BY DATE(started_at)
                ORDER BY date ASC
            `).all(repoId, userId, cutoff);
        } else {
            trends = db.prepare(`
                SELECT
                    DATE(started_at) as date,
                    COUNT(*) as runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as successes,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failures,
                    AVG(duration_seconds) as avg_duration
                FROM workflow_runs
                WHERE repo_id = ? AND started_at >= ?
                GROUP BY DATE(started_at)
                ORDER BY date ASC
            `).all(repoId, cutoff);
        }

        return trends.map(t => ({
            date: t.date,
            runs: t.runs,
            successes: t.successes,
            failures: t.failures,
            avgDuration: Math.round(t.avg_duration || 0),
            successRate: t.runs > 0 ? +(t.successes / t.runs * 100).toFixed(2) : 0
        }));
    }

    /**
     * Get workflow-specific stats
     * @param {number} repoId
     * @param {number} workflowId
     * @param {number} [userId] - Tenant user ID (omit for unscoped)
     */
    getWorkflowStats(repoId, workflowId, userId) {
        let stats, recentRuns;

        if (userId !== undefined && userId !== null) {
            stats = db.prepare(`
                SELECT
                    workflow_name,
                    COUNT(*) as total_runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                    AVG(duration_seconds) as avg_duration,
                    MIN(duration_seconds) as min_duration,
                    MAX(duration_seconds) as max_duration
                FROM workflow_runs
                WHERE repo_id = ? AND workflow_id = ? AND user_id = ?
            `).get(repoId, workflowId, userId);

            recentRuns = db.prepare(`
                SELECT
                    run_number, status, conclusion, started_at,
                    completed_at, duration_seconds, branch, html_url
                FROM workflow_runs
                WHERE repo_id = ? AND workflow_id = ? AND user_id = ?
                ORDER BY started_at DESC
                LIMIT 20
            `).all(repoId, workflowId, userId);
        } else {
            stats = db.prepare(`
                SELECT
                    workflow_name,
                    COUNT(*) as total_runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                    AVG(duration_seconds) as avg_duration,
                    MIN(duration_seconds) as min_duration,
                    MAX(duration_seconds) as max_duration
                FROM workflow_runs
                WHERE repo_id = ? AND workflow_id = ?
            `).get(repoId, workflowId);

            recentRuns = db.prepare(`
                SELECT
                    run_number, status, conclusion, started_at,
                    completed_at, duration_seconds, branch, html_url
                FROM workflow_runs
                WHERE repo_id = ? AND workflow_id = ?
                ORDER BY started_at DESC
                LIMIT 20
            `).all(repoId, workflowId);
        }

        return {
            name: stats.workflow_name,
            totalRuns: stats.total_runs || 0,
            successCount: stats.success_count || 0,
            failureCount: stats.failure_count || 0,
            successRate: stats.total_runs > 0
                ? +((stats.success_count / stats.total_runs) * 100).toFixed(2)
                : 0,
            avgDuration: Math.round(stats.avg_duration || 0),
            minDuration: stats.min_duration || 0,
            maxDuration: stats.max_duration || 0,
            recentRuns
        };
    }

    /**
     * Get stats for multiple repos (team view)
     * @param {number[]} repoIds
     * @param {number} [days=30]
     * @param {number} [userId] - Tenant user ID (omit for unscoped)
     */
    getMultiRepoStats(repoIds, days = 30, userId) {
        if (!repoIds || repoIds.length === 0) return [];

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoff = cutoffDate.toISOString();

        const placeholders = repoIds.map(() => '?').join(',');
        let stats;

        if (userId !== undefined && userId !== null) {
            stats = db.prepare(`
                SELECT
                    repo_id,
                    COUNT(*) as total_runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                    AVG(duration_seconds) as avg_duration
                FROM workflow_runs
                WHERE repo_id IN (${placeholders}) AND user_id = ? AND started_at >= ?
                GROUP BY repo_id
            `).all(...repoIds, userId, cutoff);
        } else {
            stats = db.prepare(`
                SELECT
                    repo_id,
                    COUNT(*) as total_runs,
                    SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                    SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                    AVG(duration_seconds) as avg_duration
                FROM workflow_runs
                WHERE repo_id IN (${placeholders}) AND started_at >= ?
                GROUP BY repo_id
            `).all(...repoIds, cutoff);
        }

        return stats.map(s => ({
            repoId: s.repo_id,
            totalRuns: s.total_runs || 0,
            successCount: s.success_count || 0,
            failureCount: s.failure_count || 0,
            successRate: s.total_runs > 0
                ? +((s.success_count / s.total_runs) * 100).toFixed(2)
                : 0,
            avgDuration: Math.round(s.avg_duration || 0)
        }));
    }

    /**
     * Update workflow metadata after storing runs
     * @param {number} repoId
     * @param {number} workflowId
     * @param {number} [userId=0] - Tenant user ID for multi-tenancy
     */
    updateWorkflowMeta(repoId, workflowId, userId = 0) {
        const stats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as successes,
                SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failures,
                AVG(duration_seconds) as avg_duration,
                MAX(CASE WHEN conclusion = 'success' THEN started_at END) as last_success,
                MAX(CASE WHEN conclusion = 'failure' THEN started_at END) as last_failure,
                MAX(started_at) as last_run
            FROM workflow_runs
            WHERE repo_id = ? AND workflow_id = ? AND user_id = ?
        `).get(repoId, workflowId, userId);

        db.prepare(`
            INSERT INTO workflows_meta (
                repo_id, user_id, github_workflow_id, name, total_runs,
                success_count, failure_count, avg_duration_seconds,
                last_success_at, last_failure_at, last_run_at
            ) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(github_workflow_id) DO UPDATE SET
                total_runs = excluded.total_runs,
                success_count = excluded.success_count,
                failure_count = excluded.failure_count,
                avg_duration_seconds = excluded.avg_duration_seconds,
                last_success_at = excluded.last_success_at,
                last_failure_at = excluded.last_failure_at,
                last_run_at = excluded.last_run_at,
                updated_at = CURRENT_TIMESTAMP
        `).run(
            repoId,
            userId,
            workflowId,
            stats.total || 0,
            stats.successes || 0,
            stats.failures || 0,
            Math.round(stats.avg_duration || 0),
            stats.last_success,
            stats.last_failure,
            stats.last_run
        );
    }

    /**
     * Sync workflow runs from GitHub API
     * @param {string} repoFullName - e.g. "owner/repo"
     * @param {string} token - GitHub access token
     * @param {number} [userId=0] - Tenant user ID for multi-tenancy
     */
    async syncWorkflowRuns(repoFullName, token, userId = 0) {
        const [owner, repo] = repoFullName.split('/');

        try {
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status}`);
            }

            const data = await response.json();
            const runs = data.workflow_runs || [];

            // Store each run scoped by user
            runs.forEach(run => {
                this.storeWorkflowRun(run, userId);
                this.updateWorkflowMeta(run.repository.id, run.workflow_id, userId);
            });

            return { success: true, synced: runs.length };
        } catch (error) {
            logger.error({ err: error }, 'Workflow sync failed');
            return { success: false, error: error.message };
        }
    }
}

export const actionsService = new ActionsService();
