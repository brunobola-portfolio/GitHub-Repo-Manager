// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/*
 * The Contents fix closed one door. This is the same door, thirty rooms over.
 *
 * `/api/repos/*` handlers interpolate route params into a GitHub API URL and
 * call it with the caller's OAuth token. Express decodes params, and `%2f` does
 * not split a segment during routing, so one param can carry a whole path:
 *
 *   PATCH /api/repos/o/r/issues/%2e%2e%2f%2e%2e%2f%2e%2e%2fuser%2frepos
 *     -> req.params.issue_number === '../../../user/repos'
 *     -> https://api.github.com/repos/user/repos
 *
 * Reproduced against a bare Express router before this middleware existed. The
 * bare `..` and `%2e%2e` forms 404 on their own (Express resolves the path and
 * no route matches), which is why the dangerous variant is the one that keeps
 * the segment count intact — and why a test that only tries `..` proves nothing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { hidesTraversal, noPathTraversal } = await import('../middleware/no-path-traversal.js');

describe('hidesTraversal', () => {
    it.each([
        ['/api/repos/o/r/issues/%2e%2e%2f%2e%2e%2f%2e%2e%2fuser%2frepos', 'the reproduced exploit'],
        ['/api/repos/o/r/issues/%2e%2e%2f%2e%2e', 'two levels up'],
        ['/api/repos/o/r/branches/%2e%2e', 'one encoded segment'],
        ['/api/repos/o/r/issues/..', 'the plain form'],
        ['/api/repos/o/r/issues/%252e%252e%252f%252e%252e', 'double-encoded'],
        ['/api/repos/o/r/issues/%25252e%25252e', 'triple-encoded'],
        ['/api/repos/o/r/issues/%2e%2e%5c%2e%2e', 'backslash separator'],
        ['/api/repos/o/r/issues/%zz', 'malformed encoding'],
    ])('rejects %s (%s)', (path) => {
        expect(hidesTraversal(path)).toBe(true);
    });

    it.each([
        ['/api/repos/o/r/issues/123', 'an issue number'],
        ['/api/repos/o/r/branches/feature%2Fnew-ui', 'a branch name with a slash — %2f alone is legal'],
        ['/api/repos/octo-org/my.repo/issues/7', 'a dot inside a name is not a dot SEGMENT'],
        ['/api/repos/o/r/contents/docs%2Fmy%20file.md', 'an encoded space'],
        ['/api/health', 'no params at all'],
        ['', 'empty'],
    ])('allows %s (%s)', (path) => {
        expect(hidesTraversal(path)).toBe(false);
    });
});

describe('noPathTraversal', () => {
    const resSpy = () => {
        const res = { statusCode: null, body: null };
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (b) => { res.body = b; return res; };
        return res;
    };

    it('400s the exploit path and does not call next', () => {
        const res = resSpy();
        let nexted = false;
        noPathTraversal(
            { path: '/api/repos/o/r/issues/%2e%2e%2f%2e%2e%2f%2e%2e%2fuser%2frepos', method: 'PATCH', ip: '127.0.0.1' },
            res,
            () => { nexted = true },
        );
        expect(res.statusCode).toBe(400);
        expect(nexted).toBe(false);
    });

    it('passes a normal request straight through', () => {
        const res = resSpy();
        let nexted = false;
        noPathTraversal({ path: '/api/repos/o/r/issues/123', method: 'GET', ip: '127.0.0.1' }, res, () => { nexted = true });
        expect(nexted).toBe(true);
        expect(res.statusCode).toBeNull();
    });
});

describe('it is mounted where it can actually help', () => {
    it('runs on /api before the routers that build GitHub URLs', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('server/index.js', 'utf8');
        const guard = src.indexOf("app.use('/api/', noPathTraversal)");
        expect(guard, 'the guard is not mounted').toBeGreaterThan(-1);

        // Every router carrying route params must mount after it, or its
        // routes are reachable without passing through the check. /api/health
        // is the deliberate exception: it takes no params and builds no
        // upstream URL, and it has to answer while the rest is still booting.
        const mounts = [...src.matchAll(/app\.use\('(\/api[^']*)',\s*(\w+)\)/g)]
            .filter(([, , handler]) => handler.endsWith('Router') || handler.endsWith('Routes'))
            .filter(([, mountPath]) => mountPath !== '/api/health');

        expect(mounts.length, 'no routers matched — the assertion stopped testing anything').toBeGreaterThan(0);
        for (const m of mounts) {
            expect(m.index, `${m[2]} is mounted at ${m[1]} before the traversal guard`).toBeGreaterThan(guard);
        }
    });
});
