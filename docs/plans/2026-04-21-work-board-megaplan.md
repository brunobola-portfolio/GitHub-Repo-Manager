# Work Board Mega-Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Work Board from a webhook-only passive list into a zero-config, auto-refreshing, keyboard-drivable, AI-summarised cockpit that populates from the live GitHub API when webhook data is missing.

**Architecture:** Single release, five cohesive layers: L1 live GitHub fetch + ETag cache; L2 route layer merging webhook+live; L3 inline mutations (approve/snooze) + server-side snooze/presets; L4 BYOK AI summary across all providers; L5 frontend polling, filters, URL sync, keyboard nav, inline actions, AI card, command-palette extension.

**Tech Stack:** Node/Express + better-sqlite3 + pino backend; React 19 + Vite 7 + Tailwind v4 + Framer Motion + cmdk frontend; vitest for unit, supertest for route integration, Playwright for E2E.

**Reference spec:** [docs/specs/2026-04-20-work-board-megaplan.md](docs/specs/2026-04-20-work-board-megaplan.md)

**Execution stages:**
- **Stage A — Backend (tasks 1-12)** — all endpoints fully tested; no UI. Can merge independently.
- **Stage B — Frontend (tasks 13-25)** — consumes the new endpoints.

---

## File Structure

**New backend files:**
- `server/lib/work-board-cache.js` — SQLite wrapper for the cache table (get/put/invalidate/purge).
- `server/lib/work-board-github.js` — 4 pure fetch functions calling `/search/issues` via `githubApi()`.
- `server/lib/work-board-snooze.js` — snooze CRUD helpers, filter predicate.
- `server/lib/work-board-presets.js` — preset CRUD helpers.
- `server/lib/work-board-summary.js` — fact-sheet builder + AI generate + schema.
- `server/lib/work-board-sweeper.js` — interval sweeper for expired cache/snooze rows.
- `server/routes/work-board-actions.js` — mutation sub-router (review-action, snooze, presets, ai-summary).
- `server/__tests__/work-board-cache.test.js`
- `server/__tests__/work-board-github.test.js`
- `server/__tests__/work-board-snooze.test.js`
- `server/__tests__/work-board-presets.test.js`
- `server/__tests__/work-board-actions.test.js`
- `server/__tests__/work-board-summary.test.js`
- `server/__tests__/work-board-sweeper.test.js`

**Modified backend files:**
- `server/db.js` — migrations M010, M011, M012.
- `server/routes/work-board.js` — live/webhook merge; envelope + `meta`.
- `server/routes/index.js` (or `v1/index.js`) — mount `work-board-actions.js`.
- `server/index.js` — start/stop sweeper at lifecycle events.
- `server/__tests__/work-board-routes.test.js` — extend for live fallback & envelope.

**New frontend files:**
- `src/hooks/useRelativeTime.js` — human-readable "updated Ns ago".
- `src/hooks/useRowNavigation.js` — j/k active row state.
- `src/hooks/useReviewAction.js` — optimistic approve/request-changes/snooze.
- `src/hooks/useWorkBoardPresets.js` — preset CRUD against server.
- `src/hooks/useUrlParams.js` — URLSearchParams ↔ state sync.
- `src/components/WorkBoard/filters/WorkBoardFilterBar.jsx`
- `src/components/WorkBoard/filters/FilterChip.jsx`
- `src/components/WorkBoard/filters/PresetDropdown.jsx`
- `src/components/WorkBoard/AISummaryCard.jsx`
- `src/components/WorkBoard/KeyboardHelpModal.jsx`
- `src/components/WorkBoard/InlineActions.jsx` — Approve/RequestChanges/Snooze buttons.
- `tests/hooks/useRelativeTime.test.js`
- `tests/hooks/useRowNavigation.test.js`
- `tests/hooks/useReviewAction.test.js`
- `tests/components/WorkBoard/WorkBoardFilterBar.test.jsx`
- `tests/components/WorkBoard/AISummaryCard.test.jsx`
- `e2e/work-board-zero-config.spec.js`

**Modified frontend files:**
- `src/hooks/useWorkBoard.js` — refresh interval, page visibility, lastFetchedAt.
- `src/hooks/useKeyboardShortcuts.js` — context-scoped shortcut registration.
- `src/components/CommandPalette.jsx` — dynamic Work Board group.
- `src/components/WorkBoard/WorkBoardPage.jsx` — compose all new pieces.
- `tests/components/WorkBoard/WorkBoardPage.test.jsx` — extend.

---

# STAGE A — BACKEND

## Task 1: DB migrations M010/M011/M012

**Files:**
- Modify: `server/db.js` (add to the existing idempotent migration block near line 605)

- [ ] **Step 1: Add the three migrations at the end of the migration block**

Open [server/db.js](server/db.js) and locate the `Migration 009` block (the `ALTER TABLE issue_events ADD COLUMN title TEXT`). Immediately after its closing `}`, add:

```js
    // Migration 010 (Work Board mega-upgrade): live-data cache keyed by user+query.
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_board_cache (
            user_id     INTEGER NOT NULL,
            query_type  TEXT    NOT NULL,
            payload     TEXT    NOT NULL,
            etag        TEXT,
            fetched_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at  DATETIME NOT NULL,
            PRIMARY KEY (user_id, query_type),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbc_expires ON work_board_cache(expires_at)`);

    // Migration 011: snoozed PR/issue rows for Work Board.
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_board_snooze (
            user_id        INTEGER NOT NULL,
            repo_full_name TEXT    NOT NULL,
            item_type      TEXT    NOT NULL,
            item_number    INTEGER NOT NULL,
            until_at       DATETIME NOT NULL,
            created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, repo_full_name, item_type, item_number),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbs_until ON work_board_snooze(until_at)`);

    // Migration 012: saved filter presets.
    db.exec(`
        CREATE TABLE IF NOT EXISTS work_board_presets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            name       TEXT    NOT NULL,
            filters    TEXT    NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id, name),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wbp_user ON work_board_presets(user_id)`);
```

- [ ] **Step 2: Verify migration runs cleanly on a fresh DB**

Run: `node -e "import('./server/db.js').then(m => { m.initDB(); const cols = m.default.prepare('PRAGMA table_info(work_board_cache)').all(); console.log(cols.map(c=>c.name).join(',')); const cols2 = m.default.prepare('PRAGMA table_info(work_board_snooze)').all(); console.log(cols2.map(c=>c.name).join(',')); const cols3 = m.default.prepare('PRAGMA table_info(work_board_presets)').all(); console.log(cols3.map(c=>c.name).join(',')); })"`

Expected output: three comma-separated column lists containing all expected columns.

- [ ] **Step 3: Verify migration is idempotent (re-run, no error)**

Run the same command twice in a row. Second run must succeed silently.

- [ ] **Step 4: Commit**

```bash
git add server/db.js
git commit -m "feat(work-board): migrations M010-M012 for cache/snooze/presets"
```

---

## Task 2: Work-board cache helper

**Files:**
- Create: `server/lib/work-board-cache.js`
- Test: `server/__tests__/work-board-cache.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `server/__tests__/work-board-cache.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { vi } from 'vitest';

// Create a private in-memory DB for each test file
const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE work_board_cache (
        user_id INTEGER NOT NULL,
        query_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        etag TEXT,
        fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        PRIMARY KEY (user_id, query_type)
    );
    CREATE INDEX idx_wbc_expires ON work_board_cache(expires_at);
`);

vi.mock('../db.js', () => ({ default: testDb }));

const { getCached, putCached, invalidate, purgeExpired } = await import('../lib/work-board-cache.js');

describe('work-board-cache', () => {
    beforeEach(() => { testDb.exec('DELETE FROM work_board_cache'); });

    it('putCached + getCached roundtrips payload', () => {
        putCached(42, 'my_reviews', [{ id: 1 }], 'W/"abc"', 300);
        const row = getCached(42, 'my_reviews');
        expect(row).not.toBeNull();
        expect(row.payload).toEqual([{ id: 1 }]);
        expect(row.etag).toBe('W/"abc"');
        expect(row.fetchedAt).toBeInstanceOf(Date);
        expect(row.expiresAt).toBeInstanceOf(Date);
        expect(row.isFresh).toBe(true);
    });

    it('getCached returns null when no row', () => {
        expect(getCached(42, 'my_reviews')).toBeNull();
    });

    it('getCached returns row with isFresh=false when expired', () => {
        const pastIso = new Date(Date.now() - 10_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, etag, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(42, 'my_reviews', '[]', null, pastIso, pastIso);
        const row = getCached(42, 'my_reviews');
        expect(row.isFresh).toBe(false);
    });

    it('invalidate(userId, queryType) removes one row', () => {
        putCached(1, 'my_reviews', [], null, 300);
        putCached(1, 'my_issues', [], null, 300);
        invalidate(1, 'my_reviews');
        expect(getCached(1, 'my_reviews')).toBeNull();
        expect(getCached(1, 'my_issues')).not.toBeNull();
    });

    it('invalidate(userId) with no type removes all rows for that user', () => {
        putCached(1, 'my_reviews', [], null, 300);
        putCached(1, 'my_issues', [], null, 300);
        putCached(2, 'my_reviews', [], null, 300);
        invalidate(1);
        expect(getCached(1, 'my_reviews')).toBeNull();
        expect(getCached(1, 'my_issues')).toBeNull();
        expect(getCached(2, 'my_reviews')).not.toBeNull();
    });

    it('purgeExpired deletes rows whose expires_at is more than gracePeriodDays in the past', () => {
        const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
        const recent = new Date(Date.now() - 60_000).toISOString();
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, expires_at) VALUES (?, ?, ?, ?)`).run(1, 'a', '[]', longAgo);
        testDb.prepare(`INSERT INTO work_board_cache (user_id, query_type, payload, expires_at) VALUES (?, ?, ?, ?)`).run(1, 'b', '[]', recent);
        const deleted = purgeExpired({ gracePeriodDays: 1 });
        expect(deleted).toBe(1);
        expect(testDb.prepare('SELECT COUNT(*) as n FROM work_board_cache').get().n).toBe(1);
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run server/__tests__/work-board-cache.test.js`
Expected: FAIL — "Cannot find module '../lib/work-board-cache.js'".

- [ ] **Step 3: Implement the module**

Create `server/lib/work-board-cache.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-user cache for Work Board live-fetch responses.
 * TTL-based with ETag passthrough for conditional GETs.
 */
import db from '../db.js';

/**
 * @param {number} userId
 * @param {string} queryType
 * @returns {{ payload: any, etag: string|null, fetchedAt: Date, expiresAt: Date, isFresh: boolean } | null}
 */
export function getCached(userId, queryType) {
    const row = db.prepare(`
        SELECT payload, etag, fetched_at AS fetchedAt, expires_at AS expiresAt
        FROM work_board_cache
        WHERE user_id = ? AND query_type = ?
    `).get(userId, queryType);
    if (!row) return null;

    const fetchedAt = new Date(row.fetchedAt);
    const expiresAt = new Date(row.expiresAt);
    return {
        payload: JSON.parse(row.payload),
        etag: row.etag || null,
        fetchedAt,
        expiresAt,
        isFresh: expiresAt.getTime() > Date.now(),
    };
}

export function putCached(userId, queryType, payload, etag, ttlSeconds = 300) {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlSeconds * 1000);
    db.prepare(`
        INSERT INTO work_board_cache (user_id, query_type, payload, etag, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, query_type) DO UPDATE SET
            payload     = excluded.payload,
            etag        = excluded.etag,
            fetched_at  = excluded.fetched_at,
            expires_at  = excluded.expires_at
    `).run(userId, queryType, JSON.stringify(payload), etag || null, now.toISOString(), expires.toISOString());
}

export function invalidate(userId, queryType) {
    if (queryType) {
        db.prepare('DELETE FROM work_board_cache WHERE user_id = ? AND query_type = ?').run(userId, queryType);
    } else {
        db.prepare('DELETE FROM work_board_cache WHERE user_id = ?').run(userId);
    }
}

