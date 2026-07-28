// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every streaming AI route must hand the provider an abort signal.
 *
 * Without one, a client that disconnects mid-stream stops the SSE writes but
 * NOT the generation: the provider runs to completion and the operator is
 * billed for every output token, none of which anyone received. Four routes
 * were in that state — generate-commit, generate-pr, refine and chat-refine —
 * while their four siblings passed it correctly, so this was drift rather than
 * a decision.
 *
 * A static gate rather than four behavioural tests, because the failure mode is
 * an omission: the next streaming route added without a signal has to fail
 * here, and a behavioural test only covers routes someone remembered to write
 * one for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_DIRS = ['server/routes/ai', 'server/routes'];

function jsFilesIn(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return []; }
    return entries
        .map((name) => join(dir, name))
        .filter((p) => statSync(p).isFile() && p.endsWith('.js'));
}

/**
 * Collect every `…generateStream({ … })` call with its argument object, so the
 * assertion is about the options actually passed rather than about nearby text.
 */
function generateStreamCalls() {
    const found = [];
    for (const dir of ROUTE_DIRS) {
        for (const file of jsFilesIn(dir)) {
            const src = readFileSync(file, 'utf8');
            const re = /generateStream\(\{/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                // Walk braces from the opening `{` so nested objects such as
                // generationConfig do not truncate the slice.
                let depth = 0;
                let i = m.index + m[0].length - 1;
                for (; i < src.length; i++) {
                    if (src[i] === '{') depth++;
                    else if (src[i] === '}') { depth--; if (depth === 0) break; }
                }
                const args = src.slice(m.index, i + 1);
                const line = src.slice(0, m.index).split('\n').length;
                found.push({ file, line, args });
            }
        }
    }
    return found;
}

describe('streaming routes — abort signal parity', () => {
    const calls = generateStreamCalls();

    it('finds the streaming call sites at all (guards the scanner itself)', () => {
        // A scanner that silently matches nothing would make every assertion
        // below vacuous.
        expect(calls.length).toBeGreaterThanOrEqual(8);
    });

    it('passes an abort signal at every call site', () => {
        const missing = calls
            .filter(({ args }) => !/\bsignal\s*:/.test(args))
            .map(({ file, line }) => `${file}:${line}`);

        expect(missing, 'these would keep generating after the client disconnects').toEqual([]);
    });

    it('wires the signal to the SSE connection rather than a fresh controller', () => {
        // sse.signal is the one that fires on client disconnect. A detached
        // AbortController would satisfy the check above and abort nothing.
        const wrong = calls
            .filter(({ args }) => /\bsignal\s*:/.test(args))
            .filter(({ args }) => !/signal\s*:\s*\w*sse\w*\.signal/i.test(args))
            .map(({ file, line }) => `${file}:${line}`);

        expect(wrong, 'signal must come from the SSE helper').toEqual([]);
    });
});
