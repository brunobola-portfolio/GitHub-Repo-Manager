import express from 'express';
import * as importService from '../import-service.js';
import * as azureService from '../azure-service.js';
import db from '../db.js';
import { requireAuth, safeError, errorResponse } from '../middleware/auth.js';

const router = express.Router();

router.get('/import/git-status', requireAuth, async (req, res) => {
    try {
        const result = await importService.checkGitInstalled();
        res.json(result);
    } catch (error) {
        res.json({ installed: false, error: 'Git is not available or failed to respond' });
    }
});

router.post('/import/validate-url', requireAuth, async (req, res) => {
    try {
        const { url, credentials } = req.body;
        if (!url) {
            return errorResponse(res, 400, 'URL is required', 'MISSING_URL');
        }
        const result = await importService.validateSourceUrl(url, credentials);
        res.json(result);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

router.post('/import/azure', requireAuth, async (req, res) => {
    try {
        const { azureOrg, azureProject, azureRepo, azurePat, targetOrg, targetName, makePrivate, description } = req.body;

        if (!azureOrg || !azureProject || !azureRepo || !azurePat) {
            return errorResponse(res, 400, 'Azure organization, project, repository, and PAT are required', 'MISSING_PARAMS');
        }

        // Get Azure repo details to get clone URL
        const repoDetails = await azureService.getRepoDetails(azureOrg, azureProject, azureRepo, azurePat);
        const sourceUrl = repoDetails.remoteUrl;

        if (!sourceUrl) {
            return errorResponse(res, 400, 'Could not obtain clone URL from Azure DevOps', 'MISSING_CLONE_URL');
        }

        const repoName = importService.sanitizeRepoName(targetName || azureRepo);
        const owner = targetOrg || '';

        // Create migration job in DB
        const job = db.prepare(`
            INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
            VALUES (?, ?, ?, ?, ?, ?, 'running', 'Starting import...')
        `).run(
            req.session.userId,
            'azure',
            importService.safeUrl(sourceUrl),
            `${azureOrg}/${azureProject}/${azureRepo}`,
            owner,
            repoName
        );
        const jobId = job.lastInsertRowid;

        // Run import asynchronously
        importService.importRepository({
            sourceUrl,
            credentials: { type: 'pat', token: azurePat },
            targetOwner: owner || undefined,
            targetName: repoName,
            isPrivate: makePrivate !== false,
            description: description || `Imported from Azure DevOps: ${azureOrg}/${azureProject}/${azureRepo}`,
            githubToken: req.session.accessToken,
            onProgress: (status, message, pct) => {
                db.prepare(`
                    UPDATE migration_jobs SET status = ?, progress_message = ?, progress_pct = ?
                    WHERE id = ?
                `).run(
                    status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'running',
                    message, pct, jobId
                );

                if (status === 'complete' || status === 'failed') {
                    db.prepare(`UPDATE migration_jobs SET completed_at = datetime('now') WHERE id = ?`).run(jobId);
                }
            }
        }).then(result => {
            if (result.success) {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'complete', target_full_name = ?, progress_pct = 100,
                    progress_message = 'Import completed successfully!', completed_at = datetime('now'),
                    metadata = ?
                    WHERE id = ?
                `).run(
                    result.targetFullName,
                    JSON.stringify({ branchCount: result.branchCount, hasLFS: result.hasLFS, repoUrl: result.repoUrl }),
                    jobId
                );
            } else {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?,
                    progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(result.error, result.error, jobId);
            }
        });

        res.json({ success: true, jobId, message: 'Import started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Request failed'));
    }
});

router.post('/import/url', requireAuth, async (req, res) => {
    try {
        const { sourceUrl, credentials, targetOrg, targetName, makePrivate, description } = req.body;

        if (!sourceUrl) {
            return errorResponse(res, 400, 'Source URL is required', 'MISSING_URL');
        }

        // Extract repo name from URL if not provided
        const urlParts = sourceUrl.replace(/\.git$/, '').split('/');
        const inferredName = urlParts[urlParts.length - 1] || 'imported-repo';
        const repoName = importService.sanitizeRepoName(targetName || inferredName);
        const owner = targetOrg || '';

        // Create migration job
        const job = db.prepare(`
            INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
            VALUES (?, ?, ?, ?, ?, ?, 'running', 'Starting import...')
        `).run(
            req.session.userId,
            'url',
            importService.safeUrl(sourceUrl),
            inferredName,
            owner,
            repoName
        );
        const jobId = job.lastInsertRowid;

        // Run import asynchronously
        importService.importRepository({
            sourceUrl,
            credentials: credentials || undefined,
            targetOwner: owner || undefined,
            targetName: repoName,
            isPrivate: makePrivate !== false,
            description,
            githubToken: req.session.accessToken,
            onProgress: (status, message, pct) => {
                db.prepare(`
                    UPDATE migration_jobs SET status = ?, progress_message = ?, progress_pct = ?
                    WHERE id = ?
                `).run(
                    status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'running',
                    message, pct, jobId
                );
                if (status === 'complete' || status === 'failed') {
                    db.prepare(`UPDATE migration_jobs SET completed_at = datetime('now') WHERE id = ?`).run(jobId);
                }
            }
        }).then(result => {
            if (result.success) {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'complete', target_full_name = ?, progress_pct = 100,
                    progress_message = 'Import completed successfully!', completed_at = datetime('now'),
                    metadata = ?
                    WHERE id = ?
                `).run(
                    result.targetFullName,
                    JSON.stringify({ branchCount: result.branchCount, hasLFS: result.hasLFS, repoUrl: result.repoUrl }),
                    jobId
                );
            } else {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?,
                    progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(result.error, result.error, jobId);
            }
        });

        res.json({ success: true, jobId, message: 'Import started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Request failed'));
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
            metadata: job.metadata ? JSON.parse(job.metadata) : null
        });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

router.get('/migrations', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = Math.min(parseInt(req.query.per_page) || 20, 100);
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
                metadata: j.metadata ? JSON.parse(j.metadata) : null
            })),
            total: total.count,
            page,
            totalPages: Math.ceil(total.count / perPage)
        });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

export default router;
