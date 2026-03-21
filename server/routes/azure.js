import express from 'express';
import * as azureService from '../azure-service.js';
import { requireAuth, safeError, errorResponse } from '../middleware/auth.js';

const router = express.Router();

// Check if server has AZURE_PAT configured (never returns the PAT itself)
router.get('/azure/env-auth', requireAuth, (req, res) => {
    res.json({ available: !!process.env.AZURE_PAT });
});

router.post('/azure/validate', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const result = await azureService.validatePat(org, pat);
        res.json(result);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Azure validation failed'));
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org) {
            return errorResponse(res, 400, 'Organization is required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const projects = await azureService.listProjects(org, pat);
        res.json({ projects });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure projects'));
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const repos = await azureService.listRepos(org, project, pat);
        // When no Git repos found, check if project uses TFVC
        let versionControlType = null;
        if (repos.length === 0) {
            try {
                const info = await azureService.getProjectInfo(org, project, pat);
                versionControlType = info.versionControlType;
            } catch { /* degrade gracefully */ }
        }
        res.json({ repos, ...(versionControlType ? { versionControlType } : {}) });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure repos'));
    }
});

router.post('/azure/wikis', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const wikis = await azureService.listWikis(org, project, pat);
        res.json({ wikis });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list Azure wikis'));
    }
});

router.post('/azure/work-items/counts', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const counts = await azureService.getWorkItemCounts(org, project, pat);
        res.json({ counts });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get work item counts'));
    }
});

router.post('/azure/work-items/preview', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat, types } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const items = await azureService.previewWorkItems(org, project, pat, types || []);
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to preview work items'));
    }
});

router.post('/azure/project-info', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const info = await azureService.getProjectInfo(org, project, pat);
        res.json(info);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to get project info'));
    }
});

router.post('/azure/tfvc/items', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat, scopePath } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return errorResponse(res, 400, 'Organization and project are required');
        }
        if (!pat) {
            return errorResponse(res, 400, 'No PAT provided and no server PAT configured');
        }
        const items = await azureService.listTfvcItems(org, project, pat, scopePath);
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list TFVC items'));
    }
});

export default router;
