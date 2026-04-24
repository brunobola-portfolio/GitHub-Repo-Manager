# Work Board Premium UX — Phase 6: AI Assistant Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the backend infrastructure for the AI Assistant — feature flag, cost-cap tracking, HMAC-signed diff tokens, heuristic suggestions engine, and 5 new endpoints under `/api/v1/work-board/ai/*`. Frontend integration lands in Phase 7.

**Architecture:** One table (`work_board_ai_spend`), one middleware (`requireWorkBoardAI` gating + cost cap), one HMAC helper (stateless validity tokens for interpret→apply), a deterministic suggestions engine (pattern matches on existing data, no LLM needed for MVP), and five routes. Reuses the existing `createProviderForUser` abstraction from PR #24 work for the LLM calls.

**Tech Stack:** Node 20, Express, better-sqlite3, crypto (HMAC), Vitest 4 + supertest.

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` §5 (AI Assistant opt-in, Layer 4).

**Depends on:** Phases 1-5 (shipped). `createProviderForUser` (`server/lib/ai-provider.js`), `work_board_prefs` table with `ai_assistant_enabled` + `ai_monthly_cap_cents` columns.

**Out of scope for Phase 6:**
- `/ai/plan-my-day` SSE streaming (Phase 7, paired with palette UI)
- `/ai/suggest-reviewer`, `/ai/draft-comment`, `/ai/find-similar` (Phase 7)
- LLM-phrased suggestion text (Phase 6 ships pattern-based raw suggestions; Phase 7 wraps them with optional LLM rephrasing)
- i18n locale in prompts (Phase 7 via `ai_response_locale` pref)

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `server/db.js` | Add `work_board_ai_spend` table + index | Modify |
| `server/lib/work-board-ai-hmac.js` | HMAC sign/verify for interpret→apply validity tokens | Create |
| `server/lib/work-board-ai-cost.js` | Record / read monthly AI spend | Create |
| `server/middleware/work-board-ai-gate.js` | Gate requiring feature-flag + user-enabled + cost-cap-ok | Create |
| `server/lib/work-board-suggestions-engine.js` | Deterministic pattern matcher over tracked_repos + undo_log | Create |
| `server/lib/ai-features/work-board-assistant/prompts/v1/interpret.md` | Prompt template for conversational NL→actions | Create |
| `server/lib/ai-features/work-board-assistant/prompts/index.js` | Exports `CURRENT_VERSION` + `loadPrompt(name)` | Create |
| `server/routes/work-board-ai.js` | Express router for `/ai/*` endpoints | Create |
| `server/routes/v1/index.js` | Mount the new router at `/work-board/ai` | Modify |
| `server/__tests__/work-board-ai-hmac.test.js` | Unit tests for HMAC helper | Create |
| `server/__tests__/work-board-ai-cost.test.js` | Unit tests for cost tracking | Create |
| `server/__tests__/work-board-ai-gate.test.js` | Middleware tests (env flag, user pref, cap) | Create |
| `server/__tests__/work-board-suggestions-engine.test.js` | Pattern engine tests | Create |
| `server/__tests__/work-board-ai-routes.test.js` | Integration tests for routes | Create |

---

## Branching

Direct push to `main` (established workflow from Phases 2+).

---

## Task 1: Schema — work_board_ai_spend

**Files:**
- Modify: `server/db.js`

### Scene

Monthly spend tracking per user. Row per user per month (`YYYY-MM`). Primary key `(user_id, month)`. `cents` column accumulates via `INSERT ... ON CONFLICT DO UPDATE SET cents = cents + ?`. Last cleaned up manually / never — old rows are tiny.

### Step 1: Locate insertion point

Open `server/db.js`. After the `work_board_undo_log` CREATE TABLE block (from Phase 1), append.

### Step 2: Add table

Inside the same bootstrap block where Phase 1 tables live (around lines 418-467), append:

```javascript
        db.exec(`
            CREATE TABLE IF NOT EXISTS work_board_ai_spend (
                user_id  INTEGER NOT NULL,
                month    TEXT NOT NULL,
                cents    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, month),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_wbai_spend_user_month
                ON work_board_ai_spend(user_id, month);
        `);
```

Match the 12-space indentation of the surrounding Phase 1 blocks.

### Step 3: Verify

```bash
node -e "import('./server/db.js').then(m => console.log(m.default.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'work_board_%'\").all()))"
```

Expected: includes `{ name: 'work_board_ai_spend' }` along with the 4 Phase 1 tables.

### Step 4: Commit + push

```bash
git add server/db.js
git commit -m "feat(work-board): add work_board_ai_spend table"
git push origin main
```

---

## Task 2: HMAC validity token helper

**Files:**
- Create: `server/lib/work-board-ai-hmac.js`
- Create: `server/__tests__/work-board-ai-hmac.test.js`

### Scene

Stateless sign/verify of action diffs. Frontend calls `/ai/interpret` → server returns a diff + HMAC token. User clicks Apply → frontend sends the token back to `/ai/apply` → server verifies.

Key: env var `AI_DIFF_SIGNING_KEY` (any 32+ char string). Fallback: derive from `SESSION_SECRET` via SHA-256. Token format: `base64url(JSON({ user_id, actions_hash, expires_at }))` + `.` + `base64url(hmacSha256(payload))`.

### Step 1: Failing test

Create `server/__tests__/work-board-ai-hmac.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { signDiffToken, verifyDiffToken } from '../lib/work-board-ai-hmac.js';

beforeEach(() => {
    process.env.AI_DIFF_SIGNING_KEY = 'test-key-32-chars-minimum-for-hmac';
});

describe('signDiffToken / verifyDiffToken', () => {
    it('round-trips a valid payload', () => {
        const token = signDiffToken({ userId: 123, actions: [{ repo: 'a/b', action: 'mute' }] });
        const result = verifyDiffToken(token);
        expect(result.valid).toBe(true);
        expect(result.payload.userId).toBe(123);
        expect(result.payload.actions).toEqual([{ repo: 'a/b', action: 'mute' }]);
    });

    it('rejects token with tampered payload', () => {
        const token = signDiffToken({ userId: 123, actions: [{ repo: 'a/b', action: 'mute' }] });
        const [, sig] = token.split('.');
        const tampered = Buffer.from(JSON.stringify({ userId: 999, actions: [] })).toString('base64url') + '.' + sig;
        const result = verifyDiffToken(tampered);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('bad_signature');
    });

    it('rejects expired token', () => {
        const token = signDiffToken({ userId: 1, actions: [] }, { ttlSeconds: -10 });
        const result = verifyDiffToken(token);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('expired');
    });

    it('rejects malformed token', () => {
        expect(verifyDiffToken('not-a-token').valid).toBe(false);
        expect(verifyDiffToken('only.one.dot.sep').valid).toBe(false);
    });

    it('signs with SESSION_SECRET fallback if AI_DIFF_SIGNING_KEY missing', () => {
        delete process.env.AI_DIFF_SIGNING_KEY;
        process.env.SESSION_SECRET = 'fallback-session-secret-at-least-32-chars';
        const token = signDiffToken({ userId: 7, actions: [] });
        const result = verifyDiffToken(token);
        expect(result.valid).toBe(true);
    });
});
```

### Step 2: Run → FAIL

### Step 3: Implement

Create `server/lib/work-board-ai-hmac.js`:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stateless HMAC-signed tokens for AI interpret→apply handoff.
 * Zero DB involvement — the token IS the state.
 */

