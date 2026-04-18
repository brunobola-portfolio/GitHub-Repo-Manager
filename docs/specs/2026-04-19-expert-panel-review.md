# Expert Panel Review — Feature Roadmap

**Date:** 2026-04-19
**Author:** Bruno Silva Marques (panel synthesis)
**Status:** Review — input for roadmap revision
**Scope:** Four-expert critique of [docs/specs/2026-04-19-feature-research-and-roadmap-gaps.md](./2026-04-19-feature-research-and-roadmap-gaps.md). Panel: Principal Engineer, Product Manager, Senior Security Engineer, AI/ML Engineer.

---

## TL;DR

The research spec's direction is validated by all four experts — the community pain signals are real and the competitive gaps are accurately read. But the panel unanimously reshapes **how**, **in what order**, and **at what cost** the plan should execute. Three convergent critiques land hardest:

1. **There is a hidden foundation the spec never names.** The Cross-Repo Work Board, Dependency Risk Dashboard, DORA Dashboard, and Technical Debt Tracker all depend on a **GitHub event ingestion pipeline** that doesn't exist today. Building one feature at a time means building it three times with incompatible schemas. Build it once, first, as Phase 0 infrastructure.

2. **The plan is systematically optimistic on effort, LLM cost, and model choice.** Several Tier 1 items are 2× their stated effort; 2.3 Pre-Merge Gate at Sonnet pricing breaks Pro unit economics; Gemini 2.5 Flash is the wrong model for every agentic feature in the plan.

3. **The product-security surface is bigger than the research surfaced.** The combination of MCP write-actions + existing `bulk.js` destructive operations (already shipping without dry-run or confirmation) is a present vulnerability, not a future risk. Prompt-injection guardrails are absent from every AI feature. Three security features are missing outright: SAST on agent-generated code, commit-signature verification in migration, and cryptographic agent-identity audit manifests.

The roadmap is not wrong. It needs a Phase 0, sharper model routing, harder security gates, and **three items killed or deferred**: Merge Queue (3.3), Semantic Cross-Repo Code Search (3.2 for 18+ months), and Agentic Execution mode (2.1L until 2.1 plan-only validates).

---

## Unanimous Verdicts (3+ experts agree)

### Kill 3.3 Merge Queue UI

**Who agreed:** Principal Engineer, Product Manager.
**Why:** GitHub ships merge queues natively and free. Mergify owns the power-user segment with a free tier. Graphite's $40/seat includes one. Engineering cost 6-10 weeks of orchestration complexity; addressable market that picks *our* queue over free alternatives is vanishingly small. Opportunity cost: the same weeks fund DORA + Dependency Risk Scoring combined.
**Action:** Remove from roadmap until 10 paying customers ask by name.

### Defer 3.2 Semantic Cross-Repo Code Search ≥18 months

**Who agreed:** Principal Engineer, Product Manager.
**Why:** The current `repo_embeddings` schema stores embeddings as JSON blobs; the schema comment literally reads *"for production with millions of rows, use a vector extension."* Building a chunking pipeline, switching to `sqlite-vec`/pgvector, indexing workers, and maintaining retrieval quality is a platform project competing with Sourcegraph's 15-year head start. Grep.app, GitHub native code search, and Sourcegraph's free tier cover the hobbyist and light-team use cases. The market gap does not close for 18+ months.
**Action:** Move to "watch, don't build." Revisit Q4 2027 at earliest.

### Defer 2.1L Agentic Execution until 2.1 plan-only validates

**Who agreed:** Principal Engineer, Product Manager, AI/ML Engineer.
**Why:** SWE-bench Verified leaderboard (April 2026) tops out at ~77-79% with frontier models and curated test cases; SWE-bench Pro drops to ~23%. Devin's self-selected merged-PR rate is 67%; analyst-unfiltered ~15-30%. Building agentic execution on Gemini is blocked by documented function-calling reliability issues under load. Done on Claude Sonnet 4.6 it adds ~$4.50/user/month in LLM cost alone — Enterprise-tier only. Ship plan generation first, measure how many users actually use it, then revisit.
**Action:** Phase 3+ consideration, gated on 2.1 plan adoption data and a Claude-based architectural commitment.

