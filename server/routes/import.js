import express from 'express';
import * as importService from '../import-service.js';
import * as azureService from '../azure-service.js';
import db from '../db.js';
import { requireAuth, safeError, errorResponse } from '../middleware/auth.js';
import { githubApi } from '../lib/github-api.js';
import { safeJsonParse } from '../lib/utils.js';
import logger from '../lib/logger.js';
import { validate, importSchema } from '../lib/validators.js';

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
        const azurePat = azureService.resolvePat(bodyPat, req.session);

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
            try {
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
            } catch (dbErr) {
                logger.error({ err: dbErr, jobId }, 'Failed to update migration job status after import');
            }
        }).catch(err => {
            try {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?,
                    progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(err.message || 'Unknown error', err.message || 'Import failed unexpectedly', jobId);
            } catch (dbErr) {
                logger.error({ err: dbErr, jobId }, 'Failed to update migration job status after import error');
            }
        });

        res.status(201).json({ success: true, jobId, message: 'Import started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Request failed'));
    }
});

router.post('/import/url', requireAuth, validate(importSchema), async (req, res) => {
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
            try {
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
            } catch (dbErr) {
                logger.error({ err: dbErr, jobId }, 'Failed to update migration job status after URL import');
            }
        }).catch(err => {
            try {
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?,
                    progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(err.message || 'Unknown error', err.message || 'Import failed unexpectedly', jobId);
            } catch (dbErr) {
                logger.error({ err: dbErr, jobId }, 'Failed to update migration job status after URL import error');
            }
        });

        res.status(201).json({ success: true, jobId, message: 'Import started' });
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
// Migration stats summary for dashboard
// ------------------------------------------------------------------
router.get('/migrations/stats', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const total = db.prepare('SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ?').get(userId);
        const completed = db.prepare("SELECT COUNT(*) as count FROM migration_jobs WHERE user_id = ? AND status = 'complete'").get(userId);
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

// ------------------------------------------------------------------
// Batch Azure import — imports multiple repos with concurrency limit
// ------------------------------------------------------------------
router.post('/import/azure/batch', requireAuth, async (req, res) => {
    try {
        const { azureOrg, azureProject, azurePat: bodyPat, targetOrg, makePrivate, repos } = req.body;
        const azurePat = azureService.resolvePat(bodyPat, req.session);

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
            const { azureRepo, targetName } = repo;
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
// TFVC import — convert TFVC to Git via Azure DevOps, then push to GitHub
// ------------------------------------------------------------------
router.post('/import/azure-tfvc', requireAuth, async (req, res) => {
    try {
        const { azureOrg, azureProject, tfvcPath, azurePat: bodyPat, targetOrg, targetName, makePrivate, description, importHistory } = req.body;
        const azurePat = azureService.resolvePat(bodyPat, req.session);

        if (!azureOrg || !azureProject || !tfvcPath) {
            return errorResponse(res, 400, 'Azure organization, project, and TFVC path are required', 'MISSING_PARAMS');
        }
        if (!tfvcPath.startsWith('$/')) {
            return errorResponse(res, 400, 'TFVC path must start with $/', 'INVALID_PATH');
        }
        if (!azurePat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }

        const folderName = tfvcPath.split('/').pop() || azureProject;
        const repoName = importService.sanitizeRepoName(targetName || folderName);
        const owner = targetOrg || '';
        const safeUrl = `tfvc://${azureOrg}/${azureProject}${tfvcPath}`;
        const userId = req.session.userId;
        const sourceName = `${azureOrg}/${azureProject}/${folderName} (TFVC)`;

        // Atomic duplicate check + insert to prevent race conditions
        const createTfvcJob = db.transaction((safeUrl, userId, sourceName, owner, repoName) => {
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, userId);
            if (existing) return { duplicate: true, id: existing.id };

            const result = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, 'running', 'Starting TFVC conversion...')
            `).run(userId, 'azure-tfvc', safeUrl, sourceName, owner, repoName);
            return { duplicate: false, id: result.lastInsertRowid };
        });

        const jobResult = createTfvcJob(safeUrl, userId, sourceName, owner, repoName);
        if (jobResult.duplicate) {
            return errorResponse(res, 409, 'An import for this TFVC path is already in progress', 'DUPLICATE_IMPORT');
        }
        const jobId = Number(jobResult.id);

        // Run TFVC import asynchronously
        runTfvcImport({
            azureOrg, azureProject, tfvcPath, azurePat,
            targetOwner: owner || undefined,
            targetName: repoName,
            isPrivate: makePrivate !== false,
            description: description || `Imported from Azure DevOps TFVC: ${azureOrg}/${azureProject}${tfvcPath}`,
            githubToken: req.session.accessToken,
            importHistory: importHistory !== false,
            jobId
        });

        res.status(201).json({ success: true, jobId, message: 'TFVC import started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'TFVC import request failed'));
    }
});

// ------------------------------------------------------------------
// Batch TFVC import
// ------------------------------------------------------------------
router.post('/import/azure-tfvc/batch', requireAuth, async (req, res) => {
    try {
        const { azureOrg, azureProject, azurePat: bodyPat, targetOrg, makePrivate, items, importHistory } = req.body;
        const azurePat = azureService.resolvePat(bodyPat, req.session);

        if (!azureOrg || !azureProject || !Array.isArray(items) || items.length === 0) {
            return errorResponse(res, 400, 'Azure org, project, and items array are required', 'MISSING_PARAMS');
        }
        if (!azurePat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }
        if (items.length > 20) {
            return errorResponse(res, 400, 'Maximum 20 items per batch import', 'TOO_MANY_ITEMS');
        }

        const owner = targetOrg || '';
        const jobResults = [];

        for (const item of items) {
            const { tfvcPath, targetName: itemTargetName } = item;
            if (!tfvcPath || !tfvcPath.startsWith('$/')) continue;

            const folderName = tfvcPath.split('/').pop() || azureProject;
            const repoName = importService.sanitizeRepoName(itemTargetName || folderName);
            const safeUrl = `tfvc://${azureOrg}/${azureProject}${tfvcPath}`;
            const sourceName = `${azureOrg}/${azureProject}/${folderName} (TFVC)`;

            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, req.session.userId);

            if (existing) {
                jobResults.push({ tfvcPath, targetName: repoName, jobId: null, error: 'Import already in progress', skipped: true });
                continue;
            }

            const job = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', 'Queued for TFVC conversion...')
            `).run(req.session.userId, 'azure-tfvc', safeUrl, sourceName, owner, repoName);

            jobResults.push({
                tfvcPath,
                targetName: repoName,
                jobId: Number(job.lastInsertRowid),
                skipped: false
            });
        }

        // Run imports with concurrency limit of 2
        const CONCURRENCY = 2;
        const pendingJobs = jobResults.filter(j => !j.skipped && j.jobId);

        (async () => {
            const queue = [...pendingJobs];
            const active = new Set();

            while (queue.length > 0 || active.size > 0) {
                while (queue.length > 0 && active.size < CONCURRENCY) {
                    const jobInfo = queue.shift();
                    db.prepare(`UPDATE migration_jobs SET status = 'running', progress_message = 'Starting TFVC conversion...' WHERE id = ?`).run(jobInfo.jobId);

                    const promise = runTfvcImport({
                        azureOrg, azureProject, tfvcPath: jobInfo.tfvcPath, azurePat,
                        targetOwner: owner || undefined,
                        targetName: jobInfo.targetName,
                        isPrivate: makePrivate !== false,
                        description: `Imported from Azure DevOps TFVC: ${azureOrg}/${azureProject}${jobInfo.tfvcPath}`,
                        githubToken: req.session.accessToken,
                        importHistory: importHistory !== false,
                        jobId: jobInfo.jobId
                    }).finally(() => active.delete(promise));
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
                repoName: j.tfvcPath?.split('/').pop() || j.targetName,
                tfvcPath: j.tfvcPath,
                targetName: j.targetName,
                jobId: j.jobId,
                skipped: j.skipped,
                error: j.error || null
            }))
        });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Batch TFVC import failed'));
    }
});

/**
 * Run the full TFVC → Git → GitHub pipeline for a single path
 */
async function runTfvcImport(params) {
    const {
        azureOrg, azureProject, tfvcPath, azurePat,
        targetOwner, targetName, isPrivate, description,
        githubToken, importHistory, jobId
    } = params;

    let tempRepoId = null;

    const onProgress = (status, message, pct) => {
        updateJobProgress(status, message, pct, jobId);
    };

    try {
        // Phase 1: Create temp Git repo in Azure DevOps
        onProgress('running', 'Creating temporary Git repository in Azure DevOps...', 5);
        const tempRepoName = `_tfvc-import-${targetName}-${Date.now()}`;
        const tempRepo = await azureService.createGitRepo(azureOrg, azureProject, tempRepoName, azurePat);
        tempRepoId = tempRepo.id;

        // Phase 2: Trigger TFVC → Git conversion
        onProgress('running', 'Converting TFVC to Git in Azure DevOps...', 10);
        const importReq = await azureService.importTfvcToGit(azureOrg, azureProject, tempRepoId, tfvcPath, azurePat, importHistory);

        // Phase 3: Poll for conversion completion
        let conversionComplete = false;
        let pollAttempts = 0;
        const MAX_POLLS = 120; // 10 minutes at 5s intervals
        const POLL_INTERVAL = 5000;

        while (!conversionComplete && pollAttempts < MAX_POLLS) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            pollAttempts++;

            let status;
            try {
                status = await azureService.getImportStatus(azureOrg, azureProject, tempRepoId, importReq.importRequestId, azurePat);
            } catch (pollError) {
                if (pollError.status === 401 || pollError.status === 403) {
                    throw new Error('PAT expired or was revoked during TFVC conversion. The conversion may still be running in Azure DevOps — check manually.');
                }
                throw pollError;
            }
            const pct = Math.min(10 + Math.floor((pollAttempts / MAX_POLLS) * 30), 40);
            onProgress('running', `Converting TFVC to Git... (${status.status})`, pct);

            if (status.status === 'completed') {
                conversionComplete = true;
            } else if (status.status === 'failed' || status.status === 'abandoned') {
                throw new Error(`TFVC conversion failed: ${status.detailedStatus?.errorMessage || status.status}`);
            }
        }

        if (!conversionComplete) {
            throw new Error('TFVC conversion timed out after 10 minutes');
        }

        // Phase 4: Get clone URL of the converted repo
        onProgress('running', 'Cloning converted repository...', 45);
        const repoDetails = await azureService.getRepoDetails(azureOrg, azureProject, tempRepoName, azurePat);
        const sourceUrl = repoDetails.remoteUrl;

        if (!sourceUrl) {
            throw new Error('Could not obtain clone URL for converted repository');
        }

        // Phase 5: Use existing import pipeline to clone + push to GitHub
        const result = await importService.importRepository({
            sourceUrl,
            credentials: { type: 'pat', token: azurePat },
            targetOwner,
            targetName,
            isPrivate,
            description,
            githubToken,
            onProgress: (status, message, pct) => {
                // Remap progress: 45-95%
                const remappedPct = 45 + Math.floor((pct / 100) * 50);
                onProgress(status === 'complete' ? 'running' : status, message, remappedPct);
            }
        });

        if (!result.success) {
            throw new Error(result.error || 'Import to GitHub failed');
        }

        // Phase 6: Cleanup temp Azure DevOps repo
        onProgress('running', 'Cleaning up temporary resources...', 96);
        try {
            await azureService.deleteGitRepo(azureOrg, azureProject, tempRepoId, azurePat);
        } catch (e) {
            logger.warn({ err: e }, 'tfvc-import: Cleanup warning');
        }

        // Done
        db.prepare(`
            UPDATE migration_jobs SET status = 'complete', target_full_name = ?, progress_pct = 100,
            progress_message = 'TFVC import completed successfully!', completed_at = datetime('now'),
            metadata = ?
            WHERE id = ?
        `).run(
            result.targetFullName,
            JSON.stringify({
                versionControlType: 'Tfvc',
                tfvcPath,
                convertedViaImportRequest: true,
                branchCount: result.branchCount,
                hasLFS: result.hasLFS,
                repoUrl: result.repoUrl
            }),
            jobId
        );

    } catch (error) {
        logger.error({ err: error, jobId }, 'tfvc-import: Error');

        // Cleanup temp repo on failure
        if (tempRepoId) {
            try {
                await azureService.deleteGitRepo(azureOrg, azureProject, tempRepoId, azurePat);
            } catch (e) {
                logger.warn({ err: e }, 'tfvc-import: Cleanup on failure');
            }
        }

        // Try fallback: snapshot without history
        try {
            onProgress('running', 'Conversion failed, trying snapshot fallback (no history)...', 30);
            await runTfvcSnapshotFallback({
                azureOrg, azureProject, tfvcPath, azurePat,
                targetOwner, targetName, isPrivate, description,
                githubToken, jobId, onProgress
            });
        } catch (fallbackError) {
            db.prepare(`
                UPDATE migration_jobs SET status = 'failed', error_message = ?,
                progress_message = ?, completed_at = datetime('now')
                WHERE id = ?
            `).run(
                `TFVC import failed: ${error.message}. Fallback also failed: ${fallbackError.message}`,
                `Import failed: ${error.message}`,
                jobId
            );
        }
    }
}

/**
 * Fallback: Download TFVC as ZIP, create Git repo, push to GitHub (no history)
 */
async function runTfvcSnapshotFallback(params) {
    const {
        azureOrg, azureProject, tfvcPath, azurePat,
        targetOwner, targetName, isPrivate, description,
        githubToken, jobId, onProgress
    } = params;

    const { simpleGit } = await import('simple-git');
    const { mkdirSync, existsSync, rmSync, writeFileSync } = await import('fs');
    const { join } = await import('path');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const tmpDir = join(__dirname, '..', 'data', 'tmp', `tfvc-snapshot-${Date.now()}`);

    const MAX_ZIP_SIZE = 1024 * 1024 * 1024; // 1 GB limit

    try {
        // Download TFVC content as ZIP
        onProgress('running', 'Downloading TFVC files...', 35);
        const zipBuffer = await azureService.downloadTfvcItems(azureOrg, azureProject, tfvcPath, azurePat);

        if (zipBuffer.length === 0) {
            throw new Error('TFVC path contains no files to migrate. Check that the path exists and has content.');
        }
        if (zipBuffer.length > MAX_ZIP_SIZE) {
            throw new Error(`TFVC content exceeds 1 GB limit (${(zipBuffer.length / 1024 / 1024).toFixed(0)} MB). Try migrating a smaller scope.`);
        }

        // Extract ZIP
        onProgress('running', 'Extracting files...', 45);
        mkdirSync(tmpDir, { recursive: true });
        const zipPath = join(tmpDir, 'tfvc-content.zip');
        writeFileSync(zipPath, zipBuffer);

        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(zipPath);
        const extractDir = join(tmpDir, 'content');
        mkdirSync(extractDir, { recursive: true });
        zip.extractAllTo(extractDir, true);

        // Initialize Git repo
        onProgress('running', 'Creating Git repository from TFVC snapshot...', 55);
        const git = simpleGit(extractDir);
        await git.init();
        await git.add('.');
        await git.commit(`Initial commit: imported from Azure DevOps TFVC\n\nSource: ${azureOrg}/${azureProject}${tfvcPath}`);

        // Detect actual default branch name (may be 'main' or 'master' depending on git config)
        const branchSummary = await git.branchLocal();
        const defaultBranch = branchSummary.current || 'main';

        // Create GitHub repo
        onProgress('running', 'Creating target repository on GitHub...', 65);
        const endpoint = targetOwner
            ? `https://api.github.com/orgs/${encodeURIComponent(targetOwner)}/repos`
            : 'https://api.github.com/user/repos';

        const createRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: targetName,
                description: description || `Imported from Azure DevOps TFVC: ${azureOrg}/${azureProject}${tfvcPath}`,
                private: isPrivate,
                auto_init: false
            })
        });

        if (!createRes.ok) {
            const err = await createRes.json().catch(() => null);
            throw new Error(err?.message || `Failed to create GitHub repository: ${createRes.status}`);
        }

        const createdRepo = await createRes.json();

        // Push to GitHub
        onProgress('running', 'Pushing to GitHub...', 80);
        const pushUrl = `https://x-access-token:${githubToken}@github.com/${createdRepo.full_name}.git`;
        await git.addRemote('origin', pushUrl);
        await git.push('origin', defaultBranch, ['--set-upstream']);

        db.prepare(`
            UPDATE migration_jobs SET status = 'complete', target_full_name = ?, progress_pct = 100,
            progress_message = 'TFVC snapshot import completed (no history).', completed_at = datetime('now'),
            metadata = ?
            WHERE id = ?
        `).run(
            createdRepo.full_name,
            JSON.stringify({
                versionControlType: 'Tfvc',
                tfvcPath,
                convertedViaImportRequest: false,
                snapshot: true,
                branchCount: 1,
                repoUrl: createdRepo.html_url
            }),
            jobId
        );

    } finally {
        try {
            if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            logger.warn({ err: e }, 'tfvc-snapshot: Cleanup warning');
        }
    }
}

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