import { createHmac, createHash, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SECONDS = 5 * 60;

function getSigningKey() {
    const explicit = process.env.AI_DIFF_SIGNING_KEY;
    if (explicit && explicit.length >= 32) return explicit;
    const session = process.env.SESSION_SECRET;
    if (session) return createHash('sha256').update(session).digest('hex');
    throw new Error('Missing AI_DIFF_SIGNING_KEY and SESSION_SECRET fallback');
}

function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(str) {
    return Buffer.from(str, 'base64url');
}

/**
 * @param {object} payload — arbitrary JSON-serializable data
 * @param {{ ttlSeconds?: number }} [opts]
 * @returns {string} token of the form `<b64url(payload)>.<b64url(signature)>`
 */
export function signDiffToken(payload, opts = {}) {
    const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const envelope = {
        ...payload,
        expires_at: Date.now() + ttl * 1000,
    };
    const payloadBytes = Buffer.from(JSON.stringify(envelope));
    const key = getSigningKey();
    const sig = createHmac('sha256', key).update(payloadBytes).digest();
    return `${b64urlEncode(payloadBytes)}.${b64urlEncode(sig)}`;
}

/**
 * @param {string} token
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
export function verifyDiffToken(token) {
    if (typeof token !== 'string') return { valid: false, reason: 'not_string' };
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, reason: 'malformed' };

    let payloadBytes, sigBytes;
    try {
        payloadBytes = b64urlDecode(parts[0]);
        sigBytes = b64urlDecode(parts[1]);
    } catch {
        return { valid: false, reason: 'malformed' };
    }

    const key = getSigningKey();
    const expectedSig = createHmac('sha256', key).update(payloadBytes).digest();

    if (sigBytes.length !== expectedSig.length || !timingSafeEqual(sigBytes, expectedSig)) {
        return { valid: false, reason: 'bad_signature' };
    }

    let payload;
    try {
        payload = JSON.parse(payloadBytes.toString('utf8'));
    } catch {
        return { valid: false, reason: 'malformed' };
    }

    if (!Number.isFinite(payload.expires_at) || payload.expires_at < Date.now()) {
        return { valid: false, reason: 'expired' };
    }

    return { valid: true, payload };
}
```

### Step 4: Run → expect 5/5 PASS

### Step 5: Commit + push

```bash
git add server/lib/work-board-ai-hmac.js server/__tests__/work-board-ai-hmac.test.js
git commit -m "feat(work-board): HMAC-signed validity tokens for AI diff handoff"
git push origin main
```

---

## Task 3: Cost tracking library

**Files:**
- Create: `server/lib/work-board-ai-cost.js`
- Create: `server/__tests__/work-board-ai-cost.test.js`

### Scene

Two functions:
- `recordSpend(userId, cents)` — upsert into `work_board_ai_spend` for the current month.
- `getMonthlySpend(userId)` — returns cents spent in the current month (0 if no row).

Month key format: `YYYY-MM` from `new Date().toISOString().slice(0, 7)`.

### Step 1: Failing test

Create `server/__tests__/work-board-ai-cost.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, github_login TEXT);
    CREATE TABLE work_board_ai_spend (
        user_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        cents INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, month)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { recordSpend, getMonthlySpend, getCurrentMonthKey } = await import('../lib/work-board-ai-cost.js');

const USER_ID = 91001;

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_ai_spend WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id, github_login) VALUES (?, ?)').run(USER_ID, 'cost-test');
});

describe('cost tracking', () => {
    it('getMonthlySpend returns 0 when no row exists', () => {
        expect(getMonthlySpend(USER_ID)).toBe(0);
    });

    it('recordSpend inserts a row for the current month', () => {
        recordSpend(USER_ID, 15);
        expect(getMonthlySpend(USER_ID)).toBe(15);
    });

    it('recordSpend accumulates when called multiple times', () => {
        recordSpend(USER_ID, 10);
        recordSpend(USER_ID, 25);
        recordSpend(USER_ID, 5);
        expect(getMonthlySpend(USER_ID)).toBe(40);
    });

    it('recordSpend with 0 is a no-op', () => {
        recordSpend(USER_ID, 0);
        expect(getMonthlySpend(USER_ID)).toBe(0);
    });

    it('recordSpend with negative value throws', () => {
        expect(() => recordSpend(USER_ID, -5)).toThrow(/non-negative/i);
    });

    it('getCurrentMonthKey returns YYYY-MM', () => {
        expect(getCurrentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
    });
});
```

### Step 2: Run → FAIL

### Step 3: Implement

Create `server/lib/work-board-ai-cost.js`:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AI Assistant monthly cost tracking. Accumulates estimated spend per user
 * per month. Read by the cost-cap middleware; written by routes that make
 * provider calls.
 */

import db from '../db.js';

export function getCurrentMonthKey() {
    return new Date().toISOString().slice(0, 7);
}

/**
 * Add `cents` to the user's current-month spend. Idempotent: creates row if
 * missing, increments if present.
 * @param {number} userId
 * @param {number} cents — non-negative integer
 */
export function recordSpend(userId, cents) {
    if (!Number.isFinite(cents) || cents < 0) {
        throw new Error('Cents must be non-negative');
    }
    if (cents === 0) return;
    const month = getCurrentMonthKey();
    db.prepare(`
        INSERT INTO work_board_ai_spend (user_id, month, cents)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, month) DO UPDATE SET cents = cents + excluded.cents
    `).run(userId, month, Math.round(cents));
}

/**
 * @param {number} userId
 * @returns {number} cents spent this month (0 if no row)
 */
export function getMonthlySpend(userId) {
    const month = getCurrentMonthKey();
    const row = db.prepare(
        'SELECT cents FROM work_board_ai_spend WHERE user_id = ? AND month = ?'
    ).get(userId, month);
    return row?.cents ?? 0;
}
```

### Step 4: Run → expect 6/6 PASS

### Step 5: Commit + push

```bash
git add server/lib/work-board-ai-cost.js server/__tests__/work-board-ai-cost.test.js
git commit -m "feat(work-board): AI monthly cost tracking library"
git push origin main
```

---

## Task 4: Feature-flag + cost-cap gate middleware

**Files:**
- Create: `server/middleware/work-board-ai-gate.js`
- Create: `server/__tests__/work-board-ai-gate.test.js`

### Scene

Single middleware `requireWorkBoardAI(req, res, next)` — use in front of every `/ai/*` route. Checks:

1. `process.env.WORK_BOARD_AI_ENABLED === 'true'` — global feature flag. 404 if false.
2. User's `work_board_prefs.ai_assistant_enabled === 1` — per-user opt-in. 403 if false.
3. `ai_monthly_cap_cents` vs `getMonthlySpend(userId)` — 429 if cap reached (respects `0 = unlimited` as a convention).

Attaches `req.aiPrefs` for downstream handlers.

### Step 1: Failing test

Create `server/__tests__/work-board-ai-gate.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY,
        discovery_window_days INTEGER DEFAULT 60,
        max_auto_repos INTEGER DEFAULT 50,
        auto_mute_bots INTEGER DEFAULT 0,
        ai_assistant_enabled INTEGER DEFAULT 0,
        ai_monthly_cap_cents INTEGER DEFAULT 500,
        ai_response_locale TEXT,
        last_discovery_at DATETIME
    );
    CREATE TABLE work_board_ai_spend (
        user_id INTEGER, month TEXT, cents INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, month)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { requireWorkBoardAI } = await import('../middleware/work-board-ai-gate.js');

const USER_ID = 92001;
const originalEnv = { ...process.env };

beforeEach(() => {
    Object.assign(process.env, originalEnv);
    testDb.prepare('DELETE FROM work_board_ai_spend WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
});

function runMiddleware({ userId = USER_ID } = {}) {
    const req = { session: { userId } };
    let nextCalled = false;
    const res = {
        _status: 200,
        _body: null,
        status(code) { this._status = code; return this; },
        json(body) { this._body = body; return this; },
    };
    const next = () => { nextCalled = true };
    requireWorkBoardAI(req, res, next);
    return { req, res, nextCalled };
}

describe('requireWorkBoardAI', () => {
    it('returns 404 when feature flag is not enabled', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'false';
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(404);
    });

    it('returns 403 when user has not opted in', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled) VALUES (?, 0)`).run(USER_ID);
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
        expect(res._body).toMatchObject({ code: 'AI_ASSISTANT_DISABLED' });
    });

    it('returns 403 when user has no prefs row (treated as not opted in)', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(403);
    });

    it('returns 429 when monthly cap is reached', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 500)`).run(USER_ID);
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare(`INSERT INTO work_board_ai_spend (user_id, month, cents) VALUES (?, ?, 600)`).run(USER_ID, month);
        const { res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(false);
        expect(res._status).toBe(429);
        expect(res._body).toMatchObject({ code: 'AI_COST_CAP_REACHED' });
    });

    it('calls next() when all gates pass', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 500)`).run(USER_ID);
        const { req, res, nextCalled } = runMiddleware();
        expect(nextCalled).toBe(true);
        expect(res._status).toBe(200);
        expect(req.aiPrefs).toMatchObject({ ai_assistant_enabled: 1, ai_monthly_cap_cents: 500 });
    });

    it('cap of 0 is treated as unlimited', () => {
        process.env.WORK_BOARD_AI_ENABLED = 'true';
        testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 0)`).run(USER_ID);
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare(`INSERT INTO work_board_ai_spend (user_id, month, cents) VALUES (?, ?, 10000)`).run(USER_ID, month);
        const { nextCalled } = runMiddleware();
        expect(nextCalled).toBe(true);
    });
});
```

### Step 2: Run → FAIL

### Step 3: Implement

Create `server/middleware/work-board-ai-gate.js`:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Gate for Work Board AI Assistant endpoints. Applies in this order:
 *   1. Feature flag (WORK_BOARD_AI_ENABLED env var) → 404 when off
 *   2. User opt-in (work_board_prefs.ai_assistant_enabled) → 403 when off
 *   3. Monthly cost cap (ai_monthly_cap_cents vs work_board_ai_spend) → 429 when hit
 *
 * On success, attaches `req.aiPrefs` with the user's prefs row for downstream
 * handlers to avoid re-querying.
 */

import db from '../db.js';

export function requireWorkBoardAI(req, res, next) {
    if (process.env.WORK_BOARD_AI_ENABLED !== 'true') {
        return res.status(404).json({ code: 'AI_FEATURE_FLAG_OFF', error: 'AI Assistant is not enabled on this deployment' });
    }

    const userId = req.session?.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const prefs = db.prepare(
        'SELECT ai_assistant_enabled, ai_monthly_cap_cents, ai_response_locale FROM work_board_prefs WHERE user_id = ?'
    ).get(userId);

    if (!prefs || prefs.ai_assistant_enabled !== 1) {
        return res.status(403).json({
            code: 'AI_ASSISTANT_DISABLED',
            error: 'Enable AI Assistant in Settings first',
        });
    }

    // Cap of 0 means unlimited
    if (prefs.ai_monthly_cap_cents > 0) {
        const month = new Date().toISOString().slice(0, 7);
        const spendRow = db.prepare(
            'SELECT cents FROM work_board_ai_spend WHERE user_id = ? AND month = ?'
        ).get(userId, month);
        const spent = spendRow?.cents ?? 0;
        if (spent >= prefs.ai_monthly_cap_cents) {
            return res.status(429).json({
                code: 'AI_COST_CAP_REACHED',
                error: 'Monthly AI limit reached',
                spent_cents: spent,
                cap_cents: prefs.ai_monthly_cap_cents,
            });
        }
    }

    req.aiPrefs = prefs;
    next();
}
```

### Step 4: Run → expect 6/6 PASS

### Step 5: Commit + push

```bash
git add server/middleware/work-board-ai-gate.js server/__tests__/work-board-ai-gate.test.js
git commit -m "feat(work-board): AI gate middleware (feature flag + opt-in + cost cap)"
git push origin main
```

---

## Task 5: Suggestions engine (deterministic)

**Files:**
- Create: `server/lib/work-board-suggestions-engine.js`
- Create: `server/__tests__/work-board-suggestions-engine.test.js`

### Scene

Pure function (no LLM, no I/O outside the DB reads it orchestrates). Given a user, inspects their `work_board_tracked_repos` + `work_board_undo_log` and emits pattern suggestions. Dismissed suggestions (`work_board_ai_dismissed`) never resurface.

Patterns implemented in MVP:

- **BotPrefix** — ≥ 3 muted repos sharing a prefix like `dependabot-*`, `renovate-*` → suggest "Always mute `prefix`-*".
- **StaleNoActivity** — `last_activity_at > 90 days` AND not pinned → suggest "Mute `repo`".
- **ArchivedTracked** — repo with `last_synced_at > 30d` + no recent activity → suggest "Remove or keep".

Returns an array `[{ pattern_key, title, description, repos: [...], confidence: 0..1 }]`.

### Step 1: Failing test

Create `server/__tests__/work-board-suggestions-engine.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL,
        repo_id INTEGER, source_signal TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0,
        last_activity_at DATETIME, discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE work_board_ai_dismissed (
        user_id INTEGER NOT NULL, pattern_key TEXT NOT NULL,
        repo_full_name TEXT NOT NULL DEFAULT '',
        dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pattern_key, repo_full_name)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

const { computeSuggestions, dismissSuggestion } = await import('../lib/work-board-suggestions-engine.js');

const USER_ID = 93001;

function seed(rows) {
    const stmt = testDb.prepare(`
        INSERT INTO work_board_tracked_repos
            (user_id, repo_full_name, source_signal, is_pinned, is_muted, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const r of rows) {
        stmt.run(USER_ID, r.name, r.signal ?? 'owned', r.pinned ?? 0, r.muted ?? 0, r.activity ?? null);
    }
}

beforeEach(() => {
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_ai_dismissed WHERE user_id = ?').run(USER_ID);
});

describe('computeSuggestions', () => {
    it('returns empty array when user has no tracked repos', () => {
        expect(computeSuggestions(USER_ID)).toEqual([]);
    });

    it('BotPrefix: detects >=3 muted repos with common prefix', () => {
        seed([
            { name: 'org/dependabot-security-1', muted: 1 },
            { name: 'org/dependabot-security-2', muted: 1 },
            { name: 'org/dependabot-security-3', muted: 1 },
            { name: 'org/backend' },
        ]);
        const s = computeSuggestions(USER_ID);
        const bot = s.find(x => x.pattern_key === 'BotPrefix');
        expect(bot).toBeDefined();
        expect(bot.repos.length).toBeGreaterThanOrEqual(3);
    });

    it('BotPrefix: ignored when only 2 muted with same prefix', () => {
        seed([
            { name: 'org/dependabot-a', muted: 1 },
            { name: 'org/dependabot-b', muted: 1 },
        ]);
        const s = computeSuggestions(USER_ID);
        expect(s.find(x => x.pattern_key === 'BotPrefix')).toBeUndefined();
    });

    it('StaleNoActivity: detects repos with last_activity_at > 90 days and not pinned', () => {
        const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
        const recentDate = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
        seed([
            { name: 'org/stale-one', activity: oldDate },
            { name: 'org/stale-pinned', pinned: 1, activity: oldDate },
            { name: 'org/active', activity: recentDate },
        ]);
        const s = computeSuggestions(USER_ID);
        const stale = s.find(x => x.pattern_key === 'StaleNoActivity');
        expect(stale).toBeDefined();
        expect(stale.repos).toContain('org/stale-one');
        expect(stale.repos).not.toContain('org/stale-pinned');
        expect(stale.repos).not.toContain('org/active');
    });

    it('dismissed patterns are not re-suggested', () => {
        const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
        seed([{ name: 'org/stale', activity: oldDate }]);

        dismissSuggestion(USER_ID, 'StaleNoActivity', 'org/stale');

        const s = computeSuggestions(USER_ID);
        const stale = s.find(x => x.pattern_key === 'StaleNoActivity');
        expect(stale?.repos ?? []).not.toContain('org/stale');
    });

    it('caps output at 3 suggestions per call', () => {
        const oldDate = new Date(Date.now() - 120 * 86400 * 1000).toISOString();
        seed([
            { name: 'org/dependabot-1', muted: 1 },
            { name: 'org/dependabot-2', muted: 1 },
            { name: 'org/dependabot-3', muted: 1 },
            { name: 'org/renovate-1', muted: 1 },
            { name: 'org/renovate-2', muted: 1 },
            { name: 'org/renovate-3', muted: 1 },
            { name: 'org/stale-a', activity: oldDate },
            { name: 'org/stale-b', activity: oldDate },
        ]);
        const s = computeSuggestions(USER_ID);
        expect(s.length).toBeLessThanOrEqual(3);
    });
});
```

### Step 2: Run → FAIL

### Step 3: Implement

Create `server/lib/work-board-suggestions-engine.js`:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic pattern matcher for AI Assistant suggestions.
 * LLM-free for MVP — later phases can add LLM-generated phrasing.
 *
 * Patterns:
 *   - BotPrefix      : ≥3 muted repos sharing a prefix (dependabot-*, etc.)
 *   - StaleNoActivity: repos with last_activity_at > 90 days AND not pinned
 */

import db from '../db.js';

const STALE_DAYS = 90;
const MAX_SUGGESTIONS = 3;
const BOT_PREFIX_MIN = 3;

function isDismissed(userId, patternKey, repoFullName = '') {
    const row = db.prepare(
        'SELECT 1 FROM work_board_ai_dismissed WHERE user_id = ? AND pattern_key = ? AND repo_full_name = ?'
    ).get(userId, patternKey, repoFullName);
    return Boolean(row);
}

function detectBotPrefix(userId, repos) {
    const muted = repos.filter(r => r.is_muted === 1)
    const byPrefix = new Map()
    for (const r of muted) {
        const [, name] = r.repo_full_name.split('/')
        if (!name) continue
        const m = name.match(/^([a-z]+)[-_]/i)
        if (!m) continue
        const prefix = m[1].toLowerCase()
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
        byPrefix.get(prefix).push(r.repo_full_name)
    }
    const results = []
    for (const [prefix, names] of byPrefix.entries()) {
        if (names.length < BOT_PREFIX_MIN) continue
        if (isDismissed(userId, 'BotPrefix', prefix)) continue
        results.push({
            pattern_key: 'BotPrefix',
            dismiss_key: prefix,
            title: `Always mute ${prefix}-* repositories`,
            description: `You've muted ${names.length} repos starting with "${prefix}-".`,
            repos: names,
            confidence: 0.85,
        })
    }
    return results
}

function detectStale(userId, repos) {
    const cutoff = Date.now() - STALE_DAYS * 86400 * 1000
    const stale = []
    for (const r of repos) {
        if (r.is_pinned === 1) continue
        if (r.is_muted === 1) continue
        if (!r.last_activity_at) continue
        if (new Date(r.last_activity_at).getTime() < cutoff) {
            if (isDismissed(userId, 'StaleNoActivity', r.repo_full_name)) continue
            stale.push(r.repo_full_name)
        }
    }
    if (stale.length === 0) return []
    return [{
        pattern_key: 'StaleNoActivity',
        title: `Mute ${stale.length} repos without activity for 3+ months`,
        description: 'These repos haven\'t had relevant activity in 90+ days.',
        repos: stale,
        confidence: 0.7,
    }]
}

/**
 * @param {number} userId
 * @returns {Array<{pattern_key, title, description, repos, confidence}>}
 */
export function computeSuggestions(userId) {
    const repos = db.prepare(
        'SELECT repo_full_name, is_pinned, is_muted, last_activity_at FROM work_board_tracked_repos WHERE user_id = ?'
    ).all(userId)

    if (repos.length === 0) return []

    const all = [
        ...detectBotPrefix(userId, repos),
        ...detectStale(userId, repos),
    ]

    return all.slice(0, MAX_SUGGESTIONS)
}

/**
 * @param {number} userId
 * @param {string} patternKey
 * @param {string} [repoFullName=''] — or a pattern-specific key (e.g. prefix for BotPrefix)
 */
export function dismissSuggestion(userId, patternKey, repoFullName = '') {
    db.prepare(`
        INSERT INTO work_board_ai_dismissed (user_id, pattern_key, repo_full_name)
        VALUES (?, ?, ?)
        ON CONFLICT DO NOTHING
    `).run(userId, patternKey, repoFullName)
}
```

### Step 4: Run → expect 5/5 PASS

### Step 5: Commit + push

```bash
git add server/lib/work-board-suggestions-engine.js server/__tests__/work-board-suggestions-engine.test.js
git commit -m "feat(work-board): deterministic AI suggestions engine"
git push origin main
```

---

## Task 6: Prompts versioned scaffold

**Files:**
- Create: `server/lib/ai-features/work-board-assistant/prompts/v1/interpret.md`
- Create: `server/lib/ai-features/work-board-assistant/prompts/index.js`

### Scene

The `/ai/interpret` endpoint (Task 8) needs a prompt to send to the LLM. Each prompt is a plain markdown file under a versioned directory so we can bump versions without breaking saved state.

For Phase 6 we ship one prompt (`interpret.md`) and a loader. Future prompts (summarize, plan-my-day, etc.) land in Phase 7.

### Step 1: Write the interpret prompt

Create `server/lib/ai-features/work-board-assistant/prompts/v1/interpret.md`:

```markdown
You are an assistant that converts a natural-language request about GitHub
repositories into a structured list of tracking actions.

## Allowed action types

- `pin`     — mark a repository as pinned (always visible in Work Board)
- `unpin`   — remove pinned status
- `mute`    — hide this repository's items from Work Board views
- `unmute`  — unhide this repository's items
- `untrack` — remove the repository from the user's tracked set entirely

## Input

You will receive:
- The user's free-text request (one or two sentences).
- A JSON array of their currently-tracked repositories:
  `[{ "repo_full_name": "owner/repo", "is_pinned": 0|1, "is_muted": 0|1, "source_signal": "..." }, ...]`.

## Output (JSON)

Return ONLY a JSON object matching this shape, no prose:

```json
{
  "summary": "Short human-readable explanation of what will change.",
  "actions": [
    { "repo": "owner/repo-one", "action": "mute" },
    { "repo": "owner/repo-two", "action": "pin" }
  ]
}
```

## Rules

- Only emit actions for repos in the provided list — do NOT invent repos.
- Prefer the minimal set of actions that satisfies the request.
- If the request is ambiguous, return actions for the most conservative interpretation and mention the uncertainty in `summary`.
- Do not include actions that are redundant (e.g. `pin` a repo that is already pinned).
```

### Step 2: Write the loader

Create `server/lib/ai-features/work-board-assistant/prompts/index.js`:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const CURRENT_VERSION = 'v1';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cache = new Map();

/**
 * @param {string} name — e.g. 'interpret'
 * @param {string} [version]
 * @returns {string} prompt markdown
 */
export function loadPrompt(name, version = CURRENT_VERSION) {
    const key = `${version}/${name}`;
    if (cache.has(key)) return cache.get(key);
    const path = join(__dirname, version, `${name}.md`);
    const content = readFileSync(path, 'utf8');
    cache.set(key, content);
    return content;
}
```

### Step 3: Quick smoke test (no dedicated test file — loader is trivially verified by Task 8 integration tests)

```bash
node -e "import('./server/lib/ai-features/work-board-assistant/prompts/index.js').then(m => console.log('version:', m.CURRENT_VERSION, 'prompt length:', m.loadPrompt('interpret').length))"
```

Expected: `version: v1 prompt length: <some number > 500>`.

### Step 4: Commit + push

```bash
git add server/lib/ai-features/work-board-assistant/
git commit -m "feat(work-board): versioned AI prompts scaffold with interpret.md"
git push origin main
```

---

## Task 7: GET /ai/suggestions + POST /ai/dismiss-suggestion

**Files:**
- Create: `server/routes/work-board-ai.js`
- Create: `server/__tests__/work-board-ai-routes.test.js`
- Modify: `server/routes/v1/index.js` (mount router)

### Scene

First two endpoints. Both gated by `requireAuth` + `requireWorkBoardAI`. `/ai/suggestions` returns whatever `computeSuggestions()` produces. `/ai/dismiss-suggestion` records a dismissal.

### Step 1: Failing test

Create `server/__tests__/work-board-ai-routes.test.js`:

```javascript
// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE work_board_tracked_repos (
        user_id INTEGER NOT NULL, repo_full_name TEXT NOT NULL,
        repo_id INTEGER, source_signal TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0,
        last_activity_at DATETIME, discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, repo_full_name)
    );
    CREATE TABLE work_board_prefs (
        user_id INTEGER PRIMARY KEY,
        discovery_window_days INTEGER DEFAULT 60,
        max_auto_repos INTEGER DEFAULT 50,
        auto_mute_bots INTEGER DEFAULT 0,
        ai_assistant_enabled INTEGER DEFAULT 0,
        ai_monthly_cap_cents INTEGER DEFAULT 500,
        ai_response_locale TEXT, last_discovery_at DATETIME
    );
    CREATE TABLE work_board_ai_dismissed (
        user_id INTEGER NOT NULL, pattern_key TEXT NOT NULL,
        repo_full_name TEXT NOT NULL DEFAULT '',
        dismissed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, pattern_key, repo_full_name)
    );
    CREATE TABLE work_board_ai_spend (
        user_id INTEGER, month TEXT, cents INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, month)
    );
`);
vi.mock('../db.js', () => ({ default: testDb }));

vi.mock('../middleware/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        requireAuth: (req, res, next) => {
            req.session = { userId: 94001, accessToken: 'tok' };
            next();
        },
    };
});

