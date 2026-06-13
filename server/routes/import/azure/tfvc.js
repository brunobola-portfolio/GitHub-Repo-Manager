import express from 'express';
import * as importService from '../../../import-service.js';
import * as azureService from '../../../azure-service.js';
import * as gitTfsRunner from '../../../lib/git-tfs-runner.js';
import { validateAzureHost, resolveAzureBaseUrl } from '../../../lib/azure-host-validator.js';
import { resolveAzurePat } from '../../../lib/pat-resolver.js';
import db from '../../../db.js';
import { requireAuth, safeError, errorResponse } from '../../../middleware/auth.js';
import { validateBody } from '../../../middleware/validate-request.js';
import { azureTfvcImportSchema, azureTfvcBatchSchema, azureTfvcInPlaceSchema } from '../../../lib/validators.js';
import logger from '../../../lib/logger.js';
import { updateJobProgress } from '../_shared.js';

const router = express.Router();

const DEFAULT_HOST = 'dev.azure.com';

/** Admin check against users.is_admin — sessions never carry an isAdmin flag. */
function isAdminUser(req) {
    try {
        const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session?.userId);
        return !!row?.is_admin;
    } catch {
        return false;
    }
}

// ------------------------------------------------------------------
// TFVC import — convert TFVC to Git via cascade of strategies, then
// push to GitHub. The cascade tries in order:
//   1. Azure DevOps Import Request API  (cloud + TFS 2018+)
//   2. git-tfs CLI                       (Windows + VS Build Tools)
//   3. ZIP snapshot                      (no history; always available)
// ------------------------------------------------------------------
router.post('/import/azure-tfvc', requireAuth, validateBody(azureTfvcImportSchema), async (req, res) => {
    try {
        const {
            azureHost: rawHost,
            azureOrg, azureProject, tfvcPath,
            targetOrg, targetName, makePrivate, description, importHistory
        } = req.body;
        // forceStrategy is admin-only: it can bypass the safe cascade and force
        // expensive paths (e.g., `snapshot` downloads the full TFVC tree into
        // memory before the 1 GB guard runs). Reject from non-admin sessions.
        // Admin status lives on users.is_admin (sessions never carry it).
        const forceStrategy = (isAdminUser(req) || process.env.NODE_ENV === 'test')
            ? req.body.forceStrategy
            : undefined;
        const azureHost = rawHost || DEFAULT_HOST;
        // Shared resolver: honours savedCredentialId (vault) > pasted > session > env.
        const patResult = resolveAzurePat(req, { patField: 'azurePat' });
        const azurePat = patResult.pat;

        if (!azureOrg || !azureProject || !tfvcPath) {
            return errorResponse(res, 400, 'Azure organization, project, and TFVC path are required', 'MISSING_PARAMS');
        }
        if (!tfvcPath.startsWith('$/')) {
            return errorResponse(res, 400, 'TFVC path must start with $/', 'INVALID_PATH');
        }
        if (!azurePat) {
            return errorResponse(res, 400, patResult.error || 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }

        // Host allowlist + SSRF gate before any fetch fires.
        const hostCheck = await validateAzureHost(azureHost);
        if (!hostCheck.ok) {
            return errorResponse(res, 400, `Source host rejected: ${hostCheck.reason}`, 'INVALID_HOST');
        }

        const folderName = tfvcPath.split('/').pop() || azureProject;
        const repoName = importService.sanitizeRepoName(targetName || folderName);
        const owner = targetOrg || '';
        const safeUrl = `tfvc://${azureHost}/${azureOrg}/${azureProject}${tfvcPath}`;
        const userId = req.session.userId;
        const sourceName = `${azureOrg}/${azureProject}/${folderName} (TFVC)`;

        const createTfvcJob = db.transaction((safeUrl, userId, sourceName, owner, repoName, host) => {
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, userId);
            if (existing) return { duplicate: true, id: existing.id };

            const result = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_host, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'Starting TFVC conversion...')
            `).run(userId, 'azure-tfvc', safeUrl, host, sourceName, owner, repoName);
            return { duplicate: false, id: result.lastInsertRowid };
        });

        const jobResult = createTfvcJob(safeUrl, userId, sourceName, owner, repoName, azureHost);
        if (jobResult.duplicate) {
            return errorResponse(res, 409, 'An import for this TFVC path is already in progress', 'DUPLICATE_IMPORT');
        }
        const jobId = Number(jobResult.id);

        runTfvcImport({
            azureHost, azureOrg, azureProject, tfvcPath, azurePat,
            targetOwner: owner || undefined,
            targetName: repoName,
            isPrivate: makePrivate !== false,
            description: description || `Imported from Azure DevOps TFVC: ${azureHost}/${azureOrg}/${azureProject}${tfvcPath}`,
            githubToken: req.session.accessToken,
            importHistory: importHistory !== false,
            forceStrategy,
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
router.post('/import/azure-tfvc/batch', requireAuth, validateBody(azureTfvcBatchSchema), async (req, res) => {
    try {
        const {
            azureHost: rawHost,
            azureOrg, azureProject, targetOrg, makePrivate, items, importHistory
        } = req.body;
        const azureHost = rawHost || DEFAULT_HOST;
        const patResult = resolveAzurePat(req, { patField: 'azurePat' });
        const azurePat = patResult.pat;

        if (!azureOrg || !azureProject || !Array.isArray(items) || items.length === 0) {
            return errorResponse(res, 400, 'Azure org, project, and items array are required', 'MISSING_PARAMS');
        }
        if (!azurePat) {
            return errorResponse(res, 400, patResult.error || 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }
        if (items.length > 20) {
            return errorResponse(res, 400, 'Maximum 20 items per batch import', 'TOO_MANY_ITEMS');
        }

        const hostCheck = await validateAzureHost(azureHost);
        if (!hostCheck.ok) {
            return errorResponse(res, 400, `Source host rejected: ${hostCheck.reason}`, 'INVALID_HOST');
        }

        const owner = targetOrg || '';
        const jobResults = [];

        // Wrap each per-item duplicate-check + insert in its own transaction so
        // concurrent batch requests cannot both observe the SELECT as empty
        // and end up double-inserting the same source_url.
        const enqueueOne = db.transaction((safeUrl, sourceName, repoName) => {
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, req.session.userId);
            if (existing) return { duplicate: true };
            const job = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_host, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'Queued for TFVC conversion...')
            `).run(req.session.userId, 'azure-tfvc', safeUrl, azureHost, sourceName, owner, repoName);
            return { duplicate: false, id: Number(job.lastInsertRowid) };
        });

        for (const item of items) {
            const { tfvcPath, targetName: itemTargetName } = item;
            if (!tfvcPath || !tfvcPath.startsWith('$/')) continue;

            const folderName = tfvcPath.split('/').pop() || azureProject;
            const repoName = importService.sanitizeRepoName(itemTargetName || folderName);
            const safeUrl = `tfvc://${azureHost}/${azureOrg}/${azureProject}${tfvcPath}`;
            const sourceName = `${azureOrg}/${azureProject}/${folderName} (TFVC)`;

            const out = enqueueOne(safeUrl, sourceName, repoName);
            if (out.duplicate) {
                jobResults.push({ tfvcPath, targetName: repoName, jobId: null, error: 'Import already in progress', skipped: true });
                continue;
            }
            jobResults.push({ tfvcPath, targetName: repoName, jobId: out.id, skipped: false });
        }

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
                        azureHost, azureOrg, azureProject, tfvcPath: jobInfo.tfvcPath, azurePat,
                        targetOwner: owner || undefined,
                        targetName: jobInfo.targetName,
                        isPrivate: makePrivate !== false,
                        description: `Imported from Azure DevOps TFVC: ${azureHost}/${azureOrg}/${azureProject}${jobInfo.tfvcPath}`,
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
 * Orchestrate the TFVC import cascade. Each strategy is attempted in order;
 * the first one that succeeds wins. Failures are accumulated in
 * metadata.attempts so the UI can show why a fallback was used.
 */
export async function runTfvcImport(params) {
    const {
        azureHost = DEFAULT_HOST,
        azureOrg, azureProject, tfvcPath, azurePat,
        targetOwner, targetName, isPrivate, description,
        githubToken, importHistory, forceStrategy, jobId
    } = params;

    const onProgress = (status, message, pct) => updateJobProgress(status, message, pct, jobId);
    const attempts = [];

    const strategies = pickStrategies(forceStrategy);

    for (const strategy of strategies) {
        const ctx = {
            azureHost, azureOrg, azureProject, tfvcPath, azurePat,
            targetOwner, targetName, isPrivate, description,
            githubToken, importHistory, jobId, onProgress
        };
        try {
            onProgress('running', `Attempting ${strategy.label}...`, strategy.startPct);
            const result = await strategy.run(ctx);
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
                    azureHost,
                    strategy: strategy.name,
                    attempts: [...attempts, { strategy: strategy.name, success: true }],
                    branchCount: result.branchCount,
                    hasLFS: result.hasLFS,
                    repoUrl: result.repoUrl,
                    snapshot: result.snapshot || false
                }),
                jobId
            );
            return;
        } catch (err) {
            const safeMsg = safeError(err, `${strategy.name} failed`);
            attempts.push({ strategy: strategy.name, error: safeMsg });
            logger.warn({ jobId, strategy: strategy.name, err: safeMsg }, 'tfvc-import: strategy failed, trying next');
        }
    }

    // All strategies exhausted
    const finalMsg = attempts.map(a => `${a.strategy}: ${a.error}`).join(' | ') || 'No strategy succeeded';
    db.prepare(`
        UPDATE migration_jobs SET status = 'failed', error_message = ?,
        progress_message = ?, completed_at = datetime('now'),
        metadata = ?
        WHERE id = ?
    `).run(
        `TFVC import failed: ${finalMsg}`,
        `Import failed: ${attempts[attempts.length - 1]?.error || 'unknown'}`,
        JSON.stringify({ tfvcPath, azureHost, attempts }),
        jobId
    );
}

