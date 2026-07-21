// server/__tests__/system-update-routes.test.js
//
// POST /api/system/update and GET /api/system/update/status: 404 unless
// managed + Windows, 403 unless loopback, 202/409/400 mapping from the
// updater lib's UpdateError, and status passthrough. Also covers /status
// carrying updateResult from the (mocked) updater lib. The updater lib
// itself is fully mocked — this test is only about the route's plumbing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Real rate limiting would make several tests in this file share one
// 2-per-5-minutes bucket (same loopback IP, module-cached limiter instance)
// and fail with 429s unrelated to what's under test.
vi.mock('express-rate-limit', () => ({ default: () => (_req, _res, next) => next() }));

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => next(),
    safeError: (e, fallback) => fallback,
}));
vi.mock('../db.js', () => ({
    default: { prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn() })) },
    initDB: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config.js', () => ({ config: { updateCheckEnabled: true } }));
vi.mock('../lib/update-check.js', () => ({ checkForUpdate: vi.fn() }));
vi.mock('../lib/data-dir.js', () => ({ getDataDir: () => 'C:/fake-data' }));

const isManagedMock = vi.fn();
vi.mock('../lib/managed-runtime.js', () => ({
    isManaged: (...a) => isManagedMock(...a),
    verifyShutdownToken: vi.fn(() => true),
}));
const requestShutdownMock = vi.fn(() => true);
vi.mock('../lib/shutdown.js', () => ({ requestShutdown: (...a) => requestShutdownMock(...a) }));

const startUpdateMock = vi.fn();
const getUpdateProgressMock = vi.fn();
const readAndClearUpdateResultMock = vi.fn();
vi.mock('../lib/updater.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        startUpdate: (...a) => startUpdateMock(...a),
        getUpdateProgress: (...a) => getUpdateProgressMock(...a),
        readAndClearUpdateResult: (...a) => readAndClearUpdateResultMock(...a),
    };
});

let router;
let originalPlatform;
beforeEach(async () => {
    vi.clearAllMocks();
    isManagedMock.mockReturnValue(true);
    startUpdateMock.mockResolvedValue(undefined);
    getUpdateProgressMock.mockReturnValue({ phase: 'idle', percent: 0, error: null, target: null });
    readAndClearUpdateResultMock.mockReturnValue(null);
    originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    router = (await import('../routes/system.js')).default;
});
afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
});

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/system', router);
    return a;
}

describe('POST /api/system/update', () => {
    it('404s when not managed', async () => {
        isManagedMock.mockReturnValue(false);
        const res = await request(app()).post('/api/system/update');
        expect(res.status).toBe(404);
        expect(startUpdateMock).not.toHaveBeenCalled();
    });

    it('404s on a non-Windows platform even when managed', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        const res = await request(app()).post('/api/system/update');
        expect(res.status).toBe(404);
        expect(startUpdateMock).not.toHaveBeenCalled();
    });

    it('403s a proxied (non-loopback) request', async () => {
        const res = await request(app()).post('/api/system/update').set('X-Forwarded-For', '1.2.3.4');
        expect(res.status).toBe(403);
        expect(startUpdateMock).not.toHaveBeenCalled();
    });

    it('202s and calls startUpdate with the current version/dataDir/packageRoot on success', async () => {
        const res = await request(app()).post('/api/system/update');
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ updating: true });
        expect(startUpdateMock).toHaveBeenCalledTimes(1);
        const arg = startUpdateMock.mock.calls[0][0];
        expect(arg.dataDir).toBe('C:/fake-data');
        expect(typeof arg.currentVersion).toBe('string');
    });

    it('409s when startUpdate throws already_running', async () => {
        const { UpdateError } = await import('../lib/updater.js');
        startUpdateMock.mockRejectedValue(new UpdateError('already_running', 'An update is already in progress'));
        const res = await request(app()).post('/api/system/update');
        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: 'An update is already in progress', code: 'already_running' });
    });

    it('400s when startUpdate throws a non-already_running UpdateError', async () => {
        const { UpdateError } = await import('../lib/updater.js');
        startUpdateMock.mockRejectedValue(new UpdateError('no_update', 'No update is available'));
        const res = await request(app()).post('/api/system/update');
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'No update is available', code: 'no_update' });
    });

    it('500s on an unexpected non-UpdateError failure', async () => {
        startUpdateMock.mockRejectedValue(new Error('boom'));
        const res = await request(app()).post('/api/system/update');
        expect(res.status).toBe(500);
    });
});

describe('GET /api/system/update/status', () => {
    it('passes through getUpdateProgress() verbatim', async () => {
        getUpdateProgressMock.mockReturnValue({ phase: 'downloading', percent: 42, error: null, target: { from: '4.8.2', to: '4.9.0', mode: 'portable' } });
        const res = await request(app()).get('/api/system/update/status');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ phase: 'downloading', percent: 42, error: null, target: { from: '4.8.2', to: '4.9.0', mode: 'portable' } });
    });
});

describe('GET /api/system/status', () => {
    it('carries updateResult from the updater lib when managed', async () => {
        readAndClearUpdateResultMock.mockReturnValue({ status: 'success', from: '4.8.2', to: '4.9.0', at: 'x', logPath: null });
        const res = await request(app()).get('/api/system/status');
        expect(res.status).toBe(200);
        expect(res.body.updateResult).toEqual({ status: 'success', from: '4.8.2', to: '4.9.0', at: 'x', logPath: null });
    });

    it('updateResult is null when not managed, and readAndClearUpdateResult is never called', async () => {
        isManagedMock.mockReturnValue(false);
        const res = await request(app()).get('/api/system/status');
        expect(res.status).toBe(200);
        expect(res.body.updateResult).toBeNull();
        expect(readAndClearUpdateResultMock).not.toHaveBeenCalled();
    });
});
