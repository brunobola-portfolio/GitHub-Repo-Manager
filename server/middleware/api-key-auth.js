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
    const MUTATION = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    if (MUTATION.has(req.method) && !(req.scopes.includes('write') || req.scopes.includes('admin'))) {
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
    return (req, res, next) => {
        if (req.session?.userId && !req.apiKeyId) return next(); // Session has all scopes
        if (req.scopes?.includes(scope) || req.scopes?.includes('admin')) return next();
        return res.status(403).json({ error: 'Insufficient permissions', required: scope });
    };
}
