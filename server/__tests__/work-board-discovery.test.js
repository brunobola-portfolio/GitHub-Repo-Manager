// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGithubApi = vi.fn();
vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));

const {
    collectReviewRequested,
    collectAuthoredPRs,
    collectAssignedIssues,
    collectOwnedRepos,
    collectRecentCommits,
} = await import('../lib/work-board-discovery.js');

beforeEach(() => {
    mockGithubApi.mockReset();
});

describe('collectReviewRequested', () => {
    it('hits /search/issues with review-requested:@me and archived:false', async () => {
        mockGithubApi.mockResolvedValueOnce({ data: { items: [
            { repository_url: 'https://api.github.com/repos/acme/backend', updated_at: '2026-04-20T10:00Z' },
            { repository_url: 'https://api.github.com/repos/acme/frontend', updated_at: '2026-04-21T10:00Z' },
        ] }});

        const out = await collectReviewRequested('token123');
        expect(mockGithubApi).toHaveBeenCalledWith(
            expect.stringContaining('/search/issues?'),
            'token123',
        );
        expect(mockGithubApi.mock.calls[0][0]).toMatch(/review-requested:%40me/);
        expect(mockGithubApi.mock.calls[0][0]).toMatch(/archived:false/);

        expect(out).toEqual([
            { repo_full_name: 'acme/backend',  last_activity_at: '2026-04-20T10:00Z', signal: 'review_requested' },
            { repo_full_name: 'acme/frontend', last_activity_at: '2026-04-21T10:00Z', signal: 'review_requested' },
        ]);
    });

    it('returns [] on 403 SSO error', async () => {
        mockGithubApi.mockRejectedValueOnce({ status: 403, message: 'SAML enforcement' });
        const out = await collectReviewRequested('token123');
        expect(out).toEqual([]);
    });
});

describe('collectAuthoredPRs', () => {
    it('includes updated:>={windowDays}d in query', async () => {
        mockGithubApi.mockResolvedValueOnce({ data: { items: [] }});
        await collectAuthoredPRs('tok', 60);
        const url = mockGithubApi.mock.calls[0][0];
        expect(url).toMatch(/author:%40me/);
        expect(url).toMatch(/updated:%3E%3D20\d\d-\d\d-\d\d/);
    });
});

describe('collectAssignedIssues', () => {
    it('hits /search/issues with assignee:@me is:issue', async () => {
        mockGithubApi.mockResolvedValueOnce({ data: { items: [
            { repository_url: 'https://api.github.com/repos/x/y', updated_at: '2026-04-20' },
        ]}});
        const out = await collectAssignedIssues('tok');
        expect(mockGithubApi.mock.calls[0][0]).toMatch(/assignee:%40me/);
        expect(out[0].signal).toBe('assigned_issue');
    });
});

describe('collectOwnedRepos', () => {
    it('filters archived=true', async () => {
        mockGithubApi.mockResolvedValueOnce({ data: [
            { full_name: 'me/a', id: 1, archived: false, pushed_at: '2026-04-22' },
            { full_name: 'me/b', id: 2, archived: true,  pushed_at: '2026-01-01' },
        ]});
        const out = await collectOwnedRepos('tok');
        expect(out).toEqual([{ repo_full_name: 'me/a', repo_id: 1, last_activity_at: '2026-04-22', signal: 'owned' }]);
    });
});

describe('collectRecentCommits', () => {
    it('picks only PushEvents within windowDays, dedups by repo', async () => {
        const recent = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
        const old = new Date(Date.now() - 200 * 86400 * 1000).toISOString();
        mockGithubApi
            .mockResolvedValueOnce({ data: { login: 'me' }})
            .mockResolvedValueOnce({ data: [
                { type: 'PushEvent',  repo: { name: 'me/a' }, created_at: recent },
                { type: 'PushEvent',  repo: { name: 'me/a' }, created_at: old },
                { type: 'PushEvent',  repo: { name: 'me/b' }, created_at: old },
                { type: 'IssueEvent', repo: { name: 'me/c' }, created_at: recent },
            ]});

        const out = await collectRecentCommits('tok', 30);
        expect(out).toEqual([{ repo_full_name: 'me/a', last_activity_at: recent, signal: 'recent_commit' }]);
    });
});