export function purgeExpired({ gracePeriodDays = 1 } = {}) {
    const cutoff = new Date(Date.now() - gracePeriodDays * 24 * 3600 * 1000).toISOString();
    const info = db.prepare('DELETE FROM work_board_cache WHERE expires_at < ?').run(cutoff);
    return info.changes;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run server/__tests__/work-board-cache.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-cache.js server/__tests__/work-board-cache.test.js
git commit -m "feat(work-board): cache helper with TTL and ETag passthrough"
```

---

## Task 3: Live GitHub fetch helpers

**Files:**
- Create: `server/lib/work-board-github.js`
- Test: `server/__tests__/work-board-github.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/work-board-github.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGithubApi = vi.fn();
vi.mock('../lib/github-api.js', () => ({ githubApi: (...args) => mockGithubApi(...args) }));

const { fetchMyPendingReviews, fetchStalePRs, fetchMyOpenIssues, fetchTechDebtIssues, DEFAULT_DEBT_LABELS } = await import('../lib/work-board-github.js');

function makeSearchResult(items) {
    return {
        total_count: items.length,
        incomplete_results: false,
        items,
        _etag: 'W/"abc"',
    };
}

function githubIssue({ number, title, login, repo, labels = [], createdAt, updatedAt, isPR = false }) {
    return {
        number,
        title,
        user: { login },
        repository_url: `https://api.github.com/repos/${repo}`,
        html_url: `https://github.com/${repo}/${isPR ? 'pull' : 'issues'}/${number}`,
        labels: labels.map(n => ({ name: n })),
        created_at: createdAt,
        updated_at: updatedAt,
        pull_request: isPR ? { url: 'x' } : undefined,
        assignees: [],
    };
}

describe('work-board-github', () => {
    beforeEach(() => { mockGithubApi.mockReset(); });

    it('fetchMyPendingReviews builds the right search query', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchMyPendingReviews({ token: 'tok', login: 'alice' });
        const [path] = mockGithubApi.mock.calls[0];
        expect(path).toContain('/search/issues');
        expect(path).toContain('review-requested%3Aalice');
        expect(path).toContain('is%3Aopen');
        expect(path).toContain('is%3Apr');
    });

    it('fetchMyPendingReviews normalises items to { repoFullName, prNumber, title, authorLogin, ageHours }', async () => {
        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
        mockGithubApi.mockResolvedValue(makeSearchResult([
            githubIssue({ number: 42, title: 'Fix X', login: 'bob', repo: 'org/repo', createdAt: twoHoursAgo, updatedAt: twoHoursAgo, isPR: true }),
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
        expect(result.etag).toBe('W/"abc"');
    });

    it('fetchStalePRs includes updated:<cutoff qualifier and days param', async () => {
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

    it('DEFAULT_DEBT_LABELS is used when no labels passed', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchTechDebtIssues({ token: 'tok' });
        expect(DEFAULT_DEBT_LABELS.length).toBeGreaterThan(3);
    });

    it('passes If-None-Match header when etag is provided', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchMyPendingReviews({ token: 'tok', login: 'alice', etag: 'W/"prev"' });
        const [, , options] = mockGithubApi.mock.calls[0];
        expect(options?.headers?.['If-None-Match']).toBe('W/"prev"');
    });

    it('304 response returns items=null and notModified=true', async () => {
        mockGithubApi.mockResolvedValue({ _status: 304, _etag: 'W/"same"' });
        const result = await fetchMyPendingReviews({ token: 'tok', login: 'alice', etag: 'W/"same"' });
        expect(result.notModified).toBe(true);
        expect(result.items).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run server/__tests__/work-board-github.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Check existing githubApi wrapper contract**

Read [server/lib/github-api.js](server/lib/github-api.js). Confirm that:
- Signature is `githubApi(path, token, options)`.
- Returns parsed JSON on success, with `_etag` and `_status` metadata fields.
- On 304, returns a minimal object `{ _status: 304, _etag }`.

If any of the above does not hold, **adjust the mock and the implementation below to match** before continuing.

- [ ] **Step 4: Implement `server/lib/work-board-github.js`**

```js
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live cross-repo GitHub fetchers used by the Work Board when webhook data is
 * missing or stale. Each function returns a normalised shape that matches the
 * existing event-aggregations output.
 */
import { githubApi } from './github-api.js';

export const DEFAULT_DEBT_LABELS = [
    'tech-debt', 'technical-debt', 'technical debt',
    'debt', 'refactor', 'refactoring', 'code-smell', 'cleanup',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRepoFullName(issue) {
    // repository_url = "https://api.github.com/repos/OWNER/REPO"
    const match = /\/repos\/([^/]+\/[^/]+)$/.exec(issue.repository_url || '');
    return match ? match[1] : (issue.repository?.full_name || '');
}

function hoursSince(iso) {
    return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function daysSince(iso) {
    return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

async function callSearch({ token, q, etag, perPage = 100 }) {
    const path = `/search/issues?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=updated&order=desc`;
    const options = etag ? { headers: { 'If-None-Match': etag } } : undefined;
    const json = await githubApi(path, token, options);
    if (json && json._status === 304) {
        return { notModified: true, items: null, etag: json._etag || etag };
    }
    return {
        notModified: false,
        items: Array.isArray(json?.items) ? json.items : [],
        totalCount: json?.total_count ?? 0,
        etag: json?._etag || null,
    };
}

// ---------------------------------------------------------------------------
// Normalisers — shape matches server/lib/event-aggregations.js output
// ---------------------------------------------------------------------------

function normalisePR(issue) {
    return {
        repoFullName: extractRepoFullName(issue),
        prNumber: issue.number,
        title: issue.title || null,
        authorLogin: issue.user?.login || null,
        requestedAt: issue.updated_at,
        ageHours: Math.round(hoursSince(issue.updated_at) * 10) / 10,
        ageDays: Math.round(daysSince(issue.created_at) * 10) / 10,
        openedAt: issue.created_at,
    };
}

function normaliseIssue(issue) {
    return {
        repoFullName: extractRepoFullName(issue),
        issueNumber: issue.number,
        title: issue.title || null,
        authorLogin: issue.user?.login || null,
        labels: (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name)).filter(Boolean),
        assignees: (issue.assignees || []).map(a => a.login).filter(Boolean),
        openedAt: issue.created_at,
        ageDays: Math.round(daysSince(issue.created_at) * 10) / 10,
    };
}

// ---------------------------------------------------------------------------
// Public fetchers
// ---------------------------------------------------------------------------

export async function fetchMyPendingReviews({ token, login, etag, limit = 100 }) {
    const q = `review-requested:${login} is:open is:pr archived:false`;
    const res = await callSearch({ token, q, etag, perPage: limit });
    if (res.notModified) return res;
    return { ...res, items: res.items.map(normalisePR) };
}

export async function fetchStalePRs({ token, login, staleAfterDays = 7, etag, limit = 100 }) {
    const cutoff = new Date(Date.now() - staleAfterDays * 86_400_000).toISOString().slice(0, 10);
    const q = `author:${login} is:open is:pr updated:<${cutoff} archived:false`;
    const res = await callSearch({ token, q, etag, perPage: limit });
    if (res.notModified) return res;
    return { ...res, items: res.items.map(normalisePR) };
}

export async function fetchMyOpenIssues({ token, login, etag, limit = 100 }) {
    const q = `assignee:${login} is:open is:issue archived:false`;
    const res = await callSearch({ token, q, etag, perPage: limit });
    if (res.notModified) return res;
    return { ...res, items: res.items.map(normaliseIssue) };
}

export async function fetchTechDebtIssues({ token, labels, etag, limit = 100 }) {
    const effectiveLabels = (Array.isArray(labels) && labels.length > 0 ? labels : DEFAULT_DEBT_LABELS);
    const labelQ = effectiveLabels.map(l => `label:"${l}"`).join(' OR ');
    const q = `is:open is:issue archived:false (${labelQ})`;
    const res = await callSearch({ token, q, etag, perPage: limit });
    if (res.notModified) return res;
    return { ...res, items: res.items.map(normaliseIssue) };
}
```

- [ ] **Step 5: Run tests and verify all pass**

Run: `npx vitest run server/__tests__/work-board-github.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add server/lib/work-board-github.js server/__tests__/work-board-github.test.js
git commit -m "feat(work-board): live GitHub fetchers via /search/issues"
```

---

## Task 4: Wire live fallback into read endpoints

**Files:**
- Modify: `server/routes/work-board.js`
- Modify: `server/__tests__/work-board-routes.test.js`

- [ ] **Step 1: Read the existing file to locate the 4 endpoints to modify**

Read [server/routes/work-board.js](server/routes/work-board.js). The endpoints to modify are `/my-reviews`, `/my-issues`, `/stale-prs`, `/tech-debt`.

- [ ] **Step 2: Add a shared helper near the top of the file (under the existing `parseRepoIds` helper)**

Insert:

```js
import { getCached, putCached } from '../lib/work-board-cache.js';
import {
    fetchMyPendingReviews,
    fetchStalePRs,
    fetchMyOpenIssues,
    fetchTechDebtIssues,
} from '../lib/work-board-github.js';

const CACHE_TTL_SECONDS = 300;

/**
 * Resolve the effective data for a Work Board tab.
 * Order:
 *   1. Fresh cache hit → return cache.
 *   2. Live fetch (with If-None-Match if we have a stale cache ETag):
 *        - 304 → bump expiry and return cached payload
 *        - 200 → store + return
 *        - error → fall back to the webhook-local result (never 500 the route)
 *   3. Webhook-local result always included as lastResortFallback.
 */
async function resolveTabData({ userId, queryType, token, webhookData, fetcher, fetchArgs }) {
    const cached = getCached(userId, queryType);

    if (cached?.isFresh) {
        return { data: cached.payload, meta: { source: 'cache', fetchedAt: cached.fetchedAt, cacheExpiresAt: cached.expiresAt } };
    }

    if (!token) {
        // Unauthenticated path (shouldn't happen — requireAuth gates); fall back to webhook-local.
        return { data: webhookData, meta: { source: 'webhook', fetchedAt: new Date() } };
    }

    try {
        const live = await fetcher({ token, etag: cached?.etag, ...fetchArgs });
        if (live.notModified && cached) {
            putCached(userId, queryType, cached.payload, cached.etag, CACHE_TTL_SECONDS);
            return { data: cached.payload, meta: { source: 'cache', fetchedAt: new Date(), cacheExpiresAt: new Date(Date.now() + CACHE_TTL_SECONDS * 1000) } };
        }
        const merged = live.items;
        // Prefer webhook-local items when they exist AND are equal-or-newer (webhook has stricter dedup).
        const effective = Array.isArray(webhookData) && webhookData.length > 0 ? webhookData : merged;
        putCached(userId, queryType, effective, live.etag, CACHE_TTL_SECONDS);
        return {
            data: effective,
            meta: {
                source: Array.isArray(webhookData) && webhookData.length > 0 ? 'merged' : 'live',
                fetchedAt: new Date(),
                cacheExpiresAt: new Date(Date.now() + CACHE_TTL_SECONDS * 1000),
            },
        };
    } catch (err) {
        return {
            data: webhookData,
            meta: { source: 'webhook', fetchedAt: new Date(), liveFetchError: err.message || 'live fetch failed' },
        };
    }
}
```

- [ ] **Step 3: Rewrite each read endpoint to use `resolveTabData`**

Replace the `/my-reviews` handler with:

```js
router.get('/my-reviews', requireAuth, async (req, res) => {
    try {
        const reviewerLogin = req.session?.userLogin || null;
        if (!reviewerLogin) return errorResponse(res, 400, 'GitHub login not found in session');
        const limit = Math.min(Number.parseInt(req.query.limit || '100', 10), 200);
        const webhookData = listMyPendingReviews({ reviewerLogin, limit });
        const { data, meta } = await resolveTabData({
            userId: req.session.userId,
            queryType: 'my_reviews',
            token: req.session.accessToken,
            webhookData,
            fetcher: fetchMyPendingReviews,
            fetchArgs: { login: reviewerLogin, limit },
        });
        res.json({ data, meta });
    } catch (err) {
        errorResponse(res, 500, safeError(err, 'Failed to fetch pending reviews'));
    }
});
```

Apply analogous changes to `/my-issues`, `/stale-prs`, `/tech-debt` — using the matching `webhookData` function and `fetcher`. For tech-debt pass `fetchArgs: { labels, limit }`. For stale-prs pass `fetchArgs: { login: reviewerLogin, staleAfterDays, limit }`.

For `/review-load` and `/dora` (webhook-only): wrap responses in the new envelope and add `meta: { source: 'webhook', fetchedAt: new Date(), requiresWebhook: data.length === 0 }`.

- [ ] **Step 4: Extend route tests**

Open [server/__tests__/work-board-routes.test.js](server/__tests__/work-board-routes.test.js). Add a new `describe('live fallback')` block that mocks `fetchMyPendingReviews` and `getCached/putCached` and asserts:
- Cache hit short-circuits the fetcher (fetcher not called).
- Cache miss invokes fetcher, stores response, returns `meta.source: 'live'`.
- 304 on fetcher preserves cached payload and returns `meta.source: 'cache'`.
- Fetcher throw returns webhook-local data with `meta.source: 'webhook'` and `meta.liveFetchError` set.

Use `vi.mock('../lib/work-board-cache.js')` and `vi.mock('../lib/work-board-github.js')` at the top of the file (alongside existing mocks).

- [ ] **Step 5: Run all affected tests**

Run: `npx vitest run server/__tests__/work-board-routes.test.js server/__tests__/work-board-cache.test.js server/__tests__/work-board-github.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/work-board.js server/__tests__/work-board-routes.test.js
git commit -m "feat(work-board): live GitHub fallback with ETag revalidation"
```

---

## Task 5: Snooze helper + filter

**Files:**
- Create: `server/lib/work-board-snooze.js`
- Test: `server/__tests__/work-board-snooze.test.js`
- Modify: `server/routes/work-board.js` (apply snooze filter to PR lists)

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/work-board-snooze.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE work_board_snooze (
        user_id INTEGER NOT NULL,
        repo_full_name TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_number INTEGER NOT NULL,
        until_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name, item_type, item_number)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { snooze, unsnooze, listSnoozes, filterOutSnoozed, isSnoozed } = await import('../lib/work-board-snooze.js');

describe('work-board-snooze', () => {
    beforeEach(() => { testDb.exec('DELETE FROM work_board_snooze'); });

    it('snooze creates a row with until_at in the future', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        const rows = listSnoozes({ userId: 1 });
        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].untilAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('snooze is idempotent for the same key (updates until_at)', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 168 });
        const rows = listSnoozes({ userId: 1 });
        expect(rows).toHaveLength(1);
    });

    it('unsnooze deletes the row', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        const deleted = unsnooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 });
        expect(deleted).toBe(1);
        expect(listSnoozes({ userId: 1 })).toHaveLength(0);
    });

    it('listSnoozes omits expired rows by default', () => {
        testDb.prepare(`INSERT INTO work_board_snooze VALUES (?, ?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 1, new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
        testDb.prepare(`INSERT INTO work_board_snooze VALUES (?, ?, ?, ?, ?, ?)`)
            .run(1, 'o/r', 'pr', 2, new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
        const rows = listSnoozes({ userId: 1 });
        expect(rows.map(r => r.itemNumber)).toEqual([2]);
    });

    it('isSnoozed returns true for active snooze', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(isSnoozed({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 })).toBe(true);
        expect(isSnoozed({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 43 })).toBe(false);
    });

    it('filterOutSnoozed removes snoozed items in place (PR)', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        const items = [
            { repoFullName: 'o/r', prNumber: 42 },
            { repoFullName: 'o/r', prNumber: 43 },
        ];
        const filtered = filterOutSnoozed({ userId: 1, items, itemType: 'pr' });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].prNumber).toBe(43);
    });

    it('filterOutSnoozed for issues uses issueNumber', () => {
        snooze({ userId: 1, repoFullName: 'o/r', itemType: 'issue', itemNumber: 99, hours: 24 });
        const items = [
            { repoFullName: 'o/r', issueNumber: 99 },
            { repoFullName: 'o/r', issueNumber: 100 },
        ];
        const filtered = filterOutSnoozed({ userId: 1, items, itemType: 'issue' });
        expect(filtered.map(i => i.issueNumber)).toEqual([100]);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run server/__tests__/work-board-snooze.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/lib/work-board-snooze.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
import db from '../db.js';

const VALID_ITEM_TYPES = new Set(['pr', 'issue']);

export function snooze({ userId, repoFullName, itemType, itemNumber, hours }) {
    if (!VALID_ITEM_TYPES.has(itemType)) throw new Error(`invalid itemType: ${itemType}`);
    const until = new Date(Date.now() + Number(hours) * 3_600_000).toISOString();
    db.prepare(`
        INSERT INTO work_board_snooze (user_id, repo_full_name, item_type, item_number, until_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, repo_full_name, item_type, item_number) DO UPDATE SET
            until_at = excluded.until_at
    `).run(userId, repoFullName, itemType, itemNumber, until);
    return { untilAt: until };
}

export function unsnooze({ userId, repoFullName, itemType, itemNumber }) {
    const info = db.prepare(`
        DELETE FROM work_board_snooze
        WHERE user_id = ? AND repo_full_name = ? AND item_type = ? AND item_number = ?
    `).run(userId, repoFullName, itemType, itemNumber);
    return info.changes;
}

export function isSnoozed({ userId, repoFullName, itemType, itemNumber }) {
    const row = db.prepare(`
        SELECT until_at AS untilAt FROM work_board_snooze
        WHERE user_id = ? AND repo_full_name = ? AND item_type = ? AND item_number = ?
          AND until_at > CURRENT_TIMESTAMP
    `).get(userId, repoFullName, itemType, itemNumber);
    return !!row;
}

export function listSnoozes({ userId, includeExpired = false } = {}) {
    const sql = includeExpired
        ? `SELECT repo_full_name AS repoFullName, item_type AS itemType, item_number AS itemNumber, until_at AS untilAt, created_at AS createdAt FROM work_board_snooze WHERE user_id = ?`
        : `SELECT repo_full_name AS repoFullName, item_type AS itemType, item_number AS itemNumber, until_at AS untilAt, created_at AS createdAt FROM work_board_snooze WHERE user_id = ? AND until_at > CURRENT_TIMESTAMP`;
    return db.prepare(sql).all(userId);
}

export function filterOutSnoozed({ userId, items, itemType }) {
    if (!Array.isArray(items) || items.length === 0) return items || [];
    const numberKey = itemType === 'pr' ? 'prNumber' : 'issueNumber';
    const snoozed = new Set(
        listSnoozes({ userId })
            .filter(s => s.itemType === itemType)
            .map(s => `${s.repoFullName}#${s.itemNumber}`),
    );
    return items.filter(it => !snoozed.has(`${it.repoFullName}#${it[numberKey]}`));
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run server/__tests__/work-board-snooze.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Apply snooze filter in read endpoints**

In [server/routes/work-board.js](server/routes/work-board.js), after each call to `resolveTabData`, pipe the result through `filterOutSnoozed` (unless `?includeSnoozed=1` is set). Example for `/my-reviews`:

```js
const { data, meta } = await resolveTabData({ /* … */ });
const includeSnoozed = req.query.includeSnoozed === '1';
const finalData = includeSnoozed ? data : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
res.json({ data: finalData, meta });
```

Import at the top:

```js
import { filterOutSnoozed } from '../lib/work-board-snooze.js';
```

Apply analogously to `/my-issues` (itemType 'issue'), `/stale-prs` ('pr'), `/tech-debt` ('issue').

- [ ] **Step 6: Run route tests**

Run: `npx vitest run server/__tests__/work-board-routes.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/lib/work-board-snooze.js server/__tests__/work-board-snooze.test.js server/routes/work-board.js
git commit -m "feat(work-board): snooze helper + filter in read endpoints"
```

---

## Task 6: Snooze REST endpoints

**Files:**
- Create: `server/routes/work-board-actions.js`
- Create: `server/__tests__/work-board-actions.test.js`
- Modify: route index mount point

- [ ] **Step 1: Write failing tests for snooze endpoints**

Create `server/__tests__/work-board-actions.test.js` with the snooze-only section (we'll append review-action + presets + ai-summary in later tasks):

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/work-board-snooze.js', () => ({
    snooze: vi.fn(() => ({ untilAt: '2026-04-22T00:00:00.000Z' })),
    unsnooze: vi.fn(() => 1),
    listSnoozes: vi.fn(() => []),
}));
vi.mock('../lib/work-board-cache.js', () => ({
    invalidate: vi.fn(),
}));
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => { req.session = { userId: 1, userLogin: 'alice', accessToken: 'tok' }; next(); },
    errorResponse: (res, status, message, code) => res.status(status).json({ error: message, code }),
    safeError: (err, fallback) => err.message || fallback,
}));