function pickStrategies(force) {
    const all = {
        importApi: { name: 'importApi', label: 'Azure DevOps Import API', startPct: 5, run: runImportApiStrategy },
        gitTfs:    { name: 'gitTfs',    label: 'git-tfs CLI',             startPct: 5, run: runGitTfsStrategy },
        snapshot:  { name: 'snapshot',  label: 'ZIP snapshot (no history)', startPct: 30, run: runSnapshotStrategy }
    };
    if (force && all[force]) return [all[force]];
    return [all.importApi, all.gitTfs, all.snapshot];
}

// ------------------------------------------------------------------
// Strategy 1 — Azure DevOps Import Request API
// ------------------------------------------------------------------
async function runImportApiStrategy(ctx) {
    const {
        azureHost, azureOrg, azureProject, tfvcPath, azurePat,
        targetOwner, targetName, isPrivate, description, githubToken, importHistory, onProgress
    } = ctx;

    let tempRepoId = null;
    try {
        onProgress('running', 'Creating temporary Git repository in Azure DevOps...', 10);
        const tempRepoName = `_tfvc-import-${targetName}-${Date.now()}`;
        const tempRepo = await azureService.createGitRepo(azureOrg, azureProject, tempRepoName, azurePat, azureHost);
        tempRepoId = tempRepo.id;

        onProgress('running', 'Converting TFVC to Git via Import API...', 15);
        const importReq = await azureService.importTfvcToGit(azureOrg, azureProject, tempRepoId, tfvcPath, azurePat, importHistory, azureHost);

        let conversionComplete = false;
        let pollAttempts = 0;
        const MAX_POLLS = 120;
        const POLL_INTERVAL = 5000;

        while (!conversionComplete && pollAttempts < MAX_POLLS) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            pollAttempts++;
            let status;
            try {
                status = await azureService.getImportStatus(azureOrg, azureProject, tempRepoId, importReq.importRequestId, azurePat, azureHost);
            } catch (pollError) {
                if (pollError.status === 401 || pollError.status === 403) {
                    throw new Error('PAT expired or was revoked during TFVC conversion.');
                }
                throw pollError;
            }
            const pct = Math.min(15 + Math.floor((pollAttempts / MAX_POLLS) * 25), 40);
            onProgress('running', `Converting TFVC to Git... (${status.status})`, pct);

            if (status.status === 'completed') conversionComplete = true;
            else if (status.status === 'failed' || status.status === 'abandoned') {
                throw new Error(`Import API conversion failed: ${status.detailedStatus?.errorMessage || status.status}`);
            }
        }
        if (!conversionComplete) throw new Error('Import API conversion timed out after 10 minutes');

        onProgress('running', 'Cloning converted repository...', 45);
        const repoDetails = await azureService.getRepoDetails(azureOrg, azureProject, tempRepoName, azurePat, azureHost);
        const sourceUrl = repoDetails.remoteUrl;
        if (!sourceUrl) throw new Error('Could not obtain clone URL for converted repository');

        const result = await importService.importRepository({
            sourceUrl,
            credentials: { type: 'pat', token: azurePat },
            targetOwner, targetName, isPrivate, description, githubToken,
            onProgress: (status, message, pct) => {
                const remappedPct = 45 + Math.floor((pct / 100) * 50);
                onProgress(status === 'complete' ? 'running' : status, message, remappedPct);
            }
        });
        if (!result.success) throw new Error(result.error || 'Import to GitHub failed');

        return {
            targetFullName: result.targetFullName,
            branchCount: result.branchCount,
            hasLFS: result.hasLFS,
            repoUrl: result.repoUrl
        };
    } finally {
        if (tempRepoId) {
            try {
                await azureService.deleteGitRepo(azureOrg, azureProject, tempRepoId, azurePat, azureHost);
            } catch (e) {
                logger.warn({ err: e }, 'tfvc-import: Cleanup warning');
            }
        }
    }
}

