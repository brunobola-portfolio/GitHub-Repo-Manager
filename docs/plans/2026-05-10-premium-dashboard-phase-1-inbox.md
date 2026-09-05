# Premium Dashboard Phase 1 — Live Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-empty Attention Feed with a Live Actionable Inbox: six sections (needs_review, my_prs, mentions, failing_ci, stale_drafts, dependabot_ready) sourced from existing aggregators, with archive/snooze persistence and AI narrative on the top three items.

**Architecture:** New aggregator module `dashboard-aggregator.js` composes existing event-aggregation helpers behind a single namespace `/api/v1/dashboard/*`. Inbox state (archived / snoozed) persisted to a new SQLite table. Frontend introduces `InboxPanel` (sectioned, keyboard-driven, expand-in-place rows) at the dashboard hero, with the existing `AttentionFeed` demoted to a "Repo Health" sub-panel. Lazy-loaded behind localStorage feature flag `dashboard_premium_v2_inbox`.

**Tech Stack:** Express 5 + better-sqlite3 (backend), React 19 + Vite 7 + Tailwind v4 + Framer Motion (frontend), Vitest (unit), Playwright (e2e).

**Spec reference:** [docs/specs/2026-05-10-premium-dashboard-three-pillars.md](../specs/2026-05-10-premium-dashboard-three-pillars.md)

---

## File map

**Created**
- `server/lib/dashboard-aggregator.js` — composes inbox sections, dedup, archive/snooze filter
- `server/routes/dashboard.js` — four endpoints under `/api/v1/dashboard/*`
- `server/__tests__/dashboard-aggregator.test.js` — unit
- `server/__tests__/dashboard-routes.test.js` — route integration
- `src/api/dashboardInbox.js` — fetch wrappers (thin)
- `src/hooks/useInbox.js` — React hook (data + archive/snooze mutations)
- `src/components/Dashboard/Premium/InboxPanel.jsx` — top-level panel
- `src/components/Dashboard/Premium/InboxRow.jsx` — single row with expand-in-place
- `src/components/Dashboard/Premium/InboxSection.jsx` — sidebar entry (label + count)
- `src/components/Dashboard/Premium/SnoozeModal.jsx` — preset choices + custom date
- `src/lib/featureFlags.js` — localStorage flag helper (if not already present)
- `tests/lib/dashboard-aggregator.test.js` — additional logic coverage
- `tests/hooks/useInbox.test.jsx`
- `tests/components/Dashboard/Premium/InboxRow.test.jsx`
- `tests/components/Dashboard/Premium/InboxPanel.test.jsx`
- `e2e/dashboard-inbox.spec.js`

**Modified**
- `server/lib/event-aggregations.js` — add `listMyOpenPRs`
- `server/db.js` — add `CREATE TABLE IF NOT EXISTS dashboard_inbox_state` to init block
- `server/routes/v1/index.js` — mount `/dashboard`
- `src/components/Dashboard/DashboardPremium.jsx` — render `<InboxPanel />` when flag on
- `src/design-system.css` — add `--ds-ease-row-expand`, `--ds-duration-row-expand`, status palette vars, reduced-motion override

---

## Task 1: Add `listMyOpenPRs` helper to event-aggregations.js

**Files:**
- Modify: `server/lib/event-aggregations.js` (append new exported function after `listMyPendingReviews`)
- Test: `server/__tests__/event-aggregations.test.js` (likely already exists — extend; if not, create)

- [ ] **Step 1: Confirm test file existence**

Run: `ls server/__tests__/event-aggregations*.test.js`
Expected: at least one matching file. If none, create `server/__tests__/event-aggregations.test.js` with the standard imports already used in `server/__tests__/work-board-actions.test.js` (vitest `describe/it/expect` + better-sqlite3 in-memory DB seed).

- [ ] **Step 2: Write the failing test**

Append to the test file:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import { listMyOpenPRs } from '../lib/event-aggregations.js';

