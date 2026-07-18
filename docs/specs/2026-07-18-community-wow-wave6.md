# Wave 6 — Community WOW: Build Spec

Status: draft, ready for planning
Owner: bruno@bolalabs.pt
Source: `.dev/prod-premium/2026-07-18/r1-readme-studio.md`, `r2-agent-rules.md`, `r3-diagrams.md`, `r4-security-posture.md`; `docs/plans/2026-07-17-production-premium-plan.md` (Wave 6)

## Goal & guardrails

Ship four community-launch "WOW" features — README Studio, AI Diagram Generator, Agent Rules Generator, Security Posture Panel — plus a dogfooding pass that refreshes this repo's own README using README Studio. Every AI call goes through the existing `guardedGenerate` spend-cap/metering/audit wrapper. Every feature is:

- **Free-first**: generous per-feature Free-tier monthly caps (matching the 2026-07-18 rebalance philosophy — e.g. `readmeGenPerMonth: 25`, `deepReviewPerMonth: 10`), Pro/Enterprise `Infinity`.
- **Grounded**: AI generation reads real repo signals (README/manifest/tree/contents/LICENSE) via `repo-context-builder.js` or an equivalent detector; the prompt carries the house "never invent — say so or leave a placeholder" rule already proven in `community-health-fix.js`.
- **Deterministic-first where possible**: any check that can be computed with regex/string-match/API-field-read (README score dimensions, security checks) runs with **zero AI cost** and is not gated behind quota.
- **Never auto-writes**: every generator shows a preview (diff or full content) and requires an explicit user action (Commit / Open PR / Apply) before touching the repo. No silent writes, ever.
- **No new infrastructure, no new OAuth scopes, no new dependencies.** Everything below composes existing modules (`guardedGenerate`, `repo-context-builder`, `commitOrOpenPR`, `quality-metrics`, the Mermaid render pipeline, `ds-risk-*` tokens, `SectionPanel`/`EmptyState`/motion vocabulary).