### 1.4 Dependency Risk Scoring: ship import-level, not call-graph reachability

**Who agreed:** Principal Engineer, Security Engineer.
**Why:** Socket.dev invested 3+ years in JavaScript call-graph reachability; Endor Labs built per-language engines. Reproducing either as an "M effort" is not realistic. The honest 80% solution is import-level reachability via Syft (SBOM) + Grype (vuln match) + Semgrep Supply Chain (import-presence check). Noise reduction of 40-60% vs. raw Dependabot, not the 90% reachability figure. Ship aggregation first (1-2 weeks), import-level reachability second (2-4 weeks), never promise call-graph reachability without that infrastructure.
**Action:** Reword the feature and its marketing copy. Partner or link out for true call-graph reachability.

### 2.3 Pre-Merge Quality Gate is NOT a 6-8 week feature without a call-graph layer

**Who agreed:** Principal Engineer, Security Engineer, AI/ML Engineer.
**Why:** The 82% vs 44% Greptile/CodeRabbit gap is driven by graph-based retrieval + multi-hop agent investigation + model quality, in that order. You cannot reproduce it with a diff-only prompt to Gemini Flash. Realistic paths: (a) build a tree-sitter-based function-level call graph + Claude Sonnet for the agent loop (L, ~8-12w); (b) integrate CodeRabbit or Greptile as a backend engine and wrap with our UI (S-M). Option (a) requires ~$10.50/user/month LLM cost if unfiltered — the hybrid (Flash pre-filter → Sonnet for flagged PRs) is not optional, it is the unit economics requirement. Plus: this is the AI feature with the largest **prompt injection attack surface** — non-negotiable guardrails described below.
**Action:** Pick (a) only with a Claude SDK commitment + hybrid routing; pick (b) if the team is under 3 people.

---

## Single-Expert Critical Flags (don't let these fall through)

### The GitHub Event Ingestion Pipeline is load-bearing (Principal Engineer)

Four roadmap features — 1.1 Work Board, 1.4 Dep Risk, 2.2 DORA, 2.4 Tech Debt — share a missing data foundation. None of the following exist today:

- PR review-request events (`review_requested`, `assigned`)
- CI-failure-by-assignee mapping
- Deployment events with environment metadata (staging vs prod)
- Commit-to-merge lead time pairs
- Issue lifecycle events (open → close, with assignee history)

The current `workflow_runs` table is the only ingestion we have, and it covers only Actions runs. Building 1.1 without this foundation means building a shallow version of the pipeline, then rebuilding it for 1.4, then again for 2.2. **Action: build the event ingestion layer as a shared Phase 0 primitive.** Required: GitHub scopes `notifications` + `security_events`, webhook subscriptions (`pull_request`, `issues`, `deployment_status`), ~4 new DB tables, background job infrastructure (BullMQ already exists, add a new queue).

### bulk.js is a PRESENT vulnerability, not a future risk (Security Engineer)

`POST /api/v1/bulk/delete`, `POST /api/v1/bulk/transfer`, `POST /api/v1/bulk/archive`, `POST /api/v1/bulk/visibility` already execute destructive operations:

- No dry-run mode
- No confirmation token
- No `repos.length` cap
- `sameSite: 'lax'` cookie — not strict enough for POST mutations
- `auditLog` fires on success only (not on intent)
- No rollback documentation surfaced in UI
- `archive`/`visibility` endpoints have no tier gate (Free users can bulk-archive)

A CSRF attack or session hijack on an active user today results in instant, irreversible repo deletion at org scale. **Action: ship 6 safeguards as a Phase 0 hotfix** (dry-run + confirmation token + repo-count cap + CSRF protection + intent-logged audit + rollback UX), *before* shipping 1.3 Bulk Actions UI that amplifies this surface.

### Pro tier is miscalibrated — DORA is Pro, not Enterprise (Product Manager)

