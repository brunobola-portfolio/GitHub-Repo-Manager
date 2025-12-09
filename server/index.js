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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Environment Configuration
const {
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    SESSION_SECRET = 'CHANGE_THIS_SECRET',
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
    if (!GEMINI_API_KEY || !genAI) {
        return res.status(503).json({
            error: 'AI_NOT_CONFIGURED',
            message: 'AI features are not configured. Please set GEMINI_API_KEY in server/.env'
        });
    }
    next();
};
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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
// Start Server
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`\n🚀 GitHub Repo Manager API is live on http://localhost:${PORT}`);
    console.log(`   Frontend: ${FRONTEND_URL}`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
});
