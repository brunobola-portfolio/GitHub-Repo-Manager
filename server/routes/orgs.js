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
import { z } from 'zod';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, safeError, isValidGitHubUsername } from '../middleware/auth.js';
import { orgRepoCreateSchema } from '../lib/validators.js';
import { validateBody } from '../middleware/validate-request.js';
import { auditLog } from '../lib/audit.js';

const router = express.Router();

// PATCH /:org body. Name-whitelisting alone let an object or array through to
// GitHub verbatim, which answered 422 and this router re-emitted as an opaque
// passthrough instead of a clean 400. `.strict()` because the handler only
// ever forwarded these eight keys — an unknown one was silently dropped, which
// reads to the caller as a successful no-op.
const ORG_PATCH_ENUMS = Object.freeze({
    defaultRepositoryPermission: ['read', 'write', 'admin', 'none'],
});
const orgPatchSchema = z.object({
    // GitHub renames the organisation on this field. Irreversible in practice
    // (the old login is released), so it is bounded rather than free-form.
    name: z.string().min(1).max(255),
    description: z.string().max(1000),
    company: z.string().max(255),
    location: z.string().max(255),
    email: z.string().max(320),
    blog: z.string().max(500),
    default_repository_permission: z.enum(ORG_PATCH_ENUMS.defaultRepositoryPermission),
    members_can_create_repositories: z.boolean(),
}).partial().strict();

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
router.patch('/:org', requireAuth, validateBody(orgPatchSchema), async (req, res) => {
    try {
        // The schema is `.strict()` and fully optional, so req.validatedBody
        // already IS the whitelist — no key can reach GitHub that isn't here.
        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(req.validatedBody)
        });
        auditLog(req, 'org.update', 'org', req.params.org, {
            fields: Object.keys(req.validatedBody),
            renamed: req.validatedBody.name !== undefined,
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

        // Use the cached login from the OAuth callback instead of issuing a
        // fresh /user round-trip on every page load. Falls back to a single
        // /user fetch only if the session was created before this field was
        // captured (legacy session mid-deploy).
        let userLogin = req.session.userLogin;
        if (!userLogin) {
            const { data: user } = await githubApi('/user', req.session.accessToken);
            userLogin = user?.login;
            if (userLogin) req.session.userLogin = userLogin;
        }

        let endpoint;
        if (orgLogin === userLogin) {
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
router.post('/:org/repos', requireAuth, validateBody(orgRepoCreateSchema), async (req, res) => {
    try {
        const { name, description, private: isPrivate, auto_init } = req.validatedBody;

        const { data } = await githubApi(`/orgs/${req.params.org}/repos`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({
                name,
                description: description || '',
                private: isPrivate !== false,
                auto_init: auto_init !== false,
            }),
        });

        auditLog(req, 'org.repo.create', 'repo', `${req.params.org}/${name}`, {
            org: req.params.org,
            visibility: isPrivate === false ? 'public' : 'private',
        });

        res.json({ success: true, repo: data });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

export default router;
