// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock auth middleware so we can isolate the Zod layer.
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, user: { tier: 'free' }, accessToken: 'tok' };
            next();
        },
    };
});

// Mock DB and audit so the handler never runs against real state when valid.
vi.mock('../db.js', () => ({
    default: {
        prepare: vi.fn(() => ({
            get: vi.fn(() => null),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ lastInsertRowid: 1, changes: 1 })),
        })),
        transaction: (fn) => fn,
    },
}));
vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }));

const { default: router } = await import('../routes/teams.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
        next();
    });
    app.use('/api/v1/teams', router);
    return app;
}

describe('POST /api/v1/teams — validateBody migration', () => {
    it('rejects empty name with code "validation_failed"', async () => {
        const res = await request(makeApp()).post('/api/v1/teams').send({ name: '' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('validation_failed');
        expect(res.body.error).toMatch(/^name: /);
    });
});

describe('POST /api/v1/teams/:id/members — validateBody migration', () => {
    it('rejects missing username with code "validation_failed"', async () => {
        const res = await request(makeApp()).post('/api/v1/teams/1/members').send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('validation_failed');
        expect(res.body.error).toMatch(/^username: /);
    });
});
