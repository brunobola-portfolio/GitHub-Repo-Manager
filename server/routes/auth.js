import express from 'express';
import { randomUUID } from 'crypto';
import db from '../db.js';

const router = express.Router();

// Initiates the GitHub OAuth flow
router.get('/login', (req, res) => {
    const { GITHUB_CLIENT_ID } = process.env;
    // Scopes needed:
    // - repo: Full control of private repositories
    // - delete_repo: Ability to delete repositories
    // - read:org, admin:org: Manage organization memberships and repos
    const scope = 'repo delete_repo read:org admin:org';
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/callback`;
    const state = randomUUID();
    req.session.oauthState = state;
    req.session.save(() => {
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
        res.redirect(authUrl);
    });
});

// Handles the callback from GitHub
router.get('/callback', async (req, res) => {
    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, FRONTEND_URL = 'http://localhost:5173' } = process.env;
    const { code, state } = req.query;

    if (!code) {
        return res.redirect(`${FRONTEND_URL}?error=no_code`);
    }

    // Validate OAuth state parameter to prevent CSRF
    if (!state || state !== req.session.oauthState) {
        return res.redirect(`${FRONTEND_URL}?error=invalid_state`);
    }
    delete req.session.oauthState;

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

            // Store user ID and login in session for DB lookups
            req.session.userId = userData.id;
            req.session.userLogin = userData.login;
        }

        // Regenerate session to prevent session fixation attacks
        const newUserId = req.session.userId;
        const newUserLogin = req.session.userLogin;

        req.session.regenerate((regenerateErr) => {
            if (regenerateErr) {
                req.log.error({ err: regenerateErr }, 'Session regenerate failed');
                return res.redirect(`${FRONTEND_URL}?error=session_error`);
            }

            // Restore user data and store token in the new session
            req.session.userId = newUserId;
            req.session.userLogin = newUserLogin;
            req.session.accessToken = tokenData.access_token;

            req.session.save((err) => {
                if (err) {
                    req.log.error({ err }, 'Session save failed');
                    return res.redirect(`${FRONTEND_URL}?error=session_error`);
                }
                res.redirect(FRONTEND_URL);
            });
        });

    } catch (error) {
        req.log.error({ err: error }, 'OAuth callback failed');
        res.redirect(`${FRONTEND_URL}?error=auth_failed`);
    }
});

// Check current session
router.get('/session', (req, res) => {
    if (req.session.accessToken) {
        res.json({
            authenticated: true,
            userId: req.session.userId,
            // Only expose a boolean - never send the raw token to the frontend
            hasToken: true
        });
    } else {
        res.status(401).json({ authenticated: false });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Mock Login for Dev Mode (disabled in production)
router.post('/mock', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found' });
    }
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
    req.session.userLogin = mockUser.username;
    req.session.accessToken = 'mock_token';
    req.session.save(() => res.json({ success: true, user: mockUser }));
});

export default router;