const USER_ID = 94001;
const ORIGINAL_ENV = { ...process.env };
let app;

beforeAll(async () => {
    const { default: router } = await import('../routes/work-board-ai.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/work-board/ai', router);
});

beforeEach(() => {
    Object.assign(process.env, ORIGINAL_ENV);
    process.env.WORK_BOARD_AI_ENABLED = 'true';
    testDb.prepare('DELETE FROM work_board_tracked_repos WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_ai_dismissed WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM work_board_prefs WHERE user_id = ?').run(USER_ID);
    testDb.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
    testDb.prepare('INSERT INTO users (id) VALUES (?)').run(USER_ID);
    testDb.prepare(`INSERT INTO work_board_prefs (user_id, ai_assistant_enabled, ai_monthly_cap_cents) VALUES (?, 1, 500)`).run(USER_ID);
});

describe('GET /api/v1/work-board/ai/suggestions', () => {
    it('returns 404 when feature flag is off', async () => {
        process.env.WORK_BOARD_AI_ENABLED = 'false';
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(404);
    });

    it('returns 403 when user has not opted in', async () => {
        testDb.prepare('UPDATE work_board_prefs SET ai_assistant_enabled = 0 WHERE user_id = ?').run(USER_ID);
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(403);
    });

    it('returns empty array when user has no suggestions', async () => {
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ suggestions: [] });
    });

    it('returns BotPrefix suggestion when ≥3 muted repos share a prefix', async () => {
        for (const name of ['org/dependabot-a', 'org/dependabot-b', 'org/dependabot-c']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 1)
            `).run(USER_ID, name);
        }
        const res = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(res.status).toBe(200);
        expect(res.body.suggestions.some(s => s.pattern_key === 'BotPrefix')).toBe(true);
    });
});

describe('POST /api/v1/work-board/ai/dismiss-suggestion', () => {
    it('records a dismissal and removes the suggestion', async () => {
        for (const name of ['org/dependabot-a', 'org/dependabot-b', 'org/dependabot-c']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 1)
            `).run(USER_ID, name);
        }

        const before = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(before.body.suggestions.some(s => s.pattern_key === 'BotPrefix')).toBe(true);

        const dismiss = await request(app)
            .post('/api/v1/work-board/ai/dismiss-suggestion')
            .send({ pattern_key: 'BotPrefix', repo_full_name: 'dependabot' });
        expect(dismiss.status).toBe(200);

        const after = await request(app).get('/api/v1/work-board/ai/suggestions');
        expect(after.body.suggestions.some(s => s.pattern_key === 'BotPrefix')).toBe(false);
    });

    it('rejects bad payload', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/ai/dismiss-suggestion')
            .send({ pattern_key: '' });
        expect(res.status).toBe(400);
    });
});
```

### Step 2: Run → FAIL

### Step 3: Implement router

Create `server/routes/work-board-ai.js`:

```javascript
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Work Board AI Assistant routes. Mounted at /api/v1/work-board/ai.
 * Every route requires:
 *   - requireAuth (session or API key)
 *   - requireWorkBoardAI (feature flag + user opt-in + cost cap)
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkBoardAI } from '../middleware/work-board-ai-gate.js';
import { computeSuggestions, dismissSuggestion } from '../lib/work-board-suggestions-engine.js';

