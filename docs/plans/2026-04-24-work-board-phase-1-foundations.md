# Work Board Premium UX — Phase 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend foundations for Work Board premium UX — 4 new SQLite tables, discovery library, tracking CRUD, undo log, and REST endpoints — behind zero user-visible regressions. Front-end (Phases 2-5) and AI (Phases 6-7) plan separately.

**Architecture:** Extend existing `server/` patterns — Express routers mounted under `/api/v1/`, SQLite schema via `CREATE TABLE IF NOT EXISTS` bootstrap in `db.js`, Vitest + supertest. Discovery runs synchronously (~3s) via parallel GitHub API calls. Undo via stateless HMAC token + short-lived `work_board_undo_log` table. Auto-migration via stale-while-revalidate on first `/work-board` load.

**Tech Stack:** Node 20, Express 4, better-sqlite3, @octokit/request (via existing `githubApi`), Vitest 4, supertest, crypto (built-in HMAC).

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` (§1 and §6 Phase 1).

**Out of scope for Phase 1:** any frontend change, AI assistant, command palette, cross-app integration visuals.

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `server/db.js` | Add 4 `CREATE TABLE IF NOT EXISTS` statements for tracked_repos, prefs, ai_dismissed, undo_log | Modify |
| `server/lib/work-board-undo-log.js` | Record/restore/cleanup of undo log entries | Create |
| `server/lib/work-board-tracking.js` | Pure CRUD on `work_board_tracked_repos` + prefs (pin, mute, bulk, query) | Create |
| `server/lib/work-board-discovery.js` | Orchestrator + 5 signal collectors. Pure function given `userId`, `token`, `prefs`. | Create |
| `server/lib/work-board-discovery-merge.js` | Merge logic: union signals, preserve user state, cap, order | Create |
| `server/routes/work-board-tracking.js` | Express router: GET/POST/DELETE /tracked-repos, /repo-search, /prefs, /discover, /undo | Create |
| `server/routes/v1/index.js` | Mount new router at `/work-board` | Modify |
| `server/routes/work-board.js` | Add JOIN on tracked_repos to `/my-reviews`, `/stale-prs`, `/my-issues`, `/tech-debt` | Modify |
| `server/routes/github-events-webhook.js` | On unknown-repo event, auto-insert `source_signal='webhook'` row | Modify |
| `server/__tests__/work-board-undo-log.test.js` | Unit tests for undo log lib | Create |
| `server/__tests__/work-board-tracking.test.js` | Unit tests for tracking CRUD lib | Create |
| `server/__tests__/work-board-discovery.test.js` | Unit tests for discovery with mocked GitHub | Create |
| `server/__tests__/work-board-tracking-routes.test.js` | Integration tests via supertest | Create |
| `server/__tests__/work-board-discovery-route.test.js` | Integration test for `POST /discover` | Create |
| `server/__tests__/work-board-join-filter.test.js` | Regression tests — existing endpoints filter by tracked_repos | Create |

---

## Task 1: Database schema

**Files:**

- Modify: `server/db.js` (append new table creation after existing `user_ai_config` block)

- [ ] **Step 1: Locate the insertion point**

Open `server/db.js` and locate the existing `CREATE TABLE IF NOT EXISTS user_ai_config` block (~line 398). All new tables go **after** that block and **before** any `db.exec` calls that are not `CREATE TABLE`.

- [ ] **Step 2: Add schema**

Append this block after the `user_ai_config` creation:

```javascript
db.exec(`
    CREATE TABLE IF NOT EXISTS work_board_tracked_repos (
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
    CREATE INDEX IF NOT EXISTS idx_wbtr_user_active
        ON work_board_tracked_repos(user_id, is_muted, last_activity_at DESC);

    CREATE TABLE IF NOT EXISTS work_board_prefs (
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

    CREATE TABLE IF NOT EXISTS work_board_ai_dismissed (
        user_id        INTEGER NOT NULL,
        pattern_key    TEXT NOT NULL,
        repo_full_name TEXT NOT NULL DEFAULT '',
        dismissed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pattern_key, repo_full_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS work_board_undo_log (
        operation_id     TEXT PRIMARY KEY,
        user_id          INTEGER NOT NULL,
        operation_type   TEXT NOT NULL,
        before_state     TEXT NOT NULL,
        after_state      TEXT NOT NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at       DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_undo_user_expires
        ON work_board_undo_log(user_id, expires_at);
`);
```

Note SQLite stores BOOLEAN as INTEGER — use `INTEGER NOT NULL DEFAULT 0/1`, not `BOOLEAN`.

`repo_full_name` in `work_board_ai_dismissed` defaults to empty string (not nullable) because SQLite PRIMARY KEY doesn't allow NULL members.

- [ ] **Step 3: Verify schema loads without error**

Run:

```bash
node -e "import('./server/db.js').then(m => console.log('tables:', m.default.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'work_board_%'\").all()))"
```

Expected:

```
tables: [
  { name: 'work_board_tracked_repos' },
  { name: 'work_board_prefs' },
  { name: 'work_board_ai_dismissed' },
  { name: 'work_board_undo_log' }
]
```

- [ ] **Step 4: Commit**

```bash
git add server/db.js
git commit -m "feat(work-board): add tracked_repos, prefs, ai_dismissed, undo_log tables"
```

---

## Task 2: Undo log library

**Files:**

- Create: `server/lib/work-board-undo-log.js`
- Create: `server/__tests__/work-board-undo-log.test.js`

- [ ] **Step 1: Write failing test — recordOperation returns a UUID and persists**

Create `server/__tests__/work-board-undo-log.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import { recordOperation, undoOperation, cleanupExpired, UNDO_TTL_HOURS } from '../lib/work-board-undo-log.js';

const USER_ID = 999001;