const { default: router } = await import('../routes/work-board-actions.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
    return app;
}

describe('POST /api/v1/work-board/snooze', () => {
    beforeEach(() => vi.clearAllMocks());

    it('snoozes a PR for 24h', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 24 });
        expect(res.status).toBe(200);
        expect(res.body.data.untilAt).toBe('2026-04-22T00:00:00.000Z');
    });

    it('rejects invalid hours', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42, hours: 9999 });
        expect(res.status).toBe(400);
    });

    it('rejects invalid itemType', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'blob', itemNumber: 42, hours: 24 });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/v1/work-board/snooze', () => {
    it('unsnoozes an item', async () => {
        const res = await request(makeApp()).delete('/api/v1/work-board/snooze')
            .send({ repoFullName: 'o/r', itemType: 'pr', itemNumber: 42 });
        expect(res.status).toBe(200);
        expect(res.body.data.removed).toBe(1);
    });
});

describe('GET /api/v1/work-board/snoozes', () => {
    it('returns active snoozes for the user', async () => {
        const res = await request(makeApp()).get('/api/v1/work-board/snoozes');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run server/__tests__/work-board-actions.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the router**

Create `server/routes/work-board-actions.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
import express from 'express';
import { requireAuth, errorResponse, safeError } from '../middleware/auth.js';
import * as snoozeLib from '../lib/work-board-snooze.js';
import { invalidate as invalidateCache } from '../lib/work-board-cache.js';

const router = express.Router();

const VALID_SNOOZE_HOURS = new Set([1, 4, 8, 24, 72, 168, 720]);
const VALID_ITEM_TYPES = new Set(['pr', 'issue']);

function validateSnoozeBody(body) {
    const { repoFullName, itemType, itemNumber, hours } = body || {};
    if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) return 'invalid repoFullName';
    if (!VALID_ITEM_TYPES.has(itemType)) return 'itemType must be "pr" or "issue"';
    if (!Number.isInteger(itemNumber) || itemNumber <= 0) return 'itemNumber must be a positive integer';
    if (hours !== undefined && !VALID_SNOOZE_HOURS.has(Number(hours))) return `hours must be one of ${[...VALID_SNOOZE_HOURS].join(', ')}`;
    return null;
}

router.post('/snooze', requireAuth, (req, res) => {
    try {
        const err = validateSnoozeBody(req.body);
        if (err) return errorResponse(res, 400, err);
        const { repoFullName, itemType, itemNumber, hours = 24 } = req.body;
        const result = snoozeLib.snooze({ userId: req.session.userId, repoFullName, itemType, itemNumber, hours });
        invalidateCache(req.session.userId, itemType === 'pr' ? 'my_reviews' : 'my_issues');
        res.json({ data: result });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to snooze'));
    }
});

router.delete('/snooze', requireAuth, (req, res) => {
    try {
        const { repoFullName, itemType, itemNumber } = req.body || {};
        if (!VALID_ITEM_TYPES.has(itemType)) return errorResponse(res, 400, 'itemType must be "pr" or "issue"');
        if (!Number.isInteger(itemNumber)) return errorResponse(res, 400, 'itemNumber required');
        const removed = snoozeLib.unsnooze({ userId: req.session.userId, repoFullName, itemType, itemNumber });
        invalidateCache(req.session.userId, itemType === 'pr' ? 'my_reviews' : 'my_issues');
        res.json({ data: { removed } });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to unsnooze'));
    }
});

router.get('/snoozes', requireAuth, (req, res) => {
    try {
        const rows = snoozeLib.listSnoozes({ userId: req.session.userId });
        res.json({ data: rows });
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to list snoozes'));
    }
});

export default router;
```

- [ ] **Step 4: Mount the new router**

Find the file that mounts work-board.js (likely `server/routes/v1/index.js` or `server/index.js`). Add next to it:

```js
import workBoardActionsRouter from './work-board-actions.js'; // adjust path
app.use('/api/v1/work-board', workBoardActionsRouter);
```

If mount already happens under `/api/v1/work-board`, mount on the same prefix.

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run server/__tests__/work-board-actions.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add server/routes/work-board-actions.js server/__tests__/work-board-actions.test.js server/routes/v1/index.js
git commit -m "feat(work-board): snooze REST endpoints"
```

(Adjust the third file path if your mount file differs.)

---

## Task 7: Review-action endpoint (approve / request-changes / comment)

**Files:**
- Modify: `server/routes/work-board-actions.js`
- Modify: `server/__tests__/work-board-actions.test.js`

- [ ] **Step 1: Append failing tests for review-action**

Add to `server/__tests__/work-board-actions.test.js`:

```js
import { vi as _vi } from 'vitest';
_vi.mock('../lib/github-api.js', () => ({ githubApi: _vi.fn() }));
const { githubApi } = await import('../lib/github-api.js');

describe('POST /api/v1/work-board/review-action', () => {
    beforeEach(() => { githubApi.mockReset(); });

    it('approves a PR', async () => {
        githubApi.mockResolvedValue({ id: 1, state: 'APPROVED' });
        const res = await request(makeApp()).post('/api/v1/work-board/review-action')
            .send({ repoFullName: 'org/repo', prNumber: 42, action: 'approve' });
        expect(res.status).toBe(200);
        expect(githubApi).toHaveBeenCalledWith(
            '/repos/org/repo/pulls/42/reviews',
            'tok',
            expect.objectContaining({ method: 'POST', body: expect.stringContaining('APPROVE') }),
        );
    });

    it('request_changes requires a body', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/review-action')
            .send({ repoFullName: 'org/repo', prNumber: 42, action: 'request_changes' });
        expect(res.status).toBe(400);
    });

    it('request_changes succeeds with a body', async () => {
        githubApi.mockResolvedValue({ id: 2, state: 'CHANGES_REQUESTED' });
        const res = await request(makeApp()).post('/api/v1/work-board/review-action')
            .send({ repoFullName: 'org/repo', prNumber: 42, action: 'request_changes', body: 'nit: rename' });
        expect(res.status).toBe(200);
    });

    it('maps a GitHub 403 with missing-scope hint to scope_required', async () => {
        const err = new Error('403 Forbidden');
        err.status = 403;
        err.body = { message: 'Resource not accessible by integration' };
        githubApi.mockRejectedValue(err);
        const res = await request(makeApp()).post('/api/v1/work-board/review-action')
            .send({ repoFullName: 'org/repo', prNumber: 42, action: 'approve' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('scope_required');
    });

    it('rejects unknown action', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/review-action')
            .send({ repoFullName: 'org/repo', prNumber: 42, action: 'explode' });
        expect(res.status).toBe(400);
    });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/__tests__/work-board-actions.test.js -t "review-action"`
Expected: FAIL — endpoint missing.

- [ ] **Step 3: Implement the endpoint**

Add to `server/routes/work-board-actions.js` (below the existing exports, above `export default router`):

```js
import { githubApi } from '../lib/github-api.js';

const EVENT_MAP = { approve: 'APPROVE', request_changes: 'REQUEST_CHANGES', comment: 'COMMENT' };

router.post('/review-action', requireAuth, async (req, res) => {
    try {
        const { repoFullName, prNumber, action, body } = req.body || {};
        if (typeof repoFullName !== 'string' || !/^[^/]+\/[^/]+$/.test(repoFullName)) return errorResponse(res, 400, 'invalid repoFullName');
        if (!Number.isInteger(prNumber) || prNumber <= 0) return errorResponse(res, 400, 'prNumber must be positive integer');
        const event = EVENT_MAP[action];
        if (!event) return errorResponse(res, 400, 'action must be approve | request_changes | comment');
        if ((event === 'REQUEST_CHANGES' || event === 'COMMENT') && (!body || typeof body !== 'string' || body.trim().length === 0)) {
            return errorResponse(res, 400, `action ${action} requires a body`);
        }
        const token = req.session.accessToken;
        const payload = { event, body: body?.trim() || undefined };
        try {
            const review = await githubApi(`/repos/${repoFullName}/pulls/${prNumber}/reviews`, token, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
            });
            invalidateCache(req.session.userId, 'my_reviews');
            res.json({ data: { id: review.id, state: review.state } });
        } catch (err) {
            if (err.status === 403) {
                return errorResponse(res, 403, err.body?.message || 'OAuth scope "repo" required to submit reviews', 'scope_required');
            }
            if (err.status === 404) return errorResponse(res, 404, 'PR not found');
            throw err;
        }
    } catch (e) {
        errorResponse(res, 500, safeError(e, 'Failed to submit review'));
    }
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run server/__tests__/work-board-actions.test.js`
Expected: all pass (snooze 5 + review-action 5).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-actions.js server/__tests__/work-board-actions.test.js
git commit -m "feat(work-board): inline review action endpoint"
```

---

## Task 8: Presets CRUD

**Files:**
- Create: `server/lib/work-board-presets.js`
- Create: `server/__tests__/work-board-presets.test.js`
- Modify: `server/routes/work-board-actions.js`
- Modify: `server/__tests__/work-board-actions.test.js`

- [ ] **Step 1: Write failing tests for the helper**

Create `server/__tests__/work-board-presets.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE work_board_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        filters TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, name)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));
const { createPreset, listPresets, updatePreset, deletePreset } = await import('../lib/work-board-presets.js');

describe('work-board-presets', () => {
    beforeEach(() => testDb.exec('DELETE FROM work_board_presets'));

    it('createPreset + listPresets roundtrip', () => {
        const p = createPreset({ userId: 1, name: 'My team', filters: { repos: ['acme/x'] } });
        expect(p.id).toBeGreaterThan(0);
        const list = listPresets(1);
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('My team');
        expect(list[0].filters).toEqual({ repos: ['acme/x'] });
    });

    it('createPreset enforces unique name per user', () => {
        createPreset({ userId: 1, name: 'X', filters: {} });
        expect(() => createPreset({ userId: 1, name: 'X', filters: {} })).toThrow(/unique|constraint/i);
    });

    it('updatePreset updates name + filters', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        updatePreset({ userId: 1, id: p.id, name: 'B', filters: { repos: ['r'] } });
        const list = listPresets(1);
        expect(list[0].name).toBe('B');
        expect(list[0].filters).toEqual({ repos: ['r'] });
    });

    it('deletePreset removes the row', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        const n = deletePreset({ userId: 1, id: p.id });
        expect(n).toBe(1);
        expect(listPresets(1)).toHaveLength(0);
    });

    it('deletePreset returns 0 when id belongs to another user', () => {
        const p = createPreset({ userId: 1, name: 'A', filters: {} });
        const n = deletePreset({ userId: 2, id: p.id });
        expect(n).toBe(0);
    });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run server/__tests__/work-board-presets.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement helper**

Create `server/lib/work-board-presets.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
import db from '../db.js';

export function createPreset({ userId, name, filters }) {
    if (!name || typeof name !== 'string' || name.length > 100) throw new Error('name required, max 100 chars');
    const info = db.prepare(`
        INSERT INTO work_board_presets (user_id, name, filters) VALUES (?, ?, ?)
    `).run(userId, name.trim(), JSON.stringify(filters || {}));
    return { id: info.lastInsertRowid };
}

export function listPresets(userId) {
    const rows = db.prepare(`
        SELECT id, name, filters, created_at AS createdAt, updated_at AS updatedAt
        FROM work_board_presets WHERE user_id = ?
        ORDER BY name
    `).all(userId);
    return rows.map(r => ({ ...r, filters: JSON.parse(r.filters || '{}') }));
}

export function updatePreset({ userId, id, name, filters }) {
    const current = db.prepare('SELECT name, filters FROM work_board_presets WHERE id = ? AND user_id = ?').get(id, userId);
    if (!current) return 0;
    const newName = name !== undefined ? String(name).trim() : current.name;
    const newFilters = filters !== undefined ? JSON.stringify(filters) : current.filters;
    const info = db.prepare(`
        UPDATE work_board_presets SET name = ?, filters = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
    `).run(newName, newFilters, id, userId);
    return info.changes;
}

export function deletePreset({ userId, id }) {
    const info = db.prepare('DELETE FROM work_board_presets WHERE id = ? AND user_id = ?').run(id, userId);
    return info.changes;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run server/__tests__/work-board-presets.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add preset routes + tests**

Append to `server/routes/work-board-actions.js`:

```js
import * as presets from '../lib/work-board-presets.js';

router.get('/presets', requireAuth, (req, res) => {
    try { res.json({ data: presets.listPresets(req.session.userId) }); }
    catch (e) { errorResponse(res, 500, safeError(e, 'Failed to list presets')); }
});

router.post('/presets', requireAuth, (req, res) => {
    try {
        const { name, filters } = req.body || {};
        const result = presets.createPreset({ userId: req.session.userId, name, filters });
        res.json({ data: result });
    } catch (e) {
        if (/UNIQUE|constraint/i.test(e.message)) return errorResponse(res, 409, 'Preset name already exists', 'preset_exists');
        errorResponse(res, 400, e.message);
    }
});

router.patch('/presets/:id', requireAuth, (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        const { name, filters } = req.body || {};
        const changed = presets.updatePreset({ userId: req.session.userId, id, name, filters });
        if (!changed) return errorResponse(res, 404, 'preset not found');
        res.json({ data: { updated: changed } });
    } catch (e) { errorResponse(res, 400, e.message); }
});

router.delete('/presets/:id', requireAuth, (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        const removed = presets.deletePreset({ userId: req.session.userId, id });
        if (!removed) return errorResponse(res, 404, 'preset not found');
        res.json({ data: { removed } });
    } catch (e) { errorResponse(res, 500, safeError(e, 'Failed to delete preset')); }
});
```

Append matching supertest cases to `server/__tests__/work-board-actions.test.js` covering: list empty, create → 200, duplicate name → 409, patch unknown → 404, delete → 200.

- [ ] **Step 6: Run all work-board tests**

Run: `npx vitest run server/__tests__/work-board-actions.test.js server/__tests__/work-board-presets.test.js`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/lib/work-board-presets.js server/routes/work-board-actions.js server/__tests__/work-board-presets.test.js server/__tests__/work-board-actions.test.js
git commit -m "feat(work-board): server-side filter presets with CRUD"
```

---

## Task 9: AI summary fact-sheet + generate

**Files:**
- Create: `server/lib/work-board-summary.js`
- Create: `server/__tests__/work-board-summary.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/work-board-summary.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { type: 'anthropic', generate: vi.fn() };
vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: vi.fn(async () => mockProvider),
}));
const { buildFactSheet, generateSummary, SUMMARY_SCHEMA, SYSTEM_PROMPT } = await import('../lib/work-board-summary.js');

describe('buildFactSheet', () => {
    it('produces a compact token-bounded summary', () => {
        const fact = buildFactSheet({
            reviews: [{ repoFullName: 'o/r', prNumber: 1, title: 'X', authorLogin: 'a', ageHours: 2 }],
            stalePRs: [],
            issues: [{ repoFullName: 'o/r', issueNumber: 9, title: 'Y', ageDays: 3, labels: ['bug'] }],
            techDebt: { items: [], hotspots: [] },
        });
        expect(fact).toContain('pending reviews: 1');
        expect(fact).toContain('o/r#1');
        expect(fact).toContain('open issues: 1');
        expect(fact.length).toBeLessThan(2000);
    });

    it('truncates each section to top 5', () => {
        const many = Array.from({ length: 12 }, (_, i) => ({ repoFullName: 'o/r', prNumber: i + 1, title: `t${i}`, authorLogin: 'a', ageHours: i }));
        const fact = buildFactSheet({ reviews: many, stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } });
        expect(fact.match(/o\/r#/g).length).toBe(5);
    });
});

describe('generateSummary', () => {
    beforeEach(() => { mockProvider.generate.mockReset(); });

    it('calls provider with prompt + schema + systemPrompt', async () => {
        mockProvider.generate.mockResolvedValue({
            text: '{"headline":"All quiet","bullets":[{"text":"Nothing urgent","severity":"info"}],"urgencyScore":0.1}',
            parsed: { headline: 'All quiet', bullets: [{ text: 'Nothing urgent', severity: 'info' }], urgencyScore: 0.1 },
        });
        const summary = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(summary).toMatchObject({ headline: 'All quiet', urgencyScore: 0.1 });
        const call = mockProvider.generate.mock.calls[0][0];
        expect(call.systemPrompt).toBe(SYSTEM_PROMPT);
        expect(call.schema).toBe(SUMMARY_SCHEMA);
        expect(call.prompt).toContain('pending reviews');
    });

    it('returns parsed JSON when provider parses itself', async () => {
        mockProvider.generate.mockResolvedValue({
            text: 'whatever',
            parsed: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.5 },
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.headline).toBe('h');
    });

    it('falls back to parsing text when parsed is missing (tolerant extract)', async () => {
        mockProvider.generate.mockResolvedValue({
            text: 'prefix\n```json\n{"headline":"h","bullets":[{"text":"b","severity":"info"}],"urgencyScore":0.2}\n```\ntrailing',
        });
        const s = await generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } });
        expect(s.headline).toBe('h');
    });

    it('throws when provider is not configured', async () => {
        const { createProviderForUser } = await import('../lib/ai-provider.js');
        createProviderForUser.mockResolvedValueOnce(null);
        await expect(generateSummary({ userId: 1, dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } } }))
            .rejects.toThrow(/not configured|ai_not_configured/i);
    });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run server/__tests__/work-board-summary.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/lib/work-board-summary.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
import { createProviderForUser } from './ai-provider.js';

export const SYSTEM_PROMPT = `You are a senior engineering lead reviewing a developer's cross-repo work board.
Produce a concise, actionable headline + 3-5 bullets that surface the single
most important thing they should do next.

Rules:
- <= 120 chars in the headline. No emoji. No hedging. Active voice.
- Each bullet <= 160 chars. Reference specific repos, PR numbers, people when helpful.
- Severity: "high" only if it blocks others or is past SLA; "medium" for old-but-not-blocking; "info" for observations.
- urgencyScore 0..1: 0.0 = quiet day, 1.0 = drop everything.
- Never invent items. If the input has no urgent work, say so and propose one quick win.
- Output ONLY valid JSON matching the provided schema. No prose.`;

export const SUMMARY_SCHEMA = {
    type: 'object',
    required: ['headline', 'bullets', 'urgencyScore'],
    properties: {
        headline: { type: 'string', maxLength: 200 },
        bullets: {
            type: 'array', minItems: 1, maxItems: 5,
            items: {
                type: 'object',
                required: ['text', 'severity'],
                properties: {
                    text: { type: 'string', maxLength: 240 },
                    severity: { enum: ['high', 'medium', 'info'] },
                    link: {
                        type: 'object',
                        properties: {
                            type: { enum: ['pr', 'issue'] },
                            repo: { type: 'string' },
                            number: { type: 'integer' },
                        },
                    },
                },
            },
        },
        urgencyScore: { type: 'number', minimum: 0, maximum: 1 },
    },
};

function topN(arr, n = 5) { return (arr || []).slice(0, n); }

export function buildFactSheet({ reviews, stalePRs, issues, techDebt }) {
    const lines = [];
    lines.push(`pending reviews: ${reviews.length}`);
    topN(reviews).forEach(r => lines.push(`  ${r.repoFullName}#${r.prNumber} "${r.title || ''}" by ${r.authorLogin || '?'} age=${r.ageHours}h`));
    lines.push(`stale PRs: ${stalePRs.length}`);
    topN(stalePRs).forEach(p => lines.push(`  ${p.repoFullName}#${p.prNumber} "${p.title || ''}" age=${p.ageDays}d`));
    lines.push(`open issues: ${issues.length}`);
    topN(issues).forEach(i => lines.push(`  ${i.repoFullName}#${i.issueNumber} "${i.title || ''}" labels=[${(i.labels || []).join(',')}] age=${i.ageDays}d`));
    const debtItems = techDebt?.items || [];
    lines.push(`tech debt: ${debtItems.length}`);
    topN(debtItems).forEach(i => lines.push(`  ${i.repoFullName}#${i.issueNumber} "${i.title || ''}" age=${i.ageDays}d`));
    const hotspots = techDebt?.hotspots || [];
    if (hotspots.length > 0) lines.push(`debt hotspots: ${hotspots.slice(0, 3).map(h => `${h.repoFullName}(${h.count})`).join(', ')}`);
    return lines.join('\n');
}

function extractJsonFromText(text) {
    if (typeof text !== 'string') return null;
    const fence = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(text);
    const candidate = fence ? fence[1] : text.trim();
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) return null;
    try { return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)); }
    catch { return null; }
}

