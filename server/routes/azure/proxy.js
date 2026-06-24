// Azure DevOps read/enrichment proxies + PAT validation. All requireAuth;
// enrichment endpoints add enrichedRepoLimiter. Extracted verbatim from
// routes/azure.js (handlers unchanged) using the shared resolver helpers.
import express from 'express';
import * as azureService from '../../azure-service.js';
import { requireAuth, safeError, errorResponse, isValidGitHubUsername } from '../../middleware/auth.js';
import {
    DEFAULT_AZURE_HOST, MAX_BATCH_REPOS, FOLDER_SIZE_CONCURRENCY,
    resolveHost, resolvePatFromRequest, resolveAzureContext, enrichedRepoLimiter,
} from './_shared.js';

const router = express.Router();

router.post('/azure/validate', requireAuth, async (req, res) => {
    try {
        const { org } = req.body;
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        const host = (req.body?.host || DEFAULT_AZURE_HOST).toString();
        if (host === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
            return errorResponse(res, 400, 'Invalid organization name');
        }
        const patResult = resolvePatFromRequest(req);
        if (!patResult.pat) {
            // Surface as `{ valid: false, error }` (HTTP 200) so the wizard
            // ConnectionStatusPanel renders the message in the "validate"
            // step instead of going to a generic HTTP error state.
            return res.json({ valid: false, error: patResult.error });
        }
        const validatedHost = await resolveHost(req, res);
        if (!validatedHost) return;
        const result = await azureService.validatePat(org, patResult.pat, validatedHost);
        res.json(result);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Azure validation failed'));
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org } = req.body;
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        const host = (req.body?.host || DEFAULT_AZURE_HOST).toString();
        if (host === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
            return errorResponse(res, 400, 'Invalid organization name');
        }
        const patResult = resolvePatFromRequest(req);
        if (!patResult.pat) {
            return errorResponse(res, 400, patResult.error, 'MISSING_PAT');
        }
        const validatedHost = await resolveHost(req, res);
        if (!validatedHost) return;
        const projects = await azureService.listProjects(org, patResult.pat, validatedHost);
        res.json({ projects });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure projects'));
    }
});

// Create a new Azure DevOps project (used by the migration wizard's
// "create new project + repo" target mode). Polls Operations API until
// the project is provisioned, then optionally creates a Git repo inside.
router.post('/azure/projects/create', requireAuth, async (req, res) => {
    try {
        const { name, description, processTemplateId, sourceControlType, repoName } = req.body || {};
        if (!name) {
            return errorResponse(res, 400, 'Project name is required', 'MISSING_PARAMS');
        }
        // `requireProject: false` because we're CREATING the project here.
        const ctx = await resolveAzureContext(req, res, { requireProject: false });
        if (!ctx) return;
        const { org, pat, host } = ctx;

        const created = await azureService.createProject(org, {
            name, description, processTemplateId,
            sourceControlType: sourceControlType || 'Git'
        }, pat, host);

        // Project creation is async — caller polls until ready. We do a brief
        // wait here so common-case responses include a usable project handle.
        let projectInfo = null;
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
                projectInfo = await azureService.getProjectInfo(org, name, pat, host);
                if (projectInfo?.id) break;
            } catch { /* not ready yet */ }
        }

        // Optionally create a Git repo inside the new project
        let createdRepo = null;
        if (repoName && projectInfo?.id) {
            try {
                createdRepo = await azureService.createGitRepo(org, name, repoName, pat, host);
            } catch (e) {
                // Surface but don't fail the whole call — caller can retry just the repo
                return res.status(207).json({
                    project: { id: projectInfo.id, name, operationId: created.operationId },
                    repoError: safeError(e, 'Failed to create repository in new project')
                });
            }
        }

        res.status(201).json({
            project: projectInfo ? { id: projectInfo.id, name: projectInfo.name } : { name, operationId: created.operationId, pending: true },
            repo: createdRepo
        });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to create Azure project'));
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project } = req.body;
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        const host = (req.body?.host || DEFAULT_AZURE_HOST).toString();
        if (host === DEFAULT_AZURE_HOST && !isValidGitHubUsername(org)) {
            return errorResponse(res, 400, 'Invalid organization name');
        }
        const patResult = resolvePatFromRequest(req);
        if (!patResult.pat) {
            return errorResponse(res, 401, patResult.error, 'MISSING_PAT');
        }
        const validatedHost = await resolveHost(req, res);
        if (!validatedHost) return;
        const [repos, projectInfo] = await Promise.all([
            azureService.listRepos(org, project, patResult.pat, validatedHost),
            azureService.getProjectInfo(org, project, patResult.pat, validatedHost).catch(() => null),
        ]);
        const versionControlType = projectInfo?.versionControlType || 'Git';
        // Annotate with isEmpty so the wizard can offer "use existing empty repo"
        // as a TFVC-import target. Azure DevOps reports defaultBranch='' and
        // size=0 for freshly-created Git repos with no commits.
        const annotated = repos.map((r) => ({
            ...r,
            isEmpty: !r.defaultBranch && (!r.size || r.size === 0),
        }));
        res.json({ repos: annotated, versionControlType });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure repos'));
    }
});

