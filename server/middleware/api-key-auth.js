import { createHmac, randomBytes, randomUUID } from 'crypto';
import db from '../db.js';
import logger from '../lib/logger.js';

/**
 * HMAC-SHA-256 with a server-side secret for defense-in-depth.
 * Even if the DB is leaked, an attacker still needs the secret to forge hashes.
 * The raw key has 256 bits of entropy (randomBytes(32)), making brute-force
 * infeasible regardless of hash speed — HMAC adds protection against DB-only leaks.
 *
 * In production, API_KEY_SECRET MUST be set; we fail fast otherwise so a missing
 * env var can't fall back to a known default that lets attackers forge HMACs.
 * In dev/test we generate an ephemeral per-process secret (existing API keys
 * become invalid on restart, which is the right dev UX).
 */
// Dev-only ephemeral secret, generated lazily and stored on process.env so
// repeated calls within the same Node process agree on the hash. Wiped on
// process restart, so dev API keys become invalid (the right dev UX).
let warnedAboutMissingSecret = false;
function getHmacSecret() {
    const fromEnv = process.env.API_KEY_SECRET;
    if (fromEnv) return fromEnv;
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_KEY_SECRET must be set in production');
    }
    const ephemeral = randomBytes(32).toString('hex');
    process.env.API_KEY_SECRET = ephemeral;
    if (!warnedAboutMissingSecret) {
        warnedAboutMissingSecret = true;
        logger.warn('API_KEY_SECRET not set; generated ephemeral dev secret (existing API keys will be invalid)');
    }
    return ephemeral;
}

export function hashKey(key) {
    return createHmac('sha256', getHmacSecret()).update(key).digest('hex');
}

export function generateApiKey() {
    const id = randomUUID();
    const raw = randomBytes(32).toString('base64url');
    const key = `grm_live_${raw}`;
    const prefix = key.slice(0, 16);
    const keyHash = hashKey(key);
    return { id, key, prefix, keyHash };
}

