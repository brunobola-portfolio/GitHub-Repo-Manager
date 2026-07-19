# AI Deep Review

A premium PR review experience that turns the in-app PR view into a tool
developers actively choose over github.com — generating a structured
walkthrough, line-level review comments with one-click code suggestions,
PR-context slash commands, and a streaming Q&A chat — then publishing the
whole thing back to GitHub as one batched review.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../images/ai-deep-review.svg">
  <img alt="AI Deep Review: a pull request feeds four surfaces — Walkthrough, Comments with suggestion blocks, Commands (/describe, /test_plan, /improve), and a streaming Chat — which are published as one batched GitHub review through the outbox with an idempotency key" src="../images/ai-deep-review.svg" width="900">
</picture>

Open any PR inside the app, click **Generate AI Review**, and within
seconds you get a four-tab panel covering the entire conversation a
reviewer would normally write by hand.

---

## Free vs Premium

| Capability | Free | Pro |
| --- | --- | --- |
| Walkthrough (summary + per-file table + Mermaid sequence diagram) | ✓ | ✓ |
| Line comments with `suggestion` blocks | ✓ | ✓ |
| Edit / dismiss individual comments before publishing | ✓ | ✓ |
| Publish as single batched GitHub review | ✓ | ✓ |
| Built-in prompt presets (General / Security / Performance / Accessibility / Refactor) | read-only | read-only |
| **Custom Prompt Studio presets** (user / repo / org scope) | — | ✓ |
| `${REPO_STYLE_GUIDE}` token + path-scoped rules + severity floor | — | ✓ |
| **PR Slash Commands** — `/describe`, `/test_plan`, `/improve` | — | ✓ |
| **PR Chat** — streaming Q&A with persisted history | — | ✓ |
| Org-shared prompts (read for org members, edit for author) | — | ✓ |

