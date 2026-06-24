// Per-user encrypted Azure PAT vault CRUD + a live "test this PAT" probe.
// PAT values are NEVER returned by list/get — only `prefix`. Extracted verbatim
// from routes/azure.js.
import express from 'express';
import * as azureService from '../../azure-service.js';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { auditLog } from '../../lib/audit.js';
import * as credsVault from '../../lib/azure-credentials-manager.js';
import { validateAzureHost } from '../../lib/azure-host-validator.js';

const router = express.Router();

// GET /api/azure/credentials — list current user's saved credentials,
// optionally filtered by host so the wizard can show host-matching ones.
router.get('/azure/credentials', requireAuth, (req, res) => {
    try {
        const host = req.query.host ? String(req.query.host) : null;
        const items = credsVault.listForUser(req.session.userId, { host });
        res.json({ items });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to list credentials'));
    }
});

// POST /api/azure/credentials — store a new credential. Body shape:
//   { label, host, org?, pat, scopes? }
router.post('/azure/credentials', requireAuth, (req, res) => {
    try {
        const body = req.body || {};
        const created = credsVault.create(req.session.userId, body);
        auditLog(req, 'azure_credential.create', 'azure_credential', created.id, {
            host: created.host, org: created.org, label: created.label,
        });
        res.status(201).json(created);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to save credential'));
    }
});

// PATCH /api/azure/credentials/:id — update label / org / scopes (NOT the
// PAT — to rotate, delete + recreate so the prefix stays in sync).
router.patch('/azure/credentials/:id', requireAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return errorResponse(res, 400, 'Invalid id', 'BAD_ID');
        const updated = credsVault.update(req.session.userId, id, req.body || {});
        auditLog(req, 'azure_credential.update', 'azure_credential', id, {});
        res.json(updated);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to update credential'));
    }
});

// DELETE /api/azure/credentials/:id — revoke (the actual PAT in Azure DevOps
// is NOT revoked here, only the local cache; user should also delete it on
// the Azure side via the "Open PAT page" link in the UI).
router.delete('/azure/credentials/:id', requireAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return errorResponse(res, 400, 'Invalid id', 'BAD_ID');
        const removed = credsVault.remove(req.session.userId, id);
        auditLog(req, 'azure_credential.remove', 'azure_credential', id, {
            host: removed.host, org: removed.org, label: removed.label,
        });
        res.json({ removed: true, id });
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to delete credential'));
    }
});

// POST /api/azure/credentials/:id/test — validate the stored PAT against
// the linked host/org. Useful from Settings to spot revoked tokens early.
router.post('/azure/credentials/:id/test', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return errorResponse(res, 400, 'Invalid id', 'BAD_ID');
        const cred = credsVault.getPublic(req.session.userId, id);
        if (!cred) return errorResponse(res, 404, 'Credential not found', 'NOT_FOUND');
        if (!cred.org) {
            return res.json({
                valid: false,
                error: 'Credential has no org configured — edit it and set the organization first.',
            });
        }
        const hostCheck = await validateAzureHost(cred.host);
        if (!hostCheck.ok) {
            // `code` lets the UI render the allowlist self-fix panel instead
            // of a dead-end error string.
            return res.json({ valid: false, error: `Host check failed: ${hostCheck.reason}`, code: hostCheck.code || null, host: cred.host });
        }
        const pat = credsVault.decryptForUse(req.session.userId, id);
        if (!pat) return errorResponse(res, 500, 'Could not decrypt credential', 'DECRYPT_FAILED');
        const result = await azureService.validatePat(cred.org, pat, cred.host);
        res.json(result);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to test credential'));
    }
});

export default router;
