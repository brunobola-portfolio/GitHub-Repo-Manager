/*
 * GitHub Repo Manager - Backend Server
 * 
 * Built with Express.js, this server handles GitHub OAuth authentication
 * and acts as a secure proxy for GitHub API operations.
 * 
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { GoogleGenerativeAI } from '@google/generative-ai';
import db, { initDB, seedMockData } from './db.js';
import { aiService } from './ai-service.js';
import { actionsService } from './actions-service.js';
import { communityHealthService } from './community-health-service.js';

dotenv.config();

initDB();

// Seed mock data if in mock mode (for demo/development)
if (process.env.VITE_MOCK_MODE !== 'false') {
    seedMockData();
}

const app = express();
const PORT = process.env.PORT || 3001;

// Stats cache implementation
const statsCache = new Map();

// Environment Configuration
const {
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    SESSION_SECRET = 'dev-secret-change-in-production',
    FRONTEND_URL = 'http://localhost:5173',
    GEMINI_API_KEY
} = process.env;

// Initialize Google AI only if key is present
if (GEMINI_API_KEY) {
    try {
        aiService.initialize(GEMINI_API_KEY);
    } catch (e) {
        console.error('Failed to initialize Google AI:', e.message);
    }
}

// Enforce SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && SESSION_SECRET === 'dev-secret-change-in-production') {
    console.error('FATAL: SESSION_SECRET must be set in production. Exiting.');
    process.exit(1);
}

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.warn('⚠️ Warning: GitHub OAuth credentials are missing.');
    console.warn('   OAuth login will not work. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env to enable.');
}

// Middleware Setup
app.use(helmet({
    contentSecurityPolicy: false, // Let Vite handle CSP in dev
    crossOriginEmbedderPolicy: false // Allow embedded resources
}));
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // Stricter limit for auth endpoints
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts, please try again later.' }
});
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);

// Session configuration for secure auth persistence
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

/**
 * Validate GitHub username format.
 * GitHub usernames: alphanumeric, hyphens, max 39 chars, no consecutive hyphens.
 */
function isValidGitHubUsername(username) {
    return typeof username === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(username);
}

/**
 * Sanitize error for client response (avoid leaking internals).
 */
function safeError(error, fallbackMessage = 'An internal error occurred') {
    if (process.env.NODE_ENV === 'production') {
        return fallbackMessage;
    }
    return error?.message || fallbackMessage;
}

/**
 * In-memory ETag cache for GitHub API conditional requests.
 * Stores URL -> { etag, data } mappings. Conditional requests returning
 * 304 Not Modified do not count against the GitHub rate limit.
 */
const etagCache = new Map();

/**
 * GitHub API rate limit tracking.
 * Updated after every GitHub API response from X-RateLimit-* headers.
 */
let rateLimitInfo = { remaining: null, reset: null };

/**
 * Wrapper for GitHub API calls.
 * Handles authentication headers, API versioning, ETag-based conditional
 * requests, rate limit tracking, and standardized error parsing.
 *
 * @param {string} path - The API endpoint path (e.g., '/user/repos')
 * @param {string} token - The user's OAuth access token
 * @param {object} options - Fetch options (method, body, etc.)
 */
async function githubApi(path, token, options = {}) {
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;

    // Rate limit pre-check: if we know we're exhausted, wait or throw
    if (rateLimitInfo.remaining !== null && rateLimitInfo.remaining <= 0 && rateLimitInfo.reset !== null) {
        const now = Math.floor(Date.now() / 1000);
        if (now < rateLimitInfo.reset) {
            const waitSeconds = rateLimitInfo.reset - now;
            if (waitSeconds <= 60) {
                // Short wait - sleep until reset
                console.warn(`[GitHub API] Rate limit exhausted. Waiting ${waitSeconds}s for reset...`);
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            } else {
                const resetDate = new Date(rateLimitInfo.reset * 1000).toISOString();
                throw new Error(`GitHub API rate limit exhausted. Resets at ${resetDate} (${waitSeconds}s). Please try again later.`);
            }
        }
    }

    // Build request headers
    const requestHeaders = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...options.headers
    };

    // ETag conditional request: only for GET requests (or requests with no method specified)
    const method = (options.method || 'GET').toUpperCase();
    const cached = etagCache.get(url);
    if (method === 'GET' && cached?.etag) {
        requestHeaders['If-None-Match'] = cached.etag;
    }

    const res = await fetch(url, {
        ...options,
        headers: requestHeaders
    });

    // Track rate limit info from response headers
    const remainingHeader = res.headers.get('X-RateLimit-Remaining');
    const resetHeader = res.headers.get('X-RateLimit-Reset');
    if (remainingHeader !== null) {
        rateLimitInfo.remaining = parseInt(remainingHeader, 10);
    }
    if (resetHeader !== null) {
        rateLimitInfo.reset = parseInt(resetHeader, 10);
    }
    if (rateLimitInfo.remaining !== null && rateLimitInfo.remaining < 100) {
        const resetDate = rateLimitInfo.reset ? new Date(rateLimitInfo.reset * 1000).toISOString() : 'unknown';
        console.warn(`[GitHub API] Rate limit low: ${rateLimitInfo.remaining} requests remaining. Resets at ${resetDate}`);
    }

    // Handle 304 Not Modified - return cached data (does not count against rate limit)
    if (res.status === 304 && cached?.data) {
        return { data: cached.data, headers: res.headers };
    }

    // Attempt to parse JSON, but handle empty responses gracefully
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const error = new Error(data?.message || `GitHub API error: ${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
    }

    // Cache the ETag and response data for future conditional requests
    const responseEtag = res.headers.get('ETag');
    if (method === 'GET' && responseEtag) {
        etagCache.set(url, { etag: responseEtag, data });
    }

    return { data, headers: res.headers };
}


// Initiates the GitHub OAuth flow
app.get('/api/auth/login', (req, res) => {
    // Scopes needed:
    // - repo: Full control of private repositories
    // - delete_repo: Ability to delete repositories
    // - read:org, admin:org: Manage organization memberships and repos
    const scope = 'repo delete_repo read:org admin:org';
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/callback`;
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`;
    res.redirect(authUrl);
});

// Handles the callback from GitHub
app.get('/api/auth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.redirect(`${FRONTEND_URL}?error=no_code`);
    }

    try {
        // Exchange the temporary code for a persistent access token
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

        if (!tokenRes.ok) {
            throw new Error('Failed to exchange code for token');
        }

        const tokenData = await tokenRes.json();

        if (tokenData.error) {
            return res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent(tokenData.error)}`);
        }

        // Fetch User Profile to sync with DB
        const userRes = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            }
        });

        if (userRes.ok) {
            const userData = await userRes.json();
            // Upsert User
            const stmt = db.prepare(`
                INSERT INTO users (id, username, avatar_url, email, last_login)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(id) DO UPDATE SET
                    username = excluded.username,
                    avatar_url = excluded.avatar_url,
                    email = excluded.email,
                    last_login = CURRENT_TIMESTAMP
            `);
            stmt.run(userData.id, userData.login, userData.avatar_url, userData.email || null);

            // Store user ID in session for DB lookups
            req.session.userId = userData.id;
        }

        // Store the token in the session
        req.session.accessToken = tokenData.access_token;

        req.session.save((err) => {
            if (err) {
                console.error('Session save failed:', err);
                return res.redirect(`${FRONTEND_URL}?error=session_error`);
            }
            res.redirect(FRONTEND_URL);
        });

    } catch (error) {
        console.error('OAuth Callback Error:', error);
        res.redirect(`${FRONTEND_URL}?error=auth_failed`);
    }
});

