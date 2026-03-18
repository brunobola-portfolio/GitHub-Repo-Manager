/*
 * GitHub Repo Manager - User Routes
 *
 * Handles user-related endpoints:
 * - GET /user - Get authenticated user profile
 * - GET /activity - Get user activity events
 * - GET /search/users - Search GitHub users
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, isValidGitHubUsername, safeError } from '../middleware/auth.js';

const router = express.Router();

// Get authenticated user profile
router.get('/user', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi('/user', req.session.accessToken);
        res.json(data);
    } catch (error) {
        // If GitHub says 401, the token is invalid - destroy session
        if (error.status === 401) {
            req.session.destroy(() => {});
        }
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get user activity events
router.get('/activity', requireAuth, async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: 'Username required' });
        if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });

        const { data } = await githubApi(`/users/${username}/events`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Search GitHub users
router.get('/search/users', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const { data } = await githubApi(`/search/users?q=${encodeURIComponent(q)}&per_page=5`, req.session.accessToken);
        res.json(data.items || []);
    } catch (error) {
        req.log.error({ err: error }, 'User search failed');
        res.status(500).json({ error: 'Failed to search users' });
    }
});

export default router;