Free is the full review-and-publish loop with the built-in `general`
preset; Pro adds the prompt customisation, the slash commands, and the
chat tab. Tier gates are enforced server-side by `requireTier('pro')` —
documented per-route in [`docs/api/API.md`](../api/API.md#ai-deep-review-apiaideep-review).

---

## The four tabs

`AIReviewPanel` is the sticky right-rail panel inside the PR view. Once a
draft exists, the panel exposes four tabs.

### 1. Walkthrough

A markdown summary of *what* changed and *why it matters*, rendered through
`SafeMarkdown` (`react-markdown` + `rehype-sanitize`) so untrusted model
output cannot inject HTML.

```
┌─ Walkthrough ─────────────────────────────────────────────┐
│ ## Summary                                                │
│ This PR migrates the auth middleware from session cookies │
│ to short-lived JWTs. The token rotation logic is split    │
│ into its own helper to keep the test surface manageable.  │
│                                                           │
│ ## Files changed                                          │
│ | File | Δ | Notes |                                      │
│ | --- | --- | --- |                                       │
│ | server/middleware/auth.js | +124/-87 | Replaces ... |   │
│ | server/lib/jwt.js (new)   | +212     | RS256 signing |  │
│                                                           │
│ ## Sequence                                               │
│ ```mermaid                                                │
│ sequenceDiagram                                           │
│   client ->> auth: POST /login                            │
│   auth ->> jwt: sign({sub, exp})                          │
│ ```                                                       │
└───────────────────────────────────────────────────────────┘
```

The Mermaid diagram is rendered live; a theme observer keeps it in sync
with light / dark mode without re-fetching.

### 2. Comments

Up to 25 line comments (industry-standard cap to avoid GitHub secondary
rate limits). Each comment shows the file, line range, severity, body
text, and — when present — a `suggestion` block that renders as an inline
diff.

For every comment you can:

- **Edit** the body or the suggestion in-place (PATCH
  `/api/ai/deep-review/:draftId/comments/:idx`)
- **Dismiss** to remove it from the draft entirely
- Re-apply it after editing — nothing is sent to GitHub until you click
  **Publish**

### 3. Commands (Pro)

Three PR-context slash commands invokable from inside the panel.

| Command | What it produces | Apply path |
| --- | --- | --- |
| `/describe` | A drafted PR description (or a polished version of the existing one) | "Apply to PR" PATCHes the PR body via the outbox, idempotency keyed on the body hash so a double-click never produces a double-write |
| `/test_plan` | Up to 15 test cases (unit / integration / e2e) with priority + clear steps | Copy-paste into your test files; the `/test_plan` result is persisted so you can come back to it |
| `/improve` | Up to 20 code-quality suggestions with optional replacement code | Suggestions are inert in this tab; for committable diffs use the **Comments** tab |

Per-user rate limit: **20 generations per hour**. Each command result is
cached and returns instantly until you regenerate.

### 4. Chat (Pro)

A streaming Q&A surface anchored to the same PR. Ask "why did the timeout
move from 30s to 60s?" or "what's the blast radius if `auth.js` regresses?"
and get a streamed answer over Server-Sent Events.

- **History persists** per `(user, PR)` in `ai_pr_chat_messages`. Open the
  PR a week later and the conversation is still there.
- **Old turns collapse** at `MAX_HISTORY_TURNS = 10` so the prompt stays
  cheap; older turns are summarised into a single context message.
- **Defence in depth** — every PR-derived string (title, body, comments,
  diff snippets) passes through `sanitizeForPrompt` before reaching the
  model, so a malicious PR description cannot pivot the bot into running
  unintended actions.
- **Cancellable** — an `AbortController` is wired to unmount, new sends,
  and an explicit Cancel button.

> **Scope note.** This slice ships the *no-tools* version of the chat —
> the assistant answers from the system prompt + persisted history only.
> Server-side tool execution (`read_pr_file`, `list_pr_comments`) is
> deferred to a future slice; the table columns are forward-compatible.

---

## Prompt Studio (Pro)

`/ai/prompts` is the top-level page where Pro users curate the presets
that drive AI Deep Review.

### Built-in presets

Five battle-tested system prompts ship out of the box and are read-only on
every tier:

| Key | Persona | Severity floor |
| --- | --- | --- |
| `general` | Balanced senior reviewer (default) | none |
| `security` | OWASP-aware security reviewer | medium |
| `performance` | Latency / allocation hotspot detector | low |
| `accessibility` | WCAG 2.1 AA reviewer | low |
| `refactor` | Long-term maintainability reviewer | none |

### Custom presets

Pro users can create custom presets at three scopes:

- **`user`** — visible only to you, across all repos.
- **`repo`** — pinned to a single `owner/repo`; visible to anyone who can
  generate a review for that repo.
- **`org`** — visible to every member of the org. Author has full edit
  rights; other org members read-only (resolved via the cached
  `getCurrentUserOrgs` / `isOrgMember` helpers, 5-minute TTL).

Defaults stack: explicit `?presetKey=` → repo default → user default →
**org default** → built-in `general`.

### Path-scoped rules + severity floor

Inside a preset you can declare path globs that activate extra
instructions only when changed files match. Combined with a severity
floor (`low` / `medium` / `high`), this lets a single preset enforce
"comment on every accessibility issue in `src/components/**`, but only
high-severity issues elsewhere".

### `${REPO_STYLE_GUIDE}` token

If a preset references the literal string `${REPO_STYLE_GUIDE}` in its
system prompt, the resolver inlines the contents of
`.repomanager/review-rules.md` from the target repo at generation time.
Add a style guide to the repo, point your preset at the token once, and
every review automatically picks up the latest rules without re-editing
the preset.

---

## Publishing to GitHub

Click **Publish** in the panel. The server:

1. Builds a single payload for `POST /repos/{o}/{r}/pulls/{n}/reviews`
   with the walkthrough as `body` and the surviving line comments as
   `comments[]`.
2. Sends it through the existing outbox helper with idempotency key
   `pr-deep-review:{draftId}:{event}`. A double-click — even across
   server restarts or worker retries — collapses into a single GitHub
   review row.
3. On 5xx or network failure, the call queues in the outbox and returns
   `202 { queued: true, outboxId }`. The draft stays in `draft` status
   until the worker actually delivers.

Every published review carries a footer:

```
> 🤖 Generated by GitHub Repo Manager
> Cost: $0.04 (gemini-2.5-flash) — head: a1b2c3d
```

A roadmap slice ([GitHub App identity](../setup/github-app.md)) will swap
the authoring identity from the OAuth user to a `[bot]` account; the
publish payload itself does not change.

---

## BYOK provider support

Every AI Deep Review feature works through the user's own provider key
configured in **Settings → AI Configuration**. `usageMetadata` flows back
through every adapter so cost is recorded with each draft.

| Provider | Walkthrough + Comments | Slash Commands | Chat | Notes |
| --- | --- | --- | --- | --- |
| Google Gemini | ✓ | ✓ | ✓ | Free-tier quota usable; `gemini-2.5-flash` is the default |
| Anthropic | ✓ | ✓ | ✓ | `claude-sonnet-4-5` recommended for highest signal |
| OpenAI | ✓ | ✓ | ✓ | `gpt-4o` and `o4-mini` both supported |
| OpenRouter | ✓ | ✓ | ✓ | Pricing prefix-normalised — `anthropic/claude-*` resolves to real Anthropic pricing |
| LM Studio / local | ✓ | ✓ | ✓ | Cost reported as `$0.00`; quality depends on local model |

---

## Cost transparency

Every draft persists `cost_usd` and `model_used` in `ai_pr_reviews` (and
`ai_pr_command_results` / `ai_pr_chat_messages` for the other tabs).

- The footer on the published review carries the per-review cost.
- The same numbers feed the **AI Activity** card visible in
  Settings → AI Configuration.
- `computeCostUSD` is a single helper used by every adapter, fed from the
  provider's `usageMetadata` — no per-feature cost guessing.

---

## Mock mode

`VITE_MOCK_MODE=true` (the default `npm run dev:all` setup) makes every AI
Deep Review feature work without a real API key:

- **Walkthrough + comments** return a canned fixture covering all the UI
  states (suggestion blocks, severity badges, mermaid diagram).
- **Slash commands** return per-command canned outputs.
- **Chat** simulates streaming via setTimeout-chunked SSE so the typing
  animation looks realistic.
- **Publish to GitHub** is honest — the response is clearly marked as a
  mock and **no fake `githubReviewId` is fabricated**. The `<DemoModeBanner>`
  is visible across the app whenever mock mode is on.

This makes screenshots and PR demos easy without burning provider quota.

---

## Privacy & data handling

- **What's sent to the model** — PR title, body, file manifest, and the
  unified diff (capped to 100 files via the GitHub `pulls/files` endpoint).
  Nothing else: not your other repos, not your session token, not your
  past reviews.
- **What's stored locally** — the generated draft, line comments, cost,
  model name, and head SHA in SQLite. Provider keys are encrypted at rest
  with **AES-256-GCM** and PBKDF2-HMAC-SHA256 key derivation.
- **What's logged** — structured request metadata (`feature`, `userId`,
  `prKey`, status code) at log level `warn` or below. Never the prompt,
  never the response body.
- **Rate limits** — generate is 10 req/min/user; PR commands are
  20 req/hour/user; chat is 30 messages/hour/user. All in-memory with an
  LRU sweep; Redis-backed rate limits are on the platform-hardening
  roadmap.

For implementation depth see the
[AI Deep Review spec](../specs/2026-05-03-ai-deep-review.md) and
[slice 1a plan](../plans/2026-05-03-ai-deep-review-slice-1a.md) /
[slice 1b plan](../plans/2026-05-04-ai-deep-review-slice-1b.md).