Cut from scope per research verdicts (do not build in this wave):
- License *badge auto-fix* beyond warning — no auto-rewriting shields.io URLs into unrelated files.
- ER/schema diagrams (no schema-detection exists).
- Monorepo nested-path AGENTS.md targeting; auto-syncing `.cursorrules` / `copilot-instructions.md`.
- Workflow-YAML content parsing (unpinned actions, dangerous triggers); per-member org 2FA audit (needs `admin:org` scope this app doesn't request); any auto-remediation/write action from the Security Posture panel.
- PNG/raster diagram export (SVG-only in v1); sequence/flow diagram types (v1.1 fast-follow, structure the endpoint to allow it but ship architecture-only).

---

## Feature 1 — README Studio

**User story**: As a repo owner, I want to see an instant, free quality score for my README (with concrete gaps), and optionally have AI improve it — grounded in my actual code, license, and stack, never inventing features — so I can trust the result before committing it.

### UI surface

- New entry point: **`src/components/AI/ReadmeStudioModal.jsx`** (new), opened from a "README Studio" action button placed in `src/components/RepoDetail/OverviewTab.jsx` (near the existing README-reader surface shipped in Wave 3) and, if there is an existing quality/health surface, cross-linked from `CommunityHealthDashboard.jsx`.
- Layout: `SectionPanel`-based two-stage modal —
  1. **Score stage** (loads instantly, free, no quota check): overall 0–100 score reusing `quality-metrics.js`'s Documentation/Community/Engineering/Polish breakdown, plus the new dimensions (§below) rendered as a prioritized recommendations list (`high`/`medium`/`low`), each with a one-line "why" — same shape as `generateQualityReport()` already returns. Use `EmptyState` if there's no README at all (README-missing is itself the top recommendation).
  2. **Improve stage** (gated behind AI quota): a config panel (tone, sections, license, stack override, badges, scope — see Configurability) → "Generate" → diff/preview pane (before/after, or full markdown for full-rewrite mode) → explicit "Apply" (commit) or "Open PR" button, reusing the existing commit-or-PR affordance pattern.
- Motion: standard modal enter/exit + `STAGGER`/`fadeRise` for the recommendations list, per `src/components/ui/motion.js` vocabulary — no bespoke transitions.
- Confidence banner: if `repo-context-builder`'s `confidence` is `medium`/`low`, show a visible pre-generation warning banner, not just a post-hoc note (per honesty constraint below).

### Backend

**New pure module**: `server/lib/ai-features/license-detect.js`
- `detectLicense(licenseFileContent) -> { spdxId: string, confidence: 'high'|'medium', matched: true } | { spdxId: null, matched: false }`
- Fingerprints the `LICENSE` file's content against the 5 templates in `server/lib/ai-features/license-templates/*.txt` (same `SUPPORTED_LICENSES` list already exported by `community-health-fix.js`) via normalized (whitespace-collapsed, `{{year}}`/`{{owner}}`-stripped) substring/similarity match; falls back to scanning the first ~10 lines for an `SPDX-License-Identifier:` header. No AI call — zero cost.

**Extend** `server/lib/ai-features/quality-metrics.js` with new deterministic dimensions (all zero-AI-cost, computed in `detectPatterns`/`calculateQualityMetrics`):
- License section correctness (NEW) — compare README's stated license against `detectLicense()`'s result on the actual `LICENSE` file.
- Badge/reality consistency (NEW) — license badge text vs. detected license; CI badge referencing a workflow file that actually exists (cross-check against the file-tree/contents listing already fetched).
- Install-instructions-match-detected-stack (NEW) — compare README's install command shape against manifest/lockfile signals from `repo-context-builder`.
- Screenshots/visuals presence (NEW) — regex for non-badge image markdown or a `docs/images/`-style directory.
- Section-order sanity (NEW) — loose standard-readme ordering check.
- Reuse existing `hasInstallation`/`hasUsage`/`hasExamples`/`hasContributing`/`hasLicense`/`hasAPI`/`hasBadges`/`hasTableOfContents` as-is. Compose with `community-health-service.js`'s file-presence checks for LICENSE/CONTRIBUTING/CODE_OF_CONDUCT/SECURITY rather than re-detecting them.

**New route** `GET /api/repos/:owner/:repo/readme-studio/score` (`server/routes/ai/core.js` or a sibling `readme-studio.js` route file) — `requireAuth` only, **no `requireAI`, no quota check** (pure/free, mirrors the doc's recommendation). Calls `generateQualityReport()` extended above; fetches README + LICENSE + top-level contents via the existing tolerant-404 pattern already used by `quality-report`.

**Consolidate** `POST /ai/readme` + `POST /ai/readme/enhance` into one grounded endpoint: `POST /ai/readme-studio/improve` (`server/routes/ai/core.js`), `requireAuth, requireScope('ai'), validateBody(aiReadmeStudioImproveSchema), requireAI`. Body: `{ mode: 'missing-sections' | 'full-rewrite', tone, sections, license, stackOverride, badges, scope }`. Server:
1. Calls `repo-context-builder.buildContext()` with README + manifest + entrypoints + folder structure + topics/language + `LICENSE` as a `customFiles` entry.
2. Runs `detectLicense()` on the LICENSE content; if the user's chosen `license` config differs from the detected one, this becomes a warning surfaced in the response (not silently overridden).
3. Builds the prompt carrying the "never invent commands/features/endpoints/badges not evidenced in the fetched signals" rule (verbatim in spirit to `community-health-fix.js`'s system prompt).
4. Routes through `guardedGenerate` with `feature: 'readme_studio'`.
5. Returns `{ markdown, confidence, warnings: [...], diff? }` — no write.

Keep the old `/ai/readme` and `/ai/readme/enhance` routes as thin deprecated aliases forwarding to the new endpoint with `mode` inferred (avoid breaking any existing test/e2e that targets them), or remove + update call sites — implementer's call, documented either way in the PR.

**Apply/commit**: reuse the existing README write path (whatever `SettingsTab`/community-health already uses to commit a file) — do not build a second commit mechanism. If none exists generically, reuse `commitOrOpenPR()` from `community-health-fix.js` (it's already generic over `filePath`/`content`/`commitMessage`/`mode`).

**Validators** (`server/lib/validators.js`): new `aiReadmeStudioImproveSchema` (zod) replacing/extending `aiReadmeSchema`/`aiReadmeEnhanceSchema`.

### Metering

- Reuse `readmeGenPerMonth` (already exists, `Free: 25`) for the improve call — `checkAIFeatureLimit(userId, 'ai_readme')` / `incrementAIUsage(userId, 'ai_readme')`, unchanged metric key so existing quota consumption carries over.
- Score endpoint: **no metering** (free, deterministic).

### Configurability

Tone (`professional` default / `concise` / `enthusiastic`) · sections include/exclude (seeded from standard-readme optional sections + detected `missingSections`) · license dropdown (`SUPPORTED_LICENSES`, defaulted to detected, mismatch warning) · stack override (read-only detected value + escape hatch) · badges on/off + which set (deterministic shields.io URL generation, no AI) · scope (`missing-sections-only` vs `full-rewrite`).

### Honesty constraints

- Score is 100% deterministic — never influenced by an LLM call, never blocked by quota.
- Improve prompt must carry the "never invent" rule; low/medium `confidence` is shown to the user **before** they spend a quota unit, not just after.
- If `detectLicense()` finds no match against `SUPPORTED_LICENSES` (custom/unrecognized license), the flow must label it "custom/unrecognized license — verify manually" and skip auto-generating a license badge/summary for that dimension rather than guessing.
- Diff/preview is mandatory before Apply; no auto-commit path exists anywhere in this feature.

### Edge cases

- No README at all → score stage shows 0/100 with "no README found" as the top recommendation; improve stage defaults to `full-rewrite` mode.
- No LICENSE file → license dimension shows "not found," improve flow's license dropdown has no detected default, badges toggle for license disabled until user picks one explicitly.
- Monorepo/polyglot repo where manifest detection picks the wrong stack → stack override escape hatch.
- README present but binary/huge (fetch failure or truncation) → score stage degrades gracefully (partial score, note truncation), improve stage shows a low-confidence warning.

---

## Feature 2 — AI Diagram Generator

**User story**: As a repo owner, I want to generate an architecture diagram of my repo from AI, see it render in-app, and export it as SVG for my README/docs, understanding it's an AI approximation and not a verified dependency graph.

### UI surface

- New component **`src/components/AI/DiagramGenerator.jsx`** (new), structurally adapted from `src/components/PRReview/AIDeepReview/WalkthroughTab.jsx`'s render `useEffect` (lazy `import('mermaid')`, `securityLevel: 'strict'`, theme-reactive, `parseAndSanitizeSvg`).
- Entry point: action button in `RepoDetail`'s Overview tab (`OverviewTab.jsx`), opening a modal/panel via `SectionPanel`.
- Config: `diagramType` selector (v1: `architecture` only, UI structured to add `sequence`/`flow` later without rework) + optional `focus` free-text field (e.g. "focus on the auth flow").
- Result: rendered SVG in a `SectionPanel`, with an explicit, persistent UI label — **"AI-generated approximation, not a verified static-analysis graph"** — plus "Copy Mermaid," "Copy SVG," "Download SVG," and "Regenerate" actions.
- Error state: inline text error (matches `WalkthroughTab`'s existing pattern), not a thrown/uncaught error; "Regenerate" button for manual retry after the one automatic self-repair attempt (see below).

### Backend

**New route** `POST /api/ai/generate-diagram` (new file `server/routes/ai/diagrams.js`, mounted alongside the other `ai/*` route files). Stack: `requireAuth, requireScope('ai'), validateBody(aiGenerateDiagramSchema), requireAI`.
- Input: `{ repo: { full_name }, diagramType: 'architecture', focus?: string }`.
- Context: top-level `contents` + capped `tree` (reuse `server/routes/repos/tree.js`'s existing endpoint internally, or call the same GitHub API path directly) + `repo.language` + README snippet — same sources `POST /ai/quality-report` already fetches.
- Prompt constrains the model to emit **only Mermaid text** (fenced or raw, matching whatever contract `walkthrough.mermaid` already uses — check `deep-review.js`/`shared.js` and mirror it exactly, do not invent a new fence convention).
- No server-side Mermaid syntax validation (v11's `mermaid.parse()` is DOM-dependent — client is the source of truth per research). Server does defensively strip code fences/stray prose via the existing `raw.replace(...)` idiom used elsewhere in `dev-toolkit.js`.
- Support `?stream=true` via the existing `initSSE`/`streamToSSEWithUsage`/`denyIfSpendCapReached` trio for parity with other generators.
- **Retry-once self-repair**: on a client-reported render failure (new lightweight callback, e.g. a follow-up `POST` with `{ failedSource, parseError }` or a `retry: true` flag on the same endpoint), the server re-prompts with the failed Mermaid + parser error appended, asking for corrected Mermaid only. This second call is a real spend event — check `denyIfSpendCapReached` again — but must not double-decrement the user-facing `diagramGenPerMonth` counter for what is one logical request (check-once, increment-once design per research §4a).
- `parseAndSanitizeSvg()` returning `null` (client-side sanitization failure) must **never** trigger the retry path — that's a distinct client defense, not a model mistake.

**Validators**: `aiGenerateDiagramSchema` in `server/lib/validators.js`.

### Metering

- `server/lib/usage-meter.js` `METRIC_TO_FEATURE`: add `ai_diagram: 'diagramGenPerMonth'`; add `ai_diagram: 'AI Diagrams'` to the quota-exceeded label map (~L259 area, alongside `'Repo Insights'`).
- `server/lib/feature-flags.js` `TIER_FEATURES.free`: add `diagramGenPerMonth: 15` (between `deepReviewPerMonth: 10` and `readmeGenPerMonth: 25` — heavier context payload than a commit message, lighter than a full deep review). Pro/Enterprise: `Infinity`.
- `checkAIFeatureLimit(userId, 'ai_diagram')` → generate → `incrementAIUsage(userId, 'ai_diagram')` → `auditLog(req, 'ai.generate_diagram', 'ai', null, { repo, diagramType })`.

### Configurability

`diagramType` (v1: `architecture`; enum structured for future `sequence`/`flow`) · optional `focus` free-text hint.

### Honesty constraints

- Persistent UI label: AI approximation, not a verified static-analysis dependency graph (this repo's active vaporware/honesty discipline requires this — do not let copy imply real dependency analysis).
- No auto-commit of the diagram into the repo in v1 — export only (copy/download). If a future slice wants "commit diagram to docs/," that's a new decision, not implied by this spec.

### Edge cases

- Empty/near-empty repo (no meaningful file tree) → generation should still succeed with a minimal diagram or a clear "not enough structure to diagram" message rather than a hallucinated graph.
- Mermaid render fails twice (original + one retry) → inline error + manual "Regenerate" (fully new, normally metered attempt), no auto-loop.
- Very large repo (tree `truncated: true`) → note in the UI that the diagram is based on a partial/truncated file listing.

---

## Feature 3 — Agent Rules Generator (AGENTS.md / CLAUDE.md)

**User story**: As a repo owner, I want to generate (or refresh) an AGENTS.md — and optionally a CLAUDE.md — grounded in my repo's real build/test/lint/CI signals, so AI coding agents working in my repo get accurate instructions instead of guessing.

### UI surface

- Primary entry: new card in the existing Community Health surface — `src/components/CommunityHealthDashboard.jsx` (detection card, "missing"/"present" pill like LICENSE/CONTRIBUTING/etc., using the tree endpoint's existing root-file listing) and a corresponding action in `src/components/AI/CommunityHealthFixModal.jsx` (or a new sibling `AgentRulesModal.jsx` following the exact same modal shape) for the generate/preview/commit flow.
- Secondary entry: a "Generate agent rules" button in `src/components/RepoDetail/OverviewTab.jsx` or `SettingsTab.jsx`, for users who land on a single repo without browsing Community Health first.
- Config panel (target file(s), mode, section toggles, strictness, commit-vs-PR) inside the modal, before "Generate" — local to the action, not a global settings flag.
- **Preview-before-commit is mandatory**: generated Markdown always renders in a diff/preview pane first (refresh mode literally requires a diff to be useful), with explicit "Commit" / "Open PR" buttons.

### Backend

**New module** `server/lib/ai-features/agent-rules.js`, mirroring `readme-enhance.js`/`community-health-fix.js`'s pure/impure split:
- `detectRepoSignals({ owner, repo, token, githubApi })` — pure detection (no AI call, unit-testable without a provider mock): wraps the existing recursive tree endpoint (`server/routes/repos/tree.js`, `git/trees?recursive=1`, capped at 500 blobs) + targeted content fetches for `package.json` scripts/lockfile family, test/lint configs, `.github/workflows/*.yml` job names, top-level directory layout, `LICENSE`/SPDX id, `.env.example`/`docker-compose*`/migration-folder presence, and any existing `AGENTS.md`/`CLAUDE.md`/`.cursorrules`/`copilot-instructions.md` (for refresh-vs-create mode). Per-file content capped via `sanitizeForPrompt(content, N)` mirroring `readme-enhance.js`'s truncation pattern.
- `buildAgentRulesPrompt(signals, options)` — pure, returns `{ prompt, sections }`, assembled from the deterministic H2-skeleton (Setup commands / Code style / Testing instructions / Dev environment tips / PR instructions / optional Security constraints) using the same `PROMPT_TEMPLATES` token-substitution + `sanitizeForPrompt`/`clean()` pattern as `community-health-fix.js`. In refresh mode, feeds the existing file content back in and asks for only-changed-sections output (same contract shape as `buildReadmeEnhancePrompt()`'s missing-sections output).
- `generateAgentRules(ctx, signals, options)` — calls the provider through `guardedGenerate`, `feature: 'agent_rules'`.

**New routes** (extend `server/routes/repos/actions-community.js`, next to the existing `/community-health/*` routes):
- `POST /:owner/:repo/agent-rules/generate` — `requireAuth, requireScope('ai'), validateBody(agentRulesGenerateSchema), requireAI` → returns preview only, **no write**.
- `POST /:owner/:repo/agent-rules/commit` — `requireAuth, validateBody(agentRulesCommitSchema)` → calls `commitOrOpenPR()` from `community-health-fix.js` **verbatim** (already generic over `filePath`/`content`/`commitMessage`/`mode`, including its branch-protection-probe → PR fallback) — zero changes needed to accept an `AGENTS.md`/`CLAUDE.md` target.

**Validators**: `agentRulesGenerateSchema`, `agentRulesCommitSchema` in `server/lib/validators.js`.

**AGENTS.md ↔ CLAUDE.md relationship**: default output is AGENTS.md as canonical. If the user opts into "AGENTS.md + CLAUDE.md," `CLAUDE.md` is generated as a **Windows-safe `@AGENTS.md` import line** (Claude Code's native recursive `@path` import) plus a short Claude-Code-specific addendum — **never a symlink** (this app runs on Windows; symlinks require admin/Developer Mode and can't be guaranteed in the target repo's clone environment either).

### Metering

- `server/lib/feature-flags.js` `TIER_FEATURES.free`: add `agentRulesPerMonth: 20` (comparable order of magnitude to `readmeGenPerMonth`, single-shot generation over a bounded signal set). Pro/Enterprise: `Infinity`.
- `server/lib/usage-meter.js` `METRIC_TO_FEATURE`: add `ai_agent_rules: 'agentRulesPerMonth'`; add label `ai_agent_rules: 'Agent Rules'`.
- `checkAIFeatureLimit(userId, 'ai_agent_rules')` → generate → `incrementAIUsage(userId, 'ai_agent_rules')` → `auditLog(req, 'ai.generate_agent_rules', ...)`. Commit-only calls (no generate) are not separately metered — only the AI generation step burns quota.

### Configurability

Target file(s) (`AGENTS.md` only default / `AGENTS.md`+`CLAUDE.md` / `CLAUDE.md` only) · mode (`create`/`refresh`, diff-aware) · section toggles (Setup commands · Code style · Testing instructions · Dev environment tips · PR instructions · Security constraints · Repo layout map) · strictness/tone (`concise` default <150 lines / `detailed`) · commit mode (`direct` / `PR`, reusing `commitOrOpenPR`'s existing fallback). Language: default English regardless of UI locale (consistent with the existing anti-PT guard), no locale knob in v1.

### Honesty constraints

- Never fabricate a build/test/lint command that wasn't detected — if a signal is missing (e.g. no test runner detected), the generated section should say so explicitly ("no test command detected — add one here") rather than inventing `npm test`.
- Refresh mode must never silently clobber hand-edited content — feed existing content back into the prompt, request only-changed-sections, and always show the diff before commit.
- No commit without explicit user action — `generate` and `commit` are two separate, user-gated calls.

### Edge cases

- Monorepo (multiple manifests at different paths) → v1 detects only root-level signals and generates a root AGENTS.md; note in the preview if multiple manifests were found ("this looks like a monorepo — nested AGENTS.md not yet supported").
- Repo with an existing hand-written AGENTS.md that doesn't match the generated skeleton shape → refresh mode's diff should show real textual diff, not a destructive full replace.
- Branch protection blocks direct commit → falls through to `commitOrOpenPR`'s existing PR-fallback UX (`mode: 'pr-fallback'`), surfaced to the user exactly as the community-health flow already does.

---

## Feature 4 — Security Posture Panel

**User story**: As a repo admin, I want a single report card of my repo's security configuration (branch protection, secret scanning, Dependabot, workflow permissions, SECURITY.md, org 2FA) with clear pass/fail/unknown states and one AI-written summary of top actions, without the panel ever guessing on checks I don't have admin access to see.

### UI surface

- **Extend `src/components/security/SecurityScanModal.jsx` in place** — do not add an 8th RepoDetail tab (mirrors the existing modal-as-report pattern used by `CommunityHealthDashboard`, and the admin-gate logic `BranchProtectionPanel.jsx` already solved is reused, not re-derived). Keep the `security-scan-modal` testid stable.
- Rename modal title "Security & Secrets Scan" → "Security Posture."
- New layout, top to bottom: `[ Score header (N/10 checks passing) ] → [ 10 deterministic check rows ] → [ AI summary footer, progressive-enhancement ] → [ existing 3 alert-source sections, collapsed by default ]`.
- Each check row: label, `ds-risk-*`-tokened status pill (pass / fail / **unknown — requires admin access** / not-applicable), one-line "why it matters," and a fix-path link where one already exists (branch protection → `BranchProtectionPanel`; SECURITY.md → existing generator). No new fix actions invented.
- Migrate `SecurityScanModal`'s current hardcoded `SeverityBadge` Tailwind colors onto `ds-risk-*` tokens (`src/design-system.css` L180–345, `src/utils/riskTokens.js`) as part of this work — stop carrying a second, inconsistent severity palette.
- AI summary footer: collapsed/loading independently of the deterministic checks; if `guardedGenerate` fails or the user is over quota, shows a quiet "AI summary unavailable" state — **the report card must render fully and correctly regardless.**

### Backend

**Extend** `server/routes/v1/repos-security.js` (already Free-tier, already has the alerts fetch) to aggregate all 10 checks:

| # | Check | Source | Severity if failing |
|---|---|---|---|
| 1 | Default branch requires PR review | `fetchBranchProtection` (existing) | critical |
| 2 | Default branch disallows force-push/deletion | `fetchBranchProtection` (existing) | high |
| 3 | Zero open critical/high alerts | existing alerts summary | critical/high |
| 4 | Secret scanning enabled | `security_and_analysis.secret_scanning.status` (**new fetch**, `GET /repos/{owner}/{repo}`) | high (public) / informational (private, no GHAS) |
| 5 | Secret scanning push protection enabled | `security_and_analysis.secret_scanning_push_protection.status` (**new fetch**) | medium |
| 6 | Dependabot security updates enabled | `security_and_analysis.dependabot_security_updates.status` (**new fetch**) | medium |
| 7 | Code scanning configured | existing `codeScanning.available`, reinterpreted | medium |
| 8 | SECURITY.md present | `community-health-service.checkCommunityFiles()` (reuse, don't refetch) | medium |
| 9 | Default Actions workflow token permissions not read/write | `GET /repos/{owner}/{repo}/actions/permissions/workflow` (**new fetch**, admin-gated) | medium |
| 10 | Org requires 2FA (org repos only) | `GET /orgs/{org}` → `two_factor_requirement_enabled` (**new fetch**, best-effort) | low/informational |

- Every admin-gated check (4, 5, 6, 9, 10) must render **"unknown — requires admin access"** as a distinct state from "fail" (403 → unknown, exactly like `BranchProtectionPanel`'s `permissionDenied` chip) — never misinform non-admin collaborators.
- GHAS-unavailable nuance: on a private repo without GitHub Advanced Security, `secret_scanning.status` reads `"disabled"` even though the owner can't enable it without upgrading — render as **informational/neutral**, not the same red "fail" a public repo owner forgetting to flip the toggle gets.
- Top-line score: same "N/10 checks passing" or 0–100 weighted shape as `community-health-service.calculateHealthScore()`, so the two report cards feel like one family.

**New AI block** — single `guardedGenerate` call, `feature: 'security_posture'`, same shape as `attention-narrative`/`translate-search` in `ai/core.js`: whitelisted, `sanitizeForPrompt`-cleaned payload of **only the 10 check results** (never raw alert bodies — could contain secrets/PII) + repo name/visibility. Output schema `{ summary: string, topActions: [{ title, why, severity }] }` (2–3 items), capped output tokens. Cache keyed on a hash of the check results (mirror `attention-narrative`'s `readCachedNarrative`/`writeCachedNarrative` pattern) so re-opening the panel without a posture change doesn't burn another AI call.

**Validators**: extend/add schema for the posture-scan response shape in `server/lib/validators.js` if response validation is used elsewhere in this codebase's pattern.

### Metering

- `server/lib/feature-flags.js` `TIER_FEATURES.free`: add `securityPostureAIPerMonth: 75` (comparable single-shot summarization call, same order of magnitude as `repoInsightsPerMonth: 75`). Pro/Enterprise: `Infinity`.
- `server/lib/usage-meter.js` `METRIC_TO_FEATURE`: add `ai_security_posture: 'securityPostureAIPerMonth'`; label `ai_security_posture: 'Security Posture'`.
- The 10 deterministic checks themselves are **not metered** — same free-tier treatment the alerts endpoint already has. Only the AI summary call is gated.

### Configurability

None required for v1 beyond what's implicit (the panel always runs all 10 checks) — this feature's "configurability" is really about *degrading gracefully* per-check based on the caller's actual admin access, not user-facing toggles. If a config knob is wanted, the only sane one is "skip AI summary" (pure deterministic mode) — optional, not required for the spec to be satisfied.

### Honesty constraints

- Unknown ≠ fail, always, for every admin-gated check.
- AI summary is progressive enhancement only — never a blocker, never fabricated when generation fails (quiet "unavailable" state, not a hedge or a fake summary — matches the migration-review honesty precedent already shipped in this codebase).
- AI prompt payload excludes raw alert bodies — only the 10 pass/fail/unknown results + repo name/visibility are sent.
- No auto-remediation from this panel in v1 — links to existing fix surfaces only.

### Edge cases

- Personal-account (non-org) repo → check #10 renders as "not applicable," not "fail" or "unknown."
- Repo the user has zero admin access to at all → checks 1, 2, 4, 5, 6, 9 all render "unknown"; checks 3, 7, 8 (which don't need admin) still compute normally; overall score should visibly communicate "partial visibility," not a falsely low/high number.
- Private repo without GHAS on the current GitHub plan → check 4/5/6 render informational/neutral, with copy explaining the plan limitation, not a fixable "fail."

---

## Feature 5 — Community polish: dogfood README refresh

**User story**: As the maintainer, I want this repo's own README refreshed (using README Studio itself) with real screenshots, so the community launch has a credible, self-demonstrating first impression.

Not a new feature — a content task that exercises Feature 1 end-to-end once shipped:
1. Run README Studio's score against this repo's actual `README.md`; address the top recommendations.
2. Capture fresh screenshots via Playwright MCP at 1920×1080 into `docs/images/` (repo convention: `0X_description_hd.png`).
3. Use README Studio's improve flow (grounded, `full-rewrite` or `missing-sections` as appropriate) to draft updated copy; hand-review before commit (no auto-commit, per the honesty constraint above) — this is a real product acceptance test for Feature 1, not just marketing.
4. Embed the new screenshots in the refreshed README.

No new endpoints, no new metering — this slice is pure usage of already-shipped work plus manual content editing.

---

## Implementation slices (dependency order)

Each slice is sized for one implementer agent (implementer + reviewer sub-pass, per this repo's existing subagent-driven workflow). Files listed are the expected touch-set; adjust minimally if investigation during implementation reveals a better exact location.

### Slice 1 — Foundation: metering keys + license detection

Unlocks quota gating for Slices 3–5 and the license-correctness dimension in Slice 2. No user-visible surface yet.

- `server/lib/feature-flags.js` — add `diagramGenPerMonth: 15`, `agentRulesPerMonth: 20`, `securityPostureAIPerMonth: 75` to `TIER_FEATURES.free` (and `Infinity` equivalents to `pro`/`enterprise` blocks).
- `server/lib/usage-meter.js` — add `ai_diagram`, `ai_agent_rules`, `ai_security_posture` to `METRIC_TO_FEATURE`; add matching entries to the quota-exceeded label map (~L259 area).
- `server/lib/ai-features/license-detect.js` (new) — `detectLicense(content)` pure function per Feature 1 spec, reusing `SUPPORTED_LICENSES` + `license-templates/*.txt` from `server/lib/ai-features/community-health-fix.js`.
- `server/__tests__/license-detect.test.js` (new) — unit tests for all 5 supported licenses + SPDX-header fallback + unrecognized-license case.
- `server/__tests__/usage-meter.test.js` — extend for the 3 new metric keys.
- `server/__tests__/feature-flags.test.js` — extend for the 3 new tier keys (free/pro/enterprise).

### Slice 2 — README Studio

Depends on: Slice 1 (license-detect).

- `server/lib/ai-features/quality-metrics.js` — add the 5 new deterministic dimensions (license correctness, badge/reality consistency, install-matches-stack, screenshots/visuals, section-order sanity).
- `server/lib/ai-features/readme-studio.js` (new) — consolidated grounded prompt builder (`buildImprovePrompt`, mode-aware) replacing `server/lib/ai-features/readme-enhance.js`'s role (keep or delete the old file per implementer's consolidation choice, documented in the PR).
- `server/routes/ai/core.js` — new `GET /api/repos/:owner/:repo/readme-studio/score` (free, no `requireAI`) and `POST /ai/readme-studio/improve` (consolidating `/ai/readme` + `/ai/readme/enhance`, grounded via `repo-context-builder.buildContext()`).
- `server/lib/validators.js` — `aiReadmeStudioImproveSchema` (replacing/extending `aiReadmeSchema`/`aiReadmeEnhanceSchema`).
- `src/components/AI/ReadmeStudioModal.jsx` (new) — score stage + improve stage + config panel + diff preview + apply/PR actions.
- `src/components/RepoDetail/OverviewTab.jsx` — entry-point action button.
- `src/services/api.js` (or wherever AI endpoints are wrapped client-side) — new client calls for score/improve.
- `tests/lib/ai-features/quality-metrics.test.js`, `tests/lib/ai-features/readme-studio.test.js`, `server/__tests__/readme-studio.test.js`, `tests/components/AI/ReadmeStudioModal.test.jsx` — new/extended per repo test-location convention.

### Slice 3 — AI Diagram Generator

Depends on: Slice 1 (metering keys only — otherwise independent of Slice 2).

- `server/routes/ai/diagrams.js` (new) — `POST /api/ai/generate-diagram`, streaming support, retry-once self-repair logic, metering/audit wiring.
- `server/lib/validators.js` — `aiGenerateDiagramSchema`.
- Router mount point (wherever `ai/*` route files are registered, e.g. `server/routes/ai/index.js` or the main server route registration) — mount the new router.
- `src/components/AI/DiagramGenerator.jsx` (new) — adapted from `src/components/PRReview/AIDeepReview/WalkthroughTab.jsx`'s render effect; Copy Mermaid/Copy SVG via `src/utils/clipboard.js`; Download SVG via the `Blob`/`createObjectURL` pattern from `MigrationHistory.jsx`.
- `src/components/RepoDetail/OverviewTab.jsx` — entry-point action button/modal trigger.
- `tests/components/AI/DiagramGenerator.test.jsx`, `server/__tests__/diagrams.test.js` (new).

### Slice 4 — Agent Rules Generator

Depends on: Slice 1 (metering keys). Independent of Slices 2–3.

- `server/lib/ai-features/agent-rules.js` (new) — `detectRepoSignals`, `buildAgentRulesPrompt`, `generateAgentRules`.
- `server/routes/repos/actions-community.js` — `POST /:owner/:repo/agent-rules/generate`, `POST /:owner/:repo/agent-rules/commit` (reusing `commitOrOpenPR` from `community-health-fix.js` verbatim).
- `server/lib/validators.js` — `agentRulesGenerateSchema`, `agentRulesCommitSchema`.
- `src/components/CommunityHealthDashboard.jsx` — new "Agent rules" detection card.
- `src/components/AI/CommunityHealthFixModal.jsx` or new `src/components/AI/AgentRulesModal.jsx` — config panel, preview, commit/PR flow.
- `src/components/RepoDetail/OverviewTab.jsx` or `SettingsTab.jsx` — secondary entry-point button.
- `tests/lib/ai-features/agent-rules.test.js`, `server/__tests__/agent-rules.test.js`, `tests/components/AI/AgentRulesModal.test.jsx` (new).

### Slice 5 — Security Posture Panel

Depends on: Slice 1 (metering keys). Independent of Slices 2–4.

- `server/routes/v1/repos-security.js` — add the 3 new fetches (`security_and_analysis`, `actions/permissions/workflow`, org 2FA), aggregate all 10 checks with pass/fail/unknown/not-applicable states, compose SECURITY.md presence from `community-health-service.js`.
- New AI-summary route (extend `repos-security.js` or add a small sibling, e.g. `server/routes/ai/security-posture.js`) — single `guardedGenerate` call, cached, per Feature 4 spec.
- `server/lib/validators.js` — response/request schema additions as needed.
- `src/components/security/SecurityScanModal.jsx` — rewrite body: score header, 10 check rows on `ds-risk-*` tokens, AI summary footer, collapsed existing alert sections; migrate `SeverityBadge` off hardcoded Tailwind colors.
- `tests/components/security/SecurityScanModal.test.jsx`, `server/__tests__/repos-security.test.js` — extend.

### Slice 6 — Community polish: dogfood README refresh

Depends on: Slice 2 (README Studio must be live to use it).

- Run README Studio (Slice 2) against this repo's own `README.md`; hand-review and commit the improved content.
- `docs/images/0X_*.png` (new) — Playwright MCP screenshots at 1920×1080 per repo convention.
- `README.md` — updated copy + embedded screenshots.
- No test changes expected (content-only slice); run the existing README-honesty CI gate to confirm no new pricing/feature claims are introduced.

---

## Cross-cutting checklist (apply to every slice)

- All new AI routes go through `guardedGenerate` — no direct provider calls.
- All new per-feature quotas added to `TIER_FEATURES.free` with `Infinity` for `pro`/`enterprise`, and to `METRIC_TO_FEATURE` + the quota-exceeded label map together (never one without the other).
- All generation flows preview before write; all writes go through `commitOrOpenPR()` or an equivalent already-audited write path — no new commit primitives invented.
- All new UI surfaces reuse `SectionPanel`/`EmptyState`/`ds-risk-*`/`src/components/ui/motion.js` — no new bespoke panel chrome or ad hoc color palettes.
- Tests land in `tests/`/`server/__tests__/` mirroring source structure per `CLAUDE.md`, never alongside source files.
- Honesty/parity CI gates (pricing-feature-parity, readme-honesty) must stay green — new quotas are additive to Free, not new paywalls.

---

## Addendum (owner request, 2026-07-18): embed-into-repo + no-AI fallbacks (Slice 6b)

Owner directive: diagrams (and README improvements) must be writable INTO the
repo/README itself — not just exported — with every edge case handled, and every
AI feature must degrade to a useful deterministic fallback when no AI provider
is configured or reachable.

### 6b.1 Embed diagrams into the repo

Two embed targets, both behind the existing preview → `commitOrOpenPR()` path
(never auto-commit):

1. **README mermaid fence** (preferred: text-only, diffable, rendered natively
   by GitHub and GitLab). Insert/replace inside idempotency markers:
   `<!-- repo-manager:diagram:<type>:start -->` … `:end -->` so regeneration
   REPLACES the block instead of duplicating it. Placement: after the first
   H1/intro paragraph by default; configurable (top / after-intro / end / custom
   marker already present).
2. **Committed SVG file** at `docs/diagrams/<type>.svg` + a
   `![<Type> diagram](docs/diagrams/<type>.svg)` reference in the README (for
   platforms that don't render mermaid). SVG must pass the existing
   `sanitizeSvg` (no scripts/foreignObject), size-guarded (< 500 KB).

Edge cases (all must be handled + tested):
- No README exists → offer to create one (README Studio path) or embed
  SVG-only with a docs/ commit.
- Markers present but malformed / only one marker → treat as absent, append
  fresh block, surface a notice.
- README on a protected branch → `commitOrOpenPR()` already falls back to a PR;
  surface which happened.
- `docs/diagrams/` doesn't exist → create in the same commit (Git tracks files,
  not dirs — no extra API call).
- Repo where the user lacks push rights → PR-from-fork is OUT of scope v1;
  show an honest "read-only access" state.
- Very large repos → tree used for prompting is already truncated; label the
  diagram "generated from a partial tree" when truncation happened.
- Invalid mermaid after the retry-once self-repair → fall back to the
  deterministic diagram (6b.2) rather than failing the embed.
- **Own-app parity**: `RepoMarkdown` (the in-app README reader) must render
  ```mermaid fences like WalkthroughTab does — otherwise embedded diagrams
  render on GitHub but not in our own reader.

### 6b.2 Deterministic no-AI fallbacks (every wave-6 feature)

Pattern precedent: `suggest-name-description`'s deterministic generator. When
`requireAI` would fail (no provider configured, provider error after retry, or
spend cap reached):
- **Diagrams** → deterministic `flowchart TD` of the top-level directory
  structure (from the tree endpoint, depth 2, capped nodes) — clearly labeled
  "Structure diagram (deterministic — enable an AI provider for richer
  diagrams)".
- **README Studio improve** → deterministic skeleton patch: insert missing
  sections (License section from detected license, Install from detected stack
  manifest, TOC) with TODO placeholders — score/gap analysis is already
  fully deterministic and free.
- **Agent rules** → deterministic template filled from `detectRepoSignals`
  (scripts, test layout, lint config, license) without AI polish.
- **Security posture** → the 10 checks are already deterministic; only the
  AI summary block hides when AI is unavailable (never blocks the card).
- UI: fallback output is visibly badged (reuse the existing AIErrorState /
  notice patterns); quota-exceeded (429) offers the deterministic path too.

### Out of scope (honest cut)
- AI **raster** image generation (logos, banners): different model class/cost;
  revisit only if a configured provider exposes image output. Not in v1.
- PR-from-fork embeds; multi-README monorepos (same cut as AGENTS.md v1).
