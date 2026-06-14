# Dashboard Live Inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dashboard "Live Inbox" reflect live GitHub state (so the user's real open PRs / review requests / assigned issues appear) by reusing the Work Board's live-search + webhook-fallback pattern.

**Architecture:** Add the one missing live fetcher (`fetchMyOpenPRs`), then convert `composeInbox` to async hybrid: with a GitHub token it sources each section from live GitHub Search; without one it falls back to the existing webhook/DB queries. The item id scheme, archive/snooze filtering, priority dedup, and response shape are unchanged. Backend-only; no frontend change.

**Tech Stack:** Express, better-sqlite3, GitHub Search API via `githubApi()`, Vitest (node env, in-memory SQLite integration tests).

**Spec:** [docs/specs/2026-06-14-dashboard-live-inbox-design.md](../specs/2026-06-14-dashboard-live-inbox-design.md)

**Branch:** create `feat/dashboard-live-inbox` off `main` before Task 1. (Separate from the open migration PR #158.)

---

## File Structure

- Modify `server/lib/work-board-github.js` — add `fetchMyOpenPRs` (live `author:<login> is:open is:pr` search).
- Modify `server/lib/dashboard-aggregator.js` — `composeInbox` becomes async + hybrid; replace `SECTION_BUILDERS`/`SECTION_LABEL` with a `SECTION_CONFIG` map (live fetcher + DB fallback + shared row→item mapper per section).
- Modify `server/routes/dashboard.js` — `/inbox` handler becomes async, passes `token` + `logger`.
- Modify `server/__tests__/work-board-github.test.js` — test the new fetcher.
- Modify `server/__tests__/dashboard-aggregator.test.js` — `await` existing calls (now async); add live-path, fallback, and per-section-failure tests.
- Check `server/__tests__/dashboard-routes.test.js` — keep green (route now async).

---

## Task 1: Add `fetchMyOpenPRs` live fetcher

**Files:**
- Modify: `server/lib/work-board-github.js`
- Test: `server/__tests__/work-board-github.test.js`

- [ ] **Step 1: Write the failing test**

In `server/__tests__/work-board-github.test.js`, add `fetchMyOpenPRs` to the destructured import from `../lib/work-board-github.js` (the list at the top, alongside `fetchMyPendingReviews`), then add these tests inside the `describe('work-board-github', ...)` block:

```js
    it('fetchMyOpenPRs builds the right search query', async () => {
        mockGithubApi.mockResolvedValue(makeSearchResult([]));
        await fetchMyOpenPRs({ token: 'tok', login: 'alice' });
        const [path, token] = mockGithubApi.mock.calls[0];
        expect(token).toBe('tok');
        expect(path).toContain('/search/issues');
        expect(path).toContain('author%3Aalice');
        expect(path).toContain('is%3Aopen');
        expect(path).toContain('is%3Apr');
        expect(path).toContain('archived%3Afalse');
    });

    it('fetchMyOpenPRs normalises items (repoFullName, prNumber, title, authorLogin, openedAt)', async () => {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();
        mockGithubApi.mockResolvedValue(makeSearchResult([
            githubIssue({ number: 158, title: 'feat: thing', login: 'alice', repo: 'org/repo',
                createdAt: oneHourAgo, updatedAt: oneHourAgo, isPR: true }),
        ]));
        const result = await fetchMyOpenPRs({ token: 'tok', login: 'alice' });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            repoFullName: 'org/repo',
            prNumber: 158,
            title: 'feat: thing',
            authorLogin: 'alice',
        });
        expect(result.items[0].openedAt).toBe(oneHourAgo);
        expect(result.totalCount).toBe(1);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/work-board-github.test.js`
Expected: FAIL — `fetchMyOpenPRs is not a function` (not exported).

- [ ] **Step 3: Add the fetcher**

In `server/lib/work-board-github.js`, add after `fetchMyPendingReviews` (in the "Public fetchers" section):

```js
export async function fetchMyOpenPRs({ token, login, limit = 100 }) {
    const q = `author:${login} is:open is:pr archived:false`;
    const r = await callSearch({ token, q, perPage: limit });
    return { ...r, items: r.items.map(normalisePR) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/work-board-github.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add server/lib/work-board-github.js server/__tests__/work-board-github.test.js
git commit -m "feat(work-board): add fetchMyOpenPRs live search fetcher"
```

---

## Task 2: Make `composeInbox` async + hybrid (live-first, webhook fallback)

**Files:**
- Modify: `server/lib/dashboard-aggregator.js`
- Test: `server/__tests__/dashboard-aggregator.test.js`

- [ ] **Step 1: Update existing tests to await (they will fail once composeInbox is async)**

In `server/__tests__/dashboard-aggregator.test.js`, every `it(...)` callback that calls `composeInbox(...)` must become `async` and `await` the call. Concretely, change each occurrence of `const result = composeInbox(` to `const result = await composeInbox(`, and each inline `composeInbox(USER_ID, {...}).sections[...]` to `(await composeInbox(USER_ID, {...})).sections[...]`, marking the enclosing `it('...', () => {...})` as `it('...', async () => {...})`. These tests pass NO `token`, so they exercise the fallback (DB) path and their assertions remain valid.

Also add a controllable mock of the live fetchers at the top of the file (after the existing `vi.mock('../db.js', ...)` line, before the `composeInbox` import):

```js
const mockFetchMyPendingReviews = vi.fn();
const mockFetchMyOpenPRs = vi.fn();
const mockFetchMyOpenIssues = vi.fn();
const mockFetchStalePRs = vi.fn();
vi.mock('../lib/work-board-github.js', () => ({
    fetchMyPendingReviews: (...a) => mockFetchMyPendingReviews(...a),
    fetchMyOpenPRs: (...a) => mockFetchMyOpenPRs(...a),
    fetchMyOpenIssues: (...a) => mockFetchMyOpenIssues(...a),
    fetchStalePRs: (...a) => mockFetchStalePRs(...a),
}));
```

(The existing no-token tests never hit these mocks, so they stay green.)

- [ ] **Step 2: Add new live-path tests**

Append to `server/__tests__/dashboard-aggregator.test.js`:

```js
describe('composeInbox — live (token) path', () => {
    beforeEach(() => {
        mockFetchMyPendingReviews.mockReset();
        mockFetchMyOpenPRs.mockReset();
        mockFetchMyOpenIssues.mockReset();
        mockFetchStalePRs.mockReset();
        db.prepare('DELETE FROM pr_events').run();
        db.prepare('DELETE FROM review_assignments').run();
        db.prepare('DELETE FROM issue_events').run();
        db.prepare('DELETE FROM dashboard_inbox_state').run();
    });

    it('my_prs uses the live fetcher when a token is present (ignores empty DB)', async () => {
        mockFetchMyOpenPRs.mockResolvedValue({ items: [
            { repoFullName: 'org/live', prNumber: 158, title: 'live PR', authorLogin: LOGIN,
              openedAt: '2026-06-14T00:00:00Z', ageHours: 1 },
        ], totalCount: 1 });

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, token: 'tok', sections: ['my_prs'] });

        expect(mockFetchMyOpenPRs).toHaveBeenCalledWith({ token: 'tok', login: LOGIN });
        expect(result.sections[0].items[0]).toMatchObject({
            id: 'pr:org/live#158', section: 'my_prs', title: 'live PR',
        });
    });

    it('falls back to the DB query for a section when its live fetch throws', async () => {
        mockFetchMyOpenPRs.mockRejectedValue(new Error('rate limited'));
        db.prepare(`INSERT INTO pr_events
            (repo_id, repo_full_name, pr_number, action, author_login, title, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, 'foo/bar', 7, 'opened', LOGIN, 'db PR', '2026-05-01T00:00:00Z');

        const result = await composeInbox(USER_ID, { userLogin: LOGIN, token: 'tok', sections: ['my_prs'] });

        expect(result.sections[0].items[0]).toMatchObject({ id: 'pr:foo/bar#7', title: 'db PR' });
    });

    it('still applies archive/snooze + dedup on the live path', async () => {
        mockFetchMyPendingReviews.mockResolvedValue({ items: [
            { repoFullName: 'org/live', prNumber: 9, title: 'rev', authorLogin: 'bob',
              requestedAt: '2026-06-14T00:00:00Z', ageHours: 2 },
        ], totalCount: 1 });
        mockFetchMyOpenPRs.mockResolvedValue({ items: [
            { repoFullName: 'org/live', prNumber: 9, title: 'rev', authorLogin: LOGIN,
              openedAt: '2026-06-14T00:00:00Z', ageHours: 2 },
        ], totalCount: 1 });

        const result = await composeInbox(USER_ID, {
            userLogin: LOGIN, token: 'tok', sections: ['needs_review', 'my_prs'],
        });
        const inNeeds = result.sections.find(s => s.key === 'needs_review').items.some(i => i.id === 'pr:org/live#9');
        const inMy = result.sections.find(s => s.key === 'my_prs').items.some(i => i.id === 'pr:org/live#9');
        expect(inNeeds).toBe(true);
        expect(inMy).toBe(false);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: FAIL — existing tests now `await` a still-sync function (so `result` is the object, that's fine) BUT the new live tests fail because `composeInbox` ignores `token` and reads the DB. (If the existing tests error first because the function isn't async yet, that's also an acceptable red — proceed to implement.)

- [ ] **Step 4: Rewrite `composeInbox` as async hybrid**

Replace the body of `server/lib/dashboard-aggregator.js` from the `buildNeedsReview` function through the end of `composeInbox` with the following. Keep the top-of-file imports of `db`, `prKey`, `issueKey`, `loadInboxState`, and the `event-aggregations` functions; ADD the `work-board-github` import.

```js
import {
    fetchMyPendingReviews,
    fetchMyOpenPRs,
    fetchMyOpenIssues,
    fetchStalePRs,
} from './work-board-github.js';

const SECTION_KEYS = ['needs_review', 'my_prs', 'mentions', 'stale_drafts'];

// Priority order — earlier sections "win" ownership of a duplicated id.
const SECTION_PRIORITY = ['needs_review', 'stale_drafts', 'mentions', 'my_prs'];

// Per-section config: a live GitHub-Search fetcher (used when a token is
// present), a webhook/DB fallback (used otherwise or when live errors), and a
// shared row→item mapper. Live and DB sources return the same normalized field
// names, so one mapper serves both.
const SECTION_CONFIG = {
    needs_review: {
        label: 'Needs my review',
        live: ({ token, login }) => fetchMyPendingReviews({ token, login }).then(r => r.items),
        fallback: ({ login }) => listMyPendingReviews({ reviewerLogin: login }),
        map: (r) => ({
            id: prKey(r.repoFullName, r.prNumber), kind: 'pr', section: 'needs_review',
            repoFullName: r.repoFullName, prNumber: r.prNumber, title: r.title,
            authorLogin: r.authorLogin, since: r.requestedAt, ageHours: r.ageHours,
        }),
    },
    my_prs: {
        label: 'My open PRs',
        live: ({ token, login }) => fetchMyOpenPRs({ token, login }).then(r => r.items),
        fallback: ({ login }) => listMyOpenPRs({ authorLogin: login }),
        map: (r) => ({
            id: prKey(r.repoFullName, r.prNumber), kind: 'pr', section: 'my_prs',
            repoFullName: r.repoFullName, prNumber: r.prNumber, title: r.title,
            authorLogin: r.authorLogin, since: r.openedAt, ageHours: r.ageHours,
        }),
    },
    mentions: {
        label: 'Mentions',
        live: ({ token, login }) => fetchMyOpenIssues({ token, login }).then(r => r.items),
        fallback: ({ login }) => listMyOpenIssues({ assigneeLogin: login }),
        map: (r) => ({
            id: issueKey(r.repoFullName, r.issueNumber), kind: 'issue', section: 'mentions',
            repoFullName: r.repoFullName, issueNumber: r.issueNumber, title: r.title,
            since: r.openedAt, ageDays: r.ageDays,
        }),
    },
    stale_drafts: {
        label: 'Stale drafts',
        live: ({ token, login }) => fetchStalePRs({ token, login }).then(r => r.items),
        fallback: ({ login }) => listStalePRs({ staleAfterDays: 7 }).filter(r => r.authorLogin === login),
        map: (r) => ({
            id: prKey(r.repoFullName, r.prNumber), kind: 'pr', section: 'stale_drafts',
            repoFullName: r.repoFullName, prNumber: r.prNumber, title: r.title,
            authorLogin: r.authorLogin, since: r.openedAt, ageDays: r.ageDays,
        }),
    },
};

/**
 * Source one section's items. Live-first when a token is present; on live error
 * (rate limit, network) fall back to the webhook/DB query so one bad section
 * never blanks the whole inbox.
 */
async function sourceSection(key, { token, login, logger }) {
    const cfg = SECTION_CONFIG[key];
    if (token) {
        try {
            const rows = await cfg.live({ token, login });
            return rows.map(cfg.map);
        } catch (err) {
            logger?.warn?.({ err, section: key }, 'inbox live fetch failed; falling back to webhook data');
        }
    }
    return cfg.fallback({ login }).map(cfg.map);
}

/**
 * @param {number} userId
 * @param {object} opts
 * @param {string} opts.userLogin — GitHub login
 * @param {string|null} [opts.token] — GitHub access token; when present, sections use live search
 * @param {string[]} [opts.sections] — subset; defaults to all SECTION_KEYS
 * @param {boolean} [opts.includeArchived=false]
 * @param {object} [opts.logger] — request logger (optional)
 * @returns {Promise<{ sections: Array<{ key, label, items: Array }> }>}
 */
export async function composeInbox(userId, opts = {}) {
    const { userLogin, token = null, sections = SECTION_KEYS, includeArchived = false, logger = null } = opts;
    const requested = sections.filter(k => SECTION_KEYS.includes(k));
    const { archived, snoozedUntil } = loadInboxState(userId);
    const now = Date.now();

    const sourced = await Promise.all(
        requested.map(async key => [key, await sourceSection(key, { token, login: userLogin, logger })]),
    );

    const raw = {};
    for (const [key, items] of sourced) {
        raw[key] = items.filter(item => {
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
            label: SECTION_CONFIG[key].label,
            items: dedupBySection[key] ?? [],
        })),
    };
}
```

Delete the now-unused `buildNeedsReview` function, the old `SECTION_LABEL` const, and the old `SECTION_BUILDERS` const (they are replaced by `SECTION_CONFIG`). Keep `prKey`, `issueKey`, `loadInboxState`, and the `event-aggregations` import (still used by the fallbacks).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js`
Expected: PASS (all existing, now-awaited, tests + the 3 new live tests).

- [ ] **Step 6: Run lint**

Run: `npx eslint server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js`
Expected: clean (0 warnings).

- [ ] **Step 7: Commit**

```bash
git add server/lib/dashboard-aggregator.js server/__tests__/dashboard-aggregator.test.js
git commit -m "feat(dashboard): live-first hybrid inbox with webhook fallback"
```

---

## Task 3: Wire the token through the `/inbox` route

**Files:**
- Modify: `server/routes/dashboard.js`
- Test: `server/__tests__/dashboard-routes.test.js`

- [ ] **Step 1: Read the route test first**

Read `server/__tests__/dashboard-routes.test.js` to learn how it drives `/inbox` (supertest + in-memory db, with or without a session token). If it asserts the inbox response, those sessions almost certainly have no `accessToken`, so they exercise the fallback path and should remain green after the change. Note any test that sets `accessToken` — it will now hit live search and may need the `work-board-github` mock; if so, add the same mock used in Task 2.

- [ ] **Step 2: Make the route async + pass token/logger**

In `server/routes/dashboard.js`, change the `/inbox` handler. Replace:

```js
router.get('/inbox', requireAuth, (req, res) => {
    try {
        const sections = req.query.sections
            ? String(req.query.sections).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const includeArchived = req.query.include_archived === '1';

        const userLogin = req.session.userLogin;
        if (!userLogin) {
            req.log?.warn?.({ userId: req.session.userId }, 'inbox requested with no userLogin in session');
        }
        const result = composeInbox(req.session.userId, {
            userLogin,
            sections,
            includeArchived,
        });
        res.json(result);
    } catch (err) {
        req.log?.error?.({ err }, 'dashboard inbox failed');
        res.status(500).json({ error: safeError(err, 'Failed to compose inbox') });
    }
});
```

with:

```js
router.get('/inbox', requireAuth, async (req, res) => {
    try {
        const sections = req.query.sections
            ? String(req.query.sections).split(',').map(s => s.trim()).filter(Boolean)
            : undefined;
        const includeArchived = req.query.include_archived === '1';

        const userLogin = req.session.userLogin;
        if (!userLogin) {
            req.log?.warn?.({ userId: req.session.userId }, 'inbox requested with no userLogin in session');
        }
        const result = await composeInbox(req.session.userId, {
            userLogin,
            token: req.session.accessToken || null,
            sections,
            includeArchived,
            logger: req.log,
        });
        res.json(result);
    } catch (err) {
        req.log?.error?.({ err }, 'dashboard inbox failed');
        res.status(500).json({ error: safeError(err, 'Failed to compose inbox') });
    }
});
```

(The archive/restore/snooze handlers are unchanged.)

- [ ] **Step 3: Run the route tests**

Run: `npx vitest run server/__tests__/dashboard-routes.test.js`
Expected: PASS. If a test that sets a session `accessToken` now fails because it reaches live search, add the `work-board-github` mock from Task 2 to that test file and give the relevant fetcher a `mockResolvedValue({ items: [], totalCount: 0 })` default in `beforeEach`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/dashboard.js server/__tests__/dashboard-routes.test.js
git commit -m "feat(dashboard): inbox route awaits live composeInbox with token"
```

---

## Final verification

- [ ] **Run the affected backend suites**

Run: `npx vitest run server/__tests__/dashboard-aggregator.test.js server/__tests__/dashboard-routes.test.js server/__tests__/work-board-github.test.js server/__tests__/event-aggregations.test.js`
Expected: all green.

- [ ] **Run the full suite for regressions**

Run: `npx vitest run`
Expected: all green (no regressions; frontend untouched).

- [ ] **Manual smoke (optional, via `/run`)**

Sign in with a GitHub token, open the Dashboard → "My open PRs" should now list real open PRs (e.g. #158); "Needs my review" reflects live `review-requested`. Archive/snooze still work.

---

## Self-Review (completed during authoring)

- **Spec coverage:** new fetcher → Task 1; async hybrid `composeInbox` (all 4 sections, live-first + per-section fallback, id/archive/snooze/dedup preserved) → Task 2; route token wiring → Task 3; testing → tests in every task + final full run. Webhook tables retained (used by fallbacks) — non-goal respected.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `composeInbox(userId, { userLogin, token, sections, includeArchived, logger })` returns a Promise of `{ sections:[{key,label,items}] }`; ids `pr:owner/repo#num` / `issue:owner/repo#num`; `SECTION_CONFIG` keys match `SECTION_KEYS`/`SECTION_PRIORITY`; live fetchers (`fetchMyPendingReviews`/`fetchMyOpenPRs`/`fetchMyOpenIssues`/`fetchStalePRs`) and DB fallbacks (`listMyPendingReviews`/`listMyOpenPRs`/`listMyOpenIssues`/`listStalePRs`) consistent across tasks; field names (`requestedAt`/`openedAt`/`ageHours`/`ageDays`) provided by both sources.
