# Rate Limit UX & Dev-Mode Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the spurious dev-mode 429 on `/api/auth/*` and treat any legitimate 429 with an on-brand countdown UI instead of raw JSON.

**Architecture:** Backend gains a `skip` option and an HTML-aware `handler` on the per-tenant rate limiter so `/session` is free and browsers get an SPA redirect instead of a JSON blob. Frontend gains a `useCountdown` hook, a `RateLimitNotice` component (toast + banner variants), an `onRateLimit` event bus that any failing 429 feeds into, and an `App.jsx` query-param reader for direct-navigation cases.

**Tech Stack:** Node/Express + express-rate-limit (backend), React 19 + framer-motion + Tailwind v4 + lucide-react (frontend), Vitest + @testing-library/react (tests).

**Reference spec:** [docs/specs/2026-04-09-rate-limit-ux-and-dev-fix.md](../specs/2026-04-09-rate-limit-ux-and-dev-fix.md)

---

## File Structure

**Backend**

- Modify `server/middleware/tenant-rate-limit.js` — accept options, dev-aware tier table, HTML-aware `handler`.
- Modify `server/index.js` — pass `skip` for `/session`.
- Create `server/__tests__/tenant-rate-limit.test.js` — unit tests for the new behavior.

**Frontend primitives**

- Create `src/hooks/useCountdown.js` — countdown tick/progress hook.
- Create `tests/hooks/useCountdown.test.jsx`.
- Modify `src/components/ui/Toast.jsx` — accept optional `content` ReactNode.
- Modify `src/hooks/useToast.js` — add `toast.custom({ type, content, duration })`.
- Modify `tests/hooks/useToast.test.js` — cover the new method.

**Frontend component**

- Create `src/components/ui/RateLimitNotice.jsx` — toast + banner variants.
- Create `tests/components/ui/RateLimitNotice.test.jsx`.

**Wiring**

- Modify `src/utils/api.js` — parse `Retry-After`, emit `onRateLimit` event.
- Modify `tests/utils/api.test.js` — cover the new event and Retry-After parsing.
- Modify `src/App.jsx` — subscribe to `onRateLimit`, read query params, render banner/toast.

---

## Phase A — Backend fix

### Task A1: Extend `createTenantLimiters` with `skip` option and HTML-aware handler

**Files:**

- Modify: `server/middleware/tenant-rate-limit.js`
- Test: `server/__tests__/tenant-rate-limit.test.js` (create)

- [ ] **Step 1: Create the failing test file**

Create `server/__tests__/tenant-rate-limit.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTenantLimiters } from '../middleware/tenant-rate-limit.js'

function buildApp(limiter, routePath = '/api/auth') {
    const app = express()
    app.use(routePath, limiter)
    app.get(`${routePath}/login`, (_req, res) => res.json({ ok: true }))
    app.get(`${routePath}/session`, (_req, res) => res.json({ ok: true }))
    return app
}

describe('createTenantLimiters', () => {
    const originalEnv = process.env.NODE_ENV

    beforeEach(() => {
        process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
        process.env.NODE_ENV = originalEnv
    })

    it('skips paths that match the skip predicate', async () => {
        const limiter = await createTenantLimiters('auth', {
            skip: (req) => req.path === '/session',
        })
        // Force the tier to free with a max of 1 by stubbing NODE_ENV
        const app = buildApp(limiter)
        // Burn the budget on /login (prod free tier = 10). We only need to prove
        // that /session is not affected by the limiter at all.
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login')
        }
        // /login is now over the limit
        const login = await request(app).get('/api/auth/login')
        expect(login.status).toBe(429)
        // /session should still work — skip bypasses the limiter
        const session = await request(app).get('/api/auth/session')
        expect(session.status).toBe(200)
    })

    it('returns JSON 429 for application/json clients', async () => {
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login').set('Accept', 'application/json')
        }
        const res = await request(app)
            .get('/api/auth/login')
            .set('Accept', 'application/json')
        expect(res.status).toBe(429)
        expect(res.body).toEqual({ error: 'Rate limit exceeded. Please try again later.' })
    })

    it('redirects to the SPA with a retry hint for text/html clients', async () => {
        process.env.FRONTEND_URL = 'http://localhost:5173'
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        for (let i = 0; i < 12; i++) {
            await request(app).get('/api/auth/login').set('Accept', 'text/html')
        }
        const res = await request(app)
            .get('/api/auth/login')
            .set('Accept', 'text/html')
        expect(res.status).toBe(302)
        expect(res.headers.location).toMatch(/^http:\/\/localhost:5173\/\?error=rate_limited&retry=\d+$/)
    })

    it('raises dev auth limit when NODE_ENV !== production', async () => {
        process.env.NODE_ENV = 'development'
        const limiter = await createTenantLimiters('auth')
        const app = buildApp(limiter)
        // 200 dev limit — 50 calls should not trip it
        for (let i = 0; i < 50; i++) {
            const r = await request(app).get('/api/auth/login')
            expect(r.status).toBe(200)
        }
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/tenant-rate-limit.test.js`
Expected: All four tests fail. The `skip` option is ignored, there is no HTML handler, and the dev tier has not been added.

