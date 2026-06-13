// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('simple-git', () => ({
    simpleGit: () => ({
        version: vi.fn(async () => ({ installed: true })),
        clone: vi.fn(async () => {}),
        push: vi.fn(async () => {}),
    }),
}));

import { deleteGithubRepo } from '../import-service.js';

const HEADERS = { Authorization: 'Bearer t', Accept: 'application/vnd.github+json' };

describe('deleteGithubRepo', () => {
    beforeEach(() => { global.fetch = vi.fn(); });
    afterEach(() => { vi.restoreAllMocks(); });

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
