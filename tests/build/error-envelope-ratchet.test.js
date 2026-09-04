// SPDX-License-Identifier: Apache-2.0
/*
 * B-16 — server/lib/response-shapes.js's canonical `{ data }` / `{ error,
 * code, details }` envelope (sendOk/sendError) is a minority dialect: as of
 * this pass, 312 hand-rolled `.json({ error… })` call-sites coexist with the
 * ~10 that use the shared helper. A big-bang conversion is out of scope (see
 * the finding: "don't big-bang it... convert one router per release") — this
 * is a ratchet instead: the count of hand-rolled sites must never increase,
 * so a new route either adopts the shared helper or at least does not add to
 * the pile the next release has to work through.
 *
 * The count is expected to trend down over time as routers are converted;
 * lower the CURRENT_COUNT constant when that happens rather than leaving
 * slack.
 *
 * Counted across the WHOLE file content (not line-by-line), so a call split
 * across lines like `res.json({\n  error: ...` still counts — a naive
 * line-oriented grep undercounts this by not matching those.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

// Hand-measured at the time this gate was added (server/routes +
// server/middleware, excluding __tests__). Lower this constant whenever a
// router is converted to sendOk/sendError — never raise it to make a new
// hand-rolled site pass.
const CURRENT_COUNT = 376;

const HAND_ROLLED_ERROR_JSON = /\.json\(\s*\{\s*error\b/g;

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

function countHandRolled() {
    let total = 0;
    for (const file of targetFiles()) {
        const src = readFileSync(file, 'utf8');
        const matches = src.match(HAND_ROLLED_ERROR_JSON);
        if (matches) total += matches.length;
    }
    return total;
}

describe('B-16: the hand-rolled `.json({ error… })` count is a non-increasing ratchet', () => {
    it('does not exceed the recorded count', () => {
        const count = countHandRolled();
        expect(
            count,
            count > CURRENT_COUNT
                ? `hand-rolled error envelopes grew from ${CURRENT_COUNT} to ${count} — use sendError() ` +
                  '(server/lib/response-shapes.js) for the new one(s), or lower CURRENT_COUNT if this ' +
                  'run converted existing sites to it'
                : undefined,
        ).toBeLessThanOrEqual(CURRENT_COUNT);
    });

    it('CURRENT_COUNT matches reality (catches a stale constant either direction)', () => {
        expect(countHandRolled()).toBe(CURRENT_COUNT);
    });
});