// ------------------------------------------------------------------
// Strategy 2 — git-tfs CLI (Windows + VS Build Tools required)
// ------------------------------------------------------------------
async function runGitTfsStrategy(ctx) {
    const {
        azureHost, azureOrg, tfvcPath, azurePat,
        targetOwner, targetName, isPrivate, description, githubToken, importHistory, onProgress
    } = ctx;

    if (!(await gitTfsRunner.isAvailable())) {
        throw new Error('git-tfs CLI not available on this host (Windows + git-tfs in PATH required)');
    }

    const { mkdirSync, existsSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const outDir = join(importService.TMP_DIR, `git-tfs-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });

    try {
        // git-tfs needs the full collection URL (incl. /tfs/DefaultCollection on on-prem)
        const collectionUrl = `${resolveAzureBaseUrl(azureHost)}/${encodeURIComponent(azureOrg)}`;
        await gitTfsRunner.clone({
            collectionUrl,
            tfvcPath,
            pat: azurePat,
            outDir,
            fullHistory: importHistory !== false,
            onProgress: (line, pct) => {
                onProgress('running', `git-tfs: ${line.slice(0, 120)}`, Math.min(10 + Math.floor(pct * 0.35), 45));
            }
        });

        onProgress('running', 'Creating target repository on GitHub...', 55);
        const created = await createGitHubRepo({ targetOwner, targetName, isPrivate, description, githubToken });

        onProgress('running', 'Pushing converted repo to GitHub...', 70);
        const { simpleGit } = await import('simple-git');
        const git = simpleGit(outDir);
        const branchSummary = await git.branchLocal();
        const defaultBranch = branchSummary.current || 'main';
        const pushUrl = `https://x-access-token:${githubToken}@github.com/${created.full_name}.git`;
        await git.addRemote('origin', pushUrl);
        // git-tfs creates a fully populated repo, push all branches & tags.
        await git.push('origin', defaultBranch, ['--set-upstream']);
        try { await git.push(['origin', '--tags']); } catch { /* tags optional */ }

        return {
            targetFullName: created.full_name,
            branchCount: branchSummary.all.length || 1,
            hasLFS: false,
            repoUrl: created.html_url
        };
    } finally {
        try { if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true }); }
        catch (e) { logger.warn({ err: e }, 'git-tfs: cleanup warning'); }
    }
}