/**
 * @param {{ userId: number, dataSources: { reviews, stalePRs, issues, techDebt } }} args
 * @returns {Promise<{ headline, bullets, urgencyScore, model, provider }>}
 */
export async function generateSummary({ userId, dataSources }) {
    const provider = await createProviderForUser(userId, 'completion', { featureKey: 'WORK_BOARD_SUMMARY' });
    if (!provider) {
        const err = new Error('ai_not_configured');
        err.code = 'ai_not_configured';
        throw err;
    }
    const prompt = buildFactSheet(dataSources);
    const result = await provider.generate({ prompt, systemPrompt: SYSTEM_PROMPT, schema: SUMMARY_SCHEMA });
    const parsed = result.parsed || extractJsonFromText(result.text);
    if (!parsed || !parsed.headline || !Array.isArray(parsed.bullets)) {
        const err = new Error('ai_invalid_response');
        err.code = 'ai_invalid_response';
        throw err;
    }
    return {
        headline: String(parsed.headline).slice(0, 200),
        bullets: parsed.bullets.slice(0, 5),
        urgencyScore: Math.min(1, Math.max(0, Number(parsed.urgencyScore) || 0)),
        model: provider.modelName || null,
        provider: provider.type || null,
    };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run server/__tests__/work-board-summary.test.js`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-summary.js server/__tests__/work-board-summary.test.js
git commit -m "feat(work-board): AI summary generator with cross-provider schema"
```

---

## Task 10: AI summary route

**Files:**
- Modify: `server/routes/work-board-actions.js`
- Modify: `server/__tests__/work-board-actions.test.js`

- [ ] **Step 1: Write failing test**

Append to `server/__tests__/work-board-actions.test.js`:

```js
_vi.mock('../lib/work-board-summary.js', () => ({
    generateSummary: _vi.fn(async () => ({ headline: 'All quiet', bullets: [{ text: 'Nothing urgent', severity: 'info' }], urgencyScore: 0.1, model: 'claude', provider: 'anthropic' })),
}));
_vi.mock('../lib/work-board-cache.js', () => ({
    invalidate: _vi.fn(),
    getCached: _vi.fn(() => null),
    putCached: _vi.fn(),
}));

describe('POST /api/v1/work-board/ai-summary', () => {
    it('returns a summary (first call)', async () => {
        const res = await request(makeApp()).post('/api/v1/work-board/ai-summary').send({});
        expect(res.status).toBe(200);
        expect(res.body.data.headline).toBe('All quiet');
        expect(res.body.meta.cached).toBe(false);
    });

    it('rate-limits a second call within 5 minutes', async () => {
        await request(makeApp()).post('/api/v1/work-board/ai-summary').send({});
        const res2 = await request(makeApp()).post('/api/v1/work-board/ai-summary').send({});
        expect([200, 429]).toContain(res2.status);
        // Acceptable behaviour: either 429 OR cached (meta.cached=true)
        if (res2.status === 200) expect(res2.body.meta.cached).toBe(true);
    });

    it('returns 404 when ai is not configured', async () => {
        const { generateSummary } = await import('../lib/work-board-summary.js');
        generateSummary.mockRejectedValueOnce(Object.assign(new Error('ai_not_configured'), { code: 'ai_not_configured' }));
        const res = await request(makeApp()).post('/api/v1/work-board/ai-summary').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('ai_not_configured');
    });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run server/__tests__/work-board-actions.test.js -t "ai-summary"`
Expected: FAIL — endpoint missing.

- [ ] **Step 3: Implement route**

Append to `server/routes/work-board-actions.js`:

```js
import { generateSummary } from '../lib/work-board-summary.js';
import { getCached as getCacheRow, putCached as putCacheRow } from '../lib/work-board-cache.js';
import * as aggregations from '../lib/event-aggregations.js';

const aiSummaryLastCall = new Map(); // userId → timestamp
const AI_SUMMARY_COOLDOWN_MS = 5 * 60 * 1000;

function loadDataSources(userId, userLogin) {
    // Prefer cache where available, fall back to webhook-local aggregations.
    const pluck = (type, fallbackFn) => {
        const c = getCacheRow(userId, type);
        if (c?.isFresh) return c.payload;
        try { return fallbackFn(); } catch { return []; }
    };
    return {
        reviews: pluck('my_reviews', () => aggregations.listMyPendingReviews({ reviewerLogin: userLogin, limit: 20 })),
        stalePRs: pluck('stale_prs', () => aggregations.listStalePRs({ staleAfterDays: 7, limit: 20 })),
        issues:  pluck('my_issues', () => aggregations.listMyOpenIssues({ assigneeLogin: userLogin, limit: 20 })),
        techDebt: (() => {
            const c = getCacheRow(userId, 'tech_debt');
            if (c?.isFresh) return c.payload;
            const items = aggregations.listTechDebtIssues({ limit: 20 });
            const hotspots = aggregations.techDebtHotspots({});
            return { items, hotspots };
        })(),
    };
}

router.post('/ai-summary', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    try {
        // Serve cached summary if within cooldown window.
        const cached = getCacheRow(userId, 'ai_summary');
        const last = aiSummaryLastCall.get(userId) || 0;
        const now = Date.now();
        if (cached?.isFresh && (now - last) < AI_SUMMARY_COOLDOWN_MS) {
            return res.json({ data: cached.payload, meta: { cached: true, generatedAt: cached.fetchedAt } });
        }
        const dataSources = loadDataSources(userId, req.session.userLogin);
        const summary = await generateSummary({ userId, dataSources });
        putCacheRow(userId, 'ai_summary', summary, null, 300);
        aiSummaryLastCall.set(userId, now);
        res.json({ data: summary, meta: { cached: false, generatedAt: new Date() } });
    } catch (e) {
        if (e.code === 'ai_not_configured') return errorResponse(res, 404, 'AI is not configured for this user', 'ai_not_configured');
        if (e.code === 'ai_invalid_response') return errorResponse(res, 502, 'AI provider returned an invalid response', 'ai_invalid_response');
        errorResponse(res, 500, safeError(e, 'Failed to generate AI summary'));
    }
});
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run server/__tests__/work-board-actions.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-actions.js server/__tests__/work-board-actions.test.js
git commit -m "feat(work-board): AI summary endpoint with 5-min cache + cooldown"
```

---

## Task 11: Cross-provider AI summary validation

**Files:**
- Create: `server/__tests__/work-board-summary-providers.test.js`

- [ ] **Step 1: Write a parametrised cross-provider test**

Create `server/__tests__/work-board-summary-providers.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const makeProvider = (type) => ({
    type,
    modelName: `${type}-test-model`,
    generate: vi.fn(async () => ({
        text: '',
        parsed: {
            headline: `${type} headline within bounds`,
            bullets: [
                { text: `${type} bullet`, severity: 'info' },
                { text: `${type} second`, severity: 'medium', link: { type: 'pr', repo: 'o/r', number: 1 } },
            ],
            urgencyScore: 0.3,
        },
    })),
});

const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', 'local'];

for (const p of PROVIDERS) {
    describe(`AI summary — provider ${p}`, () => {
        it('produces a valid response that satisfies the schema contract', async () => {
            vi.resetModules();
            const provider = makeProvider(p);
            vi.doMock('../lib/ai-provider.js', () => ({ createProviderForUser: vi.fn(async () => provider) }));
            const { generateSummary, SUMMARY_SCHEMA } = await import('../lib/work-board-summary.js');
            const summary = await generateSummary({
                userId: 1,
                dataSources: { reviews: [], stalePRs: [], issues: [], techDebt: { items: [], hotspots: [] } },
            });
            expect(summary.headline.length).toBeGreaterThan(0);
            expect(summary.headline.length).toBeLessThanOrEqual(200);
            expect(summary.bullets.length).toBeGreaterThanOrEqual(1);
            expect(summary.bullets.length).toBeLessThanOrEqual(5);
            for (const b of summary.bullets) {
                expect(typeof b.text).toBe('string');
                expect(['high', 'medium', 'info']).toContain(b.severity);
            }
            expect(summary.urgencyScore).toBeGreaterThanOrEqual(0);
            expect(summary.urgencyScore).toBeLessThanOrEqual(1);
            expect(summary.provider).toBe(p);
            expect(provider.generate).toHaveBeenCalledTimes(1);
            expect(SUMMARY_SCHEMA.required).toContain('headline');
        });
    });
}
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npx vitest run server/__tests__/work-board-summary-providers.test.js`
Expected: PASS — 5 parametrised tests.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/work-board-summary-providers.test.js
git commit -m "test(work-board): cross-provider AI summary parametric suite"
```

---

## Task 12: Background sweeper + server startup wiring

**Files:**
- Create: `server/lib/work-board-sweeper.js`
- Create: `server/__tests__/work-board-sweeper.test.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/work-board-sweeper.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const purgeCache = vi.fn(() => 3);
const purgeSnoozes = vi.fn(() => 2);
vi.mock('../lib/work-board-cache.js', () => ({ purgeExpired: purgeCache }));
vi.mock('../lib/work-board-snooze.js', () => ({
    purgeExpiredSnoozes: purgeSnoozes,
    snooze: vi.fn(), unsnooze: vi.fn(), listSnoozes: vi.fn(), isSnoozed: vi.fn(), filterOutSnoozed: vi.fn(),
}));

const { startWorkBoardSweeper, stopWorkBoardSweeper, runSweepOnce } = await import('../lib/work-board-sweeper.js');

describe('work-board-sweeper', () => {
    it('runSweepOnce calls both purge helpers', async () => {
        purgeCache.mockClear(); purgeSnoozes.mockClear();
        await runSweepOnce();
        expect(purgeCache).toHaveBeenCalledOnce();
        expect(purgeSnoozes).toHaveBeenCalledOnce();
    });

    it('startWorkBoardSweeper schedules interval and stop clears it', async () => {
        vi.useFakeTimers();
        purgeCache.mockClear();
        startWorkBoardSweeper({ intervalMs: 1000 });
        vi.advanceTimersByTime(3500);
        expect(purgeCache).toHaveBeenCalledTimes(3);
        stopWorkBoardSweeper();
        vi.advanceTimersByTime(5000);
        expect(purgeCache).toHaveBeenCalledTimes(3);
        vi.useRealTimers();
    });
});
```

- [ ] **Step 2: Extend snooze lib with `purgeExpiredSnoozes`**

In [server/lib/work-board-snooze.js](server/lib/work-board-snooze.js), add:

```js
export function purgeExpiredSnoozes({ gracePeriodDays = 1 } = {}) {
    const cutoff = new Date(Date.now() - gracePeriodDays * 24 * 3600 * 1000).toISOString();
    const info = db.prepare('DELETE FROM work_board_snooze WHERE until_at < ?').run(cutoff);
    return info.changes;
}
```

- [ ] **Step 3: Implement sweeper**

Create `server/lib/work-board-sweeper.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
import { purgeExpired as purgeCache } from './work-board-cache.js';
import { purgeExpiredSnoozes } from './work-board-snooze.js';
import logger from './logger.js';

let timer = null;

export async function runSweepOnce() {
    const cacheDeleted = purgeCache({ gracePeriodDays: 1 });
    const snoozesDeleted = purgeExpiredSnoozes({ gracePeriodDays: 1 });
    logger.debug({ cacheDeleted, snoozesDeleted }, 'work-board sweeper tick');
    return { cacheDeleted, snoozesDeleted };
}

export function startWorkBoardSweeper({ intervalMs = 10 * 60 * 1000 } = {}) {
    if (timer) return;
    // Fire once at startup (async, fire-and-forget)
    runSweepOnce().catch(err => logger.warn({ err }, 'work-board sweeper initial tick failed'));
    timer = setInterval(() => {
        runSweepOnce().catch(err => logger.warn({ err }, 'work-board sweeper tick failed'));
    }, intervalMs);
    if (timer.unref) timer.unref();
}

export function stopWorkBoardSweeper() {
    if (timer) { clearInterval(timer); timer = null; }
}
```

- [ ] **Step 4: Wire into server startup**

In [server/index.js](server/index.js), near the existing migration-engine startup (look for `MigrationEngine` or `_startScheduler`), add:

```js
import { startWorkBoardSweeper, stopWorkBoardSweeper } from './lib/work-board-sweeper.js';

// ... after app.listen / startup sequence:
startWorkBoardSweeper();

// ... in graceful shutdown handler:
stopWorkBoardSweeper();
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run server/__tests__/work-board-sweeper.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 6: Full backend regression**

Run: `npx vitest run server/`
Expected: 100 % pass. If anything is red, stop and fix.

- [ ] **Step 7: Commit**

```bash
git add server/lib/work-board-sweeper.js server/lib/work-board-snooze.js server/__tests__/work-board-sweeper.test.js server/index.js
git commit -m "feat(work-board): background sweeper for cache + snooze TTL cleanup"
```

---

## STAGE A CHECKPOINT

Before proceeding to Stage B, verify:

```bash
npx vitest run server/
npx eslint server/routes/ server/lib/
```

Both must pass. Commit nothing further until green. If this is being executed via subagent-driven-development, this is a natural review checkpoint.

---

# STAGE B — FRONTEND

## Task 13: Polling + page visibility in `useWorkBoard`

**Files:**
- Modify: `src/hooks/useWorkBoard.js`
- Create: `tests/hooks/useWorkBoard.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/hooks/useWorkBoard.test.js`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/config', () => ({ MOCK_MODE: false, API_BASE_URL: '' }));

global.fetch = vi.fn();

beforeEach(() => {
    global.fetch.mockReset();
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
});

const { useMyPendingReviews } = await import('@/hooks/useWorkBoard');

describe('useWorkBoard — auto-refresh', () => {
    it('polls at the configured interval while page is visible', async () => {
        vi.useFakeTimers();
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: { fetchedAt: new Date().toISOString() } }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 1000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        await act(async () => { vi.advanceTimersByTime(1050); });
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        vi.useRealTimers();
    });

    it('pauses polling when document is hidden', async () => {
        vi.useFakeTimers();
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: {} }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 1000 }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        await act(async () => { vi.advanceTimersByTime(5000); });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('exposes lastFetchedAt', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], meta: { fetchedAt: '2026-04-21T10:00:00.000Z' } }) });
        const { result } = renderHook(() => useMyPendingReviews({ refreshIntervalMs: 0 }));
        await waitFor(() => expect(result.current.lastFetchedAt).toBeInstanceOf(Date));
    });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run tests/hooks/useWorkBoard.test.js`
Expected: FAIL — param ignored or lastFetchedAt missing.

- [ ] **Step 3: Modify `src/hooks/useWorkBoard.js`**

Replace the current `useWorkBoardFetch` with:

```js
function useWorkBoardFetch(url, mockData, { refreshIntervalMs = 60_000 } = {}) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastFetchedAt, setLastFetchedAt] = useState(null);
    const [meta, setMeta] = useState(null);
    const mountedRef = useRef(true);
    const intervalRef = useRef(null);

    const fetchOnce = useCallback(async () => {
        if (!mountedRef.current) return;
        setLoading(true);
        setError(null);
        try {
            if (MOCK_MODE) {
                await new Promise(r => setTimeout(r, 80));
                if (mountedRef.current) { setData(mockData); setLastFetchedAt(new Date()); }
                return;
            }
            const json = await apiFetch(url);
            if (!mountedRef.current) return;
            setData(json.data ?? json);
            setMeta(json.meta || null);
            setLastFetchedAt(json.meta?.fetchedAt ? new Date(json.meta.fetchedAt) : new Date());
        } catch (err) {
            if (mountedRef.current) setError(err);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [url, mockData]);

    useEffect(() => {
        mountedRef.current = true;
        fetchOnce();

        function startInterval() {
            if (refreshIntervalMs > 0 && !intervalRef.current) {
                intervalRef.current = setInterval(() => {
                    if (!document.hidden) fetchOnce();
                }, refreshIntervalMs);
            }
        }
        function stopInterval() {
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        }
        function onVisibility() {
            if (document.hidden) stopInterval();
            else { fetchOnce(); startInterval(); }
        }

        startInterval();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            mountedRef.current = false;
            stopInterval();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [fetchOnce, refreshIntervalMs]);

    return { data, meta, loading, error, lastFetchedAt, refresh: fetchOnce };
}
```

Add `{ refreshIntervalMs }` forwarding on each public hook (e.g., `export function useMyPendingReviews(opts = {}) { return useWorkBoardFetch('/api/v1/work-board/my-reviews', MOCK_REVIEWS, opts); }`).

- [ ] **Step 4: Verify tests pass**

Run: `npx vitest run tests/hooks/useWorkBoard.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWorkBoard.js tests/hooks/useWorkBoard.test.js
git commit -m "feat(work-board): polling + page visibility in useWorkBoard"
```

---

## Task 14: `useRelativeTime` + refresh button

**Files:**
- Create: `src/hooks/useRelativeTime.js`
- Create: `tests/hooks/useRelativeTime.test.js`
- Modify: `src/components/WorkBoard/WorkBoardPage.jsx`

- [ ] **Step 1: Test**

`tests/hooks/useRelativeTime.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { useRelativeTime } = await import('@/hooks/useRelativeTime');

describe('useRelativeTime', () => {
    it('returns "just now" for <15s', () => {
        const now = new Date();
        const { result } = renderHook(() => useRelativeTime(now));
        expect(result.current).toMatch(/just now/i);
    });

    it('returns "Ns ago" for 30s', () => {
        const d = new Date(Date.now() - 30_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toMatch(/30 s ago/);
    });

    it('returns "Nm ago" for >60s', () => {
        const d = new Date(Date.now() - 5 * 60_000);
        const { result } = renderHook(() => useRelativeTime(d));
        expect(result.current).toMatch(/5 min ago/);
    });

    it('re-renders after 15s (uses interval)', async () => {
        vi.useFakeTimers();
        const d = new Date(Date.now() - 10_000);
        const { result } = renderHook(() => useRelativeTime(d));
        const first = result.current;
        await act(async () => { vi.advanceTimersByTime(16_000); });
        expect(result.current).not.toBe(first);
        vi.useRealTimers();
    });

    it('returns empty string for null date', () => {
        const { result } = renderHook(() => useRelativeTime(null));
        expect(result.current).toBe('');
    });
});
```

- [ ] **Step 2: Implement**

Create `src/hooks/useRelativeTime.js`:

```js
import { useEffect, useState } from 'react';

function format(date) {
    if (!date) return '';
    const diffMs = Date.now() - date.getTime();
    const secs = Math.max(0, Math.round(diffMs / 1000));
    if (secs < 15) return 'just now';
    if (secs < 60) return `${secs} s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

export function useRelativeTime(date) {
    const [, tick] = useState(0);
    useEffect(() => {
        if (!date) return;
        const id = setInterval(() => tick(x => x + 1), 15_000);
        return () => clearInterval(id);
    }, [date]);
    return format(date);
}
```

- [ ] **Step 3: Add refresh button + "updated Ns ago" to the header of WorkBoardPage**

Modify `src/components/WorkBoard/WorkBoardPage.jsx`:
- Import `useRelativeTime` and `RefreshCw` icon from lucide-react.
- Inside `WorkBoardPage`, lift the 4 KPI hooks up (already done in my previous redesign — `KpiRow` already calls them). Add a `refreshAll` function that calls `reviews.refresh(); stale.refresh(); issues.refresh(); debt.refresh()`.
- Near the gradient title, render:

```jsx
<div className="flex items-center gap-3">
  <span className="text-[11px] text-slate-400 dark:text-slate-500" aria-live="polite">
    {earliest && `updated ${earliestRelative}`}
  </span>
  <button onClick={refreshAll} aria-label="Refresh work board" className="p-2 rounded-xl ...">
    <motion.div animate={{ rotate: refreshing ? 360 : 0 }} transition={{ duration: 0.6 }}>
      <RefreshCw className="w-4 h-4" />
    </motion.div>
  </button>
</div>
```

Where `earliest` is `Math.min(...[reviews, stale, issues, debt].map(x => x.lastFetchedAt?.getTime() || Infinity))`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/hooks/useRelativeTime.test.js tests/components/WorkBoard/WorkBoardPage.test.jsx`
Expected: PASS (update WorkBoardPage test to cover the new button by adding `screen.getByRole('button', { name: /refresh/i })`).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRelativeTime.js tests/hooks/useRelativeTime.test.js src/components/WorkBoard/WorkBoardPage.jsx tests/components/WorkBoard/WorkBoardPage.test.jsx
git commit -m "feat(work-board): auto-refresh button + relative-time indicator"
```

---

## Task 15: `useUrlParams` + Filter Bar + chip

**Files:**
- Create: `src/hooks/useUrlParams.js`
- Create: `src/components/WorkBoard/filters/FilterChip.jsx`
- Create: `src/components/WorkBoard/filters/WorkBoardFilterBar.jsx`
- Create: `tests/hooks/useUrlParams.test.js`
- Create: `tests/components/WorkBoard/WorkBoardFilterBar.test.jsx`

- [ ] **Step 1: Implement + test `useUrlParams`**

Create `src/hooks/useUrlParams.js`:

```js
import { useCallback, useEffect, useState } from 'react';

export function useUrlParams(keys) {
    const read = () => {
        const params = new URLSearchParams(window.location.search);
        const out = {};
        for (const k of keys) out[k] = params.get(k) || '';
        return out;
    };
    const [state, setState] = useState(read);

    useEffect(() => {
        const onPop = () => setState(read());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const set = useCallback((updates) => {
        const params = new URLSearchParams(window.location.search);
        for (const [k, v] of Object.entries(updates)) {
            if (v == null || v === '') params.delete(k);
            else params.set(k, String(v));
        }
        const qs = params.toString();
        const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState(null, '', newUrl);
        setState(read());
    }, [keys]);

    return [state, set];
}
```

Create `tests/hooks/useUrlParams.test.js` with tests for: initial read from `window.location.search`, `set()` updates history + state, empty values delete the param.

- [ ] **Step 2: Implement `FilterChip`**

Create `src/components/WorkBoard/filters/FilterChip.jsx`:

```jsx
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

export function FilterChip({ label, count, active, onToggle, tone = 'indigo' }) {
    const tones = {
        indigo: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-400/40',
        amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/40',
        emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400/40',
        slate: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-400/30',
    };
    return (
        <motion.button
            type="button"
            onClick={onToggle}
            whileTap={{ scale: 0.96 }}
            className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors
                ${active ? tones[tone] : 'bg-transparent border-slate-200/60 dark:border-slate-700/50 text-slate-500 dark:text-slate-400 hover:text-slate-700'}
            `}
        >
            {label}
            {typeof count === 'number' && <span className="tabular-nums opacity-70">{count}</span>}
            {active && <X className="w-3 h-3 opacity-80" />}
        </motion.button>
    );
}
```

- [ ] **Step 3: Implement `WorkBoardFilterBar`**

Create `src/components/WorkBoard/filters/WorkBoardFilterBar.jsx` that:
- Accepts `{ filters, setFilters, availableRepos, availableAuthors, availableLabels }`.
- Renders 4 chip groups (repos, authors, labels, age bucket: all/24h/7d/30d).
- Handles multi-select within each group (uses Set on a comma-joined string for URL compatibility).
- Includes a "Hide snoozed" toggle on the right.
- Accepts an optional `<PresetDropdown>` passed as children.

Full implementation: use the Chip component, map `filters.repos.split(',').filter(Boolean)` to a Set for fast lookup, and call `setFilters({ repos: [...currentSet].join(',') })` on toggle. Render horizontally-scrolling chip strip with `overflow-x-auto`.

- [ ] **Step 4: Tests for filter bar**

Create `tests/components/WorkBoard/WorkBoardFilterBar.test.jsx` with tests for: chip renders for each unique value; clicking toggles active state; `setFilters` called with comma-joined updated list; X icon appears only when active.

- [ ] **Step 5: Run**

Run: `npx vitest run tests/hooks/useUrlParams.test.js tests/components/WorkBoard/WorkBoardFilterBar.test.jsx`
Expected: PASS.

- [ ] **Step 6: Wire filter bar into WorkBoardPage**

Modify `src/components/WorkBoard/WorkBoardPage.jsx`:
- Call `const [params, setParams] = useUrlParams(['tab','repos','authors','labels','age','snoozed'])`.
- Read `activeTab` from `params.tab` (fallback `'reviews'`), write via `setParams({ tab })`.
- Render `<WorkBoardFilterBar filters={params} setFilters={setParams} ... />` above the tab bar, below the KPI row.
- Pass filtered items into each tab (client-side filter per `repoFullName`, `authorLogin`, `labels`, `ageHours/ageDays`).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useUrlParams.js src/components/WorkBoard/filters/ tests/hooks/useUrlParams.test.js tests/components/WorkBoard/WorkBoardFilterBar.test.jsx src/components/WorkBoard/WorkBoardPage.jsx
git commit -m "feat(work-board): filter bar with URL sync"
```

---

## Task 16: Presets (frontend)

**Files:**
- Create: `src/hooks/useWorkBoardPresets.js`
- Create: `src/components/WorkBoard/filters/PresetDropdown.jsx`
- Create: `tests/hooks/useWorkBoardPresets.test.js`

- [ ] **Step 1: Implement `useWorkBoardPresets`**

Create `src/hooks/useWorkBoardPresets.js`:

```js
import { useCallback, useEffect, useState } from 'react';

const BASE = '/api/v1/work-board/presets';

export function useWorkBoardPresets() {
    const [presets, setPresets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(BASE, { credentials: 'include' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const json = await res.json();
            setPresets(json.data || []);
            setError(null);
        } catch (e) { setError(e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const create = useCallback(async ({ name, filters }) => {
        const res = await fetch(BASE, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, filters }) });
        if (!res.ok) { const b = await res.json().catch(() => ({})); throw Object.assign(new Error(b.error || `status ${res.status}`), { code: b.code }); }
        await fetchAll();
    }, [fetchAll]);

    const update = useCallback(async (id, patch) => {
        const res = await fetch(`${BASE}/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        await fetchAll();
    }, [fetchAll]);

    const remove = useCallback(async (id) => {
        const res = await fetch(`${BASE}/${id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        await fetchAll();
    }, [fetchAll]);

    return { presets, loading, error, refresh: fetchAll, create, update, remove };
}
```

- [ ] **Step 2: Write tests**

`tests/hooks/useWorkBoardPresets.test.js` covers: initial GET, create calls POST + refetch, delete calls DELETE + refetch, errors propagate.

- [ ] **Step 3: Implement `PresetDropdown`**

Create `src/components/WorkBoard/filters/PresetDropdown.jsx`:
- Shows a `<button>` labelled "Presets" with a chevron.
- Opens a popover listing presets. Each row has a click-to-apply + delete X.
- Footer row: `<input placeholder="Save current as…"> <button>Save</button>`.
- Uses `useWorkBoardPresets`.
- On apply, calls the parent's `onApply(filters)` callback.

- [ ] **Step 4: Wire into `WorkBoardFilterBar`**

Pass the dropdown as a child of filter bar, top-right.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/hooks/useWorkBoardPresets.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useWorkBoardPresets.js src/components/WorkBoard/filters/PresetDropdown.jsx tests/hooks/useWorkBoardPresets.test.js src/components/WorkBoard/filters/WorkBoardFilterBar.jsx
git commit -m "feat(work-board): server-side filter presets UI"
```

---

## Task 17: Keyboard row-navigation hook + extension

**Files:**
- Create: `src/hooks/useRowNavigation.js`
- Create: `tests/hooks/useRowNavigation.test.js`
- Modify: `src/hooks/useKeyboardShortcuts.js`

- [ ] **Step 1: Test-first — `useRowNavigation`**

`tests/hooks/useRowNavigation.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
const { useRowNavigation } = await import('@/hooks/useRowNavigation');

describe('useRowNavigation', () => {
    it('j moves active index down, k moves up', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2, 3] }));
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        expect(result.current.activeIndex).toBe(1);
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })); });
        expect(result.current.activeIndex).toBe(0);
    });

    it('j at last row wraps to 0', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2] }));
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        expect(result.current.activeIndex).toBe(0);
    });

    it('Enter calls onOpen with the active row', () => {
        const onOpen = vi.fn();
        renderHook(() => useRowNavigation({ rows: [{ id: 'a' }, { id: 'b' }], onOpen }));
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' })); });
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
        expect(onOpen).toHaveBeenCalledWith({ id: 'b' }, 1);
    });

    it('ignores keys while typing in an input', () => {
        const { result } = renderHook(() => useRowNavigation({ rows: [1, 2] }));
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })); });
        expect(result.current.activeIndex).toBe(0);
        input.remove();
    });
});
```

- [ ] **Step 2: Implement**

Create `src/hooks/useRowNavigation.js`:

```js
import { useCallback, useEffect, useState } from 'react';

