import express from 'express';
import * as importService from '../../import-service.js';
import db from '../../db.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import logger from '../../lib/logger.js';
import { importSchema } from '../../lib/validators.js';
import { validateBody } from '../../middleware/validate-request.js';
import { assertSafeExternalUrl } from '../../lib/url-validator.js';
import { updateJobProgress } from './_shared.js';

const router = express.Router();

router.post('/import/validate-url', requireAuth, async (req, res) => {
    try {
        const { url, credentials } = req.body;
        if (!url) {
            return errorResponse(res, 400, 'URL is required', 'MISSING_URL');
        }
        try {
            assertSafeExternalUrl(url);
        } catch (guardErr) {
            const reason = String(guardErr.message || '').replace(/^ssrf_guard:\s*/, '');
            return res.status(400).json({ code: 'invalid_source_url', error: reason });
        }
        const result = await importService.validateSourceUrl(url, credentials);
        res.json(result);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

router.post('/import/url', requireAuth, validateBody(importSchema), async (req, res) => {
    try {
        const { sourceUrl, credentials, targetOrg, targetName, makePrivate, description } = req.validatedBody;

        if (!sourceUrl) {
            return errorResponse(res, 400, 'Source URL is required', 'MISSING_URL');
        }

        // SSRF guard: reject internal / link-local / loopback / credential-embedded URLs
        // before we hand the string to git.
        try {
            assertSafeExternalUrl(sourceUrl);
        } catch (guardErr) {
            const reason = String(guardErr.message || '').replace(/^ssrf_guard:\s*/, '');
            return res.status(400).json({ code: 'invalid_source_url', error: reason });
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
                const safeMsg = safeError(err, 'Import failed unexpectedly');
                db.prepare(`
                    UPDATE migration_jobs SET status = 'failed', error_message = ?,
                    progress_message = ?, completed_at = datetime('now')
                    WHERE id = ?
                `).run(safeMsg, safeMsg, jobId);
            } catch (dbErr) {
                logger.error({ err: dbErr, jobId }, 'Failed to update migration job status after URL import error');
            }
        });

        res.status(201).json({ success: true, jobId, message: 'Import started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Request failed'));
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
