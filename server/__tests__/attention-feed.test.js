// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// In-memory schema mirroring just what the feed reads.
const testDb = new Database(':memory:');
testDb.exec(`
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
        target_owner         TEXT,
        target_repo          TEXT,
        status               TEXT NOT NULL,
        error_message        TEXT,
        started_at           DATETIME
    );
`);

vi.mock('../db.js', () => ({ default: testDb }));

const { computeAttentionFeed } = await import('../lib/attention-feed.js');

const USER_ID = 7;
const NOW = new Date('2026-04-25T12:00:00Z');

function isoDaysAgo(d) {
    return new Date(NOW.getTime() - d * 86_400_000).toISOString();
}
function isoHoursAgo(h) {
    return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM migration_jobs WHERE user_id = ?').run(USER_ID);
});

afterEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM migration_jobs WHERE user_id = ?').run(USER_ID);
});

function track(name, { pinned = 0, muted = 0, lastActivity = null } = {}) {
    testDb.prepare(`
        INSERT INTO work_board_tracked_repos (user_id, repo_full_name, is_pinned, is_muted, last_activity_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(USER_ID, name, pinned, muted, lastActivity);
}

function recordFailedMigration({ id = 'job-1', target = 'acme/api', error = 'clone failed', startedDaysAgo = 1 } = {}) {
    testDb.prepare(`
        INSERT INTO migration_jobs (id, user_id, target_full_name, status, error_message, started_at)
        VALUES (?, ?, ?, 'failed', ?, ?)
    `).run(id, USER_ID, target, error, isoDaysAgo(startedDaysAgo));
}

describe('computeAttentionFeed', () => {
    it('returns an empty feed when no repos / migrations exist', () => {
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        expect(feed.items).toEqual([]);
        expect(feed.total).toBe(0);
    });

    it('flags pinned-but-quiet repos at medium severity', () => {
        track('acme/quiet', { pinned: 1, lastActivity: isoDaysAgo(10) });
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        const item = feed.items.find((i) => i.kind === 'stale_pinned');
        expect(item).toBeTruthy();
        expect(item.repoFullName).toBe('acme/quiet');
        expect(item.severity).toBe('medium');
        expect(item.title).toMatch(/10 days/);
    });

    it('escalates pinned-but-quiet to high after 30 days', () => {
        track('acme/very-quiet', { pinned: 1, lastActivity: isoDaysAgo(45) });
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        const item = feed.items.find((i) => i.kind === 'stale_pinned');
        expect(item.severity).toBe('high');
    });

    it('flags abandoned tracked repos (60+ days, not pinned)', () => {
        track('acme/dormant', { lastActivity: isoDaysAgo(70) });
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        const item = feed.items.find((i) => i.kind === 'abandoned');
        expect(item).toBeTruthy();
        expect(item.severity).toBe('low');
    });

    it('skips muted repos entirely', () => {
        track('acme/muted', { muted: 1, lastActivity: isoDaysAgo(70) });
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        expect(feed.items).toEqual([]);
    });

    it('flags hot repos active in the last 24h', () => {
        track('acme/active', { lastActivity: isoHoursAgo(3) });
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        const item = feed.items.find((i) => i.kind === 'hot');
        expect(item).toBeTruthy();
        expect(item.severity).toBe('low');
    });

    it('failed migrations bubble to the top with high severity', () => {
        recordFailedMigration({ target: 'acme/blocker', error: 'auth failed' });
        track('acme/quiet', { pinned: 1, lastActivity: isoDaysAgo(10) }); // medium
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        expect(feed.items[0].kind).toBe('failed_migration');
        expect(feed.items[0].repoFullName).toBe('acme/blocker');
        expect(feed.items[0].severity).toBe('high');
        expect(feed.items[0].hint).toMatch(/auth failed/);
    });

    it('respects the limit option', () => {
        for (let i = 0; i < 10; i++) {
            track(`acme/repo-${i}`, { pinned: 1, lastActivity: isoDaysAgo(15) });
        }
        const feed = computeAttentionFeed(USER_ID, { now: NOW, limit: 3 });
        expect(feed.items).toHaveLength(3);
        expect(feed.total).toBeGreaterThanOrEqual(10);
    });

    it('counts items by kind in the response', () => {
        recordFailedMigration({ target: 'acme/api' });
        track('acme/quiet1', { pinned: 1, lastActivity: isoDaysAgo(15) });
        track('acme/quiet2', { pinned: 1, lastActivity: isoDaysAgo(20) });
        track('acme/active', { lastActivity: isoHoursAgo(2) });
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        expect(feed.counts.failed_migration).toBe(1);
        expect(feed.counts.stale_pinned).toBe(2);
        expect(feed.counts.hot).toBe(1);
    });

    it('sorts severity desc, then since desc within severity', () => {
        track('acme/older-stale', { pinned: 1, lastActivity: isoDaysAgo(40) });   // high
        track('acme/newer-stale', { pinned: 1, lastActivity: isoDaysAgo(35) });   // high, more recent activity
        const feed = computeAttentionFeed(USER_ID, { now: NOW });
        const stalePinned = feed.items.filter((i) => i.kind === 'stale_pinned');
        // Newer activity ranks first when severity ties.
        expect(stalePinned[0].repoFullName).toBe('acme/newer-stale');
    });
});