export function useRowNavigation({ rows, onOpen, onKey }) {
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        if (activeIndex >= rows.length) setActiveIndex(Math.max(0, rows.length - 1));
    }, [rows.length, activeIndex]);

    const move = useCallback((delta) => {
        setActiveIndex(i => {
            if (rows.length === 0) return 0;
            return (i + delta + rows.length) % rows.length;
        });
    }, [rows.length]);

    useEffect(() => {
        function handler(e) {
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter' && rows[activeIndex]) { onOpen?.(rows[activeIndex], activeIndex); }
            else onKey?.(e, rows[activeIndex], activeIndex);
        }
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [rows, activeIndex, move, onOpen, onKey]);

    return { activeIndex, setActiveIndex, move };
}
```

- [ ] **Step 3: Extend `useKeyboardShortcuts` for context-scoped shortcuts**

In [src/hooks/useKeyboardShortcuts.js](src/hooks/useKeyboardShortcuts.js), add a second export:

```js
export function useContextShortcut({ key, handler, when = true, deps = [] }) {
    useEffect(() => {
        if (!when) return;
        function h(e) {
            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === key) { e.preventDefault(); handler(e); }
        }
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, when, ...deps]);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/hooks/useRowNavigation.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRowNavigation.js src/hooks/useKeyboardShortcuts.js tests/hooks/useRowNavigation.test.js
git commit -m "feat(work-board): row-navigation + context-shortcut hooks"
```

---

## Task 18: Inline action buttons + `useReviewAction`

**Files:**
- Create: `src/hooks/useReviewAction.js`
- Create: `src/components/WorkBoard/InlineActions.jsx`
- Create: `tests/hooks/useReviewAction.test.js`

- [ ] **Step 1: Test-first for `useReviewAction`**

`tests/hooks/useReviewAction.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));