// Check current session
app.get('/api/auth/session', (req, res) => {
    if (req.session.accessToken) {
        res.json({
            authenticated: true,
            userId: req.session.userId,
            accessToken: req.session.accessToken
        });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Mock Login for Dev Mode
app.post('/api/auth/mock', (req, res) => {
    // Upsert Mock User
    const mockUser = {
        id: 999999,
        username: 'dev-user',
        avatar_url: 'https://github.com/ghost.png',
        email: 'dev@example.com'
    };

    const stmt = db.prepare(`
        INSERT INTO users (id, username, avatar_url, email, last_login)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            username = excluded.username,
            avatar_url = excluded.avatar_url,
            email = excluded.email,
            last_login = CURRENT_TIMESTAMP
    `);
    stmt.run(mockUser.id, mockUser.username, mockUser.avatar_url, mockUser.email);

    req.session.userId = mockUser.id;
    req.session.accessToken = 'mock_token';
    req.session.save(() => res.json({ success: true, user: mockUser }));
});

// ------------------------------------------------------------------
// User & Repository Routes
// ------------------------------------------------------------------

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Middleware to check if AI is configured
const requireAI = (req, res, next) => {
    if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
            error: 'AI_NOT_CONFIGURED',
            message: 'AI features are not configured. Please set GEMINI_API_KEY in server/.env file.'
        });
    }

    if (!aiService.genAI) {
        return res.status(503).json({
            error: 'AI_NOT_INITIALIZED',
            message: 'AI service failed to initialize. Please check your GEMINI_API_KEY.'
        });
    }

    req.genAI = aiService.genAI;
    next();
};

// Check AI Configuration Status
app.get('/api/config/ai-status', (req, res) => {
    res.json({
        configured: !!process.env.GEMINI_API_KEY
    });
});

// Search GitHub Users
app.get('/api/search/users', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const { data } = await githubApi(`/search/users?q=${encodeURIComponent(q)}&per_page=5`, req.session.accessToken);
        res.json(data.items || []);
    } catch (error) {
        console.error('User Search Error:', error);
        res.status(500).json({ error: 'Failed to search users' });
    }
});
// ------------------------------------------------------------------

app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi('/user', req.session.accessToken);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

app.get('/api/activity', requireAuth, async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: 'Username required' });
        if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });

        const { data } = await githubApi(`/users/${username}/events`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

app.get('/api/repos', requireAuth, async (req, res) => {
    try {
        const page = req.query.page || 1;
        const perPage = req.query.per_page || 30;
        const org = req.query.org || '';

        let endpoint;
        if (org && org !== '') {
            // Specific organization - fetch org repos
            endpoint = `/orgs/${org}/repos?page=${page}&per_page=${perPage}&sort=updated`;
        } else {
            // All repos - include personal + organization membership
            // FIXED: Changed from affiliation=owner to affiliation=owner,organization_member
            endpoint = `/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner,organization_member`;
        }

        const { data, headers } = await githubApi(endpoint, req.session.accessToken);

        // Extract pagination info from the Link header
        const linkHeader = headers.get('link');
        let totalPages = null;
        if (linkHeader) {
            const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (lastMatch) totalPages = parseInt(lastMatch[1]);
        }

        res.json({ repos: data, page: parseInt(page), totalPages });
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const { org } = req.query;
        const userId = req.session.userId;

        // Get cache TTL from header (in minutes), default to 5 minutes
        const cacheTTLMinutes = parseInt(req.headers['x-cache-ttl']) || 5;
        const cacheTTL = cacheTTLMinutes * 60 * 1000; // Convert to milliseconds

        // Create cache key unique to user and org
        const cacheKey = `stats:${userId}:${org || 'personal'}`;

        // Check cache
        const cached = statsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cacheTTL) {
            res.setHeader('X-Cache-Hit', 'true');
            return res.json(cached.data);
        }

        res.setHeader('X-Cache-Hit', 'false');

        let repos = [];
        let page = 1;
        let hasNextPage = true;

        // Fetch all repos to calculate stats (handling pagination)
        while (hasNextPage && repos.length < 1000) { // Safety limit
            const endpoint = org
                ? `/orgs/${org}/repos?page=${page}&per_page=100&sort=updated`
                : `/user/repos?page=${page}&per_page=100&sort=updated&affiliation=owner,organization_member`;

            const { data, headers } = await githubApi(endpoint, req.session.accessToken);
            repos = [...repos, ...data];

            const linkHeader = headers.get('link');
            hasNextPage = linkHeader && linkHeader.includes('rel="next"');
            page++;
        }

        const stats = {
            totalRepos: repos.length,
            publicRepos: repos.filter(r => !r.private).length,
            privateRepos: repos.filter(r => r.private).length,
            forks: repos.filter(r => r.fork).length,
            sources: repos.filter(r => !r.fork).length,
            archived: repos.filter(r => r.archived).length,
            totalStars: repos.reduce((acc, r) => acc + r.stargazers_count, 0),
            totalForks: repos.reduce((acc, r) => acc + r.forks_count, 0),
            languages: {}
        };

        // Calculate language distribution
        repos.forEach(repo => {
            if (repo.language) {
                stats.languages[repo.language] = (stats.languages[repo.language] || 0) + 1;
            }
        });

        // Cache the results
        statsCache.set(cacheKey, {
            data: stats,
            timestamp: Date.now()
        });

        res.json(stats);
    } catch (error) {
        console.error('Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Clear stats cache
app.post('/api/stats/clear-cache', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        let cleared = 0;

        // Clear all cache entries for this user
        for (const key of statsCache.keys()) {
            if (key.startsWith(`stats:${userId}:`)) {
                statsCache.delete(key);
                cleared++;
            }
        }

        res.json({ success: true, cleared });
    } catch (error) {
        console.error('Cache Clear Error:', error);
        res.status(500).json({ error: 'Failed to clear cache' });
    }
});

// Enhanced Global Stats with Actions, PRs, Issues
app.get('/api/stats/global', requireAuth, async (req, res) => {
    try {
        const { org } = req.query;
        let repos = [];
        let page = 1;
        let hasNextPage = true;

        // Fetch all repos
        while (hasNextPage && repos.length < 1000) {
            const endpoint = org
                ? `/orgs/${org}/repos?page=${page}&per_page=100&sort=updated`
                : `/user/repos?page=${page}&per_page=100&sort=updated&affiliation=owner,organization_member`;

            const { data, headers } = await githubApi(endpoint, req.session.accessToken);
            repos = [...repos, ...data];

            const linkHeader = headers.get('link');
            hasNextPage = linkHeader && linkHeader.includes('rel="next"');
            page++;
        }

        const stats = {
            totalRepos: repos.length,
            publicRepos: repos.filter(r => !r.private).length,
            privateRepos: repos.filter(r => r.private).length,
            forks: repos.filter(r => r.fork).length,
            sources: repos.filter(r => !r.fork).length,
            archived: repos.filter(r => r.archived).length,
            totalStars: repos.reduce((acc, r) => acc + r.stargazers_count, 0),
            totalForks: repos.reduce((acc, r) => acc + r.forks_count, 0),
            totalWatchers: repos.reduce((acc, r) => acc + r.watchers_count, 0),
            hasIssues: repos.filter(r => r.has_issues).length,
            hasWiki: repos.filter(r => r.has_wiki).length,
            hasProjects: repos.filter(r => r.has_projects).length,
            languages: {},
            // Flags for conditional rendering
            hasActions: false,
            healthAnalyzed: 0
        };

        // Calculate language distribution
        repos.forEach(repo => {
            if (repo.language) {
                stats.languages[repo.language] = (stats.languages[repo.language] || 0) + 1;
            }
        });

        // Check if any repo has GitHub Actions (by checking workflow_runs table)
        const actionsCount = db.prepare('SELECT COUNT(DISTINCT repo_id) as count FROM workflow_runs').get();
        stats.hasActions = actionsCount.count > 0;

        // Check how many repos have been analyzed for health
        const healthCount = db.prepare('SELECT COUNT(*) as count FROM community_health_cache WHERE analyzed_at IS NOT NULL').get();
        stats.healthAnalyzed = healthCount.count;

        res.json(stats);
    } catch (error) {
        console.error('Global Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch global statistics' });
    }
});

// Actions Summary across all repos
app.get('/api/stats/actions', requireAuth, async (req, res) => {
    try {
        const { days = 30, org } = req.query;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - parseInt(days));

        let query = `
            SELECT
                COUNT(*) as total_runs,
                SUM(CASE WHEN conclusion = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN conclusion = 'failure' THEN 1 ELSE 0 END) as failure_count,
                SUM(CASE WHEN conclusion = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
                AVG(duration_seconds) as avg_duration,
                MAX(started_at) as last_run_at
            FROM workflow_runs
            WHERE started_at >= ?
        `;

        const stats = db.prepare(query).get(cutoff.toISOString());

        const successRate = stats.total_runs > 0
            ? (stats.success_count / stats.total_runs) * 100
            : 0;

        res.json({
            totalRuns: stats.total_runs || 0,
            successCount: stats.success_count || 0,
            failureCount: stats.failure_count || 0,
            cancelledCount: stats.cancelled_count || 0,
            successRate: +successRate.toFixed(2),
            avgDuration: Math.round(stats.avg_duration || 0),
            lastRunAt: stats.last_run_at
        });
    } catch (error) {
        console.error('Actions Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch actions statistics' });
    }
});