const router = express.Router();

router.get('/suggestions', requireAuth, requireWorkBoardAI, (req, res) => {
    const suggestions = computeSuggestions(req.session.userId);
    res.json({ suggestions });
});

router.post('/dismiss-suggestion', requireAuth, requireWorkBoardAI, (req, res) => {
    const { pattern_key, repo_full_name } = req.body ?? {};
    if (!pattern_key || typeof pattern_key !== 'string') {
        return res.status(400).json({ error: 'pattern_key required (string)' });
    }
    dismissSuggestion(req.session.userId, pattern_key, repo_full_name ?? '');
    res.json({ dismissed: true });
});

export default router;
```

### Step 4: Mount in v1 router

In `server/routes/v1/index.js`, add import:

```javascript
import workBoardAIRoutes from '../work-board-ai.js';
```

After the existing `workBoardTrackingRoutes` mount (in the `/work-board` section), add:

```javascript
router.use('/work-board/ai', workBoardAIRoutes);
```

### Step 5: Run → expect 6/6 PASS on routes tests + full regression green

```bash
npx vitest run server/__tests__/work-board-ai-routes.test.js
npx vitest run server/
```

### Step 6: Commit + push

```bash
git add server/routes/work-board-ai.js server/routes/v1/index.js server/__tests__/work-board-ai-routes.test.js
git commit -m "feat(work-board): AI suggestions + dismiss endpoints"
git push origin main
```

---

## Task 8: POST /ai/interpret + POST /ai/apply

**Files:**
- Modify: `server/routes/work-board-ai.js`
- Modify: `server/__tests__/work-board-ai-routes.test.js`

### Scene

- `/ai/interpret { prompt }` → calls LLM via `createProviderForUser(userId, 'completion')`, feeds it the `interpret.md` prompt + user's current tracked repos + user prompt. Parses the JSON response, validates each action repo exists in the user's tracked set, returns `{ actions, summary, validity_token }`. Records spend (~0.5 cents as estimate for MVP).
- `/ai/apply { validity_token }` → verifies HMAC, re-validates actions, executes via `bulkUpdate(userId, repoFullNames, action)` grouped by action type. Records a single `operation_id` for the whole bulk; returns it for undo.

### Step 1: Append tests

In `server/__tests__/work-board-ai-routes.test.js`, add at top (alongside other mocks):

```javascript
const mockProvider = {
    generate: vi.fn(),
    getModelName: () => 'test-model',
};
vi.mock('../lib/ai-provider.js', () => ({
    createProviderForUser: vi.fn(async () => mockProvider),
}));
```

Append test block:

```javascript
describe('POST /api/v1/work-board/ai/interpret', () => {
    beforeEach(() => {
        mockProvider.generate.mockReset();
        for (const name of ['acme/x', 'acme/y']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('returns 400 when prompt is missing', async () => {
        const res = await request(app).post('/api/v1/work-board/ai/interpret').send({});
        expect(res.status).toBe(400);
    });

    it('calls LLM, returns actions + summary + validity_token', async () => {
        mockProvider.generate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'Will mute 2 repos',
                actions: [
                    { repo: 'acme/x', action: 'mute' },
                    { repo: 'acme/y', action: 'mute' },
                ],
            }),
        });

        const res = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'mute acme repos' });

        expect(res.status).toBe(200);
        expect(res.body.summary).toBe('Will mute 2 repos');
        expect(res.body.actions).toHaveLength(2);
        expect(typeof res.body.validity_token).toBe('string');
        expect(res.body.validity_token).toContain('.');
    });

    it('filters out actions on repos the user does not track', async () => {
        mockProvider.generate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'Will mute 1 repo and skip 1 invalid',
                actions: [
                    { repo: 'acme/x', action: 'mute' },
                    { repo: 'acme/not-tracked', action: 'mute' },
                ],
            }),
        });

        const res = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'mute everything' });

        expect(res.status).toBe(200);
        expect(res.body.actions).toHaveLength(1);
        expect(res.body.actions[0].repo).toBe('acme/x');
    });

    it('returns 502 when LLM returns unparseable JSON', async () => {
        mockProvider.generate.mockResolvedValue({ text: 'This is not JSON at all.' });
        const res = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'whatever' });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('AI_INVALID_RESPONSE');
    });
});