- [ ] **Step 3: Update `server/middleware/tenant-rate-limit.js`**

Replace the whole file with:

```js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import logger from '../lib/logger.js';

const isDev = () => process.env.NODE_ENV !== 'production';

function computeTierLimits() {
    return {
        free:       { api: 100,  ai: 10,  auth: isDev() ? 200 : 10 },
        pro:        { api: 500,  ai: 50,  auth: 20 },
        enterprise: { api: 2000, ai: 200, auth: 50 },
    };
}

/**
 * Creates a rate limiter middleware that dynamically applies per-tier limits.
 *
 * If REDIS_URL is set, a shared RedisStore is used (suitable for multi-instance
 * deployments). Otherwise falls back to the default in-process MemoryStore.
 *
 * @param {'api'|'ai'|'auth'} type   - The limit category to apply
 * @param {object} [options]
 * @param {(req: import('express').Request) => boolean} [options.skip]
 *        Optional predicate; when it returns true the limiter is bypassed.
 * @returns {Promise<import('express').RequestHandler>}
 */
export async function createTenantLimiters(type = 'api', options = {}) {
    const { skip } = options;
    let store;
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
        try {
            const { RedisStore } = await import('rate-limit-redis');
            const { Redis } = await import('ioredis');
            const client = new Redis(redisUrl);
            store = new RedisStore({ sendCommand: (...args) => client.call(...args) });
            logger.info(`[rate-limit] Using Redis store for ${type} limiter`);
        } catch (err) {
            logger.warn({ err }, `Redis rate-limit store unavailable for ${type}, using memory`);
        }
    }

    return rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: (req) => {
            const tiers = computeTierLimits();
            const tier = req.userTier || 'free';
            return tiers[tier]?.[type] ?? tiers.free[type];
        },
        keyGenerator: (req) => {
            const userId = req.session?.userId || req.tenantId || ipKeyGenerator(req);
            return `rl:${userId}:${type}`;
        },
        store,
        standardHeaders: true,
        legacyHeaders: false,
        skip,
        message: { error: 'Rate limit exceeded. Please try again later.' },
        handler: (req, res, _next, opts) => {
            const retryAfterSec = Math.ceil(opts.windowMs / 1000);
            res.set('Retry-After', String(retryAfterSec));
            if (req.accepts(['json', 'html']) === 'html') {
                const frontend = process.env.FRONTEND_URL || '';
                return res.redirect(
                    `${frontend}/?error=rate_limited&retry=${retryAfterSec}`
                );
            }
            res.status(opts.statusCode).json(opts.message);
        },
    });
}

/**
 * Global safety-net limiter for unauthenticated / pre-session requests.
 * Applied before session middleware so it cannot use per-user state.
 */
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
```

Key changes vs. the original:

- `TIER_LIMITS` is now computed via `computeTierLimits()` so `NODE_ENV` is read at request time (tests can flip it).
- `createTenantLimiters` accepts an `options` object with `skip`, forwarded to `express-rate-limit`.
- `handler` replaces the static `message` response path so HTML clients get a 302 redirect.
- `req.accepts(['json', 'html'])` returns the best match; `=== 'html'` triggers the redirect.

- [ ] **Step 4: Install supertest if missing**

Run: `cd "s:\Git Hub Repo Manager" && npm list supertest 2>&1 | head -5`

If the output shows `(empty)` or `UNMET DEPENDENCY`, run:
`cd "s:\Git Hub Repo Manager" && npm install --save-dev supertest`

Expected: supertest installed, package.json updated.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run server/__tests__/tenant-rate-limit.test.js`
Expected: All four tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/tenant-rate-limit.js server/__tests__/tenant-rate-limit.test.js package.json package-lock.json
git commit -m "feat(rate-limit): skip option, HTML redirect, dev auth bump"
```

---

### Task A2: Wire `/session` skip in `server/index.js`

**Files:**

