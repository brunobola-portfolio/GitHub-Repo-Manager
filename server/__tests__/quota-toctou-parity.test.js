// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Check-then-increment across an await is a race, everywhere it appears.
 *
 * `checkAIFeatureLimit()` is a read. When the matching `incrementAIUsage()`
 * happens AFTER an awaited provider call, every request arriving during that
 * window reads the same stale count and is admitted — so a burst spends N
 * times the cap. It was measured on image generation (three requests generated
 * against one remaining slot) and the same shape existed in eighteen other
 * places.
 *
 * `reserveAIQuota()` is the replacement: it reserves atomically up front and
 * refunds automatically on any 4xx/5xx.
 *
 * A static gate, because the failure mode is a SHAPE — a behavioural test per
 * route would only ever cover the routes someone remembered to write one for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

// Regex LITERALS, deliberately. Building these with a template literal turns
// `\s` into `s` and matches nothing — the first version of this gate passed
// while all eighteen sites were still racy.
const CHECK_RE = /checkAIFeatureLimit\(\s*\w+\s*,\s*'([a-z_]+)'\s*\)/;
const INCREMENT_RE = /increment(?:AI)?Usage\(\s*\w+\s*,\s*'([a-z_]+)'\s*\)/;

/**
 * Report every `checkAIFeatureLimit` whose matching increment sits after an
 * `await`. Takes source text so the detector itself is testable.
 */
export function findRacyPairs(src, label = 'source') {
    const lines = src.split('\n');
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        const check = CHECK_RE.exec(lines[i]);
        if (!check) continue;
        for (let j = i + 1; j < lines.length; j++) {
            const inc = INCREMENT_RE.exec(lines[j]);
            if (!inc || inc[1] !== check[1]) continue;
            if (/\bawait\b/.test(lines.slice(i + 1, j).join('\n'))) {
                found.push(`${label}:${i + 1} (${check[1]}, increments at :${j + 1})`);
            }
            break;
        }
    }
    return found;
}

function routeFiles() {
    const dir = 'server/routes';
    return readdirSync(dir, { recursive: true })
        .filter((f) => typeof f === 'string' && f.endsWith('.js'))
        .map((f) => join(dir, f).split(sep).join('/'));
}

// The shape this gate exists to catch, verbatim. Pinning the detector against
// a fixture rather than against production is what keeps it meaningful once
// production is clean — otherwise "no matches" and "scanner broken" look
// identical, which is exactly how the first version of this gate passed.
const RACY_FIXTURE = `
router.post('/ai/thing', async (req, res) => {
    const check = checkAIFeatureLimit(userId, 'ai_thing');
    if (!check.allowed) return res.status(429).json(quotaExceededResponse(check));
    const { text } = await provider.generate({ prompt });
    incrementAIUsage(userId, 'ai_thing');
    res.json({ text });
});`;

const SAFE_FIXTURE = `
router.post('/ai/thing', async (req, res) => {
    const reserved = reserveAIQuota(req, res, 'ai_thing');
    if (!reserved.allowed) return res.status(429).json(quotaExceededResponse(reserved));
    const { text } = await provider.generate({ prompt });
    res.json({ text });
});`;

describe('AI quota reservations are atomic', () => {
    it('detects the racy shape (proves the scanner works)', () => {
        expect(findRacyPairs(RACY_FIXTURE, 'fixture')).toHaveLength(1);
    });

    it('does not flag an atomic reservation', () => {
        expect(findRacyPairs(SAFE_FIXTURE, 'fixture')).toEqual([]);
    });

    it('does not flag a check and increment with no await between them', () => {
        expect(findRacyPairs(`
    const check = checkAIFeatureLimit(userId, 'ai_thing');
    if (!check.allowed) return;
    incrementAIUsage(userId, 'ai_thing');`, 'fixture')).toEqual([]);
    });

    it('no route reads a quota, awaits, and only then increments', () => {
        const racy = routeFiles().flatMap((f) => findRacyPairs(readFileSync(f, 'utf8'), f));
        expect(
            racy,
            'use reserveAIQuota: a burst through this window spends past the cap',
        ).toEqual([]);
    });
});