describe('POST /api/v1/work-board/ai/apply', () => {
    beforeEach(() => {
        mockProvider.generate.mockReset();
        for (const name of ['acme/x', 'acme/y']) {
            testDb.prepare(`
                INSERT INTO work_board_tracked_repos (user_id, repo_full_name, source_signal, is_pinned, is_muted)
                VALUES (?, ?, 'owned', 0, 0)
            `).run(USER_ID, name);
        }
    });

    it('executes the diff from a valid token', async () => {
        process.env.AI_DIFF_SIGNING_KEY = 'test-key-32-chars-minimum-for-hmac-ok';
        mockProvider.generate.mockResolvedValue({
            text: JSON.stringify({
                summary: 'Will mute 2',
                actions: [
                    { repo: 'acme/x', action: 'mute' },
                    { repo: 'acme/y', action: 'mute' },
                ],
            }),
        });

        const interpret = await request(app)
            .post('/api/v1/work-board/ai/interpret')
            .send({ prompt: 'mute all' });
        expect(interpret.status).toBe(200);

        const apply = await request(app)
            .post('/api/v1/work-board/ai/apply')
            .send({ validity_token: interpret.body.validity_token });

        expect(apply.status).toBe(200);
        expect(apply.body.applied).toBe(2);
        expect(apply.body.operation_id).toBeDefined();

        const muted = testDb.prepare('SELECT COUNT(*) as c FROM work_board_tracked_repos WHERE user_id = ? AND is_muted = 1').get(USER_ID);
        expect(muted.c).toBe(2);
    });

    it('returns 400 on invalid token', async () => {
        const res = await request(app)
            .post('/api/v1/work-board/ai/apply')
            .send({ validity_token: 'garbage.garbage' });
        expect(res.status).toBe(400);
    });
});
```

Make sure to add `work_board_undo_log` table to the test-DB bootstrap near the top of the file (if not already) because `bulkUpdate` writes to it:

Add to the schema block:

```sql
CREATE TABLE work_board_undo_log (
    operation_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
    operation_type TEXT NOT NULL, before_state TEXT NOT NULL, after_state TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL
);
```

### Step 2: Run → FAIL

### Step 3: Implement

Update `server/routes/work-board-ai.js` — add imports and the two new handlers:

```javascript
import { createProviderForUser } from '../lib/ai-provider.js';
import { loadPrompt } from '../lib/ai-features/work-board-assistant/prompts/index.js';
import { signDiffToken, verifyDiffToken } from '../lib/work-board-ai-hmac.js';
import { recordSpend } from '../lib/work-board-ai-cost.js';
import { bulkUpdate } from '../lib/work-board-tracking.js';
import db from '../db.js';

