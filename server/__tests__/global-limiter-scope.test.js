// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * The pre-session flood net must not be the real limit for paying customers.
 *
 * `globalLimiter` is mounted on all of /api before session middleware, so it
 * ran ahead of `apiLimiter` — the one that reads req.userTier and applies the
 * budgets the tiers are sold with. Being first and keyed per IP, its 200/15min
 * was the binding constraint for everyone: an Enterprise tenant sold 2,000
 * requests per 15 minutes received 200, shared across every colleague behind
 * the same office NAT.
 *
 * Driven through the real middleware rather than by reading its options, so
 * that a change to how express-rate-limit applies `skip` is visible here.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { globalLimiter } = await import('../middleware/tenant-rate-limit.js');

const KEY = 'grm_live_' + 'a'.repeat(32);

function reqWith(headers, ip = '203.0.113.7') {
    return { headers, ip, method: 'GET', path: '/api/repos', socket: { remoteAddress: ip } };
}

function res() {
    const r = { statusCode: null, headers: {} };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = () => r;
    r.send = () => r;
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.getHeader = (k) => r.headers[k];
    return r;
}

/** Run the limiter n times from one IP; return how many reached next(). */
async function drive(headers, n, ip) {
    let passed = 0;
    for (let i = 0; i < n; i += 1) {
         
        await new Promise((resolve) => {
            globalLimiter(reqWith(headers, ip), res(), () => { passed += 1; resolve(); });
            // A blocked request never calls next; resolve on the next tick.
            setImmediate(resolve);
        });
    }
    return passed;
}

describe('the pre-session flood net', () => {
    it('still caps a request that claims no identity', async () => {
        const passed = await drive({}, 260, '203.0.113.1');
        expect(passed, 'anonymous traffic is no longer capped at 200/15min').toBe(200);
    });

    it('lets a session cookie through to the per-tier limiter', async () => {
        // 260 > the 200 net. Not "unlimited" — apiLimiter runs later and is
        // where this request's real budget lives.
        const passed = await drive({ cookie: 'connect.sid=s%3Aabc.def' }, 260, '203.0.113.2');
        expect(passed, 'a paid tenant is still capped at the anonymous IP budget').toBe(260);
    });

    it('lets an API key through to the per-tier limiter', async () => {
        const passed = await drive({ authorization: `Bearer ${KEY}` }, 260, '203.0.113.3');
        expect(passed).toBe(260);
    });

    it('does not treat an unrelated cookie as an identity claim', async () => {
        const passed = await drive({ cookie: 'theme=dark; locale=pt' }, 260, '203.0.113.4');
        expect(passed, 'any cookie at all now escapes the flood net').toBe(200);
    });

    it('does not treat a non-grm bearer as an identity claim', async () => {
        const passed = await drive({ authorization: 'Bearer ghp_something' }, 260, '203.0.113.5');
        expect(passed).toBe(200);
    });
});
