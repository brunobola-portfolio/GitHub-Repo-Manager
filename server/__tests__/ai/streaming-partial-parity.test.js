// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every SSE route must carry the stream's `partial` flag into its spend record.
 *
 * `streamToSSEWithUsage` / `streamReplyDeltasToSSE` report whether the client
 * disconnected before the stream drained. A route that destructures `usage` and
 * `costUSD` but drops `partial` still bills correctly — but the audit entry then
 * reads as a complete call, so an operator reconciling spend cannot tell which
 * costs are totals and which are floors.
 *
 * A static gate rather than a behavioural test per route, for the same reason as
 * the abort-signal parity gate next door: the failure mode is an omission, and
 * the next streaming route added has to fail here rather than pass silently.
 *
 * Scoped to files that import a usage-aware stream helper. The other
 * `recordStreamCompletion` callers (deep-review, pr-commands, prompt-studio)
 * are blocking generations that either finish or throw — there is no partial
 * state for them to report, and demanding `partial: false` there would be noise.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_DIRS = ['server/routes/ai', 'server/routes'];
const STREAM_HELPERS = /\b(streamToSSEWithUsage|streamReplyDeltasToSSE)\b/;

function jsFilesIn(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return []; }
    return entries
        .map((name) => join(dir, name))
        .filter((p) => statSync(p).isFile() && p.endsWith('.js'));
}

/** Files that consume a usage-aware stream helper (the helper module itself aside). */
function sseRouteFiles() {
    const files = [];
    for (const dir of ROUTE_DIRS) {
        for (const file of jsFilesIn(dir)) {
            if (file.endsWith('ai-streaming.js')) continue;
            const src = readFileSync(file, 'utf8');
            if (STREAM_HELPERS.test(src)) files.push({ file, src });
        }
    }
    return files;
}

/** Walk braces from an opening `{` so nested objects do not truncate the slice. */
function objectAt(src, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(openIndex, i + 1); }
    }
    return src.slice(openIndex);
}

function callsMatching(re, capture) {
    const found = [];
    for (const { file, src } of sseRouteFiles()) {
        const rx = new RegExp(re.source, 'g');
        let m;
        while ((m = rx.exec(src)) !== null) {
            found.push({
                file,
                line: src.slice(0, m.index).split('\n').length,
                args: capture(src, m),
            });
        }
    }
    return found;
}

describe('SSE routes — partial-stream parity', () => {
    const records = callsMatching(
        /recordStreamCompletion\(\s*req\s*,\s*\{/,
        (src, m) => objectAt(src, m.index + m[0].length - 1),
    );
    const destructures = callsMatching(
        /const\s*\{[^}]*\}\s*=\s*await\s+(?:streamToSSEWithUsage|streamReplyDeltasToSSE)\(/,
        (_src, m) => m[0],
    );

    it('finds the SSE call sites at all (guards the scanner itself)', () => {
        // A scanner that silently matched nothing would make both assertions
        // below vacuous.
        // Fewer destructures than records: core.js and pr-chat.js bind the whole
        // helper result and read fields off it, so they are covered by the
        // record-site assertion alone.
        expect(records.length).toBeGreaterThanOrEqual(8);
        expect(destructures.length).toBeGreaterThanOrEqual(6);
    });

    it('captures partial from every stream helper result', () => {
        const dropped = destructures
            .filter(({ args }) => !/\bpartial\b/.test(args))
            .map(({ file, line }) => `${file}:${line}`);

        expect(dropped, 'the flag is discarded at the destructure').toEqual([]);
    });

    it('passes partial into every spend record', () => {
        const missing = records
            .filter(({ args }) => !/\bpartial\b/.test(args))
            .map(({ file, line }) => `${file}:${line}`);

        expect(missing, 'these would audit a truncated stream as a complete one').toEqual([]);
    });
});