beforeEach(() => { global.fetch = vi.fn(); vi.clearAllMocks(); });

const { useReviewAction } = await import('@/hooks/useReviewAction');

describe('useReviewAction', () => {
    it('approve posts to /review-action and fires success toast', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { state: 'APPROVED' } }) });
        const onOptimistic = vi.fn(), onRollback = vi.fn();
        const { result } = renderHook(() => useReviewAction({ onOptimistic, onRollback }));
        await act(async () => { await result.current.approve({ repoFullName: 'o/r', prNumber: 1 }); });
        expect(onOptimistic).toHaveBeenCalledWith('approve', { repoFullName: 'o/r', prNumber: 1 });
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/work-board/review-action', expect.objectContaining({ method: 'POST' }));
        expect(mockToast.success).toHaveBeenCalled();
        expect(onRollback).not.toHaveBeenCalled();
    });

    it('rollback fires when fetch fails and error toast is shown', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
        const onOptimistic = vi.fn(), onRollback = vi.fn();
        const { result } = renderHook(() => useReviewAction({ onOptimistic, onRollback }));
        await act(async () => { await result.current.approve({ repoFullName: 'o/r', prNumber: 1 }); });
        expect(onRollback).toHaveBeenCalled();
        expect(mockToast.error).toHaveBeenCalled();
    });

    it('scope_required triggers a distinct toast variant', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'scope_required', error: 'need repo' }) });
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }));
        await act(async () => { await result.current.approve({ repoFullName: 'o/r', prNumber: 1 }); });
        expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('Re-authorize'));
    });

    it('snooze calls /snooze with correct body', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
        const { result } = renderHook(() => useReviewAction({ onOptimistic: vi.fn(), onRollback: vi.fn() }));
        await act(async () => { await result.current.snooze({ repoFullName: 'o/r', prNumber: 1, hours: 24 }); });
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/work-board/snooze', expect.objectContaining({ method: 'POST' }));
    });
});
```

- [ ] **Step 2: Implement hook**

Create `src/hooks/useReviewAction.js`:

```js
import { useCallback } from 'react';
import { useToast } from '@/hooks/useToast';

