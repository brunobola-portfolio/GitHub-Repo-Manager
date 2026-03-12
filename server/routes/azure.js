import express from 'express';
import * as azureService from '../azure-service.js';
import { requireAuth, safeError } from '../middleware/auth.js';

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
            return res.status(400).json({ error: 'Organization is required' });
        }
        if (!pat) {
            return res.status(400).json({ error: 'No PAT provided and no server PAT configured' });
        }
        const result = await azureService.validatePat(org, pat);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Azure validation failed') });
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org) {
            return res.status(400).json({ error: 'Organization is required' });
        }
        if (!pat) {
            return res.status(400).json({ error: 'No PAT provided and no server PAT configured' });
        }
        const projects = await azureService.listProjects(org, pat);
        res.json({ projects });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to list Azure projects') });
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return res.status(400).json({ error: 'Organization and project are required' });
        }
        if (!pat) {
            return res.status(400).json({ error: 'No PAT provided and no server PAT configured' });
        }
        const repos = await azureService.listRepos(org, project, pat);
        res.json({ repos });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to list Azure repos') });
    }
});

export default router;
