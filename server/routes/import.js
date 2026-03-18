import express from 'express';
import * as importService from '../import-service.js';
import * as azureService from '../azure-service.js';
import db from '../db.js';
import { requireAuth, safeError, errorResponse } from '../middleware/auth.js';
import { githubApi } from '../lib/github-api.js';
import { safeJsonParse } from '../lib/utils.js';

const router = express.Router();

const updateJobProgress = db.transaction((status, message, pct, jobId) => {
    const dbStatus = status === 'complete' ? 'complete' : status === 'failed' ? 'failed' : 'running';
    db.prepare(`
        UPDATE migration_jobs SET status = ?, progress_message = ?, progress_pct = ?
        WHERE id = ?
    `).run(dbStatus, message, pct, jobId);

    if (status === 'complete' || status === 'failed') {
        db.prepare(`UPDATE migration_jobs SET completed_at = datetime('now') WHERE id = ?`).run(jobId);
    }
});

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
        const { azureOrg, azureProject, azureRepo, azurePat: bodyPat, targetOrg, targetName, makePrivate, description } = req.body;
        const azurePat = azureService.resolvePat(bodyPat);

        if (!azureOrg || !azureProject || !azureRepo) {
            return errorResponse(res, 400, 'Azure organization, project, and repository are required', 'MISSING_PARAMS');
        }
        if (!azurePat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }

        // Get Azure repo details to get clone URL
        const repoDetails = await azureService.getRepoDetails(azureOrg, azureProject, azureRepo, azurePat);
        const sourceUrl = repoDetails.remoteUrl;

        if (!sourceUrl) {
            return errorResponse(res, 400, 'Could not obtain clone URL from Azure DevOps', 'MISSING_CLONE_URL');
        }

        const repoName = importService.sanitizeRepoName(targetName || azureRepo);
        const owner = targetOrg || '';
        const safeUrl = importService.safeUrl(sourceUrl);
        const userId = req.session.userId;
        const sourceName = `${azureOrg}/${azureProject}/${azureRepo}`;

        // Atomic duplicate check + insert to prevent race conditions
        const createAzureJob = db.transaction((safeUrl, userId, sourceName, owner, repoName) => {
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, userId);
            if (existing) return { duplicate: true, id: existing.id };

            const result = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, 'running', 'Starting import...')
            `).run(userId, 'azure', safeUrl, sourceName, owner, repoName);
            return { duplicate: false, id: result.lastInsertRowid };
        });

        const jobResult = createAzureJob(safeUrl, userId, sourceName, owner, repoName);
        if (jobResult.duplicate) {
            return errorResponse(res, 409, 'An import for this repository is already in progress', 'DUPLICATE_IMPORT');
        }
        const jobId = jobResult.id;

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
                updateJobProgress(status, message, pct, jobId);
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
        }).catch(err => {
            db.prepare(`
                UPDATE migration_jobs SET status = 'failed', error_message = ?,
                progress_message = ?, completed_at = datetime('now')
                WHERE id = ?
            `).run(err.message || 'Unknown error', err.message || 'Import failed unexpectedly', jobId);
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
        const safeUrl = importService.safeUrl(sourceUrl);
        const userId = req.session.userId;

        // Atomic duplicate check + insert to prevent race conditions
        const createUrlJob = db.transaction((safeUrl, userId, inferredName, owner, repoName) => {
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, userId);
            if (existing) return { duplicate: true, id: existing.id };

            const result = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, 'running', 'Starting import...')
            `).run(userId, 'url', safeUrl, inferredName, owner, repoName);
            return { duplicate: false, id: result.lastInsertRowid };
        });

        const jobResult = createUrlJob(safeUrl, userId, inferredName, owner, repoName);
        if (jobResult.duplicate) {
            return errorResponse(res, 409, 'An import for this repository is already in progress', 'DUPLICATE_IMPORT');
        }
        const jobId = jobResult.id;

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
                updateJobProgress(status, message, pct, jobId);
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
        }).catch(err => {
            db.prepare(`
                UPDATE migration_jobs SET status = 'failed', error_message = ?,
                progress_message = ?, completed_at = datetime('now')
                WHERE id = ?
            `).run(err.message || 'Unknown error', err.message || 'Import failed unexpectedly', jobId);
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
// Batch Azure import — imports multiple repos with concurrency limit
// ------------------------------------------------------------------
router.post('/import/azure/batch', requireAuth, async (req, res) => {
    try {
        const { azureOrg, azureProject, azurePat: bodyPat, targetOrg, makePrivate, repos } = req.body;
        const azurePat = azureService.resolvePat(bodyPat);

        if (!azureOrg || !azureProject || !Array.isArray(repos) || repos.length === 0) {
            return errorResponse(res, 400, 'Azure org, project, and repos array are required', 'MISSING_PARAMS');
        }
        if (!azurePat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }
        if (repos.length > 20) {
            return errorResponse(res, 400, 'Maximum 20 repos per batch import', 'TOO_MANY_REPOS');
        }

        const owner = targetOrg || '';
        const jobResults = [];

        for (const repo of repos) {
            const { azureRepo, targetName, description: repoDesc } = repo;
            if (!azureRepo) continue;

            const repoName = importService.sanitizeRepoName(targetName || azureRepo);

            // Check for duplicate in-progress import
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_name = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(`${azureOrg}/${azureProject}/${azureRepo}`, req.session.userId);

            if (existing) {
                jobResults.push({ repoName: azureRepo, targetName: repoName, jobId: null, error: 'Import already in progress', skipped: true });
                continue;
            }

            // Get repo details for clone URL
            let repoDetails;
            try {
                repoDetails = await azureService.getRepoDetails(azureOrg, azureProject, azureRepo, azurePat);
            } catch (e) {
                jobResults.push({ repoName: azureRepo, targetName: repoName, jobId: null, error: `Could not get repo details: ${e.message}`, skipped: true });
                continue;
            }

            const sourceUrl = repoDetails.remoteUrl;
            if (!sourceUrl) {
                jobResults.push({ repoName: azureRepo, targetName: repoName, jobId: null, error: 'No clone URL available', skipped: true });
                continue;
            }

            // Create job with 'pending' status (will be changed to 'running' when it starts)
            const job = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', 'Queued for import...')
            `).run(
                req.session.userId, 'azure', importService.safeUrl(sourceUrl),
                `${azureOrg}/${azureProject}/${azureRepo}`, owner, repoName
            );

            jobResults.push({
                repoName: azureRepo,
                targetName: repoName,
                jobId: Number(job.lastInsertRowid),
                sourceUrl,
                skipped: false
            });
        }

        // Run imports with concurrency limit of 2 — fire and forget
        const CONCURRENCY = 2;
        const pendingJobs = jobResults.filter(j => !j.skipped && j.jobId);

        const runImport = async (jobInfo) => {
            const { jobId, sourceUrl, repoName, targetName } = jobInfo;

            db.prepare(`UPDATE migration_jobs SET status = 'running', progress_message = 'Starting import...' WHERE id = ?`).run(jobId);

            try {
                const result = await importService.importRepository({
                    sourceUrl,
                    credentials: { type: 'pat', token: azurePat },
                    targetOwner: owner || undefined,
                    targetName,
                    isPrivate: makePrivate !== false,
                    description: `Imported from Azure DevOps: ${azureOrg}/${azureProject}/${repoName}`,
                    githubToken: req.session.accessToken,
                    onProgress: (status, message, pct) => {
                        updateJobProgress(status, message, pct, jobId);
                    }
                });

                if (result.success) {
                    db.prepare(`
                        UPDATE migration_jobs SET status = 'complete', target_full_name = ?, progress_pct = 100,
                        progress_message = 'Import completed!', completed_at = datetime('now'), metadata = ?
                        WHERE id = ?
                    `).run(result.targetFullName, JSON.stringify({ branchCount: result.branchCount, hasLFS: result.hasLFS, repoUrl: result.repoUrl }), jobId);
                } else {
                    db.prepare(`
                        UPDATE migration_jobs SET status = 'failed', error_message = ?, progress_message = ?, completed_at = datetime('now')
                        WHERE id = ?
                    `).run(result.error, result.error, jobId);
                }
            } catch (err) {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?, progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(err.message || 'Unknown error', err.message || 'Import failed', jobId);
            }
        };

        // Concurrent execution with queue
        (async () => {
            const queue = [...pendingJobs];
            const active = new Set();

            while (queue.length > 0 || active.size > 0) {
                while (queue.length > 0 && active.size < CONCURRENCY) {
                    const job = queue.shift();
                    const promise = runImport(job).finally(() => active.delete(promise));
                    active.add(promise);
                }
                if (active.size > 0) {
                    await Promise.race(active);
                }
            }
        })();

        res.json({
            success: true,
            jobs: jobResults.map(j => ({
                repoName: j.repoName,
                targetName: j.targetName,
                jobId: j.jobId,
                skipped: j.skipped,
                error: j.error || null
            }))
        });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Batch import failed'));
    }
});

// ------------------------------------------------------------------
// Check if repos already exist on GitHub target
// ------------------------------------------------------------------
router.post('/import/check-duplicates', requireAuth, async (req, res) => {
    try {
        const { repos, targetOwner } = req.body;
        if (!Array.isArray(repos) || repos.length === 0) {
            return errorResponse(res, 400, 'Repos array is required', 'MISSING_REPOS');
        }
        if (!targetOwner) {
            return errorResponse(res, 400, 'Target owner is required', 'MISSING_OWNER');
        }

        const token = req.session.accessToken;
        const duplicates = {};

        await Promise.all(repos.map(async (repoName) => {
            try {
                await githubApi(`/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(repoName)}`, token);
                duplicates[repoName] = true;
            } catch {
                duplicates[repoName] = false;
            }
        }));

        res.json({ duplicates });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Duplicate check failed'));
    }
});

export default router;