const VALID_ACTIONS = new Set(['pin', 'unpin', 'mute', 'unmute', 'track', 'untrack']);
const INTERPRET_ESTIMATED_CENTS = 1; // conservative estimate until real token accounting

function listTrackedReposForPrompt(userId) {
    return db.prepare(
        'SELECT repo_full_name, is_pinned, is_muted, source_signal FROM work_board_tracked_repos WHERE user_id = ?'
    ).all(userId);
}

function extractJsonBlob(text) {
    // LLMs sometimes wrap JSON in ```json ... ``` — strip markdown fences
    const trimmed = (text ?? '').trim();
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}

router.post('/interpret', requireAuth, requireWorkBoardAI, async (req, res) => {
    const { prompt } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.length < 3) {
        return res.status(400).json({ error: 'prompt required (string, >= 3 chars)' });
    }

    const userId = req.session.userId;

    let provider;
    try {
        provider = await createProviderForUser(userId, 'completion');
    } catch (e) {
        return res.status(503).json({ code: 'AI_PROVIDER_UNAVAILABLE', error: e.message });
    }
    if (!provider) {
        return res.status(403).json({ code: 'AI_NOT_CONFIGURED', error: 'Configure a provider in AI Configuration' });
    }

    const tracked = listTrackedReposForPrompt(userId);
    const systemPrompt = loadPrompt('interpret');
    const userPrompt = `User request: ${prompt}\n\nTracked repositories:\n${JSON.stringify(tracked)}`;

    let llmText;
    try {
        const result = await provider.generate({
            prompt: userPrompt,
            systemPrompt,
            generationConfig: { maxOutputTokens: 1500, max_tokens: 1500 },
        });
        llmText = result?.text;
    } catch (e) {
        return res.status(502).json({ code: 'AI_PROVIDER_ERROR', error: e.message });
    }

    const parsed = extractJsonBlob(llmText);
    if (!parsed || !Array.isArray(parsed.actions)) {
        return res.status(502).json({ code: 'AI_INVALID_RESPONSE', error: 'LLM did not return a valid diff' });
    }

    // Filter: only actions on repos the user actually tracks + with valid action type
    const trackedSet = new Set(tracked.map(r => r.repo_full_name));
    const validActions = parsed.actions.filter(a =>
        a && typeof a.repo === 'string' && VALID_ACTIONS.has(a.action) && trackedSet.has(a.repo)
    );

    // Cost accounting — conservative flat estimate; future: compute from token counts
    recordSpend(userId, INTERPRET_ESTIMATED_CENTS);

    const validity_token = signDiffToken({
        userId,
        actions: validActions,
    });

    res.json({
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        actions: validActions,
        validity_token,
        skipped: parsed.actions.length - validActions.length,
    });
});