- Modify: `server/index.js`

- [ ] **Step 1: Read lines 165-172 of `server/index.js` to locate the limiter wiring**

Run: `sed -n '165,172p' server/index.js` (or open with the Read tool)

Expected output:

```js
// Per-tenant limiters AFTER session + tier attachment so req.userTier is available
const apiLimiter  = await createTenantLimiters('api');
const authLimiter = await createTenantLimiters('auth');
app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
```

- [ ] **Step 2: Replace the auth limiter instantiation to pass `skip`**

Change:

```js
const authLimiter = await createTenantLimiters('auth');
```

to:

```js
const authLimiter = await createTenantLimiters('auth', {
    // /api/auth/session is an idempotent polled read, not a brute-force target.
    // Letting it flow through the general apiLimiter keeps dev HMR from exhausting
    // the tight auth budget.
    skip: (req) => req.path === '/session',
});
```

Note: `req.path` inside a middleware mounted at `/api/auth/` is the sub-path, so `/session` (not `/api/auth/session`).

- [ ] **Step 3: Restart the dev server and smoke test**

Run: `cd "s:\Git Hub Repo Manager" && curl -i http://localhost:3001/api/auth/session 2>&1 | head -15`

Expected: HTTP 401 (not authenticated) and NO `RateLimit-Remaining` header — the skip bypasses the limiter entirely. If the server wasn't running, skip this step.

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "fix(rate-limit): skip authLimiter on /session polling endpoint"
```

---

## Phase B — Frontend primitives

### Task B1: `useCountdown` hook

**Files:**

- Create: `src/hooks/useCountdown.js`
- Create: `tests/hooks/useCountdown.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useCountdown.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCountdown } from '@/hooks/useCountdown'