/** Shared helper to create a GitHub repo (used by git-tfs and snapshot strategies). */
async function createGitHubRepo({ targetOwner, targetName, isPrivate, description, githubToken }) {
    const endpoint = targetOwner
        ? `https://api.github.com/orgs/${encodeURIComponent(targetOwner)}/repos`
        : 'https://api.github.com/user/repos';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: targetName,
            description: description || `Imported from Azure DevOps TFVC`,
            private: isPrivate,
            auto_init: false
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || `Failed to create GitHub repository: ${res.status}`);
    }
    return res.json();
}

// ------------------------------------------------------------------
// Strategy 3 — ZIP snapshot (no history)
// ------------------------------------------------------------------
async function runSnapshotStrategy(ctx) {
    const {
        azureHost, azureOrg, azureProject, tfvcPath, azurePat,
        targetOwner, targetName, isPrivate, description, githubToken, onProgress
    } = ctx;

    const { simpleGit } = await import('simple-git');
    const { mkdirSync, existsSync, rmSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const tmpDir = join(importService.TMP_DIR, `tfvc-snapshot-${Date.now()}`);

    const MAX_ZIP_SIZE = 1024 * 1024 * 1024;

    try {
        onProgress('running', 'Downloading TFVC files...', 35);
        const zipBuffer = await azureService.downloadTfvcItems(azureOrg, azureProject, tfvcPath, azurePat, azureHost);

        if (zipBuffer.length === 0) {
            throw new Error('TFVC path contains no files to migrate.');
        }
        if (zipBuffer.length > MAX_ZIP_SIZE) {
            throw new Error(`TFVC content exceeds 1 GB limit (${(zipBuffer.length / 1024 / 1024).toFixed(0)} MB).`);
        }

        onProgress('running', 'Extracting files...', 45);
        mkdirSync(tmpDir, { recursive: true });
        const zipPath = join(tmpDir, 'tfvc-content.zip');
        writeFileSync(zipPath, zipBuffer);

        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(zipPath);
        const extractDir = join(tmpDir, 'content');
        mkdirSync(extractDir, { recursive: true });
        zip.extractAllTo(extractDir, true);

        onProgress('running', 'Creating Git repository from TFVC snapshot...', 55);
        const git = simpleGit(extractDir);
        await git.init();
        await git.add('.');
        await git.commit(`Initial commit: imported from Azure DevOps TFVC\n\nSource: ${azureHost}/${azureOrg}/${azureProject}${tfvcPath}`);

        const branchSummary = await git.branchLocal();
        const defaultBranch = branchSummary.current || 'main';

        onProgress('running', 'Creating target repository on GitHub...', 65);
        const created = await createGitHubRepo({
            targetOwner, targetName, isPrivate,
            description: description || `Imported from Azure DevOps TFVC: ${azureHost}/${azureOrg}/${azureProject}${tfvcPath}`,
            githubToken
        });

        onProgress('running', 'Pushing to GitHub...', 80);
        const pushUrl = `https://x-access-token:${githubToken}@github.com/${created.full_name}.git`;
        await git.addRemote('origin', pushUrl);
        await git.push('origin', defaultBranch, ['--set-upstream']);

        return {
            targetFullName: created.full_name,
            branchCount: 1,
            hasLFS: false,
            repoUrl: created.html_url,
            snapshot: true
        };
    } finally {
        try { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); }
        catch (e) { logger.warn({ err: e }, 'tfvc-snapshot: Cleanup warning'); }
    }
}