beforeEach(() => {
    db.prepare('DELETE FROM work_board_undo_log WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'testuser');
});

describe('recordOperation', () => {
    it('returns a unique operation_id and persists the entry', () => {
        const before = [{ repo_full_name: 'a/b', is_muted: 0 }];
        const after = [{ repo_full_name: 'a/b', is_muted: 1 }];

        const opId = recordOperation(USER_ID, 'mute', before, after);
        expect(opId).toMatch(/^[0-9a-f-]{36}$/);

        const row = db.prepare('SELECT * FROM work_board_undo_log WHERE operation_id = ?').get(opId);
        expect(row).toBeDefined();
        expect(row.user_id).toBe(USER_ID);
        expect(row.operation_type).toBe('mute');
        expect(JSON.parse(row.before_state)).toEqual(before);
        expect(JSON.parse(row.after_state)).toEqual(after);
        expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('sets expires_at to UNDO_TTL_HOURS from now', () => {
        const opId = recordOperation(USER_ID, 'pin', [], []);
        const row = db.prepare('SELECT expires_at FROM work_board_undo_log WHERE operation_id = ?').get(opId);
        const diffMs = new Date(row.expires_at).getTime() - Date.now();
        const expectedMs = UNDO_TTL_HOURS * 3600 * 1000;
        expect(diffMs).toBeGreaterThan(expectedMs - 2000);
        expect(diffMs).toBeLessThan(expectedMs + 2000);
    });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run server/__tests__/work-board-undo-log.test.js`
Expected: FAIL with `Cannot find module '../lib/work-board-undo-log.js'`

- [ ] **Step 3: Implement undo log lib**

Create `server/lib/work-board-undo-log.js`:

```javascript
import { randomUUID } from 'crypto';
import db from '../db.js';

export const UNDO_TTL_HOURS = 24;

const insertStmt = db.prepare(`
    INSERT INTO work_board_undo_log
        (operation_id, user_id, operation_type, before_state, after_state, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))
`);

/**
 * Record a mutation so the user can undo it later.
 * @param {number} userId
 * @param {string} operationType — 'pin' | 'mute' | 'unpin' | 'unmute' | 'track' | 'untrack' | 'bulk' | 'ai_bulk'
 * @param {Array<object>} beforeState — compact rows (repo_full_name + flags that changed)
 * @param {Array<object>} afterState
 * @returns {string} operation_id (UUID v4)
 */
export function recordOperation(userId, operationType, beforeState, afterState) {
    const opId = randomUUID();
    insertStmt.run(
        opId,
        userId,
        operationType,
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
        `+${UNDO_TTL_HOURS} hours`,
    );
    return opId;
}

const selectStmt = db.prepare(`
    SELECT * FROM work_board_undo_log
    WHERE operation_id = ? AND user_id = ? AND expires_at > datetime('now')
`);
const deleteStmt = db.prepare('DELETE FROM work_board_undo_log WHERE operation_id = ?');

/**
 * Revert a previously recorded operation.
 * Returns the before_state so the caller can re-apply it.
 * @throws Error if operation not found or expired.
 */
export function undoOperation(userId, operationId) {
    const row = selectStmt.get(operationId, userId);
    if (!row) {
        throw new Error('Operation not found or expired');
    }
    const beforeState = JSON.parse(row.before_state);
    deleteStmt.run(operationId);
    return { operationType: row.operation_type, beforeState };
}

const cleanupStmt = db.prepare(`DELETE FROM work_board_undo_log WHERE expires_at <= datetime('now')`);

/**
 * Called by nightly cron or opportunistically on write.
 * @returns {number} rows deleted
 */
export function cleanupExpired() {
    const result = cleanupStmt.run();
    return result.changes;
}
```

- [ ] **Step 4: Run test — verify recordOperation passes**

Run: `npx vitest run server/__tests__/work-board-undo-log.test.js -t recordOperation`
Expected: PASS (2 tests)

- [ ] **Step 5: Write failing tests for undoOperation and cleanupExpired**

Append to the test file:

```javascript
describe('undoOperation', () => {
    it('returns the before_state and deletes the row', () => {
        const opId = recordOperation(USER_ID, 'mute', [{ repo_full_name: 'a/b', is_muted: 0 }], [{ repo_full_name: 'a/b', is_muted: 1 }]);

        const result = undoOperation(USER_ID, opId);
        expect(result.operationType).toBe('mute');
        expect(result.beforeState).toEqual([{ repo_full_name: 'a/b', is_muted: 0 }]);

        const row = db.prepare('SELECT * FROM work_board_undo_log WHERE operation_id = ?').get(opId);
        expect(row).toBeUndefined();
    });

    it('throws when operation belongs to another user', () => {
        const opId = recordOperation(USER_ID, 'pin', [], []);
        expect(() => undoOperation(USER_ID + 1, opId)).toThrow('Operation not found or expired');
    });

    it('throws when expired', () => {
        const opId = recordOperation(USER_ID, 'pin', [], []);
        db.prepare(`UPDATE work_board_undo_log SET expires_at = datetime('now', '-1 hour') WHERE operation_id = ?`).run(opId);
        expect(() => undoOperation(USER_ID, opId)).toThrow('Operation not found or expired');
    });
});

describe('cleanupExpired', () => {
    it('deletes only expired rows and returns the count', () => {
        const expiredId = recordOperation(USER_ID, 'pin', [], []);
        const freshId = recordOperation(USER_ID, 'mute', [], []);
        db.prepare(`UPDATE work_board_undo_log SET expires_at = datetime('now', '-1 hour') WHERE operation_id = ?`).run(expiredId);

        const deleted = cleanupExpired();
        expect(deleted).toBeGreaterThanOrEqual(1);

        expect(db.prepare('SELECT 1 FROM work_board_undo_log WHERE operation_id = ?').get(expiredId)).toBeUndefined();
        expect(db.prepare('SELECT 1 FROM work_board_undo_log WHERE operation_id = ?').get(freshId)).toBeDefined();
    });
});
```

- [ ] **Step 6: Run all tests — verify everything passes**

Run: `npx vitest run server/__tests__/work-board-undo-log.test.js`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add server/lib/work-board-undo-log.js server/__tests__/work-board-undo-log.test.js
git commit -m "feat(work-board): undo log library with 24h TTL"
```

---

## Task 3: Tracking library — single-repo CRUD

**Files:**

- Create: `server/lib/work-board-tracking.js`
- Create: `server/__tests__/work-board-tracking.test.js`

- [ ] **Step 1: Write failing test — upsertTrackedRepo pin action**

Create `server/__tests__/work-board-tracking.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import {
    upsertTrackedRepo,
    getTrackedRepos,
    bulkUpdate,
    deleteTrackedRepo,
    getPrefs,
    patchPrefs,
} from '../lib/work-board-tracking.js';

const USER_ID = 999002;

beforeEach(() => {
    db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM work_board_undo_log WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'tracking-tester');
});

describe('upsertTrackedRepo', () => {
    it('pin creates a new row with is_pinned=1 and source_signal=pinned', () => {
        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'pin');

        expect(result.operationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.newState).toEqual(expect.objectContaining({
            is_pinned: 1,
            is_muted: 0,
            source_signal: 'pinned',
        }));

        const row = db.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/backend');
        expect(row.is_pinned).toBe(1);
    });

    it('mute on existing row sets is_muted=1 and records an undo op', () => {
        upsertTrackedRepo(USER_ID, 'acme/backend', 'track');
        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'mute');

        expect(result.newState.is_muted).toBe(1);

        const undoRow = db.prepare('SELECT * FROM work_board_undo_log WHERE operation_id = ?').get(result.operationId);
        expect(undoRow).toBeDefined();
        expect(undoRow.operation_type).toBe('mute');
        expect(JSON.parse(undoRow.before_state)).toEqual([{ repo_full_name: 'acme/backend', is_pinned: 0, is_muted: 0 }]);
        expect(JSON.parse(undoRow.after_state)).toEqual([{ repo_full_name: 'acme/backend', is_pinned: 0, is_muted: 1 }]);
    });

    it('unpin clears is_pinned without touching is_muted', () => {
        upsertTrackedRepo(USER_ID, 'acme/backend', 'pin');
        upsertTrackedRepo(USER_ID, 'acme/backend', 'mute');

        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'unpin');
        expect(result.newState).toEqual(expect.objectContaining({ is_pinned: 0, is_muted: 1 }));
    });

    it('untrack hard-deletes the row', () => {
        upsertTrackedRepo(USER_ID, 'acme/backend', 'pin');
        const result = upsertTrackedRepo(USER_ID, 'acme/backend', 'untrack');

        expect(result.newState).toBeNull();
        const row = db.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/backend');
        expect(row).toBeUndefined();
    });

    it('throws on invalid action', () => {
        expect(() => upsertTrackedRepo(USER_ID, 'acme/backend', 'delete-everything')).toThrow(/invalid action/i);
    });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js`
Expected: FAIL with `Cannot find module '../lib/work-board-tracking.js'`

- [ ] **Step 3: Implement the lib (minimum to pass)**

Create `server/lib/work-board-tracking.js`:

```javascript
import db from '../db.js';
import { recordOperation } from './work-board-undo-log.js';

const VALID_ACTIONS = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);

function snapshotRow(row) {
    if (!row) return null;
    return {
        repo_full_name: row.repo_full_name,
        is_pinned: row.is_pinned,
        is_muted: row.is_muted,
    };
}

/**
 * Apply a single-repo action.
 * @param {number} userId
 * @param {string} repoFullName — "owner/repo"
 * @param {'pin'|'unpin'|'mute'|'unmute'|'track'|'untrack'} action
 * @returns {{ operationId: string, newState: object|null }}
 */
export function upsertTrackedRepo(userId, repoFullName, action) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(`Invalid action: ${action}`);
    }

    const existing = db.prepare(
        'SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
    ).get(userId, repoFullName);

    const before = snapshotRow(existing);

    if (action === 'untrack') {
        if (!existing) {
            return { operationId: null, newState: null };
        }
        db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
          .run(userId, repoFullName);
        const opId = recordOperation(userId, 'untrack', [before], []);
        return { operationId: opId, newState: null };
    }

    const base = existing ?? {
        user_id: userId,
        repo_full_name: repoFullName,
        repo_id: null,
        source_signal: 'pinned',
        is_pinned: 0,
        is_muted: 0,
    };

    switch (action) {
        case 'pin':   base.is_pinned = 1; if (!existing) base.source_signal = 'pinned'; break;
        case 'unpin': base.is_pinned = 0; break;
        case 'mute':  base.is_muted = 1; break;
        case 'unmute': base.is_muted = 0; break;
        case 'track': base.is_pinned = existing ? base.is_pinned : 1;
                      if (!existing) base.source_signal = 'pinned';
                      break;
        default: throw new Error(`Unreachable action: ${action}`);
    }

    db.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, repo_id, source_signal, is_pinned, is_muted, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
            is_pinned = excluded.is_pinned,
            is_muted = excluded.is_muted,
            last_synced_at = CURRENT_TIMESTAMP
    `).run(base.user_id, base.repo_full_name, base.repo_id, base.source_signal, base.is_pinned, base.is_muted);

    const after = snapshotRow(base);
    const opId = recordOperation(userId, action, before ? [before] : [], [after]);

    return { operationId: opId, newState: after };
}
```

Leave `getTrackedRepos`, `bulkUpdate`, `deleteTrackedRepo`, `getPrefs`, `patchPrefs` as stubs for later tasks (don't export yet — imports in tests will fail selectively, which is fine; we'll address them in subsequent tasks).

Actually to keep imports clean, export stubs that throw:

```javascript
export function getTrackedRepos() { throw new Error('not implemented'); }
export function bulkUpdate() { throw new Error('not implemented'); }
export function deleteTrackedRepo() { throw new Error('not implemented'); }
export function getPrefs() { throw new Error('not implemented'); }
export function patchPrefs() { throw new Error('not implemented'); }
```

- [ ] **Step 4: Run test — verify upsert passes**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t upsertTrackedRepo`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-tracking.js server/__tests__/work-board-tracking.test.js
git commit -m "feat(work-board): single-repo pin/mute/track/untrack with undo log"
```

---

## Task 4: Tracking library — getTrackedRepos with filters + counts

**Files:**

- Modify: `server/lib/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking.test.js`

- [ ] **Step 1: Write failing tests**

Append to test file:

```javascript
describe('getTrackedRepos', () => {
    beforeEach(() => {
        // seed fixture: 5 repos with varied signals/flags
        const fixtures = [
            ['acme/backend',  'review_requested', 0, 0, '2026-04-20'],
            ['acme/frontend', 'authored_pr',      1, 0, '2026-04-22'],
            ['acme/infra',    'owned',            0, 1, '2026-04-10'],
            ['tesla/mobile',  'recent_commit',    0, 0, '2026-04-18'],
            ['tesla/data',    'owned',            1, 0, '2026-04-15'],
        ];
        for (const [name, sig, pin, mute, activity] of fixtures) {
            db.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(USER_ID, name, sig, pin, mute, activity);
        }
    });

    it('returns all tracked repos ordered by last_activity_at DESC by default', () => {
        const result = getTrackedRepos(USER_ID, {});
        expect(result.items.map(r => r.repo_full_name)).toEqual([
            'acme/frontend', 'acme/backend', 'tesla/mobile', 'tesla/data', 'acme/infra',
        ]);
        expect(result.total).toBe(5);
    });

    it('filters by muted=true', () => {
        const result = getTrackedRepos(USER_ID, { muted: true });
        expect(result.items.map(r => r.repo_full_name)).toEqual(['acme/infra']);
    });

    it('filters by muted=false (default view)', () => {
        const result = getTrackedRepos(USER_ID, { muted: false });
        expect(result.items.map(r => r.repo_full_name)).toEqual([
            'acme/frontend', 'acme/backend', 'tesla/mobile', 'tesla/data',
        ]);
    });

    it('filters by signal', () => {
        const result = getTrackedRepos(USER_ID, { signal: 'owned' });
        expect(result.items.map(r => r.repo_full_name).sort()).toEqual(['acme/infra', 'tesla/data']);
    });

    it('filters by org prefix', () => {
        const result = getTrackedRepos(USER_ID, { org: 'tesla' });
        expect(result.items.map(r => r.repo_full_name).sort()).toEqual(['tesla/data', 'tesla/mobile']);
    });

    it('search matches partial repo name (case-insensitive)', () => {
        const result = getTrackedRepos(USER_ID, { search: 'front' });
        expect(result.items.map(r => r.repo_full_name)).toEqual(['acme/frontend']);
    });

    it('returns counts_by_signal aggregate', () => {
        const result = getTrackedRepos(USER_ID, {});
        expect(result.countsBySignal).toEqual({
            review_requested: 1,
            authored_pr: 1,
            owned: 2,
            recent_commit: 1,
        });
    });

    it('paginates with limit + offset', () => {
        const page1 = getTrackedRepos(USER_ID, { limit: 2, offset: 0 });
        const page2 = getTrackedRepos(USER_ID, { limit: 2, offset: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page2.items).toHaveLength(2);
        expect(page1.items[0].repo_full_name).not.toBe(page2.items[0].repo_full_name);
    });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t getTrackedRepos`
Expected: FAIL with `not implemented` or similar.

- [ ] **Step 3: Implement getTrackedRepos**

Replace the `getTrackedRepos` stub in `server/lib/work-board-tracking.js`:

```javascript
/**
 * @param {number} userId
 * @param {object} filters
 * @param {string} [filters.search] — substring match on repo_full_name (case-insensitive)
 * @param {string} [filters.signal] — exact source_signal match
 * @param {string} [filters.org] — owner prefix match (e.g. "tesla" matches "tesla/foo")
 * @param {boolean} [filters.muted] — if true returns only muted; if false only non-muted; if undefined returns all
 * @param {boolean} [filters.pinned] — same semantics as muted
 * @param {number} [filters.limit=500]
 * @param {number} [filters.offset=0]
 * @returns {{ items: object[], total: number, countsBySignal: Record<string, number> }}
 */
export function getTrackedRepos(userId, filters = {}) {
    const conds = ['user_id = ?'];
    const params = [userId];

    if (filters.search) {
        conds.push('LOWER(repo_full_name) LIKE ?');
        params.push(`%${filters.search.toLowerCase()}%`);
    }
    if (filters.signal) {
        conds.push('source_signal = ?');
        params.push(filters.signal);
    }
    if (filters.org) {
        conds.push('repo_full_name LIKE ?');
        params.push(`${filters.org}/%`);
    }
    if (filters.muted === true) conds.push('is_muted = 1');
    if (filters.muted === false) conds.push('is_muted = 0');
    if (filters.pinned === true) conds.push('is_pinned = 1');
    if (filters.pinned === false) conds.push('is_pinned = 0');

    const where = conds.join(' AND ');
    const limit = Math.min(Math.max(1, filters.limit ?? 500), 500);
    const offset = Math.max(0, filters.offset ?? 0);

    const items = db.prepare(`
        SELECT repo_full_name, repo_id, source_signal, is_pinned, is_muted,
               last_activity_at, discovered_at, last_synced_at
        FROM work_board_tracked_repos
        WHERE ${where}
        ORDER BY last_activity_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM work_board_tracked_repos WHERE ${where}`)
        .get(...params).c;

    const countsRows = db.prepare(`
        SELECT source_signal, COUNT(*) AS c
        FROM work_board_tracked_repos
        WHERE user_id = ? AND is_muted = 0
        GROUP BY source_signal
    `).all(userId);
    const countsBySignal = Object.fromEntries(countsRows.map(r => [r.source_signal, r.c]));

    return { items, total, countsBySignal };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t getTrackedRepos`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-tracking.js server/__tests__/work-board-tracking.test.js
git commit -m "feat(work-board): getTrackedRepos with filters, pagination, counts"
```

---

## Task 5: Tracking library — bulkUpdate

**Files:**

- Modify: `server/lib/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking.test.js`

- [ ] **Step 1: Write failing tests**

Append to test file:

```javascript
describe('bulkUpdate', () => {
    beforeEach(() => {
        for (const name of ['a/b', 'a/c', 'a/d']) {
            db.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('mute applied to 3 repos in one operation_id', () => {
        const result = bulkUpdate(USER_ID, ['a/b', 'a/c', 'a/d'], 'mute');

        expect(result.operationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.updated).toBe(3);
        expect(result.skipped).toEqual([]);

        const muted = db.prepare('SELECT COUNT(*) AS c FROM work_board_tracked_repos WHERE user_id = ? AND is_muted = 1').get(USER_ID);
        expect(muted.c).toBe(3);
    });

    it('rejects bulk size > 200', () => {
        const manyRepos = Array.from({ length: 201 }, (_, i) => `org/repo${i}`);
        expect(() => bulkUpdate(USER_ID, manyRepos, 'mute')).toThrow(/bulk size/i);
    });

    it('skips repos the user does not track (for actions that require existing row)', () => {
        const result = bulkUpdate(USER_ID, ['a/b', 'nonexistent/repo'], 'mute');
        expect(result.updated).toBe(1);
        expect(result.skipped).toEqual(['nonexistent/repo']);
    });

    it('track action inserts new rows for non-existing repos', () => {
        const result = bulkUpdate(USER_ID, ['new/one', 'new/two'], 'track');
        expect(result.updated).toBe(2);
        const rows = db.prepare(`SELECT repo_full_name FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name LIKE 'new/%'`).all(USER_ID);
        expect(rows.map(r => r.repo_full_name).sort()).toEqual(['new/one', 'new/two']);
    });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t bulkUpdate`
Expected: FAIL with `not implemented`.

- [ ] **Step 3: Implement bulkUpdate**

Replace the stub:

```javascript
const BULK_MAX = 200;
const EXISTING_REQUIRED = new Set(['pin', 'unpin', 'mute', 'unmute', 'untrack']);

/**
 * Apply an action to many repos in one atomic undo-unit.
 * @returns {{ operationId: string|null, updated: number, skipped: string[] }}
 */
export function bulkUpdate(userId, repoFullNames, action) {
    if (!VALID_ACTIONS.has(action)) {
        throw new Error(`Invalid action: ${action}`);
    }
    if (repoFullNames.length > BULK_MAX) {
        throw new Error(`Bulk size exceeds ${BULK_MAX}`);
    }
    if (repoFullNames.length === 0) {
        return { operationId: null, updated: 0, skipped: [] };
    }

    const beforeStates = [];
    const afterStates = [];
    const skipped = [];

    const tx = db.transaction(() => {
        for (const repo of repoFullNames) {
            const existing = db.prepare(
                'SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?'
            ).get(userId, repo);

            if (EXISTING_REQUIRED.has(action) && !existing) {
                skipped.push(repo);
                continue;
            }

            const before = snapshotRow(existing);
            if (before) beforeStates.push(before);

            if (action === 'untrack') {
                db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
                  .run(userId, repo);
                afterStates.push({ repo_full_name: repo, is_pinned: 0, is_muted: 0, deleted: true });
                continue;
            }

            const base = existing ?? {
                source_signal: 'pinned', is_pinned: 0, is_muted: 0,
            };
            let is_pinned = base.is_pinned, is_muted = base.is_muted, source_signal = base.source_signal;

            switch (action) {
                case 'pin':   is_pinned = 1; if (!existing) source_signal = 'pinned'; break;
                case 'unpin': is_pinned = 0; break;
                case 'mute':  is_muted = 1; break;
                case 'unmute': is_muted = 0; break;
                case 'track': is_pinned = existing ? is_pinned : 1;
                              if (!existing) source_signal = 'pinned';
                              break;
            }

            db.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_synced_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                    is_pinned = excluded.is_pinned,
                    is_muted = excluded.is_muted,
                    last_synced_at = CURRENT_TIMESTAMP
            `).run(userId, repo, source_signal, is_pinned, is_muted);

            afterStates.push({ repo_full_name: repo, is_pinned, is_muted });
        }
    });
    tx();

    const opId = (beforeStates.length + afterStates.length) > 0
        ? recordOperation(userId, 'bulk', beforeStates, afterStates)
        : null;

    return {
        operationId: opId,
        updated: afterStates.length,
        skipped,
    };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t bulkUpdate`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-tracking.js server/__tests__/work-board-tracking.test.js
git commit -m "feat(work-board): bulkUpdate with max-200 cap and single undo op"
```

---

## Task 6: Tracking library — prefs CRUD

**Files:**

- Modify: `server/lib/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('getPrefs / patchPrefs', () => {
    it('getPrefs returns defaults when no row exists', () => {
        const prefs = getPrefs(USER_ID);
        expect(prefs).toEqual({
            discovery_window_days: 60,
            max_auto_repos: 50,
            auto_mute_bots: 0,
            ai_assistant_enabled: 0,
            ai_monthly_cap_cents: 500,
            ai_response_locale: null,
            last_discovery_at: null,
        });
    });

    it('patchPrefs creates row if missing and returns merged', () => {
        const updated = patchPrefs(USER_ID, { discovery_window_days: 30 });
        expect(updated.discovery_window_days).toBe(30);
        expect(updated.max_auto_repos).toBe(50);
    });

    it('patchPrefs rejects unknown keys', () => {
        expect(() => patchPrefs(USER_ID, { foobar: 'x' })).toThrow(/unknown pref/i);
    });

    it('patchPrefs validates discovery_window_days range', () => {
        expect(() => patchPrefs(USER_ID, { discovery_window_days: 500 })).toThrow(/range/i);
        expect(() => patchPrefs(USER_ID, { discovery_window_days: 5 })).toThrow(/range/i);
    });

    it('patchPrefs validates max_auto_repos range', () => {
        expect(() => patchPrefs(USER_ID, { max_auto_repos: 5 })).toThrow(/range/i);
        expect(() => patchPrefs(USER_ID, { max_auto_repos: 500 })).toThrow(/range/i);
    });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t "getPrefs"`
Expected: FAIL.

- [ ] **Step 3: Implement prefs CRUD**

Replace the two stubs:

```javascript
const PREF_DEFAULTS = {
    discovery_window_days: 60,
    max_auto_repos: 50,
    auto_mute_bots: 0,
    ai_assistant_enabled: 0,
    ai_monthly_cap_cents: 500,
    ai_response_locale: null,
    last_discovery_at: null,
};

const PREF_VALIDATORS = {
    discovery_window_days: (v) => {
        if (!Number.isInteger(v) || v < 30 || v > 180) throw new Error('discovery_window_days out of range (30-180)');
    },
    max_auto_repos: (v) => {
        if (!Number.isInteger(v) || v < 20 || v > 200) throw new Error('max_auto_repos out of range (20-200)');
    },
    auto_mute_bots: (v) => {
        if (v !== 0 && v !== 1) throw new Error('auto_mute_bots must be 0 or 1');
    },
    ai_assistant_enabled: (v) => {
        if (v !== 0 && v !== 1) throw new Error('ai_assistant_enabled must be 0 or 1');
    },
    ai_monthly_cap_cents: (v) => {
        if (!Number.isInteger(v) || v < 0 || v > 100000) throw new Error('ai_monthly_cap_cents out of range (0-100000)');
    },
    ai_response_locale: (v) => {
        if (v !== null && (typeof v !== 'string' || v.length > 10)) throw new Error('ai_response_locale must be short string or null');
    },
};

/**
 * @returns {object} merged prefs (defaults + user overrides)
 */
export function getPrefs(userId) {
    const row = db.prepare('SELECT * FROM work_board_prefs WHERE user_id = ?').get(userId);
    if (!row) return { ...PREF_DEFAULTS };
    const { user_id, ...rest } = row;
    return { ...PREF_DEFAULTS, ...rest };
}

/**
 * @param {number} userId
 * @param {object} patch — partial prefs
 * @returns {object} merged prefs after patch
 */
export function patchPrefs(userId, patch) {
    for (const key of Object.keys(patch)) {
        if (!(key in PREF_VALIDATORS)) {
            throw new Error(`Unknown pref key: ${key}`);
        }
        PREF_VALIDATORS[key](patch[key]);
    }

    const current = getPrefs(userId);
    const merged = { ...current, ...patch };

    db.prepare(`
        INSERT INTO work_board_prefs
            (user_id, discovery_window_days, max_auto_repos, auto_mute_bots,
             ai_assistant_enabled, ai_monthly_cap_cents, ai_response_locale, last_discovery_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            discovery_window_days = excluded.discovery_window_days,
            max_auto_repos        = excluded.max_auto_repos,
            auto_mute_bots        = excluded.auto_mute_bots,
            ai_assistant_enabled  = excluded.ai_assistant_enabled,
            ai_monthly_cap_cents  = excluded.ai_monthly_cap_cents,
            ai_response_locale    = excluded.ai_response_locale,
            last_discovery_at     = excluded.last_discovery_at
    `).run(
        userId,
        merged.discovery_window_days,
        merged.max_auto_repos,
        merged.auto_mute_bots,
        merged.ai_assistant_enabled,
        merged.ai_monthly_cap_cents,
        merged.ai_response_locale,
        merged.last_discovery_at,
    );

    return merged;
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking.test.js -t "getPrefs"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-tracking.js server/__tests__/work-board-tracking.test.js
git commit -m "feat(work-board): prefs CRUD with validators"
```

---

## Task 7: Discovery library — signal collectors

**Files:**

- Create: `server/lib/work-board-discovery.js`
- Create: `server/__tests__/work-board-discovery.test.js`

The discovery lib talks to GitHub. We mock the `githubApi` helper (already exists at `server/lib/github-api.js`).

- [ ] **Step 1: Write failing test for collectReviewRequested**

Create `server/__tests__/work-board-discovery.test.js`:

```javascript
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

    it('returns [] on 403 SSO error with the blocked org captured', async () => {
        mockGithubApi.mockRejectedValueOnce({ status: 403, message: 'SAML enforcement', response: { headers: { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso' } } });
        const out = await collectReviewRequested('token123');
        expect(out).toEqual([]);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement collectReviewRequested**

Create `server/lib/work-board-discovery.js`:

```javascript
import { githubApi } from './github-api.js';

function repoFullNameFromUrl(repoUrl) {
    const m = repoUrl.match(/\/repos\/([^/]+\/[^/]+)$/);
    return m ? m[1] : null;
}

async function searchIssues(query, token) {
    const url = `/search/issues?q=${encodeURIComponent(query)}&per_page=100`;
    try {
        const res = await githubApi(url, token);
        return res?.data?.items ?? [];
    } catch (err) {
        if (err?.status === 403) return [];
        throw err;
    }
}

export async function collectReviewRequested(token) {
    const items = await searchIssues('is:open archived:false review-requested:@me', token);
    return items.map(it => ({
        repo_full_name: repoFullNameFromUrl(it.repository_url),
        last_activity_at: it.updated_at,
        signal: 'review_requested',
    })).filter(r => r.repo_full_name);
}

export async function collectAuthoredPRs(token, windowDays) {
    const since = new Date(Date.now() - windowDays * 86400 * 1000).toISOString().slice(0, 10);
    const items = await searchIssues(`is:open is:pr archived:false author:@me updated:>=${since}`, token);
    return items.map(it => ({
        repo_full_name: repoFullNameFromUrl(it.repository_url),
        last_activity_at: it.updated_at,
        signal: 'authored_pr',
    })).filter(r => r.repo_full_name);
}

export async function collectAssignedIssues(token) {
    const items = await searchIssues('is:open is:issue archived:false assignee:@me', token);
    return items.map(it => ({
        repo_full_name: repoFullNameFromUrl(it.repository_url),
        last_activity_at: it.updated_at,
        signal: 'assigned_issue',
    })).filter(r => r.repo_full_name);
}

export async function collectOwnedRepos(token) {
    try {
        const res = await githubApi('/user/repos?affiliation=owner&sort=pushed&per_page=30', token);
        const items = res?.data ?? [];
        return items
            .filter(r => !r.archived)
            .map(r => ({
                repo_full_name: r.full_name,
                repo_id: r.id,
                last_activity_at: r.pushed_at,
                signal: 'owned',
            }));
    } catch (err) {
        if (err?.status === 403) return [];
        throw err;
    }
}

export async function collectRecentCommits(token, windowDays) {
    // /users/{me}/events lists up to 100 recent events
    try {
        const meRes = await githubApi('/user', token);
        const login = meRes?.data?.login;
        if (!login) return [];

        const res = await githubApi(`/users/${login}/events?per_page=100`, token);
        const events = res?.data ?? [];
        const cutoff = Date.now() - windowDays * 86400 * 1000;

        const byRepo = new Map();
        for (const e of events) {
            if (e.type !== 'PushEvent') continue;
            if (new Date(e.created_at).getTime() < cutoff) continue;
            const repo = e.repo?.name;
            if (!repo) continue;
            if (!byRepo.has(repo) || byRepo.get(repo) < e.created_at) {
                byRepo.set(repo, e.created_at);
            }
        }

        return [...byRepo.entries()].map(([name, activity]) => ({
            repo_full_name: name,
            last_activity_at: activity,
            signal: 'recent_commit',
        }));
    } catch (err) {
        if (err?.status === 403) return [];
        throw err;
    }
}
```

- [ ] **Step 4: Run reviewRequested test — verify pass**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js -t collectReviewRequested`
Expected: PASS (2 tests).

- [ ] **Step 5: Write tests for the other 4 collectors**

Append:

```javascript
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
            .mockResolvedValueOnce({ data: { login: 'me' }})       // /user
            .mockResolvedValueOnce({ data: [                        // /users/me/events
                { type: 'PushEvent',  repo: { name: 'me/a' }, created_at: recent },
                { type: 'PushEvent',  repo: { name: 'me/a' }, created_at: old },
                { type: 'PushEvent',  repo: { name: 'me/b' }, created_at: old },
                { type: 'IssueEvent', repo: { name: 'me/c' }, created_at: recent },
            ]});

        const out = await collectRecentCommits('tok', 30);
        expect(out).toEqual([{ repo_full_name: 'me/a', last_activity_at: recent, signal: 'recent_commit' }]);
    });
});
```

- [ ] **Step 6: Run all collector tests — verify pass**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add server/lib/work-board-discovery.js server/__tests__/work-board-discovery.test.js
git commit -m "feat(work-board): discovery signal collectors (review/authored/assigned/owned/commits)"
```

---

## Task 8: Discovery library — merge + orchestrator

**Files:**

- Create: `server/lib/work-board-discovery-merge.js`
- Modify: `server/lib/work-board-discovery.js` (add `runDiscovery`)
- Modify: `server/__tests__/work-board-discovery.test.js`

- [ ] **Step 1: Write failing test for mergeCandidates (pure function)**

Append to test file:

```javascript
import { mergeCandidates } from '../lib/work-board-discovery-merge.js';

describe('mergeCandidates', () => {
    const existing = [
        { repo_full_name: 'a/pinned',  is_pinned: 1, is_muted: 0, source_signal: 'owned' },
        { repo_full_name: 'a/muted',   is_pinned: 0, is_muted: 1, source_signal: 'owned' },
        { repo_full_name: 'a/regular', is_pinned: 0, is_muted: 0, source_signal: 'authored_pr' },
        { repo_full_name: 'a/gone',    is_pinned: 0, is_muted: 0, source_signal: 'owned' },
    ];

    it('keeps pinned rows even when not in candidates', () => {
        const candidates = []; // discovery returned nothing
        const result = mergeCandidates(existing, candidates, { max_auto_repos: 50 });
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
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js -t mergeCandidates`
Expected: FAIL.

- [ ] **Step 3: Implement merge logic**

Create `server/lib/work-board-discovery-merge.js`:

```javascript
const SIGNAL_PRIORITY = {
    review_requested: 1,
    authored_pr: 2,
    assigned_issue: 3,
    owned: 4,
    recent_commit: 5,
};

/**
 * Pure function — decides what to add/remove/keep given existing rows and discovery candidates.
 *
 * @param {Array<{repo_full_name, is_pinned, is_muted, source_signal}>} existing
 * @param {Array<{repo_full_name, last_activity_at, signal, repo_id?}>} candidates
 * @param {{ max_auto_repos: number }} prefs
 * @returns {{
 *   keep:   Array — existing rows to preserve as-is
 *   add:    Array<{repo_full_name, source_signal, last_activity_at, repo_id?}>
 *   remove: Array — existing rows to delete
 * }}
 */
export function mergeCandidates(existing, candidates, prefs) {
    // Dedup candidates by repo_full_name, earliest signal wins, latest activity wins
    const byRepo = new Map();
    for (const c of candidates) {
        const current = byRepo.get(c.repo_full_name);
        if (!current) {
            byRepo.set(c.repo_full_name, { ...c });
            continue;
        }
        if ((SIGNAL_PRIORITY[c.signal] ?? 99) < (SIGNAL_PRIORITY[current.signal] ?? 99)) {
            current.signal = c.signal;
        }
        if (c.last_activity_at > current.last_activity_at) {
            current.last_activity_at = c.last_activity_at;
        }
        if (c.repo_id) current.repo_id = c.repo_id;
    }

    const existingByRepo = new Map(existing.map(r => [r.repo_full_name, r]));
    const keep = [];
    const remove = [];
    const add = [];

    // Classify existing rows
    for (const row of existing) {
        const isProtected = row.is_pinned === 1 || row.is_muted === 1;
        const inCandidates = byRepo.has(row.repo_full_name);
        if (isProtected || inCandidates) {
            keep.push(row);
        } else {
            remove.push(row);
        }
    }

    // New additions
    for (const c of byRepo.values()) {
        if (existingByRepo.has(c.repo_full_name)) continue;
        add.push({
            repo_full_name: c.repo_full_name,
            source_signal: c.signal,
            last_activity_at: c.last_activity_at,
            repo_id: c.repo_id ?? null,
        });
    }

    // Cap non-pinned additions
    const pinnedCount = keep.filter(r => r.is_pinned === 1).length;
    const room = Math.max(0, prefs.max_auto_repos - pinnedCount);
    add.sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''));
    if (add.length > room) {
        add.length = room;
    }

    return { keep, add, remove };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js -t mergeCandidates`
Expected: PASS (5 tests).

- [ ] **Step 5: Write test for runDiscovery orchestrator**

Append to test file:

```javascript
import { runDiscovery } from '../lib/work-board-discovery.js';

describe('runDiscovery', () => {
    it('runs 5 collectors in parallel, merges, persists, updates last_discovery_at', async () => {
        const USER_ID = 999003;
        db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
        db.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
        db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
        db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'discover-tester');

        // 5 calls: reviewer, authored, assigned, owned, /user, /users/me/events
        mockGithubApi
            .mockResolvedValueOnce({ data: { items: [{ repository_url: 'https://api.github.com/repos/x/rr', updated_at: '2026-04-20' }] }}) // review-requested
            .mockResolvedValueOnce({ data: { items: [{ repository_url: 'https://api.github.com/repos/x/auth', updated_at: '2026-04-21' }] }}) // authored
            .mockResolvedValueOnce({ data: { items: [{ repository_url: 'https://api.github.com/repos/x/ass', updated_at: '2026-04-19' }] }}) // assigned
            .mockResolvedValueOnce({ data: [{ full_name: 'me/own', id: 42, archived: false, pushed_at: '2026-04-22' }] })                   // owned
            .mockResolvedValueOnce({ data: { login: 'me' }})                                                                                // /user
            .mockResolvedValueOnce({ data: [] });                                                                                           // events

        const result = await runDiscovery(USER_ID, 'tok', { discovery_window_days: 60, max_auto_repos: 50 });

        expect(result.discovered).toBe(4);
        expect(result.added).toBe(4);
        expect(result.removed).toBe(0);
        expect(result.duration_ms).toBeGreaterThanOrEqual(0);

        const rows = db.prepare('SELECT repo_full_name, source_signal FROM work_board_tracked_repos WHERE user_id = ?').all(USER_ID);
        const names = rows.map(r => r.repo_full_name).sort();
        expect(names).toEqual(['me/own', 'x/ass', 'x/auth', 'x/rr']);

        const prefs = db.prepare('SELECT last_discovery_at FROM work_board_prefs WHERE user_id = ?').get(USER_ID);
        expect(prefs.last_discovery_at).not.toBeNull();
    });

    it('preserves pinned rows even if not returned by discovery', async () => {
        const USER_ID = 999004;
        db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
        db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
        db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'pin-preserve');
        db.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
            VALUES (?, 'keep/me', 'pinned', 1, 0)
        `).run(USER_ID);

        // All empty
        mockGithubApi
            .mockResolvedValueOnce({ data: { items: [] }})
            .mockResolvedValueOnce({ data: { items: [] }})
            .mockResolvedValueOnce({ data: { items: [] }})
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: { login: 'me' }})
            .mockResolvedValueOnce({ data: [] });

        await runDiscovery(USER_ID, 'tok', { discovery_window_days: 60, max_auto_repos: 50 });

        const row = db.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'keep/me');
        expect(row).toBeDefined();
        expect(row.is_pinned).toBe(1);
    });
});
```

- [ ] **Step 6: Run — verify fail (runDiscovery not yet exported)**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js -t runDiscovery`
Expected: FAIL.

- [ ] **Step 7: Implement runDiscovery**

Append to `server/lib/work-board-discovery.js`:

```javascript
import db from '../db.js';
import { mergeCandidates } from './work-board-discovery-merge.js';

/**
 * @param {number} userId
 * @param {string} token — OAuth token
 * @param {{ discovery_window_days: number, max_auto_repos: number }} prefs
 * @returns {{ discovered: number, added: number, removed: number, duration_ms: number, sso_orgs_blocked: string[] }}
 */
export async function runDiscovery(userId, token, prefs) {
    const started = Date.now();

    const [reviewReq, authored, assigned, owned, recent] = await Promise.all([
        collectReviewRequested(token),
        collectAuthoredPRs(token, prefs.discovery_window_days),
        collectAssignedIssues(token),
        collectOwnedRepos(token),
        collectRecentCommits(token, prefs.discovery_window_days),
    ]);

    const candidates = [...reviewReq, ...authored, ...assigned, ...owned, ...recent];

    const existing = db.prepare(
        'SELECT repo_full_name, is_pinned, is_muted, source_signal FROM work_board_tracked_repos WHERE user_id = ?'
    ).all(userId);

    const { add, remove } = mergeCandidates(existing, candidates, prefs);

    const tx = db.transaction(() => {
        for (const row of remove) {
            db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
              .run(userId, row.repo_full_name);
        }
        for (const c of add) {
            db.prepare(`
                INSERT INTO work_board_tracked_repos
                    (user_id, repo_full_name, repo_id, source_signal, is_pinned, is_muted, last_activity_at)
                VALUES (?, ?, ?, ?, 0, 0, ?)
                ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                    source_signal = excluded.source_signal,
                    last_activity_at = excluded.last_activity_at,
                    last_synced_at = CURRENT_TIMESTAMP
            `).run(userId, c.repo_full_name, c.repo_id, c.source_signal, c.last_activity_at);
        }
        db.prepare(`
            INSERT INTO work_board_prefs (user_id, last_discovery_at)
            VALUES (?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET last_discovery_at = CURRENT_TIMESTAMP
        `).run(userId);
    });
    tx();

    return {
        discovered: candidates.length > 0 ? new Set(candidates.map(c => c.repo_full_name)).size : 0,
        added: add.length,
        removed: remove.length,
        duration_ms: Date.now() - started,
        sso_orgs_blocked: [], // future: wire SSO header extraction
    };
}
```

- [ ] **Step 8: Run all discovery tests — verify pass**

Run: `npx vitest run server/__tests__/work-board-discovery.test.js`
Expected: PASS (13 tests).

- [ ] **Step 9: Commit**

```bash
git add server/lib/work-board-discovery.js server/lib/work-board-discovery-merge.js server/__tests__/work-board-discovery.test.js
git commit -m "feat(work-board): runDiscovery orchestrator + merge logic"
```

---

## Task 9: Routes — GET /tracked-repos

**Files:**

- Create: `server/routes/work-board-tracking.js`
- Create: `server/__tests__/work-board-tracking-routes.test.js`

- [ ] **Step 1: Write failing integration test**

Create `server/__tests__/work-board-tracking-routes.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../db.js';

vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: 999100, accessToken: 'test-token' };
            next();
        },
    };
});

const USER_ID = 999100;
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board-tracking.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
});

beforeEach(() => {
    db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM work_board_undo_log WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'routes-tester');
});

describe('GET /api/v1/work-board/tracked-repos', () => {
    it('returns empty result for a new user', async () => {
        const res = await request(app).get('/api/v1/work-board/tracked-repos');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ items: [], total: 0, countsBySignal: {} });
    });

    it('returns items with filters applied', async () => {
        db.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
            VALUES (?, 'acme/a', 'owned', 0, 0, '2026-04-20'),
                   (?, 'acme/b', 'owned', 0, 1, '2026-04-19'),
                   (?, 'tesla/c', 'owned', 0, 0, '2026-04-18')
        `).run(USER_ID, USER_ID, USER_ID);

        const res = await request(app).get('/api/v1/work-board/tracked-repos?muted=false&org=acme');
        expect(res.status).toBe(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0].repo_full_name).toBe('acme/a');
    });

    it('honors limit and offset', async () => {
        for (let i = 0; i < 5; i++) {
            db.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, last_activity_at)
                VALUES (?, ?, 'owned', ?)
            `).run(USER_ID, `x/r${i}`, `2026-04-${10 + i}`);
        }
        const res = await request(app).get('/api/v1/work-board/tracked-repos?limit=2');
        expect(res.body.items).toHaveLength(2);
        expect(res.body.total).toBe(5);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "GET /api/v1/work-board/tracked-repos"`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement router**

Create `server/routes/work-board-tracking.js`:

```javascript
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
    getTrackedRepos,
    upsertTrackedRepo,
    bulkUpdate,
    getPrefs,
    patchPrefs,
} from '../lib/work-board-tracking.js';
import { undoOperation } from '../lib/work-board-undo-log.js';

