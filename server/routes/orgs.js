/*
 * GitHub Repo Manager - Organization Routes
 *
 * Handles all /api/orgs/* endpoints including:
 * - List organizations (with personal account)
 * - Get/update organization details
 * - Organization repositories (list, create)
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, safeError, isValidGitHubUsername } from '../middleware/auth.js';

const router = express.Router();

// Validate :org param
router.param('org', (req, res, next, org) => {
    if (!isValidGitHubUsername(org)) {
        return res.status(400).json({ error: 'Invalid organization name' });
    }
    next();
});

// List organizations (personal account first, then orgs)
router.get('/', requireAuth, async (req, res) => {
    try {
        // 1. Fetch user info for personal account
        const { data: user } = await githubApi('/user', req.session.accessToken);

        // 2. Fetch user's personal repos to get accurate counts
        const { data: userRepos } = await githubApi(
            '/user/repos?affiliation=owner&per_page=100',
            req.session.accessToken
        );

        const publicRepos = userRepos.filter(r => !r.private).length;
        const privateRepos = userRepos.filter(r => r.private).length;

        // 3. Create personal account as first "org"
        const personalAccount = {
            login: user.login,
            avatar_url: user.avatar_url,
            public_repos: publicRepos,
            total_private_repos: privateRepos,
            description: 'Personal Account',
            isPersonal: true
        };

        // 4. Fetch organizations
        const { data: orgs } = await githubApi('/user/orgs', req.session.accessToken);

        // 5. Enrich organization data with repo counts (batched to limit concurrency)
        const orgsWithCounts = [];
        const batchSize = 5;
        for (let i = 0; i < orgs.length; i += batchSize) {
            const batch = orgs.slice(i, i + batchSize);
            const results = await Promise.allSettled(
                batch.map(async (org) => {
                    const { data: orgDetails } = await githubApi(`/orgs/${org.login}`, req.session.accessToken);
                    return {
                        ...org,
                        public_repos: orgDetails.public_repos || 0,
                        total_private_repos: orgDetails.total_private_repos || 0,
                        isPersonal: false
                    };
                })
            );
            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    orgsWithCounts.push(results[j].value);
                } else {
                    orgsWithCounts.push({ ...batch[j], isPersonal: false });
                }
            }
        }

        // 6. Return personal account FIRST, then organizations
        res.json([personalAccount, ...orgsWithCounts]);
    } catch (error) {
        req.log.error({ err: error }, 'Failed to fetch organizations');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Get organization details
router.get('/:org', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Update organization
router.patch('/:org', requireAuth, async (req, res) => {
    try {
        // Whitelist allowed fields to prevent unintended org modifications
        const { name, description, company, location, email, blog, default_repository_permission, members_can_create_repositories } = req.body;
        const allowedFields = {};
        if (name !== undefined) allowedFields.name = name;
        if (description !== undefined) allowedFields.description = description;
        if (company !== undefined) allowedFields.company = company;
        if (location !== undefined) allowedFields.location = location;
        if (email !== undefined) allowedFields.email = email;
        if (blog !== undefined) allowedFields.blog = blog;
        if (default_repository_permission !== undefined) allowedFields.default_repository_permission = default_repository_permission;
        if (members_can_create_repositories !== undefined) allowedFields.members_can_create_repositories = members_can_create_repositories;

        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(allowedFields)
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to update organization') });
    }
});

// List organization repos
router.get('/:org/repos', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = Math.min(Math.max(parseInt(req.query.per_page) || 30, 1), 100);
        const orgLogin = req.params.org;

        // Get current user to check if this is their personal account
        const { data: user } = await githubApi('/user', req.session.accessToken);

        let endpoint;
        if (orgLogin === user.login) {
            // Personal account - fetch user's personal repos
            endpoint = `/user/repos?affiliation=owner&page=${page}&per_page=${perPage}&sort=updated`;
        } else {
            // Organization - fetch org repos
            endpoint = `/orgs/${orgLogin}/repos?page=${page}&per_page=${perPage}&sort=updated`;
        }

        const { data, headers } = await githubApi(endpoint, req.session.accessToken);

        const linkHeader = headers.get('link');
        let totalPages = null;
        if (linkHeader) {
            const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (lastMatch) totalPages = parseInt(lastMatch[1]);
        }

        res.json({ repos: data, page: parseInt(page), totalPages, org: orgLogin });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// List organization members
router.get('/:org/members', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = Math.min(Math.max(parseInt(req.query.per_page) || 30, 1), 100);
        const { data } = await githubApi(
            `/orgs/${req.params.org}/members?page=${page}&per_page=${perPage}`,
            req.session.accessToken
        );
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to fetch organization members') });
    }
});

// Create repo in organization
router.post('/:org/repos', requireAuth, async (req, res) => {
    try {
        const { name, description, private: isPrivate, auto_init } = req.body;

        const { data } = await githubApi(`/orgs/${req.params.org}/repos`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({
                name,
                description: description || '',
                private: isPrivate !== false,
                auto_init: auto_init !== false
            })
        });

        res.json({ success: true, repo: data });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
