#!/usr/bin/env node
/**
 * Seed Live Inbox demo data for the dev-user (mock auth user).
 * Run while the dev server is up — SQLite WAL mode handles concurrent writes.
 *
 * Usage:
 *   SEED_DEMO=1 node scripts/seed-inbox-demo.mjs
 *
 * Safety guards (refuses to run unless overridden):
 *   - NODE_ENV=production                  → always refuses
 *   - real users in DB and SEED_DEMO unset → refuses (avoids the vaporware
 *     leak we hit on 2026-05-12, where a logged-in real user saw fake PRs
 *     like bolalabs/legacy#12 because the seed had been run against a live
 *     SQLite file). Force with SEED_DEMO_FORCE=1 if you really mean it.
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

if (process.env.NODE_ENV === 'production') {
    console.error('[seed] refusing to run in NODE_ENV=production. Aborting.');
    process.exit(1);
}

const DB_PATH = resolve('server/data/manager.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const LOGIN = 'dev-user';
const USER_ID = 999999;

// Guard — don't pollute a database that already has real users unless the
// caller opts in explicitly. Mock-auth `dev-user` (id 999999) is filtered
// out so seeding into a fresh dev DB stays one command.
const realUserCount = (() => {
    try {
        const row = db.prepare('SELECT count(*) AS n FROM users WHERE id != ?').get(USER_ID);
        return Number(row?.n) || 0;
    } catch { return 0; }
})();
if (realUserCount > 0 && !process.env.SEED_DEMO_FORCE && !process.env.SEED_DEMO) {
    console.error(`[seed] database has ${realUserCount} real user(s) — refusing to seed demo data.`);
    console.error('       Set SEED_DEMO=1 to opt in, or SEED_DEMO_FORCE=1 to bypass all guards.');
    process.exit(1);
}

function hoursAgo(n) { return new Date(Date.now() - n * 3600_000).toISOString(); }
function daysAgo(n) { return new Date(Date.now() - n * 86_400_000).toISOString(); }

// Wipe inbox-related rows for the demo user (idempotent)
db.prepare('DELETE FROM review_assignments WHERE reviewer_login = ?').run(LOGIN);
db.prepare("DELETE FROM pr_events WHERE author_login = ?").run(LOGIN);
db.prepare("DELETE FROM issue_events WHERE assignee_logins LIKE ?").run(`%"${LOGIN}"%`);
db.prepare('DELETE FROM dashboard_inbox_state WHERE user_id = ?').run(USER_ID);

// needs_review — 4 PRs waiting on dev-user
const reviewSeeds = [
    [101, 'bolalabs/repo-manager', 412, 'Refactor: simplify session validation flow', 'jdoe', 2.5],
    [102, 'bolalabs/billing', 87,   'feat(stripe): switch to live keys in production', 'alice', 8],
    [103, 'bolalabs/api',     203,  'fix(auth): refresh OAuth token before expiry', 'bob', 14],
    [104, 'bolalabs/ui',      77,   'chore: bump tailwind to v4.1', 'carol', 36],
];
const insertReview = db.prepare(`
    INSERT INTO review_assignments
    (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
`);
const insertPRTitleSeed = db.prepare(`
    INSERT INTO pr_events
    (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
    VALUES (?, ?, ?, 'opened', ?, ?, ?)
`);
for (const [repoId, repo, pr, title, author, hours] of reviewSeeds) {
    insertReview.run(repoId, repo, pr, LOGIN, hoursAgo(hours));
    insertPRTitleSeed.run(repoId, repo, pr, author, title, hoursAgo(hours + 1));
}

// my_prs — 3 fresh PRs authored by dev-user
const myPrSeeds = [
    [201, 'bolalabs/repo-manager', 510, 'feat(dashboard): premium Live Inbox three pillars', 1],
    [202, 'bolalabs/repo-manager', 511, 'docs: update API reference for /api/v1/dashboard/*', 4],
    [203, 'bolalabs/billing',      92,  'chore(deps): bump express to 5.0.2', 26],
];
for (const [repoId, repo, pr, title, hours] of myPrSeeds) {
    insertPRTitleSeed.run(repoId, repo, pr, LOGIN, title, hoursAgo(hours));
}

// stale_drafts — 2 PRs older than 7d that are still open
const staleSeeds = [
    [301, 'bolalabs/legacy', 12, 'WIP: experiment with vector embeddings for repo search', 12],
    [302, 'bolalabs/legacy', 18, 'draft: settings panel overhaul', 22],
];
for (const [repoId, repo, pr, title, daysOld] of staleSeeds) {
    insertPRTitleSeed.run(repoId, repo, pr, LOGIN, title, daysAgo(daysOld));
}

// mentions — 2 issues assigned to dev-user
const issueSeeds = [
    [401, 'bolalabs/api',     314, 'Bug: rate limiter 503s under sustained load', 3],
    [402, 'bolalabs/ui',      256, 'A11y: row archive button unreachable by keyboard', 11],
];
const insertIssue = db.prepare(`
    INSERT INTO issue_events
    (repo_id, repo_full_name, issue_number, action, assignee_logins, title, created_at)
    VALUES (?, ?, ?, 'assigned', ?, ?, ?)
`);
const assignees = JSON.stringify([LOGIN]);
for (const [repoId, repo, num, title, hours] of issueSeeds) {
    insertIssue.run(repoId, repo, num, assignees, title, hoursAgo(hours));
}

// Ensure user exists too (mock auth already creates it but be safe)
db.prepare(`
    INSERT INTO users (id, username, avatar_url, email)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username
`).run(USER_ID, LOGIN, 'https://github.com/ghost.png', 'dev@example.com');

const counts = {
    review_assignments: db.prepare('SELECT COUNT(*) c FROM review_assignments WHERE reviewer_login = ?').get(LOGIN).c,
    pr_events_authored: db.prepare('SELECT COUNT(*) c FROM pr_events WHERE author_login = ?').get(LOGIN).c,
    issue_events_assigned: db.prepare("SELECT COUNT(*) c FROM issue_events WHERE assignee_logins LIKE ?").get(`%"${LOGIN}"%`).c,
};

console.log('[seed] Inbox demo data ready:', counts);
db.close();
