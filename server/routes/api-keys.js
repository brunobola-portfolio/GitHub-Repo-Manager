import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateApiKey, hashKey } from '../middleware/api-key-auth.js';
import { z } from 'zod';

const router = Router();

const createKeySchema = z.object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(['read', 'write', 'admin', 'ai'])).default(['read']),
    expires_at: z.string().datetime().optional(),
});

// List user's API keys
router.get('/', requireAuth, (req, res) => {
    const keys = db.prepare(
        'SELECT id, name, key_prefix, scopes, last_used_at, expires_at, created_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.session.userId);
    res.json(keys);
});

// Generate new API key
router.post('/', requireAuth, (req, res) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.format() });

    const { name, scopes, expires_at } = parsed.data;
    const { id, key, prefix, keyHash } = generateApiKey();

    db.prepare(
        'INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.session.userId, name, keyHash, prefix, JSON.stringify(scopes), expires_at || null);

    res.status(201).json({ id, key, name, prefix, scopes, expires_at });
});

// Revoke API key
router.delete('/:id', requireAuth, (req, res) => {
    const result = db.prepare(
        'UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
    ).run(req.params.id, req.session.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'Key not found or already revoked' });
    res.json({ success: true });
});

export default router;
