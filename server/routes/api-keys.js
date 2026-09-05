import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateApiKey } from '../middleware/api-key-auth.js';
import { auditLog } from '../lib/audit.js';
import { getFeatures } from '../lib/feature-flags.js';
import { z } from 'zod';

const router = Router();

const createKeySchema = z.object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(['read', 'write', 'admin', 'ai'])).default(['read']),
    expires_at: z.string().datetime().optional(),
});

// List user's API keys (includes usage limits for frontend)
router.get('/', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const userTier = req.session.user?.tier || req.userTier || 'free';
    const flags = getFeatures(userTier);

    const keys = db.prepare(
        'SELECT id, name, key_prefix, scopes, last_used_at, last_used_ip, expires_at, created_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 200'
    ).all(userId);

    const activeCount = keys.filter(k => !k.revoked_at).length;

    res.json({
        keys,
        limits: { current: activeCount, max: flags.apiKeys, tier: userTier },
    });
});

// Generate new API key
router.post('/', requireAuth, (req, res) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'That request was missing something the server needs.', code: 'VALIDATION_ERROR', details: parsed.error.format() });

    const userId = req.session.userId;
    const userTier = req.session.user?.tier || req.userTier || 'free';
    const flags = getFeatures(userTier);
    const max = flags.apiKeys;

    const currentCount = db.prepare('SELECT COUNT(*) as n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL').get(userId).n;
    if (max !== undefined && max !== Infinity && currentCount >= max) {
        return res.status(403).json({
            error: `API key limit reached (${max}). Upgrade for more keys.`,
            code: 'tier_limit_exceeded',
            limit: max,
            upgradeUrl: '/pricing'
        });
    }

    const { name, scopes, expires_at } = parsed.data;
    const { id, key, prefix, keyHash } = generateApiKey();

    db.prepare(
        'INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, userId, name, keyHash, prefix, JSON.stringify(scopes), expires_at || null);

    auditLog(req, 'api_key.create', 'api_key', id, { name, scopes });
    res.status(201).json({ id, key, name, prefix, scopes, expires_at });
});

// Revoke API key
router.delete('/:id', requireAuth, (req, res) => {
    const result = db.prepare(
        'UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
    ).run(req.params.id, req.session.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Key not found or already revoked' });
    auditLog(req, 'api_key.revoke', 'api_key', req.params.id);
    res.json({ success: true });
});

export default router;
