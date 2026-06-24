// Azure host-allowlist admin CRUD + the env-auth probe. Reads are requireAuth;
// writes are requireAdmin and audited. Extracted verbatim from routes/azure.js.
import express from 'express';
import { requireAuth, safeError, errorResponse } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { auditLog } from '../../lib/audit.js';
import db from '../../db.js';
import {
    isAllowedHost,
    getAllowedHostPatterns, getEnvHostPatterns, getDbHostEntries,
    isUsingDefaultAllowlist,
    addHostToAllowlist, removeHostFromAllowlist,
} from '../../lib/azure-host-validator.js';

const router = express.Router();

// Check if server has AZURE_PAT configured (never returns the PAT itself)
router.get('/azure/env-auth', requireAuth, (req, res) => {
    res.json({ available: !!process.env.AZURE_PAT });
});

// Public host allowlist + per-host check. The UI uses this to:
//   1. Pre-validate a hostname before the user submits credentials.
//   2. Show the user exactly which hosts the server will accept.
//   3. Decide whether to offer a 1-click "Add to allowlist" button (admin)
//      or a "Ask your admin" message (non-admin).
//
// Returns DB-managed entries with metadata so the UI can render a richer
// management view, while still exposing only the resolved patterns (no raw
// env strings).
router.get('/azure/host-allowlist', requireAuth, (req, res) => {
    const host = (req.query.host || '').toString().trim().toLowerCase();
    let isAdmin = false;
    try {
        const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
        isAdmin = !!row?.is_admin;
    } catch { /* default false */ }

    // Entry details (internal hostnames, free-form notes, admin usernames)
    // are topology disclosure on shared deployments — admins only. The
    // per-host `allowed` check is all non-admins need, and skipping the
    // entry queries also keeps the debounced-keystroke path cheap.
    res.json({
        patterns: isAdmin ? getAllowedHostPatterns() : [],
        envPatterns: isAdmin ? getEnvHostPatterns() : [],
        dbEntries: isAdmin ? getDbHostEntries() : [],
        usingDefault: isUsingDefaultAllowlist(),
        host: host || null,
        allowed: host ? isAllowedHost(host) : null,
        canEdit: isAdmin,
    });
});

// Admin-only: add a host to the DB allowlist. Takes effect immediately
// (no server restart). Audited via audit_log_v2.
router.post('/azure/host-allowlist', requireAuth, requireAdmin, (req, res) => {
    try {
        const { pattern, notes } = req.body || {};
        if (!pattern) {
            return errorResponse(res, 400, 'Pattern is required', 'MISSING_PATTERN');
        }
        const result = addHostToAllowlist(pattern, req.session.userId, notes || null);
        auditLog(req, 'azure_host_allowlist.add', 'azure_host', result.pattern, {
            notes: notes || null,
            already_existed: !result.added,
        });
        res.status(result.added ? 201 : 200).json(result);
    } catch (error) {
        errorResponse(res, error.status || 400, safeError(error, 'Failed to add host to allowlist'));
    }
});

// Admin-only: remove a host from the DB allowlist. Patterns coming from
// the env var cannot be removed via API (they live in .env).
router.delete('/azure/host-allowlist/:pattern', requireAuth, requireAdmin, (req, res) => {
    try {
        const result = removeHostFromAllowlist(req.params.pattern);
        if (!result.removed) {
            return errorResponse(res, 404, 'Pattern not found in DB allowlist (note: env-var patterns cannot be removed via API)', 'NOT_FOUND');
        }
        auditLog(req, 'azure_host_allowlist.remove', 'azure_host', req.params.pattern, {});
        res.json(result);
    } catch (error) {
        errorResponse(res, error.status || 500, safeError(error, 'Failed to remove host from allowlist'));
    }
});

export default router;
