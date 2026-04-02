/**
 * GitHub Repo Manager - Tenant Middleware
 *
 * Attaches tenantId from authenticated session.
 * Use after requireAuth to ensure all DB queries are scoped.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

/**
 * Express middleware: attaches req.tenantId from the authenticated session.
 * Must be used after requireAuth so that req.session.userId is guaranteed.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireTenant(req, res, next) {
    if (!req.session?.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    req.tenantId = req.session.userId;
    next();
}
