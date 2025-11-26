/*
 * GitHub Repo Manager
 * Backend API server
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.error('❌ Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET in environment');
    console.error('   Please create a GitHub OAuth App and set these variables in .env');
    process.exit(1);
}

// Middleware
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Helper: GitHub API request
async function githubApi(path, token, options = {}) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const error = new Error(data?.message || `GitHub API error: ${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
    }

    return { data, headers: res.headers };
}

// Auth middleware
function requireAuth(req, res, next) {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// ============ AUTH ROUTES ============

// Start OAuth flow
app.get('/api/auth/login', (req, res) => {
    const scope = 'repo delete_repo read:org admin:org';
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/callback`;
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
    res.redirect(authUrl);
});

// OAuth callback
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.redirect(`${FRONTEND_URL}?error=no_code`);
    }

    try {
        // Exchange code for access token
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code
            })
        });

        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            console.error('OAuth error:', tokenData);
            return res.redirect(`${FRONTEND_URL}?error=${tokenData.error}`);
        }

        req.session.accessToken = tokenData.access_token;
        res.redirect(FRONTEND_URL);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect(`${FRONTEND_URL}?error=auth_failed`);
    }
});

// Logout
app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ============ USER ROUTES ============

app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi('/user', req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get user error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ============ REPOS ROUTES ============

app.get('/api/repos', requireAuth, async (req, res) => {
    try {
        const page = req.query.page || 1;
        const perPage = req.query.per_page || 30;

        const { data, headers } = await githubApi(
            `/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner`,
            req.session.accessToken
        );

        // Parse Link header for pagination
        const linkHeader = headers.get('link');
        let totalPages = null;
        if (linkHeader) {
            const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (lastMatch) totalPages = parseInt(lastMatch[1]);
        }

        res.json({ repos: data, page: parseInt(page), totalPages });
    } catch (error) {
        console.error('Get repos error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ============ ACTION ROUTES ============

// Change visibility
app.post('/api/visibility', requireAuth, async (req, res) => {
    const { repos, makePublic } = req.body;

    if (!repos || !Array.isArray(repos) || repos.length === 0) {
        return res.status(400).json({ error: 'repos array is required' });
    }

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ private: !makePublic })
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Made ${makePublic ? 'public' : 'private'}: ${successCount} repositories`,
        results
    });
});

// Transfer to organization
app.post('/api/transfer', requireAuth, async (req, res) => {
    const { repos, toOrg } = req.body;

    if (!repos || !Array.isArray(repos) || repos.length === 0) {
        return res.status(400).json({ error: 'repos array is required' });
    }
    if (!toOrg) {
        return res.status(400).json({ error: 'toOrg is required' });
    }

    const results = [];

    for (const repoFullName of repos) {
        try {
            const repoName = repoFullName.split('/')[1];
            await githubApi(`/repos/${repoFullName}/transfer`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ new_owner: toOrg })
            });
            results.push({ repo: repoFullName, success: true, newLocation: `${toOrg}/${repoName}` });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Transferred ${successCount} repositories to ${toOrg}`,
        results
    });
});

// Mirror (fork to organization)
app.post('/api/mirror', requireAuth, async (req, res) => {
    const { repos, toOrg } = req.body;

    if (!repos || !Array.isArray(repos) || repos.length === 0) {
        return res.status(400).json({ error: 'repos array is required' });
    }
    if (!toOrg) {
        return res.status(400).json({ error: 'toOrg is required' });
    }

    const results = [];

    for (const repoFullName of repos) {
        try {
            // Fork to organization
            const { data } = await githubApi(`/repos/${repoFullName}/forks`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ organization: toOrg })
            });
            results.push({
                repo: repoFullName,
                success: true,
                mirrorUrl: data.html_url
            });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Mirrored ${successCount} repositories to ${toOrg}`,
        results
    });
});

// ============ ORGANIZATION ROUTES ============

// List user's organizations
app.get('/api/orgs', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi('/user/orgs', req.session.accessToken);

	    // Get repo count for each org using org details endpoint
	    const orgsWithCounts = await Promise.all(data.map(async (org) => {
	        try {
	            const { data: orgDetails } = await githubApi(
	                `/orgs/${org.login}`,
	                req.session.accessToken
	            );
                return {
                    ...org,
                    public_repos: orgDetails.public_repos || 0,
                    total_private_repos: orgDetails.total_private_repos || 0
                };
            } catch {
                return org;
            }
        }));

        res.json(orgsWithCounts);
    } catch (error) {
        console.error('Get orgs error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Get organization details
app.get('/api/orgs/:org', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get org error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Update organization details
app.patch('/api/orgs/:org', requireAuth, async (req, res) => {
    try {
        const { name, description, email, location, blog, company, twitter_username } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (email !== undefined) updateData.email = email;
        if (location !== undefined) updateData.location = location;
        if (blog !== undefined) updateData.blog = blog;
        if (company !== undefined) updateData.company = company;
        if (twitter_username !== undefined) updateData.twitter_username = twitter_username;

        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(updateData)
        });

        res.json(data);
    } catch (error) {
        console.error('Update org error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Get organization members
app.get('/api/orgs/:org/members', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi(`/orgs/${req.params.org}/members`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get org members error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// List organization repos
app.get('/api/orgs/:org/repos', requireAuth, async (req, res) => {
    try {
        const page = req.query.page || 1;
        const perPage = req.query.per_page || 30;

        const { data, headers } = await githubApi(
            `/orgs/${req.params.org}/repos?page=${page}&per_page=${perPage}&sort=updated`,
            req.session.accessToken
        );

        const linkHeader = headers.get('link');
        let totalPages = null;
        if (linkHeader) {
            const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (lastMatch) totalPages = parseInt(lastMatch[1]);
        }

        res.json({ repos: data, page: parseInt(page), totalPages, org: req.params.org });
    } catch (error) {
        console.error('Get org repos error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create repository in org
app.post('/api/orgs/:org/repos', requireAuth, async (req, res) => {
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
        console.error('Create org repo error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ============ ARCHIVE ROUTES ============

// Archive/unarchive repositories
app.post('/api/archive', requireAuth, async (req, res) => {
    const { repos, archive = true } = req.body;

    if (!repos || !Array.isArray(repos) || repos.length === 0) {
        return res.status(400).json({ error: 'repos array is required' });
    }

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ archived: archive })
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `${archive ? 'Archived' : 'Unarchived'} ${successCount} repositories`,
        results
    });
});

// ============ DELETE ROUTES ============

// Delete repositories (dangerous!)
app.post('/api/delete', requireAuth, async (req, res) => {
    const { repos, confirm } = req.body;

    if (!repos || !Array.isArray(repos) || repos.length === 0) {
        return res.status(400).json({ error: 'repos array is required' });
    }

    if (confirm !== 'DELETE') {
        return res.status(400).json({ error: 'Must confirm with "DELETE"' });
    }

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'DELETE'
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Deleted ${successCount} repositories`,
        results
    });
});

// ============ CLONE/DUPLICATE ROUTES ============

// Create repo from template or as new
app.post('/api/repos', requireAuth, async (req, res) => {
    try {
        const { name, description, private: isPrivate, org, template } = req.body;

        let data;

        if (template) {
            // Create from template
            const [templateOwner, templateRepo] = template.split('/');
            const response = await githubApi(
                `/repos/${templateOwner}/${templateRepo}/generate`,
                req.session.accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        owner: org || undefined,
                        name,
                        description,
                        private: isPrivate !== false
                    })
                }
            );
            data = response.data;
        } else if (org) {
            // Create in org
            const response = await githubApi(`/orgs/${org}/repos`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    description: description || '',
                    private: isPrivate !== false,
                    auto_init: true
                })
            });
            data = response.data;
        } else {
            // Create for user
            const response = await githubApi('/user/repos', req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    description: description || '',
                    private: isPrivate !== false,
                    auto_init: true
                })
            });
            data = response.data;
        }

        res.json({ success: true, repo: data });
    } catch (error) {
        console.error('Create repo error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ============ AZURE DEVOPS IMPORT ROUTES ============

// Import from Azure DevOps
app.post('/api/import-azure', requireAuth, async (req, res) => {
    const {
        azureOrg,
        azureProject,
        azureRepo,
        azurePat,
        targetOrg,
        targetRepoName,
        makePrivate = true
    } = req.body;

    if (!azureOrg || !azureProject || !azureRepo || !azurePat) {
        return res.status(400).json({
            error: 'azureOrg, azureProject, azureRepo, and azurePat are required'
        });
    }

    try {
        // Step 1: Create the target repository
        const repoName = targetRepoName || azureRepo;
        let createRepoPath = targetOrg
            ? `/orgs/${targetOrg}/repos`
            : '/user/repos';

        const { data: newRepo } = await githubApi(createRepoPath, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({
                name: repoName,
                description: `Imported from Azure DevOps: ${azureOrg}/${azureProject}/${azureRepo}`,
                private: makePrivate,
                auto_init: false
            })
        });

        // Step 2: Start the import
        const azureUrl = `https://dev.azure.com/${azureOrg}/${azureProject}/_git/${azureRepo}`;

        const { data: importData } = await githubApi(
            `/repos/${newRepo.full_name}/import`,
            req.session.accessToken,
            {
                method: 'PUT',
                body: JSON.stringify({
                    vcs: 'git',
                    vcs_url: azureUrl,
                    vcs_username: 'x-token-auth',
                    vcs_password: azurePat
                })
            }
        );

        res.json({
            success: true,
            message: `Import started for ${azureRepo}`,
            repo: newRepo,
            import: importData
        });
    } catch (error) {
        console.error('Azure import error:', error);
        res.status(error.status || 500).json({ error: error.message, details: error.data });
    }
});

// Check import status
app.get('/api/import-status/:owner/:repo', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi(
            `/repos/${req.params.owner}/${req.params.repo}/import`,
            req.session.accessToken
        );
        res.json(data);
    } catch (error) {
        if (error.status === 404) {
            res.json({ status: 'none', message: 'No import in progress' });
        } else {
            console.error('Import status error:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    }
});

// Cancel import
app.delete('/api/import/:owner/:repo', requireAuth, async (req, res) => {
    try {
        await githubApi(
            `/repos/${req.params.owner}/${req.params.repo}/import`,
            req.session.accessToken,
            { method: 'DELETE' }
        );
        res.json({ success: true, message: 'Import cancelled' });
    } catch (error) {
        console.error('Cancel import error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ============ STATISTICS ROUTE ============

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        // Get user repos count
        const { data: user } = await githubApi('/user', req.session.accessToken);
        const { data: orgs } = await githubApi('/user/orgs', req.session.accessToken);

        // Get all repos for detailed stats
        let allRepos = [];
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 10) { // Limit to 1000 repos
            const { data: repos } = await githubApi(
                `/user/repos?page=${page}&per_page=100&affiliation=owner`,
                req.session.accessToken
            );
            allRepos = allRepos.concat(repos);
            hasMore = repos.length === 100;
            page++;
        }

        const stats = {
            totalRepos: allRepos.length,
            publicRepos: allRepos.filter(r => !r.private).length,
            privateRepos: allRepos.filter(r => r.private).length,
            forks: allRepos.filter(r => r.fork).length,
            sources: allRepos.filter(r => !r.fork).length,
            archived: allRepos.filter(r => r.archived).length,
            organizations: orgs.length,
            user: {
                login: user.login,
                avatar_url: user.avatar_url,
                public_repos: user.public_repos,
                total_private_repos: user.total_private_repos
            }
        };

        res.json(stats);
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ============ START SERVER ============

app.listen(PORT, () => {
    console.log(`\n🚀 GitHub Repo Manager API running on http://localhost:${PORT}`);
    console.log(`   Frontend URL: ${FRONTEND_URL}`);
    console.log(`   GitHub Client ID: ${GITHUB_CLIENT_ID.substring(0, 8)}...`);
    console.log(`\n   Endpoints:`);
    console.log(`   - GET  /api/user          User info`);
    console.log(`   - GET  /api/repos         List repos`);
    console.log(`   - GET  /api/orgs          List organizations`);
    console.log(`   - GET  /api/orgs/:org/repos  Org repos`);
    console.log(`   - POST /api/visibility    Change visibility`);
    console.log(`   - POST /api/transfer      Transfer to org`);
    console.log(`   - POST /api/mirror        Fork to org`);
    console.log(`   - POST /api/archive       Archive repos`);
    console.log(`   - POST /api/delete        Delete repos`);
    console.log(`   - POST /api/import-azure  Import from Azure DevOps`);
    console.log(`   - GET  /api/stats         Dashboard stats`);
    console.log(`\n   Start the frontend with: npm run dev\n`);
});

