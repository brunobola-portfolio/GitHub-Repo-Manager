# ADR: Two AI-client contracts (`aiApi` placeholders vs `aiFetch` typed throws)

**Status:** Accepted (documented 2026-06-06) — describes existing, intentional behaviour.
**Scope:** `src/api/ai.js` (`aiApi`) and `src/api/aiFetch.js` (`aiFetch` / `aiFetchJson`).

## Context

The frontend talks to AI endpoints through **two** client modules with
deliberately different failure contracts. This split is intentional but was
previously undocumented in-code, which made it look like accidental
duplication and tempted "let's unify them" refactors. This ADR records why
both exist and which one new code should use.

### `src/api/ai.js` — `aiApi`: honest **placeholder** contract (non-throwing)

When AI is **not configured** (cached `/config/ai-status` says so) or the
provider returns a runtime **503**, `aiApi` methods do **not** throw. They
return a structured *honest placeholder* with the real shape the UI expects,
but with every numeric/AI-derived field set to `null` and a canonical note,
plus flags the caller branches on:

| Situation | Returned flags | Note text |
| --------- | -------------- | --------- |
| AI not configured | `{ mock: true, aiConfigured: false }` | "Connect an AI provider in Settings…" |
| Provider 503 at runtime (user *is* configured) | `{ mock: true, aiConfigured: true, runtimeUnavailable: true }` | "AI provider is temporarily unavailable…" |

The point is **honesty without crashing**: never fabricate health scores or
recommendations, but never break the surrounding (non-AI) UI either. Consumers
render "Connect AI to see X" (`aiConfigured === false`) vs "try again"
(`runtimeUnavailable === true`) inline. Tier/quota errors (429/403) and a few
hard-required operations are the exceptions — they still throw (see below).

### `src/api/aiFetch.js` — `aiFetch` / `aiFetchJson`: **typed-throw** contract

`aiFetch` is a guarded `fetch` for AI endpoints. It **throws typed errors** and,
crucially, **pre-empts the network** when it already knows the call will fail:

- `AINotConfiguredError` — status says not configured; thrown *without* a request.
- `AIInvalidKeyError` — key health `invalid`, or a 401/403 response.
- `AIUnreachableError` — a 503 response.
- `AIQuotaExceededError` — a 429 with `code: QUOTA_EXCEEDED` (or the
  client-side **quota gate** below pre-empts it).

It also owns a process-wide **quota gate**: once any AI endpoint returns
`QUOTA_EXCEEDED`, subsequent `aiFetch` calls throw immediately for a short TTL
(`QUOTA_TTL_MS = 5min`, or the server's `resetAt` if sooner) **without hitting
the network** — so dashboards that fan out (e.g. several narratives in
parallel) don't spray `429`s into the devtools console. The gate state is
shared with the lower-level `utils/aiFetch` JSON client and surfaced to UI via
`subscribeAIQuotaState` / `getAIQuotaState`, and clears on any successful AI
response or explicit invalidate.

## Decision

**Keep both contracts. Do not unify them now.**

- Use **`aiApi` (placeholder)** for *ambient* AI surfaces where AI is optional
  enrichment of a screen that must still render without it — repo analysis
  cards, quality reports, batch index, semantic search. A stable
  `aiConfigured: false` shape lets many consuming components show a graceful
  inline "Connect AI" state without each wrapping a `try/catch`; throwing there
  would risk taking down the surrounding non-AI UI.
- Use **`aiFetch` / `aiFetchJson` (typed throw)** for *intentional*,
  user-triggered AI actions that have a dedicated error/empty surface — deep PR
  review, PR chat, PR slash commands, issue→plan. Typed errors + the shared
  quota gate let the caller branch precisely (not-configured vs invalid-key vs
  unreachable vs quota) and keep the console clean under fan-out.

### Guidance for new callers

Prefer **`aiFetch` / `aiFetchJson`** for any new, explicitly user-invoked AI
feature — typed errors compose cleanly with `try/catch` and the AI error
vocabulary, and you get the quota gate for free. Reach for `aiApi` only when
extending an existing placeholder-style surface, for consistency with its
siblings.

## Why not unify yet

Roughly nine `aiApi` consumers depend on the placeholder shape. Converting them
to the typed-throw model means giving each a real error/empty state and a
`try/catch` — a multi-PR migration with real UI surface area, not a mechanical
rename. The two contracts are a considered trade-off (graceful-degradation vs
explicit-failure), not accidental drift, so there is no correctness or honesty
debt forcing the change.

## Eventual unification (deferred)

When we do consolidate, the likely target is a single discriminated result
type both styles can share, e.g.:

```
{ status: 'ok' | 'unconfigured' | 'unavailable' | 'quota', data?, note?, quota? }
```

`aiFetch` would map its typed throws onto that union (or callers would adopt a
helper that catches typed errors and returns the union), and the `aiApi`
placeholder methods would return it directly — giving one shape with one set of
flags, removing the "does this method throw or return a placeholder?" ambiguity
while preserving graceful degradation. Tracked as a future cleanup; not
scheduled.

## References

- `src/api/ai.js` — `withAIConfigured`, the `unconfigured*` placeholder
  factories, per-method 503 branches.
- `src/api/aiFetch.js` — the typed error classes, `aiFetch`, the quota gate
  (`recordQuotaExceeded` / `getAIQuotaState` / `QUOTA_TTL_MS`).
- `src/api/aiStatus.js` — the cached `/config/ai-status` both modules consult.
