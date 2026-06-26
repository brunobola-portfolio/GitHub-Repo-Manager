// server/__tests__/env-routes.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/env/readiness.js', () => ({
  getReadiness: vi.fn().mockResolvedValue({ platform: 'linux', ok: true, tools: [{ id: 'git', status: 'ok', version: '2.45.1' }] }),
}));
vi.mock('../lib/env/package-managers.js', () => ({ resolveManagers: vi.fn().mockResolvedValue({ available: ['apt'], preferred: 'apt' }) }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => next(),
  errorResponse: (res, code, msg, c) => res.status(code).json({ error: msg, code: c }),
  safeError: (e, f) => f,
}));
vi.mock('../middleware/require-admin.js', () => ({ requireAdmin: (req, res, next) => (req.headers['x-admin'] ? next() : res.status(403).json({ error: 'Admin only' })) }));
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../config.js', () => ({ config: { envToolingInstallEnabled: true } }));

let router;
let mockedConfig;
beforeEach(async () => {
  router = (await import('../routes/env.js')).default;
  mockedConfig = (await import('../config.js')).config;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/env', router);
  return a;
}

describe('GET /api/env/tooling', () => {
  it('returns readiness + managers', async () => {
    const res = await request(app()).get('/api/env/tooling');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ platform: 'linux', readiness: { ok: true } });
    expect(res.body.managers.preferred).toBe('apt');
  });
});

describe('POST /api/env/tooling/:id/install', () => {
  it('is admin-gated', async () => {
    const res = await request(app()).post('/api/env/tooling/git-lfs/install');
    expect(res.status).toBe(403);
  });

  it('returns 403 install_disabled when flag is false', async () => {
    mockedConfig.envToolingInstallEnabled = false;
    try {
      const res = await request(app()).post('/api/env/tooling/any-tool/install').set('x-admin', '1');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('install_disabled');
    } finally {
      mockedConfig.envToolingInstallEnabled = true;
    }
  });

  it('returns 404 unknown_tool for an unrecognised tool id', async () => {
    const res = await request(app()).post('/api/env/tooling/not-a-real-tool/install').set('x-admin', '1');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('unknown_tool');
  });
});