describe('listMyOpenPRs', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
    });

    it('returns open PRs authored by the user, newest first', () => {
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 42, 'opened', 'alice', 'first', '2026-05-01T00:00:00Z');
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 43, 'opened', 'alice', 'second', '2026-05-09T00:00:00Z');

        const rows = listMyOpenPRs({ authorLogin: 'alice' });
        expect(rows.map(r => r.prNumber)).toEqual([43, 42]);
        expect(rows[0]).toMatchObject({ repoFullName: 'foo/bar', title: 'second' });
    });

    it('excludes PRs that have a closed event', () => {
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 42, 'opened', 'alice', 'first', '2026-05-01T00:00:00Z');
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 42, 'closed', 'alice', 'first', '2026-05-02T00:00:00Z');

        expect(listMyOpenPRs({ authorLogin: 'alice' })).toEqual([]);
    });

    it('returns empty when authorLogin missing', () => {
        expect(listMyOpenPRs({})).toEqual([]);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/__tests__/event-aggregations.test.js -t listMyOpenPRs`
Expected: FAIL with "listMyOpenPRs is not a function".

- [ ] **Step 4: Implement listMyOpenPRs**

Append to `server/lib/event-aggregations.js` after `listMyPendingReviews`:

```js
/**
 * Open PRs authored by ME (newest first). Mirrors listMyPendingReviews
 * shape so the inbox aggregator can dedupe a PR that appears in both
 * "needs my review" and "my PRs" by canonical key.
 *
 * @param {object} opts
 * @param {string} opts.authorLogin
 * @param {number} [opts.limit=100]
 * @returns {Array<{ repoFullName, prNumber, title, authorLogin, openedAt, ageHours }>}
 */
export function listMyOpenPRs({ authorLogin, limit = 100 } = {}) {
    if (!authorLogin) return [];

    const rows = db.prepare(`
        SELECT
            pe_open.repo_full_name AS repoFullName,
            pe_open.pr_number      AS prNumber,
            pe_open.title          AS title,
            pe_open.author_login   AS authorLogin,
            pe_open.created_at     AS openedAt
        FROM pr_events pe_open
        WHERE pe_open.action = 'opened'
          AND pe_open.author_login = ?
          AND NOT EXISTS (
              SELECT 1 FROM pr_events pe_close
              WHERE pe_close.repo_id  = pe_open.repo_id
                AND pe_close.pr_number = pe_open.pr_number
                AND pe_close.action    = 'closed'
          )
        ORDER BY pe_open.created_at DESC
        LIMIT ?
    `).all(authorLogin, limit);

    return rows.map(r => ({
        ...r,
        ageHours: r.openedAt ? Math.round(hoursSince(r.openedAt) * 10) / 10 : null,
    }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/__tests__/event-aggregations.test.js -t listMyOpenPRs`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add server/lib/event-aggregations.js server/__tests__/event-aggregations.test.js
git commit -m "feat(aggregations): add listMyOpenPRs for inbox my_prs section"
```

---

## Task 2: Add `dashboard_inbox_state` table to db init

**Files:**
- Modify: `server/db.js` (append CREATE TABLE inside the init block)
- Test: `server/__tests__/db-schema.test.js` (extend; or `server/__tests__/dashboard-aggregator.test.js` later)

- [ ] **Step 1: Write the failing schema assertion**

Append to `server/__tests__/db-schema.test.js` (create if missing using existing fixtures pattern from `server/__tests__/work-board-actions.test.js`):

```js
import { describe, it, expect } from 'vitest';
import db from '../db.js';

describe('dashboard_inbox_state table', () => {
    it('exists with expected columns', () => {
        const cols = db.prepare("PRAGMA table_info('dashboard_inbox_state')").all();
        const names = cols.map(c => c.name).sort();
        expect(names).toEqual(['archived_at', 'item_id', 'snoozed_until', 'user_id']);
    });

    it('uses (user_id, item_id) as composite primary key', () => {
        const cols = db.prepare("PRAGMA table_info('dashboard_inbox_state')").all();
        const pkCols = cols.filter(c => c.pk > 0).map(c => c.name).sort();
        expect(pkCols).toEqual(['item_id', 'user_id']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/db-schema.test.js`
Expected: FAIL — table_info returns empty array.

- [ ] **Step 3: Add CREATE TABLE to db init**

Locate the existing `CREATE TABLE IF NOT EXISTS` block in `server/db.js` (around the `migration_jobs` table near line 203). Append:

```js
db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_inbox_state (
        user_id        INTEGER NOT NULL,
        item_id        TEXT    NOT NULL,
        archived_at    TEXT,
        snoozed_until  TEXT,
        PRIMARY KEY (user_id, item_id)
    );
`);
```

Place after the other dashboard-adjacent tables (e.g., next to `migration_jobs` or community-health caches) so the migration order stays grouped by domain.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/db-schema.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/__tests__/db-schema.test.js
git commit -m "feat(db): add dashboard_inbox_state for inbox archive/snooze"
```

---

## Task 3: Create `dashboard-aggregator.js` with `composeInbox` skeleton + `needs_review` section

**Files:**
- Create: `server/lib/dashboard-aggregator.js`
- Create: `server/__tests__/dashboard-aggregator.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../db.js';
import { composeInbox } from '../lib/dashboard-aggregator.js';

const USER_ID = 99;
const LOGIN = 'alice';

function seedReviewAssignment(repo, prNumber, ageHoursAgo = 3) {
    const requestedAt = new Date(Date.now() - ageHoursAgo * 3600_000).toISOString();
    db.prepare(`INSERT INTO review_assignments
        (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(1, repo, prNumber, LOGIN, 'pending', requestedAt);
}

describe('composeInbox — needs_review section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('returns one section per requested key with items present', () => {
        seedReviewAssignment('foo/bar', 1);
        seedReviewAssignment('foo/bar', 2);

        const result = composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review'],
        });

        expect(result.sections).toHaveLength(1);
        expect(result.sections[0].key).toBe('needs_review');
        expect(result.sections[0].items).toHaveLength(2);
        expect(result.sections[0].items[0]).toMatchObject({
            id: expect.stringMatching(/^pr:foo\/bar#\d+$/),
            kind: 'pr',
            repoFullName: 'foo/bar',
            section: 'needs_review',
        });
    });

    it('returns empty items array for a section with no data, not undefined', () => {
        const result = composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review'],
        });
        expect(result.sections[0].items).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the aggregator skeleton**

Create `server/lib/dashboard-aggregator.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard aggregator — composes the Live Inbox by fanning out to existing
 * event-aggregation helpers. One module, one read path, one write path for
 * archive/snooze state. No GitHub round-trips here; live data flows through
 * gh-cache at the route layer.
 */

import db from '../db.js';
import { listMyPendingReviews } from './event-aggregations.js';

const SECTION_KEYS = ['needs_review', 'my_prs', 'mentions', 'failing_ci', 'stale_drafts', 'dependabot_ready'];

const SECTION_LABEL = {
    needs_review: 'Needs my review',
    my_prs: 'My open PRs',
    mentions: 'Mentions',
    failing_ci: 'Failing CI',
    stale_drafts: 'Stale drafts',
    dependabot_ready: 'Dependabot ready',
};

function prKey(repoFullName, prNumber) {
    return `pr:${repoFullName}#${prNumber}`;
}

function buildNeedsReview(userLogin) {
    const rows = listMyPendingReviews({ reviewerLogin: userLogin });
    return rows.map(r => ({
        id: prKey(r.repoFullName, r.prNumber),
        kind: 'pr',
        section: 'needs_review',
        repoFullName: r.repoFullName,
        prNumber: r.prNumber,
        title: r.title,
        authorLogin: r.authorLogin,
        since: r.requestedAt,
        ageHours: r.ageHours,
    }));
}

const SECTION_BUILDERS = {
    needs_review: (_userId, opts) => buildNeedsReview(opts.userLogin),
    my_prs: () => [],
    mentions: () => [],
    failing_ci: () => [],
    stale_drafts: () => [],
    dependabot_ready: () => [],
};

/**
 * @param {number} userId
 * @param {object} opts
 * @param {string} opts.userLogin — GitHub login
 * @param {string[]} [opts.sections] — subset; defaults to all SECTION_KEYS
 * @param {boolean} [opts.includeArchived=false]
 * @returns {{ sections: Array<{ key, label, items: Array }> }}
 */
export function composeInbox(userId, opts = {}) {
    const { userLogin, sections = SECTION_KEYS } = opts;

    const out = sections
        .filter(k => SECTION_KEYS.includes(k))
        .map(key => ({
            key,
            label: SECTION_LABEL[key],
            items: SECTION_BUILDERS[key](userId, { userLogin }),
        }));

    return { sections: out };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js
git commit -m "feat(dashboard): aggregator skeleton + needs_review section"
```

---

## Task 4: Add `my_prs` and `mentions` sections to aggregator

**Files:**
- Modify: `server/lib/dashboard-aggregator.js`
- Modify: `server/__tests__/dashboard-aggregator.test.js`

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/dashboard-aggregator.test.js`:

```js
import { listMyOpenPRs } from '../lib/event-aggregations.js';

describe('composeInbox — my_prs section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('lists PRs authored by user', () => {
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 7, 'opened', LOGIN, 'feat: thing', '2026-05-01T00:00:00Z');

        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['my_prs'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:foo/bar#7',
            section: 'my_prs',
            title: 'feat: thing',
        });
    });
});

describe('composeInbox — mentions section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM issue_events').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('lists issues assigned to user', () => {
        db.prepare(`INSERT INTO issue_events
            (repo_id, repo_full_name, issue_number, action, assignee_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 11, 'assigned', LOGIN, 'bug: x', '2026-05-01T00:00:00Z');

        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['mentions'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'issue:foo/bar#11',
            section: 'mentions',
            title: 'bug: x',
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: FAIL — my_prs and mentions still return empty arrays.

- [ ] **Step 3: Implement the two builders**

Edit `server/lib/dashboard-aggregator.js`:

Replace the import line:
```js
import { listMyPendingReviews } from './event-aggregations.js';
```
with:
```js
import { listMyPendingReviews, listMyOpenPRs, listMyOpenIssues } from './event-aggregations.js';
```

Add a helper near `prKey`:
```js
function issueKey(repoFullName, issueNumber) {
    return `issue:${repoFullName}#${issueNumber}`;
}
```

Replace the `my_prs` and `mentions` entries in `SECTION_BUILDERS`:

```js
my_prs: (_userId, opts) => {
    const rows = listMyOpenPRs({ authorLogin: opts.userLogin });
    return rows.map(r => ({
        id: prKey(r.repoFullName, r.prNumber),
        kind: 'pr',
        section: 'my_prs',
        repoFullName: r.repoFullName,
        prNumber: r.prNumber,
        title: r.title,
        authorLogin: r.authorLogin,
        since: r.openedAt,
        ageHours: r.ageHours,
    }));
},
mentions: (_userId, opts) => {
    const rows = listMyOpenIssues({ assigneeLogin: opts.userLogin });
    return rows.map(r => ({
        id: issueKey(r.repoFullName, r.issueNumber),
        kind: 'issue',
        section: 'mentions',
        repoFullName: r.repoFullName,
        issueNumber: r.issueNumber,
        title: r.title,
        since: r.openedAt,
        ageDays: r.ageDays,
    }));
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js
git commit -m "feat(dashboard): add my_prs + mentions inbox sections"
```

---

## Task 5: Add `stale_drafts` and `dependabot_ready` sections

**Files:**
- Modify: `server/lib/dashboard-aggregator.js`
- Modify: `server/__tests__/dashboard-aggregator.test.js`

- [ ] **Step 1: Write the failing test**

Append to test file:

```js
import { listStalePRs } from '../lib/event-aggregations.js';

describe('composeInbox — stale_drafts section', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
    });

    it('lists open PRs older than 7 days authored by user', () => {
        const oldDate = new Date(Date.now() - 14 * 86400_000).toISOString();
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 5, 'opened', LOGIN, 'wip', oldDate);

        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['stale_drafts'] });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:foo/bar#5',
            section: 'stale_drafts',
        });
    });
});