function getClientIp(req) {
    // Use req.ip which respects Express's 'trust proxy' setting.
    // In production, Express strips spoofed x-forwarded-for headers.
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Exact paths of the AI generation routes gated by requireScope('ai') at the
// route level (server/routes/ai/{core,dev-toolkit,indexing,migration}.js) —
// the write-scope gate's `ai`-scope carve-out below only applies to these.
//
// This is deliberately an EXACT allowlist, not a blanket "/api/ai/" prefix
// match: other endpoints also live under /api/ai/* (deep-review,
// prompt-studio, pr-commands, pr-chat) but are NOT gated by
// requireScope('ai') — they stay behind requireTier('pro') only, same as any
// other mutating endpoint. A prefix match would silently let an ai-only key
// mutate those too (e.g. publish a deep-review comment, run a PR slash
// command), which is well beyond what the `ai` scope is meant to grant.
//
// Exported for the parity test in
// server/__tests__/ai-key-scope-enforcement.test.js, which walks the AI
// router's layer stack and asserts this list and the requireScope('ai')
// mounts can never drift apart (in EITHER direction). Frozen because it is
// exported authorization state — an importer mutating it (push/splice) would
// silently widen or narrow the carve-out.
export const AI_GENERATION_ROUTE_PATHS = Object.freeze([
    '/ai/chat',
    '/ai/attention-narrative',
    '/ai/translate-search',
    '/ai/suggest',
    '/ai/readme',
    '/ai/readme/enhance',
    '/ai/quality-report',
    '/ai/review-summary',
    '/ai/generate-commit',
    '/ai/generate-pr',
    '/ai/refine',
    '/ai/analyze-context',
    '/ai/chat-refine',
    '/ai/index',
    '/ai/batch-index',
    '/ai/issue-to-plan',
    '/ai/migration-risk',
    '/ai/migration-size-strategy',
    '/ai/migration-description',
]);
// The AI router is mounted at both /api/ai/* (legacy alias) and /api/v1/ai/*
// (see index.js), so both variants of each path are recognized.
const AI_GENERATION_ROUTES = new Set(
    AI_GENERATION_ROUTE_PATHS.flatMap((p) => [`/api${p}`, `/api/v1${p}`])
);

// req.originalUrl is used (never req.path) because this function runs deep
// inside nested routers (via requireAuth called at the individual-route
// level) where req.path/req.url have already been rebased relative to the
// mount point — req.originalUrl is the one thing Express never rewrites.
function isAiRoute(req) {
    const url = req.originalUrl || '';
    const path = url.split('?')[0];
    return AI_GENERATION_ROUTES.has(path);
}

// Note: API key authentication does not set req.session.accessToken.
// GitHub proxy endpoints (repos, orgs, etc.) require OAuth session auth.
// API keys are only valid for local-DB endpoints (audit, usage, teams, etc.)
export function apiKeyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer grm_live_')) return next();

    const key = authHeader.slice(7); // Remove 'Bearer '
    const keyHash = hashKey(key);

    const row = db.prepare(
        'SELECT id, user_id, scopes, expires_at, revoked_at FROM api_keys WHERE key_hash = ?'
    ).get(keyHash);

    if (!row) {
        logger.warn({ ip: getClientIp(req), prefix: key.slice(0, 16) }, 'API key auth failed: invalid key');
        return res.status(401).json({ error: 'Invalid API key' });
    }
    if (row.revoked_at) {
        logger.warn({ ip: getClientIp(req), keyId: row.id }, 'API key auth failed: revoked key');
        return res.status(401).json({ error: 'API key has been revoked' });
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        logger.warn({ ip: getClientIp(req), keyId: row.id }, 'API key auth failed: expired key');
        return res.status(401).json({ error: 'API key has expired' });
    }

    // Set user context
    req.session = req.session || {};
    req.session.userId = row.user_id;
    req.tenantId = row.user_id;
    req.apiKeyId = row.id;
    try {
        req.scopes = JSON.parse(row.scopes);
    } catch {
        req.scopes = [];
    }

    // Central write-scope gate for API keys: any mutating request must carry
    // the `write` (or `admin`) scope. Enforced here — inside the single
    // entry point every API-key request flows through — so a read-scoped key
    // can't mutate ANY route, without annotating each one. Session/cookie
    // users never reach this branch (requireAuth only calls apiKeyAuth for
    // grm_live_ bearers), so the UI is unaffected.
    //
    // Carve-out: an `ai`-scoped key is allowed past THIS generic gate for the
    // AI generation routes (POST /api/ai/* and /api/v1/ai/*) without
    // `write`/`admin`. This does NOT itself grant access — those routes
    // separately require `ai` scope via requireScope('ai'), which is what
    // actually authorizes them (and still 403s a write-only key there,
    // naming the missing `ai` scope). Without this carve-out, an ai-only key
    // would never reach that check at all: it would 403 right here, before
    // any route-level middleware runs. The carve-out is narrowly scoped to
    // AI paths, so an ai-only key still can't mutate anything else.
    const MUTATION = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const hasWriteOrAdmin = req.scopes.includes('write') || req.scopes.includes('admin');
    const hasAiScopeForAiRoute = req.scopes.includes('ai') && isAiRoute(req);
    if (MUTATION.has(req.method) && !hasWriteOrAdmin && !hasAiScopeForAiRoute) {
        logger.warn({ ip: getClientIp(req), keyId: row.id, method: req.method }, 'API key auth failed: write scope required');
        return res.status(403).json({ error: 'This API key lacks the required "write" scope', required: 'write' });
    }

    // Update last_used_at with IP and User-Agent (synchronous — better-sqlite3 blocks)
    const ip = getClientIp(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 255);
    db.prepare(
        'UPDATE api_keys SET last_used_at = datetime(\'now\'), last_used_ip = ?, last_used_ua = ? WHERE id = ?'
    ).run(ip, ua, row.id);

    next();
}

export function requireScope(scope) {
    const middleware = (req, res, next) => {
        if (req.session?.userId && !req.apiKeyId) return next(); // Session has all scopes
        if (req.scopes?.includes(scope) || req.scopes?.includes('admin')) return next();
        return res.status(403).json({ error: 'Insufficient permissions', required: scope });
    };
    // Introspection tag (no runtime behavior): the parity test walks the AI
    // router's layer stack and identifies scope-gated routes by this property,
    // keeping AI_GENERATION_ROUTE_PATHS and the requireScope('ai') mounts
    // provably in sync.
    middleware.requiredScope = scope;
    return middleware;
}