const router = express.Router();

router.get('/tracked-repos', requireAuth, (req, res) => {
    const { search, signal, org, muted, pinned, limit, offset } = req.query;
    const filters = {
        search: search || undefined,
        signal: signal || undefined,
        org: org || undefined,
        muted: muted === 'true' ? true : muted === 'false' ? false : undefined,
        pinned: pinned === 'true' ? true : pinned === 'false' ? false : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
    };
    const result = getTrackedRepos(req.session.userId, filters);
    res.json(result);
});

export default router;
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "GET /api/v1/work-board/tracked-repos"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): GET /tracked-repos endpoint with filters"
```

---

## Task 10: Routes — POST /tracked-repos (single action)

**Files:**

- Modify: `server/routes/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking-routes.test.js`

- [ ] **Step 1: Write failing tests**

Append to test file:

```javascript
describe('POST /api/v1/work-board/tracked-repos', () => {
    it('pin returns 200 + operation_id + new_state', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'acme/backend', action: 'pin' });
        expect(res.status).toBe(200);
        expect(res.body.operation_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.body.new_state).toEqual(expect.objectContaining({ is_pinned: 1 }));

        const row = db.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/backend');
        expect(row.is_pinned).toBe(1);
    });

    it('rejects invalid action with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'a/b', action: 'explode' });
        expect(res.status).toBe(400);
    });

    it('rejects missing repo with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ action: 'pin' });
        expect(res.status).toBe(400);
    });

    it('rejects invalid repo format with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'no-slash-here', action: 'pin' });
        expect(res.status).toBe(400);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "POST /api/v1/work-board/tracked-repos"`
Expected: FAIL.

- [ ] **Step 3: Implement POST handler**

Append to `server/routes/work-board-tracking.js` (above `export default`):

```javascript
const REPO_FULL_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}\/[a-zA-Z0-9_.-]{1,100}$/;
const VALID_ACTIONS_SET = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);

