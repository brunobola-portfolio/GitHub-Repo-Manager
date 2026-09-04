// SPDX-License-Identifier: Apache-2.0
/**
 * Request validation middleware — thin Zod wrappers that emit the
 * standardised `{ error, code: 'VALIDATION_ERROR' }` envelope and
 * attach parsed data at `req.validatedBody` / `req.validatedQuery` /
 * `req.validatedParams` so handlers never mutate `req.body` in place.
 *
 * The existing `validate()` helper in `lib/validators.js` predates this
 * file and already used `code: 'VALIDATION_ERROR'` for the same condition;
 * this file used to emit the lower_snake `'validation_failed'` for it
 * instead, despite both meaning "the request failed schema validation" —
 * one of the two-envelope collisions closed in B-08. `'validation_failed'`
 * is aliased for one release: routes that need to keep matching it (should
 * any exist) can compare against VALIDATION_FAILED_LEGACY_CODE below. New
 * routes should prefer the helpers exported here; migration of existing
 * `validate()` call-sites is intentionally opt-in to avoid breaking their
 * route tests.
 */
import { errorResponse } from './auth.js';
import { ERROR_CODE } from '../lib/response-shapes.js';

// B-08 alias: the pre-rename value, exported so any server-side code that
// still needs to recognise it (a legacy client, an older log query) has a
// single source to compare against instead of a scattered string literal.
export const VALIDATION_FAILED_LEGACY_CODE = 'validation_failed';

function formatIssueMessage(issue) {
    const path = Array.isArray(issue?.path) ? issue.path.filter(p => p !== undefined && p !== null).join('.') : '';
    const base = issue?.message || 'That request was missing something the server needs.';
    return path ? `${path}: ${base}` : base;
}

function buildValidator(pick, attach) {
    return function validator(schema) {
        return (req, res, next) => {
            const result = schema.safeParse(pick(req));
            if (!result.success) {
                const firstIssue = result.error.issues[0];
                const msg = formatIssueMessage(firstIssue);
                return errorResponse(res, 400, msg, ERROR_CODE.VALIDATION);
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
