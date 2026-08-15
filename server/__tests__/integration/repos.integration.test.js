// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Integration test for GET /api/v1/repos — real in-memory SQLite.
 *
 * Exercises the mirror-annotation code path in routes/repos/crud.js:
 *   GET / builds a mirrorMap by selecting from migration_jobs where
 *   user_id = ? AND is_mirror = 1, then decorates each GitHub repo with
 *   `isMirror: mirrorMap.has(full_name)`.
 *
 * Only external edge mocked: githubApi (stands in for the GitHub REST API).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeIntegrationDb } from '../helpers/integration-db.js';

const { initDB: realInitDB } = await vi.importActual('../../db.js');
const testDb = makeIntegrationDb(realInitDB);
vi.mock('../../db.js', () => ({ default: testDb }));

const mockGithubApi = vi.fn();
vi.mock('../../lib/github-api.js', () => ({
    githubApi: (...args) => mockGithubApi(...args),
}));

vi.mock('../../lib/audit.js', () => ({
    auditLog: vi.fn(),
}));

vi.mock('../../middleware/auth.js', async () => {
    const actual = await vi.importActual('../../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok' };
            next();
        },
    };
});

vi.mock('../../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: reposRouter } = await import('../../routes/repos.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
        next();
    });
    app.use('/api/v1/repos', reposRouter);
    return app;
}

beforeEach(() => {
    testDb.exec(`
        DELETE FROM migration_jobs;
        DELETE FROM users;
    `);
    testDb.prepare(`INSERT OR IGNORE INTO users (id, username, avatar_url) VALUES (?, ?, ?)`)
        .run(1, 'alice', 'https://example.com/a.png');
    mockGithubApi.mockReset();
});

describe('GET /api/v1/repos (integration) — mirror annotation', () => {
    it('annotates each GitHub repo with isMirror based on migration_jobs (is_mirror=1)', async () => {
        // Seed a mirror row
        testDb.prepare(`
            INSERT INTO migration_jobs
                (user_id, source_type, source_url, source_name, target_owner, target_repo, is_mirror, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(1, 'azure', 'https://example/x', 'x', 'acme', 'x', 1, 'completed');

        // Also seed a non-mirror migration row for the same user — must NOT
        // appear in the mirror map (guards against the is_mirror=1 filter
        // being dropped from the WHERE clause).
        testDb.prepare(`
            INSERT INTO migration_jobs
                (user_id, source_type, source_url, source_name, target_owner, target_repo, is_mirror, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(1, 'azure', 'https://example/y', 'y', 'acme', 'y', 0, 'completed');

        mockGithubApi.mockResolvedValue({
            data: [
                { full_name: 'acme/x', name: 'x', id: 101 },
                { full_name: 'acme/y', name: 'y', id: 102 },
            ],
            headers: new Map(),
        });

        const res = await request(makeApp()).get('/api/v1/repos');
        expect(res.status).toBe(200);
        expect(res.body.repos).toHaveLength(2);

        const byName = Object.fromEntries(res.body.repos.map(r => [r.full_name, r]));
        expect(byName['acme/x'].isMirror).toBe(true);
        expect(byName['acme/y'].isMirror).toBe(false);
    });

    it('does not leak other users\' mirror flags (user_id filter is live)', async () => {
        // Mirror owned by user 2, NOT user 1 (our session).
        testDb.prepare(`INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)`).run(2, 'bob');
        testDb.prepare(`
            INSERT INTO migration_jobs
                (user_id, source_type, source_url, source_name, target_owner, target_repo, is_mirror, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(2, 'azure', 'https://example/x', 'x', 'acme', 'x', 1, 'completed');

        mockGithubApi.mockResolvedValue({
            data: [{ full_name: 'acme/x', name: 'x', id: 101 }],
            headers: new Map(),
        });

        const res = await request(makeApp()).get('/api/v1/repos');
        expect(res.status).toBe(200);
        // User 1 should NOT see bob's mirror
        expect(res.body.repos[0].isMirror).toBe(false);
    });
});
