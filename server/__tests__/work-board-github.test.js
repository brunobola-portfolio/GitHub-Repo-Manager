// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGithubApi = vi.fn();
vi.mock('../lib/github-api.js', () => ({ githubApi: (...args) => mockGithubApi(...args) }));

const {
    fetchMyPendingReviews,
    fetchStalePRs,
    fetchMyOpenIssues,
    fetchTechDebtIssues,
    DEFAULT_DEBT_LABELS,
} = await import('../lib/work-board-github.js');

function makeSearchResult(items = []) {
    return { data: { total_count: items.length, incomplete_results: false, items }, headers: new Map() };
}

function githubIssue({
    number, title, login, repo, labels = [], createdAt, updatedAt, isPR = false, assignees = [],
}) {
    return {
        number,
        title,
        user: { login },
        repository_url: `https://api.github.com/repos/${repo}`,
        html_url: `https://github.com/${repo}/${isPR ? 'pull' : 'issues'}/${number}`,
        labels: labels.map(n => ({ name: n })),
        assignees: assignees.map(login => ({ login })),
        created_at: createdAt,
        updated_at: updatedAt,
        pull_request: isPR ? { url: 'x' } : undefined,
    };
}

describe('work-board-github', () => {
    beforeEach(() => mockGithubApi.mockReset());

    it('fetchMyPendingReviews builds the right search query', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchMyPendingReviews({ token: 'tok', login: 'alice' });
        const [path, token] = mockGithubApi.mock.calls[0];
        expect(token).toBe('tok');
        expect(path).toContain('/search/issues');
        expect(path).toContain('review-requested%3Aalice');
        expect(path).toContain('is%3Aopen');
        expect(path).toContain('is%3Apr');
    });

    it('fetchMyPendingReviews normalises items (repoFullName, prNumber, title, authorLogin, ageHours)', async () => {
        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
        mockGithubApi.mockResolvedValue(makeSearchResult([
            githubIssue({ number: 42, title: 'Fix X', login: 'bob', repo: 'org/repo',
                createdAt: twoHoursAgo, updatedAt: twoHoursAgo, isPR: true }),
        ]));
        const result = await fetchMyPendingReviews({ token: 'tok', login: 'alice' });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            repoFullName: 'org/repo',
            prNumber: 42,
            title: 'Fix X',
            authorLogin: 'bob',
        });
        expect(result.items[0].ageHours).toBeCloseTo(2, 0);
        expect(result.totalCount).toBe(1);
    });

    it('fetchStalePRs includes updated:<cutoff qualifier', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchStalePRs({ token: 'tok', login: 'alice', staleAfterDays: 14 });
        const [path] = mockGithubApi.mock.calls[0];
        expect(path).toContain('author%3Aalice');
        expect(path).toMatch(/updated%3A%3C\d{4}-\d{2}-\d{2}/);
    });

    it('fetchMyOpenIssues uses assignee qualifier and is:issue', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchMyOpenIssues({ token: 'tok', login: 'alice' });
        const [path] = mockGithubApi.mock.calls[0];
        expect(path).toContain('assignee%3Aalice');
        expect(path).toContain('is%3Aissue');
    });

    it('fetchTechDebtIssues ORs the label list', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchTechDebtIssues({ token: 'tok', labels: ['tech-debt', 'debt'] });
        const [path] = mockGithubApi.mock.calls[0];
        expect(path).toContain('label%3A%22tech-debt%22');
        expect(path).toContain('label%3A%22debt%22');
    });

    it('DEFAULT_DEBT_LABELS exported and used when no labels passed', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchTechDebtIssues({ token: 'tok' });
        expect(DEFAULT_DEBT_LABELS.length).toBeGreaterThan(3);
        expect(DEFAULT_DEBT_LABELS).toContain('tech-debt');
    });

    it('normaliseIssue returns labels and assignees as string arrays', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([
            githubIssue({ number: 7, title: 't', login: 'a', repo: 'o/r',
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                labels: ['bug', 'p1'], assignees: ['alice', 'bob'] }),
        ]));
        const r = await fetchMyOpenIssues({ token: 'tok', login: 'alice' });
        expect(r.items[0].labels).toEqual(['bug', 'p1']);
        expect(r.items[0].assignees).toEqual(['alice', 'bob']);
    });

    it('propagates errors thrown by githubApi', async () => {
        const err = new Error('rate limited');
        err.status = 429;
        mockGithubApi.mockRejectedValueOnce(err);
        await expect(fetchMyPendingReviews({ token: 'tok', login: 'alice' })).rejects.toThrow('rate limited');
    });
});