router.post('/azure/wikis', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const wikis = await azureService.listWikis(ctx.org, ctx.project, ctx.pat, ctx.host);
        res.json({ wikis });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure wikis'));
    }
});

router.post('/azure/work-items/counts', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const counts = await azureService.getWorkItemCounts(ctx.org, ctx.project, ctx.pat, ctx.host);
        res.json({ counts });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get work item counts'));
    }
});

router.post('/azure/work-items/preview', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const items = await azureService.previewWorkItems(ctx.org, ctx.project, ctx.pat, req.body?.types || [], ctx.host);
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to preview work items'));
    }
});

router.post('/azure/project-info', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const info = await azureService.getProjectInfo(ctx.org, ctx.project, ctx.pat, ctx.host);
        res.json(info);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get project info'));
    }
});

router.post('/azure/branches', requireAuth, async (req, res) => {
    try {
        const { repoId } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const branches = await azureService.listBranches(ctx.org, ctx.project, repoId, ctx.pat, ctx.host);
        res.json({ branches });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list branches'));
    }
});

router.post('/azure/pat-permissions', requireAuth, async (req, res) => {
    try {
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;

        // Probe each scope independently so a missing one doesn't mask the
        // others — in parallel, since the three probes are unrelated calls.
        const [code, workItems, wiki] = await Promise.all([
            azureService.listRepos(ctx.org, ctx.project, ctx.pat, ctx.host).then(() => true).catch(() => false),
            azureService.getWorkItemCounts(ctx.org, ctx.project, ctx.pat, ctx.host).then(() => true).catch(() => false),
            azureService.listWikis(ctx.org, ctx.project, ctx.pat, ctx.host).then(() => true).catch(() => false),
        ]);

        res.json({ permissions: { code, workItems, wiki } });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to check PAT permissions'));
    }
});

router.post('/azure/repos/activity', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repos } = req.body || {};
        if (!Array.isArray(repos)) return errorResponse(res, 400, 'repos[] required', 'MISSING_REPOS');
        if (repos.length > MAX_BATCH_REPOS) {
            return errorResponse(res, 400, `Too many repos per request (max ${MAX_BATCH_REPOS})`, 'TOO_MANY_REPOS');
        }
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const result = await azureService.listRepoActivity(ctx.org, ctx.project, repos, ctx.pat, ctx.host);
        res.json({ activity: result });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch repo activity'));
    }
});

router.post('/azure/repos/lfs-check', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repos } = req.body || {};
        if (!Array.isArray(repos)) return errorResponse(res, 400, 'repos[] required', 'MISSING_REPOS');
        if (repos.length > MAX_BATCH_REPOS) {
            return errorResponse(res, 400, `Too many repos per request (max ${MAX_BATCH_REPOS})`, 'TOO_MANY_REPOS');
        }
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const result = await azureService.checkLfsMarkers(ctx.org, ctx.project, repos, ctx.pat, ctx.host);
        res.json({ lfs: result });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to check LFS markers'));
    }
});

router.post('/azure/repos/commit-activity', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repoId, defaultBranch, months } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const activity = await azureService.getCommitActivity(ctx.org, ctx.project, repoId, defaultBranch, ctx.pat, months || 12, ctx.host);
        res.json({ activity });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch commit activity'));
    }
});

router.post('/azure/repos/readme', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repoId, ref } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const readme = await azureService.getRepoReadme(ctx.org, ctx.project, repoId, ctx.pat, ref, ctx.host);
        res.json(readme);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch README'));
    }
});

router.post('/azure/repos/full-stats', requireAuth, enrichedRepoLimiter, async (req, res) => {
    try {
        const { repoId, defaultBranch } = req.body || {};
        if (!repoId) return errorResponse(res, 400, 'repoId is required', 'MISSING_REPO_ID');
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const stats = await azureService.getRepoFullStats(ctx.org, ctx.project, repoId, defaultBranch, ctx.pat, ctx.host);
        res.json(stats);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to fetch full stats'));
    }
});

router.post('/azure/tfvc/items', requireAuth, async (req, res) => {
    try {
        const { scopePath } = req.body || {};
        const ctx = await resolveAzureContext(req, res);
        if (!ctx) return;
        const items = await azureService.listTfvcItems(ctx.org, ctx.project, ctx.pat, scopePath, ctx.host);
        // Compute actual folder sizes via recursive listing, in bounded chunks.
        const enriched = [];
        for (let i = 0; i < items.length; i += FOLDER_SIZE_CONCURRENCY) {
            const chunk = items.slice(i, i + FOLDER_SIZE_CONCURRENCY);
            enriched.push(...await Promise.all(chunk.map(async (item) => {
                if (item.isFolder && item.path) {
                    try {
                        const size = await azureService.getTfvcFolderSize(ctx.org, ctx.project, ctx.pat, item.path, ctx.host);
                        return { ...item, size };
                    } catch {
                        return item; // keep original (0) on error
                    }
                }
                return item;
            })));
        }
        res.json({ items: enriched });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list TFVC items'));
    }
});

export default router;
