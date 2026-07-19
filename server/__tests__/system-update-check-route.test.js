// server/__tests__/system-update-check-route.test.js
//
// GET /api/system/update-check (W1.4): requireAuth-gated, never surfaces a
// 500 to the client, and forwards the app's package.json version + the
// UPDATE_CHECK config flag into checkForUpdate().
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => (req.headers['x-authed'] ? next() : res.status(401).json({ error: 'Session expired. Please login again.' })),
    safeError: (e, fallback) => fallback,
}));
vi.mock('../db.js', () => ({
    default: { prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn() })) },
    initDB: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let mockedConfig;
vi.mock('../config.js', () => ({ config: { updateCheckEnabled: true } }));

const checkForUpdateMock = vi.fn();
vi.mock('../lib/update-check.js', () => ({ checkForUpdate: (...args) => checkForUpdateMock(...args) }));

let router;
beforeEach(async () => {
    vi.clearAllMocks();
    router = (await import('../routes/system.js')).default;
    mockedConfig = (await import('../config.js')).config;
    mockedConfig.updateCheckEnabled = true;
});

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/system', router);
    return a;
}

describe('GET /api/system/update-check', () => {
    it('requires auth (401 without a session)', async () => {
        const res = await request(app()).get('/api/system/update-check');
        expect(res.status).toBe(401);
        expect(checkForUpdateMock).not.toHaveBeenCalled();
    });

    it('forwards the current package version and the UPDATE_CHECK flag', async () => {
        checkForUpdateMock.mockResolvedValue({
            current: pkg.version, latest: '99.0.0', updateAvailable: true,
            releaseUrl: 'https://example.com', checkedAt: '2026-01-01T00:00:00.000Z',
        });
        const res = await request(app()).get('/api/system/update-check').set('x-authed', '1');
        expect(res.status).toBe(200);
        expect(checkForUpdateMock).toHaveBeenCalledWith({ currentVersion: pkg.version, disabled: false });
        expect(res.body).toEqual({
            current: pkg.version, latest: '99.0.0', updateAvailable: true,
            releaseUrl: 'https://example.com', checkedAt: '2026-01-01T00:00:00.000Z',
        });
    });

    it('passes disabled: true through to checkForUpdate when UPDATE_CHECK=false', async () => {
        mockedConfig.updateCheckEnabled = false;
        checkForUpdateMock.mockResolvedValue({ current: pkg.version, disabled: true });
        const res = await request(app()).get('/api/system/update-check').set('x-authed', '1');
        expect(res.status).toBe(200);
        expect(checkForUpdateMock).toHaveBeenCalledWith({ currentVersion: pkg.version, disabled: true });
        expect(res.body).toEqual({ current: pkg.version, disabled: true });
    });

    it('never surfaces a 500 — an unexpected throw degrades to a bare current-version payload', async () => {
        checkForUpdateMock.mockRejectedValue(new Error('boom'));
        const res = await request(app()).get('/api/system/update-check').set('x-authed', '1');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ current: pkg.version });
    });
});
