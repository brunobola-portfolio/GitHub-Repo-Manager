# Repo Advisor — Premium AI Assistant Initiative

**Date:** 2026-06-21
**Status:** Design — pending review
**Area:** AI Assistant (frontend `src/components/AIAssistant.jsx`, backend `server/ai-service.js` + `server/lib/ai-provider.js` + `server/routes/ai/*`)
**Type:** Master spec for a 3-phase initiative (each phase gets its own implementation plan)

## Problem

The in-app AI assistant is held back on three fronts, surfaced by a real
incident: a user (the owner) migrating `BolaLabs/AITOOL` hit a Git LFS error
mid-migration and asked the assistant *"how do I migrate this?"* — it could not
help. Investigating that exposed the wider picture:

1. **It presents as "Gemini" but is already multi-provider.** The panel header
   literally reads **"Gemini Assistant"** ([AIAssistant.jsx:331](../../src/components/AIAssistant.jsx#L331))
   and ~30 user-facing strings hardcode "Gemini", yet the backend has a full
   provider registry (Gemini, Anthropic, OpenAI, OpenRouter, local) plus
   per-user BYOK ([server/lib/ai-provider.js](../../server/lib/ai-provider.js)).
   The server-wide default ignores `AI_PROVIDER` and forces Gemini
   ([ai-service.js:71](../../server/ai-service.js#L71)), so the product both
   under-delivers and mis-brands what it already does.
2. **It cannot answer operational questions.** It dispatches actions (open
   wizard, create repo) but has no grounding in the product's own docs or an
   error/troubleshooting knowledge base — so it failed the LFS user.
3. **"Premium / protected" has real gaps.** Tier gating, quotas, rate limits,
   CSRF, Zod validation, prompt sanitization and encrypted BYOK are all in
   place, but: an inline **cost cap exists only for Work Board AI**
   ([work-board-ai-gate.js](../../server/middleware/work-board-ai-gate.js) +
   `work-board-ai-cost.js`, scoped to the `work_board_ai_spend` table) and is
   **not generalized** to the main assistant or other AI features; there is
   **no per-call token/size cap**; and **no audit log** of AI calls. Adding
   tool-use on top of these gaps would be actively unsafe (see Security model).

## Goals

- Rename the assistant to **Repo Advisor** — a provider-neutral, premium,
  house-style name (matches *Migration Wizard*, *Work Board*).
- Make the backend genuinely provider-neutral (honor `AI_PROVIDER` server-wide).
- Make Repo Advisor **answer-first and genuinely useful** — able to explain
  errors like the LFS one, grounded in product docs + an error KB, with
  citations.
- Make it **context-aware** of the current screen / active job / last error.
- Harden it to **premium/enterprise grade**: cost caps enforced, per-call token
  caps, audit log, and the security guardrails that tool-use *requires*.
- Elevate the **UX** to best-in-class (streaming, citations, accessible,
  ethical upsell).
- Stand up **evals** so "excellent" is measurable and regressions are caught.

## Non-goals

- Renaming internal identifiers — DB column `ai_assistant_enabled`, app-events
  (`appEvents.js`), the `grm-ai-assistant-messages` storage key. These carry
  schema-migration risk with no user-facing value (YAGNI). Only user-facing
  strings and the primary component file are renamed.
- Building a trained model-router (RouteLLM-style). At this scale a declarative
  per-feature model map is sufficient and avoids added latency.
- Replacing the existing tier/quota system — we extend it, not rebuild it.

## Naming decision

**Repo Advisor.** Functional descriptor (owner-selected direction), provider-
neutral, premium, consistent with existing feature names. Display: "Repo
Advisor" in the panel header, FAB label, Settings, Command Palette. Welcome and
error copy reference the *active provider* by name where relevant, never a
hardcoded "Gemini".

---

## Phase 1 — Identity & Neutrality

*Small, high-impact, low-risk. Delivers the rename and the real "not just
Gemini" win.*

### 1A. Rename to "Repo Advisor" (user-facing)
- Panel header `"Gemini Assistant"` → `"Repo Advisor"` ([AIAssistant.jsx:331](../../src/components/AIAssistant.jsx#L331)).
- FAB label, aria-labels, welcome message, input placeholder, Command Palette
  group, Settings toggle, Pricing/Landing copy (~50 strings in `src/`).
- Rename component file `AIAssistant.jsx` → `RepoAdvisor.jsx` (+ `AIAssistantPasteCard.jsx` → `RepoAdvisorPasteCard.jsx`); update imports.
- Update tests asserting the old strings; update `README.md` + `docs/` to
  describe Repo Advisor and the multi-provider positioning.

### 1B. Provider-neutral strings
- Replace hardcoded "Gemini" in errors/guidance with the **active provider's
  display name** (reuse the label map at [ai-error-format.js:21](../../server/lib/ai-error-format.js#L21))
  or a neutral *"the AI provider"*. E.g. *"Something went wrong talking to
  {provider}"*, *"{Provider} is under heavy load"*.
- Not-configured copy: neutral guidance that links to the provider picker
  rather than naming Gemini.

### 1C. Honor `AI_PROVIDER` server-wide
- [server/lib/ai-provider.js](../../server/lib/ai-provider.js) `createProvider()`
  reads `AI_PROVIDER` but only implements the `gemini` branch and throws
  *"Supported providers: gemini"* otherwise. Route it through the existing
  `PROVIDER_REGISTRY` (the same one `createProviderForUser()` already uses for
  all five providers), lazily loading the provider module and reading
  `<PROVIDER>_API_KEY` / `<PROVIDER>_MODEL`.
- [server/config.js](../../server/config.js) gains a provider-neutral key set
  (keep `GEMINI_*` working for back-compat).
- **Validation:** `AI_PROVIDER=anthropic` (with a key) boots and serves chat
  end-to-end; existing Gemini default unchanged.

### Phase 1 scope boundary
Internal identifiers unchanged (see Non-goals). This phase ships independently
and is the natural first PR.

---

## Phase 2 — Capability & Usefulness (secure by construction)

*The heart of "excellent". Answer-first per Anthropic guidance — no jump to a
broad agent. Security guardrails ship **with** the new capability, not after.*

### 2A. Error / troubleshooting knowledge base
- Authored KB where **one error = one chunk**, indexed by the **verbatim error
  string** + an `error_code` metadata field.
- **Hybrid retrieval** (BM25 + dense vectors, RRF): keyword recall catches exact
  product strings like `unknown unit: "m"` that embeddings blur; vectors catch
  paraphrases. Apply **contextual retrieval** (prepend a short context blurb per
  chunk before embedding/indexing).
- **Seed entry: the Git LFS migration error** (`GIT_LFS_MISSING` /
  `LFS_MIGRATE_FAILED` / `OVERSIZED_FILES`) → cause + fix, drawn from the work
  already done this session.

### 2B. `explain_error` / `search_help` retrieval tool
- A retrieval tool grounded in product docs + the error KB. Strict prompt:
  *answer only from retrieved context; if insufficient, say so and offer a path
  forward (retry / docs / contact)* — no confident filler.
- **Clickable citations** that deep-link to the exact doc/section.
- Keeps Repo Advisor an **answer-first** system; the existing action-dispatch
  (ACT) path is used only when the user wants to *do* something.

### 2C. Context-awareness
- Inject a small, tagged live-state core — `<current_screen>`, `<active_job>`,
  `<recent_error>`, selected repo — as lightweight references; the assistant
  tool-fetches details just-in-time (Anthropic "right altitude" / just-in-time
  context).
- When opened from a failed migration, **auto-seed** the conversation with the
  last error so the user can immediately ask "how do I fix this?".

### 2D. Security guardrails (prerequisite for 2B/2C — see Security model)
- **Authorization in the tool layer, never the LLM** (OWASP LLM06). Each tool
  checks the calling user's permission; the model only *requests*.
- **Human-in-the-loop for state-changing actions**; reads run without prompts
  (avoids approval fatigue).
- **Break the lethal trifecta**: the assistant reads untrusted repo/issue/PR
  text — eliminate the exfiltration leg (no arbitrary outbound calls; neutralize
  attacker-controlled markdown links/auto-fetched images in output).
- **Tenant isolation**: derive identity from the session, enforce `user_id`
  filters at the data/retrieval layer (also closes the known repos-sync
  cross-tenant concern). Treat all ingested repo content as untrusted.

---

## Phase 3 — Premium & Protected

*Polish, hardening, and measurement. UX excellence + closing the HIGH-risk cost
gaps + auditability + evals.*

### 3A. Premium UX
Adopt **Vercel AI Elements** (shadcn/Tailwind/Radix — fits React 19 + Tailwind
v4) for AI-aware render blocks. Specifics:
- Streaming with distinct blocks (message / reasoning / tool-call / sources);
  **Stop / Regenerate / Edit-and-resubmit**; **no auto-scroll** (anchor at
  message top); buffer incomplete code fences.
- **Citations** with meaningful labels (PR/file/commit title, not "Source");
  **"I don't know"** as a first-class response; a persistent verify-before-
  destructive disclaimer near the input; neutral, non-anthropomorphic phrasing.
- **Visible tool-call step trail** ("listed branches → read protection rules"),
  auto-open while running, auto-collapse on done — not narrated chain-of-thought.
- **Accessibility**: `role="log"` + `aria-live="polite"` announcing finished
  messages; focus into panel on open, return on close (no focus trap for the
  docked panel); Cmd/Ctrl+Enter send, Shift+Enter newline, Esc close; verify the
  typing caret inherits the global `MotionConfig reducedMotion="user"`.
- **States**: capability-led empty state with broad clickable suggested prompts;
  not-configured screen with CTA + "what you'll unlock"; teach-don't-blame error
  states (retry → escalate); **quota warning before the wall** with reset date;
  continuous in-context usage display.
- **Ethical upsell**: value-framed (never loss-framed), equal-weight decline,
  fire once at a natural moment, respect dismissal — zero dark patterns.
- **Mobile**: modal bottom sheet, scrim, drag-to-dismiss, ≥24px targets, real
  keyboard avoidance.

### 3B. Cost & abuse hardening (closes HIGH-risk gaps — OWASP LLM10)
- **Per-call token cap** (input + output): reject oversized inputs pre-flight.
- **Generalize the existing Work Board cost-cap to the whole AI surface.** A
  per-feature spend cap is already enforced inline for Work Board AI
  ([work-board-ai-gate.js](../../server/middleware/work-board-ai-gate.js) +
  `work-board-ai-cost.js`); extend that proven pattern to the main assistant,
  deep-review and migration AI so every provider call is gated by remaining
  budget *before* it is made — especially important on BYOK where a bug bills
  the user.
- **Anomaly detection**: daily budget + rolling-average spike alerts on top of
  monthly quotas.

### 3C. Audit log (enables enterprise tier)
- Immutable, append-only record of prompt + retrieval context + tool
  invocations & arguments + response + any approval, tagged `user_id`/`feature`.
- **PII redacted by default; BYOK secrets never logged** (OWASP Secrets / LLM07).
- Doubles as the exfiltration tripwire (logging tool calls catches most attacks
  even when injection evades detection).

### 3D. Evals & observability (measure "excellent")
- Extend the existing `server/evals/` harness: implement the deferred `--real`
  mode running a small `real`-tagged golden set through `createProvider()`,
  scored by existing scorers + a new **LLM-as-judge** scorer (binary pass/fail +
  written critique; swap order to neutralize position bias; use a different
  model family as judge; calibrate to a human-labeled set, report Cohen's κ).
- **Golden set seeded from real questions**, starting with the LFS case; ~100-
  example CI regression set that grows on every production failure.
- Score answers on the **RAG triad** (context relevance, groundedness, answer
  relevance); eval **tool-selection accuracy** separately from answer quality.
- **CI gate**: mock evals on every PR; `real` subset on schedule / when prompts
  or routing change; fail on baseline regression. Standardize telemetry on OTel
  GenAI attribute names (`gen_ai.provider.name`, `gen_ai.request.model`,
  `gen_ai.usage.*`); version prompts via the existing prompt registry.

---

## Security model (cross-cutting)

The dominant risk is **adding tool-use/data-access to an assistant that reads
untrusted content** (repo READMEs, issues, PRs). Mapped to OWASP LLM Top 10 2025:

| Risk | Control | Phase |
|---|---|---|
| LLM01 Prompt injection (incl. indirect) | Treat ingested content as untrusted; segregate/label; defense-in-depth (detection is not reliable) | 2D |
| LLM02 Sensitive info disclosure | Scope retrieval to calling user; tenant `user_id` filter at data layer | 2D |
| LLM05 Improper output handling | Validate model output against schema before any tool/DB/render; never execute raw | 2D |
| LLM06 Excessive agency | Authz in tools not LLM; human-in-the-loop on writes; least-privilege; user-context execution | 2D |
| LLM07 System-prompt leakage | No secrets/keys/authz logic in prompts | 2A/2D |
| LLM10 Unbounded consumption | Per-call token cap; inline spend cap; anomaly detection | 3B |
| Lethal trifecta | Remove the exfiltration leg (no arbitrary outbound; neutralize attacker-controlled links/images) | 2D |

**Already aligned (keep):** session auth, Zod validation, structured-output
schemas, CSRF on mutations, per-tier rate limits, monthly quotas, encrypted-at-
rest BYOK. Note: input sanitization is truncation-only — that is *acceptable*
(input filtering is not a reliable injection defense); invest in the
architectural controls above instead.

## Success criteria

- Repo Advisor answers the seed LFS question correctly, with a working citation.
- `AI_PROVIDER=anthropic` serves the assistant end-to-end with no "Gemini" in
  any user-facing string.
- No state-changing action executes without explicit confirmation; reads do not
  prompt.
- Spend cap and per-call token cap reject over-budget/oversized calls before the
  provider is hit; audit log records every AI call (PII-redacted, no secrets).
- Eval suite green in CI; the golden set grows from real failures.

## Rollout

One PR per phase (Phase 2's security guardrails ship in the same PR as its
capability, never split). Each phase gets its own implementation plan via the
writing-plans flow. Suggested order: **1 → 2 → 3**, with 3B/3C (cost + audit
hardening) pull-forward-able if enterprise demand precedes the UX polish.

## References (primary sources)

- Anthropic — *Building Effective Agents*; *Writing tools for agents*;
  *Contextual Retrieval*; *Effective context engineering*; *Demystifying evals
  for AI agents*; *Claude's Character*.
- OWASP — *Top 10 for LLM Applications 2025* (LLM01/02/05/06/07/10); *Secrets
  Management* & *Cryptographic Storage* cheat sheets.
- Simon Willison — *The Lethal Trifecta* (2025). NIST AI 100-2e2025.
- NN/g — *AI chatbot design guidelines*; *Explainable AI*; *Response-time
  limits*; *Empty-state design*. Google PAIR — *Errors + Graceful Failure*.
  Microsoft — *Defend against indirect prompt injection*; HAX Toolkit.
- LiteLLM Router; OpenRouter routing; OpenTelemetry GenAI semconv; Langfuse
  token/cost tracking. Hamel Husain — *Evals* / *LLM-as-judge*; Eugene Yan —
  *LLM evaluators*. Vercel AI Elements/SDK.

## Self-review notes

- Scope: large but explicitly decomposed into 3 independently-shippable phases;
  each gets its own plan. ✓
- No placeholders/TBD. ✓
- Consistency: security guardrails (2D) are stated as prerequisites for 2B/2C and
  cross-referenced in the Security model. ✓
- Ambiguity: rename scope made explicit (user-facing + primary component file
  only; internal identifiers out of scope). ✓
