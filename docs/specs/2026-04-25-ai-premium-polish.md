# AI Premium Polish — protections, banners, tests, validation

**Date:** 2026-04-25
**Owner:** Bruno
**Status:** approved — implementation in progress

## Goal

Close the loop on the AI premium UX work by:
1. Distinguishing **AI not configured** from **AI key invalid / unhealthy** with a dedicated banner.
2. Generalising the 503/401 noise-suppression already in place for `/ai/suggest` to other AI surfaces.
3. Surfacing the Work Board cap-reached state with the same premium banner system.
4. Covering the new components with unit tests.
5. Visually validating the Settings tabs in mobile and desktop viewports.
6. Shipping by committing per area to `main`.

## Non-goals

- Restructuring the AI provider abstraction.
- Adding new AI features (chat, suggest etc.).
- Migrating the cost-cap logic — only the read/display path.
- Changing how API keys are stored or encrypted.

## Architecture changes

### Backend — `GET /api/config/ai-status` extension

Add a `keyHealth` field with an async background probe.

```jsonc
// existing
{ "configured": true, "provider": "gemini" }

// new
{
  "configured": true,
  "provider": "gemini",
  "keyHealth": "ok" | "invalid" | "unreachable" | "unknown",
  "lastCheckedAt": "2026-04-25T20:33:00Z" | null
}
```

- The probe runs **once per process per cache window (5 min)**, in-memory only.
- Probe = a 1-token completion call. Failures map: 401/403 → `invalid`, network → `unreachable`, anything else → `unknown` (don't degrade UX on transient hiccups).
- The endpoint never blocks on the probe. First call returns `keyHealth: 'unknown'` and triggers the probe in the background. Next call within 5 min returns the cached result.
- Optional `?probe=1` query param forces a synchronous probe (used by the Test Connection button to "warm" the cache after key changes).

### Frontend — `useAIStatus` exposes `keyHealth`

`peekAIStatus`, `getAIStatus`, `useAIStatus` all forward the new fields. Subscribers re-render when the cached probe completes.

### New component — `AINotHealthyBanner`

Same visual language as `AINotConfiguredBanner` but **amber** instead of indigo. Title: *"AI key rejected"*. CTA opens Settings AI tab. Shown when `configured && keyHealth === 'invalid'`.

### New component — `WorkBoardCapReachedBanner`

Mirrors the AI banner contract but tonally amber+rose. Title: *"AI monthly cap reached"*. Shows current spend / cap. Renders at top of Work Board AI section when `useWorkBoardAI`'s status returns `reason: 'AI_COST_CAP_REACHED'`.

### Frontend — `aiFetch` helper

A thin wrapper around `fetch` that:
1. Calls `getAIStatus()` first.
2. If `!configured`, returns `{ ok: false, mock: true }` short-circuit (caller decides what to do).
3. If `keyHealth === 'invalid'`, throws a typed `AIInvalidKeyError`.
4. Otherwise delegates to fetch and translates status codes (401, 403, 429, 503) to typed errors.

Goal: stop the per-callsite `if (res.status === 503)` boilerplate in `src/api/ai.js`. Migrate the noisy soft-endpoints first (the chat endpoint that still throws on bad keys), keep behaviour for endpoints already handled.

## Components testing scope

| Component | Tests |
|---|---|
| `ModelCombobox` | render with options, free-typing, keyboard nav (↑/↓/Enter/Esc), filter, custom-id hint, no-options graceful degradation |
| `CurrentConfigSummary` | empty (no provider), with provider+key, "Persisted" badge with relative time, fallback warning |
| `WorkBoardSummary` | counts render, last-sync relative time, plan tier badge styling, AI on/off dot |
| `AINotConfiguredBanner` | renders, CTA dispatches `app:open-settings` event, dismissible state |
| `AINotHealthyBanner` | new — same contract |
| `PerFeatureOverrideSection` (rewrite) | combobox per feature, override badge appears, reset clears override, "N set" counter |

Target: ~25 tests. Mocks via `vi.fn()` for hooks and event dispatch.

## Visual validation

Playwright MCP at `localhost:5173`:

1. Desktop 1920×1080:
   - Settings → AI Configuration: confirm 2-col grid, summary rail sticky, no console errors.
   - Settings → Work Board: confirm grid + summary card.
2. Mobile 390×844:
   - Both tabs stack into single column.
   - Save bar sticks to bottom on AI Configuration.
3. Save screenshots to `.dev/screenshots/2026-04-25-*-1920x1080.png` and `*-390x844.png`.

## Shipping plan

Commits in this order, each independently green:

1. `fix(work-board): correct nested-button hydration in MigrationHistory`
2. `feat(orgs): personal-account aware OrgManagerModal`
3. `fix(ai): cached status pre-check + premium NotConfiguredBanner`
4. `fix(ai): normalise Gemini generationConfig (alias max_tokens, strip unknown)`
5. `feat(settings): AI Configuration premium editorial layout`
6. `feat(settings): model dropdowns + per-feature combobox + persistence indicators`
7. `feat(work-board): premium settings layout + status endpoint`
8. `feat(ai): keyHealth probe + AINotHealthyBanner`
9. `feat(work-board): cap-reached banner`
10. `test(ai): cover combobox, summaries, banners, per-feature section`

Push to `origin/main` only after:
- `npx vitest run` green.
- Visual validation screenshots saved.

## Risks

- **Async keyHealth probe**: a slow Gemini server could block the worker for the probe duration. Mitigation: probe with a short timeout (5s) and a 5-min cache.
- **Test-Connection-already-tests-the-key**: avoid double-billing for the probe. Mitigation: when `Test Connection` succeeds, also write to the cache so the probe is a no-op for the next 5 min.
- **Tests of `getByLabelText` colliding with sr-only text**: known pitfall — add `aria-hidden` to decorative text, never expose a duplicate "label-like" string.

## Out of scope (future work)

- Probe interval configuration in Settings.
- Per-feature key health (currently only checks completion provider).
- Telemetry on probe outcomes.