describe('useCountdown', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-04-09T10:00:00Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns initial state based on retryAt in the future', () => {
        const retryAt = Date.now() + 30_000 // 30s from now
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.secondsLeft).toBe(30)
        expect(result.current.isReady).toBe(false)
        expect(result.current.progress01).toBeCloseTo(1, 2)
    })

    it('decrements secondsLeft every second', () => {
        const retryAt = Date.now() + 5_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.secondsLeft).toBe(5)
        act(() => { vi.advanceTimersByTime(1000) })
        expect(result.current.secondsLeft).toBe(4)
        act(() => { vi.advanceTimersByTime(2000) })
        expect(result.current.secondsLeft).toBe(2)
    })

    it('flips isReady to true when the timer reaches zero', () => {
        const retryAt = Date.now() + 2_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.isReady).toBe(false)
        act(() => { vi.advanceTimersByTime(2100) })
        expect(result.current.isReady).toBe(true)
        expect(result.current.secondsLeft).toBe(0)
    })

    it('is immediately ready when retryAt is in the past', () => {
        const retryAt = Date.now() - 1_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.isReady).toBe(true)
        expect(result.current.secondsLeft).toBe(0)
        expect(result.current.progress01).toBe(0)
    })

    it('progress01 decreases from 1 to 0 across the lifetime', () => {
        const retryAt = Date.now() + 10_000
        const { result } = renderHook(() => useCountdown(retryAt))
        expect(result.current.progress01).toBeCloseTo(1, 2)
        act(() => { vi.advanceTimersByTime(5000) })
        expect(result.current.progress01).toBeCloseTo(0.5, 2)
        act(() => { vi.advanceTimersByTime(5000) })
        expect(result.current.progress01).toBe(0)
    })

    it('cleans up its interval on unmount', () => {
        const retryAt = Date.now() + 10_000
        const clearSpy = vi.spyOn(globalThis, 'clearInterval')
        const { unmount } = renderHook(() => useCountdown(retryAt))
        unmount()
        expect(clearSpy).toHaveBeenCalled()
        clearSpy.mockRestore()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/useCountdown.test.jsx`
Expected: FAIL with `Cannot find module '@/hooks/useCountdown'`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useCountdown.js`:

```js
/*
 * GitHub Repo Manager
 * Countdown hook — drives UI elements that wait for a future "retry-at" moment.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Countdown hook.
 *
 * @param {number} retryAt      Unix timestamp in ms (same basis as Date.now()).
 * @returns {{ secondsLeft: number, progress01: number, isReady: boolean }}
 *   - secondsLeft: whole seconds remaining, clamped to 0.
 *   - progress01:  1.0 at start of countdown, 0.0 when ready.
 *   - isReady:     true once Date.now() >= retryAt.
 */
export function useCountdown(retryAt) {
    // Pin the starting reference so progress01 is stable across re-renders.
    const startedAtRef = useRef(Date.now())
    const totalMs = Math.max(1, retryAt - startedAtRef.current)

    const compute = () => {
        const msLeft = Math.max(0, retryAt - Date.now())
        return {
            secondsLeft: Math.ceil(msLeft / 1000),
            progress01: Math.max(0, Math.min(1, msLeft / totalMs)),
            isReady: msLeft <= 0,
        }
    }

    const [state, setState] = useState(compute)

    useEffect(() => {
        if (Date.now() >= retryAt) {
            setState({ secondsLeft: 0, progress01: 0, isReady: true })
            return
        }
        const id = setInterval(() => {
            setState(compute())
            if (Date.now() >= retryAt) {
                clearInterval(id)
            }
        }, 1000)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retryAt])

    return useMemo(() => state, [state.secondsLeft, state.progress01, state.isReady])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hooks/useCountdown.test.jsx`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCountdown.js tests/hooks/useCountdown.test.jsx
git commit -m "feat(hooks): useCountdown for retry-at timers"
```

---

### Task B2: Extend `Toast` to accept a `content` prop

**Files:**

- Modify: `src/components/ui/Toast.jsx`

- [ ] **Step 1: Write a failing test**

Append to `tests/hooks/useToast.test.js` (a new `describe` block below the existing one). First read the current tail of the file to confirm the end-of-file line number, then append:

```js
describe('useToast — custom content', () => {
    it('toast.custom stores a ReactNode content and skips message', () => {
        const { result } = renderHook(() => useToast())
        const node = { type: 'div', props: { children: 'hi' } } // shape-only stand-in
        act(() => {
            result.current.toast.custom({ type: 'warning', content: node, duration: 0 })
        })
        expect(result.current.toasts).toHaveLength(1)
        expect(result.current.toasts[0]).toMatchObject({
            type: 'warning',
            content: node,
            duration: 0,
        })
        // No message key from the custom path
        expect(result.current.toasts[0].message).toBeUndefined()
    })

    it('toast.custom with duration 0 does not auto-dismiss', () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useToast())
        act(() => {
            result.current.toast.custom({ type: 'warning', content: 'x', duration: 0 })
        })
        act(() => { vi.advanceTimersByTime(60_000) })
        expect(result.current.toasts).toHaveLength(1)
        vi.useRealTimers()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/useToast.test.js`
Expected: FAIL — `result.current.toast.custom is not a function`.

- [ ] **Step 3: Update `src/hooks/useToast.js`**

Replace the file with:

```js
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// Hook to manage toasts with auto-dismiss
export function useToast() {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef(new Map())

    // Clean up all timers on unmount
    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(timer => clearTimeout(timer))
            timers.clear()
        }
    }, [])

    const dismissToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id))
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToastRecord = useCallback((record) => {
        const id = Date.now() + Math.random()
        setToasts(prev => [...prev, { id, ...record }])
        if (record.duration > 0) {
            const timer = setTimeout(() => dismissToast(id), record.duration)
            timersRef.current.set(id, timer)
        }
        return id
    }, [dismissToast])

    // Backwards-compatible string-message adder.
    const addToast = useCallback((type, message, duration = 5000) => {
        return addToastRecord({ type, message, duration })
    }, [addToastRecord])

    const toast = useMemo(() => ({
        success: (msg, dur) => addToast('success', msg, dur),
        error:   (msg, dur) => addToast('error', msg, dur),
        info:    (msg, dur) => addToast('info', msg, dur),
        warning: (msg, dur) => addToast('warning', msg, dur),
        // Custom content adder — stores a ReactNode instead of a string message.
        custom:  ({ type = 'info', content, duration = 5000 }) =>
            addToastRecord({ type, content, duration }),
    }), [addToast, addToastRecord])

    return { toasts, toast, dismissToast }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hooks/useToast.test.js`
Expected: All tests pass (original 14 + 2 new).

- [ ] **Step 5: Write the failing Toast test**

Append to `tests/components/ui/Toast.test.jsx` if it exists, else create it. First run:

Run: `ls tests/components/ui/Toast.test.jsx 2>&1`

If it does not exist, create `tests/components/ui/Toast.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toast } from '@/components/ui/Toast'

