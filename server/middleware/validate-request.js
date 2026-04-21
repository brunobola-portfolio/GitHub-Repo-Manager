// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Request validation middleware — thin Zod wrappers that emit the
 * standardised `{ error, code: 'validation_failed' }` envelope and
 * attach parsed data at `req.validatedBody` / `req.validatedQuery` /
 * `req.validatedParams` so handlers never mutate `req.body` in place.
 *
 * The existing `validate()` helper in `lib/validators.js` predates this
 * file and rewrites `req.body` with a different error envelope
 * (`code: 'VALIDATION_ERROR'`). New routes should prefer the helpers
 * exported here; migration of existing `validate()` call-sites is
 * intentionally opt-in to avoid breaking their route tests.
 */
import { errorResponse } from './auth.js';

function formatIssueMessage(issue) {
    const path = Array.isArray(issue?.path) ? issue.path.filter(p => p !== undefined && p !== null).join('.') : '';
    const base = issue?.message || 'Invalid input';
    return path ? `${path}: ${base}` : base;
}

function buildValidator(pick, attach) {
    return function validator(schema) {
        return (req, res, next) => {
            const result = schema.safeParse(pick(req));
            if (!result.success) {
                const firstIssue = result.error.issues[0];
                const msg = formatIssueMessage(firstIssue);
                return errorResponse(res, 400, msg, 'validation_failed');
            }
            attach(req, result.data);
            return next();
        };
    };
}

export const validateBody = buildValidator(
    (req) => req.body,
    (req, data) => { req.validatedBody = data; },
);

export const validateQuery = buildValidator(
    (req) => req.query,
    (req, data) => { req.validatedQuery = data; },
);

export const validateParams = buildValidator(
    (req) => req.params,
    (req, data) => { req.validatedParams = data; },
);