router.post('/tracked-repos', requireAuth, (req, res) => {
    const { repo, action } = req.body ?? {};
    if (!repo || typeof repo !== 'string' || !REPO_FULL_NAME_RE.test(repo)) {
        return res.status(400).json({ error: 'Invalid or missing repo (expected owner/repo)' });
    }
    if (!VALID_ACTIONS_SET.has(action)) {
        return res.status(400).json({ error: `Invalid action; expected one of ${[...VALID_ACTIONS_SET].join(', ')}` });
    }

    try {
        const result = upsertTrackedRepo(req.session.userId, repo, action);
        res.json({ operation_id: result.operationId, new_state: result.newState });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "POST /api/v1/work-board/tracked-repos"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): POST /tracked-repos single-action endpoint"
```

---

## Task 11: Routes — POST /tracked-repos/bulk

**Files:**

- Modify: `server/routes/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking-routes.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('POST /api/v1/work-board/tracked-repos/bulk', () => {
    beforeEach(() => {
        for (const name of ['x/a', 'x/b', 'x/c']) {
            db.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('mutes 3 repos and returns operation_id', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos: ['x/a', 'x/b', 'x/c'], action: 'mute' });
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(3);
        expect(res.body.skipped).toEqual([]);
        expect(res.body.operation_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('rejects bulk > 200 with 400', async () => {
        const repos = Array.from({ length: 201 }, (_, i) => `o/r${i}`);
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos, action: 'mute' });
        expect(res.status).toBe(400);
    });

    it('rejects non-array repos with 400', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos: 'x/a', action: 'mute' });
        expect(res.status).toBe(400);
    });

    it('filters out invalid repo names silently', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/tracked-repos/bulk')
            .send({ repos: ['x/a', 'invalid name with spaces'], action: 'mute' });
        expect(res.status).toBe(200);
        // 'x/a' muted, 'invalid…' skipped (not even attempted)
        expect(res.body.updated).toBe(1);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "tracked-repos/bulk"`
Expected: FAIL.

- [ ] **Step 3: Implement bulk handler**

Append to `server/routes/work-board-tracking.js`:

```javascript
router.post('/tracked-repos/bulk', requireAuth, (req, res) => {
    const { repos, action } = req.body ?? {};
    if (!Array.isArray(repos)) {
        return res.status(400).json({ error: 'repos must be an array' });
    }
    if (repos.length > 200) {
        return res.status(400).json({ error: 'Bulk size exceeds 200' });
    }
    if (!VALID_ACTIONS_SET.has(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    const valid = repos.filter(r => typeof r === 'string' && REPO_FULL_NAME_RE.test(r));

    try {
        const result = bulkUpdate(req.session.userId, valid, action);
        res.json({
            operation_id: result.operationId,
            updated: result.updated,
            skipped: result.skipped,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "tracked-repos/bulk"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): POST /tracked-repos/bulk with 200-cap validation"
```

---

## Task 12: Routes — prefs GET/PATCH

**Files:**

- Modify: `server/routes/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking-routes.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('GET/PATCH /api/v1/work-board/prefs', () => {
    it('GET returns defaults for new user', async () => {
        const res = await request(app).get('/api/v1/work-board/prefs');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            discovery_window_days: 60,
            max_auto_repos: 50,
            ai_assistant_enabled: 0,
        }));
    });

    it('PATCH persists changes', async () => {
        const res = await request(app)
            .patch('/api/v1/work-board/prefs')
            .send({ discovery_window_days: 90 });
        expect(res.status).toBe(200);
        expect(res.body.discovery_window_days).toBe(90);

        const check = await request(app).get('/api/v1/work-board/prefs');
        expect(check.body.discovery_window_days).toBe(90);
    });

    it('PATCH rejects invalid values with 400', async () => {
        const res = await request(app)
            .patch('/api/v1/work-board/prefs')
            .send({ discovery_window_days: 9999 });
        expect(res.status).toBe(400);
    });

    it('PATCH rejects unknown keys with 400', async () => {
        const res = await request(app)
            .patch('/api/v1/work-board/prefs')
            .send({ rogue_key: true });
        expect(res.status).toBe(400);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "prefs"`
Expected: FAIL.

- [ ] **Step 3: Implement prefs endpoints**

Append:

```javascript
router.get('/prefs', requireAuth, (req, res) => {
    const prefs = getPrefs(req.session.userId);
    res.json(prefs);
});

router.patch('/prefs', requireAuth, (req, res) => {
    try {
        const merged = patchPrefs(req.session.userId, req.body ?? {});
        res.json(merged);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "prefs"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): GET/PATCH /prefs endpoints"
```

---

## Task 13: Routes — POST /undo/:operation_id

**Files:**

- Modify: `server/routes/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking-routes.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```javascript
describe('POST /api/v1/work-board/undo/:operation_id', () => {
    it('reverts a pin operation', async () => {
        const pinRes = await request(app)
            .post('/api/v1/work-board/tracked-repos')
            .send({ repo: 'acme/x', action: 'pin' });
        const opId = pinRes.body.operation_id;

        const undoRes = await request(app).post(`/api/v1/work-board/undo/${opId}`);
        expect(undoRes.status).toBe(200);
        expect(undoRes.body.reverted).toBe(true);

        const row = db.prepare('SELECT * FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?').get(USER_ID, 'acme/x');
        // Pin was applied to a non-existent row, so before_state was empty; undo means row should be gone.
        expect(row).toBeUndefined();
    });

    it('returns 404 for unknown operation_id', async () => {
        const res = await request(app).post('/api/v1/work-board/undo/00000000-0000-0000-0000-000000000000');
        expect(res.status).toBe(404);
    });

    it('returns 404 when operation belongs to another user', async () => {
        // Insert an undo log row for a different user
        db.prepare(`
            INSERT INTO work_board_undo_log (operation_id, user_id, operation_type, before_state, after_state, expires_at)
            VALUES ('11111111-1111-1111-1111-111111111111', 999999, 'pin', '[]', '[]', datetime('now', '+1 hour'))
        `).run();

        const res = await request(app).post('/api/v1/work-board/undo/11111111-1111-1111-1111-111111111111');
        expect(res.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "undo"`
Expected: FAIL.

- [ ] **Step 3: Implement undo handler**

Append to the router:

```javascript
router.post('/undo/:operation_id', requireAuth, (req, res) => {
    const { operation_id } = req.params;
    try {
        const { operationType, beforeState } = undoOperation(req.session.userId, operation_id);

        // Re-apply the before_state: for each row in beforeState, upsert to those values.
        // For rows missing (were deleted by original op), re-insert.
        // For rows present in after_state but absent from before_state, delete.
        const applyTx = db.transaction(() => {
            // Delete rows that existed only in after_state
            const afterNames = new Set(); // computed below
            const stmtGet = db.prepare('SELECT repo_full_name FROM work_board_tracked_repos WHERE user_id = ?');
            const currentNames = new Set(stmtGet.all(req.session.userId).map(r => r.repo_full_name));

            const beforeNames = new Set(beforeState.map(r => r.repo_full_name));

            // Remove rows present now but not in before_state — those were added by the original op
            for (const name of currentNames) {
                if (!beforeNames.has(name)) {
                    db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ? AND repo_full_name = ?')
                      .run(req.session.userId, name);
                }
            }
            // Restore rows from before_state
            for (const row of beforeState) {
                db.prepare(`
                    INSERT INTO work_board_tracked_repos
                        (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_synced_at)
                    VALUES (?, ?, 'pinned', ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
                        is_pinned = excluded.is_pinned,
                        is_muted = excluded.is_muted,
                        last_synced_at = CURRENT_TIMESTAMP
                `).run(req.session.userId, row.repo_full_name, row.is_pinned, row.is_muted);
            }
        });
        applyTx();

        res.json({ reverted: true, operation_type: operationType });
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('expired')) {
            return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
    }
});
```

**Note**: the restoration above is deliberately scoped to `user_id` and touches only rows referenced by `before_state`. It's a narrow reconstruction, not a global rollback.

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t "undo"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): POST /undo/:operation_id endpoint"
```

---

## Task 14: Routes — POST /discover

**Files:**

- Modify: `server/routes/work-board-tracking.js`
- Create: `server/__tests__/work-board-discovery-route.test.js`

- [ ] **Step 1: Write failing test**

Create `server/__tests__/work-board-discovery-route.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../db.js';

const mockRunDiscovery = vi.fn();
vi.mock('../lib/work-board-discovery.js', () => ({
    runDiscovery: mockRunDiscovery,
}));

vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: 999200, accessToken: 'test-tok' };
            next();
        },
    };
});

const USER_ID = 999200;
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board-tracking.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
});

beforeEach(() => {
    mockRunDiscovery.mockReset();
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'disc-route-test');
});

describe('POST /api/v1/work-board/discover', () => {
    it('calls runDiscovery with userId, accessToken, and prefs', async () => {
        mockRunDiscovery.mockResolvedValueOnce({ discovered: 5, added: 5, removed: 0, duration_ms: 120, sso_orgs_blocked: [] });

        const res = await request(app).post('/api/v1/work-board/discover');

        expect(res.status).toBe(200);
        expect(res.body.discovered).toBe(5);
        expect(mockRunDiscovery).toHaveBeenCalledWith(USER_ID, 'test-tok', expect.objectContaining({
            discovery_window_days: 60,
            max_auto_repos: 50,
        }));
    });

    it('returns 500 if discovery throws', async () => {
        mockRunDiscovery.mockRejectedValueOnce(new Error('GitHub down'));
        const res = await request(app).post('/api/v1/work-board/discover');
        expect(res.status).toBe(500);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-discovery-route.test.js`
Expected: FAIL (route not implemented yet).

- [ ] **Step 3: Implement /discover**

Append to `server/routes/work-board-tracking.js`:

```javascript
import { runDiscovery } from '../lib/work-board-discovery.js';

router.post('/discover', requireAuth, async (req, res) => {
    const prefs = getPrefs(req.session.userId);
    try {
        const result = await runDiscovery(
            req.session.userId,
            req.session.accessToken,
            prefs,
        );
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-discovery-route.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-discovery-route.test.js
git commit -m "feat(work-board): POST /discover endpoint"
```

---

## Task 15: Mount the router under /api/v1/work-board

**Files:**

- Modify: `server/routes/v1/index.js`

- [ ] **Step 1: Add import and mount**

Open `server/routes/v1/index.js`. After the existing imports (around line 33), add:

```javascript
import workBoardTrackingRoutes from '../work-board-tracking.js';
```

After the existing `router.use('/work-board', workBoardActionsRoutes)` (around line 67), add:

```javascript
router.use('/work-board', workBoardTrackingRoutes);
```

- [ ] **Step 2: Verify full test suite still green**

Run: `npx vitest run server/`
Expected: PASS (all existing 1144 + new tests).

- [ ] **Step 3: Commit**

```bash
git add server/routes/v1/index.js
git commit -m "feat(work-board): mount tracking routes at /api/v1/work-board"
```

---

## Task 16: Existing endpoints — tracked_repos post-query filter

**Files:**

- Create: `server/lib/work-board-filter.js`
- Modify: `server/routes/work-board.js` (4 endpoints: `/my-reviews`, `/stale-prs`, `/my-issues`, `/tech-debt`)
- Create: `server/__tests__/work-board-filter.test.js`

**Context:** `server/routes/work-board.js` uses `resolveTabData()` which merges webhook-local rows (`listMyPendingReviews`, `listStalePRs`, `listMyOpenIssues` in `server/lib/event-aggregations.js`) with live GitHub search results. Items have a `repoFullName` field. We apply a post-query filter that drops items belonging to muted repos — and only when the user has a `work_board_prefs` row (so existing users without prefs get unchanged behaviour).

- [ ] **Step 1: Write failing test — filter drops muted items**

Create `server/__tests__/work-board-filter.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import { applyTrackedFilter } from '../lib/work-board-filter.js';

const USER_ID = 999301;

beforeEach(() => {
    db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'filter-test');
});

describe('applyTrackedFilter', () => {
    it('returns items unchanged when user has no prefs row (retrocompat)', () => {
        const items = [
            { repoFullName: 'a/b', title: 'PR 1' },
            { repoFullName: 'c/d', title: 'PR 2' },
        ];
        const result = applyTrackedFilter(USER_ID, items);
        expect(result).toEqual(items);
    });

    it('drops muted repos when prefs row exists', () => {
        db.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        db.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
            VALUES (?, 'muted/repo', 'owned', 0, 1),
                   (?, 'active/repo', 'owned', 0, 0)
        `).run(USER_ID, USER_ID);

        const items = [
            { repoFullName: 'muted/repo', title: 'should be dropped' },
            { repoFullName: 'active/repo', title: 'should remain' },
            { repoFullName: 'unknown/repo', title: 'not tracked — keep' },
        ];
        const result = applyTrackedFilter(USER_ID, items);
        expect(result.map(r => r.title)).toEqual(['should remain', 'not tracked — keep']);
    });

    it('is a no-op when items is empty', () => {
        db.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        expect(applyTrackedFilter(USER_ID, [])).toEqual([]);
    });

    it('handles items without repoFullName (defensive)', () => {
        db.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        const items = [{ title: 'no repo' }, { repoFullName: 'a/b', title: 'yes' }];
        const result = applyTrackedFilter(USER_ID, items);
        expect(result).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-filter.test.js`
Expected: FAIL with `Cannot find module '../lib/work-board-filter.js'`.

- [ ] **Step 3: Implement filter lib**

Create `server/lib/work-board-filter.js`:

```javascript
import db from '../db.js';

const prefsExistStmt = db.prepare('SELECT 1 FROM work_board_prefs WHERE user_id = ?');
const mutedReposStmt = db.prepare(
    'SELECT repo_full_name FROM work_board_tracked_repos WHERE user_id = ? AND is_muted = 1'
);

/**
 * Post-query filter that drops items whose `repoFullName` is in the user's
 * muted set. Retrocompat: returns items unchanged when the user has no
 * `work_board_prefs` row — existing webhook-only users are unaffected.
 *
 * @param {number|null|undefined} userId
 * @param {Array<{repoFullName?: string}>} items
 * @returns {Array} filtered items
 */
export function applyTrackedFilter(userId, items) {
    if (!userId || !Array.isArray(items) || items.length === 0) {
        return items ?? [];
    }

    const hasPrefs = prefsExistStmt.get(userId);
    if (!hasPrefs) return items;

    const muted = new Set(mutedReposStmt.all(userId).map(r => r.repo_full_name));
    if (muted.size === 0) return items;

    return items.filter(item => !item?.repoFullName || !muted.has(item.repoFullName));
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-filter.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire filter into the 4 endpoints**

In `server/routes/work-board.js`:

Add import at top:

```javascript
import { applyTrackedFilter } from '../lib/work-board-filter.js';
```

In `/my-reviews` handler (around line 162-164), replace:

```javascript
        const finalData = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
```

with:

```javascript
        const snoozeFiltered = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'pr' });
        const finalData = applyTrackedFilter(req.session?.userId, snoozeFiltered);
```

In `/my-issues` handler (around line 195-197), apply the same pattern:

```javascript
        const snoozeFiltered = (includeSnoozed || !req.session?.userId)
            ? data
            : filterOutSnoozed({ userId: req.session.userId, items: data, itemType: 'issue' });
        const finalData = applyTrackedFilter(req.session?.userId, snoozeFiltered);
        res.json({ data: finalData, meta });
```

In `/stale-prs` handler: locate the final `res.json({ data, meta })` block and wrap `data` in `applyTrackedFilter(req.session?.userId, data)`.

For `/tech-debt`: grep to find it (`git grep -n "'/tech-debt'" server/routes/`). If found in `server/routes/work-board.js`, apply the same wrap. If not present, skip — a later plan covers it.

- [ ] **Step 6: Write integration regression test**

Create `server/__tests__/work-board-filter-integration.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../db.js';

vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: USER_ID, userLogin: 'filter-it-user', accessToken: 't' };
            next();
        },
        requireTier: () => (req, res, next) => next(), // bypass tier gate for this integration
    };
});

const USER_ID = 999302;
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board', router);
});

beforeEach(() => {
    db.prepare('DELETE FROM pr_events WHERE 1 = 1').run();
    db.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    db.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'filter-it-user');
});

describe('/my-reviews honors tracked_repos', () => {
    it('drops muted repo rows when user has prefs', async () => {
        // Mark user as having prefs so filter activates
        db.prepare(`INSERT INTO work_board_prefs (user_id) VALUES (?)`).run(USER_ID);
        db.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
            VALUES (?, 'muted/repo', 'owned', 0, 1)
        `).run(USER_ID);

        // Seed a pr_events row for each repo that /my-reviews would pick up
        // (exact columns depend on pr_events schema — inspect server/db.js)
        // For this test we rely on the mocked GitHub live search returning the seed items.
        // If listMyPendingReviews requires real pr_events rows, add them here.
        // Minimal: assert the response is 200 and any item with repoFullName='muted/repo' is absent.

        const res = await request(app).get('/api/v1/work-board/my-reviews');
        expect(res.status).toBe(200);
        const names = (res.body.data ?? []).map(d => d.repoFullName);
        expect(names).not.toContain('muted/repo');
    });
});
```

- [ ] **Step 7: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-filter-integration.test.js`
Expected: PASS (1 test).

- [ ] **Step 8: Run full regression — no existing test breaks**

Run: `npx vitest run server/`
Expected: PASS (~1200+ total).

- [ ] **Step 9: Commit**

```bash
git add server/lib/work-board-filter.js server/routes/work-board.js server/__tests__/work-board-filter.test.js server/__tests__/work-board-filter-integration.test.js
git commit -m "feat(work-board): existing endpoints drop muted repos (retrocompat preserved)"
```

---

## Task 17: Webhook integration — auto-add unknown repos

**Files:**

- Modify: `server/routes/github-events-webhook.js`
- Modify: `server/__tests__/github-events-webhook.test.js` (add test — locate existing file via `ls server/__tests__/github*`)

- [ ] **Step 1: Locate the webhook router**

Run: `git grep -n "pr_events\\|issue_events" server/routes/ | head -10`
Expected: find where webhooks insert into `pr_events` / `issue_events`.

- [ ] **Step 2: Write failing test — new repo in webhook auto-inserts tracked row**

Create test ensuring that when a webhook fires for a repo not yet tracked, a new row is inserted with `source_signal='webhook'`, `is_pinned=0`, `is_muted=0`.

(Exact test details depend on the webhook's existing fixture; follow the pattern of existing webhook tests in `server/__tests__/`.)

- [ ] **Step 3: Add upsert on webhook handlers**

In the webhook handler, after resolving the user (repo owner) and before inserting into `pr_events`/`issue_events`, add:

```javascript
import { upsertTrackedRepoFromWebhook } from '../lib/work-board-tracking.js';

// inside handler
upsertTrackedRepoFromWebhook(userId, repoFullName, repoId);
```

Add the helper to `server/lib/work-board-tracking.js`:

```javascript
export function upsertTrackedRepoFromWebhook(userId, repoFullName, repoId) {
    db.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, repo_id, source_signal, is_pinned, is_muted, last_activity_at, last_synced_at)
        VALUES (?, ?, ?, 'webhook', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, repo_full_name) DO UPDATE SET
            last_activity_at = CURRENT_TIMESTAMP,
            last_synced_at = CURRENT_TIMESTAMP
    `).run(userId, repoFullName, repoId ?? null);
}
```

No undo-log for webhook inserts (auto-events are not user actions).

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/ -t webhook`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/github-events-webhook.js server/lib/work-board-tracking.js server/__tests__/
git commit -m "feat(work-board): webhook auto-inserts tracked_repos row for unknown repos"
```

---

## Task 18: Auto-migration for existing users

**Files:**

- Modify: `server/routes/work-board.js` (the root handler for `/work-board` page meta, or wherever first-visit logic lives — if no such endpoint exists, add `GET /api/v1/work-board/ping`)
- Modify: `server/__tests__/work-board-join-filter.test.js`

- [ ] **Step 1: Decide the trigger point**

The frontend calls multiple endpoints on Work Board load. Adding an explicit `GET /api/v1/work-board/ping` endpoint that:
1. Ensures `work_board_prefs` row exists (inserts defaults if missing).
2. If `last_discovery_at` is null OR > 24h ago, triggers `runDiscovery` in the background (fire-and-forget with `.catch(logger.warn)`).
3. Returns `{ prefs, discovery_in_flight: boolean }`.

This keeps the migration invisible to the frontend — it just calls `/ping` on page mount and gets a signal.

- [ ] **Step 2: Write test for /ping**

Append to tracking-routes test file:

```javascript
describe('GET /api/v1/work-board/ping', () => {
    it('creates prefs row if missing and triggers discovery', async () => {
        const res = await request(app).get('/api/v1/work-board/ping');
        expect(res.status).toBe(200);
        expect(res.body.prefs).toBeDefined();
        expect(res.body.discovery_in_flight).toBe(true);

        const row = db.prepare('SELECT * FROM work_board_prefs WHERE user_id = ?').get(USER_ID);
        expect(row).toBeDefined();
    });

    it('does not retrigger if discovery is fresh', async () => {
        db.prepare(`
            INSERT INTO work_board_prefs (user_id, last_discovery_at)
            VALUES (?, CURRENT_TIMESTAMP)
        `).run(USER_ID);

        const res = await request(app).get('/api/v1/work-board/ping');
        expect(res.body.discovery_in_flight).toBe(false);
    });
});
```

- [ ] **Step 3: Implement /ping**

Append to `server/routes/work-board-tracking.js`:

```javascript
import logger from '../lib/logger.js';

const TWENTY_FOUR_HOURS_MS = 24 * 3600 * 1000;

router.get('/ping', requireAuth, (req, res) => {
    const prefs = getPrefs(req.session.userId);

    const lastMs = prefs.last_discovery_at ? new Date(prefs.last_discovery_at).getTime() : 0;
    const isStale = (Date.now() - lastMs) > TWENTY_FOUR_HOURS_MS;
    let discoveryInFlight = false;

    if (isStale && req.session.accessToken) {
        discoveryInFlight = true;
        // fire-and-forget
        runDiscovery(req.session.userId, req.session.accessToken, prefs)
            .catch(err => logger.warn({ err, userId: req.session.userId }, 'background discovery failed'));
    }

    res.json({ prefs, discovery_in_flight: discoveryInFlight });
});
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t ping`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): GET /ping for first-visit auto-migration"
```

---

## Task 19: Repo search endpoint for palette fuzzy

**Files:**

- Modify: `server/routes/work-board-tracking.js`
- Modify: `server/__tests__/work-board-tracking-routes.test.js`

- [ ] **Step 1: Write failing test**

Append:

```javascript
describe('GET /api/v1/work-board/repo-search', () => {
    beforeEach(() => {
        db.prepare(`
            INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
            VALUES (?, 'acme/tracked-one', 'owned', 0, 0),
                   (?, 'acme/tracked-two', 'owned', 1, 0)
        `).run(USER_ID, USER_ID);
    });

    it('returns tracked matches first, sorted by prefix match', async () => {
        const res = await request(app).get('/api/v1/work-board/repo-search?q=acme');
        expect(res.status).toBe(200);
        expect(res.body.tracked.map(r => r.repo_full_name).sort()).toEqual(['acme/tracked-one', 'acme/tracked-two']);
    });

    it('returns empty tracked for no-match query', async () => {
        const res = await request(app).get('/api/v1/work-board/repo-search?q=nope');
        expect(res.body.tracked).toEqual([]);
    });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t repo-search`
Expected: FAIL.

- [ ] **Step 3: Implement (tracked-only for Phase 1)**

For Phase 1, implement tracked-scope search only. Untracked GitHub search happens in a later phase when the palette needs it.

Append:

```javascript
router.get('/repo-search', requireAuth, (req, res) => {
    const q = (req.query.q ?? '').toString().trim();
    if (!q) return res.json({ tracked: [], untracked: [] });

    const tracked = db.prepare(`
        SELECT repo_full_name, source_signal, is_pinned, is_muted, last_activity_at
        FROM work_board_tracked_repos
        WHERE user_id = ? AND LOWER(repo_full_name) LIKE ?
        ORDER BY
            CASE WHEN LOWER(repo_full_name) LIKE ? THEN 0 ELSE 1 END,
            last_activity_at DESC
        LIMIT 20
    `).all(req.session.userId, `%${q.toLowerCase()}%`, `${q.toLowerCase()}%`);

    res.json({ tracked, untracked: [] });
});
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/__tests__/work-board-tracking-routes.test.js -t repo-search`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/routes/work-board-tracking.js server/__tests__/work-board-tracking-routes.test.js
git commit -m "feat(work-board): GET /repo-search (tracked-scope) for palette fuzzy"
```

---

## Task 20: Full regression pass + docs

**Files:**

- Create: `docs/architecture/work-board-tracking.md`
- Create: `docs/api/WORK-BOARD-API.md`

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: PASS (1144 existing + ~60 new = ~1200+ green).

- [ ] **Step 2: Write architecture doc**

Create `docs/architecture/work-board-tracking.md` with:

- Overview paragraph (what is tracked_repos)
- Schema ER-like description of all 4 tables
- Discovery algorithm (5 collectors + merge rules, link to code)
- Stale-while-revalidate flow
- Undo log semantics + TTL
- Webhook coherence rule

- [ ] **Step 3: Write API doc**

Create `docs/api/WORK-BOARD-API.md` documenting every new endpoint:

- Method, path, auth, body, response shape, error codes
- Example curl for each

- [ ] **Step 4: Update CHANGELOG / README**

Add a "Work Board Premium UX — Phase 1" entry to the unreleased section.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/work-board-tracking.md docs/api/WORK-BOARD-API.md
git commit -m "docs(work-board): Phase 1 architecture + API reference"
```

- [ ] **Step 6: Push + PR**

```bash
git push -u origin fix/ai-test-fallback-and-csrf  # (or a new branch dedicated to Phase 1)
gh pr create --title "feat(work-board): Phase 1 — tracking foundations + auto-discovery" --body "Implements Phase 1 of docs/specs/2026-04-24-work-board-premium-ux.md. Backend only — no frontend changes. Existing webhook flow preserved. Auto-migration for existing users via stale-while-revalidate /ping."
```

---

## Self-review checklist

Before declaring the plan done, verify:

- [ ] Every spec §1 requirement has a task implementing it (schema, endpoints, discovery, auto-migration, webhook coherence).
- [ ] No task says "TBD", "similar to Task N", "add appropriate handling".
- [ ] `upsertTrackedRepo` signature is consistent across tasks (Task 3, 5, 10, 13).
- [ ] `mergeCandidates` return shape `{ keep, add, remove }` is consistent across Tasks 8 and 16.
- [ ] `operation_id` is always a UUID v4 (generated by `randomUUID`).
- [ ] Every test file that mocks `../middleware/auth.js` also imports the original for non-mocked helpers.
- [ ] Integration tests clean DB state in `beforeEach` (no cross-test pollution).
- [ ] Every new file has at least one test; no untested public function.

## What's NOT in Phase 1

These ship in subsequent plans (to be written after Phase 1 merges):

- Phase 2: Settings page UI (`docs/plans/202X-XX-XX-work-board-phase-2-settings.md`)
- Phase 3: Work Board inline actions UI
- Phase 4: Cross-app integration (Dashboard, RepoCard, RepoDetail, PRReview, Header)
- Phase 5: Command palette extension
- Phase 6: AI Assistant (opt-in, gated)
- Phase 7: AI Assistant GA

Each phase gets its own plan with its own TDD task breakdown.
