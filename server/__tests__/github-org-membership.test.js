// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the gh-cache layer — every test drives readThrough directly.
const readThroughMock = vi.fn();
vi.mock('../lib/gh-cache.js', () => ({
    readThrough: (...args) => readThroughMock(...args),
}));

// Stub githubApi so the import chain resolves; readThrough's mocked fetcher
// is what actually runs end-to-end.
vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }));

vi.mock('../lib/logger.js', () => ({
    default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const {
    isOrgMember,
    filterOrgsByMembership,
    getCurrentUserOrgs,
} = await import('../lib/github-org-membership.js');

const session = { userId: 7, accessToken: 'tok' };

beforeEach(() => {
    readThroughMock.mockReset();
});

describe('isOrgMember', () => {
    it('returns true when GitHub responds with state=active', async () => {
        readThroughMock.mockResolvedValue({ data: { state: 'active' } });
        await expect(isOrgMember({ session, org: 'acme' })).resolves.toBe(true);
        expect(readThroughMock).toHaveBeenCalledWith(expect.objectContaining({
            userId: 7,
            resourceType: 'org-membership',
            resourceKey: 'acme',
            ttlMs: 5 * 60 * 1000,
        }));
    });

    it('returns false on state != active (pending invite, etc.)', async () => {
        readThroughMock.mockResolvedValue({ data: { state: 'pending' } });
        await expect(isOrgMember({ session, org: 'acme' })).resolves.toBe(false);
    });

    it('returns false (no log) on 404 — caller is simply not a member', async () => {
        const err = new Error('Not Found');
        err.status = 404;
        readThroughMock.mockRejectedValue(err);
        await expect(isOrgMember({ session, org: 'acme' })).resolves.toBe(false);
    });

    it('returns false on other errors and does not throw', async () => {
        readThroughMock.mockRejectedValue(new Error('boom'));
        await expect(isOrgMember({ session, org: 'acme' })).resolves.toBe(false);
    });

    it('lowercases the cache key (case-insensitive org names)', async () => {
        readThroughMock.mockResolvedValue({ data: { state: 'active' } });
        await isOrgMember({ session, org: 'AcMe' });
        expect(readThroughMock).toHaveBeenCalledWith(expect.objectContaining({
            resourceKey: 'acme',
        }));
    });

    it.each([
        [null, 'acme'],
        [undefined, 'acme'],
        [{ userId: 7 }, 'acme'], // missing accessToken
        [{ accessToken: 'x' }, 'acme'], // missing userId
        [session, ''],
        [session, null],
    ])('returns false without calling readThrough for missing args (session=%j, org=%j)', async (s, o) => {
        await expect(isOrgMember({ session: s, org: o })).resolves.toBe(false);
        expect(readThroughMock).not.toHaveBeenCalled();
    });
});

describe('filterOrgsByMembership', () => {
    it('returns the subset whose membership is active', async () => {
        readThroughMock.mockImplementation(({ resourceKey }) => {
            if (resourceKey === 'acme' || resourceKey === 'midco') {
                return Promise.resolve({ data: { state: 'active' } });
            }
            const err = new Error('Not Found');
            err.status = 404;
            return Promise.reject(err);
        });
        const got = await filterOrgsByMembership({ session, orgs: ['acme', 'globex', 'midco'] });
        expect(got.sort()).toEqual(['acme', 'midco']);
    });

    it('returns [] for empty / missing input without any network calls', async () => {
        await expect(filterOrgsByMembership({ session, orgs: [] })).resolves.toEqual([]);
        await expect(filterOrgsByMembership({ session, orgs: undefined })).resolves.toEqual([]);
        await expect(filterOrgsByMembership({ session, orgs: null })).resolves.toEqual([]);
        expect(readThroughMock).not.toHaveBeenCalled();
    });
});

describe('getCurrentUserOrgs', () => {
    it('returns the list of org logins from GitHub', async () => {
        readThroughMock.mockResolvedValue({
            data: [{ login: 'acme' }, { login: 'midco' }, { login: null }, {}],
        });
        const got = await getCurrentUserOrgs({ session });
        expect(got).toEqual(['acme', 'midco']);
        expect(readThroughMock).toHaveBeenCalledWith(expect.objectContaining({
            resourceType: 'user-orgs',
            resourceKey: 'list',
        }));
    });

    it('returns [] when GitHub returns a non-array (defensive)', async () => {
        readThroughMock.mockResolvedValue({ data: { message: 'oops' } });
        await expect(getCurrentUserOrgs({ session })).resolves.toEqual([]);
    });

    it('returns [] on errors instead of throwing', async () => {
        readThroughMock.mockRejectedValue(new Error('boom'));
        await expect(getCurrentUserOrgs({ session })).resolves.toEqual([]);
    });

    it('returns [] without calling readThrough when no session/access token', async () => {
        await expect(getCurrentUserOrgs({ session: null })).resolves.toEqual([]);
        await expect(getCurrentUserOrgs({ session: { userId: 1 } })).resolves.toEqual([]);
        expect(readThroughMock).not.toHaveBeenCalled();
    });
});
