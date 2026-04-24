// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// In-memory DB for runDiscovery orchestrator tests
// ---------------------------------------------------------------------------
const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        github_login TEXT NOT NULL
    );
    CREATE TABLE work_board_tracked_repos (
        user_id              INTEGER NOT NULL,
        repo_full_name       TEXT NOT NULL,
        repo_id              INTEGER,
        source_signal        TEXT NOT NULL,
        is_pinned            INTEGER NOT NULL DEFAULT 0,
        is_muted             INTEGER NOT NULL DEFAULT 0,
        last_activity_at     DATETIME,
        discovered_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_synced_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE work_board_prefs (
        user_id                 INTEGER PRIMARY KEY,
        discovery_window_days   INTEGER NOT NULL DEFAULT 60,
        max_auto_repos          INTEGER NOT NULL DEFAULT 50,
        auto_mute_bots          INTEGER NOT NULL DEFAULT 0,
        ai_assistant_enabled    INTEGER NOT NULL DEFAULT 0,
        ai_monthly_cap_cents    INTEGER NOT NULL DEFAULT 500,
        ai_response_locale      TEXT,
        last_discovery_at       DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
`);

// ---------------------------------------------------------------------------
// Mocks — hoisted by vitest before any imports
// ---------------------------------------------------------------------------
const mockGithubApi = vi.fn();
vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));
vi.mock('../db.js', () => ({ default: testDb }));

// ---------------------------------------------------------------------------
// Dynamic imports (after mocks are registered)
// ---------------------------------------------------------------------------
const {
    collectReviewRequested,
    collectAuthoredPRs,
    collectAssignedIssues,
    collectOwnedRepos,
    collectRecentCommits,
    runDiscovery,
} = await import('../lib/work-board-discovery.js');

const { mergeCandidates } = await import('../lib/work-board-discovery-merge.js');

beforeEach(() => {
    mockGithubApi.mockReset();
});

// ===========================================================================
// Collector tests
// ===========================================================================

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

// ===========================================================================
// mergeCandidates tests
// ===========================================================================

describe('mergeCandidates', () => {
    const existing = [
        { repo_full_name: 'a/pinned',  is_pinned: 1, is_muted: 0, source_signal: 'owned' },
        { repo_full_name: 'a/muted',   is_pinned: 0, is_muted: 1, source_signal: 'owned' },
        { repo_full_name: 'a/regular', is_pinned: 0, is_muted: 0, source_signal: 'authored_pr' },
        { repo_full_name: 'a/gone',    is_pinned: 0, is_muted: 0, source_signal: 'owned' },
    ];

    it('keeps pinned rows even when not in candidates', () => {
        const result = mergeCandidates(existing, [], { max_auto_repos: 50 });
        expect(result.keep.find(r => r.repo_full_name === 'a/pinned')).toBeDefined();
    });

    it('keeps muted rows even when not in candidates', () => {
        const result = mergeCandidates(existing, [], { max_auto_repos: 50 });
        expect(result.keep.find(r => r.repo_full_name === 'a/muted')).toBeDefined();
    });

    it('removes non-pinned non-muted rows that are not in candidates', () => {
        const result = mergeCandidates(existing, [], { max_auto_repos: 50 });
        expect(result.remove.map(r => r.repo_full_name).sort()).toEqual(['a/gone', 'a/regular']);
    });

    it('assigns earliest signal by priority when a repo has multiple signals', () => {
        const candidates = [
            { repo_full_name: 'x/y', last_activity_at: '2026-04-20', signal: 'recent_commit' },
            { repo_full_name: 'x/y', last_activity_at: '2026-04-22', signal: 'review_requested' },
            { repo_full_name: 'x/y', last_activity_at: '2026-04-21', signal: 'authored_pr' },
        ];
        const result = mergeCandidates([], candidates, { max_auto_repos: 50 });
        const xy = result.add.find(r => r.repo_full_name === 'x/y');
        expect(xy.source_signal).toBe('review_requested');
        expect(xy.last_activity_at).toBe('2026-04-22');
    });

    it('preserves webhook-sourced rows even when not in candidates', () => {
        const result = mergeCandidates([
            { repo_full_name: 'auto/from-webhook', is_pinned: 0, is_muted: 0, source_signal: 'webhook' },
        ], [], { max_auto_repos: 50 });
        expect(result.keep.find(r => r.repo_full_name === 'auto/from-webhook')).toBeDefined();
        expect(result.remove.find(r => r.repo_full_name === 'auto/from-webhook')).toBeUndefined();
    });

    it('caps total (pinned always kept, non-pinned trimmed by last_activity_at DESC)', () => {
        const candidates = Array.from({ length: 10 }, (_, i) => ({
            repo_full_name: `new/r${i}`,
            last_activity_at: `2026-04-${10 + i}`,
            signal: 'owned',
        }));
        const result = mergeCandidates([
            { repo_full_name: 'a/pinned', is_pinned: 1, is_muted: 0, source_signal: 'owned' },
        ], candidates, { max_auto_repos: 3 });
        expect(result.keep.find(r => r.repo_full_name === 'a/pinned')).toBeDefined();
        expect(result.add).toHaveLength(3);
        expect(result.add[0].repo_full_name).toBe('new/r9');
    });
});

// ===========================================================================
// runDiscovery orchestrator tests
// ===========================================================================

describe('runDiscovery', () => {
    const USER_A = 999003;
    const USER_B = 999004;

    beforeEach(() => {
        testDb.exec(`DELETE FROM work_board_prefs WHERE user_id IN (${USER_A}, ${USER_B})`);
        testDb.exec(`DELETE FROM work_board_tracked_repos WHERE user_id IN (${USER_A}, ${USER_B})`);
        testDb.exec(`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`);
        testDb.exec(`INSERT INTO users (id, github_login) VALUES (${USER_A}, 'disco_user_a')`);
        testDb.exec(`INSERT INTO users (id, github_login) VALUES (${USER_B}, 'disco_user_b')`);
    });

    it('runs 5 collectors in parallel, merges, persists, updates last_discovery_at', async () => {
        // collectReviewRequested → 1 item
        mockGithubApi.mockResolvedValueOnce({ data: { items: [
            { repository_url: 'https://api.github.com/repos/org/review-repo', updated_at: '2026-04-23T10:00Z' },
        ]}});
        // collectAuthoredPRs → empty
        mockGithubApi.mockResolvedValueOnce({ data: { items: [] }});
        // collectAssignedIssues → empty
        mockGithubApi.mockResolvedValueOnce({ data: { items: [] }});
        // collectOwnedRepos → 1 item
        mockGithubApi.mockResolvedValueOnce({ data: [
            { full_name: 'org/owned-repo', id: 42, archived: false, pushed_at: '2026-04-22T08:00Z' },
        ]});
        // collectRecentCommits → /user then /events
        mockGithubApi.mockResolvedValueOnce({ data: { login: 'disco_user_a' }});
        mockGithubApi.mockResolvedValueOnce({ data: [] });

        const result = await runDiscovery(USER_A, 'tok', { discovery_window_days: 60, max_auto_repos: 50 });

        expect(result.discovered).toBe(2);
        expect(result.added).toBe(2);
        expect(result.removed).toBe(0);
        expect(typeof result.duration_ms).toBe('number');

        const rows = testDb.prepare(
            'SELECT repo_full_name, source_signal FROM work_board_tracked_repos WHERE user_id = ? ORDER BY repo_full_name'
        ).all(USER_A);
        expect(rows.map(r => r.repo_full_name)).toEqual(['org/owned-repo', 'org/review-repo']);
        expect(rows.find(r => r.repo_full_name === 'org/review-repo').source_signal).toBe('review_requested');

        const prefs = testDb.prepare('SELECT last_discovery_at FROM work_board_prefs WHERE user_id = ?').get(USER_A);
        expect(prefs).toBeDefined();
        expect(prefs.last_discovery_at).not.toBeNull();
    });

    it('preserves pinned rows even if not returned by discovery', async () => {
        // Seed a pinned row
        testDb.prepare(`
            INSERT INTO work_board_tracked_repos
                (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
            VALUES (?, ?, 'pinned', 1, 0, '2026-01-01')
        `).run(USER_B, 'org/pinned-repo');

        // All 5 collectors return empty (5 calls: search×3, repos, user+events)
        mockGithubApi.mockResolvedValueOnce({ data: { items: [] }}); // review-requested
        mockGithubApi.mockResolvedValueOnce({ data: { items: [] }}); // authored PRs
        mockGithubApi.mockResolvedValueOnce({ data: { items: [] }}); // assigned issues
        mockGithubApi.mockResolvedValueOnce({ data: [] });            // owned repos
        mockGithubApi.mockResolvedValueOnce({ data: { login: 'disco_user_b' }}); // /user
        mockGithubApi.mockResolvedValueOnce({ data: [] });            // events

        const result = await runDiscovery(USER_B, 'tok', { discovery_window_days: 60, max_auto_repos: 50 });

        expect(result.removed).toBe(0);

        const row = testDb.prepare(
            'SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
        ).get(USER_B, 'org/pinned-repo');
        expect(row).toBeDefined();
        expect(row.is_pinned).toBe(1);
    });
});
