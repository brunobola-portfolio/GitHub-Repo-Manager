import express from 'express';
import crypto, { randomUUID } from 'crypto';
import db from '../db.js';
import { auditLog } from '../lib/audit.js';
import { config } from '../config.js';
import { createAuthRouteLimiter } from '../middleware/tenant-rate-limit.js';
import { ensureCsrfToken } from '../middleware/csrf.js';
import { ABSOLUTE_TIMEOUT_MS } from '../middleware/session-absolute-timeout.js';

const router = express.Router();

// S2 — Per-IP rate limit on OAuth endpoints to block brute-force on login
// and replay of authorization codes. 20 req / 15 min per IP in prod.
const authRouteLimiter = createAuthRouteLimiter();

// /session-info is polled every 5 min by the SPA — re-read users.is_admin
// at most once per TTL so the flag still propagates after a grant/revoke
// while keeping the polling cost bounded. Long enough that the synchronous
// SQLite read isn't on the polling hot path.
const ADMIN_FLAG_TTL_MS = 10 * 60_000;

// Where to send the browser after the OAuth dance (or an OAuth error).
// FRONTEND_URL when the operator set one (dev: the Vite server on :5173,
// hosted: the public URL); otherwise the request's own origin. The
// same-origin fallback is what makes a packaged/self-host install — where
// Express serves the built frontend itself — work with zero configuration,
// on whatever host:port the launcher actually bound (127.0.0.1:3001, or the
// next free port when 3001 was busy).
export function resolveFrontendUrl(req) {
    const configured = process.env.FRONTEND_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return `${req.protocol}://${req.get('host')}`;
}

// The origin GitHub must redirect back to after the authorize step. It has to
// match the OAuth App's registered callback URL byte-for-byte on the scheme
// and host, or GitHub answers redirect_uri_mismatch and login is dead.
//
// Deriving it from `req` alone is only correct when the request's scheme
// survived the trip: behind a TLS-terminating proxy, `req.protocol` reports
// https only if that proxy forwards `X-Forwarded-Proto` AND `trust proxy` is
// set. Caddy and nginx send it; IIS/ARR does NOT unless the operator adds the
// header by hand — so a hosted install one config line short of complete
// would build an http:// redirect_uri against an https:// registration.
//
// FRONTEND_URL is the operator's declaration of the public origin, so when it
// names the SAME host the request arrived on, trust its scheme. A DIFFERENT
// host means the two are genuinely separate origins — dev, where FRONTEND_URL
// is the Vite server on :5173 while the callback must land on the API on
// :3001 — and there the request-derived origin is the only correct answer.
export function resolveCallbackOrigin(req) {
    const host = req.get('host');
    const configured = process.env.FRONTEND_URL;
    if (configured && host) {
        try {
            const url = new URL(configured);
            // Only http(s). `new URL('foo://h').origin` is the literal string
            // "null", which would ship `null/api/auth/callback` to GitHub.
            if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('scheme');
            // Never downgrade: a stale http:// FRONTEND_URL must not turn a
            // genuinely-TLS request into an http:// redirect_uri.
            if (url.protocol === 'https:' || req.protocol !== 'https') {
                if (sameHost(url, host)) return url.origin;
            }
        } catch {
            // Malformed FRONTEND_URL — fall through to the request origin
            // rather than crashing the login route.
        }
    }
    return `${req.protocol}://${host}`;
}

// Host comparison, normalised. `URL` lowercases the host and strips the
// scheme's default port; a Host header does neither. A bare string compare
// therefore treats `RepoManager.Example.PT` and `example.pt:443` as a
// different origin and silently falls back to the request scheme — re-breaking
// the exact login this function exists to keep working behind a proxy.
function sameHost(url, hostHeader) {
    const defaultPort = url.protocol === 'https:' ? ':443' : ':80';
    const normalise = (h) => {
        const lower = String(h).toLowerCase();
        return lower.endsWith(defaultPort) ? lower.slice(0, -defaultPort.length) : lower;
    };
    return normalise(url.host) === normalise(hostHeader);
}

// Initiates the GitHub OAuth flow
router.get('/login', authRouteLimiter, (req, res) => {
    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
    // Fail helpfully, not at GitHub: without credentials the authorize URL
    // would carry client_id=undefined and strand the user on a GitHub 404.
    // Redirecting home with a machine-readable code lets the frontend open
    // the guided "Connect GitHub" setup instead.
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
        return res.redirect(`${resolveFrontendUrl(req)}/?error=oauth_not_configured`);
    }
    // Scopes needed:
    // - repo: Full control of private repositories
    // - delete_repo: Ability to delete repositories
    // - read:org, admin:org: Manage organization memberships and repos
    const scope = 'repo delete_repo read:org admin:org';
    const redirectUri = `${resolveCallbackOrigin(req)}/api/auth/callback`;
    const state = randomUUID();
    req.session.oauthState = state;
    req.session.save(() => {
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
        res.redirect(authUrl);
    });
});

