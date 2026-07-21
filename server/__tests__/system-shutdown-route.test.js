// server/__tests__/system-shutdown-route.test.js
//
// POST /api/system/shutdown: 404 unless GRM_MANAGED, 403 unless loopback AND
// token match, 202 + single requestShutdown on success. Session/CSRF play no
// part — the callers (stop.ps1, installer curl) have neither.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

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
const verifyTokenMock = vi.fn();
vi.mock('../lib/managed-runtime.js', () => ({
    isManaged: (...a) => isManagedMock(...a),
    verifyShutdownToken: (...a) => verifyTokenMock(...a),
}));
const requestShutdownMock = vi.fn(() => true);
vi.mock('../lib/shutdown.js', () => ({ requestShutdown: (...a) => requestShutdownMock(...a) }));

let router;
beforeEach(async () => {
    vi.clearAllMocks();
    isManagedMock.mockReturnValue(true);
    verifyTokenMock.mockReturnValue(true);
    router = (await import('../routes/system.js')).default;
});

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/system', router);
    return a;
}

// supertest connects over a real loopback socket with a loopback Host header,
// so isLoopbackRequest passes naturally; forcing a proxy header flips it.
describe('POST /api/system/shutdown', () => {
    it('404s when not managed (endpoint invisible in dev/Docker)', async () => {
        isManagedMock.mockReturnValue(false);
        const res = await request(app()).post('/api/system/shutdown');
        expect(res.status).toBe(404);
        expect(requestShutdownMock).not.toHaveBeenCalled();
    });
    it('403s a proxied request even with a valid token', async () => {
        const res = await request(app()).post('/api/system/shutdown')
            .set('X-Forwarded-For', '1.2.3.4')
            .set('X-GRM-Shutdown-Token', 'tok');
        expect(res.status).toBe(403);
        expect(requestShutdownMock).not.toHaveBeenCalled();
    });
    it('403s on a bad token', async () => {
        verifyTokenMock.mockReturnValue(false);
        const res = await request(app()).post('/api/system/shutdown')
            .set('X-GRM-Shutdown-Token', 'wrong');
        expect(res.status).toBe(403);
        expect(verifyTokenMock).toHaveBeenCalledWith('C:/fake-data', 'wrong');
        expect(requestShutdownMock).not.toHaveBeenCalled();
    });
    it('202s and requests shutdown exactly once on a valid call', async () => {
        const res = await request(app()).post('/api/system/shutdown')
            .set('X-GRM-Shutdown-Token', 'tok');
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ shuttingDown: true });
        await new Promise((r) => setImmediate(r));
        expect(requestShutdownMock).toHaveBeenCalledTimes(1);
        expect(requestShutdownMock).toHaveBeenCalledWith('api');
    });
});