// ------------------------------------------------------------------
// Bulk Operations
// ------------------------------------------------------------------

app.post('/api/visibility', requireAuth, async (req, res) => {
    const { repos, makePublic } = req.body;

    if (!repos?.length) return res.status(400).json({ error: 'No repositories specified' });

    const results = [];

    // Process sequentially to avoid hitting rate limits too hard
    for (const repoFullName of repos) {
        try {
            console.log(`[Visibility] Toggling ${repoFullName} to public=${makePublic}`);
            const response = await githubApi(`/repos/${repoFullName}`, req.session.accessToken, {
                method: 'PATCH',
                body: JSON.stringify({ private: !makePublic })
            });
            console.log(`[Visibility] Success for ${repoFullName}:`, response);
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            console.error(`[Visibility] Failed for ${repoFullName}:`, error);
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Successfully changed visibility for ${successCount} repositories.`,
        results
    });
});

app.post('/api/transfer', requireAuth, async (req, res) => {
    const { repos, toOrg } = req.body;

    if (!repos?.length || !toOrg) return res.status(400).json({ error: 'Missing repositories or target organization' });

    const results = [];

    for (const repoFullName of repos) {
        try {
            await githubApi(`/repos/${repoFullName}/transfer`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ new_owner: toOrg })
            });
            results.push({ repo: repoFullName, success: true });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Transferred ${successCount} repositories to ${toOrg}.`,
        results
    });
});

app.post('/api/mirror', requireAuth, async (req, res) => {
    const { repos, toOrg } = req.body;

    if (!repos?.length || !toOrg) return res.status(400).json({ error: 'Missing repositories or target organization' });

    const results = [];

    for (const repoFullName of repos) {
        try {
            const { data } = await githubApi(`/repos/${repoFullName}/forks`, req.session.accessToken, {
                method: 'POST',
                body: JSON.stringify({ organization: toOrg })
            });
            results.push({ repo: repoFullName, success: true, mirrorUrl: data.html_url });
        } catch (error) {
            results.push({ repo: repoFullName, success: false, error: error.message });
        }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
        message: `Mirrored ${successCount} repositories to ${toOrg}.`,
        results
    });
});

// ------------------------------------------------------------------
// Organization Management
// ------------------------------------------------------------------

