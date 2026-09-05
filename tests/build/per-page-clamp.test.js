// SPDX-License-Identifier: Apache-2.0
/*
 * The global `app.use('/api/', ...)` per_page-clamping middleware was removed
 * (server/index.js) once it was discovered to be dead code: Express 5 defines
 * `req.query` as a non-memoised getter that re-parses the URL string on every
 * access, so writing `req.query.per_page = ...` in that middleware never
 * changed what a downstream handler's own `req.query.per_page` read saw. The
 * guard had silently never worked, and its presence was actively dangerous —
 * it read like an app-wide guarantee that no individual route needed to
 * enforce its own bound.
 *
 * Every route that reads `req.query.per_page` is now solely responsible for
 * clamping it itself (via clampPerPage in routes/repos/_shared.js, or an
 * equivalent inline Math.min/Math.max bound). This is a ratchet: it scans
 * every server/routes file for a `req.query.per_page` read and fails if that
 * read is not visibly guarded on the same line (or the next couple of lines,
 * for a destructured `per_page` bound a few lines later).
 *
 * This does not prove correctness (a sufficiently indirect clamp would still
 * slip past it) — it is a tripwire against the easy regression: a new route
 * added straight off `req.query.per_page` with no bound at all, relying on
 * the (defunct) global middleware the way the pre-removal codebase did.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

function targetFiles() {
    const files = [];
    for (const f of readdirSync('server/routes', { recursive: true })) {
        if (typeof f !== 'string' || !f.endsWith('.js')) continue;
        const p = join('server/routes', f).split(sep).join('/');
        if (p.includes('/__tests__/')) continue;
        files.push(p);
    }
    return files.sort();
}

// A "guard" is either:
//  - a call to clampPerPage(...) somewhere in the file that is fed by
//    req.query.per_page (directly or via a destructured `per_page`), or
//  - an inline Math.min(Math.max(...)) / Math.min(..., Math.max(...)) bound
//    applied to a variable derived from req.query.per_page in the same
//    statement.
// Rather than trying to fully parse the dataflow, this checks per-file: any
// file that mentions `per_page` in a `req.query` read must also mention
// either `clampPerPage` or `Math.min` somewhere in the file. This is
// deliberately coarse (file-level, not line-level) because several routes
// destructure `per_page` from req.query at the top of the handler and clamp
// a few lines later.
const READS_QUERY_PER_PAGE = /req\.query(?:\.per_page\b|\s*;?\s*\n[^;]*\bper_page\b|\[['"]per_page['"]\])|\{\s*[^}]*\bper_page\b[^}]*\}\s*=\s*req\.query/;

function isGuarded(src) {
    return /\bclampPerPage\s*\(/.test(src) || /\bMath\.min\s*\(/.test(src);
}

describe('every server/routes reader of req.query.per_page clamps it', () => {
    for (const file of targetFiles()) {
        const src = readFileSync(file, 'utf8');
        if (!/req\.query/.test(src) || !/per_page/.test(src)) continue;
        if (!READS_QUERY_PER_PAGE.test(src)) continue;

        it(`${file} clamps per_page read from req.query`, () => {
            expect(
                isGuarded(src),
                `${file} reads req.query.per_page but has no visible clampPerPage()/Math.min() bound. ` +
                `The global per_page-clamping middleware in server/index.js was removed as dead code ` +
                `(Express 5's req.query getter made it a no-op) — every reader must clamp itself now.`,
            ).toBe(true);
        });
    }
});