router.post('/apply', requireAuth, requireWorkBoardAI, (req, res) => {
    const { validity_token } = req.body ?? {};
    if (typeof validity_token !== 'string') {
        return res.status(400).json({ error: 'validity_token required' });
    }

    const verified = verifyDiffToken(validity_token);
    if (!verified.valid) {
        return res.status(400).json({ code: 'INVALID_TOKEN', reason: verified.reason });
    }
    if (verified.payload.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Token belongs to another user' });
    }

    const actions = verified.payload.actions ?? [];
    if (actions.length === 0) {
        return res.json({ applied: 0, operation_id: null });
    }

    // Group by action type and run bulkUpdate per group. Each group gets its own
    // undo operation_id; caller receives the first one for MVP (multi-action bulk
    // undo is a Phase 7 refinement).
    const byAction = new Map();
    for (const a of actions) {
        if (!byAction.has(a.action)) byAction.set(a.action, []);
        byAction.get(a.action).push(a.repo);
    }

    let applied = 0;
    let operationId = null;
    for (const [action, repos] of byAction.entries()) {
        const result = bulkUpdate(req.session.userId, repos, action);
        applied += result.updated;
        if (!operationId) operationId = result.operationId;
    }

    res.json({ applied, operation_id: operationId });
});
```

Also add `work_board_undo_log` to the test schema at the top of the test file if not there already.

### Step 4: Run → tests pass

### Step 5: Commit + push

```bash
git add server/routes/work-board-ai.js server/__tests__/work-board-ai-routes.test.js
git commit -m "feat(work-board): AI interpret + apply endpoints with HMAC tokens"
git push origin main
```

---

## Task 9: GET /ai/activity + regression + docs

**Files:**
- Modify: `server/routes/work-board-ai.js`
- Modify: `server/__tests__/work-board-ai-routes.test.js`
- Modify: `docs/architecture/work-board-tracking.md`

### Scene

`GET /ai/activity` — user-facing privacy dashboard endpoint. Returns current month's spend + cap + estimated call count.

### Step 1: Append test

```javascript
describe('GET /api/v1/work-board/ai/activity', () => {
    it('returns current-month spend and cap', async () => {
        const month = new Date().toISOString().slice(0, 7);
        testDb.prepare(`INSERT INTO work_board_ai_spend (user_id, month, cents) VALUES (?, ?, 42)`).run(USER_ID, month);

        const res = await request(app).get('/api/v1/work-board/ai/activity');
        expect(res.status).toBe(200);
        expect(res.body.month).toBe(month);
        expect(res.body.spent_cents).toBe(42);
        expect(res.body.cap_cents).toBe(500);
    });

    it('returns 0 spend when no row exists', async () => {
        const res = await request(app).get('/api/v1/work-board/ai/activity');
        expect(res.body.spent_cents).toBe(0);
    });
});
```

### Step 2: Run → FAIL

### Step 3: Implement

Append to `server/routes/work-board-ai.js`:

```javascript
import { getMonthlySpend, getCurrentMonthKey } from '../lib/work-board-ai-cost.js';

