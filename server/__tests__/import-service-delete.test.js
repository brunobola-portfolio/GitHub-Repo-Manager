// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('simple-git', () => ({
    simpleGit: () => ({
        version: vi.fn(async () => ({ installed: true })),
        clone: vi.fn(async () => {}),
        push: vi.fn(async () => {}),
        addRemote: vi.fn(async () => {}),
        listRemote: vi.fn(async () => ''),
        raw: vi.fn(async (args) => {
            if (Array.isArray(args) && args[0] === 'for-each-ref') return 'refs/heads/main\n';
            if (Array.isArray(args) && args[0] === 'symbolic-ref') return 'main\n';
            if (Array.isArray(args) && args[0] === 'lfs') return '';
            return '';
        }),
    }),
}));

vi.mock('../lib/url-validator.js', () => ({
    isInternalUrl: vi.fn(() => false),
    resolveAndValidateHost: vi.fn(async () => true),
}));

vi.mock('../lib/oversized-blobs.js', () => ({
    findOversizedBlobs: vi.fn(async () => []),
    parseOversizedPushError: vi.fn(() => null),
    encodeOversizedError: vi.fn((files, msg) => msg),
    GITHUB_FILE_SIZE_LIMIT_BYTES: 100 * 1024 * 1024,
}));

import { deleteGithubRepo, importRepository } from '../import-service.js';

const HEADERS = { Authorization: 'Bearer t', Accept: 'application/vnd.github+json' };

describe('deleteGithubRepo', () => {
    beforeEach(() => { global.fetch = vi.fn(); });
    afterEach(() => { delete global.fetch; vi.restoreAllMocks(); });

    it('resolves on 204 (deleted) and calls DELETE on the right URL', async () => {
        global.fetch.mockResolvedValueOnce({ status: 204 });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS)).resolves.toBeUndefined();
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.github.com/repos/acme/widget');
        expect(opts.method).toBe('DELETE');
    });

    it('resolves on 404 (already gone)', async () => {
        global.fetch.mockResolvedValueOnce({ status: 404 });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS)).resolves.toBeUndefined();
    });

    it('throws an actionable message on 403 (org blocks deletion)', async () => {
        global.fetch.mockResolvedValueOnce({ status: 403 });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS))
            .rejects.toThrow(/block members from deleting|delete it manually/i);
    });

    it('throws with the API message on other failures', async () => {
        global.fetch.mockResolvedValueOnce({ status: 500, json: async () => ({ message: 'boom' }) });
        await expect(deleteGithubRepo('acme', 'widget', HEADERS)).rejects.toThrow(/boom/);
    });

    it('url-encodes owner and repo segments', async () => {
        global.fetch.mockResolvedValueOnce({ status: 204 });
        await deleteGithubRepo('a b', 'c/d', HEADERS);
        expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/a%20b/c%2Fd');
    });
});

describe('importRepository replace branch', () => {
    beforeEach(() => { global.fetch = vi.fn(); });
    afterEach(() => { delete global.fetch; vi.restoreAllMocks(); });

    it('deletes a non-empty existing repo then recreates when onConflict=replace', async () => {
        // 1) create POST → 422 already exists
        global.fetch.mockResolvedValueOnce({
            ok: false, status: 422,
            json: async () => ({ errors: [{ message: 'name already exists on this account' }] }),
        });
        // 2) GET existing → non-empty
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ size: 4096, default_branch: 'main', full_name: 'acme/widget' }),
        });
        // 3) DELETE → 204
        global.fetch.mockResolvedValueOnce({ status: 204 });
        // 4) recreate POST → ok
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ full_name: 'acme/widget', html_url: 'https://github.com/acme/widget', default_branch: null }),
        });
        // any later fetches (e.g. default-branch PATCH) → ok
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            credentials: { type: 'token', token: 'src' },
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
            onConflict: 'replace',
        });

        expect(result.success).toBe(true);
        expect(result.replacedExistingRepo).toBe(true);
        const deleteCall = global.fetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
        expect(deleteCall?.[0]).toBe('https://api.github.com/repos/acme/widget');
    });

    it('does NOT delete and throws when non-empty and onConflict is not replace', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false, status: 422,
            json: async () => ({ errors: [{ message: 'name already exists on this account' }] }),
        });
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ size: 4096, default_branch: 'main', full_name: 'acme/widget' }),
        });

        const result = await importRepository({
            sourceUrl: 'https://github.com/src/widget.git',
            credentials: { type: 'token', token: 'src' },
            targetOwner: 'acme',
            targetName: 'widget',
            githubToken: 'gh',
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already exists on GitHub and is not empty/);
        expect(global.fetch.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);
    });
});