describe('Toast', () => {
    it('renders string message by default', () => {
        render(<Toast id={1} type="info" message="Hello" onDismiss={vi.fn()} duration={0} />)
        expect(screen.getByText('Hello')).toBeInTheDocument()
    })

    it('renders custom content when provided and ignores message', () => {
        render(
            <Toast
                id={1}
                type="warning"
                message="should-not-show"
                content={<div data-testid="custom">Custom body</div>}
                onDismiss={vi.fn()}
                duration={0}
            />
        )
        expect(screen.getByTestId('custom')).toBeInTheDocument()
        expect(screen.queryByText('should-not-show')).not.toBeInTheDocument()
    })
})
```

If the file already existed, add only the "renders custom content" test inside the existing `describe('Toast', ...)` block.

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/components/ui/Toast.test.jsx`
Expected: The "renders custom content" test fails because `Toast` currently always renders `<p>{message}</p>`.

- [ ] **Step 7: Update `src/components/ui/Toast.jsx`**

Find the JSX block that renders `<p className="flex-1 text-sm font-medium">{message}</p>` and replace it with a content-aware wrapper. Read the file first, then apply:

Change the function signature:

```jsx
export function Toast({ id, type = 'info', message, content, onDismiss, duration = 5000 }) {
```

Change the message rendering line:

```jsx
{content ? (
    <div className="flex-1 text-sm">{content}</div>
) : (
    <p className="flex-1 text-sm font-medium">{message}</p>
)}
```

- [ ] **Step 8: Run all Toast tests to verify they pass**

Run: `npx vitest run tests/components/ui/Toast.test.jsx tests/hooks/useToast.test.js`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/Toast.jsx src/hooks/useToast.js tests/components/ui/Toast.test.jsx tests/hooks/useToast.test.js
git commit -m "feat(toast): optional ReactNode content slot + toast.custom()"
```

---

## Phase C — `RateLimitNotice` component

### Task C1: Build `RateLimitNotice` (toast + banner variants) with tests

**Files:**

- Create: `src/components/ui/RateLimitNotice.jsx`
- Create: `tests/components/ui/RateLimitNotice.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/ui/RateLimitNotice.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RateLimitNotice } from '@/components/ui/RateLimitNotice'

// Mock framer-motion to skip animations in tests
vi.mock('framer-motion', () => ({
    motion: new Proxy({}, {
        get: () => ({ children, ...props }) => {
            const filtered = { ...props }
            delete filtered.initial
            delete filtered.animate
            delete filtered.exit
            delete filtered.transition
            delete filtered.whileHover
            delete filtered.whileTap
            return <div {...filtered}>{children}</div>
        },
    }),
    AnimatePresence: ({ children }) => <>{children}</>,
}))