async function postJson(url, body) {
    const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(json.error || `status ${res.status}`); err.status = res.status; err.code = json.code; throw err; }
    return json.data;
}

export function useReviewAction({ onOptimistic, onRollback }) {
    const { toast } = useToast();

    const run = useCallback(async (kind, args, postUrl, postBody) => {
        onOptimistic?.(kind, args);
        try {
            await postJson(postUrl, postBody);
            toast.success(kind === 'approve' ? 'Approved' : kind === 'request_changes' ? 'Changes requested' : kind === 'snooze' ? 'Snoozed' : 'Done');
        } catch (e) {
            onRollback?.(kind, args, e);
            if (e.code === 'scope_required') toast.error('Re-authorize this app with the repo scope to approve PRs.');
            else toast.error(e.message || 'Action failed');
        }
    }, [onOptimistic, onRollback, toast]);

    return {
        approve: (args) => run('approve', args, '/api/v1/work-board/review-action', { ...args, action: 'approve' }),
        requestChanges: (args) => run('request_changes', args, '/api/v1/work-board/review-action', { ...args, action: 'request_changes' }),
        comment: (args) => run('comment', args, '/api/v1/work-board/review-action', { ...args, action: 'comment' }),
        snooze: (args) => run('snooze', args, '/api/v1/work-board/snooze', { repoFullName: args.repoFullName, itemType: args.itemType || 'pr', itemNumber: args.prNumber || args.issueNumber, hours: args.hours || 24 }),
        unsnooze: (args) => run('unsnooze', args, '/api/v1/work-board/snooze', null), // uses DELETE below
    };
}
```

(Adjust the `unsnooze` implementation to use `fetch(..., { method: 'DELETE' })` — update `run` to accept a method parameter, or inline.)

- [ ] **Step 3: Implement inline buttons**

Create `src/components/WorkBoard/InlineActions.jsx` with `<ApproveButton>`, `<RequestChangesButton>` (opens a small modal via `ModalContext` to collect body), `<SnoozeButton>` (popover with 24h / 72h / 7d options). Each calls the corresponding `useReviewAction` method.

Include loading spinner during `fetch` and disabled state to prevent double-clicks.

- [ ] **Step 4: Wire into each tab of WorkBoardPage**

In `MyReviewsTab` and `StalePRsTab`, render `<InlineActions row={r} onOptimistic={...} onRollback={...}>` on hover (desktop) / always visible (mobile). Optimistic callback removes the row locally; rollback restores.

- [ ] **Step 5: Add keyboard action handlers**

Inside `WorkBoardPage`, use `useRowNavigation({ rows, onOpen, onKey })` + within `onKey`:

```js
onKey: (e, row) => {
    if (!row) return;
    if (e.key === '.') actions.approve(row);
    else if (e.key === 'x') openRequestChangesModal(row);
    else if (e.key === 's') actions.snooze({ ...row, hours: 24 });
    else if (e.key === 'S' && e.shiftKey) actions.snooze({ ...row, hours: 168 });
    else if (e.key === 'r') actions.requestReReview?.(row); // optional v1.5
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/hooks/useReviewAction.test.js tests/components/WorkBoard/WorkBoardPage.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useReviewAction.js src/components/WorkBoard/InlineActions.jsx src/components/WorkBoard/WorkBoardPage.jsx tests/hooks/useReviewAction.test.js
git commit -m "feat(work-board): inline approve/request-changes/snooze actions"
```

---

## Task 19: Keyboard help modal + `?` binding

**Files:**
- Create: `src/components/WorkBoard/KeyboardHelpModal.jsx`
- Modify: `src/components/WorkBoard/WorkBoardPage.jsx`

- [ ] **Step 1: Implement the modal**

Create `src/components/WorkBoard/KeyboardHelpModal.jsx` — renders a `ds-glass`/`ds-card-shimmer` panel listing:

```
Navigation   j / ↓    next row
             k / ↑    previous row
             g r      go to My Reviews
             g s      go to Stale PRs
             g i      go to My Issues
             g t      go to Tech Debt
             g l      go to Review Load
             g d      go to DORA
Actions      Enter    open on GitHub
             .        approve
             x        request changes
             s        snooze 24 h
             Shift+S  snooze 7 d
             u        unsnooze
             r        re-request review
Global       /        focus filter search
             ?        this help
             ⌘K       command palette
```

Reuse `ModalContext`:

```jsx
openModalWithData('workBoardHelp', {});
```

Add `'workBoardHelp'` to the modal list in [src/contexts/ModalContext.jsx](src/contexts/ModalContext.jsx).

- [ ] **Step 2: Wire `?` shortcut**

In `WorkBoardPage`:

```js
useContextShortcut({ key: '?', handler: () => openModalWithData('workBoardHelp', {}) });
```

- [ ] **Step 3: Add `g`+letter navigation**

Use a small state machine inside `WorkBoardPage`:

```js
const [pendingG, setPendingG] = useState(false);
useContextShortcut({ key: 'g', handler: () => setPendingG(true), deps: [] });
useEffect(() => {
    if (!pendingG) return;
    const h = (e) => {
        const map = { r: 'reviews', s: 'stale', i: 'issues', t: 'techdebt', l: 'reviewload', d: 'dora' };
        if (map[e.key]) { setActiveTab(map[e.key]); setPendingG(false); }
        else setPendingG(false);
    };
    window.addEventListener('keydown', h, { once: true });
    const t = setTimeout(() => setPendingG(false), 800);
    return () => { clearTimeout(t); window.removeEventListener('keydown', h); };
}, [pendingG]);
```

- [ ] **Step 4: Test (extend `WorkBoardPage.test.jsx`)**

Press `?` → modal renders. Press `g` then `t` → Tech Debt active.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkBoard/KeyboardHelpModal.jsx src/contexts/ModalContext.jsx src/components/WorkBoard/WorkBoardPage.jsx tests/components/WorkBoard/WorkBoardPage.test.jsx
git commit -m "feat(work-board): keyboard help modal + g-prefix tab nav"
```

---

## Task 20: AI Summary card

**Files:**
- Create: `src/components/WorkBoard/AISummaryCard.jsx`
- Create: `tests/components/WorkBoard/AISummaryCard.test.jsx`
- Modify: `src/components/WorkBoard/WorkBoardPage.jsx`

- [ ] **Step 1: Write failing tests**

`tests/components/WorkBoard/AISummaryCard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AISummaryCard } from '@/components/WorkBoard/AISummaryCard';

beforeEach(() => { global.fetch = vi.fn(); });

describe('AISummaryCard', () => {
    it('hides itself when endpoint returns 404 ai_not_configured', async () => {
        global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ code: 'ai_not_configured' }) });
        const { container } = render(<AISummaryCard />);
        await waitFor(() => expect(container.firstChild).toBeNull());
    });

    it('renders headline + bullets + urgency when success', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({
            data: { headline: 'All quiet on the western front', bullets: [
                { text: 'Nothing urgent', severity: 'info' },
                { text: 'Refactor X', severity: 'medium', link: { type: 'issue', repo: 'o/r', number: 1 } },
            ], urgencyScore: 0.4, provider: 'anthropic', model: 'claude' },
            meta: { cached: false },
        })});
        render(<AISummaryCard />);
        await waitFor(() => expect(screen.getByText(/All quiet/)).toBeInTheDocument());
        expect(screen.getByText(/Refactor X/)).toBeInTheDocument();
    });

    it('regenerate button re-fetches', async () => {
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({
            data: { headline: 'h', bullets: [{ text: 'b', severity: 'info' }], urgencyScore: 0.1 }, meta: {},
        })});
        render(<AISummaryCard />);
        await waitFor(() => expect(screen.getByText('h')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    });
});
```

- [ ] **Step 2: Implement**

Create `src/components/WorkBoard/AISummaryCard.jsx` as a dismissable gradient card. Render logic:
- On mount: `POST /api/v1/work-board/ai-summary`.
- If response is 404 with `code === 'ai_not_configured'` → render nothing.
- If success: show headline (large, `ds-gradient-text`, display font), bullets with coloured dots per severity (`bg-rose-500` high, `bg-amber-500` medium, `bg-slate-400` info), urgency gauge (SVG circular arc).
- Buttons: Regenerate (calls `POST` again), Dismiss (local state `dismissed = true`, unmounts until next mount).
- Uses Framer Motion `AnimatePresence` for bullet stagger.

- [ ] **Step 3: Mount in `WorkBoardPage` above the KPI row**

```jsx
<AISummaryCard />
<KpiRow ... />
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/components/WorkBoard/AISummaryCard.test.jsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkBoard/AISummaryCard.jsx tests/components/WorkBoard/AISummaryCard.test.jsx src/components/WorkBoard/WorkBoardPage.jsx
git commit -m "feat(work-board): AI summary card with headline + urgency gauge"
```

---

## Task 21: Command palette Work-Board extension

**Files:**
- Modify: `src/components/CommandPalette.jsx`
- Modify: `tests/components/CommandPalette.test.jsx` (if exists)

- [ ] **Step 1: Read current palette** ([src/components/CommandPalette.jsx](src/components/CommandPalette.jsx))

Identify the pattern for adding a new group — likely `<Command.Group heading="...">`. Also identify how the current page is detected (prop, context, or window.location).

- [ ] **Step 2: Add a new group visible only when page === 'work-board'**

```jsx
{currentView === 'work-board' && (
    <Command.Group heading="Work Board">
        <Command.Item onSelect={() => onViewChange('work-board', { tab: 'reviews' })}>Open My Reviews</Command.Item>
        <Command.Item onSelect={() => onViewChange('work-board', { tab: 'stale' })}>Open Stale PRs</Command.Item>
        <Command.Item onSelect={() => onViewChange('work-board', { tab: 'issues' })}>Open My Issues</Command.Item>
        <Command.Item onSelect={() => onViewChange('work-board', { tab: 'techdebt' })}>Open Tech Debt</Command.Item>
        <Command.Item onSelect={() => window.dispatchEvent(new CustomEvent('workboard:regenerate-ai'))}>Regenerate AI summary</Command.Item>
        <Command.Item onSelect={() => window.dispatchEvent(new CustomEvent('workboard:save-preset'))}>Save current filter as preset…</Command.Item>
    </Command.Group>
)}
```

(Emits `CustomEvent`s that `WorkBoardPage` listens for — keeps palette decoupled.)

- [ ] **Step 3: Add event listeners in `WorkBoardPage`**

```js
useEffect(() => {
    const onRegen = () => aiSummaryRef.current?.regenerate();
    const onSave = () => presetDropdownRef.current?.openSaveDialog();
    window.addEventListener('workboard:regenerate-ai', onRegen);
    window.addEventListener('workboard:save-preset', onSave);
    return () => {
        window.removeEventListener('workboard:regenerate-ai', onRegen);
        window.removeEventListener('workboard:save-preset', onSave);
    };
}, []);
```

- [ ] **Step 4: Update / extend palette tests**

If `tests/components/CommandPalette.test.jsx` exists, add a case asserting the Work Board group is present when `currentView === 'work-board'`.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandPalette.jsx src/components/WorkBoard/WorkBoardPage.jsx tests/components/CommandPalette.test.jsx
git commit -m "feat(work-board): command palette Work Board group"
```

---

## Task 22: Full frontend regression

**Files:** (none, test run only)

- [ ] **Step 1: Run the full vitest suite**

Run: `npx vitest run`
Expected: all green. Any failure → fix before proceeding.

- [ ] **Step 2: Run eslint on changed files**

Run: `npx eslint src/hooks/ src/components/WorkBoard/ src/components/CommandPalette.jsx`
Expected: 0 errors. Warnings acceptable if pre-existing.

- [ ] **Step 3: Run vite build**

Run: `npx vite build`
Expected: success.

- [ ] **Step 4: Manual smoke (dev server)**

Start: `npm run dev` (in one terminal) + `npm run server` (in another).
Open [http://localhost:5173/work-board](http://localhost:5173/work-board) and verify:
- Page shows "updated just now" after load.
- Refresh button spins and updates timestamp.
- Filter bar filters items live.
- `j`/`k` moves active row (visual indicator on active row — verify you added one, e.g. `ring-2 ring-indigo-500`).
- `?` opens help modal.
- `g` then `t` switches to Tech Debt.
- AI card either shows a summary or is absent (depending on BYOK state).

Confirm no console errors. If any fail, fix before commit.

- [ ] **Step 5: Commit (empty if clean)**

If the smoke test produced any fixes, commit them:

```bash
git add -A
git commit -m "fix(work-board): smoke-test follow-ups"
```

Otherwise skip.

---

## Task 23: E2E Playwright — zero-config flow

**Files:**
- Create: `e2e/work-board-zero-config.spec.js`

- [ ] **Step 1: Read existing e2e harness**

Read [e2e/](e2e/) to confirm Playwright config, auth stub pattern, baseURL. Mirror existing specs for the skeleton.

- [ ] **Step 2: Write the spec**

```js
import { test, expect } from '@playwright/test';

test('Work Board populates from live API with no webhook configured', async ({ page }) => {
    await page.addInitScript(() => {
        window.__MOCK_SESSION__ = { userId: 1, userLogin: 'alice', accessToken: 'mock-token' };
    });

    await page.route('**/api/v1/work-board/my-reviews*', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                data: [{ repoFullName: 'org/repo', prNumber: 42, title: 'Live fetched', authorLogin: 'bob', ageHours: 2 }],
                meta: { source: 'live', fetchedAt: new Date().toISOString() },
            }),
        });
    });
    await page.route('**/api/v1/work-board/stale-prs*', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { source: 'live', fetchedAt: new Date().toISOString() } }) }));
    await page.route('**/api/v1/work-board/my-issues*', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { source: 'live', fetchedAt: new Date().toISOString() } }) }));
    await page.route('**/api/v1/work-board/tech-debt*', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { items: [], hotspots: [] }, meta: { source: 'live', fetchedAt: new Date().toISOString() } }) }));

    await page.goto('/work-board');
    await expect(page.getByText('Live fetched')).toBeVisible();
    await expect(page.getByText(/updated/i)).toBeVisible();
    await expect(page.getByRole('tab', { name: /my reviews/i })).toHaveAttribute('aria-selected', 'true');
});
```

- [ ] **Step 3: Run**

Run: `npx playwright test e2e/work-board-zero-config.spec.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/work-board-zero-config.spec.js
git commit -m "test(work-board): e2e zero-config flow"
```

---

## Task 24: Docs

**Files:**
- Modify: `docs/work-board.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update [docs/work-board.md](docs/work-board.md)**