The research spec suggests DORA Dashboard as Enterprise-only. Competitive pricing analysis puts LinearB at $20-40/seat, Swarmia with free-tier-for-small-teams, and DX/Jellyfish at enterprise. Gating DORA to Enterprise removes the self-serve upgrade path for the 5-15 person startup — the exact segment with budget and urgency. **Action: move DORA to Pro with a small-team free tier (≤5 devs free, 6+ = Pro).** Keep "cross-org portfolio + custom benchmarks" for Enterprise.

Additional tier reassignments:
- **MCP write-capable: reclaim for Pro.** Read MCP = Free (viral agent distribution); write MCP = Pro (valuable agent workflows). Spec gave both away too cheaply.
- **Saved views on Cross-Repo Work Board: hard Pro gate.** Base board Free, any saved or shared filter = Pro. Without this gate, no conversion pull.
- **Smart Notification Rules: in-app basic Free, Slack/webhook + custom logic Pro.** Spec had entire feature Pro-locked.

### The AI stack has three structural gaps (AI/ML Engineer)

1. **No evals.** Not one Tier 2 AI feature should ship without golden-dataset regression guards. Minimum: 50-100 historical bug-fix PRs for 2.3; 20-30 scored plans for 2.1; 30-50 queries with ground-truth matches for 3.2. A prompt or model change that drops a score by >5% blocks deploy. **Action:** build eval harness alongside Phase 1 features, not after.

2. **Provider abstraction is Gemini-specific.** `ai-service.js`, `handleAIError`, `streamGeminiToSSE`, six files of `.generateContent()` calls. Swapping to Claude for 2.3 or 2.1L today is a 2-week rewrite. The abstraction can be hardened in 1-2 days: `AIProvider` interface with `generate`/`embed`/`stream`, per-feature model env config, normalized `AIError` class. **Action:** do this refactor BEFORE any Tier 2 AI feature.

3. **Model routing must be per-feature, not platform-wide.** Gemini Flash for chat/README/plan-generation; Claude Sonnet 4.6 for 2.3 agent loop + 2.1L execution; Voyage-code-2 for 3.2 embeddings (outperforms Gemini on code MTEB by ~7 points). One model everywhere = both worse quality *and* worse unit economics.

### Three security features the research missed entirely (Security Engineer)

1. **SAST on AI-generated code before PR creation.** When 2.1L executes a plan, the agent writes code. That code can introduce vulnerabilities (AI-assisted code has statistically higher rates of copy-paste amplification, null-check misses, error-handling gaps per GitClear 2025). Snyk's Devin integration and Precogs.ai specifically market this: run Semgrep rules against the agent's worktree before opening the draft PR. **Action:** spec this into 2.1L from day one.

2. **Commit signature verification in migration pipeline.** `import-service.js` does `git clone --bare` + `push --mirror`. No GPG/SSH signature verification; no tamper detection; no unsigned-commit alerting. MITM between Azure DevOps source and our cloning server could inject commits silently. **Action:** add signature verification + post-migration signature audit report.

3. **Agent-identity audit manifest.** As we ship 2.1, 2.3, 3.1, no cryptographic mechanism attributes a commit, review, or bulk action to a specific authenticated agent session. Git author field is trivially spoofed. **Action:** design a signed audit manifest (hash chain anchored to session token) now, not after SOC 2 Type II auditors ask for it.

### The Enterprise story has three non-research blockers (Product Manager)

- **Billing self-serve.** Stripe not configured per `PricingPage.jsx`; Pro signups currently route to email-based sales. Conversion killer at 11 PM on a Friday. Fix before any of the tier-reassignments above matter.
- **SOC 2 Type II.** GitKraken advertises it; we don't mention it anywhere. For procurement at 200+ person companies this is a gate, not an enhancement. Starts a 9-12 month audit timeline — begin now.
- **Onboarding funnel.** Demo mode with 87 mock repos is clever; "demo → real account with real repos" has no bridge. No tour, no activation checklist, no "here's what to do first" moment. Activation is the multiplier on every acquisition bet in the roadmap.

---

## Contradictions & Tensions

The panel was broadly aligned. Two tensions worth flagging:

### Semantic Cross-Repo Search effort: L vs XL