router.get('/activity', requireAuth, requireWorkBoardAI, (req, res) => {
    const spent_cents = getMonthlySpend(req.session.userId);
    res.json({
        month: getCurrentMonthKey(),
        spent_cents,
        cap_cents: req.aiPrefs.ai_monthly_cap_cents,
    });
});
```

### Step 4: Full regression

```bash
npx vitest run
```

Expected: all pass.

### Step 5: Build

```bash
npm run build
```

### Step 6: Append Phase 6 section to architecture doc

Append to `docs/architecture/work-board-tracking.md`:

```markdown
## Phase 6 AI Assistant Backend (shipped)

The first slice of AI Assistant — all backend infrastructure. Frontend
lands in Phase 7.

### Feature gate

Three layers (in order):

1. `WORK_BOARD_AI_ENABLED=true` env var — global kill switch. Off = 404.
2. `work_board_prefs.ai_assistant_enabled = 1` — per-user opt-in. Off = 403.
3. `ai_monthly_cap_cents` vs `work_board_ai_spend.cents` — 429 when cap
   reached. Cap of 0 means unlimited.

Enforcement: `requireWorkBoardAI` middleware (`server/middleware/work-board-ai-gate.js`).

### Endpoints (`/api/v1/work-board/ai/*`)

- `GET /suggestions` — heuristic pattern suggestions (no LLM for MVP).
  Current patterns: `BotPrefix` (≥3 muted with common prefix),
  `StaleNoActivity` (90+ days inactive).
- `POST /dismiss-suggestion` — records a dismissal in
  `work_board_ai_dismissed` so the pattern never resurfaces.
- `POST /interpret { prompt }` — calls the user's LLM provider via
  `createProviderForUser()`. Returns actions + summary +
  HMAC-signed validity token (5 min TTL). Invalid repos filtered out
  pre-return. Spend recorded.
- `POST /apply { validity_token }` — verifies HMAC, groups actions by
  type, executes via `bulkUpdate`. Returns `operation_id` for undo.
- `GET /activity` — privacy dashboard data: month, spent cents, cap.

### HMAC validity tokens

Stateless. Format: `<b64url(payload)>.<b64url(hmac)>`. Signing key from
`AI_DIFF_SIGNING_KEY` env var, or derived from `SESSION_SECRET`. TTL
5 min. No DB involvement.

### Prompts versioning

Prompts live under `server/lib/ai-features/work-board-assistant/prompts/<version>/<name>.md`.
Current version: `v1`. Loader (`prompts/index.js`) exports
`CURRENT_VERSION` and `loadPrompt(name)`.

### Cost accounting

`work_board_ai_spend(user_id, month, cents)` — one row per user per
month. `recordSpend()` upserts. `/interpret` records a flat 1 cent per
call as an MVP estimate; future work will use real token-count-based
pricing.
```

### Step 7: Commit + push

```bash
git add server/routes/work-board-ai.js server/__tests__/work-board-ai-routes.test.js docs/architecture/work-board-tracking.md
git commit -m "feat(work-board): AI activity endpoint + Phase 6 docs"
git push origin main
```

Report total test count + build status.

---

## Self-review checklist

- [ ] Every endpoint is gated by `requireAuth` + `requireWorkBoardAI`.
- [ ] `work_board_ai_spend` is upserted, not overwritten.
- [ ] HMAC keys never logged; errors surface `reason` codes but not key bytes.
- [ ] `/interpret` filters out actions on repos not in `tracked_repos` (defensive — LLM may hallucinate).
- [ ] `/apply` re-verifies the token and the userId match before mutating.
- [ ] Suggestions engine respects `work_board_ai_dismissed` forever.
- [ ] Feature flag default is `false` (explicit opt-in by operator).
- [ ] All 5 new tables/libs have SPDX headers and module docstrings matching Phase 1/2 style.

## What's NOT in Phase 6 (deferred to Phase 7)

- Frontend UI (Settings section, suggestions panel, conversational edit input, activity dashboard)
- `/ai/summarize`, `/ai/plan-my-day` (SSE streaming), `/ai/suggest-reviewer`, `/ai/draft-comment`, `/ai/find-similar`
- LLM-rephrased suggestion text (pattern titles ship as raw strings for MVP)
- Dry-run onboarding (3 preview calls) — this is a frontend concern
- Per-command rate limiting beyond the monthly cap
- `ai_response_locale` i18n injection