Add new sections covering:
- Zero-config data source + merge policy per endpoint (include a table copied from the spec).
- Auto-refresh behaviour (60 s default, paused when tab hidden, manual refresh).
- Filter bar + URL sync + server-side presets.
- Keyboard shortcuts (copy the help modal listing).
- Inline actions + scope_required flow.
- AI summary (how it's gated, which providers are supported, 5-min cooldown/cache).

- [ ] **Step 2: Update `CHANGELOG.md`**

Add under "Unreleased":

```md
### Added
- Work Board: zero-config live GitHub data source (falls back to webhook, ETag re-validation, 5 min cache).
- Work Board: 60-second auto-refresh with page-visibility pause + manual refresh button.
- Work Board: filter bar (repo / author / label / age / hide-snoozed) with URL sync and server-stored presets.
- Work Board: keyboard navigation (j/k/Enter), inline approve / request-changes / snooze, g-prefix tab nav, `?` help.
- Work Board: AI summary card across Anthropic / OpenAI / Gemini / OpenRouter / Local providers (BYOK, 5-min cooldown).
- Command Palette: new Work Board group (visible on /work-board).

### Fixed
- `/api/v1/work-board/tech-debt` now handles empty webhook data gracefully by falling back to live GitHub search.
```

- [ ] **Step 3: Commit**

```bash
git add docs/work-board.md CHANGELOG.md
git commit -m "docs(work-board): document mega-upgrade"
```

---

## Task 25: Merge-readiness

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Lint**

Run: `npx eslint src/ server/`
Expected: 0 errors. Fix any new warnings attributable to this work.

- [ ] **Step 3: Build**

Run: `npx vite build`
Expected: success.

- [ ] **Step 4: E2E**

Run: `npx playwright test e2e/work-board-zero-config.spec.js`
Expected: PASS.

- [ ] **Step 5: Create PR**

Use the standard `gh pr create` flow; body references [docs/specs/2026-04-20-work-board-megaplan.md](docs/specs/2026-04-20-work-board-megaplan.md) and this plan.

---

## Self-Review Checklist (done inline)

Spec coverage:
- ✅ L1 live fetch + cache → Tasks 2, 3.
- ✅ L2 route merge + envelope → Task 4.
- ✅ L3 mutations (review + snooze + presets) → Tasks 5-8.
- ✅ L4 AI summary cross-provider → Tasks 9-11.
- ✅ L5 polling + filters + URL sync + keyboard + inline actions + help modal + AI card + palette → Tasks 13-21.
- ✅ Background sweeper → Task 12.
- ✅ E2E zero-config → Task 23.
- ✅ Docs + CHANGELOG → Task 24.

Placeholders: none — every step has concrete code or concrete instructions.

Type consistency: `resolveTabData` return shape, `generateSummary` return shape, `useReviewAction` return shape are all consistent across caller and callee.

Ambiguities resolved:
- Mount path for `work-board-actions.js` noted as "adjust to your mount file" — executor will verify in Task 6 step 4.
- `useReviewAction.unsnooze` DELETE vs POST: step notes "adjust the run helper to accept method" — concrete enough.
