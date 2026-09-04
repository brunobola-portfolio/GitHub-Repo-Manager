/**
 * User-configurable AI prompt overrides.
 *
 * GET    /api/ai/prompts            — list every entry in the registry, with the
 *                                     user's override merged in when present.
 * PUT    /api/ai/prompts/:key       — set the user's override for one feature.
 * DELETE /api/ai/prompts/:key       — clear the override (reverts to default).
 */

import express from 'express';
import { z } from 'zod';
import { requireAuth, safeError } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { auditLog } from '../../lib/audit.js';
import {
    AI_PROMPT_REGISTRY,
    REGISTRY_KEYS,
    isValidPromptKey,
    getCatalog,
    loadAllUserPrompts,
    saveUserPrompt,
    deleteUserPrompt,
} from '../../lib/ai-prompt-registry.js';

const router = express.Router();

const promptSchema = z.object({
    prompt: z.string().min(1, 'Prompt cannot be empty').max(8000, 'Prompt cannot exceed 8000 characters'),
});

// GET — list features with default + user override merged
router.get('/ai/prompts', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        const overrides = loadAllUserPrompts(userId);
        const catalog = getCatalog().map((entry) => {
            const override = overrides[entry.key];
            return {
                ...entry,
                hasOverride: !!override,
                userPrompt: override?.prompt ?? null,
                updatedAt: override?.updatedAt ?? null,
            };
        });
        res.json({ prompts: catalog });
    } catch (err) {
        req.log?.error({ err }, 'List AI prompts failed');
        res.status(500).json({ error: safeError(err, 'Failed to load prompts') });
    }
});

// PUT — set / replace the override for a single feature
router.put('/ai/prompts/:key', requireAuth, validateBody(promptSchema), (req, res) => {
    const { key } = req.params;
    if (!isValidPromptKey(key)) {
        return res.status(400).json({
            error: 'Unknown prompt key',
            allowed: REGISTRY_KEYS,
        });
    }
    try {
        const userId = req.session.userId;
        const result = saveUserPrompt(userId, key, req.validatedBody.prompt);
        // Prompt overrides shape future model behaviour — audit explicitly so
        // we can correlate quality regressions with the change history.
        auditLog(req, 'ai.prompt.override.set', 'ai_prompt', key, { length: result.prompt.length });
        res.json({
            key,
            prompt: result.prompt,
            hasOverride: true,
            defaultPrompt: AI_PROMPT_REGISTRY[key].defaultPrompt,
        });
    } catch (err) {
        req.log?.warn({ err, key }, 'Save AI prompt override failed');
        // validateBody(promptSchema) already rejects the empty/too-long cases
        // with a precise message, so anything reaching here is internal —
        // safeError keeps it out of the response in production.
        res.status(400).json({ error: safeError(err, 'Failed to save prompt'), code: 'prompt_save_failed' });
    }
});

// DELETE — revert to default
router.delete('/ai/prompts/:key', requireAuth, (req, res) => {
    const { key } = req.params;
    if (!isValidPromptKey(key)) {
        return res.status(400).json({
            error: 'Unknown prompt key',
            allowed: REGISTRY_KEYS,
        });
    }
    try {
        const userId = req.session.userId;
        const { deleted } = deleteUserPrompt(userId, key);
        auditLog(req, 'ai.prompt.override.clear', 'ai_prompt', key, { deleted });
        res.json({ key, hasOverride: false, defaultPrompt: AI_PROMPT_REGISTRY[key].defaultPrompt });
    } catch (err) {
        req.log?.error({ err, key }, 'Delete AI prompt override failed');
        res.status(500).json({ error: safeError(err, 'Failed to clear prompt') });
    }
});

export default router;