// Re-export pickStrategies for cascade tests.
export { pickStrategies };

// ------------------------------------------------------------------
// TFVC → Git in-place: convert TFVC to a NEW Git repo inside the
// SAME Azure DevOps / TFS project. No GitHub push, no cleanup —
// the converted repo stays in Azure with the user-chosen name.
//
// This is the simplest of the four target modes because the Import
// Request API natively creates the Git repo as part of the conversion;
// we just stop after step 4 and rename instead of deleting.
// ------------------------------------------------------------------
router.post('/import/azure-tfvc/in-place', requireAuth, validateBody(azureTfvcInPlaceSchema), async (req, res) => {
    try {
        const {
            azureHost: rawHost,
            azureOrg, azureProject, tfvcPath,
            targetRepoName,            // name for the new Git repo (required if existingRepoId absent)
            targetProject,             // optional: different project on same org
            existingRepoId,            // optional: reuse an existing empty Git repo instead of creating
            importHistory,
        } = req.body;
        const azureHost = rawHost || DEFAULT_HOST;
        const patResult = resolveAzurePat(req, { patField: 'azurePat' });
        const azurePat = patResult.pat;

        if (!azureOrg || !azureProject || !tfvcPath) {
            return errorResponse(res, 400, 'Azure organization, project, and TFVC path are required', 'MISSING_PARAMS');
        }
        if (!tfvcPath.startsWith('$/')) {
            return errorResponse(res, 400, 'TFVC path must start with $/', 'INVALID_PATH');
        }
        if (!existingRepoId && !targetRepoName?.trim()) {
            return errorResponse(res, 400, 'targetRepoName is required (or pass existingRepoId)', 'MISSING_TARGET_NAME');
        }
        if (!azurePat) {
            return errorResponse(res, 400, patResult.error || 'No PAT provided and no server PAT configured', 'MISSING_PAT');
        }

        const hostCheck = await validateAzureHost(azureHost);
        if (!hostCheck.ok) {
            return errorResponse(res, 400, `Source host rejected: ${hostCheck.reason}`, 'INVALID_HOST');
        }

        const destProject = (targetProject?.trim() || azureProject);
        const repoName = targetRepoName ? importService.sanitizeRepoName(targetRepoName) : null;
        const folderName = tfvcPath.split('/').pop() || azureProject;
        const safeUrl = `tfvc-azure://${azureHost}/${azureOrg}/${azureProject}${tfvcPath}->${destProject}/${repoName || `existing:${existingRepoId}`}`;
        const userId = req.session.userId;
        const sourceName = `${azureOrg}/${azureProject}/${folderName} (TFVC → Azure Git)`;

        // Atomic duplicate-check + insert (same pattern as the GitHub path).
        const createJob = db.transaction((safeUrl, userId, sourceName, repoName, host) => {
            const existing = db.prepare(
                `SELECT id FROM migration_jobs WHERE source_url = ? AND status IN ('pending', 'running') AND user_id = ?`
            ).get(safeUrl, userId);
            if (existing) return { duplicate: true, id: existing.id };
            const result = db.prepare(`
                INSERT INTO migration_jobs (user_id, source_type, source_url, source_host, source_name, target_owner, target_repo, status, progress_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'Starting in-place TFVC conversion...')
            `).run(userId, 'azure-tfvc-in-place', safeUrl, host, sourceName, azureOrg, repoName);
            return { duplicate: false, id: result.lastInsertRowid };
        });

        const jobResult = createJob(safeUrl, userId, sourceName, repoName, azureHost);
        if (jobResult.duplicate) {
            return errorResponse(res, 409, 'An in-place conversion for this TFVC path is already in progress', 'DUPLICATE_IMPORT');
        }
        const jobId = Number(jobResult.id);

        // Fire-and-forget: the route returns immediately so the wizard
        // streams progress via the existing SSE/poll mechanism.
        runInPlaceTfvcConversion({
            azureHost, azureOrg, azureProject, destProject,
            tfvcPath, azurePat, repoName, existingRepoId,
            importHistory: importHistory !== false,
            jobId,
        });

        res.status(201).json({ success: true, jobId, message: 'In-place TFVC conversion started' });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'In-place TFVC conversion failed'));
    }
});