AI/ML Engineer says embedding cost is "economically trivial" ($0.006 per full re-index of a 1000-file repo) and `sqlite-vec` scales to 100K chunks. Principal Engineer says it's XL (16-20w) because the cloning+chunking+indexing worker infrastructure doesn't exist. **Resolution:** both are right — the LLM cost is trivial, the *infrastructure* cost is high. Since PM also says defer 18+ months, the resolution is moot for now.

### 2.1 Agentic Execution model

AI/ML Engineer says Claude Sonnet 4.6 is correct for agentic loops (Gemini reliability issues). Research spec implies Gemini throughout. **Resolution:** adopt Claude for agentic features. This is a product decision that pulls in the "provider abstraction refactor" as a prerequisite. There is no viable path to Gemini-only agentic execution with 2026-quality outputs.

---

## Reshaped Roadmap

The original 14-item tiered plan becomes a 4-phase plan with explicit prerequisites. Total scope contracted — several items killed, several deferred — and 8 new items added (Phase 0 infrastructure + security hardening).

### Phase 0 — Prerequisites (before any Tier 1/2 feature)

- [ ] **GitHub event ingestion pipeline** — webhooks for PR, issue, deployment, review events; new DB tables; scope expansion (`notifications`, `security_events`). *Serves 1.1, 1.4, 2.2, 2.4.*
- [ ] **`bulk.js` safety hotfix** — dry-run, confirmation token, repo-count cap, CSRF, intent-audit, rollback UX. Ship before 1.3.
- [ ] **Provider abstraction refactor** — `AIProvider` interface, per-feature model env, normalized `AIError`. 1-2 days.
- [ ] **Eval harness** — golden datasets for PR review, plan generation, semantic retrieval; CI regression guard. Start with 2.3 dataset.
- [ ] **Billing self-serve (Stripe)** — unblock every tier-based conversion lever in the roadmap.
- [ ] **SOC 2 Type II audit prep** — begin now for Q2 2027 certification.

### Phase 1 — Adoption wins (Q3 2026)

- [ ] **1.2 Global Command Palette** — S-M (1-2w, not 3-5d). Repos first; issues/PRs via live GitHub search proxy with rate-limit handling. Free, with Pro power-actions hint.
- [ ] **1.1 Cross-Repo Work Board v1** — L (5-7w). Read-only aggregation. Free base, **Pro gate on saved views / shared team filters**. Builds on Phase 0 ingestion.
- [ ] **1.4 Dependency Risk Aggregation** — M (3-4w). Syft+Grype+Semgrep import-level reachability; cross-repo prioritized matrix. Pro.
- [ ] **3.1 MCP Host (read-only)** — S-M (2w). Official `@modelcontextprotocol/sdk`, OAuth 2.1 scoping, per-tool rate limits, audit log. Free.

### Phase 2 — Manager persona + AI depth (Q4 2026)

- [ ] **2.4 Technical Debt Tracker** — shares ~80% of 1.1 data layer; build as second view on same pipeline. Pro (per-repo) + Enterprise (org trends).
- [ ] **2.2 DORA Dashboard** — L (5-8w). Pro for ≤5-dev teams free / Pro for 6+. Enterprise adds cross-org + custom benchmarks.
- [ ] **2.1 AI Issue-to-PR Planner (plan-only)** — M (2-3w). Gemini Flash, BM25 file selection, SQLite chunking. Pro.
- [ ] **1.3 Bulk Actions UI — template-based only** — M (3-4w). File-update PRs from YAML templates. **No code execution, no secret rotation** (split into separate product areas). Pro. Requires Phase 0 bulk.js hotfix.

### Phase 3 — Agentic + expansion (Q1-Q2 2027)

- [ ] **2.3 Pre-Merge Quality Gate hybrid** — L (8-12w). Tree-sitter call graph + Flash pre-filter + Claude Sonnet for flagged PRs. **Prompt-injection guardrails mandatory** (input sandboxing, output validation layer, read-only review token). Pro (basic) + Enterprise (custom rules).
- [ ] **3.1 MCP Host (write actions)** — adds Tasks primitive, per-tool scoped auth, mandatory confirmation for destructive actions. Pro (write), not Free.
- [ ] **3.4 Smart Notification Rules** — M (3-4w). In-app basic Free, Slack/webhook + custom logic Pro.
- [ ] **Agent-identity audit manifest** — signed hash chain for all agent actions. Security foundation for anything in Phase 4.

