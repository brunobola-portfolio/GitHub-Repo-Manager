// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        notifications_last_seen_at TEXT
    );
    CREATE TABLE work_board_tracked_repos (
        user_id              INTEGER NOT NULL,
        repo_full_name       TEXT NOT NULL,
        is_pinned            INTEGER NOT NULL DEFAULT 0,
        is_muted             INTEGER NOT NULL DEFAULT 0,
        last_activity_at     DATETIME,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE migration_jobs (
        id                   TEXT PRIMARY KEY,
        user_id              INTEGER NOT NULL,
        source_name          TEXT,
        target_full_name     TEXT,
        status               TEXT NOT NULL,
        error_message        TEXT,
        started_at           DATETIME
    );
`);

vi.mock('../db.js', () => ({ default: testDb }));

// Stub the event-aggregations layer so we test the digest plumbing in
// isolation. Real reviews/issues integration is covered by their own tests.
const mockReviews = vi.fn(() => []);
const mockIssues = vi.fn(() => []);
vi.mock('../lib/event-aggregations.js', () => ({
    listMyPendingReviews: (...args) => mockReviews(...args),
    listMyOpenIssues: (...args) => mockIssues(...args),
}));

const {
    buildNotificationsDigest,
    resolveSinceWindow,
    markNotificationsSeen,
    NOTIFICATIONS_DIGEST_CONSTANTS,
} = await import('../lib/notifications-digest.js');

const USER_ID = 7;
const NOW = new Date('2026-04-26T12:00:00Z');

function isoDaysAgo(d) {
    return new Date(NOW.getTime() - d * 86_400_000).toISOString();
}

beforeEach(() => {
    testDb.prepare('DELETE FROM users').run();
    testDb.prepare('DELETE FROM work_board_tracked_repos').run();
    testDb.prepare('DELETE FROM migration_jobs').run();
    mockReviews.mockReset().mockReturnValue([]);
    mockIssues.mockReset().mockReturnValue([]);
    testDb.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(USER_ID, 'alice');
});

describe('resolveSinceWindow', () => {
    it('seeds first call to NOW − 7d', () => {
        const w = resolveSinceWindow({ id: 1, notifications_last_seen_at: null }, NOW);
        expect(w.isFirstCall).toBe(true);
        const expected = NOW.getTime() - NOTIFICATIONS_DIGEST_CONSTANTS.sevenDaysMs;
        expect(new Date(w.since).getTime()).toBe(expected);
    });

    it('honours an existing last_seen_at', () => {
        const lastSeen = isoDaysAgo(2);
        const w = resolveSinceWindow({ id: 1, notifications_last_seen_at: lastSeen }, NOW);
        expect(w.isFirstCall).toBe(false);
        expect(w.since).toBe(lastSeen);
    });
});

describe('buildNotificationsDigest', () => {
    it('returns four-category empty digest with totals=0 when nothing matches', () => {
        const d = buildNotificationsDigest(USER_ID, { now: NOW, login: 'alice' });
        expect(d.totals).toEqual({ reviews: 0, issues: 0, failed_migrations: 0, stale_pinned: 0 });
        expect(d.items.reviews).toEqual([]);
        expect(d.items.issues).toEqual([]);
        expect(d.items.failed_migrations).toEqual([]);
        expect(d.items.stale_pinned).toEqual([]);
    });

    it('caps each category at top-3 even when underlying sources return more', () => {
        const reviews = Array.from({ length: 10 }, (_, i) => ({
            repoFullName: `o/r${i}`, prNumber: i + 1, title: `PR ${i}`, requestedAt: isoDaysAgo(0.1),
        }));
        mockReviews.mockReturnValue(reviews);

        const d = buildNotificationsDigest(USER_ID, {
            now: NOW,
            login: 'alice',
            last_seen_at: isoDaysAgo(2),
        });
        expect(d.items.reviews).toHaveLength(NOTIFICATIONS_DIGEST_CONSTANTS.topPerCategory);
        expect(d.totals.reviews).toBe(10);
    });

    it('filters reviews older than the since window', () => {
        mockReviews.mockReturnValue([
            { repoFullName: 'o/recent', prNumber: 1, title: 'Recent', requestedAt: isoDaysAgo(0.5) },
            { repoFullName: 'o/old',    prNumber: 2, title: 'Old',    requestedAt: isoDaysAgo(20)  },
        ]);
        const d = buildNotificationsDigest(USER_ID, {
            now: NOW,
            login: 'alice',
            last_seen_at: isoDaysAgo(3),
        });
        expect(d.totals.reviews).toBe(1);
        expect(d.items.reviews[0].repo).toBe('o/recent');
    });

    it('surfaces failed migrations within the window', () => {
        testDb.prepare(`
            INSERT INTO migration_jobs (id, user_id, target_full_name, status, error_message, started_at)
            VALUES (?, ?, ?, 'failed', ?, ?)
        `).run('job-1', USER_ID, 'acme/api', 'clone failed', isoDaysAgo(0.2));
        testDb.prepare(`
            INSERT INTO migration_jobs (id, user_id, target_full_name, status, error_message, started_at)
            VALUES (?, ?, ?, 'failed', ?, ?)
        `).run('job-old', USER_ID, 'acme/old', 'gone', isoDaysAgo(30));

        const d = buildNotificationsDigest(USER_ID, {
            now: NOW,
            login: 'alice',
            last_seen_at: isoDaysAgo(3),
        });
        expect(d.totals.failed_migrations).toBe(1);
        expect(d.items.failed_migrations[0].repo).toBe('acme/api');
        expect(d.items.failed_migrations[0].reason).toBe('clone failed');
    });

    it('surfaces pinned-but-quiet repos regardless of since window', () => {
        testDb.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, is_pinned, last_activity_at)
            VALUES (?, ?, 1, ?)
        `).run(USER_ID, 'acme/quiet', isoDaysAgo(20));

        const d = buildNotificationsDigest(USER_ID, {
            now: NOW,
            login: 'alice',
            last_seen_at: isoDaysAgo(0.1),
        });
        expect(d.totals.stale_pinned).toBe(1);
        expect(d.items.stale_pinned[0].repo).toBe('acme/quiet');
    });

    it('skips muted pinned repos', () => {
        testDb.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, is_pinned, is_muted, last_activity_at)
            VALUES (?, ?, 1, 1, ?)
        `).run(USER_ID, 'acme/muted', isoDaysAgo(20));

        const d = buildNotificationsDigest(USER_ID, { now: NOW, login: 'alice' });
        expect(d.totals.stale_pinned).toBe(0);
    });

    it('returns empty arrays (not throws) when login is null', () => {
        const d = buildNotificationsDigest(USER_ID, { now: NOW, login: null });
        expect(d.items.reviews).toEqual([]);
        expect(d.items.issues).toEqual([]);
    });
});

describe('markNotificationsSeen', () => {
    it('writes the timestamp to users.notifications_last_seen_at', () => {
        markNotificationsSeen(USER_ID, NOW);
        const row = testDb.prepare('SELECT notifications_last_seen_at FROM users WHERE id = ?').get(USER_ID);
        expect(row.notifications_last_seen_at).toBe(NOW.toISOString());
    });

    it('is idempotent — second call overwrites with newer value', () => {
        const earlier = new Date(NOW.getTime() - 5_000);
        markNotificationsSeen(USER_ID, earlier);
        markNotificationsSeen(USER_ID, NOW);
        const row = testDb.prepare('SELECT notifications_last_seen_at FROM users WHERE id = ?').get(USER_ID);
        expect(row.notifications_last_seen_at).toBe(NOW.toISOString());
    });
});