app.get('/api/orgs', requireAuth, async (req, res) => {
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

        // 5. Enrich organization data with repo counts
        const orgsWithCounts = await Promise.all(orgs.map(async (org) => {
            try {
                const { data: orgDetails } = await githubApi(`/orgs/${org.login}`, req.session.accessToken);
                return {
                    ...org,
                    public_repos: orgDetails.public_repos || 0,
                    total_private_repos: orgDetails.total_private_repos || 0,
                    isPersonal: false
                };
            } catch {
                return { ...org, isPersonal: false };
            }
        }));

        // 6. Return personal account FIRST, then organizations
        res.json([personalAccount, ...orgsWithCounts]);
    } catch (error) {
        console.error('Error fetching organizations:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

app.get('/api/orgs/:org', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

app.patch('/api/orgs/:org', requireAuth, async (req, res) => {
    try {
        const { data } = await githubApi(`/orgs/${req.params.org}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify(req.body)
        });
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

app.get('/api/orgs/:org/repos', requireAuth, async (req, res) => {
    try {
        const page = req.query.page || 1;
        const perPage = req.query.per_page || 30;
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
        res.status(error.status || 500).json({ error: error.message });
    }
});

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
        res.status(error.status || 500).json({ error: error.message });
    }
});

// ------------------------------------------------------------------
// Archive & Delete
// ------------------------------------------------------------------

app.post('/api/archive', requireAuth, async (req, res) => {
    const { repos, archive = true } = req.body;

    if (!repos?.length) return res.status(400).json({ error: 'No repositories specified' });

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
        message: `${archive ? 'Archived' : 'Unarchived'} ${successCount} repositories.`,
        results
    });
});

app.post('/api/delete', requireAuth, async (req, res) => {
    const { repos } = req.body;

    if (!repos?.length) return res.status(400).json({ error: 'No repositories specified' });

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
        message: `Deleted ${successCount} repositories.`,
        results
    });
});

// -----------------------------------------------------------------------------

// AI Chat Endpoint
app.post('/api/ai/chat', requireAuth, requireAI, async (req, res) => {
    try {
        const { message, context } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: 'MESSAGE_REQUIRED',
                message: 'Please provide a message to send to the AI assistant.'
            });
        }
        
        // Use configured model from environment or default
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        let model;
        
        try {
            model = req.genAI.getGenerativeModel({ model: modelName });
        } catch (modelError) {
            console.error(`Failed to load model ${modelName}:`, modelError.message);
            return res.status(503).json({
                error: 'MODEL_UNAVAILABLE',
                message: `AI model "${modelName}" is not available. Please check your configuration.`,
                modelRequested: modelName
            });
        }

        const systemPrompt = `You are an expert GitHub Repository Manager Assistant.
    Your goal is to help users manage their repositories, analyze code, and suggest improvements.
    
    Current Context:
    ${JSON.stringify(context || {}, null, 2)}
    
    Be concise, professional, and helpful. Format your response in Markdown.`;

        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemPrompt }],
                },
                {
                    role: "model",
                    parts: [{ text: "Understood. I am ready to assist with GitHub repository management tasks." }],
                },
            ],
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const text = response.text();

        res.json({ message: text });
    } catch (error) {
        console.error('AI Chat Error:', error);
        
        // User-friendly error handling
        if (error.message?.includes('not found') || error.status === 404) {
            return res.status(404).json({
                error: 'MODEL_NOT_FOUND',
                message: `The AI model "${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}" is not available. Please verify your GEMINI_MODEL configuration in .env file.`,
                suggestion: 'Try using: gemini-2.0-flash-exp, gemini-1.5-flash, or gemini-1.5-pro'
            });
        }
        
        if (error.message?.includes('API key') || error.status === 401) {
            return res.status(401).json({
                error: 'INVALID_API_KEY',
                message: 'Invalid or expired Gemini API key. Please check your GEMINI_API_KEY in .env file.'
            });
        }
        
        if (error.message?.includes('quota') || error.status === 429) {
            return res.status(429).json({
                error: 'QUOTA_EXCEEDED',
                message: 'API quota exceeded. Please try again later or check your Gemini API usage limits.'
            });
        }
        
        res.status(500).json({
            error: 'AI_REQUEST_FAILED',
            message: 'Failed to generate AI response. Please try again later.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// AI Suggestions Endpoint
app.post('/api/ai/suggest', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;
        
        if (!repo) {
            return res.status(400).json({
                error: 'REPO_REQUIRED',
                message: 'Repository data is required for suggestions.'
            });
        }
        
        // Use configured model from environment or default
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        let model;
        
        try {
            model = req.genAI.getGenerativeModel({ model: modelName });
        } catch (modelError) {
            console.error(`Failed to load model ${modelName}:`, modelError.message);
            return res.status(503).json({
                error: 'MODEL_UNAVAILABLE',
                message: `AI model "${modelName}" is not available. Please check your configuration.`,
                modelRequested: modelName
            });
        }

        const prompt = `Analyze this GitHub repository metadata and suggest 3 concrete improvements.
    Focus on: Description clarity, Topics (SEO), and Community standards (License, Contributing).
    
    Repository: ${JSON.stringify(repo, null, 2)}
    
    Return the response as a JSON object with this structure:
    {
      "suggestions": [
        { "title": "...", "description": "...", "type": "improvement" }
      ],
      "analysis": "Brief summary of the repo's current state"
    }
    Do not include markdown formatting in the JSON output, just raw JSON.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();

        res.json(JSON.parse(text));
    } catch (error) {
        console.error('AI Suggest Error:', error);
        
        // User-friendly error handling
        if (error.message?.includes('not found') || error.status === 404) {
            return res.status(404).json({
                error: 'MODEL_NOT_FOUND',
                message: `The AI model "${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}" is not available. Please verify your GEMINI_MODEL configuration in .env file.`,
                suggestion: 'Try using: gemini-2.0-flash-exp, gemini-1.5-flash, or gemini-1.5-pro'
            });
        }
        
        if (error.message?.includes('API key') || error.status === 401) {
            return res.status(401).json({
                error: 'INVALID_API_KEY',
                message: 'Invalid or expired Gemini API key. Please check your GEMINI_API_KEY in .env file.'
            });
        }
        
        if (error.message?.includes('quota') || error.status === 429) {
            return res.status(429).json({
                error: 'QUOTA_EXCEEDED',
                message: 'API quota exceeded. Please try again later or check your Gemini API usage limits.'
            });
        }
        
        res.status(500).json({
            error: 'AI_REQUEST_FAILED',
            message: 'Failed to generate suggestions. Please try again later.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// AI README Generator Endpoint
app.post('/api/ai/readme', requireAuth, requireAI, async (req, res) => {
    try {
        const { name, description, language, topics } = req.body;
        const prompt = `Generate a professional, high-quality README.md for a GitHub repository.
    
    Project Name: ${name}
    Description: ${description || 'No description provided.'}
    Primary Language: ${language || 'Not specified'}
    Topics: ${topics?.join(', ') || 'None'}
    
    Structure:
    1. Title & Badges
    2. Project Description (Expanded)
    3. Key Features
    4. Installation & Usage
    5. Contributing
    6. License
    
    Make it sound exciting and professional.`;

        const result = await aiService.model.generateContent(prompt);
        const text = result.response.text();

        res.json({ readme: text });
    } catch (error) {
        console.error('AI README Error:', error);
        res.status(500).json({ error: 'Failed to generate README' });
    }
});

// New AI Indexing & Search Endpoints

// Trigger Indexing (Summarize + Embed)
app.post('/api/ai/index', requireAuth, requireAI, async (req, res) => {
    const { repo } = req.body; // Full repo object from GitHub
    if (!repo) return res.status(400).json({ error: 'Repo data required' });

    try {
        console.log(`[AI Index] processing ${repo.full_name}...`);

        // 1. Fetch README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            console.warn(`No README for ${repo.full_name}`);
        }

        // 2. Fetch File Structure (Tree) -> getting top 20 items to save tokens
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            console.warn(`Could not fetch contents for ${repo.full_name}`);
        }

        // 3. Generate Analysis (Summary, Health Score, Topics)
        const analysis = await aiService.analyzeRepo(repo, readmeContent, fileStructure);

        // 4. Generate Embedding (Description + Summary + Readme excerpt)
        const textToEmbed = `${repo.name} ${repo.description || ''} ${analysis.summary} ${analysis.suggested_topics.join(' ')}`;
        const embedding = await aiService.embedText(textToEmbed);

        // 5. Save to DB
        const stmtMeta = db.prepare(`
            INSERT INTO repo_metadata (repo_id, summary, topics, health_score, last_indexed)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(repo_id) DO UPDATE SET
                summary = excluded.summary,
                topics = excluded.topics,
                health_score = excluded.health_score,
                last_indexed = CURRENT_TIMESTAMP
        `);

        const stmtEmbed = db.prepare(`
            INSERT INTO repo_embeddings (repo_id, embedding, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(repo_id) DO UPDATE SET
                embedding = excluded.embedding,
                updated_at = CURRENT_TIMESTAMP
        `);

        db.transaction(() => {
            stmtMeta.run(repo.id, analysis.summary, JSON.stringify(analysis.suggested_topics), analysis.health_score);
            stmtEmbed.run(repo.id, JSON.stringify(embedding));
        })();

        res.json({ success: true, analysis });

    } catch (error) {
        console.error('Indexing failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Semantic Search Endpoint
app.get('/api/ai/search', requireAuth, requireAI, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);

    try {
        // Get generic results (repo_ids and scores)
        const results = await aiService.semanticSearch(q, 10);

        if (results.length === 0) return res.json([]);

        // Determine which IDs to fetch
        const repoIds = results.map(r => r.repo_id);

        // We technically need the full repo object. 
        // In a real app we'd fetch from local cache or specific GH endpoints.
        // For now, we will just return the IDs and let the frontend match them with what it has,
        // OR we can fetch metadata from our local DB.

        const placeholders = repoIds.map(() => '?').join(',');
        const metas = db.prepare(`SELECT * FROM repo_metadata WHERE repo_id IN (${placeholders})`).all(...repoIds);

        // Merge score + metadata
        const enriched = results.map(r => {
            const meta = metas.find(m => m.repo_id === r.repo_id);
            return { ...r, ...meta };
        });

        res.json(enriched);

    } catch (error) {
        console.error('Semantic search failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Cached Metadata for a Repo
app.get('/api/ai/metadata/:repoId', requireAuth, (req, res) => {
    try {
        const meta = db.prepare('SELECT * FROM repo_metadata WHERE repo_id = ?').get(req.params.repoId);
        res.json(meta || null);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enhanced README endpoint - Improve existing README
app.post('/api/ai/readme/enhance', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

        // Fetch current README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            console.warn(`No README for ${repo.full_name}`);
        }

        // Fetch file structure
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            console.warn(`Could not fetch contents for ${repo.full_name}`);
        }

        const result = await aiService.enhanceReadme(readmeContent, repo, fileStructure);
        res.json({ success: true, ...result, currentReadme: readmeContent });

    } catch (error) {
        console.error('README Enhancement Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Quality Report - Comprehensive repo health analysis
app.post('/api/ai/quality-report', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

        // Fetch README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) { /* No README */ }

        // Fetch file structure
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) { /* No contents */ }

        const report = await aiService.generateQualityReport(repo, readmeContent, fileStructure);
        res.json({ success: true, report, repo: repo.full_name });

    } catch (error) {
        console.error('Quality Report Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Batch Index - Index multiple repos at once
app.post('/api/ai/batch-index', requireAuth, requireAI, async (req, res) => {
    const { repos } = req.body; // Array of repo objects
    if (!repos || !Array.isArray(repos)) {
        return res.status(400).json({ error: 'Array of repos required' });
    }

    const results = [];
    const limit = Math.min(repos.length, 10); // Max 10 at a time

    // Prepare statements outside the loop for better performance
    const insertMetadata = db.prepare(`
        INSERT INTO repo_metadata (repo_id, summary, topics, health_score, last_indexed)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(repo_id) DO UPDATE SET
            summary = excluded.summary, topics = excluded.topics,
            health_score = excluded.health_score, last_indexed = CURRENT_TIMESTAMP
    `);

    const insertEmbedding = db.prepare(`
        INSERT INTO repo_embeddings (repo_id, embedding, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(repo_id) DO UPDATE SET embedding = excluded.embedding, updated_at = CURRENT_TIMESTAMP
    `);

    // Transaction wrapper for batch inserts (100x faster than individual inserts)
    const batchInsertRepos = db.transaction((repoDataArray) => {
        for (const repoData of repoDataArray) {
            insertMetadata.run(
                repoData.repo.id,
                repoData.analysis.summary,
                JSON.stringify(repoData.analysis.suggested_topics),
                repoData.analysis.health_score
            );
            insertEmbedding.run(
                repoData.repo.id,
                JSON.stringify(repoData.embedding)
            );
        }
    });

    // Collect analyzed data for batch insert
    const analyzedRepos = [];

    for (let i = 0; i < limit; i++) {
        const repo = repos[i];
        try {
            // Fetch README
            let readmeContent = '';
            try {
                const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
                readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
            } catch (e) { /* No README */ }

            // Fetch file structure
            let fileStructure = [];
            try {
                const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
                fileStructure = data.map(f => ({ name: f.name, type: f.type }));
            } catch (e) { /* No contents */ }

            // Generate analysis
            const analysis = await aiService.analyzeRepo(repo, readmeContent, fileStructure);

            // Generate embedding
            const textToEmbed = `${repo.name} ${repo.description || ''} ${analysis.summary} ${analysis.suggested_topics?.join(' ') || ''}`;
            const embedding = await aiService.embedText(textToEmbed);

            // Store for batch insert
            analyzedRepos.push({ repo, analysis, embedding });
            results.push({ repo: repo.full_name, success: true, health_score: analysis.health_score });

        } catch (error) {
            console.error(`Batch index failed for ${repo.full_name}:`, error.message);
            results.push({ repo: repo.full_name, success: false, error: error.message });
        }
    }

    // Batch insert all successfully analyzed repos in a single transaction
    try {
        if (analyzedRepos.length > 0) {
            batchInsertRepos(analyzedRepos);
        }
    } catch (error) {
        console.error('Batch insert failed:', error);
        return res.status(500).json({ error: 'Failed to save indexed data', details: error.message });
    }

    res.json({
        success: true,
        processed: results.length,
        results,
        skipped: repos.length > 10 ? repos.length - 10 : 0
    });
});

// AI Status - Check if AI is configured
app.get('/api/config/ai-status', (req, res) => {
    const configured = !!process.env.GEMINI_API_KEY || !!aiService.model;
    res.json({ configured, provider: configured ? 'gemini' : null });
});

// -----------------------------------------------------------------------------
// Team & Collaboration Routes
// -----------------------------------------------------------------------------

// List my teams
app.get('/api/teams', requireAuth, (req, res) => {
    try {
        const teams = db.prepare(`
            SELECT t.*, tm.role,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
            (SELECT COUNT(*) FROM repo_assignments WHERE team_id = t.id) as repo_count
            FROM teams t
            JOIN team_members tm ON t.id = tm.team_id
            WHERE tm.user_id = ?
            ORDER BY t.created_at DESC
        `).all(req.session.userId);
        res.json(teams);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a team
app.post('/api/teams', requireAuth, (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    try {
        const result = db.transaction(() => {
            const insertTeam = db.prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)');
            const info = insertTeam.run(name, description, req.session.userId);
            const teamId = info.lastInsertRowid;

            const insertMember = db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)');
            insertMember.run(teamId, req.session.userId, 'owner');
            return teamId;
        })();

        res.json({ success: true, teamId: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update a team
app.put('/api/teams/:id', requireAuth, (req, res) => {
    const { name, description } = req.body;
    const { id } = req.params;

    try {
        // Verify ownership/admin
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(id, req.session.userId);
        if (!membership || membership.role === 'member') return res.status(403).json({ error: 'Admin access required' });

        const updateKey = db.prepare('UPDATE teams SET name = ?, description = ? WHERE id = ?');
        const info = updateKey.run(name, description, id);

        if (info.changes === 0) return res.status(404).json({ error: 'Team not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a team
app.delete('/api/teams/:id', requireAuth, (req, res) => {
    const { id } = req.params;

    try {
        // Verify ownership (only owner can delete)
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(id, req.session.userId);
        if (!membership || membership.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });

        const result = db.transaction(() => {
            db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
            db.prepare('DELETE FROM repo_assignments WHERE team_id = ?').run(id);
            const info = db.prepare('DELETE FROM teams WHERE id = ?').run(id);
            return info;
        })();

        if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get team details (members & repos)
app.get('/api/teams/:id', requireAuth, (req, res) => {
    try {
        // Verify membership
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!membership) return res.status(403).json({ error: 'Access denied' });

        const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
        const members = db.prepare(`
            SELECT u.id, u.username, u.avatar_url, tm.role, tm.joined_at
            FROM team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = ?
        `).all(req.params.id);

        const repos = db.prepare(`
            SELECT * FROM repo_assignments WHERE team_id = ?
        `).all(req.params.id);

        res.json({ team, members, repos, currentUserRole: membership.role });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add Member (Simulated Invite by Username)
app.post('/api/teams/:id/members', requireAuth, async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });

    try {
        // Check Admin/Owner permission
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!membership || membership.role === 'member') return res.status(403).json({ error: 'Admin access required' });

        // Check if user exists in our local DB
        // If not, we could search GitHub and add to cache, but for now strict local check or partial add
        let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

        // If user not found locally, try to fetch from GitHub to "cache" them
        if (!user) {
            try {
                const { data: ghUser } = await githubApi(`/users/${username}`, req.session.accessToken);
                db.prepare(`
                    INSERT INTO users (id, username, avatar_url, email)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET username=excluded.username
                `).run(ghUser.id, ghUser.login, ghUser.avatar_url, ghUser.email);
                user = { id: ghUser.id };
            } catch (e) {
                return res.status(404).json({ error: 'User not found on GitHub' });
            }
        }

        // Add to team
        db.prepare(`
            INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')
        `).run(req.params.id, user.id);

        res.json({ success: true });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'User is already a member' });
        }
        res.status(500).json({ error: error.message });
    }
});

// Update Member Role
app.put('/api/teams/:id/members/:userId', requireAuth, (req, res) => {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    try {
        // Check requester permissions (must be owner or admin)
        const requester = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Prevent changing owner's role
        const target = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.params.userId);
        if (target && target.role === 'owner') return res.status(403).json({ error: 'Cannot change owner role' });

        db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?')
            .run(role, req.params.id, req.params.userId);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remove Member
app.delete('/api/teams/:id/members/:userId', requireAuth, (req, res) => {
    try {
        // Check requester permissions
        const requester = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Prevent removing owner
        const target = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.params.userId);
        if (target && target.role === 'owner') return res.status(403).json({ error: 'Cannot remove owner' });

        // Check if removing self (leave team) vs removing others
        if (req.params.userId != req.session.userId) {
            if (requester.role === 'member') return res.status(403).json({ error: 'Cannot remove others' });
        }

        db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
            .run(req.params.id, req.params.userId);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Assign Repo to Team
app.post('/api/teams/:id/repos', requireAuth, (req, res) => {
    const { repoFullName, repoId } = req.body;
    try {
        // Verify membership
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!membership) return res.status(403).json({ error: 'Access denied' });

        db.prepare(`
            INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by)
            VALUES (?, ?, ?, ?)
        `).run(req.params.id, repoFullName, repoId, req.session.userId);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// GitHub Actions Endpoints

// List Workflows
app.get('/api/repos/:owner/:repo/actions/workflows', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/actions/workflows`, req.session.accessToken);
        res.json(result.data.workflows || []);
    } catch (error) {
        console.error('List Workflows Error:', error);
        res.status(500).json({ error: 'Failed to list workflows' });
    }
});

// Trigger Workflow Dispatch
app.post('/api/repos/:owner/:repo/actions/workflows/:id/dispatches', requireAuth, async (req, res) => {
    try {
        const { owner, repo, id } = req.params;
        const { ref = 'main', inputs = {} } = req.body;

        await githubApi(`/repos/${owner}/${repo}/actions/workflows/${id}/dispatches`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref, inputs })
        });

        res.json({ message: 'Workflow triggered successfully' });
    } catch (error) {
        console.error('Trigger Workflow Error:', error);
        res.status(500).json({ error: 'Failed to trigger workflow' });
    }
});

// List Workflow Runs
app.get('/api/repos/:owner/:repo/actions/runs', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const result = await githubApi(`/repos/${owner}/${repo}/actions/runs?per_page=10`, req.session.accessToken);
        res.json(result.data.workflow_runs || []);
    } catch (error) {
        console.error('List Workflow Runs Error:', error);
        res.status(500).json({ error: 'Failed to list workflow runs' });
    }
});

// -----------------------------------------------------------------------------
// Native GitHub Verification & Collaboration
// -----------------------------------------------------------------------------

// List Collaborators for a specific Repo
app.get('/api/repos/:owner/:repo/collaborators', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        // Requires push access to view collaborators usually, or at least read
        const result = await githubApi(`/repos/${owner}/${repo}/collaborators`, req.session.accessToken);
        res.json(result.data || []);
    } catch (error) {
        // 403 usually means you don't have permission to view collaborators (need push access)
        if (error.status === 403) {
            return res.json([]); // Fail gracefully by returning empty
        }
        res.status(500).json({ error: 'Failed to fetch collaborators' });
    }
});

// Add a Collaborator to a Repo
app.put('/api/repos/:owner/:repo/collaborators/:username', requireAuth, async (req, res) => {
    try {
        const { owner, repo, username } = req.params;
        if (!isValidGitHubUsername(username)) return res.status(400).json({ error: 'Invalid username format' });
        const { permission = 'push' } = req.body; // default to push (Write) access

        const result = await githubApi(`/repos/${owner}/${repo}/collaborators/${username}`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ permission })
        });

        res.json({ success: true, invitation: result.data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add collaborator' });
    }
});

// Team Activity Stream
// Aggregates events from all repos assigned to the team
app.get(['/api/teams/:id/activity', '/api/team/:id/activity'], requireAuth, async (req, res) => {
    try {
        // 1. Get Repos assigned to team
        const repos = db.prepare('SELECT repo_full_name FROM repo_assignments WHERE team_id = ?').all(req.params.id);

        if (!repos.length) {
            return res.json([]);
        }

        // 2. Fetch events for each repo (Limit to first 10 repos to avoid rate limits/timeouts)
        // Uses batched fetching (3 at a time) with small delays to avoid rate limit spikes.
        const targetRepos = repos.slice(0, 10);
        const BATCH_SIZE = 3;
        const BATCH_DELAY_MS = 100;
        const results = [];

        for (let i = 0; i < targetRepos.length; i += BATCH_SIZE) {
            const batch = targetRepos.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map(async (r) => {
                    try {
                        const { data } = await githubApi(`/repos/${r.repo_full_name}/events?per_page=10`, req.session.accessToken);
                        return data.map(event => ({ ...event, repo_name: r.repo_full_name }));
                    } catch (e) {
                        console.error(`Failed to fetch events for ${r.repo_full_name}:`, e.message);
                        return [];
                    }
                })
            );
            results.push(...batchResults);

            // Small delay between batches to spread out rate limit usage
            if (i + BATCH_SIZE < targetRepos.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
        }

        // 3. Flatten, Deduplicate (by id), and Sort by Date
        const allEvents = results.flat();
        const uniqueEvents = Array.from(new Map(allEvents.map(item => [item.id, item])).values());

        uniqueEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        // Return top 50
        res.json(uniqueEvents.slice(0, 50));

    } catch (error) {
        console.error('Team Activity Error:', error);
        res.status(500).json({ error: 'Failed to fetch team activity' });
    }
});

// -----------------------------------------------------------------------------
// Actions Statistics Endpoints
// -----------------------------------------------------------------------------

// Sync workflow runs for a repository
app.post('/api/repos/:owner/:repo/actions/sync', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const repoFullName = `${owner}/${repo}`;
        
        const result = await actionsService.syncWorkflowRuns(repoFullName, req.session.accessToken);
        
        if (result.success) {
            res.json({ success: true, message: `Synced ${result.synced} workflow runs` });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Sync Workflow Runs Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get statistics for a repository
app.get('/api/repos/:owner/:repo/actions/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { days = 30 } = req.query;
        
        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;
        
        const stats = actionsService.getRepoStats(repoId, parseInt(days));
        const trends = actionsService.getDailyTrends(repoId, parseInt(days));
        
        res.json({ stats, trends, repo: `${owner}/${repo}` });
    } catch (error) {
        console.error('Get Actions Stats Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get workflow-specific statistics
app.get('/api/repos/:owner/:repo/workflows/:workflowId/stats', requireAuth, async (req, res) => {
    try {
        const { owner, repo, workflowId } = req.params;
        
        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;
        
        const stats = actionsService.getWorkflowStats(repoId, parseInt(workflowId));
        
        res.json(stats);
    } catch (error) {
        console.error('Get Workflow Stats Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get statistics for multiple repositories (team view)
app.post('/api/teams/:id/actions/stats', requireAuth, async (req, res) => {
    try {
        const { days = 30 } = req.body;
        
        const repos = db.prepare('SELECT repo_id, repo_full_name FROM repo_assignments WHERE team_id = ?')
            .all(req.params.id);
        
        if (repos.length === 0) {
            return res.json({ repos: [], teamAverages: {} });
        }
        
        const repoIds = repos.map(r => r.repo_id);
        const statsArray = actionsService.getMultiRepoStats(repoIds, parseInt(days));
        
        const enrichedStats = statsArray.map(stat => {
            const repo = repos.find(r => r.repo_id === stat.repoId);
            return {
                ...stat,
                repoFullName: repo?.repo_full_name || 'unknown'
            };
        });
        
        const teamAverages = {
            totalRuns: enrichedStats.reduce((sum, s) => sum + s.totalRuns, 0),
            avgSuccessRate: enrichedStats.length > 0
                ? +(enrichedStats.reduce((sum, s) => sum + s.successRate, 0) / enrichedStats.length).toFixed(2)
                : 0,
            avgDuration: enrichedStats.length > 0
                ? Math.round(enrichedStats.reduce((sum, s) => sum + s.avgDuration, 0) / enrichedStats.length)
                : 0
        };
        
        res.json({ repos: enrichedStats, teamAverages });
    } catch (error) {
        console.error('Get Team Actions Stats Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Webhook receiver for GitHub Actions events
app.post('/api/webhooks/actions', async (req, res) => {
    try {
        const payload = req.body;
        
        if (payload.action && payload.workflow_run) {
            actionsService.storeWorkflowRun(payload.workflow_run);
            actionsService.updateWorkflowMeta(
                payload.repository.id,
                payload.workflow_run.workflow_id
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Webhook Processing Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Community Health Endpoints
// -----------------------------------------------------------------------------

// Get community health analysis
app.get('/api/repos/:owner/:repo/community-health', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { refresh = false } = req.query;
        
        const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        const repoId = repoData.id;
        
        if (!refresh) {
            const cached = db.prepare('SELECT * FROM community_health_cache WHERE repo_id = ?').get(repoId);
            if (cached) {
                return res.json({
                    score: cached.health_score,
                    metrics: JSON.parse(cached.metrics),
                    recommendations: JSON.parse(cached.recommendations),
                    lastUpdated: cached.analyzed_at,
                    cached: true
                });
            }
        }
        
        const analysis = await communityHealthService.analyzeRepository(owner, repo, req.session.accessToken);
        communityHealthService.cacheResults(repoId, analysis.metrics, analysis.recommendations);
        
        res.json({
            score: analysis.metrics.healthScore,
            metrics: analysis.metrics,
            recommendations: analysis.recommendations,
            lastUpdated: analysis.analyzedAt,
            cached: false
        });
    } catch (error) {
        console.error('Community Health Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Compare community health for multiple repos
app.post('/api/community-health/compare', requireAuth, async (req, res) => {
    try {
        const { repos } = req.body;
        
        if (!repos || !Array.isArray(repos)) {
            return res.status(400).json({ error: 'Invalid repos array' });
        }
        
        const comparison = [];
        
        for (const repoFullName of repos) {
            const [owner, repo] = repoFullName.split('/');
            const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
            
            const cached = db.prepare('SELECT health_score FROM community_health_cache WHERE repo_id = ?')
                .get(repoData.id);
            
            comparison.push({
                repo: repoFullName,
                score: cached?.health_score || 0,
                hasCachedData: !!cached
            });
        }
        
        res.json({ comparison });
    } catch (error) {
        console.error('Compare Health Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Enhanced Repository Management
// -----------------------------------------------------------------------------

// Get single repository details
app.get('/api/repos/:owner/:repo', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get Repo Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Update repository settings
app.patch('/api/repos/:owner/:repo', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, description, homepage, private: isPrivate, has_issues, has_projects, has_wiki, default_branch, allow_squash_merge, allow_merge_commit, allow_rebase_merge, delete_branch_on_merge } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({
                name, description, homepage, private: isPrivate,
                has_issues, has_projects, has_wiki, default_branch,
                allow_squash_merge, allow_merge_commit, allow_rebase_merge,
                delete_branch_on_merge
            })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Repo Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Update repository topics
app.put('/api/repos/:owner/:repo/topics', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { names } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/topics`, req.session.accessToken, {
            method: 'PUT',
            headers: { 'Accept': 'application/vnd.github.mercy-preview+json' },
            body: JSON.stringify({ names })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Topics Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create repository from template
app.post('/api/repos/generate', requireAuth, async (req, res) => {
    try {
        const { template_owner, template_repo, owner, name, description, include_all_branches, private: isPrivate } = req.body;

        const { data } = await githubApi(`/repos/${template_owner}/${template_repo}/generate`, req.session.accessToken, {
            method: 'POST',
            headers: { 'Accept': 'application/vnd.github.baptiste-preview+json' },
            body: JSON.stringify({ owner, name, description, include_all_branches, private: isPrivate })
        });
        res.json({ success: true, repo: data });
    } catch (error) {
        console.error('Generate from Template Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Fork a repository
app.post('/api/repos/:owner/:repo/forks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { organization, name, default_branch_only } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/forks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ organization, name, default_branch_only })
        });
        res.json({ success: true, repo: data });
    } catch (error) {
        console.error('Fork Repo Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Branch Management
// -----------------------------------------------------------------------------

// List branches
app.get('/api/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { protected: protectedOnly, per_page = 100 } = req.query;

        let url = `/repos/${owner}/${repo}/branches?per_page=${per_page}`;
        if (protectedOnly) url += '&protected=true';

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Branches Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Get branch details
app.get('/api/repos/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${branch}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get Branch Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create branch (via Git refs)
app.post('/api/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, source_branch = 'main' } = req.body;

        // First get the SHA of the source branch
        const { data: refData } = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${source_branch}`, req.session.accessToken);
        const sha = refData.object.sha;

        // Create new branch
        const { data } = await githubApi(`/repos/${owner}/${repo}/git/refs`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ ref: `refs/heads/${name}`, sha })
        });
        res.json({ success: true, ref: data });
    } catch (error) {
        console.error('Create Branch Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Delete branch
app.delete('/api/repos/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: `Branch ${branch} deleted` });
    } catch (error) {
        console.error('Delete Branch Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Get branch protection
app.get('/api/repos/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        if (error.status === 404) {
            res.json({ protected: false });
        } else {
            console.error('Get Branch Protection Error:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    }
});

// Update branch protection
app.put('/api/repos/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        const { required_status_checks, enforce_admins, required_pull_request_reviews, restrictions } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({
                required_status_checks,
                enforce_admins,
                required_pull_request_reviews,
                restrictions
            })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Branch Protection Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Delete branch protection
app.delete('/api/repos/:owner/:repo/branches/:branch/protection', requireAuth, async (req, res) => {
    try {
        const { owner, repo, branch } = req.params;
        await githubApi(`/repos/${owner}/${repo}/branches/${branch}/protection`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Branch protection removed' });
    } catch (error) {
        console.error('Delete Branch Protection Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Tags and Releases
// -----------------------------------------------------------------------------

// List tags
app.get('/api/repos/:owner/:repo/tags', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { per_page = 30 } = req.query;
        const { data } = await githubApi(`/repos/${owner}/${repo}/tags?per_page=${per_page}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Tags Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// List releases
app.get('/api/repos/:owner/:repo/releases', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { per_page = 30 } = req.query;
        const { data } = await githubApi(`/repos/${owner}/${repo}/releases?per_page=${per_page}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Releases Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create release
app.post('/api/repos/:owner/:repo/releases', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/releases`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ tag_name, target_commitish, name, body, draft, prerelease, generate_release_notes })
        });
        res.json({ success: true, release: data });
    } catch (error) {
        console.error('Create Release Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Delete release
app.delete('/api/repos/:owner/:repo/releases/:release_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, release_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/releases/${release_id}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Release deleted' });
    } catch (error) {
        console.error('Delete Release Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Issues Management
// -----------------------------------------------------------------------------

// List issues
app.get('/api/repos/:owner/:repo/issues', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { state = 'open', labels, sort = 'created', direction = 'desc', per_page = 30 } = req.query;

        let url = `/repos/${owner}/${repo}/issues?state=${state}&sort=${sort}&direction=${direction}&per_page=${per_page}`;
        if (labels) url += `&labels=${encodeURIComponent(labels)}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Issues Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create issue
app.post('/api/repos/:owner/:repo/issues', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, labels, assignees, milestone } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, labels, assignees, milestone })
        });
        res.json({ success: true, issue: data });
    } catch (error) {
        console.error('Create Issue Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Update issue
app.patch('/api/repos/:owner/:repo/issues/:issue_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { title, body, state, labels, assignees, milestone } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ title, body, state, labels, assignees, milestone })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Issue Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Add issue comment
app.post('/api/repos/:owner/:repo/issues/:issue_number/comments', requireAuth, async (req, res) => {
    try {
        const { owner, repo, issue_number } = req.params;
        const { body } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/issues/${issue_number}/comments`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ body })
        });
        res.json({ success: true, comment: data });
    } catch (error) {
        console.error('Add Comment Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Pull Requests Management
// -----------------------------------------------------------------------------

// List pull requests
app.get('/api/repos/:owner/:repo/pulls', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { state = 'open', sort = 'created', direction = 'desc', per_page = 30 } = req.query;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls?state=${state}&sort=${sort}&direction=${direction}&per_page=${per_page}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List PRs Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create pull request
app.post('/api/repos/:owner/:repo/pulls', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { title, body, head, base, draft, maintainer_can_modify } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ title, body, head, base, draft, maintainer_can_modify })
        });
        res.json({ success: true, pull_request: data });
    } catch (error) {
        console.error('Create PR Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Merge pull request
app.put('/api/repos/:owner/:repo/pulls/:pull_number/merge', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { commit_title, commit_message, merge_method = 'merge' } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}/merge`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ commit_title, commit_message, merge_method })
        });
        res.json({ success: true, merged: data.merged, message: data.message });
    } catch (error) {
        console.error('Merge PR Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Update pull request
app.patch('/api/repos/:owner/:repo/pulls/:pull_number', requireAuth, async (req, res) => {
    try {
        const { owner, repo, pull_number } = req.params;
        const { title, body, state, base, maintainer_can_modify } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/pulls/${pull_number}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ title, body, state, base, maintainer_can_modify })
        });
        res.json(data);
    } catch (error) {
        console.error('Update PR Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Webhooks Management
// -----------------------------------------------------------------------------

// List webhooks
app.get('/api/repos/:owner/:repo/hooks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Webhooks Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create webhook
app.post('/api/repos/:owner/:repo/hooks', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { config, events, active = true } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ name: 'web', config, events, active })
        });
        res.json({ success: true, hook: data });
    } catch (error) {
        console.error('Create Webhook Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Update webhook
app.patch('/api/repos/:owner/:repo/hooks/:hook_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        const { config, events, active, add_events, remove_events } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}`, req.session.accessToken, {
            method: 'PATCH',
            body: JSON.stringify({ config, events, active, add_events, remove_events })
        });
        res.json(data);
    } catch (error) {
        console.error('Update Webhook Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Delete webhook
app.delete('/api/repos/:owner/:repo/hooks/:hook_id', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Webhook deleted' });
    } catch (error) {
        console.error('Delete Webhook Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Ping webhook (test)
app.post('/api/repos/:owner/:repo/hooks/:hook_id/pings', requireAuth, async (req, res) => {
    try {
        const { owner, repo, hook_id } = req.params;
        await githubApi(`/repos/${owner}/${repo}/hooks/${hook_id}/pings`, req.session.accessToken, {
            method: 'POST'
        });
        res.json({ success: true, message: 'Ping sent' });
    } catch (error) {
        console.error('Ping Webhook Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Repository Contents & Files
// -----------------------------------------------------------------------------

// Get file/directory contents (path is optional, use query param for nested paths)
app.get('/api/repos/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path = '', ref } = req.query;

        let url = `/repos/${owner}/${repo}/contents/${path}`;
        if (ref) url += `?ref=${ref}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Get Contents Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create/Update file (path in query param)
app.put('/api/repos/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path } = req.query;
        const { message, content, branch, sha } = req.body;

        if (!path) return res.status(400).json({ error: 'Path query parameter required' });

        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${path}`, req.session.accessToken, {
            method: 'PUT',
            body: JSON.stringify({ message, content, branch, sha })
        });
        res.json({ success: true, commit: data.commit, content: data.content });
    } catch (error) {
        console.error('Create/Update File Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Delete file (path in query param)
app.delete('/api/repos/:owner/:repo/contents', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { path } = req.query;
        const { message, sha, branch } = req.body;

        if (!path) return res.status(400).json({ error: 'Path query parameter required' });

        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${path}`, req.session.accessToken, {
            method: 'DELETE',
            body: JSON.stringify({ message, sha, branch })
        });
        res.json({ success: true, commit: data.commit });
    } catch (error) {
        console.error('Delete File Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Get README
app.get('/api/repos/:owner/:repo/readme', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        if (error.status === 404) {
            res.json({ exists: false });
        } else {
            console.error('Get README Error:', error);
            res.status(error.status || 500).json({ error: error.message });
        }
    }
});

// -----------------------------------------------------------------------------
// Labels Management
// -----------------------------------------------------------------------------

// List labels
app.get('/api/repos/:owner/:repo/labels', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/labels?per_page=100`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Labels Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Create label
app.post('/api/repos/:owner/:repo/labels', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { name, color, description } = req.body;

        const { data } = await githubApi(`/repos/${owner}/${repo}/labels`, req.session.accessToken, {
            method: 'POST',
            body: JSON.stringify({ name, color, description })
        });
        res.json({ success: true, label: data });
    } catch (error) {
        console.error('Create Label Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Delete label
app.delete('/api/repos/:owner/:repo/labels/:name', requireAuth, async (req, res) => {
    try {
        const { owner, repo, name } = req.params;
        await githubApi(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, req.session.accessToken, {
            method: 'DELETE'
        });
        res.json({ success: true, message: 'Label deleted' });
    } catch (error) {
        console.error('Delete Label Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Commits & Comparison
// -----------------------------------------------------------------------------

// List commits
app.get('/api/repos/:owner/:repo/commits', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { sha, path, author, since, until, per_page = 30 } = req.query;

        let url = `/repos/${owner}/${repo}/commits?per_page=${per_page}`;
        if (sha) url += `&sha=${sha}`;
        if (path) url += `&path=${encodeURIComponent(path)}`;
        if (author) url += `&author=${author}`;
        if (since) url += `&since=${since}`;
        if (until) url += `&until=${until}`;

        const { data } = await githubApi(url, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('List Commits Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// Compare commits
app.get('/api/repos/:owner/:repo/compare/:basehead', requireAuth, async (req, res) => {
    try {
        const { owner, repo, basehead } = req.params;
        const { data } = await githubApi(`/repos/${owner}/${repo}/compare/${basehead}`, req.session.accessToken);
        res.json(data);
    } catch (error) {
        console.error('Compare Commits Error:', error);
        res.status(error.status || 500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// System Setup Routes
// -----------------------------------------------------------------------------

app.get('/api/system/status', (req, res) => {
    try {
        const meta = db.prepare('SELECT value FROM system_meta WHERE key = ?').get('setup_completed');
        res.json({ initialized: meta?.value === 'true' });
    } catch (error) {
        // If table doesn't exist (very fresh), valid to say not initialized
        res.json({ initialized: false });
    }
});

app.post('/api/system/setup', async (req, res) => {
    try {
        // Simulate "work" for the UI to show progress (optional, but requested for "demonstrating process")
        // In verify real-world, we'd run migrations here.
        // Since initDB() runs at start, we'll verify and maybe seed some data.

        await new Promise(r => setTimeout(r, 1000)); // Simulate "Creating Tables"

        // Ensure tables exist (redundant but safe)
        initDB();

        await new Promise(r => setTimeout(r, 800)); // Simulate "Verifying Schema"

        // Seed if empty
        const userCount = db.prepare('SELECT count(*) as count FROM users').get();
        if (userCount.count === 0) {
            // We could insert a "System Admin" placeholder or just leave it
        }

        await new Promise(r => setTimeout(r, 800)); // Simulate "Seeding Data"

        // Mark as completed
        db.prepare(`
            INSERT INTO system_meta (key, value) VALUES ('setup_completed', 'true')
            ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP
        `).run();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------

const server = app.listen(PORT, () => {
    console.log(`\n🚀 GitHub Repo Manager API is live on http://localhost:${PORT}`);
    console.log(`   Frontend: ${FRONTEND_URL}`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`ERROR: Port ${PORT} is already in use!`);
        process.exit(1);
    } else {
        console.error('Server error:', e);
    }
});

// Force keep-alive to debug why process exits
setInterval(() => { }, 10000);