// Handles the callback from GitHub
router.get('/callback', authRouteLimiter, async (req, res) => {
    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
    // Same-origin fallback (not the old hardcoded http://localhost:5173):
    // in a packaged install the Vite dev server does not exist, so every
    // redirect below — including the post-login success one — must land on
    // the origin Express itself is serving.
    const FRONTEND_URL = resolveFrontendUrl(req);
    const { code, state } = req.query;

    if (!code) {
        // GitHub reports user-facing failures (e.g. the user clicked Cancel →
        // ?error=access_denied) with no ?code. Forward the sanitized code so
        // the UI can say what actually happened instead of a generic failure.
        const ghError = typeof req.query.error === 'string' && /^[a-z_]{1,64}$/.test(req.query.error)
            ? req.query.error
            : 'no_code';
        return res.redirect(`${FRONTEND_URL}?error=${ghError}`);
    }

    // Validate OAuth state parameter to prevent CSRF (timing-safe comparison)
    const stateA = state ? Buffer.from(state) : null;
    const stateB = req.session.oauthState ? Buffer.from(req.session.oauthState) : null;
    const stateValid = stateA && stateB &&
        stateA.length === stateB.length &&
        crypto.timingSafeEqual(stateA, stateB);
    if (!stateValid) {
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

        // Fail CLOSED if we can't identify the user. Previously a failed
        // /user fetch fell through and still saved a session with an
        // accessToken but userId=undefined — and requireAuth only checks
        // accessToken, so that half-authenticated session looked logged in
        // while every userId-keyed DB lookup broke.
        if (!userRes.ok) {
            req.log.error({ status: userRes.status }, 'OAuth: GitHub /user fetch failed');
            return res.redirect(`${FRONTEND_URL}?error=auth_failed`);
        }
        const userData = await userRes.json();
        if (!userData?.id) {
            req.log.error('OAuth: GitHub /user returned no id');
            return res.redirect(`${FRONTEND_URL}?error=auth_failed`);
        }

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
            // Plaintext here on purpose: the session object is in-process only.
            // Encryption happens once, at the persistence boundary, in
            // lib/session-store.js — encrypting it here instead would mean
            // every reader (routes, outbox, AI features) had to decrypt, and
            // the Redis store would silently keep writing plaintext.
            req.session.accessToken = tokenData.access_token;
            // Absolute-timeout anchor — sessionAbsoluteTimeout middleware
            // destroys any session older than 7 days from this stamp.
            req.session.createdAt = Date.now();

            req.session.save((err) => {
                if (err) {
                    req.log.error({ err }, 'Session save failed');
                    return res.redirect(`${FRONTEND_URL}?error=session_error`);
                }
                auditLog(req, 'auth.login', 'user', req.session.userId);
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
    const userId = req.session?.userId;
    auditLog(req, 'auth.logout', 'user', userId);
    req.session.destroy((err) => {
        if (err) {
            req.log?.error?.({ err }, 'Session destroy failed');
        }
        res.clearCookie('connect.sid', {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.nodeEnv === 'production',
            path: '/',
        });
        res.json({ success: true });
    });
});

// Mock Login for Dev Mode (disabled outside development).
//
// Allow-list rather than block-list: an ambiguous NODE_ENV (empty, "preview",
// "staging") on an internet-exposed deploy must NOT pass this guard. Only
// NODE_ENV === 'development' OR an explicit ALLOW_MOCK_AUTH=true opt-in
// enables the route — everything else returns 404 as if the route didn't
// exist.
router.post('/mock', (req, res) => {
    const isDev = config.nodeEnv === 'development';
    const isExplicitlyAllowed = process.env.ALLOW_MOCK_AUTH === 'true';
    if (!isDev && !isExplicitlyAllowed) {
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
    req.session.createdAt = Date.now();
    req.session.save(() => res.json({ success: true, user: mockUser }));
});

// Lightweight session-info endpoint.
//
// Returns the absolute expiry of the current session so the frontend can
// surface a warning toast before the 7-day ceiling trips and produces a
// sudden 401. Unauthenticated callers get a 200 with { authenticated: false }
// rather than a 401 — this endpoint is polled and must not look like a
// real auth error.
//
// CSRF-bypassed (GET, non-mutation) and cheap enough to poll every 5 min.
router.get('/session-info', (req, res) => {
    if (!req.session?.accessToken) {
        return res.json({ authenticated: false });
    }

    const createdAt = typeof req.session.createdAt === 'number'
        ? req.session.createdAt
        : null;

    // Sessions created before the absolute-timeout feature shipped have no
    // createdAt stamp. Report a null expiry so the frontend skips the
    // expiry warning rather than showing an inaccurate countdown.
    const expiresAt = createdAt !== null
        ? new Date(createdAt + ABSOLUTE_TIMEOUT_MS).toISOString()
        : null;
    const expiresInSeconds = createdAt !== null
        ? Math.max(0, Math.floor((createdAt + ABSOLUTE_TIMEOUT_MS - Date.now()) / 1000))
        : null;

    // isAdmin — cached on the session so the polling client (every 5 min)
    // doesn't trigger a synchronous SQLite read on every poll. The flag is
    // refreshed at most once per ADMIN_FLAG_TTL_MS so a freshly granted
    // admin role still propagates within minutes, and falls back to a fresh
    // DB read if the cache hasn't been populated yet.
    // Fail-closed: any DB error returns false rather than exposing the
    // admin UI to a user we couldn't verify.
    let isAdmin = false;
    if (typeof req.session.userId === 'number') {
        const cached = req.session.isAdminCache;
        const fresh = cached && typeof cached.checkedAt === 'number'
            && Date.now() - cached.checkedAt < ADMIN_FLAG_TTL_MS;
        if (fresh) {
            isAdmin = !!cached.value;
        } else {
            try {
                const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
                isAdmin = !!row?.is_admin;
                req.session.isAdminCache = { value: isAdmin, checkedAt: Date.now() };
            } catch (err) {
                req.log?.warn({ err: err?.message, userId: req.session.userId }, 'Failed to read users.is_admin — treating as non-admin');
            }
        }
    }

    res.json({
        authenticated: true,
        userId: req.session.userId,
        userLogin: req.session.userLogin,
        isAdmin,
        expiresAt,
        expiresInSeconds,
        createdAt: createdAt !== null ? new Date(createdAt).toISOString() : null,
    });
});

// Refresh-session endpoint.
//
// Any authenticated request already resets the rolling session cookie
// (express-session `rolling: true`), so from a behaviour standpoint this
// endpoint is equivalent to "touch the session". It exists as a semantic
// clarifier: callers that explicitly want to bump the rolling expiry (e.g.
// the session-expiry hook on a close-to-expiry warning) can POST here
// without issuing a cosmetic request to some other endpoint.
//
// NOTE: The 7-day absolute ceiling (createdAt-anchored) is NOT extended by
// this endpoint — the sessionAbsoluteTimeout middleware still enforces it.
router.post('/refresh-session', (req, res) => {
    if (!req.session?.accessToken) {
        return res.status(401).json({ error: 'Not authenticated', authenticated: false });
    }
    // Touching the session is enough — express-session will re-emit a
    // Set-Cookie with a fresh maxAge on the way out. Explicit save() makes
    // stores that buffer writes (Redis pipelines, etc.) flush immediately.
    req.session.touch();
    req.session.save((err) => {
        if (err) {
            req.log?.error?.({ err }, 'refresh-session save failed');
            return res.status(500).json({ error: 'Failed to refresh session' });
        }
        const createdAt = typeof req.session.createdAt === 'number'
            ? req.session.createdAt
            : null;
        const expiresInSeconds = createdAt !== null
            ? Math.max(0, Math.floor((createdAt + ABSOLUTE_TIMEOUT_MS - Date.now()) / 1000))
            : null;
        res.json({
            success: true,
            expiresInSeconds,
        });
    });
});

// Issue (or retrieve) a CSRF token bound to the current session.
// Called by the SPA after login; token is then sent back on every
// mutating request as the X-CSRF-Token header.
router.get('/csrf-token', (req, res) => {
    try {
        const token = ensureCsrfToken(req);
        req.session.save((err) => {
            if (err) {
                req.log?.error?.({ err }, 'Session save failed while issuing CSRF token');
                return res.status(500).json({ error: 'Failed to issue CSRF token' });
            }
            res.json({ token });
        });
    } catch (err) {
        req.log?.error?.({ err }, 'CSRF token issuance failed');
        res.status(500).json({ error: 'Failed to issue CSRF token' });
    }
});

export default router;
