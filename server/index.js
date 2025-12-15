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
import dotenv from 'dotenv';

import { GoogleGenerativeAI } from '@google/generative-ai';
import db, { initDB } from './db.js';

initDB();

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Environment Configuration
const {
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    SESSION_SECRET = 'dev-secret-change-in-production',
    FRONTEND_URL = 'http://localhost:5173',
    GEMINI_API_KEY
} = process.env;

// Initialize Google AI only if key is present
let genAI;
if (GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    } catch (e) {
        console.error('Failed to initialize Google AI:', e.message);
    }
}

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    console.warn('⚠️ Warning: GitHub OAuth credentials are missing.');
    console.warn('   OAuth login will not work. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env to enable.');
}

// Middleware Setup
app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());

// Session configuration for secure auth persistence
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

/**
 * Wrapper for GitHub API calls.
 * Handles authentication headers, API versioning, and standardized error parsing.
 * 
 * @param {string} path - The API endpoint path (e.g., '/user/repos')
 * @param {string} token - The user's OAuth access token
 * @param {object} options - Fetch options (method, body, etc.)
 */
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

    // Attempt to parse JSON, but handle empty responses gracefully
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const error = new Error(data?.message || `GitHub API error: ${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
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
            return res.redirect(`${FRONTEND_URL}?error=${tokenData.error}&desc=${tokenData.error_description}`);
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
    const serverKey = process.env.GEMINI_API_KEY;
    const clientKey = req.headers['x-gemini-api-key'];

    if (!serverKey && !clientKey) {
        return res.status(503).json({
            error: 'AI_NOT_CONFIGURED',
            message: 'AI features are not configured. Please set GEMINI_API_KEY in server/.env or in Settings.'
        });
    }

    // If using client key, we need to initialize a fresh instance for this request
    // Note: In a real app, you might want to cache this or structure it differently
    if (clientKey && !serverKey) {
        req.genAI = new GoogleGenerativeAI(clientKey);
    } else if (genAI) {
        req.genAI = genAI; // Use global instance if server key exists (or prefer server key)
    } else if (clientKey) {
        req.genAI = new GoogleGenerativeAI(clientKey);
    }

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

        const { data, headers } = await githubApi(
            `/user/repos?page=${page}&per_page=${perPage}&sort=updated&affiliation=owner`,
            req.session.accessToken
        );

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
        let repos = [];
        let page = 1;
        let hasNextPage = true;

        // Fetch all repos to calculate stats (handling pagination)
        // Note: For large accounts, this might be slow. In production, consider caching or background jobs.
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

        res.json(stats);
    } catch (error) {
        console.error('Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
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
        const { data } = await githubApi('/user/orgs', req.session.accessToken);

        // Enrich organization data with repo counts
        // We do this in parallel but handle failures gracefully
        const orgsWithCounts = await Promise.all(data.map(async (org) => {
            try {
                const { data: orgDetails } = await githubApi(`/orgs/${org.login}`, req.session.accessToken);
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
        const model = req.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        res.status(500).json({ error: 'Failed to generate AI response' });
    }
});

// AI Suggestions Endpoint
app.post('/api/ai/suggest', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;
        const model = req.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        res.status(500).json({ error: 'Failed to generate suggestions' });
    }
});

// AI README Generator Endpoint
app.post('/api/ai/readme', requireAuth, requireAI, async (req, res) => {
    try {
        const { name, description, language, topics } = req.body;
        const model = req.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ readme: text });
    } catch (error) {
        console.error('AI README Error:', error);
        res.status(500).json({ error: 'Failed to generate README' });
    }
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

        // 2. Fetch events for each repo (Limit to first 10 repos to avoid rate limits/timeouts for now)
        // In a production app, this would be a background job with caching.
        const targetRepos = repos.slice(0, 10);
        const fetchPromises = targetRepos.map(async (r) => {
            try {
                const { data } = await githubApi(`/repos/${r.repo_full_name}/events?per_page=10`, req.session.accessToken);
                // Attach repo name to event for UI context
                return data.map(event => ({ ...event, repo_name: r.repo_full_name }));
            } catch (e) {
                console.error(`Failed to fetch events for ${r.repo_full_name}:`, e.message);
                return [];
            }
        });

        const results = await Promise.all(fetchPromises);

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
