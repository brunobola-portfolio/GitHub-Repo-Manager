import { createHash, randomBytes, randomUUID } from 'crypto';
import db from '../db.js';

export function hashKey(key) {
    return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey() {
    const id = randomUUID();
    const raw = randomBytes(32).toString('base64url');
    const key = `grm_live_${raw}`;
    const prefix = key.slice(0, 16);
    const keyHash = hashKey(key);
    return { id, key, prefix, keyHash };
}

export function apiKeyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer grm_live_')) return next();

    const key = authHeader.slice(7); // Remove 'Bearer '
    const keyHash = hashKey(key);

    const row = db.prepare(
        'SELECT id, user_id, scopes, expires_at, revoked_at FROM api_keys WHERE key_hash = ?'
    ).get(keyHash);

    if (!row) return res.status(401).json({ error: 'Invalid API key' });
    if (row.revoked_at) return res.status(401).json({ error: 'API key has been revoked' });
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
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

    // Update last_used_at (fire-and-forget)
    db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.id);

    next();
}

export function requireScope(scope) {
    return (req, res, next) => {
        if (req.session?.userId && !req.apiKeyId) return next(); // Session has all scopes
        if (req.scopes?.includes(scope) || req.scopes?.includes('admin')) return next();
        return res.status(403).json({ error: 'Insufficient permissions', required: scope });
    };
}