### Phase 4 — Speculative (revisit after Phase 3 validates)

- [ ] **2.1L Agentic Execution** — only if 2.1 plan adoption data supports it. Claude Sonnet 4.6, isolated worktrees, branch-scoped ephemeral tokens, SAST on agent output before PR. Enterprise only.
- [ ] **Cross-org DORA portfolio** — Enterprise expansion of 2.2.
- [ ] **3.2 Semantic Cross-Repo Code Search** — only if a customer will pay ≥$500/mo for it. Otherwise keep linking out to Sourcegraph/Grep.app.

### Killed (not on roadmap)

- **3.3 Merge Queue UI** — GitHub native + Mergify free tier make this non-addressable for a small team.
- **Custom static analysis engine for 2.3** — integrate or use tree-sitter, don't build per-language parsers in-house.
- **Call-graph reachability for 1.4** — partner / link out. Never promise what Socket/Endor spent years building.

---

## What the Original Spec Got Right

All four experts explicitly validated the following decisions:

- **The research findings themselves.** Community pain signals (62% tech debt frustration, cross-repo dashboard need, multi-repo bulk gap) are real and accurately cited.
- **The competitive gap map.** Graphite, CodeRabbit, Sourcegraph, Linear, Mergify positioning is correct.
- **Staged rollout of 2.1** (plan-only before agentic execution) is exactly right given SWE-bench Pro numbers.
- **Reusing existing PR review infrastructure for 2.3** — the file tree, diff viewer, and thread system are real leverage points.
- **MCP host as a strategic bet** — timing is ideal. Nov 2025 spec is stable, JS SDK mature, agent-runtime adoption locked in for 2026.
- **SQLite as the starting vector store** (with `sqlite-vec` extension) — pragmatic, scales to 100K chunks, no premature pgvector migration.
- **`sanitizeForPrompt` utility** — good prompt-injection hygiene; keep and extend.
- **Not building full autonomous overnight agents for the Pro tier** — honest about real-world success rates.

---

## Key Decisions to Confirm Before Phase 0 Starts

These are the binary choices the panel could not make for you:

1. **Commit to Claude Sonnet for agentic features.** Without this, 2.3 and 2.1L are blocked on a model reliability problem. Requires budget for multi-provider LLM spend and provider-abstraction refactor.
2. **Gate 1.3 behind Phase 0 `bulk.js` hotfix.** The alternative is to accept the present vulnerability and ship the UI anyway. This is a security call, not an engineering one.
3. **SOC 2 audit commitment.** Start now (12-month timeline) or defer Enterprise revenue expectations by a year.
4. **Model plurality as a product principle** — explicitly, publicly "we pick the best model per feature." This is both a marketing story (honesty beats "Gemini everywhere") and an architectural commitment.

---

## Sources

Each expert cited real benchmarks and references. Full transcripts are available in the session logs. Headline references:

- SWE-bench Verified and Pro leaderboards (April 2026): http://www.swebench.com/
- Greptile v3 benchmarks and architecture: https://www.greptile.com/benchmarks
- Devin 2025 performance review (67% self-selected merged-PR rate): https://cognition.ai/blog/devin-annual-performance-review-2025
- Anthropic Claude API pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Voyage AI code embedding comparisons: https://docs.voyageai.com/docs/pricing
- MCP 2025-11-25 spec + JS SDK: https://modelcontextprotocol.io/specification/2025-11-25
- GitHub blog on secure remote MCP servers (Nov 2025)
- OWASP LLM Top 10 — LLM01:2025 prompt injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Semgrep reachability methods comparison: https://semgrep.dev/blog/2024/sca-reachability-analysis-methods/
- `sqlite-vec` vector extension: https://github.com/asg017/sqlite-vec
- LinearB, Swarmia pricing (for DORA tier benchmarking)
- GitKraken Launchpad (for Work Board benchmarking)
- Snyk Devin integration (SAST on agent output pattern)