describe('composeInbox — dependabot_ready section', () => {
    it('returns empty array when no dependabot PRs (placeholder until repos-security wired)', () => {
        const result = composeInbox(USER_ID, { userLogin: LOGIN, sections: ['dependabot_ready'] });
        expect(result.sections[0].items).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: stale_drafts FAILs, dependabot_ready may already pass (returns []).

- [ ] **Step 3: Implement stale_drafts builder**

Edit `server/lib/dashboard-aggregator.js`:

Add to imports:
```js
import { listMyPendingReviews, listMyOpenPRs, listMyOpenIssues, listStalePRs } from './event-aggregations.js';
```

Replace `stale_drafts` in `SECTION_BUILDERS`:
```js
stale_drafts: (_userId, opts) => {
    const rows = listStalePRs({ staleAfterDays: 7 });
    return rows
        .filter(r => r.authorLogin === opts.userLogin)
        .map(r => ({
            id: prKey(r.repoFullName, r.prNumber),
            kind: 'pr',
            section: 'stale_drafts',
            repoFullName: r.repoFullName,
            prNumber: r.prNumber,
            title: r.title,
            authorLogin: r.authorLogin,
            since: r.openedAt,
            ageDays: r.ageDays,
        }));
},
```

Leave `dependabot_ready` returning `[]` for now — full wire is Task 6 after dedup, because Dependabot PRs are typically authored by the user when triggered via "@dependabot rebase". We need dedup logic in place first.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: PASS (all in file).

- [ ] **Step 5: Commit**

```bash
git add server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js
git commit -m "feat(dashboard): add stale_drafts inbox section"
```

---

## Task 6: Add dedup logic by canonical item id

**Files:**
- Modify: `server/lib/dashboard-aggregator.js`
- Modify: `server/__tests__/dashboard-aggregator.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('composeInbox — dedup across sections', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM pr_events').run();
        db.prepare('DELETE FROM review_assignments').run();
    });

    it('a PR appearing in both my_prs and needs_review keeps only the higher-priority section (needs_review)', () => {
        // Same PR: alice is author AND a reviewer was requested from her (edge case)
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 9, 'opened', LOGIN, 'self-review', '2026-05-01T00:00:00Z');
        seedReviewAssignment('foo/bar', 9);

        const result = composeInbox(USER_ID, {
            userLogin: LOGIN,
            sections: ['needs_review', 'my_prs'],
        });

        const inNeeds = result.sections.find(s => s.key === 'needs_review').items.some(i => i.id === 'pr:foo/bar#9');
        const inMy = result.sections.find(s => s.key === 'my_prs').items.some(i => i.id === 'pr:foo/bar#9');
        expect(inNeeds).toBe(true);
        expect(inMy).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js -t dedup`
Expected: FAIL — PR appears in both sections.

- [ ] **Step 3: Implement dedup**

In `server/lib/dashboard-aggregator.js`, replace the `composeInbox` body:

```js
// Priority order — earlier sections "win" ownership of a duplicated id.
// Failing CI is most urgent → it claims the PR if also in my_prs.
const SECTION_PRIORITY = ['failing_ci', 'needs_review', 'stale_drafts', 'mentions', 'dependabot_ready', 'my_prs'];

export function composeInbox(userId, opts = {}) {
    const { userLogin, sections = SECTION_KEYS } = opts;

    const requested = sections.filter(k => SECTION_KEYS.includes(k));

    // Build all in one pass, keyed by section
    const raw = {};
    for (const key of requested) {
        raw[key] = SECTION_BUILDERS[key](userId, { userLogin });
    }

    // Dedup by id, honouring SECTION_PRIORITY
    const owned = new Set();
    const dedupBySection = {};
    for (const key of SECTION_PRIORITY) {
        if (!raw[key]) continue;
        dedupBySection[key] = raw[key].filter(item => {
            if (owned.has(item.id)) return false;
            owned.add(item.id);
            return true;
        });
    }

    const out = requested.map(key => ({
        key,
        label: SECTION_LABEL[key],
        items: dedupBySection[key] ?? [],
    }));

    return { sections: out };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: PASS — all dedup + existing tests green.

- [ ] **Step 5: Commit**

```bash
git add server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js
git commit -m "feat(dashboard): dedup inbox items across sections by priority"
```

---

## Task 7: Apply archive / snooze state filter

**Files:**
- Modify: `server/lib/dashboard-aggregator.js`
- Modify: `server/__tests__/dashboard-aggregator.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('composeInbox — archive / snooze filter', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('hides items with archived_at set unless includeArchived=true', () => {
        seedReviewAssignment('foo/bar', 1);
        db.prepare(`INSERT INTO dashboard_inbox_state
            (user_id, item_id, archived_at) VALUES (?, ?, ?)`).run(USER_ID, 'pr:foo/bar#1', new Date().toISOString());

        expect(composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'] })
            .sections[0].items).toEqual([]);

        expect(composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'], includeArchived: true })
            .sections[0].items).toHaveLength(1);
    });

    it('hides items snoozed until a future timestamp; restores after expiry', () => {
        seedReviewAssignment('foo/bar', 2);
        const future = new Date(Date.now() + 3600_000).toISOString();
        db.prepare(`INSERT INTO dashboard_inbox_state
            (user_id, item_id, snoozed_until) VALUES (?, ?, ?)`).run(USER_ID, 'pr:foo/bar#2', future);
        expect(composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'] })
            .sections[0].items).toEqual([]);

        const past = new Date(Date.now() - 1000).toISOString();
        db.prepare('UPDATE dashboard_inbox_state SET snoozed_until = ? WHERE item_id = ?').run(past, 'pr:foo/bar#2');
        expect(composeInbox(USER_ID, { userLogin: LOGIN, sections: ['needs_review'] })
            .sections[0].items).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js -t archive`
Expected: FAIL — archived/snoozed items still visible.

- [ ] **Step 3: Implement filter**

In `server/lib/dashboard-aggregator.js`, add helper near top:

```js
function loadInboxState(userId) {
    const rows = db.prepare(
        'SELECT item_id, archived_at, snoozed_until FROM dashboard_inbox_state WHERE user_id = ?'
    ).all(userId);
    const archived = new Set();
    const snoozedUntil = new Map();
    for (const r of rows) {
        if (r.archived_at) archived.add(r.item_id);
        if (r.snoozed_until) snoozedUntil.set(r.item_id, r.snoozed_until);
    }
    return { archived, snoozedUntil };
}
```

Replace `composeInbox` to apply the filter just before the dedup return:

```js
export function composeInbox(userId, opts = {}) {
    const { userLogin, sections = SECTION_KEYS, includeArchived = false } = opts;
    const requested = sections.filter(k => SECTION_KEYS.includes(k));
    const { archived, snoozedUntil } = loadInboxState(userId);
    const now = Date.now();

    const raw = {};
    for (const key of requested) {
        raw[key] = SECTION_BUILDERS[key](userId, { userLogin }).filter(item => {
            if (!includeArchived && archived.has(item.id)) return false;
            const snoozeIso = snoozedUntil.get(item.id);
            if (snoozeIso && Date.parse(snoozeIso) > now) return false;
            return true;
        });
    }

    const owned = new Set();
    const dedupBySection = {};
    for (const key of SECTION_PRIORITY) {
        if (!raw[key]) continue;
        dedupBySection[key] = raw[key].filter(item => {
            if (owned.has(item.id)) return false;
            owned.add(item.id);
            return true;
        });
    }

    return {
        sections: requested.map(key => ({
            key,
            label: SECTION_LABEL[key],
            items: dedupBySection[key] ?? [],
        })),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: PASS — every test in file.

- [ ] **Step 5: Commit**

```bash
git add server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js
git commit -m "feat(dashboard): apply archive/snooze filter to inbox composition"
```

---

## Task 8: Create `dashboard.js` route + `GET /inbox`

**Files:**
- Create: `server/routes/dashboard.js`
- Create: `server/__tests__/dashboard-routes.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../db.js';
import dashboardRouter from '../routes/dashboard.js';

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { userId: 99, userLogin: 'alice' }; next(); });
    app.use('/api/v1/dashboard', dashboardRouter);
    return app;
}

describe('GET /api/v1/dashboard/inbox', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('returns sections payload', async () => {
        db.prepare(`INSERT INTO review_assignments
            (repo_id, repo_full_name, pr_number, reviewer_login, state, requested_at)
            VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 1, 'alice', 'pending', new Date().toISOString());

        const res = await request(buildApp()).get('/api/v1/dashboard/inbox');
        expect(res.status).toBe(200);
        expect(res.body.sections).toBeInstanceOf(Array);
        const needs = res.body.sections.find(s => s.key === 'needs_review');
        expect(needs.items).toHaveLength(1);
    });

    it('honours sections query param', async () => {
        const res = await request(buildApp()).get('/api/v1/dashboard/inbox?sections=mentions');
        expect(res.body.sections.map(s => s.key)).toEqual(['mentions']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `server/routes/dashboard.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from 'express';
import { requireAuth, safeError } from '../middleware/auth.js';
import { composeInbox } from '../lib/dashboard-aggregator.js';
import db from '../db.js';

const router = Router();

router.get('/inbox', requireAuth, (req, res) => {
    try {
        const sections = req.query.sections
            ? String(req.query.sections).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const includeArchived = req.query.include_archived === '1';

        const result = composeInbox(req.session.userId, {
            userLogin: req.session.userLogin,
            sections,
            includeArchived,
        });
        res.json(result);
    } catch (err) {
        req.log?.error?.({ err }, 'dashboard inbox failed');
        res.status(500).json({ error: safeError(err, 'Failed to compose inbox') });
    }
});

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add server/routes/dashboard.js server/__tests__/dashboard-routes.test.js
git commit -m "feat(dashboard): GET /api/v1/dashboard/inbox endpoint"
```

---

## Task 9: `POST /inbox/:id/archive` + `POST /inbox/:id/restore`

**Files:**
- Modify: `server/routes/dashboard.js`
- Modify: `server/__tests__/dashboard-routes.test.js`

- [ ] **Step 1: Write the failing test**

Append to test file:

```js
describe('POST /inbox/:id/archive', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('persists archived_at and returns ok', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/archive')
            .send();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        const row = db.prepare('SELECT * FROM dashboard_inbox_state WHERE user_id = 99 AND item_id = ?')
            .get('pr:foo/bar#1');
        expect(row?.archived_at).toBeTruthy();
    });
});

describe('POST /inbox/:id/restore', () => {
    it('clears archived_at and snoozed_until', async () => {
        db.prepare(`INSERT INTO dashboard_inbox_state
            (user_id, item_id, archived_at, snoozed_until) VALUES (?, ?, ?, ?)`)
            .run(99, 'pr:foo/bar#1', new Date().toISOString(), new Date().toISOString());

        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/restore')
            .send();
        expect(res.status).toBe(200);
        const row = db.prepare('SELECT archived_at, snoozed_until FROM dashboard_inbox_state WHERE item_id = ?')
            .get('pr:foo/bar#1');
        expect(row.archived_at).toBeNull();
        expect(row.snoozed_until).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js -t archive`
Expected: FAIL — 404 (route not mounted).

- [ ] **Step 3: Implement archive + restore**

Append to `server/routes/dashboard.js` before the `export default router` line:

```js
router.post('/inbox/:itemId/archive', requireAuth, (req, res) => {
    try {
        const itemId = decodeURIComponent(req.params.itemId);
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO dashboard_inbox_state (user_id, item_id, archived_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET archived_at = excluded.archived_at
        `).run(req.session.userId, itemId, now);
        res.json({ ok: true });
    } catch (err) {
        req.log?.error?.({ err }, 'archive failed');
        res.status(500).json({ error: safeError(err, 'Failed to archive') });
    }
});

router.post('/inbox/:itemId/restore', requireAuth, (req, res) => {
    try {
        const itemId = decodeURIComponent(req.params.itemId);
        db.prepare(`
            UPDATE dashboard_inbox_state
            SET archived_at = NULL, snoozed_until = NULL
            WHERE user_id = ? AND item_id = ?
        `).run(req.session.userId, itemId);
        res.json({ ok: true });
    } catch (err) {
        req.log?.error?.({ err }, 'restore failed');
        res.status(500).json({ error: safeError(err, 'Failed to restore') });
    }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/dashboard.js server/__tests__/dashboard-routes.test.js
git commit -m "feat(dashboard): POST archive + restore inbox endpoints"
```

---

## Task 10: `POST /inbox/:id/snooze`

**Files:**
- Modify: `server/routes/dashboard.js`
- Modify: `server/__tests__/dashboard-routes.test.js`

- [ ] **Step 1: Write the failing test**

Append:

```js
describe('POST /inbox/:id/snooze', () => {
    beforeEach(() => {
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('persists snoozed_until from body', async () => {
        const until = '2026-06-01T09:00:00Z';
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/snooze')
            .send({ until });
        expect(res.status).toBe(200);
        const row = db.prepare('SELECT snoozed_until FROM dashboard_inbox_state WHERE item_id = ?')
            .get('pr:foo/bar#1');
        expect(row.snoozed_until).toBe(until);
    });

    it('rejects invalid ISO timestamp with 400', async () => {
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/snooze')
            .send({ until: 'tomorrow-ish' });
        expect(res.status).toBe(400);
    });

    it('rejects past timestamps with 400', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const res = await request(buildApp())
            .post('/api/v1/dashboard/inbox/pr:foo%2Fbar%231/snooze')
            .send({ until: past });
        expect(res.status).toBe(400);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js -t snooze`
Expected: FAIL — 404.

- [ ] **Step 3: Implement snooze**

Append to `server/routes/dashboard.js` before `export default`:

```js
router.post('/inbox/:itemId/snooze', requireAuth, (req, res) => {
    try {
        const itemId = decodeURIComponent(req.params.itemId);
        const until = req.body?.until;
        const ts = Date.parse(until);
        if (!until || Number.isNaN(ts)) {
            return res.status(400).json({ error: 'Invalid ISO timestamp in `until`' });
        }
        if (ts <= Date.now()) {
            return res.status(400).json({ error: '`until` must be in the future' });
        }
        db.prepare(`
            INSERT INTO dashboard_inbox_state (user_id, item_id, snoozed_until)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET snoozed_until = excluded.snoozed_until
        `).run(req.session.userId, itemId, until);
        res.json({ ok: true });
    } catch (err) {
        req.log?.error?.({ err }, 'snooze failed');
        res.status(500).json({ error: safeError(err, 'Failed to snooze') });
    }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/dashboard.js server/__tests__/dashboard-routes.test.js
git commit -m "feat(dashboard): POST snooze inbox endpoint with timestamp validation"
```

---

## Task 11: Mount dashboard router under `/api/v1/dashboard`

**Files:**
- Modify: `server/routes/v1/index.js`

- [ ] **Step 1: Write a smoke test**

Append to `server/__tests__/dashboard-routes.test.js`:

```js
describe('mount integration', () => {
    it('router exports a default Express router', async () => {
        const mod = await import('../routes/dashboard.js');
        expect(typeof mod.default).toBe('function');
        expect(mod.default.stack).toBeInstanceOf(Array);
    });
});
```

- [ ] **Step 2: Run test to verify it passes (router already exists)**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js -t mount`
Expected: PASS.

- [ ] **Step 3: Mount in v1 router**

Edit `server/routes/v1/index.js`. Add to imports near the other route imports:

```js
import dashboardRoutes from '../dashboard.js';
```

Then add a mount line in the route-mount section (near the work-board mounts):

```js
router.use('/dashboard', dashboardRoutes);
```

- [ ] **Step 4: Verify by starting the dev server and curling**

Run: `npm run dev:server` (separate terminal) then in another: `curl http://localhost:3001/api/v1/dashboard/inbox -b "session_cookie=..."`
Expected: 200 JSON with `sections` array (real session) or 401 (no session) — not 404.

If the dev script is named differently, check `package.json` for the server start script.

- [ ] **Step 5: Commit**

```bash
git add server/routes/v1/index.js server/__tests__/dashboard-routes.test.js
git commit -m "feat(dashboard): mount /api/v1/dashboard router"
```

---

## Task 12: Frontend API wrapper `src/api/dashboardInbox.js`

**Files:**
- Create: `src/api/dashboardInbox.js`

- [ ] **Step 1: Examine an existing api wrapper for conventions**

Run: open `src/api/attentionFeed.js` and `src/api/attentionNarrative.js`. Note: they use `fetch` with credentials, return JSON, throw on non-ok. Mirror this style.

- [ ] **Step 2: Write the wrapper**

Create `src/api/dashboardInbox.js`:

```js
const BASE = '/api/v1/dashboard';

async function jsonFetch(url, init = {}) {
    const res = await fetch(url, { credentials: 'include', ...init });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
    }
    return res.json();
}

export function fetchInbox({ sections, includeArchived = false, signal } = {}) {
    const params = new URLSearchParams();
    if (sections?.length) params.set('sections', sections.join(','));
    if (includeArchived) params.set('include_archived', '1');
    const qs = params.toString();
    return jsonFetch(`${BASE}/inbox${qs ? `?${qs}` : ''}`, { signal });
}

export function archiveInboxItem(itemId) {
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/archive`, { method: 'POST' });
}

export function restoreInboxItem(itemId) {
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/restore`, { method: 'POST' });
}

export function snoozeInboxItem(itemId, untilIso) {
    return jsonFetch(`${BASE}/inbox/${encodeURIComponent(itemId)}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: untilIso }),
    });
}
```

- [ ] **Step 3: Commit (no test yet — covered indirectly by hook test in Task 13)**

```bash
git add src/api/dashboardInbox.js
git commit -m "feat(dashboard): frontend API wrapper for inbox endpoints"
```

---

## Task 13: Hook `src/hooks/useInbox.js` with optimistic mutations

**Files:**
- Create: `src/hooks/useInbox.js`
- Create: `tests/hooks/useInbox.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useInbox.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInbox } from '../../src/hooks/useInbox';
import * as api from '../../src/api/dashboardInbox';

vi.mock('../../src/api/dashboardInbox');

describe('useInbox', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('loads inbox sections on mount', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.sections[0].items).toHaveLength(1);
    });

    it('optimistically removes item on archive', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        api.archiveInboxItem.mockResolvedValue({ ok: true });

        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.archive('pr:foo/bar#1'); });
        expect(result.current.sections[0].items).toEqual([]);
    });

    it('reverts on archive failure', async () => {
        api.fetchInbox.mockResolvedValue({
            sections: [{ key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1' }] }],
        });
        api.archiveInboxItem.mockRejectedValue(new Error('boom'));

        const { result } = renderHook(() => useInbox());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await expect(result.current.archive('pr:foo/bar#1')).rejects.toThrow('boom');
        });
        expect(result.current.sections[0].items).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useInbox.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useInbox.js`:

```js
import { useCallback, useEffect, useState } from 'react';
import { fetchInbox, archiveInboxItem, restoreInboxItem, snoozeInboxItem } from '../api/dashboardInbox';

const ALL_SECTIONS = ['needs_review', 'my_prs', 'mentions', 'failing_ci', 'stale_drafts', 'dependabot_ready'];

export function useInbox({ sections = ALL_SECTIONS } = {}) {
    const [data, setData] = useState({ sections: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchInbox({ sections });
            setData(res);
            setError(null);
        } catch (e) {
            setError(e);
        } finally {
            setLoading(false);
        }
    }, [sections]);

    useEffect(() => { refresh(); }, [refresh]);

    function removeLocally(itemId) {
        setData(prev => ({
            sections: prev.sections.map(s => ({
                ...s,
                items: s.items.filter(i => i.id !== itemId),
            })),
        }));
    }

    const archive = useCallback(async (itemId) => {
        const snapshot = data;
        removeLocally(itemId);
        try {
            await archiveInboxItem(itemId);
        } catch (e) {
            setData(snapshot); // revert
            throw e;
        }
    }, [data]);

    const snooze = useCallback(async (itemId, untilIso) => {
        const snapshot = data;
        removeLocally(itemId);
        try {
            await snoozeInboxItem(itemId, untilIso);
        } catch (e) {
            setData(snapshot);
            throw e;
        }
    }, [data]);

    const restore = useCallback(async (itemId) => {
        await restoreInboxItem(itemId);
        await refresh();
    }, [refresh]);

    return {
        sections: data.sections,
        loading,
        error,
        refresh,
        archive,
        snooze,
        restore,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useInbox.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useInbox.js tests/hooks/useInbox.test.jsx
git commit -m "feat(dashboard): useInbox hook with optimistic archive/snooze"
```

---

## Task 14: Add design tokens for row expand + status palette + reduced motion

**Files:**
- Modify: `src/design-system.css`

- [ ] **Step 1: Read the file's existing token block**

Run: open `src/design-system.css` and locate the `:root` block (around lines 9-79).

- [ ] **Step 2: Add tokens**

Append inside the `:root` block, near other easing tokens:

```css
  /* Premium dashboard tokens (Phase 1 — inbox) */
  --ds-status-success: #22c55e;
  --ds-status-warning: #f59e0b;
  --ds-status-danger:  #ef4444;
  --ds-status-neutral: #94a3b8;

  --ds-ease-row-expand:    cubic-bezier(0.32, 0.72, 0, 1);
  --ds-duration-row-expand: 280ms;
```

Append at the bottom of the file (outside `:root`):

```css
@media (prefers-reduced-motion: reduce) {
    :root {
        --ds-transition-standard: 0.01s linear;
        --ds-transition-fast: 0.01s linear;
        --ds-transition-slow: 0.01s linear;
        --ds-duration-row-expand: 0.01s;
    }
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/design-system.css
git commit -m "feat(ds): row-expand + status palette + reduced-motion tokens"
```

---

## Task 15: Component `InboxRow.jsx`

**Files:**
- Create: `src/components/Dashboard/Premium/InboxRow.jsx`
- Create: `tests/components/Dashboard/Premium/InboxRow.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/Dashboard/Premium/InboxRow.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InboxRow } from '../../../../src/components/Dashboard/Premium/InboxRow';

const ITEM = {
    id: 'pr:foo/bar#1',
    kind: 'pr',
    section: 'needs_review',
    repoFullName: 'foo/bar',
    prNumber: 1,
    title: 'feat: add widget',
    authorLogin: 'alice',
    since: '2026-05-09T00:00:00Z',
};

describe('InboxRow', () => {
    it('renders title, repo, and author', () => {
        render(<InboxRow item={ITEM} />);
        expect(screen.getByText('feat: add widget')).toBeInTheDocument();
        expect(screen.getByText('foo/bar')).toBeInTheDocument();
        expect(screen.getByText(/alice/)).toBeInTheDocument();
    });

    it('calls onArchive when archive button clicked', () => {
        const onArchive = vi.fn();
        render(<InboxRow item={ITEM} onArchive={onArchive} />);
        fireEvent.click(screen.getByLabelText(/archive/i));
        expect(onArchive).toHaveBeenCalledWith('pr:foo/bar#1');
    });

    it('toggles expanded state on chevron click', () => {
        render(<InboxRow item={ITEM} />);
        const chevron = screen.getByLabelText(/expand/i);
        expect(chevron).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(chevron);
        expect(chevron).toHaveAttribute('aria-expanded', 'true');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxRow.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement InboxRow**

Create `src/components/Dashboard/Premium/InboxRow.jsx`:

```jsx
import { useState } from 'react';
import { Archive, Clock, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../../../utils/format';

const KIND_LABEL = { pr: 'PR', issue: 'Issue' };

export function InboxRow({ item, onArchive, onSnooze, onSelect, narrative = null }) {
    const [expanded, setExpanded] = useState(false);
    const ago = formatRelativeTime(item.since);

    return (
        <li className="border-b border-zinc-200/60 dark:border-zinc-800/60">
            <div className="group flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                <button
                    type="button"
                    aria-label={expanded ? 'Collapse row' : 'Expand row'}
                    aria-expanded={expanded}
                    onClick={() => setExpanded(v => !v)}
                    className="shrink-0 text-zinc-400 hover:text-indigo-500"
                    style={{
                        transition: `transform var(--ds-duration-row-expand) var(--ds-ease-row-expand)`,
                        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                >
                    <ChevronRight className="w-4 h-4" />
                </button>

                <button
                    type="button"
                    onClick={() => onSelect?.(item)}
                    className="flex-1 min-w-0 text-left"
                >
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {item.title}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                            {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="ds-font-mono">{item.repoFullName}</span>
                        {item.authorLogin && <span>by {item.authorLogin}</span>}
                        {ago && <span>{ago}</span>}
                    </div>
                </button>

                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                        type="button"
                        aria-label="Snooze item"
                        onClick={() => onSnooze?.(item)}
                        className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                    >
                        <Clock className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        aria-label="Archive item"
                        onClick={() => onArchive?.(item.id)}
                        className="p-1.5 rounded-md text-zinc-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                    >
                        <Archive className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="px-12 pb-3 text-xs text-zinc-600 dark:text-zinc-300">
                    {narrative?.text && (
                        <p className="italic text-indigo-700 dark:text-indigo-300">{narrative.text}</p>
                    )}
                    {!narrative?.text && (
                        <p className="text-zinc-500">No AI summary available for this item.</p>
                    )}
                </div>
            )}
        </li>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxRow.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/Premium/InboxRow.jsx tests/components/Dashboard/Premium/InboxRow.test.jsx
git commit -m "feat(dashboard): InboxRow component with expand-in-place"
```

---

## Task 16: Component `InboxSection.jsx` (sidebar entry)

**Files:**
- Create: `src/components/Dashboard/Premium/InboxSection.jsx`
- Create: `tests/components/Dashboard/Premium/InboxSection.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InboxSection } from '../../../../src/components/Dashboard/Premium/InboxSection';

describe('InboxSection', () => {
    it('shows label and count', () => {
        render(<InboxSection label="Needs my review" count={3} active={false} onClick={() => {}} />);
        expect(screen.getByText('Needs my review')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders the active state with full opacity', () => {
        render(<InboxSection label="Mentions" count={1} active onClick={() => {}} />);
        const btn = screen.getByRole('button');
        expect(btn.getAttribute('aria-current')).toBe('true');
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<InboxSection label="Mentions" count={1} active={false} onClick={onClick} />);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxSection.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement InboxSection**

Create `src/components/Dashboard/Premium/InboxSection.jsx`:

```jsx
export function InboxSection({ label, count = 0, active = false, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'true' : 'false'}
            className={[
                'group w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                active
                    ? 'bg-indigo-500/10 text-zinc-900 dark:text-zinc-50 font-medium'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900/40',
            ].join(' ')}
        >
            <span className="truncate">{label}</span>
            <span
                className={[
                    'shrink-0 inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] font-semibold ds-font-mono tabular-nums',
                    count > 0
                        ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                        : 'bg-zinc-200/60 dark:bg-zinc-800 text-zinc-500',
                ].join(' ')}
            >
                {count}
            </span>
        </button>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxSection.test.jsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/Premium/InboxSection.jsx tests/components/Dashboard/Premium/InboxSection.test.jsx
git commit -m "feat(dashboard): InboxSection sidebar entry"
```

---

## Task 17: Component `SnoozeModal.jsx` with presets

**Files:**
- Create: `src/components/Dashboard/Premium/SnoozeModal.jsx`
- Create: `tests/components/Dashboard/Premium/SnoozeModal.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SnoozeModal } from '../../../../src/components/Dashboard/Premium/SnoozeModal';

describe('SnoozeModal', () => {
    it('returns ISO timestamp from preset selection', () => {
        const onConfirm = vi.fn();
        render(<SnoozeModal open onConfirm={onConfirm} onClose={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /1 hour/i }));
        expect(onConfirm).toHaveBeenCalledOnce();
        const arg = onConfirm.mock.calls[0][0];
        expect(typeof arg).toBe('string');
        expect(Date.parse(arg)).toBeGreaterThan(Date.now() + 50 * 60_000);
    });

    it('does not render when closed', () => {
        render(<SnoozeModal open={false} onConfirm={() => {}} onClose={() => {}} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/Premium/SnoozeModal.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SnoozeModal**

Create `src/components/Dashboard/Premium/SnoozeModal.jsx`:

```jsx
import { useEffect } from 'react';

function in1Hour() { return new Date(Date.now() + 60 * 60_000).toISOString(); }
function tomorrow9am() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString();
}
function nextMonday9am() {
    const d = new Date();
    const daysUntilMon = (1 + 7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMon); d.setHours(9, 0, 0, 0);
    return d.toISOString();
}
function in1Week() { return new Date(Date.now() + 7 * 86400_000).toISOString(); }

const PRESETS = [
    { label: '1 hour', iso: in1Hour },
    { label: 'Tomorrow 9am', iso: tomorrow9am },
    { label: 'Next Monday', iso: nextMonday9am },
    { label: '1 week', iso: in1Week },
];

export function SnoozeModal({ open, onConfirm, onClose }) {
    useEffect(() => {
        if (!open) return undefined;
        function onKey(e) { if (e.key === 'Escape') onClose?.(); }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[var(--ds-z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-4 ds-font-display">
                    Snooze until…
                </h3>
                <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map(p => (
                        <button
                            key={p.label}
                            type="button"
                            onClick={() => { onConfirm(p.iso()); onClose?.(); }}
                            className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-200"
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 w-full text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/Premium/SnoozeModal.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/Premium/SnoozeModal.jsx tests/components/Dashboard/Premium/SnoozeModal.test.jsx
git commit -m "feat(dashboard): SnoozeModal with four presets"
```

---

## Task 18: Component `InboxPanel.jsx` (composition + keyboard shortcuts)

**Files:**
- Create: `src/components/Dashboard/Premium/InboxPanel.jsx`
- Create: `tests/components/Dashboard/Premium/InboxPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InboxPanel } from '../../../../src/components/Dashboard/Premium/InboxPanel';
import * as api from '../../../../src/api/dashboardInbox';

vi.mock('../../../../src/api/dashboardInbox');

describe('InboxPanel', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        api.fetchInbox.mockResolvedValue({
            sections: [
                { key: 'needs_review', label: 'Needs my review', items: [{ id: 'pr:foo/bar#1', kind: 'pr', section: 'needs_review', title: 't', repoFullName: 'foo/bar' }] },
                { key: 'my_prs', label: 'My open PRs', items: [] },
            ],
        });
    });

    it('renders sidebar with section counts', async () => {
        render(<InboxPanel />);
        await waitFor(() => expect(screen.getByText('Needs my review')).toBeInTheDocument());
        expect(screen.getByText('1')).toBeInTheDocument(); // count
    });

    it('filters list when a section is clicked', async () => {
        render(<InboxPanel />);
        await waitFor(() => screen.getByText('Needs my review'));
        fireEvent.click(screen.getByRole('button', { name: /my open prs/i }));
        // After switching to empty section, "No items" message renders
        expect(screen.getByText(/no items/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxPanel.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement InboxPanel**

Create `src/components/Dashboard/Premium/InboxPanel.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useInbox } from '../../../hooks/useInbox';
import { InboxRow } from './InboxRow';
import { InboxSection } from './InboxSection';
import { SnoozeModal } from './SnoozeModal';
import { Spinner } from '../../ui/Spinner';

export function InboxPanel({ onSelectItem }) {
    const { sections, loading, error, archive, snooze } = useInbox();
    const [activeKey, setActiveKey] = useState(null);
    const [snoozingItem, setSnoozingItem] = useState(null);

    // Default to the first non-empty section once data lands
    useEffect(() => {
        if (activeKey) return;
        const first = sections.find(s => s.items.length > 0) ?? sections[0];
        if (first) setActiveKey(first.key);
    }, [sections, activeKey]);

    const active = useMemo(
        () => sections.find(s => s.key === activeKey) ?? sections[0],
        [sections, activeKey],
    );

    // Keyboard: 'e' archives the first item of the active section
    useEffect(() => {
        function onKey(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!active?.items?.length) return;
            if (e.key === 'e') archive(active.items[0].id).catch(() => {});
            else if (e.key === 's') setSnoozingItem(active.items[0]);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active, archive]);

    return (
        <section
            aria-labelledby="inbox-panel-title"
            className="rounded-2xl bg-white/85 dark:bg-zinc-900/85 backdrop-blur-xl border border-zinc-200/60 dark:border-zinc-800/60"
        >
            <header className="px-5 pt-5 pb-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
                    <Inbox className="w-3 h-3" /> Live inbox
                </div>
                <h3 id="inbox-panel-title" className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-100 ds-font-display">
                    What needs your eyes
                </h3>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr]">
                <nav aria-label="Inbox sections" className="px-3 py-3 space-y-1 border-r border-zinc-200/60 dark:border-zinc-800/60">
                    {sections.map(s => (
                        <InboxSection
                            key={s.key}
                            label={s.label}
                            count={s.items.length}
                            active={s.key === activeKey}
                            onClick={() => setActiveKey(s.key)}
                        />
                    ))}
                </nav>

                <div className="min-h-[200px]">
                    {loading && <div className="p-6 flex justify-center"><Spinner size="md" /></div>}
                    {error && <p className="p-6 text-sm text-red-600">{String(error.message || error)}</p>}
                    {!loading && !error && active && active.items.length === 0 && (
                        <p className="p-6 text-sm text-zinc-500">No items in this section.</p>
                    )}
                    {!loading && !error && active && active.items.length > 0 && (
                        <ul>
                            {active.items.map(item => (
                                <InboxRow
                                    key={item.id}
                                    item={item}
                                    onArchive={(id) => archive(id).catch(() => {})}
                                    onSnooze={setSnoozingItem}
                                    onSelect={onSelectItem}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <SnoozeModal
                open={!!snoozingItem}
                onConfirm={(iso) => snoozingItem && snooze(snoozingItem.id, iso).catch(() => {})}
                onClose={() => setSnoozingItem(null)}
            />
        </section>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxPanel.test.jsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/Premium/InboxPanel.jsx tests/components/Dashboard/Premium/InboxPanel.test.jsx
git commit -m "feat(dashboard): InboxPanel composition with keyboard shortcuts"
```

---

## Task 19: Feature flag helper + wire InboxPanel into `DashboardPremium.jsx`

**Files:**
- Create: `src/lib/featureFlags.js` (only if missing — check first)
- Modify: `src/components/Dashboard/DashboardPremium.jsx`

- [ ] **Step 1: Check for existing flag helper**

Run: `ls src/lib/featureFlags*`
If exists: open it, reuse `isEnabled` / `setFlag` API. If not: create.

- [ ] **Step 2: Create the helper if missing**

`src/lib/featureFlags.js`:

```js
const PREFIX = 'dashboard_premium_v2_';

export function isEnabled(flag) {
    try { return localStorage.getItem(PREFIX + flag) === '1'; }
    catch { return false; }
}

export function setFlag(flag, on) {
    try {
        if (on) localStorage.setItem(PREFIX + flag, '1');
        else localStorage.removeItem(PREFIX + flag);
    } catch { /* no-op */ }
}
```

- [ ] **Step 3: Wire into DashboardPremium.jsx**

Open `src/components/Dashboard/DashboardPremium.jsx`. Add at the top of the imports:

```jsx
import { InboxPanel } from './Premium/InboxPanel';
import { isEnabled } from '../../lib/featureFlags';
```

Find the spot where `<AttentionFeed />` is currently rendered in the JSX. Replace it (or add adjacent) with:

```jsx
{isEnabled('inbox') ? (
    <InboxPanel onSelectItem={onSelectInboxItem} />
) : (
    <AttentionFeed onSelectRepo={onSelectRepo} />
)}
```

If `onSelectInboxItem` doesn't exist as a prop, add a simple inline handler that navigates to the repo URL. Add adjacent to the existing AttentionFeed prop wiring.

- [ ] **Step 4: Manual verification**

Run dev server (`npm run dev`), open browser console: `localStorage.setItem('dashboard_premium_v2_inbox', '1')`, reload. Confirm InboxPanel renders. Then `localStorage.removeItem('dashboard_premium_v2_inbox')`, reload — old AttentionFeed renders.

- [ ] **Step 5: Commit**

```bash
git add src/lib/featureFlags.js src/components/Dashboard/DashboardPremium.jsx
git commit -m "feat(dashboard): wire InboxPanel behind dashboard_premium_v2_inbox flag"
```

---

## Task 20: E2E test — archive flow

**Files:**
- Create: `e2e/dashboard-inbox.spec.js`

- [ ] **Step 1: Inspect an existing e2e for the project's test fixtures**

Open `e2e/work-board.spec.js` (or similar) to see how the project mocks GitHub auth + seeds DB for e2e. Mirror it.

- [ ] **Step 2: Write the e2e test**

Create `e2e/dashboard-inbox.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.describe('Live Inbox', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => localStorage.setItem('dashboard_premium_v2_inbox', '1'));
        await page.reload();
    });

    test('archive button removes the row', async ({ page }) => {
        await page.waitForSelector('text=What needs your eyes');
        const firstRowTitle = await page.locator('section[aria-labelledby="inbox-panel-title"] li').first().innerText();
        await page.locator('section[aria-labelledby="inbox-panel-title"] li').first()
            .getByLabel('Archive item').click();
        await expect(page.locator('section[aria-labelledby="inbox-panel-title"]')).not.toContainText(firstRowTitle);
    });

    test('keyboard shortcut "e" archives the first item', async ({ page }) => {
        await page.waitForSelector('text=What needs your eyes');
        const firstRowTitle = await page.locator('section[aria-labelledby="inbox-panel-title"] li').first().innerText();
        await page.keyboard.press('e');
        await expect(page.locator('section[aria-labelledby="inbox-panel-title"]')).not.toContainText(firstRowTitle);
    });
});
```

- [ ] **Step 3: Run the e2e test**

Run: `npx playwright test e2e/dashboard-inbox.spec.js`
Expected: PASS (2/2). If your local dev environment requires GitHub OAuth, run with the project's mock-mode env (`VITE_MOCK_MODE=1`).

If the project requires DB seeding for the inbox to have any rows, add a seed step in the `beforeEach` calling a test-only endpoint that inserts a review_assignment for the mock user — follow the pattern used in existing e2e specs.

- [ ] **Step 4: Commit**

```bash
git add e2e/dashboard-inbox.spec.js
git commit -m "test(e2e): inbox archive flow + keyboard shortcut"
```

---

## Task 21: E2E test — snooze flow

**Files:**
- Modify: `e2e/dashboard-inbox.spec.js`

- [ ] **Step 1: Add test**

Append to `e2e/dashboard-inbox.spec.js`:

```js
test('snooze modal preset hides the row from default view', async ({ page }) => {
    await page.waitForSelector('text=What needs your eyes');
    const firstRowTitle = await page.locator('section[aria-labelledby="inbox-panel-title"] li').first().innerText();
    await page.locator('section[aria-labelledby="inbox-panel-title"] li').first()
        .getByLabel('Snooze item').click();
    await page.getByRole('button', { name: '1 hour' }).click();
    await expect(page.locator('section[aria-labelledby="inbox-panel-title"]')).not.toContainText(firstRowTitle);
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npx playwright test e2e/dashboard-inbox.spec.js -g snooze`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/dashboard-inbox.spec.js
git commit -m "test(e2e): inbox snooze flow with 1-hour preset"
```

---

## Task 22: Reduced-motion verification test

**Files:**
- Modify: `tests/components/Dashboard/Premium/InboxRow.test.jsx`

- [ ] **Step 1: Write the test**

Append:

```jsx
it('honours prefers-reduced-motion with reduced transition duration', () => {
    const mql = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
    window.matchMedia = vi.fn().mockReturnValue(mql);

    document.documentElement.style.setProperty('--ds-duration-row-expand', '0.01s');

    render(<InboxRow item={ITEM} />);
    const chevron = screen.getByLabelText(/expand/i);
    const style = window.getComputedStyle(chevron);
    expect(style.transition).toContain('0.01s');
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxRow.test.jsx -t reduced-motion`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/components/Dashboard/Premium/InboxRow.test.jsx
git commit -m "test(dashboard): verify reduced-motion duration override"
```

---

## Task 23: AI narrative wiring on top 3 inbox items

**Files:**
- Modify: `src/components/Dashboard/Premium/InboxPanel.jsx`
- Modify: `tests/components/Dashboard/Premium/InboxPanel.test.jsx`

The spec calls for the top three items of the *active* section to be annotated with an AI narrative via the existing `/ai/attention-narrative` endpoint, gated by `useAIQuotaState`. Reuses the exact pattern already in `src/components/Dashboard/AttentionFeed.jsx` (removed in September 2026).

- [ ] **Step 1: Write the failing test**

Append to `tests/components/Dashboard/Premium/InboxPanel.test.jsx`:

```jsx
import * as narrativeApi from '../../../../src/api/attentionNarrative';
import * as aiStatusModule from '../../../../src/hooks/useAIStatus';
import * as aiQuotaModule from '../../../../src/hooks/useAIQuotaState';

vi.mock('../../../../src/api/attentionNarrative');
vi.mock('../../../../src/hooks/useAIStatus');
vi.mock('../../../../src/hooks/useAIQuotaState');

describe('InboxPanel — AI narrative fan-out', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        aiStatusModule.useAIStatus.mockReturnValue({ configured: true, keyOk: true });
        aiQuotaModule.useAIQuotaState.mockReturnValue(null); // quota OK
        api.fetchInbox.mockResolvedValue({
            sections: [{
                key: 'needs_review',
                label: 'Needs my review',
                items: [
                    { id: 'pr:a/b#1', kind: 'pr', section: 'needs_review', title: 't1', repoFullName: 'a/b' },
                    { id: 'pr:a/b#2', kind: 'pr', section: 'needs_review', title: 't2', repoFullName: 'a/b' },
                    { id: 'pr:a/b#3', kind: 'pr', section: 'needs_review', title: 't3', repoFullName: 'a/b' },
                    { id: 'pr:a/b#4', kind: 'pr', section: 'needs_review', title: 't4', repoFullName: 'a/b' },
                ],
            }],
        });
        narrativeApi.fetchAttentionNarrative.mockResolvedValue({ narrative: 'AI says hello' });
    });

    it('fetches narratives only for the top 3 items of the active section', async () => {
        render(<InboxPanel />);
        await waitFor(() => expect(narrativeApi.fetchAttentionNarrative).toHaveBeenCalledTimes(3));
        const calls = narrativeApi.fetchAttentionNarrative.mock.calls.map(c => c[0].repo);
        expect(calls).toEqual(['a/b', 'a/b', 'a/b']);
    });

    it('skips fetch when AI not configured', async () => {
        aiStatusModule.useAIStatus.mockReturnValue({ configured: false, keyOk: false });
        render(<InboxPanel />);
        await waitFor(() => expect(api.fetchInbox).toHaveBeenCalled());
        expect(narrativeApi.fetchAttentionNarrative).not.toHaveBeenCalled();
    });

    it('skips fetch when quota is exhausted', async () => {
        aiQuotaModule.useAIQuotaState.mockReturnValue({ used: 100, limit: 100, resetAt: '2026-06-01' });
        render(<InboxPanel />);
        await waitFor(() => expect(api.fetchInbox).toHaveBeenCalled());
        expect(narrativeApi.fetchAttentionNarrative).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxPanel.test.jsx -t narrative`
Expected: FAIL — narrative API not called.

- [ ] **Step 3: Wire narratives into InboxPanel**

Edit `src/components/Dashboard/Premium/InboxPanel.jsx`. Add to imports:

```jsx
import { fetchAttentionNarrative } from '../../../api/attentionNarrative';
import { AIQuotaExceededError } from '../../../api/aiFetch';
import { useAIStatus } from '../../../hooks/useAIStatus';
import { useAIQuotaState } from '../../../hooks/useAIQuotaState';
```

Add a constant near the top of the file:

```js
const NARRATIVE_TOP_N = 3;
```

Inside the `InboxPanel` function, after the `active` memo and before the keyboard `useEffect`, add:

```jsx
const { configured, keyOk } = useAIStatus();
const quota = useAIQuotaState();
const [narratives, setNarratives] = useState({});

useEffect(() => {
    if (!active?.items?.length || !configured || !keyOk || quota) {
        setNarratives({});
        return undefined;
    }
    const top = active.items.slice(0, NARRATIVE_TOP_N);
    const ctrl = new AbortController();
    let cancelled = false;

    const loadingMap = {};
    for (const it of top) loadingMap[it.id] = { text: null, loading: true };
    setNarratives(loadingMap);

    (async () => {
        const next = {};
        let bailed = false;
        for (const it of top) {
            if (cancelled) return;
            if (bailed) { next[it.id] = { text: null, loading: false }; continue; }
            try {
                const data = await fetchAttentionNarrative({
                    repo: it.repoFullName,
                    kind: it.kind,
                    signalPayload: { title: it.title, since: it.since },
                    abortSignal: ctrl.signal,
                });
                next[it.id] = { text: data?.narrative ?? null, loading: false };
            } catch (err) {
                if (err instanceof AIQuotaExceededError) bailed = true;
                next[it.id] = { text: null, loading: false };
            }
        }
        if (!cancelled) setNarratives(next);
    })();

    return () => { cancelled = true; ctrl.abort(); };
}, [active, configured, keyOk, quota]);
```

Then update the row-rendering JSX to pass the narrative through:

```jsx
{active.items.map((item, idx) => (
    <InboxRow
        key={item.id}
        item={item}
        narrative={idx < NARRATIVE_TOP_N ? (narratives[item.id] ?? null) : null}
        onArchive={(id) => archive(id).catch(() => {})}
        onSnooze={setSnoozingItem}
        onSelect={onSelectItem}
    />
))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/Dashboard/Premium/InboxPanel.test.jsx`
Expected: PASS (all in file).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard/Premium/InboxPanel.jsx tests/components/Dashboard/Premium/InboxPanel.test.jsx
git commit -m "feat(dashboard): AI narrative on inbox top 3 items"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `npx vitest run`
Expected: all green, no new flakes.

- [ ] **Run the inbox e2e suite**

Run: `npx playwright test e2e/dashboard-inbox.spec.js`
Expected: all green.

- [ ] **Lint + build**

Run: `npm run lint && npm run build`
Expected: no new warnings, build succeeds.

- [ ] **Bundle budget check**

Run: `npm run build` and inspect `dist/` for the dashboard chunk size. Expected delta vs `main`: < 30 KB gzipped.

- [ ] **Manual smoke**

1. Enable flag: `localStorage.setItem('dashboard_premium_v2_inbox', '1')` then reload.
2. Confirm InboxPanel renders with sidebar of 6 sections.
3. Hover over a row; archive + snooze buttons appear.
4. Click archive → row disappears.
5. Switch section in sidebar; counts update.
6. Press `e` with focus outside any input → first row archives.
7. With OS reduced-motion on, no chevron rotation animation.

---

## Out of scope (Phase 1)

The following items from the spec are deferred to later phases and explicitly NOT in this plan:

- `failing_ci` section live wiring beyond placeholder empty array (requires gh-cache integration for CI status — comes with DORA card phase, since both leverage workflow data)
- `dependabot_ready` section live wiring (requires repos-security read path adaptation — separate small follow-up)
- DORA card UI + endpoint wrapper (Phase 2)
- Service Scorecard ring + drawer + Fix endpoints (Phase 3)
- Visual regression Playwright screenshots (Phase 4)
