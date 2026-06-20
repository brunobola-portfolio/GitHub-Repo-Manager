import express from 'express';
import * as importService from '../../../import-service.js';
import * as azureService from '../../../azure-service.js';
import db from '../../../db.js';
import { requireAuth, safeError, errorResponse } from '../../../middleware/auth.js';
import logger from '../../../lib/logger.js';
import { updateJobProgress } from '../_shared.js';
import { assertSafeExternalUrl, resolveAndValidateHost } from '../../../lib/url-validator.js';
import { validateBody } from '../../../middleware/validate-request.js';
import { azureImportSchema, azureImportBatchSchema } from '../../../lib/validators.js';

const router = express.Router();

// Azure-supplied clone URLs are not implicitly safe — Azure orgs the user
// controls (or compromises) can return remoteUrl values that target internal
// addresses. Run the same SSRF + DNS-rebinding pair we use on the public
// /import/url path so neither vector reaches `git clone`.
async function ensureSafeAzureClone(sourceUrl, res) {
    try {
        assertSafeExternalUrl(sourceUrl);
    } catch (guardErr) {
        const reason = String(guardErr.message || '').replace(/^ssrf_guard:\s*/, '');
        res.status(400).json({ code: 'invalid_source_url', error: reason });
        return false;
    }
    const dnsOk = await resolveAndValidateHost(sourceUrl);
    if (!dnsOk) {
        res.status(400).json({ code: 'invalid_source_url', error: 'Hostname resolves to a non-public address' });
        return false;
    }
    return true;
}

router.post('/import/azure', requireAuth, validateBody(azureImportSchema), async (req, res) => {
    try {
        const { azureOrg, azureProject, azureRepo, azurePat: bodyPat, targetOrg, targetName, makePrivate, isPrivate, description } = req.validatedBody;
        const azurePat = azureService.resolvePat(bodyPat, req.session);

        if (!azurePat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }

        // Get Azure repo details to get clone URL
        const repoDetails = await azureService.getRepoDetails(azureOrg, azureProject, azureRepo, azurePat);
        const sourceUrl = repoDetails.remoteUrl;

        if (!sourceUrl) {
            return errorResponse(res, 400, 'Could not obtain clone URL from Azure DevOps', 'MISSING_CLONE_URL');
        }
        if (!(await ensureSafeAzureClone(sourceUrl, res))) return;

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

        const wantsPrivate = makePrivate ?? isPrivate ?? true;

        // Run import asynchronously
        importService.importRepository({
            sourceUrl,
            credentials: { type: 'pat', token: azurePat },
            targetOwner: owner || undefined,
            targetName: repoName,
            isPrivate: wantsPrivate,
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
                // Sanitise the error message before persisting — upstream git
                // / Azure failures may embed internal hostnames, temp paths,
                // or credential URIs. Surfacing them later via
                // /import/status/:id would be an information leak.
                const safeMsg = safeError(err, 'Import failed unexpectedly');
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?,
                    progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(safeMsg, safeMsg, jobId);
            } catch (dbErr) {
                logger.error({ err: dbErr, jobId }, 'Failed to update migration job status after import error');
            }
        });

        res.status(201).json({ success: true, jobId, message: 'Import started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Request failed'));
    }
});

// ------------------------------------------------------------------
// Batch Azure import — imports multiple repos with concurrency limit
// ------------------------------------------------------------------
router.post('/import/azure/batch', requireAuth, validateBody(azureImportBatchSchema), async (req, res) => {
    try {
        const { azureOrg, azureProject, azurePat: bodyPat, targetOrg, makePrivate, repos } = req.validatedBody;
        const azurePat = azureService.resolvePat(bodyPat, req.session);

        if (!azurePat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
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
            // Per-repo SSRF + DNS-rebinding guard: an Azure org we don't trust
            // could return a clone URL pointing at an internal address.
            try {
                assertSafeExternalUrl(sourceUrl);
                if (!(await resolveAndValidateHost(sourceUrl))) {
                    jobResults.push({ repoName: azureRepo, targetName: repoName, jobId: null, error: 'Clone URL resolves to a non-public address', skipped: true });
                    continue;
                }
            } catch (guardErr) {
                const reason = String(guardErr.message || '').replace(/^ssrf_guard:\s*/, '');
                jobResults.push({ repoName: azureRepo, targetName: repoName, jobId: null, error: reason, skipped: true });
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
                const safeMsg = safeError(err, 'Import failed');
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?, progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(safeMsg, safeMsg, jobId);
            }
        };

        // Concurrent execution with queue — fire and forget, but with an error
        // boundary so an orchestrator/DB failure can't leave jobs stuck in
        // 'pending'/'running' forever (and can't surface as an unhandled rejection).
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
        })().catch((err) => {
            logger.error({ err }, 'Azure git batch-import queue crashed');
            try {
                const ids = pendingJobs.map((j) => j.jobId);
                if (ids.length) {
                    const placeholders = ids.map(() => '?').join(',');
                    db.prepare(
                        `UPDATE migration_jobs SET status = 'failed', error_message = 'Batch import queue crashed', completed_at = datetime('now') WHERE id IN (${placeholders}) AND status IN ('pending', 'running')`,
                    ).run(...ids);
                }
            } catch (markErr) {
                logger.error({ err: markErr }, 'Failed to mark stuck jobs after queue crash');
            }
        });

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

export default router;
