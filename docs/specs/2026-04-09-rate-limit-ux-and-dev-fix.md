# Rate Limit UX Treatment & Dev-Mode Fix

**Status:** Draft
**Date:** 2026-04-09
**Owner:** Bruno Marques

## Problem

Visiting `/api/auth/login` directly in dev returns raw JSON:

```json
{ "error": "Rate limit exceeded. Please try again later." }
```

Two things are wrong:

1. **The 429 is spurious in dev.** The per-tenant `authLimiter` caps the `free` tier at 10 auth requests per 15 minutes. That budget is shared across *every* endpoint under `/api/auth/*`, including `/session` — which the frontend polls on every mount. Vite HMR + React Strict Mode reloads exhaust the budget in minutes during normal development, even though no login attempt has actually happened.
2. **When the 429 does fire, the UX is raw JSON.** There is no friendly treatment for rate-limit errors anywhere in the app — not for in-app fetches, not for direct navigation to auth endpoints. Users see either a console error or a browser-rendered JSON blob.

## Goals

- Eliminate the spurious dev-mode 429 by removing session polling from the auth-category budget and raising dev limits.
- Present any legitimate 429 with a calm, on-brand treatment featuring a live retry countdown — reusing the existing `Toast` and banner patterns.
- Never show raw JSON to a user who navigates directly to a rate-limited auth endpoint.

## Non-Goals

- Redesigning rate-limit policy for production (`free`/`pro`/`enterprise` tier numbers stay as they are).
- Touching rate limiting for `/api/ai/*` or any non-auth category.
- Adding a full error-page routing system. The treatment reuses existing toast + banner patterns plus an SPA-consumed query param.

## Root Cause (Evidence)