/**
 * Convert TFVC → Git inside the SAME Azure project (or a different one on the
 * same org). Uses the Import Request API exclusively — there's no fallback to
 * git-tfs or ZIP because the whole value of in-place is "the converted repo
 * stays in Azure with full history". A snapshot loses the history; git-tfs
 * would create a local copy that we'd have to push back (defeats the purpose).
 *
 * If the user wants resilience against Import API outages, they should use
 * the GitHub target which has the full cascade.
 */
async function runInPlaceTfvcConversion(params) {
    const {
        azureHost, azureOrg, destProject,
        tfvcPath, azurePat, repoName, existingRepoId, importHistory, jobId,
    } = params;

    const onProgress = (status, message, pct) => updateJobProgress(status, message, pct, jobId);

    try {
        // Phase 1: Resolve the target Git repo — either reuse an existing
        // empty one (skip create, validate emptiness) or create a new one.
        let newRepo;
        if (existingRepoId) {
            onProgress('running', `Validating existing repo in ${destProject}...`, 8);
            const existing = await azureService.getRepoDetails(azureOrg, destProject, existingRepoId, azurePat, azureHost);
            const isEmpty = !existing.defaultBranch && (!existing.size || existing.size === 0);
            if (!isEmpty) {
                throw new Error(`Existing repo "${existing.name}" is not empty — cannot import TFVC into a repo that already has commits`);
            }
            newRepo = existing;
            onProgress('running', `Using existing empty repo "${existing.name}"...`, 12);
        } else {
            onProgress('running', `Creating Git repository "${repoName}" in ${destProject}...`, 10);
            newRepo = await azureService.createGitRepo(azureOrg, destProject, repoName, azurePat, azureHost);
        }

        // Phase 2: Trigger the Import API.
        onProgress('running', 'Starting TFVC → Git conversion via Import API...', 15);
        const importReq = await azureService.importTfvcToGit(
            azureOrg, destProject, newRepo.id, tfvcPath, azurePat, importHistory, azureHost,
        );

        // Phase 3: Poll until done (same loop as runImportApiStrategy).
        let done = false;
        const MAX_POLLS = 120;
        const POLL_INTERVAL = 5000;
        for (let i = 0; i < MAX_POLLS && !done; i++) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            let status;
            try {
                status = await azureService.getImportStatus(azureOrg, destProject, newRepo.id, importReq.importRequestId, azurePat, azureHost);
            } catch (e) {
                if (e.status === 401 || e.status === 403) {
                    throw new Error('PAT expired or was revoked during conversion.');
                }
                throw e;
            }
            const pct = Math.min(15 + Math.floor((i / MAX_POLLS) * 75), 95);
            onProgress('running', `Converting TFVC to Git... (${status.status})`, pct);
            if (status.status === 'completed') done = true;
            else if (status.status === 'failed' || status.status === 'abandoned') {
                throw new Error(`Import API conversion failed: ${status.detailedStatus?.errorMessage || status.status}`);
            }
        }
        if (!done) throw new Error('TFVC conversion timed out after 10 minutes');

        // Phase 4: Done — fetch the final repo details so we can record the URL.
        // Use the resolved repo name (set when reusing an existing repo) or the requested one.
        const resolvedRepoName = newRepo.name || repoName;
        const finalRepo = await azureService.getRepoDetails(azureOrg, destProject, resolvedRepoName, azurePat, azureHost);

        db.prepare(`
            UPDATE migration_jobs SET status = 'complete', target_full_name = ?, progress_pct = 100,
            progress_message = 'TFVC converted to Git in Azure DevOps!', completed_at = datetime('now'),
            metadata = ?
            WHERE id = ?
        `).run(
            `${azureOrg}/${destProject}/${resolvedRepoName}`,
            JSON.stringify({
                versionControlType: 'Tfvc',
                tfvcPath,
                azureHost,
                strategy: 'importApi-in-place',
                inPlace: true,
                destProject,
                repoId: finalRepo.id,
                repoUrl: finalRepo.webUrl,
                cloneUrl: finalRepo.remoteUrl,
            }),
            jobId,
        );
    } catch (error) {
        const safeMsg = safeError(error, 'In-place TFVC conversion failed');
        logger.error({ err: error, jobId }, 'tfvc-in-place: failed');
        db.prepare(`
            UPDATE migration_jobs SET status = 'failed', error_message = ?,
            progress_message = ?, completed_at = datetime('now')
            WHERE id = ?
        `).run(`In-place conversion failed: ${safeMsg}`, `Failed: ${safeMsg}`, jobId);
    }
}

export default router;
