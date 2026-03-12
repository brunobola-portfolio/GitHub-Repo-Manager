import express from 'express';
import * as azureService from '../azure-service.js';
import { requireAuth, safeError } from '../middleware/auth.js';

const router = express.Router();

router.post('/azure/validate', requireAuth, async (req, res) => {
    try {
        const { org, pat } = req.body;
        if (!org || !pat) {
            return res.status(400).json({ error: 'Organization and PAT are required' });
        }
        const result = await azureService.validatePat(org, pat);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Azure validation failed') });
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org, pat } = req.body;
        if (!org || !pat) {
            return res.status(400).json({ error: 'Organization and PAT are required' });
        }
        const projects = await azureService.listProjects(org, pat);
        res.json({ projects });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to list Azure projects') });
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project, pat } = req.body;
        if (!org || !project || !pat) {
            return res.status(400).json({ error: 'Organization, project, and PAT are required' });
        }
        const repos = await azureService.listRepos(org, project, pat);
        res.json({ repos });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to list Azure repos') });
    }
});

export default router;