describe('RateLimitNotice', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-04-09T10:00:00Z'))
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('renders toast variant with a visible seconds-left count', () => {
        const retryAt = Date.now() + 30_000
        render(<RateLimitNotice variant="toast" retryAt={retryAt} />)
        // "30" should appear inside the countdown element
        expect(screen.getByText('30')).toBeInTheDocument()
        // The friendly message prefix
        expect(screen.getByText(/take a quick breath/i)).toBeInTheDocument()
    })

    it('renders banner variant with the Retry now button disabled until ready', () => {
        const retryAt = Date.now() + 10_000
        render(<RateLimitNotice variant="banner" retryAt={retryAt} />)
        const button = screen.getByRole('button', { name: /retry now/i })
        expect(button).toBeDisabled()
    })

    it('enables the retry button when countdown reaches zero and calls onRetry', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        const retryAt = Date.now() + 2_000
        const onRetry = vi.fn()
        render(<RateLimitNotice variant="banner" retryAt={retryAt} onRetry={onRetry} />)
        const button = screen.getByRole('button', { name: /retry now/i })
        expect(button).toBeDisabled()
        // Let the countdown expire
        await vi.advanceTimersByTimeAsync(2100)
        expect(button).toBeEnabled()
        await user.click(button)
        expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('shows the "ready" copy when isReady', () => {
        const retryAt = Date.now() - 1_000 // already ready
        render(<RateLimitNotice variant="toast" retryAt={retryAt} />)
        expect(screen.getByText(/you're good to go/i)).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/ui/RateLimitNotice.test.jsx`
Expected: FAIL — `Cannot find module '@/components/ui/RateLimitNotice'`.

- [ ] **Step 3: Implement the component**

Create `src/components/ui/RateLimitNotice.jsx`:

```jsx
/*
 * GitHub Repo Manager
 * RateLimitNotice — friendly countdown treatment for 429 responses.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { motion } from 'framer-motion'
import { Hourglass, RotateCcw, X } from 'lucide-react'
import { useCountdown } from '@/hooks/useCountdown'

/**
 * RateLimitNotice
 *
 * @param {object} props
 * @param {number} props.retryAt       Unix ms when the user can retry.
 * @param {'toast'|'banner'} [props.variant='toast']
 * @param {() => void} [props.onRetry] Called when Retry button is clicked (after ready).
 * @param {() => void} [props.onDismiss] Optional dismiss; shows an X button when provided.
 */
export function RateLimitNotice({ retryAt, variant = 'toast', onRetry, onDismiss }) {
    const { secondsLeft, progress01, isReady } = useCountdown(retryAt)

    // Circular progress — 36x36 SVG, 16 radius, ~100 circumference
    const radius = 16
    const circumference = 2 * Math.PI * radius
    const dashOffset = circumference * (1 - progress01)

    const message = isReady
        ? "You're good to go"
        : `Take a quick breath — we'll be ready again in ${secondsLeft}s`

    const handleRetry = () => {
        if (!isReady) return
        onRetry?.()
    }

    const Ring = (
        <div className="relative w-10 h-10 shrink-0" aria-hidden="true">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                <circle
                    cx="20" cy="20" r={radius}
                    fill="none"
                    strokeWidth="3"
                    className="stroke-amber-200/60 dark:stroke-amber-500/20"
                />
                <circle
                    cx="20" cy="20" r={radius}
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="stroke-amber-500 dark:stroke-amber-400 transition-[stroke-dashoffset] duration-700 ease-linear"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                />
            </svg>
            <motion.div
                className="absolute inset-0 flex items-center justify-center"
                animate={{ rotate: isReady ? 0 : [0, 180] }}
                transition={{ repeat: isReady ? 0 : Infinity, duration: 2, ease: 'easeInOut' }}
            >
                <Hourglass className="w-4 h-4 text-amber-600 dark:text-amber-300" />
            </motion.div>
            {!isReady && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="sr-only">{secondsLeft} seconds remaining</span>
                </div>
            )}
        </div>
    )

    const SecondsText = !isReady && (
        <motion.span
            key={secondsLeft}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.35 }}
            className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300"
        >
            {secondsLeft}
        </motion.span>
    )

    const RetryButton = (
        <button
            type="button"
            onClick={handleRetry}
            disabled={!isReady}
            className={`
                group flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold
                transition-all duration-200
                focus-visible:ring-2 focus-visible:ring-amber-500 focus:outline-none
                ${isReady
                    ? 'bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-slate-900 shadow-sm hover:shadow-md active:scale-[0.97]'
                    : 'bg-amber-500/10 dark:bg-amber-400/10 text-amber-700/60 dark:text-amber-300/50 cursor-not-allowed'}
            `}
        >
            <RotateCcw className={`w-3.5 h-3.5 transition-transform duration-300 ${isReady ? 'group-hover:-rotate-45' : ''}`} />
            Retry now
        </button>
    )

    if (variant === 'banner') {
        return (
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                role="status"
                aria-live="polite"
                className="relative z-30"
            >
                <div className="bg-amber-50/90 dark:bg-amber-900/60 border-b border-amber-300 dark:border-amber-500 backdrop-blur-xl">
                    <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3 sm:gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                            {Ring}
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200/90 truncate">
                                {message}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {SecondsText}
                            {RetryButton}
                            {onDismiss && (
                                <button
                                    onClick={onDismiss}
                                    className="p-1.5 rounded-md text-amber-500/60 dark:text-amber-400/40 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 dark:hover:bg-amber-400/10 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus:outline-none"
                                    aria-label="Dismiss notice"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        )
    }

    // toast variant
    return (
        <div className="flex items-center gap-3 min-w-0">
            {Ring}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200/90 truncate">
                    {message}
                </p>
            </div>
            {SecondsText}
            {RetryButton}
        </div>
    )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/ui/RateLimitNotice.test.jsx`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/RateLimitNotice.jsx tests/components/ui/RateLimitNotice.test.jsx
git commit -m "feat(ui): RateLimitNotice component with toast and banner variants"
```

---

## Phase D — Wiring

### Task D1: `api.js` — parse `Retry-After` and emit `onRateLimit`

**Files:**

- Modify: `src/utils/api.js`
- Modify: `tests/utils/api.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/utils/api.test.js` (inside the file, as a new `describe` block at the bottom before the closing — read the file first to find the insertion point):

```js
describe('onRateLimit event bus', () => {
    it('fires listeners with retryAfterSec from Retry-After header', async () => {
        const { onRateLimit, fetchWithRetry } = await import('@/utils/api')
        const received = []
        const unsub = onRateLimit((info) => received.push(info))

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify({ error: 'rate' }), {
                status: 429,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '45' },
            })
        )

        await expect(
            fetchWithRetry('/api/whatever', {}, { maxRetries: 0 })
        ).rejects.toMatchObject({ type: 'RATE_LIMIT' })

        expect(received).toHaveLength(1)
        expect(received[0].retryAfterSec).toBe(45)

        unsub()
        fetchSpy.mockRestore()
    })

    it('attaches retryAfterSec to the ApiError data', async () => {
        const { fetchWithRetry } = await import('@/utils/api')
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response('{}', {
                status: 429,
                headers: { 'Content-Type': 'application/json', 'Retry-After': '12' },
            })
        )
        try {
            await fetchWithRetry('/api/whatever', {}, { maxRetries: 0 })
        } catch (err) {
            expect(err.type).toBe('RATE_LIMIT')
            expect(err.data?.retryAfterSec).toBe(12)
        }
        fetchSpy.mockRestore()
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/utils/api.test.js`
Expected: The two new tests fail — `onRateLimit is not a function` and `err.data?.retryAfterSec` is undefined.

- [ ] **Step 3: Update `src/utils/api.js`**

1. Add the rate-limit event bus next to the existing `onSessionExpired` bus. Locate the "Auth Event Bus" comment block (around line 26) and add below it:

```js
// ============ Rate Limit Event Bus ============
// Fires whenever a 429 is encountered, regardless of call site. App.jsx
// subscribes once and surfaces a toast; individual call sites don't need
// to wire anything up.

const rateLimitListeners = new Set()

export function onRateLimit(callback) {
    rateLimitListeners.add(callback)
    return () => rateLimitListeners.delete(callback)
}

function notifyRateLimit(info) {
    rateLimitListeners.forEach(cb => {
        try { cb(info) } catch (e) { console.error('RateLimit listener error', e) }
    })
}
```

2. In `fetchWithRetry`, after the existing `errorData = await response.json()` parse block but before `categorizeError` is called, extract the `Retry-After` header and attach it. Change:

```js
// Parse error response body to preserve server-provided details
let errorData = null
try { errorData = await response.json() } catch (_e) { /* ignore parse error */ }

// Categorize the error
const apiError = categorizeError(response.status)
apiError.data = errorData
```

to:

```js
// Parse error response body to preserve server-provided details
let errorData = null
try { errorData = await response.json() } catch (_e) { /* ignore parse error */ }

// Parse Retry-After header (in seconds). Falls back to 60 if unparseable.
if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After')
    const retryAfterSec = Number.parseInt(retryAfterHeader, 10)
    errorData = {
        ...(errorData || {}),
        retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : 60,
    }
    notifyRateLimit({ retryAfterSec: errorData.retryAfterSec })
}

// Categorize the error
const apiError = categorizeError(response.status)
apiError.data = errorData
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/utils/api.test.js`
Expected: All tests pass (existing + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/utils/api.js tests/utils/api.test.js
git commit -m "feat(api): parse Retry-After and emit onRateLimit events"
```

---

### Task D2: `App.jsx` — subscribe to `onRateLimit` and render toast

**Files:**

- Modify: `src/App.jsx`

- [ ] **Step 1: Read the current session-expiry subscription as a pattern reference**

Read `src/App.jsx` around lines 130-145 (the existing `onSessionExpired` subscription). You will mirror it directly below.

- [ ] **Step 2: Add imports**

At the top of `App.jsx`, change:

```js
import { onSessionExpired, resetSessionExpired, fetchWithRetry, safeParseJson } from './utils/api'
```

to:

```js
import { onSessionExpired, onRateLimit, resetSessionExpired, fetchWithRetry, safeParseJson } from './utils/api'
```

And add below the existing `SessionBanner` import:

```js
import { RateLimitNotice } from './components/ui/RateLimitNotice'
```

- [ ] **Step 3: Subscribe to `onRateLimit` and push a custom toast**

Directly after the existing `useEffect` that subscribes to `onSessionExpired` (around line 132-139), add:

```jsx
// Rate-limit toasts — one at a time, auto-dismisses after the countdown ends.
const rateLimitToastIdRef = useRef(null)
useEffect(() => {
    const unsubscribe = onRateLimit(({ retryAfterSec }) => {
        if (rateLimitToastIdRef.current !== null) return // dedupe
        const retryAt = Date.now() + retryAfterSec * 1000
        const id = toast.custom({
            type: 'warning',
            duration: (retryAfterSec + 1) * 1000,
            content: (
                <RateLimitNotice
                    retryAt={retryAt}
                    variant="toast"
                    onRetry={() => {
                        if (rateLimitToastIdRef.current !== null) {
                            dismissToast(rateLimitToastIdRef.current)
                            rateLimitToastIdRef.current = null
                        }
                    }}
                />
            ),
        })
        rateLimitToastIdRef.current = id
        setTimeout(() => {
            if (rateLimitToastIdRef.current === id) {
                rateLimitToastIdRef.current = null
            }
        }, (retryAfterSec + 1) * 1000)
    })
    return unsubscribe
}, [toast, dismissToast])
```

Note: `useRef` is already imported; `dismissToast` is already destructured from `useToast()` at the top of the component.

- [ ] **Step 4: Manually verify there are no syntax errors**

Run: `npx vitest run tests/components/ui/RateLimitNotice.test.jsx tests/hooks/useToast.test.js tests/utils/api.test.js`
Expected: All pass. This confirms the imports and wiring compile.

Additionally: `cd "s:\Git Hub Repo Manager" && node -e "require('fs').readFileSync('src/App.jsx', 'utf8')"` (sanity check that the file is readable).

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): surface rate-limit toasts via onRateLimit subscription"
```

---

### Task D3: `App.jsx` — query-param-driven banner for direct-navigation case

**Files:**

- Modify: `src/App.jsx`

- [ ] **Step 1: Add state for the query-param banner**

Near the other `useState` declarations at the top of `AppContent()` (after `const [sessionExpired, setSessionExpired] = useState(false)`, around line 73), add:

```jsx
const [rateLimitBanner, setRateLimitBanner] = useState(null) // { retryAt: number } | null
```

- [ ] **Step 2: Read `?error=rate_limited&retry=N` on mount**

Directly after the `useEffect` you added in Task D2, add:

```jsx
// Direct-navigation rate-limit case — the backend redirected us here with ?error=rate_limited&retry=N.
useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') !== 'rate_limited') return
    const retry = Number.parseInt(params.get('retry') || '60', 10)
    const retryAt = Date.now() + (Number.isFinite(retry) ? retry : 60) * 1000
    setRateLimitBanner({ retryAt })
    // Strip the query params so a refresh doesn't re-show the banner with a stale count.
    params.delete('error')
    params.delete('retry')
    const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '')
    window.history.replaceState({}, '', cleanUrl)
}, [])
```

- [ ] **Step 3: Render the banner above `SessionBanner`**

Find the `<SessionBanner` JSX (around line 513) and insert the rate-limit banner above it:

```jsx
{rateLimitBanner && (
    <RateLimitNotice
        variant="banner"
        retryAt={rateLimitBanner.retryAt}
        onRetry={() => {
            setRateLimitBanner(null)
            // After countdown, re-attempt the original action. For the login case,
            // navigating directly to /api/auth/login restarts the OAuth flow.
            window.location.href = '/api/auth/login'
        }}
        onDismiss={() => setRateLimitBanner(null)}
    />
)}
<SessionBanner
    visible={sessionExpired}
    ...
```

- [ ] **Step 4: Smoke test by running the app**

Run: `cd "s:\Git Hub Repo Manager" && curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`
Expected: 200. If the dev server isn't running, start it with `npm run dev`.

Then in a browser: navigate to `http://localhost:5173/?error=rate_limited&retry=30` and verify the amber banner appears with a countdown ticking from 30.

- [ ] **Step 5: Run the whole test suite to catch regressions**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(app): render rate-limit banner for ?error=rate_limited direct nav"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: All tests pass (435+ unit tests, 0 regressions).

- [ ] **Step 2: Backend manual test**

Run: `cd "s:\Git Hub Repo Manager" && curl -i -H "Accept: text/html" "http://localhost:3001/api/auth/login"` (after restarting the backend). Hit it 15+ times to exhaust the prod budget (or temporarily set `NODE_ENV=production` locally). The first 10 should return a redirect to GitHub; subsequent ones should redirect to `http://localhost:5173/?error=rate_limited&retry=900`.

- [ ] **Step 3: Frontend manual test**

1. In the browser, navigate to `http://localhost:5173/?error=rate_limited&retry=15` and confirm the amber banner renders with a 15→0 countdown, the progress ring animates, and "Retry now" becomes enabled at zero.
2. Open DevTools → Network, right-click any request, and use "Block request URL" to force a 429 on `/api/session` — confirm the toast appears (bottom-right) with the custom countdown content.
