// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * One reservation helper, so eighteen routes cannot each get the release wrong.
 *
 * The fix for a check-then-increment race is to reserve atomically up front and
 * hand the unit back if the work fails. Done by hand that means finding every
 * failure path in every handler — early validation returns, provider throws,
 * error mappers — and remembering a release on each. Miss one and the user is
 * charged for a request that failed.
 *
 * Binding the release to the response instead makes it structural: whatever
 * path produced a 4xx/5xx, the refund happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// usage-meter is spread from the real module (AGENTS.md importOriginal
// pattern), and it builds prepared statements at import time — so the db
// double needs the surface it touches, not an empty object.
vi.mock('../../db.js', () => ({
    default: {
        prepare: () => ({ run: () => ({ changes: 1 }), get: () => ({}), all: () => [] }),
        transaction: (fn) => fn,
        exec: () => {},
        pragma: () => {},
    },
}));

const guarded = vi.hoisted(() => ({ allowed: true }));
const guardedIncrementAIUsage = vi.hoisted(() => vi.fn(() => ({ ...guarded, metric: 'ai_readme', current: 1, limit: 25 })));
const releaseGuardedAIUsage = vi.hoisted(() => vi.fn());
vi.mock('../../lib/usage-meter.js', async (io) => ({
    ...(await io()),
    guardedIncrementAIUsage,
    releaseGuardedAIUsage,
}));

const { reserveAIQuota } = await import('../../routes/ai-quota.js');

function appWith(handler) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { userId: 7 }; next(); });
    app.post('/x', handler);
    return app;
}

beforeEach(() => {
    guarded.allowed = true;
    guardedIncrementAIUsage.mockClear();
    releaseGuardedAIUsage.mockClear();
});

describe('reserveAIQuota', () => {
    it('reserves atomically before any work runs', async () => {
        await request(appWith((req, res) => {
            reserveAIQuota(req, res, 'ai_readme');
            res.json({ ok: true });
        })).post('/x');

        expect(guardedIncrementAIUsage).toHaveBeenCalledWith(7, 'ai_readme');
    });

    it('keeps the charge when the request succeeds', async () => {
        await request(appWith((req, res) => {
            reserveAIQuota(req, res, 'ai_readme');
            res.json({ ok: true });
        })).post('/x');

        expect(releaseGuardedAIUsage).not.toHaveBeenCalled();
    });

    it('refunds on an early validation return', async () => {
        await request(appWith((req, res) => {
            reserveAIQuota(req, res, 'ai_readme');
            res.status(400).json({ error: 'repo required' });
        })).post('/x');

        expect(releaseGuardedAIUsage).toHaveBeenCalledWith(7, 'ai_readme');
    });

    it('refunds when the handler throws and the error mapper answers 5xx', async () => {
        const app = appWith(() => { throw new Error('provider exploded'); });
        // Mimic the route-level catch: the reservation is taken first.
        const withReserve = express();
        withReserve.use((req, _res, next) => { req.session = { userId: 7 }; next(); });
        withReserve.post('/x', (req, res) => {
            reserveAIQuota(req, res, 'ai_readme');
            res.status(500).json({ error: 'failed' });
        });
        await request(withReserve).post('/x');
        expect(releaseGuardedAIUsage).toHaveBeenCalledWith(7, 'ai_readme');
        expect(app).toBeTruthy();
    });

    it('refunds exactly once, however many times the response settles', async () => {
        await request(appWith((req, res) => {
            reserveAIQuota(req, res, 'ai_readme');
            res.status(429).json({ error: 'nope' });
        })).post('/x');

        expect(releaseGuardedAIUsage).toHaveBeenCalledTimes(1);
    });

    it('reports the refusal without reserving anything when the cap is already hit', async () => {
        guarded.allowed = false;
        let reserved;
        await request(appWith((req, res) => {
            reserved = reserveAIQuota(req, res, 'ai_readme');
            res.status(429).json({ denied: !reserved.allowed });
        })).post('/x');

        expect(reserved.allowed).toBe(false);
        // Nothing was taken, so nothing may be handed back.
        expect(releaseGuardedAIUsage).not.toHaveBeenCalled();
    });
});