- [server/middleware/tenant-rate-limit.js:5-8](server/middleware/tenant-rate-limit.js#L5-L8): `TIER_LIMITS.free.auth = 10`.
- [server/middleware/tenant-rate-limit.js:48](server/middleware/tenant-rate-limit.js#L48): all categories share `message: { error: 'Rate limit exceeded...' }`. No `handler`, so `express-rate-limit` responds with the JSON regardless of `Accept`.
- [server/index.js:170](server/index.js#L170): `app.use('/api/auth/', authLimiter)` — applied to every auth endpoint.
- [src/App.jsx:180](src/App.jsx#L180): frontend calls `fetch('/api/auth/session', ...)` on mount. React Strict Mode double-invokes effects in dev; HMR remounts providers on every save. 10 reqs disappear fast.

## Design

### Backend changes

#### 1. `/api/auth/session` bypasses the auth limiter

Session checks are idempotent reads that reveal nothing sensitive beyond "are you logged in?" They are not a brute-force target. Move `/session` out of the per-tenant `auth` budget and let it flow through the regular `apiLimiter` (which uses the `api` category, already generous enough for polling).

Implementation: in `server/index.js`, mount `/api/auth/session` **before** `authLimiter` is applied (routes are matched in order), or use `express-rate-limit`'s `skip: (req) => req.path === '/session'` on the `authLimiter` factory.

Preferred approach: add a `skip` function in `createTenantLimiters('auth')` callers (or accept an optional `skipPaths` argument) to keep the middleware definition declarative and testable.

```js
// server/index.js
const authLimiter = await createTenantLimiters('auth', {
    skip: (req) => req.path === '/session',
});
```

`createTenantLimiters` signature extended to accept an options object with an optional `skip` function forwarded to `express-rate-limit`.

#### 2. Dev-mode tier bump for `auth`

Raise the dev auth budget enough that HMR/reload noise doesn't trip the limit, while keeping production values untouched:

```js
// server/middleware/tenant-rate-limit.js
const isDev = process.env.NODE_ENV !== 'production';
const TIER_LIMITS = {
    free:       { api: 100,  ai: 10,  auth: isDev ? 200 : 10 },
    pro:        { api: 500,  ai: 50,  auth: 20 },
    enterprise: { api: 2000, ai: 200, auth: 50 },
};
```

Rationale: 200 auth calls / 15 min in dev accommodates realistic Strict Mode + HMR churn. Production stays at 10 to preserve brute-force resistance.

#### 3. HTML-aware handler on the auth limiter

When a rate-limited request accepts HTML (i.e., the browser is navigating directly), redirect to the SPA with a query string so the frontend can render a treatment. Otherwise, keep the existing JSON response for programmatic clients.

```js
// inside createTenantLimiters
handler: (req, res, _next, options) => {
    const retryAfterSec = Math.ceil(options.windowMs / 1000);
    res.set('Retry-After', String(retryAfterSec));
    if (req.accepts('html')) {
        const frontend = process.env.FRONTEND_URL || '';
        return res.redirect(
            `${frontend}/?error=rate_limited&retry=${retryAfterSec}`
        );
    }
    res.status(options.statusCode).json(options.message);
},
```

This turns the "user typed `/api/auth/login` into the URL bar" case into a graceful SPA load with a visible error state instead of a JSON blob.

### Frontend changes

#### 1. `RateLimitNotice` — shared presentational component

New component at `src/components/ui/RateLimitNotice.jsx`. Two modes passed via a `variant` prop:

- **`variant="toast"`** — compact pill for the `ToastContainer` slot. See section 1a for the minimal `Toast` extension needed to host custom content.
- **`variant="banner"`** — full-width banner, styled like `SessionBanner` (amber family, `Hourglass` icon from lucide-react).

Props:

- `retryAt` — Unix timestamp in milliseconds (same basis as `Date.now()`). When `Date.now() >= retryAt`, the notice is ready for retry.
- `variant` — `'toast' | 'banner'`, default `'toast'`.
- `onRetry` — optional callback fired when the user clicks the Retry button. If omitted, the button simply dismisses the notice.
- `onDismiss` — optional; when provided, shows a close (X) button.

Shared internals:

- Uses the new `useCountdown` hook (section 2) to derive `secondsLeft`, `progress01`, `isReady` from `retryAt`.
- Circular progress ring rendered via SVG `stroke-dasharray` on a `<circle>`, animating 0→full as `progress01` goes 1→0. Wraps the countdown number.
- Copy template: `Take a quick breath — we'll be ready again in {secondsLeft}s` (switches to `You're good to go` when `isReady`).
- `Retry now` button, `disabled={!isReady}`, transitions opacity/scale via Tailwind when it becomes enabled.
- Framer Motion: hourglass icon rotates 180° every 2s via `animate={{ rotate: [0, 180] }} transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}`; banner slides from top on mount; countdown number gets a subtle `scale: [1, 1.05, 1]` pulse on each tick.

Both variants use `backdrop-blur-xl` plus the amber family (`bg-amber-50/90 dark:bg-amber-900/60 border-amber-300 dark:border-amber-500`) to match existing warning patterns.

#### 1a. Extend `Toast` to host custom content

The existing `Toast` component at `src/components/ui/Toast.jsx` only accepts a string `message` prop. Add an optional `content` prop (ReactNode); when provided, it replaces the default `<p>{message}</p>` but the surrounding shell (border color, glassmorphism, dismiss button, aria semantics) is preserved.

Correspondingly, extend `useToast` with a `toast.custom({ type, content, duration })` method that bypasses the `message` string and stores `content` on the toast record. `addToast` gains an options-object overload: `addToast({ type, message?, content?, duration? })`. The existing positional-argument signature is preserved for backwards compatibility.

#### 2. `useCountdown` hook

`src/hooks/useCountdown.js`. Accepts `retryAt` (Unix timestamp in milliseconds) and an optional `startedAt` (ms, defaults to the hook's first render time, used to compute `progress01`). Returns `{ secondsLeft, progress01, isReady }` where `progress01 = max(0, min(1, (retryAt - now) / (retryAt - startedAt)))`. Uses a 1s `setInterval`; when the tab is hidden (`document.visibilityState === 'hidden'`) the interval is paused and the state is recomputed on `visibilitychange`. Cleans up interval + listener on unmount.

Pure, deterministic, easy to unit-test with fake timers.

#### 3. `useAuth` / `fetchWithRetry` integration

`fetchWithRetry` already categorizes 429s as `ErrorType.RATE_LIMIT` ([src/utils/api.js:113-114](src/utils/api.js#L113-L114)). Two additions:

1. **Parse `Retry-After`** from the 429 response and attach `retryAfterSec` to `ApiError.data`. This flows to consumers via `getErrorInfo`.
2. **Emit a global rate-limit event** via a thin event bus (mirror of the existing `onSessionExpired` pattern) so any 429 — from any call site — surfaces a toast without every caller having to wire it up.

```js
// src/utils/api.js
const rateLimitListeners = new Set()
export function onRateLimit(cb) {
    rateLimitListeners.add(cb)
    return () => rateLimitListeners.delete(cb)
}
function notifyRateLimit(retryAfterSec) {
    rateLimitListeners.forEach(cb => {
        try { cb({ retryAfterSec }) } catch (e) { console.error(e) }
    })
}
// call notifyRateLimit inside categorizeError for status 429
```

App.jsx subscribes to `onRateLimit` and pushes a toast via `useToast`. One wiring point, app-wide coverage.

#### 4. SPA query-param consumption for direct-navigation case

`App.jsx` reads `new URLSearchParams(window.location.search)` on mount. If `error === 'rate_limited'`, shows `RateLimitNotice` in `banner` mode at the top of the app (above the header), with the `retry` value as `retryAfterSec`. Once the countdown completes and the user clicks `Retry now`, strip the query params via `history.replaceState` and navigate to the originally-intended URL (for the auth case, that's `/api/auth/login`).

#### 5. Existing `SessionBanner` untouched

The session-expired banner and the rate-limit banner are distinct concerns with the same visual family. Keep them separate components; they can coexist if a user is both rate-limited and session-expired (unlikely but possible).

### Component tree

```text
App
├── RateLimitBanner (optional, top-of-app)          ← query-param-driven
├── SessionBanner   (existing)
├── ... rest of app
└── ToastContainer
    └── Toast[]
        └── Toast content slot → RateLimitNotice (toast variant)   ← event-bus-driven
```

### Data flow

1. Any component calls `fetchWithRetry(...)`.
2. Server responds `429` with `Retry-After` header.
3. `categorizeError(429)` builds `ApiError` with `data.retryAfterSec` and calls `notifyRateLimit`.
4. `App.jsx` subscription fires → `useToast.add({ content: <RateLimitNotice variant="toast" retryAt={now + retryAfterSec} /> })`.
5. User sees the toast with countdown. On `isReady`, the `Retry now` button enables. Clicking either dismisses the toast or re-runs the originally-failed action (the toast exposes an optional `onRetry` callback that the caller can wire up if retryability is meaningful).

For the direct-navigation case, the backend redirect replaces steps 1-3 with a URL query param, and `App.jsx` picks it up directly instead of via the event bus.

## Testing

### Unit tests

- `tests/hooks/useCountdown.test.jsx` — fake timers; assert `secondsLeft` decrements, `isReady` flips at 0, cleanup on unmount.
- `tests/components/ui/RateLimitNotice.test.jsx` — renders in both variants; countdown text updates; `Retry now` button disabled → enabled transition; `onRetry` invoked on click after ready.
- `tests/utils/api.test.js` — extend existing tests: 429 response with `Retry-After: 30` produces `ApiError` with `data.retryAfterSec === 30` and fires `onRateLimit` listeners once.
- `server/__tests__/tenant-rate-limit.test.js` — `skip: req.path === '/session'` is honored; HTML `Accept` header produces a redirect; JSON `Accept` produces the current JSON response; dev `auth` limit is 200, prod is 10.

### E2E tests

- `e2e/rate-limit.spec.js` — simulate 429 by temporarily forcing the dev limiter low; verify the toast appears with a visible countdown; verify that navigating directly to `/api/auth/login` under 429 lands on the SPA with the banner (not raw JSON).

### Manual verification

- Trigger dev 429 by bumping `authLimiter` to `{ max: 2 }` temporarily and refreshing three times. Confirm banner renders instead of JSON.
- Confirm `/api/auth/session` no longer consumes the auth budget after the `skip` change (watch server logs / rate-limit response headers).

## Risk & Rollback

- **Risk:** frontend event bus fires on *every* 429 — if a background polling loop keeps hitting 429, it could spam toasts. Mitigation: dedupe in the `App.jsx` subscriber (ignore if a rate-limit toast is already visible), and let the single toast's countdown reflect the most recent `retryAfterSec`.
- **Risk:** `skip` on `/session` could be abused to infer whether a session exists. This is already observable via the 200/401 response; `skip` does not make it more leaky.
- **Rollback:** all changes are additive or behind existing abstractions. Reverting is a single-commit revert; no schema changes, no stored state.

## Open Questions

None at draft time. If the user wants a dedicated `/rate-limited` page instead of the banner treatment for the direct-navigation case, the `RateLimitNotice` component already supports that by using `variant="banner"` on a page wrapper — but adding a new route is outside this spec's scope.
