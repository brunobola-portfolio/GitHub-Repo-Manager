// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/work-board-snooze.js', () => ({
    snooze: vi.fn(() => ({ untilAt: '2026-04-22T00:00:00.000Z' })),
    unsnooze: vi.fn(() => 1),
    listSnoozes: vi.fn(() => []),
    isSnoozed: vi.fn(),
    filterOutSnoozed: vi.fn(),
    purgeExpiredSnoozes: vi.fn(),
}));
vi.mock('../lib/work-board-cache.js', () => ({
    invalidate: vi.fn(),
    getCached: vi.fn(),
    putCached: vi.fn(),
    purgeExpired: vi.fn(),
}));
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
        req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok' };
        next();
    },
    errorResponse: (res, status, message, code) => res.status(status).json({ error: message, code }),
    safeError: (err, fallback) => err.message || fallback,
}));

const { default: router } = await import('../routes/work-board-actions.js');
const snoozeLib = await import('../lib/work-board-snooze.js');
const cacheLib = await import('../lib/work-board-cache.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
    return app;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /api/v1/work-board/snooze', () => {
    it('snoozes a PR for 24h and returns untilAt', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(res.status).toBe(200);
        expect(res.body.data.untilAt).toBe('2026-04-22T00:00:00.000Z');
        expect(snoozeLib.snooze).toHaveBeenCalledWith(expect.objectContaining({
            userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24,
        }));
    });

    it('defaults hours to 24 when omitted', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 });
        expect(res.status).toBe(200);
        expect(snoozeLib.snooze).toHaveBeenCalledWith(expect.objectContaining({ hours: 24 }));
    });

    it('invalidates the my_reviews cache on successful snooze of a PR', async () => {
        await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(cacheLib.invalidate).toHaveBeenCalledWith(1, 'my_reviews');
    });

    it('invalidates the my_issues cache when snoozing an issue', async () => {
        await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'issue', itemNumber: 99, hours: 24 });
        expect(cacheLib.invalidate).toHaveBeenCalledWith(1, 'my_issues');
    });

    it('rejects invalid hours', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 9999 });
        expect(res.status).toBe(400);
    });

    it('rejects invalid itemType', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'blob', itemNumber: 42, hours: 24 });
        expect(res.status).toBe(400);
    });

    it('rejects invalid repoFullName (not owner/repo)', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'invalid', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(res.status).toBe(400);
    });

    it('rejects non-positive itemNumber', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 0, hours: 24 });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/v1/work-board/snooze', () => {
    it('unsnoozes and returns removed count', async () => {
        const res = await request(makeApp()).delete('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 });
        expect(res.status).toBe(200);
        expect(res.body.data.removed).toBe(1);
    });

    it('invalidates cache on delete', async () => {
        await request(makeApp()).delete('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'issue', itemNumber: 99 });
        expect(cacheLib.invalidate).toHaveBeenCalledWith(1, 'my_issues');
    });

    it('rejects invalid itemType', async () => {
        const res = await request(makeApp()).delete('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'blob', itemNumber: 42 });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/v1/work-board/snoozes', () => {
    it('returns the array of active snoozes', async () => {
        snoozeLib.listSnoozes.mockReturnValueOnce([
            { repoFullName: 'o/r', itemType: 'pr', itemNumber: 1, untilAt: '2026-05-01T00:00:00.000Z' },
        ]);
        const res = await request(makeApp()).get('/api/v1/work-board/snoozes');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(snoozeLib.listSnoozes).toHaveBeenCalledWith({ userId: 1 });
    });

    it('returns empty array when no snoozes', async () => {
        const res = await request(makeApp()).get('/api/v1/work-board/snoozes');
        expect(res.body.data).toEqual([]);
    });
});
