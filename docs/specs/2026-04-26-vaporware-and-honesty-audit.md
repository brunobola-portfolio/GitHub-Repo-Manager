# Vaporware Elimination & Honesty Audit

**Date:** 2026-04-26
**Status:** Draft
**Slice:** #1 of 4 in the "tudo lindo, sem vaporware, premium, fácil de usar" final pass.
**Companion specs (deferred to later slices):** premium AI features (#2), UX/UI uniformity (#3), code health (#4).
**Predecessor:** [2026-04-11-product-honesty-pass.md](./2026-04-11-product-honesty-pass.md) eliminated visible vaporware in menus, pricing, and orphan endpoints. This spec catches the *non-visible* vaporware that survives in production builds and the inconsistencies in error/quota UX that remain.

---

## Problem

The 2026-04-11 honesty pass closed the obvious gaps — every menu item works, every backend endpoint has a UI entry, the pricing page is honest. But three classes of dishonesty remain in the codebase, each invisible to a casual user but failing the bar of "premium, sem vaporware":

1. **Mock data ships in production builds.** Five callsites generate fake data via `Math.random` and ship to `dist/` regardless of environment:
   - [src/api/ai.js:65-103, 337](../../src/api/ai.js#L65) — `mockAnalysis()`, `mockQualityReport()`, batch-index fake `health_score`
   - [src/hooks/useRepos.js:25-74, 94-99](../../src/hooks/useRepos.js#L25) — `generateMockData()` with 87 fake repos, fake stars, fake topics
   - [src/hooks/useOrgs.js:14-117](../../src/hooks/useOrgs.js#L14) — fake org activity feed (15 items, random repo names, random timestamps)
   - [src/hooks/useWorkBoard.js:134-166](../../src/hooks/useWorkBoard.js#L134) — synthetic 30-day commit counts
   
   These are gated by `MOCK_MODE` runtime flag, but the *code* — strings, fake repo names ("nlp-chatbot-engine", "web-assembly-video-editor"), the random generators — exists in every production bundle. A build inspection would expose them. Worse: if `VITE_MOCK_MODE=true` ever leaks into a prod env file, real users see fake repos.

2. **Error messages are inconsistent and sometimes leak internals.** Across the codebase, error toasts and banners follow at least four patterns:
   - `toast.error(err.message)` — leaks raw backend error strings, sometimes including DB column names or stack fragments
   - `toast.error('Something went wrong')` — too vague, no recovery path
   - `toast.error(\`Failed to do X: ${err.message}\`)` — partial leak with prefix
   - `setError({ message: ..., recovery: ... })` — the right pattern, used in only ~6 components
   
   No central helper, no enforced shape, no guarantee that stack traces never reach the user. Some 429 responses fall through to the generic `err.message` toast and surface "Rate limit exceeded" with no actionable follow-up.

3. **Cap-reached / quota responses are non-specific.** When the user hits a limit, the current behavior depends on which endpoint:
   - AI quota exceeded → toast "Monthly AI quota exceeded. Upgrade to Pro." (generic, no link, no remaining-time info)
   - Repo limit on Free → blocked silently in Settings → Billing or fails on create with `{ error: 'Tier limit' }`
   - BYOK key invalid → toast "AI request failed" with no hint about Settings → AI
   - Free user calling Pro feature → `403 { error: 'Tier required: pro' }` → frontend shows "Forbidden"
   
   Each surface has a different recovery path encoded ad-hoc in JSX. There is no `<QuotaExceededState />` primitive, so each new feature reinvents the CTA.

The sum: a careful user inspecting devtools, a paranoid CI scanner, or anyone hitting an edge case sees that the surface premium polish is one layer thin. This spec eliminates all three issues with a structural fix that survives future work.

## Goals

1. **Production builds contain zero mock data.** Verifiable by a CI test that fails when `dist/` contains known mock markers.
2. **Every UI error message follows one shape:** `{ title, body, action? }` with no stack trace, no raw backend string, no `JSON.stringify(err)`.
3. **Every cap/quota response surfaces through one component** (`<QuotaExceededState />`) with a tier-specific CTA and direct link to the resolution path.
4. **Zero-config first run renders honest EmptyStates** on every primary surface (Dashboard, RepoList, OrgPanel, WorkBoard, AI Assistant) — never a single fake repo.
5. **No regression to the surface premium polish:** every replacement EmptyState uses the existing `<EmptyState />` primitive with `ds-*` classes and matches the visual language of the rest of the app.

## Non-goals

- **No changes to the licensing tier matrix.** This is a presentation/structural pass, not a tier rebalance.
- **No new AI features, no new backend endpoints.** The 5 mock-data sites are *removed* from prod, not replaced with real implementations of features that don't exist.
- **No refactor of the toast component itself.** `toast.error(...)` continues to work; we only change what gets passed in.
- **No e2e coverage of every error case.** One e2e test covers the zero-config first-run honesty contract; unit tests cover individual handlers.
- **No removal of `MOCK_MODE`.** Demo offline mode is still useful for stakeholder demos and tests — it just stops being a production code path.
- **No changes to backend audit logging or rate-limit middleware.** Backend remains as-is; we only enrich error response payloads with `code`/`feature`/`limit`/`resetAt` so the frontend can render specific CTAs.
- **No new dependencies.** All work uses existing primitives (`<EmptyState />`, `framer-motion`, `lucide-react`).

---

## Solution overview

Single spec, four waves. Each wave commits + pushes independently, suite green between waves.

| Wave | Theme | Effort | Ship independently? |
|---|---|---|---|
| **Wave 1** | Mock elimination via `src/__mocks__/` + build-time guards + EmptyStates + CI honesty test | ~1.5h | Yes |
| **Wave 2** | `formatUserError()` helper + sweep of toast/banner callsites | ~45min | Yes |
| **Wave 3** | `<QuotaExceededState />` primitive + sweep of 429/403 handlers + backend response enrichment | ~30min | Yes |
| **Wave 4** | Zero-config e2e + README/ROADMAP regression grep | ~30min | Yes |

---

## Wave 1 — Mock elimination

### 1.1 New `src/__mocks__/` directory

Create four files, each exporting pure generators with no other side effects:

- `src/__mocks__/mockRepos.js` — moves `generateMockData()` from [useRepos.js:24-74](../../src/hooks/useRepos.js#L24)
- `src/__mocks__/mockOrgs.js` — moves the org activity + org repos generators from [useOrgs.js:14-117](../../src/hooks/useOrgs.js#L14)
- `src/__mocks__/mockWorkBoard.js` — moves the 30-day synthetic commits from [useWorkBoard.js:134-166](../../src/hooks/useWorkBoard.js#L134)
- `src/__mocks__/mockAI.js` — moves `mockAnalysis()`, `mockQualityReport()`, and the batch-index mock results from [api/ai.js:65-337](../../src/api/ai.js#L65)

Each file gets a header comment:

```js
// Mock data generators — DEV ONLY.
// Imported via dynamic import() guarded by import.meta.env.DEV.
// In production builds Vite's dead-code elimination drops the entire
// import branch, so no string in this file ships to dist/.
```

### 1.2 Build-time guards at every callsite

Replace synchronous mock usage with a guarded async pattern. Example for [useRepos.js:96](../../src/hooks/useRepos.js#L96):

```js
useEffect(() => {
  if (!(import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true')) return
  let cancelled = false
  ;(async () => {
    const { generateMockData } = await import('../__mocks__/mockRepos.js')
    if (cancelled) return
    const { repos: mockRepos, totalPages: mockTotalPages } = generateMockData(1, perPage)
    setRepos(mockRepos)
    setTotalPages(mockTotalPages)
  })()
  return () => { cancelled = true }
}, [perPage])
```

Why dual guards: `import.meta.env.DEV` (Vite replaces with literal `false` in `vite build`) ensures dead-code elimination removes the entire dynamic import. `VITE_MOCK_MODE === 'true'` is the runtime opt-in for developers who want real data even in dev.

Cancellation flag protects against unmount races during async load.

### 1.3 Honest EmptyStates at every surface

Each surface that previously fell back to mock data gets a contextual EmptyState. The CTAs link to the resolution path that actually fixes the missing data.

| Surface | EmptyState title | CTA |
|---|---|---|
| `RepoList` (no repos, GH connected) | "No repositories yet" | "Create a repository" → opens CreateRepoModal |
| `RepoList` (GH not connected) | "Connect GitHub to see your repositories" | "Sign in with GitHub" → triggers OAuth |
| `OrgPanel` (no orgs) | "No organizations" | "Learn about GitHub orgs" → docs link |
| `Dashboard` (zero data) | already handled by [DashboardPremium](../../src/components/Dashboard/DashboardPremium.jsx) — verify, fix if regressed |
| `WorkBoard` daily chart (no data) | "No activity in the last 30 days" | "Refresh" → triggers re-fetch |
| `AI Assistant` quality report (AI off) | already handled by `AINotConfiguredBanner` — verify, remove the "showing mock data" wording from the comment ([AINotConfiguredBanner.jsx:24](../../src/components/AI/AINotConfiguredBanner.jsx#L24)) since it's no longer accurate |

All EmptyStates reuse `<EmptyState />` from [src/components/ui/EmptyState.jsx](../../src/components/ui/EmptyState.jsx). No new visual components.

### 1.4 Stale comment cleanup

The mock data refactor invalidates two stale comments. Update them:

- [AINotConfiguredBanner.jsx:24](../../src/components/AI/AINotConfiguredBanner.jsx#L24) — replace "the UI is therefore showing mock data" with "the UI is therefore showing degraded results without AI enrichment".
- [LicenseBadge.jsx:115-118](../../src/components/LicenseBadge.jsx#L115) — replace the comment block with: "The backend's /api/v1/license reads LICENSE_KEY from env, not from the session, so this surfaces the real license even in demo mode (`MOCK_MODE`)."

### 1.5 Build honesty test

New file `tests/build-honesty.test.js`:

```js
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'

const FORBIDDEN_MARKERS = [
  'mockAnalysis',
  'mockQualityReport',
  'generateMockData',
  'Synthetic mock data',
  'nlp-chatbot-engine',           // string from mockRepos sample
  'web-assembly-video-editor',    // string from mockRepos sample
  'design-system-tokens',         // string from mockRepos sample
  'mockRepoList',
]

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) yield p
  }
}

describe('production build contains no mock data', () => {
  beforeAll(() => {
    execSync('npx vite build --mode production', { stdio: 'inherit' })
  }, 120_000)

  for (const marker of FORBIDDEN_MARKERS) {
    it(`dist/ must not contain "${marker}"`, () => {
      const offenders = []
      for (const file of walk('dist')) {
        const content = readFileSync(file, 'utf8')
        if (content.includes(marker)) offenders.push(file)
      }
      expect(offenders, `Found "${marker}" in: ${offenders.join(', ')}`).toEqual([])
    })
  }
})
```

This test is **opt-in slow** (runs the full Vite build), so it's tagged with a separate vitest project or excluded from default `npx vitest run` and only runs in CI. To keep it out of the default fast loop, the test file uses `describe.skipIf(!process.env.RUN_BUILD_TESTS)(...)` at the top OR is moved under `tests/build/` with a separate vitest config glob. CI workflow gains a step `RUN_BUILD_TESTS=1 npx vitest run tests/build/`.

### 1.6 Wave 1 callsite checklist (for the implementation plan)

Files modified:
- `src/hooks/useRepos.js` — remove `generateMockData`, replace with guarded import
- `src/hooks/useOrgs.js` — remove inline generators, replace with guarded import
- `src/hooks/useWorkBoard.js` — remove "Synthetic mock data" block, replace with guarded import
- `src/api/ai.js` — remove `mockAnalysis`, `mockQualityReport`, batch-index mock literal; replace with guarded import
- `src/components/AI/AINotConfiguredBanner.jsx` — comment update only
- `src/components/LicenseBadge.jsx` — comment update only

Files created:
- `src/__mocks__/mockRepos.js`
- `src/__mocks__/mockOrgs.js`
- `src/__mocks__/mockWorkBoard.js`
- `src/__mocks__/mockAI.js`
- `tests/build-honesty.test.js`

EmptyStates verified or added:
- `RepoList` — verify existing or add for "no repos, GH connected" + "GH not connected" branches
- `OrgPanel` — add "No organizations" EmptyState if absent
- `WorkBoard` daily chart — add "No activity" state when array is empty (after mock removal it will be empty zero-config)

---

## Wave 2 — Error message uniformity

### 2.1 `formatUserError(err, context?)` helper

New file `src/utils/errors.js`:

```js
const KNOWN_ERRORS = {
  // Network / auth
  'NETWORK_ERROR': {
    title: 'Could not reach the server',
    body: 'Check your connection and try again.',
    action: { label: 'Retry', kind: 'retry' },
  },
  'UNAUTHORIZED': {
    title: 'Session expired',
    body: 'Please sign in again to continue.',
    action: { label: 'Sign in', kind: 'reauth' },
  },
  // Quota
  'QUOTA_EXCEEDED': null, // routed through QuotaExceededState (Wave 3)
  // BYOK
  'AI_KEY_INVALID': {
    title: 'AI key rejected',
    body: 'Your API key was not accepted by the provider.',
    action: { label: 'Update key', kind: 'open-settings', settingsTab: 'ai' },
  },
  'AI_NOT_CONFIGURED': {
    title: 'AI is not configured',
    body: 'Configure a Gemini API key in Settings → AI to use this feature.',
    action: { label: 'Open Settings', kind: 'open-settings', settingsTab: 'ai' },
  },
  // Tier
  'TIER_REQUIRED_PRO': {
    title: 'Pro feature',
    body: 'This feature is part of the Pro plan.',
    action: { label: 'See plans', kind: 'open-pricing' },
  },
}

const FALLBACK = {
  title: 'Something went wrong',
  body: 'Please try again. If the problem persists, contact bruno@bolalabs.pt.',
  action: { label: 'Retry', kind: 'retry' },
}

export function formatUserError(err, context = {}) {
  if (!err) return FALLBACK
  // Backend convention: { error, code, ...details }
  const code = err.code || err.response?.data?.code || context.code
  if (code && KNOWN_ERRORS[code]) return { ...KNOWN_ERRORS[code], code, raw: null }
  // Network errors from fetch wrappers
  if (err.name === 'TypeError' && /fetch|network/i.test(err.message)) {
    return { ...KNOWN_ERRORS['NETWORK_ERROR'], code: 'NETWORK_ERROR', raw: null }
  }
  // 401 with no code
  if (err.status === 401 || err.response?.status === 401) {
    return { ...KNOWN_ERRORS['UNAUTHORIZED'], code: 'UNAUTHORIZED', raw: null }
  }
  // Unknown — log raw to console (dev only) but return fallback to user
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn('[formatUserError] unmapped error:', err)
  }
  return { ...FALLBACK, raw: null }
}
```

Key invariants:
- Returns plain object `{ title, body, action?, code?, raw: null }` — never returns a string.
- `raw` is always `null` in the returned object so that callers cannot accidentally `JSON.stringify` it into the UI.
- Stack traces never reach the return value; they only go to `console.warn` in dev.
- `action.kind` is one of: `'retry' | 'reauth' | 'open-settings' | 'open-pricing' | 'open-quota'` so callers don't hand-write onClick handlers.

### 2.2 Toast helper

Extend the existing toast utility (or wrap it) with `toast.errorFromException(err, ctx?)` that:
1. Calls `formatUserError(err, ctx)`.
2. Renders a toast with `title` as the heading, `body` as the description, and `action` as a button that dispatches the appropriate window event:
   - `retry` → calls a retry callback if provided in `ctx.onRetry`
   - `reauth` → `window.location.href = '/api/auth/github'`
   - `open-settings` → `window.dispatchEvent(new CustomEvent('app:open-settings', { detail: { tab: action.settingsTab } }))` (pattern already used by `AINotConfiguredBanner`)
   - `open-pricing` → `window.location.hash = '#pricing'`
   - `open-quota` → opens `<QuotaExceededState />` modal (Wave 3)

### 2.3 Sweep of existing callsites

Grep for `toast.error` and `setError` usages in `src/`. For each callsite:
- If the error is from a `try/catch` around an API call → replace with `toast.errorFromException(err, { onRetry: ... })`.
- If the error is a hardcoded string → leave alone (intentional, not raw exception).
- If the message uses `err.message` directly → mandatory replacement.
- If the message uses template strings with `err.message` → replacement, the prefix becomes part of `context.code` mapping.

The sweep is a list, not a deep refactor — each callsite is one or two lines. Estimated 12-20 callsites based on prior grep counts.

### 2.4 ESLint guardrail

Add to `.eslintrc.cjs` (or equivalent) a `no-restricted-syntax` rule that warns on `MemberExpression[object.name="err"][property.name="stack"]` in `src/components/`. This catches future regressions where someone tries to `console.log` a stack into the UI.

Rule entry:
```js
{
  selector: "MemberExpression[property.name='stack']",
  message: 'Do not surface .stack in UI. Use formatUserError(err) instead.'
}
```

The selector uses `property.name='stack'` (no object-name constraint) so it catches `err.stack`, `e.stack`, `error.stack`, and any other variable name. False positives in `src/utils/errors.js` itself (where reading the stack for dev console.warn might be legitimate) are silenced via `// eslint-disable-next-line` on that single line. The rule is scoped to `src/components/` only.

---

## Wave 3 — Cap-reached / quota CTA uniformity

### 3.1 Backend response enrichment

There is no generic rate-limit middleware. The codebase pattern is: each route in `server/routes/ai/*` calls `checkUsageLimit()` / `checkAIFeatureLimit()` directly from [server/lib/usage-meter.js](../../server/lib/usage-meter.js) and constructs its own 429 response inline. To enforce uniformity without rewriting every handler, this wave introduces a helper:

```js
// server/lib/usage-meter.js — appended export
export function quotaErrorPayload(check, { feature, upgradeTo, tier }) {
  const { start } = getCurrentPeriod()
  const resetAt = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 1).toISOString()
  return {
    error: 'Quota exceeded',
    code: 'QUOTA_EXCEEDED',
    feature,
    tier,
    limit: check.limit,
    used: check.current,
    resetAt,
    upgradeTo: upgradeTo ?? null,
  }
}

export function tierRequiredPayload(currentTier, requiredTier, feature) {
  return {
    error: 'Tier required',
    code: `TIER_REQUIRED_${requiredTier.toUpperCase()}`,
    feature,
    currentTier,
    requiredTier,
  }
}
```

Each existing 429 callsite is updated from:
```js
return res.status(429).json({ error: 'Quota exceeded' })
```
to:
```js
return res.status(429).json(quotaErrorPayload(check, { feature: 'ai_queries', upgradeTo: 'pro', tier }))
```

Each 403 tier-block callsite is updated to use `tierRequiredPayload()`. Rate-limit logic itself does not change — only the response payload shape grows. Existing tests continue to pass (they assert status code and `error` field; the new fields are additive). The shape required:

```json
{
  "error": "Quota exceeded",
  "code": "QUOTA_EXCEEDED",
  "feature": "ai_queries",
  "tier": "free",
  "limit": 100,
  "used": 100,
  "resetAt": "2026-05-01T00:00:00.000Z",
  "upgradeTo": "pro"
}
```

For tier-required 403:
```json
{
  "error": "Tier required",
  "code": "TIER_REQUIRED_PRO",
  "feature": "semantic_search",
  "currentTier": "free",
  "requiredTier": "pro"
}
```

Existing endpoints that already 429 just gain the extra fields — no breaking change. Frontend reads `code` to route through the right component.

### 3.2 `<QuotaExceededState />` component

New file `src/components/ui/QuotaExceededState.jsx`. Two variants:

- **Inline** (in-place card): used inside feature panels (e.g., AI Assistant when monthly cap is hit). Renders feature name, used/limit pills, reset date, primary CTA.
- **Modal**: opened via `app:show-quota-exceeded` event with the same props. Used for global handlers (e.g., a 429 hits while user is doing a bulk action — modal pops, user dismisses, returns to app).

Props:
```jsx
<QuotaExceededState
  feature="AI queries"
  currentTier="free"
  used={100}
  limit={100}
  resetAt="2026-05-01"
  upgradeTo="pro"        // optional — if absent, only "Wait" CTA
  onClose={fn}            // for modal variant
/>
```

CTA logic:
- `upgradeTo === 'pro'` → primary "Upgrade to Pro" button → `window.location.hash = '#pricing-pro'`
- `upgradeTo === 'enterprise'` → "Contact sales" button → `mailto:bruno@bolalabs.pt`
- `upgradeTo` absent → "Quota resets {resetAt}" text only, no upgrade CTA
- Always shows secondary "Configure your own AI key (BYOK)" link → opens Settings → AI

Visual: reuses `<EmptyState />` shape with a custom icon (Lucide `Gauge`) and `ds-card-shimmer` for premium feel. `ds-border-glow` on the upgrade CTA.

### 3.3 Sweep of 429/403 handlers

Grep `src/` for `status === 429`, `status === 403`, `'Tier required'`, `'Quota exceeded'`. For each:
- If response has `code === 'QUOTA_EXCEEDED'` → render `<QuotaExceededState />`
- If response has `code === 'TIER_REQUIRED_*'` → toast via `formatUserError` (which returns the `TIER_REQUIRED_PRO` mapping from Wave 2)
- Otherwise → toast via `formatUserError` fallback

Estimated 8-12 callsites.

### 3.4 BYOK invalid key handling

When a 401 with `code: 'AI_KEY_INVALID'` is received, the existing handlers either toast a generic error or silently fail. Replace all with `toast.errorFromException(err)` which routes to the `AI_KEY_INVALID` mapping → "Update key" button → opens Settings → AI → AI Configuration → BYOK section.

---

## Wave 4 — Verification

### 4.1 Zero-config e2e test

New file `e2e/zero-config-honesty.spec.js`. Runs against a Playwright fixture that:
1. Sets `VITE_MOCK_MODE=` empty (not `'true'`) and runs `npm run preview` (production build) on a test port.
2. Visits `/` without GitHub session cookie.
3. Asserts the landing page renders.
4. Signs in via the test OAuth fixture (or skips if not available — the test focuses on logged-out + logged-in-without-data states).
5. Once logged in with no real data, navigates to:
   - `/` (Dashboard)
   - `/repos`
   - `/orgs`
   - `/work-board`
   - `/ai-assistant`
6. On each page, asserts:
   - No element contains the strings `nlp-chatbot-engine`, `web-assembly-video-editor`, `design-system-tokens` (mock repo names)
   - No element contains a star count followed by random digits (regex `\d{2,3}\s*stars?` only matches if a real repo is rendered)
   - At least one `<EmptyState />` is visible (locator `[data-testid="empty-state"]` — adding the testid is part of this wave if missing)

The test is part of the regular Playwright suite, runs in CI, gates merges.

### 4.2 README/ROADMAP regression grep

Add to `tests/build-honesty.test.js` (or a sibling unit test) a check that `README.md` and `ROADMAP.md` do not mention features known to be vaporware:

```js
const FORBIDDEN_README_MARKERS = [
  'GitLab',
  'Bitbucket',
  'GitHub Enterprise Server',
  'Plugin system',
  'Mobile app',
  'SSO/SAML',
]
```

These should appear ONLY in the Roadmap page / `ROADMAP.md` (under "Later" section), never as advertised features in README. The test fails if any marker appears in `README.md` outside the explicit `## Roadmap` section.

### 4.3 Manual smoke pass before merge

Run the app with `VITE_MOCK_MODE=` empty against a fresh GitHub account with zero repos. Manually visit every primary surface and confirm:
- No fake data anywhere
- Every empty state has a clear next action
- Every error path (force a 429 by triggering AI 100x; force a 403 by trying a Pro feature on Free) renders the correct CTA
- Dark mode and mobile viewport (Playwright 390×844) render the EmptyStates and QuotaExceededState correctly

---

## Architecture — shared concerns

### Module placement

- Mock generators: `src/__mocks__/` (new, dev-only)
- Error helper: `src/utils/errors.js` (new)
- Quota component: `src/components/ui/QuotaExceededState.jsx` (new)
- Build honesty test: `tests/build-honesty.test.js` (new, opt-in slow)
- Zero-config e2e: `e2e/zero-config-honesty.spec.js` (new)

### Backwards compatibility

- The existing `MOCK_MODE` runtime flag continues to work in `vite dev`. No-op change for developers.
- Existing `toast.error(string)` calls continue to work; only `toast.error(err.message)` patterns are replaced.
- Existing 429/403 responses continue to work; backend payload only gains fields, never removes them.

### Failure modes

| Scenario | Handling |
|---|---|
| `vite build` fails during honesty test | Honesty test fails CI; fix the build first |
| Forbidden marker found in `dist/` | Test reports the file; fix the leak (usually a missed `import.meta.env.DEV` guard) |
| `formatUserError` receives an unmapped code in prod | Returns FALLBACK; logs nothing (DEV-only console.warn) |
| `QuotaExceededState` receives `upgradeTo` of unknown value | Renders without upgrade CTA, only reset-date text |
| Backend doesn't yet return enriched fields for an endpoint | Frontend falls through to FALLBACK toast — graceful degradation, not crash |
| Zero-config e2e times out due to OAuth fixture | Test logs and skips the logged-in section, still asserts logged-out state |

---

## Testing strategy

### Unit tests

- `tests/utils/errors.test.js` — `formatUserError` mapping for each known code, fallback path, network error detection, 401 detection, raw stack stripping.
- `tests/components/ui/QuotaExceededState.test.jsx` — three variants (free→pro upgrade, pro→enterprise upgrade, no upgrade with reset only), CTA click handlers fire the right window events.
- `tests/__mocks__/mockRepos.test.js` (and three siblings) — generators produce the expected shapes (regression guard: if someone changes a generator, tests catch it).
- Existing tests for `useRepos`, `useOrgs`, `useWorkBoard`, `api/ai.js` — update to set `import.meta.env.DEV = true` and `import.meta.env.VITE_MOCK_MODE = 'true'` in setup, otherwise mocks won't load.

### E2E tests

- `e2e/zero-config-honesty.spec.js` — described in Wave 4.1.

### Build test

- `tests/build-honesty.test.js` — opt-in slow, runs in CI via `RUN_BUILD_TESTS=1 npx vitest run tests/build/`.

### Suite green between waves

After each wave: `npx vitest run` (default fast suite) must pass. The build honesty test runs only when `RUN_BUILD_TESTS=1` to keep iteration fast.

---

## Shipping order

1. **Wave 1** — biggest structural change, opens the door for everything else.
2. **Wave 2** — independent of 1 in code, but reads better when mocks are gone (error paths are exercised more naturally without mock fallbacks).
3. **Wave 3** — depends on Wave 2's `formatUserError` for tier errors, but `<QuotaExceededState />` itself is independent.
4. **Wave 4** — verification gate before declaring done.

Each wave: commit (conventional, no Co-Authored-By, ≤72 char subject) + push to origin/main + suite run.

---

## Success metrics

- **Zero** `Math.random` outside `src/utils/api.js` (jitter), `src/__mocks__/`, and date math utilities.
- **Zero** strings from the mock repo template list in `dist/` after `npm run build` (verified by CI test).
- **Zero** `toast.error(err.message)` patterns in `src/components/`.
- **Zero** `err.stack` references in `src/components/` (ESLint rule enforces).
- **100%** of 429 responses include `code`, `feature`, `limit`, `resetAt`.
- **100%** of `<QuotaExceededState />` renders include either an upgrade CTA or a clear reset date.
- Zero-config first-run e2e passes against a clean GitHub account with no repos.
- README contains no advertised feature without code behind it (regression test passes).

---

## Open questions

1. **Where exactly does the rate-limit middleware live** on the backend? Plan-time investigation: grep `server/` for `429`, `checkUsageLimit`, `incrementUsage`. Likely `server/middleware/rate-limit.js` but to be confirmed.
2. **Is there an existing `data-testid` convention** on `<EmptyState />`? If not, add `data-testid="empty-state"` as part of Wave 1.
3. **Should the build honesty test live in the default vitest run** (slow but always-on) or be opt-in? Recommendation: opt-in via `RUN_BUILD_TESTS=1` to keep dev iteration fast; CI workflow runs both.
4. **Does the toast component support a body-with-action shape today** or do we need to extend it? To be confirmed in plan; if not, the action becomes a separate inline button rendered in the `description` slot.

These resolve during the implementation plan phase.
