// SPDX-License-Identifier: Apache-2.0
/*
 * B-22 — a static gate on the contract B-06/B-07/B-08/B-14/B-16 are all
 * instances of: every `res.status(4xx|5xx).json({ ... })` in server/routes
 * and server/middleware must carry `error` as a human-readable string (it
 * contains a space, or its value is a `safeError(...)` call — both signal a
 * message meant for a person) with any machine slug living in a sibling
 * `code` field instead. This is the same shape the honesty gates in this
 * directory already use (readme-honesty, no-off-brand-palette): seed an
 * allowlist with today's offenders, then shrink it — never grow it for a
 * NEW site.
 *
 * Heuristic, not a JS parser: literal numeric status codes only (a dynamic
 * `res.status(error.status || 500)` is out of reach of a regex and is
 * skipped — those sites are not covered by this gate at all, not silently
 * passed). Call-argument extraction counts parens/brackets/braces rather
 * than truly parsing JS, which is a deliberately conservative choice: an
 * embedded, unbalanced paren inside a string literal only WIDENS the
 * captured text, it never truncates it, so the `error:`/`code:` fields
 * being checked for are never hidden from the scan by this shortcut.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

function targetFiles() {
    const dirs = ['server/routes', 'server/middleware'];
    const files = [];
    for (const dir of dirs) {
        for (const f of readdirSync(dir, { recursive: true })) {
            if (typeof f !== 'string' || !f.endsWith('.js')) continue;
            const p = join(dir, f).split(sep).join('/');
            if (p.includes('/__tests__/')) continue;
            files.push(p);
        }
    }
    return files.sort();
}

// Slice from just after a call's opening '(' to its matching ')'.
function extractCallArgs(src, openParenIdx) {
    let depth = 0;
    for (let i = openParenIdx; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
            depth--;
            if (depth === 0) return src.slice(openParenIdx + 1, i);
        }
    }
    return src.slice(openParenIdx + 1, Math.min(src.length, openParenIdx + 500));
}

// Extract the raw source text of a `key: <value>` field's value, up to the
// next top-level comma or the end of the object.
function findField(objSrc, key) {
    const re = new RegExp(`(?:^|[{,\\s])${key}\\s*:\\s*`);
    const m = objSrc.match(re);
    if (!m) return null;
    const start = m.index + m[0].length;
    let depth = 0;
    for (let i = start; i < objSrc.length; i++) {
        const c = objSrc[i];
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') {
            if (depth === 0) return objSrc.slice(start, i).trim();
            depth--;
        } else if (c === ',' && depth === 0) {
            return objSrc.slice(start, i).trim();
        }
    }
    return objSrc.slice(start).trim();
}

function isHumanErrorValue(expr) {
    if (!expr) return false;
    if (/^safeError\s*\(/.test(expr)) return true;
    if (/^mapAIErrorToResponse\b/.test(expr)) return true;
    const quoted = expr.match(/^(['"`])([\s\S]*)\1$/);
    if (quoted) {
        // A template literal's ${...} interpolations don't count toward
        // "contains a space" (the static text around them does).
        const withoutInterp = quoted[2].replace(/\$\{[^}]*\}/g, ' ');
        return /\s/.test(withoutInterp.trim()) ? /\s/.test(withoutInterp) : /\s/.test(quoted[2]);
    }
    // A bare identifier/expression (e.g. `err.message`, a variable) — can't
    // verify statically either way; treat as compliant rather than
    // guessing wrong in the strict direction on unknowable input.
    return true;
}

// A slug-looking `error:` value: a plain quoted string with no whitespace
// and either ALL-lower-with-underscores or ALL-UPPER-with-underscores — the
// two conventions B-08 documents, as opposed to ordinary prose.
function looksLikeSlug(expr) {
    if (!expr) return false;
    const quoted = expr.match(/^(['"`])([\s\S]*)\1$/);
    if (!quoted) return false;
    const v = quoted[2];
    return /^[a-z][a-z0-9_]*$/.test(v) || /^[A-Z][A-Z0-9_]*$/.test(v);
}

const STATUS_JSON = /res\.status\(\s*([1-5]\d\d)\s*\)\s*\.json\s*\(/g;

function scan() {
    const offenders = [];
    for (const file of targetFiles()) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(STATUS_JSON)) {
            const status = Number(m[1]);
            if (status < 400 || status > 599) continue;
            const openParen = m.index + m[0].length - 1;
            const args = extractCallArgs(src, openParen);
            if (!/^\s*\{/.test(args)) continue; // not an object literal — skip (e.g. res.status(x).json(someVar))
            const errorVal = findField(args, 'error');
            if (errorVal === null) continue; // no `error` field — a different shape (e.g. { success: false }), out of scope
            const line = src.slice(0, m.index).split('\n').length;
            const id = `${file}:${line}`;
            if (!isHumanErrorValue(errorVal) || looksLikeSlug(errorVal)) {
                offenders.push({ id, errorVal });
            }
        }
    }
    return offenders;
}

// Seeded at the time this gate was added — every entry is a pre-existing
// site where `error` is a bare machine slug instead of prose (the B-07
// contract inversion: a slug where a human message belongs). Shrink this
// list when a site is fixed; never add to it for a NEW site (fix the new
// site instead — put the slug in `code`, the sentence in `error`).
const ALLOWLIST = new Set([
    'server/routes/billing.js:160',           // 'subscription_exists'
    'server/routes/billing.js:167',           // 'subscription_on_hold'
    'server/routes/license.js:75',            // 'license_revoked'
    'server/routes/license.js:169',           // 'env_license_set'
    'server/routes/license.js:193',           // 'admin_required_multi_user'
    'server/routes/license.js:198',           // 'admin_only'
    'server/routes/migration.js:229',         // 'upgrade_required'
    'server/routes/user-ai-config.js:106',    // 'endpoint_not_allowed'
]);

describe('B-22: res.status(4xx|5xx).json({ error }) carries a human message, not a slug', () => {
    it('every scanned site not on the allowlist has a human `error`', () => {
        const offenders = scan().filter((o) => !ALLOWLIST.has(o.id));
        expect(
            offenders,
            'put the machine slug in `code` and a human sentence in `error` — see server/lib/response-shapes.js',
        ).toEqual([]);
    });

    it('the allowlist has no stale entries', () => {
        const live = new Set(scan().map((o) => o.id));
        const stale = [...ALLOWLIST].filter((id) => !live.has(id));
        expect(stale, 'this site now has a human `error` — drop it from ALLOWLIST').toEqual([]);
    });
});
