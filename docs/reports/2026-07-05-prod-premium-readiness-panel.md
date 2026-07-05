# Production & Premium Readiness Panel — UI/UX, Data Uniformity, Data Hygiene, Theme Consistency

**Date:** 2026-07-05 · **Branch:** `main` @ `a8b5576` · **Version:** 4.4.0
**Method:** Read-only multi-agent panel (25 agents). Eight specialists audited one dimension each — UI consistency, UX flows, theme/dark-mode consistency, data-display uniformity, data hygiene & lifecycle, production readiness, premium/professional polish, accessibility. Every Critical/High finding was then **adversarially verified** by an independent agent instructed to refute it against the live code; confirmed criticals received a **second independent opinion** calibrating real-world severity; and a final **completeness critic** audited the panel itself for blind spots. **No source files were modified.**

> Verification outcome: 13 High/Critical findings verified — **0 refuted**, 4 downgraded one level, 9 confirmed at severity. The single Critical was confirmed twice independently. Specialist precision this round was high; unverified Medium/Low findings all carry file:line evidence the specialist personally read.

---

## Executive summary

**The foundation is genuinely premium; the risk is concentrated in what the product *says* and what it *forgets*.** Across all eight dimensions the panel found the same shape: excellent, deliberately engineered infrastructure (a load-bearing 49-primitive UI library, ~5,000 `dark:` pairs with a fully slate-unified palette, a canonical formatter module, zod-validated fail-fast config, real health probes, a documented motion vocabulary, WCAG-engineered shared widgets) — with localized pockets where surfaces shipped without adopting it, and a handful of places where the product makes promises the code does not keep.

Three clusters matter for going to production as a paid product:

1. **Legal/monetization honesty (prod blockers for a *commercial* launch).** The GDPR erasure route — explicitly labeled "Article 17 / SOC 2 CC6.5" — wipes 15 enumerated tables but silently misses ~15 newer user-scoped ones, **leaving encrypted Azure PATs, AI chat transcripts and outbox payloads behind after "Erase my data"** (Critical, double-confirmed). On the pricing side: the **yearly billing toggle is cosmetic** — it displays a 20%-discounted price but always creates a *monthly* Stripe checkout; the Settings upsell **sells 10,000 AI queries/month when the real Pro cap is 5,000** plus an unshipped feature; and the pricing page claims **"SOC 2-hardened", "all data encrypted at rest (AES-256)" and "custom data-residency options"** that the codebase cannot substantiate. The pricing-parity gate that guards four surfaces doesn't cover the Settings upsell (a fifth surface) nor these claim types. Relatedly, the emailed **365-day BYOK retention promise never runs** — the purge job exists, is tested, and is scheduled nowhere.
2. **Operational blind spots (prod blockers for *any* deployment).** There is **no backup/restore story** for the SQLite volume that holds users, encrypted credentials and audit logs (WAL makes naive file copies unsafe); **`ALLOW_MOCK_AUTH=true` still yields unauthenticated admin-equivalent login in production** and the startup secrets gate doesn't flag it; graceful shutdown force-exits whenever an SSE client is connected; five GitHub event tables grow forever with no retention path.
3. **Trust-eroding seams users hit weekly.** The shared date utilities parse the server's naive-UTC SQLite timestamps as *local* time, so **every migration/audit timestamp and live elapsed timer is wrong by the user's UTC offset** (for a Lisbon user in summer, "just finished" reads "1h ago"). Bulk **"Make Public/Private" silently forces every repo private** — the label promises a choice that doesn't exist. The flagship **PR-review submit gives zero success feedback**. Two high-visibility theme islands ship illegible: the AI README Enhance diff renders light-in-dark, and the DevToolkit Q&A chat is unreadable in light mode (~1.6:1 contrast).

Everything else is finish-work: nine competing relative-time dialects, `'—'` vs `'N/A'` drift, Portuguese strings that survive the anti-PT guard (accent-free words, server-side prompts), bespoke pickers regressing the June Select unification, `window.alert()` in a premium command palette, `document.title` never changing, and an a11y tail (unnamed destructive icon buttons, unannounced SSE progress) that the deliberately critical-only axe gate cannot catch.

**Verdict: not prod-ready as a commercial offering until cluster 1 + 2 are fixed (est. 2–4 focused PRs); prod-ready for trusted/internal use today.** The premium *feel* gap is real but small — dominated by ~15 S-effort fixes listed under Quick wins.

---

## Scorecard

Severities are **post-verification** (adversarial verdicts applied; 4 findings downgraded from the specialists' initial ratings).

| Dimension | Critical | High | Medium | Low | Total |
|---|:--:|:--:|:--:|:--:|:--:|
| 🧩 UI consistency | 0 | 0 | 7 | 4 | 11 |
| 🔄 UX flows & feedback | 0 | 2 | 7 | 2 | 11 |
| 🌗 Theme & dark mode | 0 | 2 | 4 | 7 | 13 |
| 📊 Data-display uniformity | 0 | 1 | 6 | 3 | 10 |
| 🧹 Data hygiene & lifecycle | **1** | 0 | 4 | 3 | 8 |
| 🚀 Production readiness | 0 | 2 | 4 | 4 | 10 |
| 💎 Premium polish | 0 | 3 | 4 | 5 | 12 |
| ♿ Accessibility | 0 | 0 | 8 | 5 | 13 |
| **Total** | **1** | **10** | **44** | **33** | **88** |

**69 new** findings vs **19 known-open** (documented in the 2026-06-20/26 audits or the 2026-06-25 layout spec and still unfixed). Zero regressions — nothing previously fixed has drifted back, and the panel verified that **all four Premium-High findings from 2026-06-26 are fixed** on main.

---

## Top priorities

Ordered by (commercial-launch blocking) × (user-visible damage) × (fix safety). ✔ = adversarially verified this round.

| # | Finding | Where | Dim | Sev | Effort |
|:--:|---|---|:--:|:--:|:--:|
| 1 | ✔✔ GDPR erasure misses ~15 newer user-scoped tables — encrypted Azure PATs, AI chat transcripts, outbox bodies survive "Erase my data" | `server/routes/user-data.js:149-243` | Hygiene | **Critical** | M |
| 2 | ✔ Yearly billing toggle is cosmetic — shows 20%-off price, always checks out at the monthly Stripe price | `src/components/Pricing/PricingPage.jsx:78-87,181` | Premium | High | M |
| 3 | ✔ Pricing page claims "SOC 2-hardened", "AES-256 at rest", "data-residency options" that can't be substantiated | `PricingPage.jsx:101,377` | Premium | High | S |
| 4 | ✔ Settings upsell sells 10,000 AI queries (real cap 5,000) + unshipped feature — 5th pricing surface, outside the parity gate | `Settings/LicensePlanSection.jsx:125` | Premium | High | S |
| 5 | ✔ `ALLOW_MOCK_AUTH` yields unauthenticated login in prod; startup secrets gate is blind to it | `server/routes/auth.js:196-201` | Prod | High | S |
| 6 | ✔ No backup/restore story for the SQLite data volume (WAL makes naive copies unsafe) | `docker-compose.yml:43-44` | Prod | High | M |
| 7 | ✔ Naive-UTC timestamps parsed as local time — migration/audit times + live timers wrong by UTC offset app-wide | `src/utils/format.js` vs `server/migration-engine.js:347` | Data | High | M |
| 8 | ✔ Bulk "Make Public/Private" silently forces every selected repo **private** | `src/actions/repoActions.js:472-492` | UX | High | S |
| 9 | ✔ PR-review submit: no success feedback, no refetch — Approve appears to do nothing | `PRReview/PRReviewView.jsx:217-232` | UX | High | S |
| 10 | ✔ AI README Enhance diff renders light-themed inside dark mode (missing `diffViewTheme`) | `AI/ReadmeEnhanceDiffPanel.jsx:105-112` | Theme | High | S |
| 11 | ✔ DevToolkit Review Q&A chat illegible in light mode (dark-only bubbles, ~1.6:1) | `DevToolkit/ReviewTab/ReviewTab.jsx:162-175` | Theme | High | S |
| 12 | ✔ 365-day BYOK retention emailed to users never runs — purge jobs written+tested but scheduled nowhere | `server/lib/retention.js:104` · `server/index.js:343-358` | Hygiene | Med* | S |
| 13 | ✔ Migration status split `complete`/`completed` — bulk-mirrored jobs render "Pending" forever, stats undercount | `server/routes/import/url.js:105` vs stats endpoint | Data | Med* | S |
| 14 | Roadmap says PR write-back is tier-gated ("shipped"); pricing page + backend say Free has full write-back (critic confirmed: no `requireTier` on merge/comment/review routes) | `Roadmap/RoadmapPage.jsx:59` · `server/routes/repos/pulls.js` | Premium | Med | S |
| 15 | Event tables (`pr_events`, `issue_events`, …) grow forever — no retention path at all | `server/db.js:637-716` | Hygiene | Med | M |
| 16 | Browser Back exits the app (all nav is `replaceState`; in-code comment claiming otherwise is false) | `src/hooks/useAppRouter.js:116-120` | UX | Med | M |
| 17 | Unsaved changes destroyed silently on tab switch / modal close (RepoDetail Settings, SettingsModal) | `RepoDetail/RepoDetail.jsx:209` | UX | Med | M |
| 18 | ✔ Destructive icon-only buttons unnamed (delete release/webhook) — invisible to screen readers, axe gate can't catch (critical-only, 4 views) | `RepoDetail/ReleasesTab.jsx:170` et al. | A11y | Med* | S |

\* downgraded from High by the adversarial verifier (severity calibration, not refutation).

## Quick wins (S-effort, near-zero risk — one polish PR)

1. Portuguese strings still shipping: `HeroSyncChip.jsx:20` ("A sincronizar…"), `MarksBadge.jsx:34` ("Sem tags"), `MarksDetailModal.jsx:20` ("— nada escrito"), `MigrationWizard/Steppers.jsx:231` ("Progresso") — plus add accent-free words + server-side prompt files to the anti-PT guard scope.
2. `window.alert()` in the WorkBoard command palette → toast/modal (`WorkBoardPage.jsx:186-188`).
3. `document.title` per view (currently static forever; also fixes indistinguishable tabs/history).
4. Landing footer says "Vite 7" — project is on Vite 8 (`LandingPage.jsx:45`).
5. ErrorBoundary renders raw exception text to end users (`ErrorBoundary.jsx:77`).
6. Docker/railway health checks point at rate-limited legacy `/api/health` instead of the purpose-built `/live`/`/ready` probes.
7. No compression + no immutable caching on the Express-served SPA (`server/index.js:302-316`).
8. `AIInstructionsSection` tabs keyboard-unreachable — half-copied roving tabindex; swap to shared `ui/TabBar` (`AIInstructionsSection.jsx:98-117`).
9. Migration wizard "Back to Selection" CTA calls `window.history.back()` → exits the app (`RepoConfigStep.jsx:249-257`).
10. `ProgressStep`/`MigrationHistory` silent `catch {}` on pause/cancel/re-run/export → `toast.errorFromException`.
11. MigrationHistory duration renders "2400s" — `formatDurationSeconds` exists, use it (`format.js:171`).
12. `'N/A'` vs `'—'` split for identical missing data — standardize on `'—'`.
13. `.dark html` scrollbar selectors can never match (should be `html.dark`) (`index.css:118-120`).
14. Add `color-scheme: light dark` so native checkboxes/date pickers follow the theme.
15. `::selection` uses the light brand token in dark mode; apply the existing `--ds-accent-brand-dark`.

---

## What is already premium (panel consensus)

- **UI system is load-bearing, not aspirational:** EmptyState in 36 files, Skeleton in 28, ConfirmModal/confirmGate in 29, toast in 42; `ui/Button` with 13 tokenized variants, 44px targets and default `type="button"`; Modal/WizardPanel share variant tables explicitly to prevent drift.
- **Theme core is unusually strong:** ~4,994 `dark:` pairs across 327/383 files, zero gray/zinc/neutral occurrences (slate-unified), FOUC-proof inline theme script, theme-threaded diff renderer, documented theme-static brand tokens.
- **UX scaffolding is real:** central action registry with typed intents + per-action confirm configs (type-to-confirm deletes), settle-once `openConfirm`, optimistic+rollback mutations, offline retry-queue with replay toasts, designed first-run states.
- **Backend is production-shaped:** zod-validated fail-fast config, startup secrets gate, K8s-style live/ready probes, WAL+busy_timeout+FK pragmas, pino structured logging, graceful shutdown draining six workers, multi-stage Dockerfile + secrets-enforcing compose, exemplary `.env.example`.
- **Data lifecycle half that exists is good:** versioned migration ledger (25 migrations), stranded-job recovery on boot, TTL janitors for sessions/caches/credentials, tamper-evident hash-chained audit log, idempotent Stripe webhook ledger.
- **A11y above baseline:** shared focus-trap, pervasive live regions, full combobox/tablist ARIA in primitives, global reduced-motion kill-switch, axe CI gate (albeit critical-only), only 3 unnamed icon buttons app-wide out of hundreds.
- **All four Premium-High findings from the 2026-06-26 audit verified fixed** on main.

---

## Coverage gaps & confidence (completeness critic)

The critic audited the panel itself and rated confidence **high** for the file:line-anchored findings (its own spot-checks *confirmed* rather than refuted the load-bearing claims — e.g. PR write-back genuinely ungated server-side, `OrganizationSelector` genuinely dead, the `replaceState` comment genuinely false). Systematic limitations to keep in mind:

1. **100% static analysis** — no finding was reproduced in a running browser. Visual/behavioral severities (light-in-dark diff, illegible chat, silent submit, Back-exits-app) are inferred from code and should be smoke-checked via Playwright at 1920/2560 in both themes before large investments.
2. **Teams surface: zero findings in all 8 dimensions** — not because it's clean; critic spot-checks found the same defect classes there (silent `catch {}` at `TeamDetails.jsx:81,514`, absolute `toLocaleDateString()` timestamps). Treat Teams as unaudited.
3. **AI Assistant chat under-sampled** (751 lines, fresh SSE streaming): has its own silent-catch cluster (`AIAssistant.jsx:116,185,197,265`); streaming failure/reconnect UX never reviewed.
4. **Responsive/viewport behavior not exercised** — deliberately: the open spec `docs/specs/2026-06-25-layout-premium-responsive.md` already owns ultrawide/`--layout-px`/SlimSidebar/duration-token territory. This report and that spec are complementary, not contradictory.
5. **Frontend performance at data scale unexamined** — react-virtual adopted in only 3 lists; the primary repo grid is not virtualized.
6. **Server input-validation uniformity unsampled** — only ~30 of 68 route files reference validators; PR merge/comment/review write endpoints ship with `requireAuth` only.
7. **Staleness display uniformity unexamined** — `gh-cache` returns `{ stale, fetchedAt }` and stamps `X-Cache: stale`, but whether consumers surface stale-vs-live consistently was not checked.

Numeric counts in findings (52 pills, 9 time implementations, ~15 tables, 30 checkboxes) are **directional grep counts**, not exact enumerations. Eight specific claims the critic flagged as needing tighter evidence are marked in the appendix context; the two most load-bearing ("~15 missed GDPR tables", "X-Request-Id never matches logs") should be re-enumerated during fix work.

---

## Suggested sequencing

1. **PR "legal-honesty":** #1 GDPR table sweep (enumerate from `sqlite_master` minus allowlist, so future tables can't be missed again) + #12 schedule the retention pass + #3/#4 pricing-claim + upsell copy fixes + extend the parity gate to `LicensePlanSection` and claim-bearing FAQ strings + #14 Roadmap/pricing write-back reconciliation.
2. **PR "billing":** #2 thread the billing period into checkout (or remove the yearly toggle until Stripe yearly prices exist).
3. **PR "ops":** #5 fail startup when `ALLOW_MOCK_AUTH` is set in production + #6 backup story (`better-sqlite3 .backup()` on a schedule into the volume + restore doc) + health-check paths + compression/caching + SSE-drain on shutdown.
4. **PR "time":** #7 central naive-UTC parse fix in `format.js` (append `Z`), delete the two leaf hand-patches, then #13 status-vocabulary migration (`complete`→`completed` + one canonical map).
5. **PR "flagship UX":** #8 visibility picker (or split into two labeled actions), #9 PR-review success toast + refetch, #10/#11 theme islands.
6. **PR "polish":** the 15 quick wins.
7. **Follow-up audits:** Teams + AI Assistant chat sweep; Playwright visual pass (both themes, 1920/2560) to convert inferred severities into observed ones.

---

# Appendix — all 88 findings by dimension

Findings are verbatim from the specialists, ordered by severity within each dimension. Badges show post-verification severity; `verified` = survived adversarial refutation; `2nd-opinion` = criticals additionally severity-calibrated by an independent second verifier.

### UI consistency

> UI consistency is fundamentally healthy: the 49-primitive library is real and broadly adopted (EmptyState in 36 files, Skeleton in 28, ConfirmModal/confirmGate in 29, toast in 42, Select in ~24), and recent commits show active consolidation passes. The remaining drift concentrates in four pockets: tab/segmented controls forked from ui/TabBar (including one fork whose half-copied roving tabindex makes tabs keyboard-unreachable), the entire PRReview area living on an off-brand blue palette with zero ds-focus-ring usage, the June Select unification still regressed in five pickers, and the MigrationHistory marks UI remaining a Portuguese, dark-only island. Most of the worst offenders were already catalogued on 2026-06-26 and remain open because only tier-1 safe wins were applied.

**Already premium in this dimension:**

- Shared primitives are genuinely load-bearing, not aspirational: EmptyState imported in 36 files, Skeleton in 28, ConfirmModal/confirmGate in 29, toast/useToast in 42, Select in ~24, and toast.errorFromException/formatUserError across 39 files (grep counts verified this session).
- ui/Button.jsx is exemplary: 13 variants all built on brand tokens (--ds-accent-brand, --ds-cta), default type="button" (Button.jsx:42-49), ds-focus-ring on every variant, and 44px minimum tap targets with an explicit opt-out set (Button.jsx:38-40). Commit 9732ebd ("extend shared Button pass to remaining surfaces") and 0f75020 ("tokenize exact-match brand indigo callsites") show ongoing consolidation discipline.
- Anti-drift architecture exists and is documented in-code: Modal and WizardPanel share icon-tile/variant tables via _variants.js "so Modal and WizardPanel can't drift out of sync" (Modal.jsx:8-16); PageHeader.jsx:3-17 was explicitly created to kill six divergent H1 sizes and is consumed by Teams, WorkBoard, RepoDetail, Admin, StatusPage, PromptStudioPage.
- Overlay layering and motion are tokenized consistently: every modal/drawer/popover backdrop found uses z-[var(--ds-z-modal)]/z-[var(--ds-z-ceiling)] tokens, and TabBar/DevToolkit consume the shared motion vocabulary (TRANSITION.standard, EASE) rather than hardcoding transitions.
- The refresh idiom is uniform across 15+ sibling views (RefreshCw icon + conditional animate-spin inside a ghost Button — CommunityHealthDashboard:195, MigrationHistory:199, BranchesTab:146, IssuesTab:153, AuditLogSection:148, etc.), and NotificationLayer.jsx centralizes all global overlay surfaces (toasts, sync banner, tour, quota dialog, offline banner) in one shell.

#### [MEDIUM · verified] AIInstructionsSection tab strip half-copies TabBar's roving tabindex without arrow-key handling — inactive tabs are keyboard-unreachable

- **Status:** new · **Effort:** S · reported high, calibrated to medium
- **Evidence:** src/components/Settings/AIInstructionsSection.jsx:98-117 — local TabButton sets `tabIndex={active ? 0 : -1}` (line 106) but grep for onKeyDown/ArrowRight/ArrowLeft across the whole file returns zero hits; the tablist container at line 224 has no key handler. ui/TabBar.jsx:37-61 implements the full pattern this was copied from (ArrowLeft/Right/Home/End + focus management).
- **Impact:** Keyboard and screen-reader users cannot switch between the Default/Custom/Preview prompt views at all: inactive tabs are removed from the tab order (tabIndex -1) and no arrow-key navigation exists to reach them. This is a functional a11y failure on a Pro-facing AI-instructions management surface, worse than having no roving tabindex at all.
- **Fix:** Replace the local TabButton strip with the shared ui/TabBar (variant="pill", size="sm") which already provides the complete roving-tabindex + arrow-key contract, or at minimum add TabBar's handleKeyDown to the tablist container.
- **Verification:** Verified against current main: AIInstructionsSection.jsx line 106 sets tabIndex={active ? 0 : -1} on role=tab buttons, the role=tablist at line 224 has no key handler, and the file has zero ArrowLeft/ArrowRight/Home/End/onKeyDown handling (ui/TabBar.jsx:36-71 has the full donor pattern). Git log shows no fix in recent commits, TabButton is file-local (not a TabBar wrapper), and no global/delegated tablist keydown handler exists in src/ — so inactive tabs are genuinely keyboard-unreachable, a real WCAG 2.1.1 Level A failure and worse than DevToolkitPanel's no-roving-tabindex tablist. Downgraded to medium because the impact is narrower than claimed: the Editor tab is the default so the core edit/save flow is fully keyboard-operable, the default prompt remains accessible via the textarea placeholder and the "Copy default into editor" button, only the read-only Preview view has no alternate keyboard path, and screen readers in browse mode can still activate tabIndex=-1 buttons (the fully blocked group is keyboard-only users on two auxiliary read-only views).

#### [MEDIUM] ui/TabBar is forked three ways and the segmented/filter-row role has three divergent visual languages

- **Status:** new · **Effort:** M
- **Evidence:** WorkBoardPage.jsx:321-360 and DevToolkitPanel.jsx:223-253 hand-roll role=tablist strips with duplicate underline indicators (WorkBoardPage:350-356, DevToolkitPanel:243-249) but none of TabBar's keyboard nav, roving tabindex, or aria-controls (TabBar.jsx:37-61,78-82). MigrationHistory.jsx:206-217 re-creates TabBar's segmented variant classes byte-for-byte ('rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden' + active 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' — identical to TabBar.jsx:7,20-21). Same filter-row role rendered as rounded-full brand pills in BranchesTab.jsx:199-208 and as raw blue-600 squares in PromptLibrary.jsx:32-38.
- **Impact:** Six surfaces render the same 'tabs/filter strip' concept in three visual styles with inconsistent a11y; the WorkBoard and DevToolkit flagship panels silently miss the keyboard contract that RepoDetail/Teams/Admin tabs already have, and every future TabBar improvement (focus ring, indicator motion) must be re-applied in 3+ forks.
- **Fix:** Add a `badge`/`kbd` accessory slot to ui/TabBar (the only gap that caused the WorkBoard/DevToolkit forks), then migrate WorkBoardPage, DevToolkitPanel, and the MigrationHistory legacy filter onto it; standardize filter rows on one TabBar variant (segmented or pill).

#### [MEDIUM] Entire PRReview area runs on an off-brand blue accent and bypasses Button/ds-focus-ring

- **Status:** new · **Effort:** M
- **Evidence:** Grep: 21 blue-500/600/700 accent hits in src/components/PRReview vs 4 indigo/ds-accent-brand hits; ds-focus-ring occurs 0 times in the folder while 8 focus rings use focus-visible:ring-blue-500. Raw primary CTAs bypass ui/Button: PRReviewView.jsx:311-316 ('Go back' bg-blue-600 button), AIDeepReview/AIReviewPanel.jsx:40-46 ('Generate AI Review' bg-blue-600), ReviewToolbar.jsx:142-158 (view-mode toggle bg-blue-600 active + ring-blue-500), PublishReviewModal.jsx:7 and CreatePRConfirm.jsx:7 (bg-blue-600 tone tables), DevToolkit/ReviewTab/QuickActions.jsx:53. Button.jsx:4 defines primary as var(--ds-accent-brand) with ds-focus-ring and 44px targets.
- **Impact:** The flagship code-review surface visibly uses a different brand color family than the rest of the app (indigo everywhere else), and its raw buttons lose the design system's focus ring, tap-target minimum, and disabled/active states — a quality gap users see on every PR review session.
- **Fix:** Replace raw bg-blue-600 buttons with <Button variant="primary"> and swap the remaining blue-600/blue-500 accents and focus rings to --ds-accent-brand / ds-focus-ring, matching the tokenization pass already applied elsewhere (commit 0f75020).

#### [MEDIUM] June Select unification still regressed: five pickers remain bespoke dropdowns

- **Status:** known-open · **Effort:** M
- **Evidence:** PromptPicker.jsx:14-36 (own open state, pointerdown outside-click, hand-rolled listbox), SavedCredentialsPicker.jsx:19,104-107 (own open-state dropdown with ChevronDown rotate), and ModelCombobox.jsx / DevToolkit/shared/RepoSelector.jsx / BranchSelector.jsx each still contain the bespoke `mousedown` outside-click effect (grep count 2 each, verified this session). ui/Select.jsx provides searchable mode, ARIA combobox semantics, and keyboard nav.
- **Impact:** Five dropdowns drift from the shared Select's behavior (keyboard nav, mobile outside-tap handling — the audit noted Select itself moved beyond mousedown for touch), tripling maintenance surface and reintroducing the exact a11y gaps the June unification removed.
- **Fix:** Adopt ui/Select's searchable mode for PromptPicker/SavedCredentialsPicker/ModelCombobox; collapse RepoSelector+RepoBadge+BranchSelector into one shared searchable combobox as DM-18 prescribed (2026-06-26 report, themes 2 and DM-18).

#### [MEDIUM] WorkBoard save-preset palette command still falls back to window.alert

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/WorkBoard/WorkBoardPage.jsx:186-188 — `window.alert('Use the Presets dropdown in the filter bar to save the current filters as a preset.')` fired from the command-palette WORKBOARD_SAVE_PRESET event.
- **Impact:** A native browser alert — visually alien to the app, blocking, unstyled in dark mode — appears from a premium command-palette flow, while the app has a full toast system used in 42 component files. The palette advertises an action it cannot perform.
- **Fix:** Replace with toast.info (via useToast/appEvents bridge like other palette actions), or actually open the PresetDropdown; this was flagged in the 2026-06-26 report (theme 9) and remains unfixed.

#### [MEDIUM] MigrationHistory marks UI remains a Portuguese, dark-only island (PL-27/PL-28 unfixed)

- **Status:** known-open · **Effort:** S
- **Evidence:** MarksDetailModal.jsx:20 renders '— nada escrito'; MarksBadge.jsx:34 returns 'Sem tags'; MigrationWizard/Steppers.jsx:231 renders 'Progresso'. MarksDetailModal.jsx:53-67 hardcodes bg-slate-950/70, bg-slate-900/90, text-slate-100/300 with zero dark: pairings, and uses emoji glyphs ✓/⚠/✗/✕ (lines 5, 78) instead of the lucide icon set used everywhere else.
- **Impact:** In light mode the marks dialog renders as a dark island with dark-theme text; users of an otherwise all-English product see Portuguese strings on the migration-provenance surface — a visible polish failure on a paid-tier feature.
- **Fix:** Translate the three strings, rebuild MarksDetailModal on ui/Modal (which supplies theme-paired surfaces, focus trap, scroll lock) and swap emoji for lucide Check/AlertTriangle/X icons; verified still present after the post-audit fix batch.

#### [MEDIUM] ui/Badge has 5 consumers while ~52 bespoke pill implementations drift on padding, size, and contrast

- **Status:** new · **Effort:** M
- **Evidence:** Grep: Badge imported in only 5 files (ApiKeysSection, RepoCard, LicensePlanSection, DLQTable, DLQDetailPanel) vs 52 occurrences of hand-rolled rounded-full pill classes across 37 component files. Samples read: RepoDetail.jsx:134-178 (four bespoke pills with divergent color pairs in one header), WorkBoardPage.jsx:342-348 (text-[9px] font-bold pill), Badge.jsx:5-11 documents WCAG AA 4.5:1-tuned variants the bespoke copies don't inherit.
- **Impact:** The same 'status/label pill' concept renders with at least four different padding/type scales and unaudited color pairs; contrast fixes made to Badge (explicitly WCAG-tuned) never reach 90% of pill sites.
- **Fix:** Add size ('xs' for the 9-10px chips) and tone props to ui/Badge, then sweep the mechanical cases (status pills in RepoDetail header, WorkBoard tab badges, wizard step pills) onto it — same playbook as the Button pass in commit 9732ebd.

#### [LOW] SnoozeModal re-implements a dialog instead of using ui/Modal — no scroll lock, no entrance motion, no mobile sheet

- **Status:** new · **Effort:** S
- **Evidence:** src/components/Dashboard/Premium/SnoozeModal.jsx:28-44 — `if (!open) return null` with a hand-rolled fixed-inset backdrop and card; no useBodyScrollLock, no AnimatePresence entrance (every other modal scale/fades in), no mobileVariant sheet, bespoke bg-black/40 backdrop instead of MODAL_BACKDROP_CLASS (_variants.js:56). ui/Modal.jsx:54-80 provides all of these.
- **Impact:** The premium-dashboard snooze dialog pops in with zero animation while every sibling modal animates, background content stays scrollable behind it, and on mobile it stays a floating card while other modals become bottom sheets — small but perceptible inconsistency on the flagship dashboard.
- **Fix:** Rebuild on ui/Modal size="sm" with the preset grid as children; the focus-trap/Escape wiring it hand-rolls comes free.

#### [LOW] Dead duplicate Dashboard org picker (OrganizationSelector) still exported alongside the live HeroOrgChip

- **Status:** new · **Effort:** S
- **Evidence:** src/components/Dashboard/OrganizationSelector.jsx:10 defines a full Radix-Popover org picker with the identical prop contract (orgs/selectedOrg/onSelectOrg/loading) as HeroOrgChip.jsx:47; repo-wide grep shows its only reference is the re-export at Dashboard/index.js:7 — no render site. DashboardHero.jsx (DM-17, flagged dead 2026-06-26) also still exists and still imports HeroOrgChip.
- **Impact:** Two parallel org-picker implementations invite the next contributor to enhance the dead one; the pair has already diverged (different trigger chrome, no mobile Drawer path in OrganizationSelector).
- **Fix:** Delete OrganizationSelector.jsx and its index.js export together with DashboardHero.jsx per DM-17; HeroOrgChip is the sole live implementation.

#### [LOW] Native title= tooltips (154 sites) coexist with ui/Tooltip (14 files) with no rule for which to use

- **Status:** new · **Effort:** M
- **Evidence:** Grep: 154 title= occurrences across 60 component files (CommunityHealthDashboard 11, PatPasteGuide 10, Header 7, MigrationHistory 7, OrgManagerModal 7) vs ui/Tooltip imported in 14 files. Example drift within one surface: ReviewToolbar.jsx:149,163 uses native title on the view toggle while WorkBoard row actions next door use the shared Tooltip (WorkBoardRowLink, InlineActions).
- **Impact:** Hover affordances are inconsistent — native titles are unstyled, ignore dark mode, have OS-dependent delay, and never fire on touch — so identical icon-button patterns explain themselves differently across sibling views.
- **Fix:** Adopt a convention: ui/Tooltip for interactive icon-only controls (keep native title only as redundant a11y fallback), and sweep the highest-traffic surfaces (Header, CommunityHealthDashboard, MigrationHistory toolbars) first.

#### [LOW] Icon sizing drifts between three conventions: Tailwind w-4 classes, numeric size={n} props, and arbitrary pixel values

- **Status:** new · **Effort:** S
- **Evidence:** Header.jsx uses arbitrary w-[15px]/w-[16px]/w-[18px] h-[...] on 12+ icons (lines 103, 177-221, 295, 431-433, 479); AIAssistant.jsx uses numeric size={11..16} props 18 times, PRReview/ReviewToolbar.jsx:151,165 size={13}; the codebase-wide standard elsewhere is w-4 h-4 / w-3.5 h-3.5 utility classes (hundreds of sites, e.g. every RefreshCw refresh button).
- **Impact:** Sibling toolbars render icons at 13/15/16px against the 14/16px Tailwind grid, producing subtly mismatched icon weights across Header vs page toolbars; three conventions make future global icon tweaks (stroke, size tokens) unreliable.
- **Fix:** Standardize on Tailwind size utilities (w-3.5/w-4/w-5) as the single convention, converting the arbitrary-pixel Header sizes and numeric size props during the next polish pass; consider an ICON_SIZE note in ui/index.js.


### UX flows & feedback

> UX-flow infrastructure in this codebase is genuinely mature — a central action registry with confirm gates and typed intents, a settle-once confirm primitive, optimistic+rollback mutations, offline retry-queue toasts, and strong first-run empty states. The remaining problems live at the seams: a bulk action whose label promises a choice it doesn't offer (forces all repos private), the flagship PR-review submit that gives zero success feedback, a navigation model where the browser Back button exits the app (and one wizard CTA that literally calls history.back() into the void), pause-without-resume in the live migration view, and a cluster of silent empty-catch handlers in migration surfaces. Most fixes are small and can consolidate onto primitives that already exist (toast.errorFromException, EmptyState action, useDangerAction, ConfirmCloseModal pattern).

**Already premium in this dimension:**

- Central repo-action registry with typed intents, per-action confirm configs (type-to-confirm for deletes at src/actions/repoActions.js:371-377 and 502-508), and a single dispatcher that funnels every failure through toast.errorFromException (src/actions/runAction.js:22-35). Deliberate @unconfirmed-by-design annotations document why reversible actions skip the modal.
- Shared confirmation stack is genuinely premium: openConfirm settle-once contract (src/utils/openConfirm.js:23-53), useDangerAction hook, and ConfirmModal with case-mismatch input hints, inline display of onConfirm errors, and Cmd+Enter confirm (src/components/ui/ConfirmModal.jsx:43-77, 140-144).
- CreateRepoModal is a model form flow: debounced name-availability probe with AbortController stale-guard, inline field-level success/error, disabled submit on taken names, success/error toasts (src/components/CreateRepoModal.jsx:35-69, 104-140).
- Work-board review actions use optimistic-update + rollback + typed scope_required error copy (src/hooks/useReviewAction.js:36-93).
- Migration ProgressStep streams live SSE progress with a monotonic-seq cursor (survives the 100-event window), a Reconnecting/Live indicator, typed failure recovery buttons (Replace & retry, Retry with Git LFS), and a two-step inline cancel confirm (src/components/MigrationWizard/steps/ProgressStep.jsx:207-217, 140-175, 356-366, 430-451). Failed migrations proactively offer AI help (lines 283-293).
- First-run states are designed, not accidental: RepoList distinguishes 'no repos at all' (create/import CTAs) from 'filters match nothing' (src/components/RepoList/RepoStates.jsx:61-95); WorkBoard first-run shows a webhook checklist with a setup-guide link and a refresh CTA (src/components/WorkBoard/WorkBoardPage.jsx:78-119); an OnboardingTour is wired into App.
- Offline/degraded modes surface in the UX: retry-queue enqueue/replay toasts (src/App.jsx:353-366), OfflineBanner/PendingSyncBanner/StaleDataBadge/RateLimitNotice primitives in src/components/ui/.
- MigrationWizard gates dirty close behind ConfirmCloseModal (src/components/MigrationWizard/MigrationWizard.jsx:128-138), and GDPR erasure requires typing 'ERASE MY DATA' with loading state and post-erase re-bootstrap (src/components/Settings/DangerZoneSection.jsx:65-91, 152-163).

#### [HIGH · verified] Bulk 'Make Public/Private' silently forces every selected repo private — the label promises a choice that does not exist

- **Status:** new · **Effort:** S
- **Evidence:** src/actions/repoActions.js:472-492 — label: 'Make Public/Private', then `// TODO(visibility-target-picker): build a 2-button modal (Public / Private). For Phase 1, default to private.` and `run: ... ctx.performAction('visibility', ..., { makePublic: false })`. Surfaced as an icon-only pill in src/components/RepoList/SelectionBar.jsx:10,18 and SelectionSheet.jsx:12. The confirm copy (lines 481-486, 'Visibility changes are reversible but already-cached public links will 404 for any becoming private') never states that ALL repos will become private.
- **Impact:** A user who selects repos intending to make them public gets the opposite: everything goes private, breaking public links, badges, and Pages for downstream consumers. The action is reachable in two surfaces and the confirm dialog does not disclose the forced direction, so the only honest signal is the post-hoc toast '(N) repositories are now private'.
- **Fix:** Ship the TODO'd direction picker: open a small modal (reuse Modal + Button primitives, mirroring TransferModal's action toggle) with explicit 'Make Public' / 'Make Private' buttons, or at minimum rename the action to 'Make Private' and rewrite the confirm message to state the direction. The single-repo `visibility` action (repoActions.js:137-160) already words its confirm per-direction — match it.
- **Verification:** Verified at src/actions/repoActions.js:472-492 on current main: label 'Make Public/Private' + description promising a choice, TODO admitting the Public/Private picker was never built, and run() hardcoding makePublic:false so every selected repo is forced private. useRepos.js:191/repoMutations.js confirm makePublic is a direction flag (not a toggle), and repoActionContext.jsx shows the dispatch is confirmGate→run with no intervening picker. Confirm copy ('for any becoming private') actively implies per-repo direction and never discloses the forced outcome; the only honest signal is the post-hoc toast. Reachable from SelectionBar (icon-only pill, line 10), SelectionSheet (line 12), and the command palette. git log shows no fix landed. Partial mitigation the specialist missed: Sidebar.jsx:298-313 has honest separate Private/Public bulk buttons, and the forced direction is the conservative one (private, reversible) — but that doesn't fix the deceptive action itself, and downstream breakage (404ed public links, Pages, badges) is real until reversed. High stands: batch mutation doing the opposite of the promised choice, undisclosed at label, description, and confirm.

#### [HIGH · verified] PR review submit gives no success feedback and never refetches — Approve/Request-changes appears to do nothing

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/PRReview/PRReviewView.jsx:217-232 — doSubmit awaits submitReview, then only `dispatch({ type: 'CLEAR_PENDING_COMMENTS' })`; no toast.success, no refetch(). src/components/PRReview/hooks/useReviewData.js:79-85 confirms submitReview is a bare apiCall with no cache invalidation. Submit is also triggerable invisibly from keyboard/command-palette (PRReviewView.jsx:264, 276-278).
- **Impact:** In the flagship PR Review flow, after clicking Approve (or hitting the keyboard shortcut) the spinner clears and the screen looks identical — the new review/comments do not render until a manual reload. Users double-submit reviews or leave believing the review failed.
- **Fix:** In doSubmit, after success: `toast.success('Review submitted')` (SUCCESS_LABEL vocabulary already exists in useReviewAction.js:28-34) and call the already-returned `refetch()` so state.comments includes the submitted review. Matches the prior audit's PM-14; the fix is two lines against existing primitives.
- **Verification:** Verified at current HEAD: doSubmit (PRReviewView.jsx:217-232) awaits submitReview then only dispatches CLEAR_PENDING_COMMENTS — no toast.success, no refetch(); submitReview (useReviewData.js:79-85) is a bare apiCall and refetch runs only on mount. No mitigating layer exists: the optimistic ADD_SUBMITTED_COMMENT reducer action is never dispatched anywhere, ReviewToolbar/ReviewStatusBar have no success feedback, and the global api.js toast bus fires only on 429s. Git log shows no recent fix (only style/a11y/motion commits touched the file), and the unit test at tests/components/PRReview/PRReviewView.test.jsx:196 pins the feedback-less behavior. Keyboard/palette triggers (lines 264, 276-278) make the submit fully invisible for a plain Approve. Worse than reported: on success, pending inline comments are wiped from the diff while the submitted comments never render (no refetch), so the user's comments appear lost until manual reload — inviting double-submits. The adjacent AI Publish path in the same file has full success/queued toasts, proving this is an omission. High severity stands (not critical: the review does reach GitHub and failures are toasted).

#### [MEDIUM] Browser Back exits the app: all navigation uses replaceState, and the code comment claiming Back works is false

- **Status:** new · **Effort:** M
- **Evidence:** src/hooks/useAppRouter.js:116-120 — 'Use replaceState so each nav click doesn't pollute the history stack... the back button still works because the hash-driven sync above watches popstate too via hashchange' followed by `window.history.replaceState(...)`. Grep confirms zero pushState calls anywhere in src/. pr-review and admin-dlq views are explicitly excluded from the hash space (useAppRouter.js:112-114, App.jsx:790), so a refresh mid-review lands on the dashboard.
- **Impact:** Since replaceState never creates history entries, pressing browser Back from any drill-in (dashboard → repos → repo-detail) leaves the site entirely, losing all context — the most common navigation gesture is a trap. Refresh or share during PR review loses the review session. The in-code comment actively misleads future maintainers into thinking this works.
- **Fix:** Use pushState (or `location.hash =` assignment, which pushes) for forward navigation into detail views and keep replaceState only for tab-parameter tweaks; add a `#/review/:owner/:repo/:number` hash route for pr-review mirroring the existing parseRepoHash pattern. At minimum, correct the comment.

#### [MEDIUM] Migration wizard 'Back to Selection' CTA calls window.history.back(), which exits the app instead of changing steps

- **Status:** new · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/RepoConfigStep.jsx:249-257 — empty state renders `action={{ label: 'Back to Selection', onClick: () => window.history.back() }}`. The wizard is state-routed (goToStep/prevStep in MigrationWizard.jsx:98-123) and the app never pushes history entries, so back() navigates the browser away. The same component already receives and uses onGoToStep at line 278.
- **Impact:** A user who reaches the config step with zero selected repos clicks the only offered CTA and is thrown out of the app (or nothing happens if there is no history), destroying in-progress wizard state — a hard dead end inside the flagship migration flow.
- **Fix:** Replace with the wizard's own navigation the file already has in scope: `onClick: () => onGoToStep('repoSelect')` (or prevStep via stepCtx), matching the 'Go to Connect' button at RepoConfigStep.jsx:278.

#### [MEDIUM] Pause is a one-way door in the live migration view — no Resume control exists in ProgressStep

- **Status:** new · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/ProgressStep.jsx:413-441 — the controls row renders only Pause (disabled and relabeled 'Paused' once paused: `disabled={planStatus === 'paused'}`) and Cancel. `migrationApi.resumePlan` exists (src/api/migration.js:59) but is only wired in MigrationHistory.jsx:149-154/294. Grep of src/components/MigrationWizard finds no resume call.
- **Impact:** A user who pauses a running migration sees a disabled 'Paused' button and an active 'Cancel' — the only visible way forward is destructive. Resuming requires knowing to close the wizard, open the Migration History modal, expand the plan, and click an icon button there. Many users will cancel and restart instead.
- **Fix:** When planStatus === 'paused', swap the Pause button for a Resume button calling migrationApi.resumePlan(planId) (with toast.errorFromException on failure), mirroring the pause handler shape.

#### [MEDIUM] ProgressStep pause/cancel/initial-load failures are swallowed silently — Cancel can no-op with zero feedback, and a failed initial fetch strands the user on '0/0 tasks'

- **Status:** new · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/ProgressStep.jsx:304-317 — handleCancel: `catch { // ignore }`; lines 319-327 — handlePause: `catch { // ignore }`; lines 196-204 — initial `migrationApi.getPlan(planId).catch(() => {})` then loading=false, leaving tasks=[] and '0/0 tasks completed' (line 351-352) with no error state or retry.
- **Impact:** During a live migration — the moment users are most anxious — clicking 'Confirm Cancel' or 'Pause' can fail (network blip, expired session) and the UI gives no indication; the migration keeps running while the user believes it is cancelled. If the initial plan fetch fails, the step renders a permanently empty timeline with a 'running' status and no recovery path.
- **Fix:** Route all three catches through toast.errorFromException (the wizard already has useToast at MigrationWizard.jsx:85), and give the initial-load failure a ViewErrorFallback/EmptyState with a Retry action instead of an empty timeline.

#### [MEDIUM] MigrationHistory Re-run / Resume / Export give no feedback at all — success is silent and failure is swallowed

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/MigrationHistory.jsx:136-167 — handleRerunPlan, handleResumePlan, handleExportReport all end in `catch { /* ignore */ }` with no success toast either; list-load failure at lines 100-107 collapses to an empty plans array indistinguishable from 'no migrations'.
- **Impact:** Clicking 'Re-run' or 'Resume' on a failed migration produces no visible acknowledgment; on error nothing happens at all, so users click repeatedly (each successful Re-run silently creates another plan) or conclude the feature is broken.
- **Fix:** Add toast.success('Migration re-queued' / 'Resumed' / 'Report downloaded') and toast.errorFromException in the catches — the toast hook is already imported in this component; distinguish load errors from genuine emptiness with the shared ViewErrorFallback + retry.

#### [MEDIUM] Unsaved changes are silently destroyed on navigation: RepoDetail Settings tab and SettingsModal have dirty tracking but no close/switch guard

- **Status:** new · **Effort:** M
- **Evidence:** src/components/RepoDetail/RepoDetail.jsx:209 — `{activeTab === 'settings' && <SettingsTab .../>}` unmounts the tab on switch; SettingsTab.jsx:96-99 computes isDirty and shows 'Unsaved changes' (line 342) but nothing intercepts tab change, detail close, or hash navigation. SettingsModal.jsx:65-94 closes on Esc/backdrop with no dirty check while AIConfigSection tracks its own isDirty (AIConfigSection.jsx:128). Contrast: MigrationWizard.jsx:128-138 correctly gates dirty close via ConfirmCloseModal.
- **Impact:** Edit a repo description, click the Branches tab (or press Esc in Settings mid-AI-config edit), and the work vanishes without warning. The app demonstrably knows the form is dirty — it renders the indicator — but only the wizard acts on it, so the protection feels random.
- **Fix:** Reuse the existing dirty-close pattern: have RepoDetail consult a dirty flag (lift via onDirtyChange or a ref) and route tab/close through openConfirm('Discard unsaved changes?'); same guard in SettingsModal's onClose when any section reports dirty. The openConfirm/useDangerAction primitives make this a per-surface few-liner.

#### [MEDIUM] Dashboard MigrationActivity renders fetch errors as 'No migrations yet' and its empty state has no CTA to start one

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/Dashboard/MigrationActivity.jsx:69-78 — `.catch(() => { // degrade silently ... })` then lines 87-95 render EmptyState('No migrations yet') for both error and genuinely-zero cases, with no `action` prop despite the component already holding `openHistory`/useModal (lines 25-29) and the shared EmptyState supporting a primary CTA.
- **Impact:** A backend hiccup makes real migration history appear deleted (trust damage), and a genuinely new user hits a dashboard dead end: the copy says 'Import repositories from Azure DevOps, GitHub, or any Git URL' but offers no way to do it from where they are.
- **Fix:** Track error separately from empty (mirror WhatNeedsYouGrid's pattern) and pass `action={{ label: 'Start a migration', onClick: () => openModal('showMigrationWizard') }}` to the shared EmptyState; keep a smaller 'view history' link once stats exist.

#### [LOW] AI-suggested topics 'Not indexed yet' empty state is a dead end — tells the user to index but offers no way to do it

- **Status:** new · **Effort:** S
- **Evidence:** src/components/RepoDetail/SettingsTab.jsx:588-594 — `<EmptyState icon={Sparkles} title="Not indexed yet" description="Index this repo first to get AI-suggested topics." />` with no action prop, while an indexing surface already exists (showBatchIndex modal, src/actions/repoActions.js:462-470) and useModal is already imported in this file (line 21).
- **Impact:** Users following the AI-topics feature hit an instruction with no affordance; they must discover that indexing lives behind the repo context menu's 'Batch Index with AI', which most will not.
- **Fix:** Pass `action={{ label: 'Index this repo', onClick: () => openModalWithData('showBatchIndex', { repos: [repoData] }) }}` to the shared EmptyState — the primitive and the modal both already exist.

#### [LOW] Work Board 'Save preset' command still dead-ends in window.alert()

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/WorkBoard/WorkBoardPage.jsx:186-187 — `window.alert('Use the Presets dropdown in the filter bar to save the current filters as a preset.')` as the command-palette fallback.
- **Impact:** Invoking Save Preset from the command palette pops a native browser alert that merely tells the user to go click something else — jarring against the app's polished modal/toast system and a literal instruction-instead-of-action anti-pattern.
- **Fix:** Either invoke the same save-preset flow the filter bar uses (useWorkBoardPresets is already a hook), or replace the alert with toast.info and programmatically open/focus the Presets dropdown. Known from the 2026-06-26 audit (PM-26, premium section) and still present.


### Theme & dark-mode consistency

> Theme consistency in this codebase is unusually strong at the core: ~5k dark: variant pairs across 327/383 component files, a fully slate-unified palette (zero gray/zinc/neutral/stone hits), a real token system with a correct :root.dark swap layer, a FOUC-proof inline theme script, and a theme-threaded third-party diff pipeline. The failures are not systemic drift but localized "dark-only islands" — components authored against a dark background and shipped without light pairs (DevToolkit Review chat, MigrationWizard SizeStrategyCard/TFVC warnings, WorkBoard PingAuthorPopover, the known MigrationHistory marks UI) — plus one high-visibility miss where the AI README Enhance diff ignores the theme entirely, and a platform-level gap (no color-scheme property) that leaves all native checkboxes and date pickers light-themed in dark mode. A secondary theme is unfinished consolidation: the semantic ds-text-*/ds-surface-card utilities the design system ships have zero adoption, .ds-scrollbar has two competing definitions, and a handful of dead .dark selectors and hex status colors bypass otherwise-working token machinery.

**Already premium in this dimension:**

- Dark-variant discipline is near-total: 4,994 dark: pairs across 327 of 383 JSX files, and targeted scans for the classic failure (bg-white / text-slate-900 / border-slate-200 / bg-slate-50 without a dark: sibling) return almost exclusively intentional cases (white-on-gradient chips, toggle knobs) — e.g. border-slate-200-without-dark: count is literally zero.
- Palette is fully unified on slate: zero occurrences of gray-/zinc-/neutral-/stone- utilities anywhere in src/ — the 2026-06 slate-unification actually held.
- The token system is genuinely load-bearing: paired light/dark tokens with a correctly-specific :root.dark override block that auto-swaps status and chart-series tokens (design-system.css:174-186), and ActivityChart consumes it end-to-end — grid, axes, tooltip, cursor, and all three series via var(--ds-chart-*) (ActivityChart.jsx:96-144).
- The PR-review diff pipeline threads theme into the third-party renderer properly: DiffRenderer.jsx:133+193 passes diffViewTheme from useTheme() and both DiffPanel and CodeReviewSurface reuse that single wrapper (the one AI panel that bypassed it is finding #1).
- No flash of wrong theme: index.html:29-34 has an inline pre-React script that applies .dark from localStorage/prefers-color-scheme before first paint, and useTheme.jsx handles system-preference changes live with a stable memoized context.
- Markdown surfaces are consistently dark-ready: every prose block found carries dark:prose-invert (RepoMarkdown.jsx:55, ChatPrimitives.jsx:51), and README content is sanitized + namespaced without losing theme styling.
- Deliberate theme-static surfaces are principled, not accidental: brand logo tokens are explicitly documented 'NOT theme-aware' (design-system.css:136-146), terminal-style code blocks (bg-slate-900 + emerald text) read as terminals in both themes, and LanguageChart uses the industry-standard GitHub linguist language colors.
- Scrollbars, selection, skeletons, and focus rings all have designed dark treatments in the design system (ds-focus-ring with per-tone override + 149 adoptions; ds-skeleton token-backed; overlay scrollbar hidden on touch), and reduced-motion collapses all motion tokens globally.

#### [HIGH · verified] AI README Enhance diff renders light-themed in dark mode (DiffView missing diffViewTheme)

- **Status:** new · **Effort:** S
- **Evidence:** src/components/AI/ReadmeEnhanceDiffPanel.jsx:105-112 — `<DiffView data={...} diffViewMode={DiffModeEnum.Split} />` with no `diffViewTheme` prop (lib default is light). Contrast with the canonical wrapper src/components/PRReview/DiffPanel/DiffRenderer.jsx:133+193 which does `const { isDark } = useTheme()` → `diffViewTheme={isDark ? 'dark' : 'light'}`. The panel also imports a different global stylesheet (`@git-diff-view/react/styles/diff-view.css`, line 3) than DiffRenderer's `diff-view-pure.css` (DiffRenderer.jsx:5), shipping two variants of the lib's global CSS.
- **Impact:** Dark-mode users opening Repo Insights → AI README Enhancement get a full-width blinding white split-diff embedded in the dark modal — the single most visible theme failure in the app, on a premium AI feature.
- **Fix:** Thread the theme exactly like DiffRenderer does (`useTheme().isDark` → `diffViewTheme`), or better, render through the existing DiffRenderer abstraction (which also brings the ErrorBoundary and lazy-loaded shiki chunk) and drop the duplicate diff-view.css import.
- **Verification:** Verified every claim in the code as of HEAD: ReadmeEnhanceDiffPanel.jsx:105-112 renders DiffView with no diffViewTheme and no useTheme import; the lib is prop-driven with a hardcoded light fallback (DiffView.tsx:224/341 `data-theme={diffFile._getTheme() || "light"}`, no prefers-color-scheme detection), so the panel is always light. Canonical DiffRenderer.jsx:133+193 does pass `diffViewTheme={isDark ? 'dark' : 'light'}`, proving the deviation. No mitigation exists: app CSS (design-system.css:325-327) only affects wrapping, panel bypasses DiffRenderer, and git log shows no fix (recent commits touched error handling only). Dual global stylesheet claim also true (diff-view.css vs diff-view-pure.css). Reachable in RepoInsightsModal (lines 543/580) inside a dark modal. Cosmetic-only and behind an "Enhance with AI" click, but as a theme-consistency finding it's the worst class — full component theme inversion on a premium surface — so high stands.

#### [HIGH · verified] DevToolkit Review tab Q&A chat is illegible in light mode (dark-only bubble palette)

- **Status:** new · **Effort:** S
- **Evidence:** src/components/DevToolkit/ReviewTab/ReviewTab.jsx:162-175 — user bubble `'bg-indigo-500/10 text-indigo-300 ml-8'`, assistant/streaming bubbles `'bg-slate-800/60 text-slate-300 mr-8'` with zero `dark:` variants, inside a panel that is otherwise theme-paired (line 148 `text-slate-800 dark:text-slate-200`). Same pattern at src/components/DevToolkit/shared/SmartContextBar.jsx:53 (`bg-indigo-500/10 text-indigo-300` chips, no dark:).
- **Impact:** In light mode, indigo-300 (#a5b4fc) text on a ~10% indigo wash over white is roughly 1.6:1 contrast — the entire AI Q&A conversation is effectively unreadable; assistant bubbles are pale gray-on-gray. This is the primary interaction surface of the Review tab. (Prior audit flagged this component only for markdown rendering — PM-7 — not theming.)
- **Fix:** Pair the classes like the surrounding code: e.g. `bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300` and `bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300`. Consider reusing the theme-correct chat bubble styling already in src/components/AI/ChatPrimitives.jsx:51.
- **Verification:** Read ReviewTab.jsx:162-175 and DevToolkitPanel.jsx: bubbles use bg-indigo-500/10 text-indigo-300 and bg-slate-800/60 text-slate-300 with zero dark: variants, inside a panel whose surface is bg-white/70 in light mode (dark:bg-slate-900/95 only in dark) — no forced-dark wrapper mitigates it. Computed contrast: user bubble ~1.75:1 (indigo-300 on 10% indigo wash over white), assistant/streaming bubbles ~2.5:1 — both fail WCAG AA badly; user messages are effectively unreadable in light mode. Surrounding code in the same component is properly theme-paired (line 148), proving this is an omission, not a dark-only design. git log on src/components/DevToolkit/ shows no fix landed (recent commits are motion/button/focus-ring work). SmartContextBar.jsx:53 confirmed too, and the whole bar (rendered for all tabs) is dark-only styled over a near-white bg in light mode. High severity stands: the Q&A chat is the Review tab's primary interaction surface.

#### [MEDIUM] MigrationWizard repo-select slice has dark-only islands (SizeStrategyCard, TFVC warnings, plan badge)

- **Status:** new · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/RepoSelectStep/SizeStrategyCard.jsx:16-57 — whole component is dark-only: `border-slate-700 bg-slate-800/40`, `text-slate-100`, strategy buttons `border-indigo-500 bg-indigo-950/40 text-indigo-100` / `bg-slate-900/40 text-slate-300`, AISuggestionBanner `bg-indigo-950/30 text-indigo-100` (lines 70-76) — yet it renders inside AutoFixDrawer which IS theme-paired (AutoFixDrawer.jsx:176 `bg-slate-50 dark:bg-slate-800/40`). Also src/components/MigrationWizard/steps/RepoSelectStep.jsx:265+271 TFVC warnings `bg-amber-900/20 border-amber-700/30 text-amber-300` unconditional, and RepoConfigStep/DashboardHeader.jsx:60 `bg-violet-500/15 text-violet-300`.
- **Impact:** In light mode the migration wizard (a core paid flow) shows translucent dark cards with near-white text (~1.9:1) and an unreadable pale-amber TFVC warning that carries real information ('each folder will be converted to a Git repository'). Users on light theme can miss a consequential migration warning.
- **Fix:** Add light-mode pairs following the convention used two lines away in AutoFixDrawer.jsx:182 (`bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-200`); restyle SizeStrategyCard on the shared slate pairing (`bg-white dark:bg-slate-800/40` etc.).

#### [MEDIUM] No color-scheme property: native form controls (30 checkboxes, 4 date inputs) stay light in dark mode; checkbox styling classes are no-ops

- **Status:** new · **Effort:** S
- **Evidence:** grep for `color-scheme` across src/ + index.html returns zero style declarations (only matchMedia queries). index.css:7 loads only `@plugin "@tailwindcss/typography"` — @tailwindcss/forms is absent from package.json — so forms-plugin idioms on native checkboxes do nothing: src/components/RepoDetail/ReleasesTab.jsx:125 `rounded border-slate-300 dark:border-slate-600 text-[color:var(--ds-accent-brand)]`, src/components/diff/CodeReviewSurface.jsx:157 same + `focus:ring-indigo-500`. 30 `type="checkbox"` sites; native date/datetime inputs at Settings/AuditLogSection.jsx:132+141, Settings/ApiKeysSection.jsx:169, MigrationWizard/steps/ScheduleStep.jsx:256 (datetime-local). Only 5 sites use the working `accent-indigo-*` approach (e.g. AI/ContextPicker.jsx:83).
- **Impact:** In dark mode, checkboxes render as light-mode native controls and the datetime-local/date calendar picker popups open as bright light panels (browser derives them from color-scheme). In light mode the intended brand-colored checkboxes never materialize — checks render default browser blue instead of indigo.
- **Fix:** Add `:root { color-scheme: light } .dark { color-scheme: dark }` to index.css next to the existing layout tokens; unify checkboxes onto `accent-[color:var(--ds-accent-brand)]` (the approach already working in ContextPicker) or a shared Checkbox primitive in src/components/ui/, and delete the dead forms-plugin classes.

#### [MEDIUM] WorkBoard PingAuthorPopover is a hardcoded dark surface containing a theme-aware Textarea

- **Status:** new · **Effort:** S
- **Evidence:** src/components/WorkBoard/shared/PingAuthorPopover.jsx:101 `border-white/10 bg-slate-900` popover, :103 `text-slate-400` label, :114+122 `text-slate-400 hover:text-slate-200` buttons, :135 `<Popover.Arrow className="fill-slate-900" />` — no dark: variants anywhere, while it embeds the shared `<Textarea>` primitive (line 104) which renders light in light mode.
- **Impact:** In light mode users get a jarring dark popover with a white textarea inside it — a Frankenstein surface on the WorkBoard (which is otherwise fully theme-paired). Cancel/Edit buttons at slate-400 on slate-900 are also the intended dark styling leaking into light.
- **Fix:** Pair the surface (`bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10`) and arrow (`fill-white dark:fill-slate-900`), matching the shared Select/ContextMenu popover pattern (ui/ContextMenu.jsx:275 does this correctly with bg-white/85 dark:bg-slate-900/90).

#### [MEDIUM] Semantic color utilities shipped in the design system have zero adoption (theme changes still require ~5k callsite edits)

- **Status:** new · **Effort:** M
- **Evidence:** src/design-system.css:229-256 defines ds-text-heading/primary/secondary/muted, ds-border-subtle, ds-surface-card with documented replacement targets in the comment block ("~521 occurrences", "~200", "~144", "~94"...). grep for any of those six classes across src/**/*.{jsx,js} (excluding design-system.css) returns zero hits, while `dark:` variant occurrences total 4,994 across 327 files.
- **Impact:** The single tweak-point the utilities were built for ('shifting the muted scale a half-step... in one file instead of ~1000 callsites') doesn't exist in practice — any palette adjustment is still a mass mechanical edit with drift risk, and new code keeps minting raw slate pairs.
- **Fix:** Fold adoption into the approved 2026-06-25 layout spec's Workstream 3 anti-drift gate: migrate the noisiest surfaces mechanically (Dashboard/RepoList/Header) and add the planned eslint `no-restricted-syntax` warn on raw `text-slate-*/border-slate-*` pairs so new code prefers ds-text-*/ds-border-subtle/ds-surface-card. Alternatively, delete the utilities to stop advertising a contract nothing honors.

#### [LOW] .ds-scrollbar defined twice with conflicting behavior; the 'Smart Glass Overlay' version is dead code

- **Status:** new · **Effort:** S
- **Evidence:** src/index.css:167-220 defines .ds-scrollbar inside `@layer utilities` (hover-reveal: `scrollbar-color: transparent transparent`, thumb transparent until :hover; note line 176 uses gray-400 rgba(156,163,175) not slate). src/design-system.css:285-292 re-defines .ds-scrollbar UNLAYERED (always-visible thumb `rgba(148,163,184,.25)`). main.jsx loads index.css then design-system.css; unlayered author styles beat @layer rules, so the always-visible version wins and the hover-reveal block is dead.
- **Impact:** Containers opting into .ds-scrollbar show an always-visible thumb while every other scroll container (global rules index.css:126-149) hover-reveals — inconsistent scrollbar behavior between adjacent panels, plus ~55 lines of dead CSS inviting edits to the wrong definition.
- **Fix:** Delete the index.css @layer utilities copy (lines 166-220) and keep design-system.css as the single source; if hover-reveal is the desired premium behavior, move that variant into design-system.css instead so there is exactly one definition.

#### [LOW] Dark-mode page-scrollbar rules can never match (`.dark html` instead of `html.dark`)

- **Status:** new · **Effort:** S
- **Evidence:** src/index.css:118-120 — `.dark html:hover { scrollbar-color: rgba(255,255,255,0.2) transparent; }`, `.dark html:hover::-webkit-scrollbar-thumb {...}`, `.dark html::-webkit-scrollbar-thumb:hover {...}`. The `.dark` class lives ON the html element (useTheme.jsx:33 `root.classList.add('dark')`), so a descendant selector `.dark html` matches nothing. The internal-container equivalents at lines 144-149 correctly use `.dark *` and do apply.
- **Impact:** The page-level scrollbar keeps its light-theme colors (slate-400 alphas) in dark mode instead of the intended white alphas, so the window scrollbar visibly differs from every internal panel scrollbar in dark mode.
- **Fix:** Change the three selectors to `html.dark:hover`, `html.dark:hover::-webkit-scrollbar-thumb`, and `html.dark::-webkit-scrollbar-thumb:hover` (compound, not descendant).

#### [LOW] MigrationHistory MarksBadge/MarksDetailModal still dark-only with Portuguese strings (PL-27)

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/MigrationHistory/MarksBadge.jsx:5-23 VARIANTS unchanged (`bg-emerald-500/15 text-emerald-300 ring-emerald-500/30` etc., no dark: pairs), :34 `'Sem tags'` still Portuguese; src/components/MigrationHistory/MarksDetailModal.jsx:67 `bg-slate-900/90 border-white/10` hardcoded dark modal, :28/:31 `text-amber-300/80` / `text-rose-300/80`. Matches PL-27 in docs/reports/2026-06-26-codebase-audit-panel.md:1116-1120 verbatim — none of the tier-1 fix commits touched it.
- **Impact:** In light mode the provenance badge is pale-on-white (~1.4:1) and the marks detail modal is a dark island; two Portuguese strings persist in an all-English product being positioned for SaaS.
- **Fix:** Apply the fix already written in PL-27: translate the two strings and add light pairs (`text-emerald-700 dark:text-emerald-300` convention) to VARIANTS and the modal surface.

#### [LOW] Status/severity colors hardcoded as hex, bypassing the --ds-status-*/--ds-chart-series-* dark-swap tokens

- **Status:** new · **Effort:** S
- **Evidence:** src/components/CommunityHealthDashboard.jsx:53-56 score colors `'#10b981' / '#3b82f6' / '#f59e0b' / '#ef4444'`; src/components/WorkBoard/AISummaryCard.jsx:28 gauge `stroke = clamped > 0.7 ? '#f43f5e' : clamped > 0.3 ? '#f59e0b' : '#6366f1'`; src/components/WorkBoard/KpiRow.jsx:70 `sparkColor: '#a78bfa'` (and siblings). Meanwhile design-system.css:161-186 defines --ds-status-success/warning/danger and --ds-chart-series-1..3 that auto-swap to dark-optimized values under :root.dark — the exact job these hexes do statically.
- **Impact:** Charts/gauges keep light-calibrated saturations in dark mode (works, but visibly duller/hotter than the token-driven ActivityChart beside them), and a future brand/status recolor won't reach these surfaces.
- **Fix:** Point SVG strokes/fills at `var(--ds-status-danger)` / `var(--ds-chart-series-1)` etc. (SVG attributes accept var()), as ActivityChart.jsx:96-144 already demonstrates end-to-end.

#### [LOW] ::selection uses the light brand token in dark mode (dark counterpart exists but is never applied)

- **Status:** new · **Effort:** S
- **Evidence:** src/design-system.css:303 — single rule `::selection { background: color-mix(in srgb, var(--ds-accent-brand) 25%, transparent); }`. `--ds-accent-brand` (#4f46e5) is not among the tokens re-pointed in the :root.dark block (lines 174-186), and there is no `.dark ::selection` override, unlike every other paired token surface.
- **Impact:** Text selection in dark mode uses the light-theme indigo-600 tint instead of the defined `--ds-accent-brand-dark` (indigo-400) — a subtle token-contract break; selection reads dimmer/muddier on dark surfaces.
- **Fix:** Add `:root.dark ::selection { background: color-mix(in srgb, var(--ds-accent-brand-dark) 25%, transparent); }` next to the existing dark token block.

#### [LOW] Hover states darken text in dark mode (inverted affordance) on 2 utility controls

- **Status:** new · **Effort:** S
- **Evidence:** src/components/Settings/AzureCredentialsSection.jsx:524 — PAT show/hide eye button `text-slate-400 hover:text-slate-600` with no dark:hover, inside an input that IS dark-aware (line 516 `dark:bg-slate-800`): hovering in dark mode turns the icon slate-600 on slate-800 (near-invisible). src/components/AI/ContextPicker.jsx:128 — Reset button `text-slate-500 hover:text-slate-700`, same inversion; sibling label line 122 `text-slate-500` also unpaired.
- **Impact:** Interactive affordances get LESS visible on hover in dark mode — the opposite of the feedback hover is supposed to give; the PAT eye toggle nearly disappears exactly when the user reaches for it.
- **Fix:** Pair them (`hover:text-slate-600 dark:hover:text-slate-300`), or adopt the ds-text-secondary/hover convention used by VersionHistory.jsx:40 which pairs both directions correctly.

#### [LOW] Raw focus:ring-indigo-500 sites don't swap to the dark brand ring (bypass ds-focus-ring)

- **Status:** new · **Effort:** S
- **Evidence:** 22 raw sites: `focus:ring-indigo-500` x16, `focus:ring-emerald-500` x4, `focus:ring-amber-500` x2 (e.g. src/components/diff/CodeReviewSurface.jsx:157), vs 149 adoptions of the token-backed `.ds-focus-ring` (design-system.css:259-268) which swaps outline to `--ds-focus-ring-color-dark` under .dark and supports per-tone override via `--ds-focus-ring-color`.
- **Impact:** Focus indication is inconsistent across themes: most controls show the indigo-400 dark-calibrated ring, while these 22 keep indigo-500 (dimmer on dark surfaces) and a different ring geometry — visible to keyboard users tabbing across a form.
- **Fix:** Migrate the 22 raw sites to `ds-focus-ring` (tone overrides cover the emerald/amber cases via `--ds-focus-ring-color`), and add the class to the planned Workstream-3 lint gate so new raw rings don't accrue.


### Data display uniformity

> Data display uniformity is mid-tier: a genuinely good canonical formatter module (src/utils/format.js) covers numbers, bytes, durations and relative time, and count/star/fork rendering is consistently routed through it — but date/time display has fractured into at least nine competing relative-time implementations with five different output vocabularies, and the canonical path silently mis-parses the server's naive-UTC SQLite timestamps as local time (two leaf components hand-patch it with +'Z', the shared util does not), corrupting every migration timestamp and the live elapsed timers by the user's UTC offset. The migration domain also ships a 'complete' vs 'completed' status-vocabulary split that makes bulk-mirrored jobs render as "Pending" and drop out of dashboard counts, and two Portuguese strings still render in the MigrationHistory marks UI because the anti-PT guard's word list cannot see accent-free PT words.

**Already premium in this dimension:**

- Canonical formatter module exists and is well designed: src/utils/format.js defines APP_LOCALE='en-US' with an explicit written policy (lines 7-11), plus null-safe formatNumber/formatCompact/formatPercentage/formatFileSize/formatDate/formatDateTime/formatDurationSeconds/formatTimeUntil/formatRelativeTime (lines 28-240) — every formatter returns a safe fallback for null/NaN input.
- Count display is genuinely uniform: RepoCard.jsx:212-221, OrgPanel.jsx:274-297, Dashboard/OrganizationCard.jsx:84-96 and Dashboard/StatCard.jsx:38 all route star/fork/issue counts through formatCompact/formatNumber, so '1.2K stars' renders identically across repo list, org panel and dashboard stat tiles.
- The dashboard's primary attention surfaces share one relative-time vocabulary: AttentionFeed.jsx:260, Premium/InboxRow.jsx:9, Header.jsx:608/700 and MigrationActivity.jsx:152 all import formatRelativeTime from utils/format, so the main screen speaks one '2h ago' dialect.
- The em-dash '—' is already the de-facto empty-value placeholder across data tables (Admin/DLQTable.jsx:21,31,112-124; Settings/AuditLogSection.jsx:44,215-221; ConflictPanel.jsx:18-68; WorkBoard/tabs/DORATab.jsx:40-143; WorkBoard/shared/formatters.js:6-19) — near-uniform, with only a few 'N/A' outliers left.
- A real anti-Portuguese build gate exists (tests/build/no-portuguese-ui.test.js) scanning all of src/components, src/utils, src/hooks, src/api plus App.jsx/main.jsx with comment-stripping and both accent and word-list detection — a regression guard most codebases lack.
- Several Settings components correctly wrap the shared base formatters instead of reimplementing (ApiKeysSection.jsx:30-33, LicensePlanSection.jsx:48-50, AuditLogSection.jsx:43-45, ConflictPanel.jsx:17-18 all delegate to formatDate/formatDateTime from utils/format), showing the consolidation pattern already in use.

#### [HIGH · verified] Naive-UTC SQLite timestamps are parsed as local time by the shared date utilities — migration times, audit-log times and live elapsed timers are wrong by the user's UTC offset

- **Status:** new · **Effort:** M
- **Evidence:** Server stores naive UTC: server/migrations/001-initial-schema.sql:177 `started_at TEXT DEFAULT CURRENT_TIMESTAMP`; server/migration-engine.js:347-348 writes `completed_at = datetime(?)` with `new Date().toISOString()` (SQLite datetime() emits 'YYYY-MM-DD HH:MM:SS' UTC, no Z). These reach the client raw: server/routes/import/status.js:117-118 `startedAt: j.started_at`; server/routes/migration.js:164-166,195-198 pass row.started_at/completed_at/created_at through untouched. The client parses them as LOCAL time: src/utils/format.js:219 `const then = new Date(date)` (no UTC normalization), src/hooks/useElapsedSeconds.js:16 `new Date(startedAt).getTime()`, src/components/MigrationHistory.jsx:277 and :386 `new Date(job.startedAt).toLocaleString()`, src/components/Dashboard/MigrationActivity.jsx:152 `formatRelativeTime(job.completedAt || job.startedAt)`, src/components/Settings/AuditLogSection.jsx:43-45 via shared formatDateTime. The codebase already knows about this: src/components/ui/StaleDataBadge.jsx:6-7 comments "Server emits 'YYYY-MM-DD HH:MM:SS' UTC — append 'Z' so JS parses it as UTC" and patches it locally, as does Settings/AIConfig/CurrentConfigSummary.jsx:22 (`iso.endsWith('Z') ? iso : iso + 'Z'`) — the fix exists in two leaf components but not in the shared utilities everyone else uses.
- **Impact:** For the Portugal-based owner in summer (UTC+1): a migration that finished seconds ago shows '1h ago' on the dashboard, MigrationHistory shows completion times one hour early, and the live migration progress timer (ProgressStep.jsx:63-68 via useElapsedSeconds) starts at '1h 0m' for a just-started task. Users west of UTC see relative times stuck at 'just now' and elapsed timers clamped to 0s (Math.max(0,...) in useElapsedSeconds.js:19) for hours. Every DB-sourced timestamp surface (migrations, audit log, work-board discovery) is affected; GitHub-API timestamps (with Z) are fine, so the app shows a mix of correct and offset times side by side.
- **Fix:** Add a `parseServerTimestamp(value)` to src/utils/format.js that detects the naive 'YYYY-MM-DD HH:MM:SS' shape and appends 'Z' (exactly what StaleDataBadge.jsx:7 already does), then route formatRelativeTime, formatDate, formatDateTime, useElapsedSeconds and useRelativeTime through it; delete the two leaf-level +'Z' hacks. Alternatively normalize at the API boundary (formatPlanForApi/formatTaskForApi and import/status.js) to emit real ISO-8601 with Z.
- **Verification:** Verified every cited line as it exists today. Server stores naive UTC everywhere: schema DEFAULT CURRENT_TIMESTAMP (001-initial-schema.sql:177, import inserts never set started_at), datetime('now') on all import completions, migration-engine.js:337/347/361 datetime(?) which strips the Z, and lib/audit.js:59 explicitly strips T and Z from toISOString(). Routes (import/status.js:117-118, migration.js formatPlanForApi/formatTaskForApi:164-166,195-198) pass rows through raw; no normalizing middleware exists. Shared client utils parse as local: format.js:219 and :152 bare new Date(), useElapsedSeconds.js:16-19 with Math.max(0) clamp; consumers MigrationHistory.jsx:277/386, MigrationActivity.jsx:152, AuditLogSection.jsx:43-45, ProgressStep.jsx:63 all confirmed. No fix in the last 30 commits; instead FOUR leaf components (StaleDataBadge, CurrentConfigSummary, DLQTable:24, DLQDetailPanel:23 — two more than the specialist cited) patch it locally with +'Z', proving the bug is known but the shared layer unpatched. Impact math is correct: UTC+1 owner sees times 1h early and live timers starting at ~1h; west-of-UTC users get timers clamped to 0s and 'just now' for hours (seconds<0 branch). Only mitigation found: the duration subtraction at MigrationHistory.jsx:388 cancels the offset, which the finding never claimed was broken. Display-only, but it breaks the live progress timer on the core migration flow, skews the audit log, and shows inconsistent times beside correct GitHub-API timestamps — high stands.

#### [MEDIUM · verified] Migration status vocabulary split 'complete' vs 'completed' in the same table — bulk-mirrored jobs render as 'Pending' and vanish from dashboard completed counts

- **Status:** new · **Effort:** S · reported high, calibrated to medium
- **Evidence:** Legacy migration_jobs pipeline writes 'complete' (server/routes/import/url.js:105, azure/git.js:96,240, azure/tfvc.js:264,709) and the stats endpoint counts only that spelling: server/routes/import/status.js:93 `WHERE ... status = 'complete'`. But server/routes/bulk.js:220 inserts into the SAME migration_jobs table with `'completed'`. Frontend: src/components/Dashboard/MigrationActivity.jsx:12-17 STATUS_CONFIG has keys complete/failed/running/pending only, and line 119 falls back `STATUS_CONFIG[job.status] || STATUS_CONFIG.pending` — so a 'completed' bulk-mirror job renders with the amber 'Pending' clock. MigrationHistory.jsx:207 filter chips `['all','complete','running','failed']` can never select it, and MigrationHistory.jsx:52-53 carries BOTH `complete:` and `completed:` style keys, acknowledging the split. The new migration engine uses 'completed' everywhere (server/migration-engine.js:347,434). UI labels also diverge: dashboard shows 'Completed' (STATUS_CONFIG label) while MigrationHistory.jsx:275,385 renders the raw status with `capitalize` → 'Complete' or 'Completed' depending on which writer created the row.
- **Impact:** A user who bulk-mirrors repos sees them stuck as 'Pending' forever in the dashboard's Recent Activity, the 'Completed' stat undercounts, and the history modal's 'complete' filter hides them — the feature looks broken even though the mirror succeeded. The same terminal state is displayed under two different names across dashboard vs history.
- **Fix:** Normalize at the write site: change server/routes/bulk.js:220 to 'complete' to match the migration_jobs vocabulary (the table's other writers and the stats query are the SoT), or add a schema-migration UPDATE to unify existing rows. Then export one shared STATUS_LABELS map (e.g. src/components/MigrationShared or alongside STATUS_CONFIG) consumed by both MigrationActivity and MigrationHistory so 'complete' always displays as 'Completed'.
- **Verification:** Verified every citation against current code: bulk.js:220 inserts 'completed' into migration_jobs while the legacy pipeline (url.js:105, azure/git.js:96,240, tfvc.js:264,709, _shared.js:4) writes 'complete'; stats endpoint status.js:93 counts only 'complete' so bulk mirrors inflate Total but never Successful; MigrationActivity.jsx:119 falls back 'completed' → STATUS_CONFIG.pending (amber 'Pending' forever on the dashboard); MigrationHistory.jsx:176+207 exact-match filter chips can never select 'completed' rows; lines 52-53 carry both style keys and 275/385 render the raw status capitalized, so the same terminal state displays as 'Complete', 'Completed', or 'Pending' depending on surface. No fix exists: git log (recent + --grep), db.js, lib/db-migrations.js, and migrations/*.sql show no status normalization, and all endpoints return raw j.status. Downgraded high → medium: display/reporting-only defect on the Pro-gated bulk-mirror path — the mirror succeeds, no data loss, rows are safe from the interrupted-jobs sweep (index.js:378 touches only running/pending), and the history modal still shows a green badge under the 'all' filter; the misleading state is real and permanent but purely presentational.

#### [MEDIUM] Nine divergent relative-time implementations with five different output vocabularies ('3h ago' / '3 h ago' / '3 hr ago' / '3 hours ago' / '3h')

- **Status:** new · **Effort:** M
- **Evidence:** Canonical: src/utils/format.js:215 → '3h ago'/'2d ago'. Divergent copies actually rendered to users: src/hooks/useRelativeTime.js:12-24 → '3 h ago', caps at days ('400 d ago', never years; used by Header.jsx:740, DashboardHero.jsx:51, TodayPanel, HeroSyncChip, WorkBoardPage.jsx:222, StatusPage, ProbeStatsSection); src/components/WorkBoard/AISummaryCard.jsx:40-47 → '2 hr ago', caps at HOURS so 3 days renders '72 hr ago'; src/components/RepoDetail/CommitsTab.jsx:14-25 → '3 h ago' then absolute date after 30d; src/components/Sidebar.jsx:567-580 getTimeAgo → '3h ago' but `interval > 1` off-by-one at unit boundaries; src/components/MigrationWizard/ui/repo/RepoMetaBadges.jsx:4-18 → '3h' (no 'ago'); src/components/Settings/AzureCredentialsSection.jsx:617-628 → 'used today'/'used 5d ago'; src/components/MigrationWizard/steps/SourceStep/SavedCredentialsPicker.jsx:171-180 → 'today'/'1+ years ago'; src/components/Settings/AIConfig/CurrentConfigSummary.jsx:20-35 → '2 hours ago' long-form; src/components/ui/StaleDataBadge.jsx:4-14 → '3 h ago'. On the WorkBoard page the header shows '3 h ago' (useRelativeTime) while AISummaryCard on the same screen shows '2 hr ago' for the same kind of freshness data.
- **Impact:** The same 'how old is this' datum is spoken in five dialects, sometimes on one screen; the AISummaryCard hour-cap ('72 hr ago') and useRelativeTime day-cap ('400 d ago') read as bugs. Any fix (like the UTC bug above) must be re-applied in nine places.
- **Fix:** Consolidate on formatRelativeTime from src/utils/format.js: make useRelativeTime.js's internal format() delegate to it (keeping only the 15s ticking wrapper), and replace the seven component-local formatters with imports; keep RepoMetaBadges' compact no-'ago' variant only if given an explicit option (e.g. formatRelativeTime(date, { suffix: false })).

#### [MEDIUM] Sibling RepoDetail tabs render the same timestamp column with different conventions: absolute locale dates in Issues/PRs/Releases lists, relative in Branches list and all detail panels

- **Status:** new · **Effort:** S
- **Evidence:** src/components/RepoDetail/IssuesTab.jsx:234 `new Date(issue.created_at).toLocaleDateString()` and PullRequestsTab.jsx:310 and ReleasesTab.jsx:161 render absolute dates ('7/5/2026' — or '05/07/2026' in a pt-PT browser), while BranchesTab.jsx:239 uses `formatRelativeTime(b.commit.author.date)` ('2h ago') for the equivalent last-activity column. One click deeper everything is relative: IssueDetailPanel.jsx:140,254, PRDetailPanel.jsx:217,373,473, CommitDetailPanel.jsx:68 all use formatRelativeTime — so an issue row says '7/5/2026' and its detail panel says '2h ago' for the same created_at field. CommitsTab.jsx:14-25 is a third hybrid (relative under 30d, absolute after).
- **Impact:** Users scanning across the six repo-detail tabs get three different date presentations for the same class of data, and the list→detail transition re-labels the identical timestamp; absolute toLocaleDateString also renders in the browser locale (day-first vs month-first) inside an otherwise English UI.
- **Fix:** Standardize list rows on formatRelativeTime (matching BranchesTab, the detail panels, and GitHub's own convention), with the absolute formatDate value in a title attribute for hover precision; this removes the toLocaleDateString call sites in IssuesTab/PullRequestsTab/ReleasesTab/CommitsTab.

#### [MEDIUM] Live Portuguese copy still renders in the MigrationHistory marks UI — invisible to the anti-PT guard because the words are accent-free and not in PT_WORDS

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/MigrationHistory/MarksDetailModal.jsx:20 renders `— nada escrito` (user-visible empty state in the marks detail dialog) and src/components/MigrationHistory/MarksBadge.jsx:34 renders `'Sem tags'` (badge text shown in the migration history list). Both files are inside the guard's scanned ROOTS (tests/build/no-portuguese-ui.test.js:23-28 includes src/components), but the guard's PT_ACCENTS regex (line 32) sees no accented chars in these strings and PT_WORDS (lines 38-74) contains none of 'nada', 'escrito', 'sem' — so the gate passes green while PT ships.
- **Impact:** English-only UI promise is broken on a shipped premium feature (Migration Tagging): every user opening migration marks sees Portuguese, and the CI guard that exists specifically to prevent this reports clean, giving false confidence.
- **Fix:** Translate the two strings ('— nothing written', 'No tags') and add 'nada', 'escrito', and a word-boundary 'sem' to PT_WORDS in tests/build/no-portuguese-ui.test.js so the guard actually covers the words that slipped through.

#### [MEDIUM] Same migration duration renders as '40m' during the run but '2400s' in MigrationHistory — formatDurationSeconds exists but history bypasses it

- **Status:** new · **Effort:** S
- **Evidence:** src/utils/format.js:171 formatDurationSeconds exists precisely for this (its own doc comment says it fixes 'the misleading 61m 52s the old per-step formatters produced') and src/components/MigrationWizard/steps/ProgressStep.jsx:68 uses it for live/final task durations. But src/components/MigrationHistory.jsx:344 renders task duration as raw `{duration}s` (computed at lines 333-335) and line 388 renders legacy job duration as `{Math.round((new Date(job.completedAt) - new Date(job.startedAt)) / 1000)}s` — a 40-minute task shows '2400s'.
- **Impact:** The identical task duration is human-readable while the migration runs and machine-readable ('2400s') the moment the user opens history — reads as unfinished and forces mental arithmetic on the surface where users review long migrations.
- **Fix:** Import formatDurationSeconds in MigrationHistory.jsx and wrap both duration call sites (lines 344 and 388); the subtraction itself is timezone-safe so only the rendering changes.

#### [MEDIUM] Missing-value placeholder split: 'N/A' vs '—' for the same missing-data class, including within the same Settings surface

- **Status:** new · **Effort:** S
- **Evidence:** 'N/A' sites: src/components/RepoDetail/OverviewTab.jsx:175,179 (missing created/updated dates), RepoDetail/SettingsTab.jsx:398 (missing webhook URL), Settings/LicensePlanSection.jsx:49-50 (missing license dates). '—' sites for the same class: Settings/AuditLogSection.jsx:44-45 (missing dates), Admin/DLQTable.jsx:21,31,112-124, ConflictPanel.jsx:18,56-68, WorkBoard/tabs/DORATab.jsx:40-143, WorkBoard/shared/formatters.js:6-19, MigrationWizard ProviderBadge.jsx:29. LicensePlanSection ('N/A') and AuditLogSection ('—') are both Settings sections a user scrolls between.
- **Impact:** Users see two different 'no data' symbols for identical situations (a missing date) depending on which panel they're in; 'N/A' also reads as 'not applicable' when the truth is 'unknown/absent', which matters on license expiry and repo metadata.
- **Fix:** Standardize on '—' (already the ~80% majority) — e.g. a shared EMPTY_VALUE constant or making the formatDate/formatDateTime wrappers default their empty fallback to '—' — and convert the four 'N/A' call sites.

#### [LOW] Four hand-rolled KB-only byte formatters never roll to MB, diverging from the canonical formatFileSize ('5120.0 KB' vs '5 MB')

- **Status:** known-open · **Effort:** S
- **Evidence:** Canonical src/utils/format.js:111 formatFileSize rolls Bytes→PB with a space ('1.25 MB'). Hand-rolled KB-only: src/components/AI/PremiumRationale.jsx:12 `${(bytes/1024).toFixed(1)}KB` (no space), AI/FileTreePicker.jsx:11 and AI/ContextPicker.jsx:30 `${(bytes/1024).toFixed(1)} KB`, CommunityHealthDashboard.jsx:387 `(size/1024).toFixed(1)} KB` — none roll units, so a 5 MB file renders '5120.0 KB'. Meanwhile MigrationWizard RepoMetaBadges.jsx:42 correctly uses formatFileSize for repo sizes.
- **Impact:** File sizes read in different notations across AI context pickers vs migration wizard vs repo settings, and large files display absurd KB values in the AI pickers where users judge context cost.
- **Fix:** Replace the four local formatters with formatFileSize(bytes, 1) from src/utils/format.js — this is the same consolidation the 2026-06-26 audit's DL-15 proposed (its shared-formatBytes half was not applied in the tier-1 fix batch; only the source-badge/SafeMarkdown parts landed in 008c3a2).

#### [LOW] Locale policy is split: numbers deliberately pinned to en-US while dates float with the browser locale, producing mixed-locale screens

- **Status:** new · **Effort:** S
- **Evidence:** src/utils/format.js:7-11 documents 'The UI ships in English so numbers render in en-US style (1,234 / 1.23M)' and pins APP_LOCALE='en-US' for formatNumber/formatCompact. But formatDate (format.js:138) calls `d.toLocaleDateString(undefined, options)` and formatDateTime (line 155) `d.toLocaleString()` — browser locale — as do the bare call sites (RepoDetail/IssuesTab.jsx:234, PullRequestsTab.jsx:310, ReleasesTab.jsx:161, ActionsTab.jsx:152, MigrationHistory.jsx:277,386, CurrentConfigSummary.jsx:34).
- **Impact:** A pt-PT browser (the owner's likely default) shows '05/07/2026' day-first dates and '14:30' times embedded in English sentences next to en-US-formatted numbers — the app speaks two locales on one screen, and date order is ambiguous for the many locales where it differs from en-US.
- **Fix:** Pick one policy and encode it where APP_LOCALE already lives: either pass APP_LOCALE into formatDate/formatDateTime (fully-English UI, consistent with the numbers rationale) or switch formatNumber's default to undefined (fully browser-local). The single-module change covers every wrapper that already delegates to format.js.

#### [LOW] Server-side AI prompts embed Portuguese-only canonical examples — a PT leakage channel the anti-PT guard cannot see (scope is src/ only)

- **Status:** new · **Effort:** S
- **Evidence:** server/lib/ai-chat-prompt.js:85-86 gives the assistant its two concrete answer templates only in Portuguese ('Esta acção ainda não está integrada…', 'Vai ao detalhe do repo → tab Settings…'); rule 3 (line 87) says to match the user's language, but the only phrasing exemplars are PT. server/lib/ai-prompt-registry.js:72 few-shot example returns its user-visible 'rationale' field in Portuguese ('Mantive o nome existente…') and the rationale rules (lines 61-62) never state an output language — the rationale is rendered in the suggest-name confirmation dialog. The guard (tests/build/no-portuguese-ui.test.js:23-28) scans only src/, so server prompt text is permanently out of scope.
- **Impact:** Probabilistic Portuguese leakage into the English UI through AI responses: English-speaking users can receive PT-flavored chat guidance or a PT rationale in the rename/describe confirmation dialog, and no gate will ever catch it because the strings live in server/.
- **Fix:** Add English versions of the exemplar sentences in ai-chat-prompt.js (keep the PT ones as the language-matching illustration, explicitly labeled), state 'rationale is always English' in ai-prompt-registry.js rule 62 (description language stays source-matched per rule 58), and cover both via the existing chat golden eval (server/evals) rather than widening the src-only lint guard.


### Data hygiene & lifecycle (backend/DB)

> Data lifecycle is half-built to a high standard: FKs are enforced (PRAGMA foreign_keys=ON), a real versioned migration ledger exists, stranded migration jobs are recovered on startup, and sessions/work-board caches/KPI snapshots/migration credentials all have working TTL janitors. But the janitorial story stops there: four purge functions (BYOK retention, gh_cache, gh_outbox, undo-log) are written and tested yet never scheduled, all five GitHub event tables grow forever with no retention path, and the GDPR erasure route — while fixed for the two tables flagged in the 2026-06-20 audit — silently misses ~15 newer user-scoped tables including encrypted Azure PATs and AI chat transcripts, because the tombstone design means ON DELETE CASCADE never fires. Two dead tables and a stale third copy of the schema round out the drift.

**Already premium in this dimension:**

- Foreign-key enforcement is actually ON (server/lib/adapters/sqlite-adapter.js:77 `this._db.pragma('foreign_keys = ON')`) plus WAL + busy_timeout; nearly every user-scoped table declares FK ... ON DELETE CASCADE.
- Real versioned migration framework with idempotent up()s and a schema_migrations ledger (server/lib/db-migrations.js:36-467) — 25 ordered migrations, addColumnIfMissing instead of brittle try/catch ALTERs.
- Stranded-job recovery is now solved end-to-end: startup resets orphaned migration plans via migrationEngine.recoverInterruptedPlans() and marks orphaned import jobs 'interrupted' (server/index.js:360-383); graceful shutdown mirrors it (index.js:406-424). The 2026-06-20 'stranded jobs' finding is fixed.
- Working TTL janitors where wired: expired sessions purged every 15 min (server/lib/session-store.js:75-92), work-board cache+snooze sweeper every 10 min and KPI snapshots pruned at 90 days (server/lib/work-board-sweeper.js:19-81), migration credentials auto-purged with 48h grace on an hourly timer (server/lib/migration-credential-manager.js:83-113, started at migration-engine.js:42).
- Tamper-evident audit trail: audit_log_v2 has a hash chain, append-only UPDATE/DELETE-rejecting triggers (db-migrations.js:63-84) and a verifyAuditChain() walker (server/lib/audit.js:179-219).
- GDPR plumbing exists and improved: transactional self-service erasure + capped JSON export (server/routes/user-data.js:39-285); both specific gaps from the 2026-06-20 audit (dashboard_inbox_state, repo_assignments.assigned_by) are now deleted in the wipe (user-data.js:223-231).
- Stripe webhook idempotency ledger with rollback on async failure (server/routes/stripe-webhooks.js:70-101).
- Frontend localStorage writes are consistently quota-safe (try/catch around setItem, e.g. src/hooks/useDraftPersistence.js:38-46) and PR-review drafts have a 30-day TTL cleaner (src/components/PRReview/hooks/useReviewState.js:25-45).
- Mock seeding is idempotent and explicitly gated (server/db.js:763-767 skips if teams exist; server/index.js:65 requires config.mockMode === 'true').

#### [CRITICAL · verified · 2nd-opinion] GDPR erasure misses ~15 newer user-scoped tables — encrypted Azure PATs, AI chat transcripts and outbox bodies survive 'ERASE MY DATA'

- **Status:** new · **Effort:** M
- **Evidence:** server/routes/user-data.js:149-243 wipes exactly 15 enumerated tables (user_ai_config, migration_jobs/plans, pr/issue events, review_assignments, community_health_cache, repo_metadata, repo_embeddings, workflow_runs/meta, usage_metrics, api_keys, user_subscriptions, team_members, dashboard_inbox_state, repo_assignments) then only TOMBSTONES the users row (line 236-243: `UPDATE users SET email=NULL ... deleted_at=CURRENT_TIMESTAMP`). Because the row is never DELETEd, every `ON DELETE CASCADE` (e.g. user_azure_credentials at db-migrations.js:416, ai_pr_chat_messages at db.js:548, gh_outbox at db-migrations.js:327, work_board_* at db.js:569-626) never fires. Not covered by the wipe: user_azure_credentials (encrypted PATs, db-migrations.js:404-421; only per-row delete exists at lib/azure-credentials-manager.js:173), ai_pr_chat_messages (user-authored chat content, db.js:532-550), ai_pr_reviews / ai_pr_commands (db.js:462-528), user_ai_prompts (db.js:445-455), ai_review_prompts (db.js:488-507), gh_outbox request bodies (db-migrations.js:311-335), gh_cache payloads (db-migrations.js:288-305), ai_spend + work_board_ai_spend, work_board_tracked_repos/prefs/ai_dismissed/undo_log/cache/snooze/presets/kpi_snapshots (db.js:557-630, db-migrations.js:133-275). The GET /export (user-data.js:66-90) omits the same tables, so Article 20 portability is equally partial.
- **Impact:** The route is explicitly labeled 'GDPR Article 17 / SOC 2 CC6.5' (user-data.js:2) yet after erasure the operator still holds the user's encrypted Azure DevOps PATs, full AI chat transcripts, drafted PR comments in the outbox, and behavioral tracking data. That is a compliance violation with real legal exposure, and a trust failure for the user who clicked ERASE MY DATA.
- **Fix:** Extend the existing wipe transaction (user-data.js:149) with DELETEs for every table above (same pattern as steps 1-14), keyed by user_id — the schema already indexes them by user. Add a regression test in server/__tests__/ that walks sqlite_master for tables with a user_id column and asserts each is either wiped or on an explicit allowlist (billing/audit records with a documented retention basis), so future migrations can never silently reopen the gap. Update the export to match.
- **Verification:** Read user-data.js in full: the DELETE handler wipes exactly the 15 enumerated tables then only UPDATE-tombstones the users row (lines 236-243), and no production code ever DELETEs from users, so every ON DELETE CASCADE is dead code. Verified each missed table exists with the claimed schema and PII: user_azure_credentials.pat_encrypted (db-migrations.js:404-421), ai_pr_chat_messages.content (db.js:532-550), ai_pr_reviews/ai_pr_commands/user_ai_prompts/ai_review_prompts (db.js:445-528), gh_outbox body/response_body (db-migrations.js:311-335), gh_cache payload (288-305), work_board_* + ai_spend (db.js:557-630). Grepped all DELETE statements on these tables: only per-row user actions, TTL prunes, and test cleanup — no account-level wipe, wrapper, or job. GET /export (user-data.js:66-90) omits the same tables, so Article 20 export is equally partial. Not fixed by recent commits: the last change to user-data.js (5d242b8) is what added tables 13-14; the 2026-06-26 audit batch never touched it. Critical is fair: the route claims GDPR Art. 17 / SOC 2 CC6.5 and returns success while the operator retains live encrypted Azure PATs, full AI chat transcripts, and drafted PR bodies — a falsely-confirmed erasure with retained credentials.
- **Second opinion (severity calibration):** Re-read user-data.js in full plus every cited schema. Facts hold: the DELETE handler wipes only the enumerated tables then UPDATE-tombstones users (lines 236-243); no production DELETE FROM users exists, so all ON DELETE CASCADE clauses (user_azure_credentials, ai_pr_chat_messages, gh_outbox, work_board_*, etc.) are unreachable; only per-row/TTL deletes exist for the missed tables; GET /export omits the same set. Severity lens: mitigations are real but insufficient — PAT encryption is server-side-decryptable, TTL prunes clear only succeeded outbox rows (24h) and work-board cache/undo/snooze, while credentials, full AI chat transcripts, review drafts, prompts, and behavioral tracking persist indefinitely, and failed outbox rows with request bodies are kept forever by design. No tier gate or config narrows exposure (plain requireAuth), the data subject has no workaround or detection path, and the route returns 200 with a `deleted` map under an explicit "GDPR Article 17 / SOC 2 CC6.5" claim — a falsely-confirmed erasure. Product ships subscriptions/teams/enterprise tiers, so multi-user deployments are intended; retained live third-party credentials after "ERASE MY DATA" plus false compliance evidence squarely meets the legal-exposure bar. Critical stands.

#### [MEDIUM · verified] Four written-and-tested purge jobs are never scheduled — the 365-day BYOK retention promise emailed to users never actually runs

- **Status:** new · **Effort:** S · reported high, calibrated to medium
- **Evidence:** runRetentionPass (server/lib/retention.js:104) is invoked ONLY by the manual CLI script server/scripts/retention.js:23 (package.json:55 `retention:run`); server/index.js:343-358 starts the work-board sweeper, KPI job, email/webhook retry workers and gh-outbox worker but never the retention pass, and .github/ has no cron (only artifact `retention-days` in ci.yml:121). The warning email it sends promises 'credentials unused for 365 days are automatically deleted' (retention.js:29). Likewise unwired: gh-cache purgeOlderThan (lib/gh-cache.js:190, docstring 'Schedule from a long-interval timer in the main server' — zero callers), gh-outbox purgeOldSucceeded (lib/gh-outbox.js:348 — zero callers, so succeeded mutation rows with request bodies live forever), and work_board_undo_log cleanupExpired (lib/work-board-undo-log.js:83, docstring 'Called by nightly cron' — only tests call it; the sweeper at work-board-sweeper.js:19-30 purges cache+snooze but not the undo log). The Stripe webhook_events idempotency ledger (db.js:379-387) also has no pruning — its only DELETE is the failure rollback at stripe-webhooks.js:99.
- **Impact:** Users receive an email stating their credentials will be automatically deleted on a specific date, and the deletion never happens unless an operator remembers to run `npm run retention:run` (which docs/operations.md never mentions). gh_cache/gh_outbox/undo_log/webhook_events grow without bound — stale GitHub payload blobs and user-authored mutation bodies accumulate in manager.db forever.
- **Fix:** Wire all four into the existing scheduler pattern in server/index.js: add a daily interval alongside startWorkBoardSweeper()/startKpiSnapshotJob() that calls runRetentionPass(), purgeOlderThan(30), purgeOldSucceeded(), cleanupExpired(), and a `DELETE FROM webhook_events WHERE processed_at < now-30d`. Reuse the work-board-sweeper.js start/stop/unref shape so shutdown handling is uniform.
- **Verification:** Verified every citation in current code: runRetentionPass (retention.js:104) is called only by the CLI script (scripts/retention.js:23, package.json:55); index.js:343-358 starts five other in-process workers but no retention; gh-cache.purgeOlderThan (:190), gh-outbox.purgeOldSucceeded (:348), and work-board-undo-log.cleanupExpired (:83) each have zero non-test callers despite docstrings promising server-timer/nightly-cron scheduling; the sweeper covers only cache+snooze+KPI; webhook_events' sole DELETE is the stripe-webhooks.js:99 rollback. No fix in git log through 2026-07-05, no cron in workflows/Dockerfile/compose. HOWEVER the specialist missed docs/security-hardening.md §"Scheduling via cron" (lines 249-286), which explicitly instructs operators to run `npm run retention:run` daily via crontab/K8s CronJob with concrete examples — the BYOK pass is a documented deploy-time requirement, not silently absent. And since the warning email is sent by the same pass, the "email promises deletion that never happens" scenario only occurs if the pass runs once then stops, narrower than claimed. What fully stands: the other three purges + webhook_events have no scheduling and no documented operator hook anywhere, so gh_outbox request bodies, undo-log snapshots, webhook ledger rows, and stale gh_cache blobs grow without bound, contradicting the modules' own docstrings. Real finding, but the high-severity half is mitigated by documentation, leaving unbounded-growth hygiene → medium. Cheap fix: wire the four purges into index.js alongside the existing workers and cross-reference the retention cron in docs/operations.md.

#### [MEDIUM] GitHub event ingestion tables (pr_events, issue_events, deployment_events, review_assignments, workflow_runs) grow forever with no retention path at all

- **Status:** new · **Effort:** M
- **Evidence:** Schema at server/db.js:637-716 (pr_events/issue_events/deployment_events/review_assignments) and db.js:129-151 (workflow_runs). A repo-wide grep for `DELETE FROM` shows the ONLY production deletes against these tables are the GDPR-by-author deletes in user-data.js:163-175 and workflow_runs by user_id (user-data.js:193-198); deployment_events has zero delete paths anywhere ('deployment_events has no author column — skip', user-data.js:171). No sweeper touches them (work-board-sweeper.js only handles work_board_cache/snooze/kpi_snapshots). Every GitHub webhook delivery inserts a row (lib/github-events/*), and dashboards only ever query recent windows (e.g. idx_pr_events_action_created added for 'recency window' queries, db-migrations.js:433-436).
- **Impact:** On any actively-webhooked org the dominant tables in manager.db grow monotonically. Query latency on the dashboard/work-board hot paths degrades over months even with the new indexes, the DB file and backup size balloon, and completed review_assignments / years-old deployment rows serve no product feature — all reads are windowed to days or weeks.
- **Fix:** Add a retention sweep to the same daily janitor proposed above: delete event rows older than an env-configurable window (e.g. EVENT_RETENTION_DAYS=180; workflow_runs already power historical stats so give them a longer/window-configurable policy). If DORA/stats need long-horizon data, aggregate into monthly rollup rows first (the work_board_kpi_snapshots + pruneSnapshots pattern at work-board-sweeper.js:64 is the in-repo precedent).

#### [MEDIUM] Work Board 'webhook connected' indicator reads the Stripe idempotency ledger, not GitHub webhook data — wrong source of truth

- **Status:** new · **Effort:** S
- **Evidence:** server/routes/work-board.js:170: `webhookConnected = !!db.prepare('SELECT 1 FROM webhook_events LIMIT 1').get()`. The only INSERT into webhook_events is the Stripe handler (server/routes/stripe-webhooks.js:70, source='stripe'); the GitHub webhook route never writes this table (grep of routes/webhooks.js and lib/github-events/* finds zero webhook_events references — GitHub deliveries land in pr_events/issue_events instead). The flag drives the user-facing setup checkmark in src/components/WorkBoard/WorkBoardPage.jsx:78-100 ('webhookConnected ? border-emerald-400 ...').
- **Impact:** On a self-hosted deploy with GitHub webhooks working perfectly but no Stripe traffic, the Work Board empty state permanently tells the user webhooks are NOT connected (and shows setup instructions); conversely one Stripe billing event turns the checkmark green with zero GitHub webhook configured. Users chase phantom configuration problems.
- **Fix:** Derive connectivity from the data the feature actually consumes: `SELECT 1 FROM pr_events LIMIT 1` (or MAX(created_at) within N days across pr_events/issue_events for a fresher signal). Alternatively record GitHub delivery ids into webhook_events with source='github' in routes/webhooks.js and filter the check by source.

#### [MEDIUM] Dead tables: audit_log (v1) and license_keys are created and indexed on every boot but never written or read

- **Status:** new · **Effort:** S
- **Evidence:** audit_log v1 created at server/db.js:307-318 with two indexes; a server-wide grep for `INSERT INTO audit_log\b|FROM audit_log\b` (excluding tests) returns zero matches — all audit writes go to audit_log_v2 via lib/audit.js:48-53. license_keys created at db.js:404-421 with two indexes; grep for `license_keys` finds only the CREATE statements — the Stripe licensing flow uses the separate issued_licenses table (db-migrations.js:94-113, written by lib/license-issuer.js:146). The erasure response even names the dead table: user-data.js:277 `tombstoned: ['user', 'audit_log']`.
- **Impact:** Schema noise that actively misleads: a compliance reviewer auditing erasure sees an 'audit_log' table and a tombstone claim referencing it while the real audit data lives in audit_log_v2; a licensing bug-hunter greps into the wrong table. Two tables + four indexes are maintained for nothing on every deploy.
- **Fix:** Add a versioned migration in lib/db-migrations.js (the established ledger) that DROPs audit_log and license_keys (guard: only if row count is 0, else rename to *_legacy), and fix the user-data.js:277 response string to 'audit_log_v2'.

#### [LOW] server/migrations/*.sql is a stale third copy of the schema that nothing executes

- **Status:** new · **Effort:** S
- **Evidence:** server/migrations/001-initial-schema.sql, 002-migration-jobs-is-mirror.sql, 003-migration-tagging.sql exist, but grep across server/ for '001-initial-schema' / readers of the migrations dir finds no consumer — the live schema is db.js initDB() plus lib/db-migrations.js runMigrations() (db.js:742). 002 and 003 duplicate migrations that now live in db-migrations.js v2 (is_mirror, db-migrations.js:36-45) and the migration_marks DDL in db.js:281-304, and 001 has already drifted from db.js (it predates ~10 newer tables).
- **Impact:** Contributors (and the future Postgres adapter work the db-adapter abstraction implies) can reasonably treat the .sql files as authoritative and apply or extend a schema that silently diverges from what production actually runs.
- **Fix:** Delete the server/migrations/ directory (git history preserves it), or reduce it to a README pointing at db.js + lib/db-migrations.js as the single source of truth. If a raw-SQL snapshot is wanted for Postgres, generate it from the live SQLite schema in CI rather than hand-maintaining it.

#### [LOW] localStorage draft keys accumulate forever — the TTL-cleanup primitive exists but only covers pr-review-* keys

- **Status:** new · **Effort:** S
- **Evidence:** src/hooks/useDraftPersistence.js:36-47 persists per-resource keys (e.g. `draft:pr-comment:${repo}:${pr}`) and removes them only on explicit clear() after submit or when emptied — an abandoned draft's key lives forever, one per repo/PR/issue ever touched. The only TTL-based reaper in the codebase is cleanOldEntries at src/components/PRReview/hooks/useReviewState.js:25-45, which scans exclusively for 'pr-review-' prefixed keys (30-day TTL). ~22 other setItem call sites (grep) write grm.*, wb.*, theme, feature-flag and cache keys with no version prefix or migration story (src/lib/featureFlags.js:4-26, src/components/SettingsModal.jsx:90-91, src/components/AI/RepoInsightsModal.jsx:90, etc.).
- **Impact:** Long-tenured users accumulate hundreds of orphaned draft/cache keys; the origin creeps toward the ~5MB quota (large AI-result caches like RepoInsightsModal payloads accelerate it), after which quota-safe try/catch silently disables persistence — drafts stop saving with no signal to the user. No key versioning means a future format change strands stale blobs permanently.
- **Fix:** Generalize the existing cleanOldEntries pattern (useReviewState.js:25) into a small shared src/utils/storage.js: namespaced setJSON/getJSON with { v, savedAt } envelope and a mount-time reaper over registered prefixes ('draft:', 'grm.', 'pr-review-'), run once per session (the 2026-06-26 report line 730 already asks to stop running it every mount). Migrate useDraftPersistence to write through it.

#### [LOW] Demo seed data writes into the real production database with no un-seed path, gated on a frontend-namespaced env var

- **Status:** new · **Effort:** S
- **Evidence:** server/index.js:65 `if (config.mockMode === 'true') seedMockData();` where config.mockMode = process.env.VITE_MOCK_MODE (server/config.js:120). seedMockData (server/db.js:751-818) inserts user 999999, 3 teams, 9 repo_assignments and 3 repo_metadata rows into the same manager.db the SQLiteAdapter always opens (lib/adapters/sqlite-adapter.js:33-37 — no separate demo DB file). There is no reverse operation: unsetting the flag leaves the mock rows permanently, and they then flow into real aggregates (teams lists, repo_metadata joins).
- **Impact:** One accidental VITE_MOCK_MODE=true on a production host (a plausible slip since VITE_* vars are routinely set for frontend demo builds) permanently pollutes the prod DB with fake teams/metadata that surface in the UI and stats; cleanup is manual SQL. Related mock-auth exposure was flagged as SM-8 in the 2026-06-26 report, but the seed-pollution/no-unseed angle was not.
- **Fix:** Rename the gate to a backend-explicit MOCK_MODE (keeping VITE_MOCK_MODE for the client), refuse to seed when config.nodeEnv === 'production', and add an unseedMockData() that deletes by MOCK_USER_ID so toggling the flag is reversible.


### Production readiness & ops

> This backend is unusually production-ready for its class: zod-validated frozen config with fail-fast exit, a dedicated startup secrets gate (SOC 2 G4), K8s-style live/ready probes mounted before rate limiters, WAL-mode SQLite with busy_timeout, structured pino logging, graceful shutdown that drains six background workers, and real deploy artifacts (multi-stage Dockerfile, secrets-enforcing compose, railway.toml, Procfile). What blocks a professional deployment today is not missing scaffolding but operational blind spots: there is no backup/restore story at all for the SQLite data volume, the ALLOW_MOCK_AUTH escape hatch is still reachable in production and invisible to the startup secrets check, shutdown degrades to a force-exit(1) whenever an SSE client is connected, and observability has seams (client-visible X-Request-Id never matches logged requestId, no pino redact backstop).

**Already premium in this dimension:**

- Validated boot-time config: server/config.js:84-142 parses every env var through a zod schema, exits(1) with formatted errors on invalid config, freezes the result, and auto-downgrades prod log level to warn — no scattered silent fallbacks for critical vars.
- Dedicated startup secrets verification: server/lib/startup-secrets-check.js:19-108 hard-fails production on missing/short SESSION_SECRET, WEBHOOK_SECRET, CREDENTIAL_ENCRYPTION_KEY, enforces Stripe→license-key/webhook-secret coupling, rejects EMAIL_PROVIDER=console in prod, and warns on weak-keyword secrets in any env; wired before initDB() in index.js:53-60.
- Deploy artifacts enforce secrets too: docker-compose.yml:23-35 uses ${VAR:?message} so `docker compose up` aborts with an explicit error per missing secret; Dockerfile is multi-stage, runs as non-root `node`, and has a dependency-free Node HEALTHCHECK.
- Real health probes: routes/health.js implements /api/health/live + /ready with 100ms RTT budgets per dependency, a shutdown-drain flag, and is deliberately mounted BEFORE rate limiters/session (index.js:176-182).
- SQLite production pragmas all present: sqlite-adapter.js:77-82 sets WAL, busy_timeout=5000, foreign_keys=ON, synchronous=NORMAL; lines 53-67 self-diagnose NODE_MODULE_VERSION mismatches with exact fix commands.
- Graceful shutdown + crash recovery pair: index.js:398-483 drains six background workers, marks in-flight migration jobs/plans interrupted, closes queues and DB; index.js:362-383 recovers orphaned plans/import jobs on next boot, so hard crashes don't strand work.
- Structured logging discipline: pino with request-scoped child loggers, env-aware levels, ISO timestamps (lib/logger.js); console.* noise outside CLI scripts is essentially zero (5 files, mostly server/scripts and evals).
- HTTP hardening in place: helmet with prod CSP + 2y HSTS, trust proxy in prod, CORS locked to FRONTEND_URL, 10kb default JSON cap with a deliberate 4mb carve-out for AI diff endpoints, tiered rate limiting with Redis store option and a pre-session global safety net (index.js:113-263).
- Exemplary .env.example: every variable documented with generation one-liners, prod-vs-dev guidance, and an AGPL §13 disclosure note — the onboarding-to-prod path is genuinely documented.

#### [HIGH · verified] No backup/restore story for the production SQLite data volume

- **Status:** new · **Effort:** M
- **Evidence:** docker-compose.yml:43-44 mounts all data in the `app-data` volume (`- app-data:/app/server/data`); sqlite-adapter.js:78 sets `journal_mode = WAL` (a naive file copy of manager.db without the -wal file is inconsistent); a repo-wide grep for 'backup' finds only ROADMAP.md:17 ('Backup & Restore System — Enterprise. Scheduled snapshots with point-in-time restore.' — an advertised FUTURE feature) and license-PEM key backup docs. No script under server/scripts/, no README/docs section on backing up or restoring the DB.
- **Impact:** A self-hosted production instance holds users, AES-GCM-encrypted BYOK credentials and Azure PATs, migration plans/marks, audit logs, and sessions in one SQLite file with zero documented or tooled recovery path. Volume loss or corruption is unrecoverable customer data loss; WAL mode makes the obvious 'copy the .db file' workaround silently produce inconsistent snapshots.
- **Fix:** Add a backup script using better-sqlite3's online backup API (`db.backup(dest)`) or `VACUUM INTO` (both WAL-safe), exposed as `npm run db:backup` and optionally scheduled via the existing interval-worker pattern (server/lib/work-board-sweeper.js). Document backup + restore in the README Docker Quick Start section next to the volume definition.
- **Verification:** Verified all cited evidence: docker-compose.yml:43-44 (self-described production compose) puts all data in the app-data volume with SQLite as the default adapter (no DATABASE_URL set, no Postgres service), sqlite-adapter.js:78 enables WAL, and a repo-wide search finds zero backup tooling — no .backup()/VACUUM INTO/wal_checkpoint calls, no script in server/scripts/ or scripts/, no README/docs/guides section; the only 'backup' hits are ROADMAP.md:17 (advertised future Enterprise feature) and license-PEM key docs. Sensitive data confirmed in the single DB file (user_azure_credentials, api_keys, sessions, audit_log_v2). Checked last 30 commits — no recent fix. Tried two refutations: the Postgres adapter is opt-in and undocumented for the shipped compose path, and generic Docker volume tar-backup is exactly the WAL-inconsistent trap the finding warns about. High stands: commercially self-hosted product with unrecoverable data loss on volume failure and a silently-corrupting obvious workaround; not critical since it requires a loss event rather than an active flaw.

#### [HIGH · verified] ALLOW_MOCK_AUTH still enables unauthenticated login in production and the startup secrets check is blind to it

- **Status:** known-open · **Effort:** S
- **Evidence:** server/routes/auth.js:196-201: `const isExplicitlyAllowed = process.env.ALLOW_MOCK_AUTH === 'true'; if (!isDev && !isExplicitlyAllowed) return 404` — the env opt-in works in NODE_ENV=production and mints a session as user 999999 (lines 202-225). server/lib/startup-secrets-check.js:19-108 checks SESSION_SECRET/WEBHOOK_SECRET/etc. but never checks ALLOW_MOCK_AUTH. Related: index.js:65-67 runs `seedMockData()` whenever VITE_MOCK_MODE==='true' with no NODE_ENV guard, and .env.example:31 ships `VITE_MOCK_MODE=true` as the default.
- **Impact:** One stray env var on an internet-exposed deployment yields unauthenticated admin-equivalent login; a copied-over dev .env additionally seeds mock users/repos into the production database. Neither misconfiguration produces any startup warning or error.
- **Fix:** Implement SM-8's fix from the 2026-06-26 audit: mount /auth/mock only when NODE_ENV==='development', or require a high-entropy MOCK_AUTH_SECRET compared timing-safely. At minimum, add production checks to verifySecretsAtStartup (the existing primitive): error on ALLOW_MOCK_AUTH=true and warn on VITE_MOCK_MODE=true.
- **Verification:** Verified all cited code as it exists today. auth.js:196-226: ALLOW_MOCK_AUTH==='true' enables POST /api/auth/mock in any NODE_ENV including production (the comment explicitly documents the override) and mints a session as user 999999. startup-secrets-check.js checks many production misconfigs but never ALLOW_MOCK_AUTH; index.js enforces SESSION_SECRET/API_KEY_SECRET but not this flag — grep shows zero startup visibility. index.js:65-67 runs seedMockData() on VITE_MOCK_MODE==='true' with no NODE_ENV guard, and .env.example:31 ships VITE_MOCK_MODE=true as default. No mitigating guard exists: the router is mounted unconditionally (routes/v1/index.js:49), and CSRF is not a barrier since GET /api/auth/csrf-token issues tokens to unauthenticated callers. Not fixed recently — the repo's own 2026-06-26 audit report lists it as SM-8, and the subsequent fix commits (#190/#192 etc.) did not touch it. One correction: 'admin-equivalent' is overstated — mock user 999999 has no is_admin flag (requireAdmin would 403) and accessToken 'mock_token' cannot drive real GitHub proxy calls; the attacker gets a full non-admin authenticated session (migration-engine git clone SSRF/resource abuse, AI spend on operator keys, credential storage). That nuance does not lower the tier: a one-env-var silent auth bypass invisible to the purpose-built startup check, with a dev-default .env.example, stands as high.

#### [MEDIUM] Graceful shutdown never completes while SSE clients are connected — every such deploy force-exits(1) without closing the DB

- **Status:** new · **Effort:** M
- **Evidence:** index.js:406 `server.close(async () => {...})` performs ALL cleanup (job interruption marking, worker stops, db.close()) inside the close callback; index.js:479-482 force-exits with code 1 after 10s. No call to server.closeIdleConnections()/closeAllConnections() anywhere, and SSE responses (server/routes/ai-streaming.js:16-20 sets `Connection: keep-alive` with `text/event-stream`; also server/routes/env.js and server/migration-engine.js) are never tracked or ended on shutdown, so server.close() waits on them indefinitely. index.js:404 also swallows markShuttingDown() import failures with `.catch(() => {})`.
- **Impact:** Any restart/deploy while a user has an open AI stream or migration progress stream hangs 10 seconds then exits code 1 — orchestrators (docker restart: unless-stopped, Railway on_failure with max 3 retries) record it as a crash, the DB is closed uncleanly mid-WAL, and in-flight jobs are only rescued by the next boot's recovery pass.
- **Fix:** Keep a module-level Set of live SSE responses inside initSSE (it already centralizes creation/cleanup) and expose an endAll() called from gracefulShutdown; additionally call server.closeIdleConnections() right after server.close() (Node >=18.2). Log instead of swallowing at index.js:404 (already flagged as a 1-line fix in the 2026-06-20 report).

#### [MEDIUM] X-Request-Id returned to clients never matches the requestId written to logs

- **Status:** new · **Effort:** S
- **Evidence:** index.js:113-117 sets `req.id = req.headers['x-request-id'] || randomUUID()` and immediately sends it via `res.setHeader('X-Request-Id', req.id)`. Then lib/logger.js:47-49 (requestLoggerMiddleware, mounted at index.js:165) unconditionally re-assigns `req.id = req.headers['x-request-id'] || generateRequestId()` — a different `req_<ts>_<counter>` ID — and builds req.log from that, so every log line carries an ID the client never saw.
- **Impact:** The core support workflow — 'send me the X-Request-Id from the failing response' — cannot be correlated with server logs or Sentry, defeating the purpose of request-ID tracing that was deliberately built.
- **Fix:** In requestLoggerMiddleware change to `req.id = req.id || req.headers['x-request-id'] || generateRequestId()`. While there, dedupe the double per-request logging: requestTiming (middleware/request-timing.js:28-35) and requestLoggerMiddleware (lib/logger.js:53-68) both emit an error/warn line for the same 4xx/5xx response — keep one (requestTiming logs originalUrl and is mounted earlier).

#### [MEDIUM] Production SPA served by Express with no compression and no immutable caching for hashed assets

- **Status:** new · **Effort:** S
- **Evidence:** index.js:302-316: `app.use(express.static(distPath))` with default options (Cache-Control max-age=0) and a plain sendFile SPA fallback; grep of package.json for 'compression' returns no matches (dependency absent); docker-compose.yml:18-19 exposes the app directly on 3001 with no reverse-proxy/nginx service in front.
- **Impact:** Self-hosted deployments following the documented Docker Quick Start (README.md:468-482) serve multi-megabyte uncompressed JS bundles on every cold load and revalidate every hashed Vite asset on every navigation — visible slowness that undercuts the premium positioning.
- **Fix:** Serve hashed assets with `express.static(distPath, { maxAge: '1y', immutable: true, index: false })` (Vite content-hashes /assets filenames so this is safe) plus `compression()` with a filter that skips `text/event-stream`; alternatively, document a required TLS/compression reverse proxy in the README Docker section — currently neither exists.

#### [MEDIUM] Dockerfile and railway.toml point health checks at the rate-limited legacy /api/health instead of the purpose-built probes

- **Status:** new · **Effort:** S
- **Evidence:** Dockerfile:36-37 HEALTHCHECK hits `http://localhost:3001/api/health`; railway.toml:6 `healthcheckPath = "/api/health"`. But routes/health.js:19-21 documents that probes 'MUST remain unauthenticated and un-rate-limited', and only /api/health/live + /ready are mounted before the limiters (index.js:176-182); the legacy /api/health handler at index.js:269 sits BEHIND devSafetyNet (index.js:196) and the per-tenant apiLimiter (index.js:262), and ignores the shutdown-drain flag.
- **Impact:** Container/platform health checks share the global rate-limit bucket with real traffic and don't observe the shutting_down signal — under a limiter flap or during drain the orchestrator sees the wrong status, risking restart loops on a healthy instance and routed traffic to a draining one.
- **Fix:** Point Dockerfile HEALTHCHECK and railway.toml at /api/health/live (liveness) and use /api/health/ready for load-balancer readiness — the correct endpoints already exist; this is a two-line config fix.

#### [LOW] vercel.json ships a dead placeholder API rewrite and the Deploy workflow is a silent no-op behind a green badge

- **Status:** new · **Effort:** S
- **Evidence:** vercel.json:6: `{ "source": "/api/:path*", "destination": "https://api.yourapp.com/api/:path*" }` — a literal placeholder domain. .github/workflows/deploy.yml:31-35 and 42-50 skip both deploy steps when RAILWAY_TOKEN / VERCEL_DEPLOY_HOOK secrets are unset (echoing success), yet README.md:25 displays the passing 'Deploy' badge on every main push.
- **Impact:** Anyone deploying the frontend to Vercel using the shipped config gets every /api call proxied to a nonexistent domain (total app breakage after login); the green Deploy badge advertises a deployment pipeline that currently deploys nothing — a build-honesty gap in a project that ships a build-honesty CI gate.
- **Fix:** Replace the placeholder with a documented env-templated destination or delete vercel.json; make deploy.yml fail (or clearly mark the job skipped) when secrets are absent, or rename the workflow/badge to 'Build Verify' to match what it actually does.

#### [LOW] Readiness probe dials a brand-new Redis connection on every /ready call

- **Status:** new · **Effort:** S
- **Evidence:** routes/health.js:104-114: inside the /ready handler, `const client = new Redis(config.redisUrl, { lazyConnect: true }); await client.connect(); await client.ping(); ... client.disconnect();` per request, under a 100ms total budget (CHECK_TIMEOUT_MS, health.js:46).
- **Impact:** Orchestrator probes firing every few seconds cause constant Redis connection churn, and a TCP+TLS handshake alone can exceed the 100ms budget on managed Redis — producing flappy 503 'degraded' responses and spurious pod restarts on a healthy system.
- **Fix:** Reuse a lazily-created singleton client (mirror the connection owned by lib/session-store-redis.js) and only PING it inside timedCheck; reserve reconnection for ping failure.

#### [LOW] No pino redact backstop; secret redaction relies entirely on call-site discipline and misses GitHub/Azure token shapes

- **Status:** new · **Effort:** S
- **Evidence:** lib/logger.js:13-28 configures pino with no `redact` option. lib/redact-secrets.js:11-23 covers sk-/key_/AIza/basic-auth-URL shapes but not gho_/ghp_/github_pat_ or raw Azure PATs, and is applied only in lib/ai-error-format.js:126-131; lib/secret-redactor.js only sanitizes AI-bound file content. Session GitHub tokens (req.session.accessToken) and resolved PATs flow through dozens of `logger.error({ err })` sites with no structural guard.
- **Impact:** Today's logging is clean, but one future `logger.error({ err })` where the error object carries request config/headers (axios-style errors, provider SDK errors) ships live tokens into logs and Sentry breadcrumbs with nothing to stop it.
- **Fix:** Add `redact: { paths: ['req.headers.authorization', '*.headers.authorization', '*.accessToken', '*.access_token', '*.pat', '*.apiKey'], censor: '[REDACTED]' }` to the pino init in lib/logger.js, and extend redactSecrets (the existing primitive) with gho_/ghp_/github_pat_ prefixes.

#### [LOW] 4MB AI body-limit carve-out matches /api/ai/* but not the canonical versioned /api/v1/ai/* paths

- **Status:** new · **Effort:** S
- **Evidence:** index.js:158-164: `req.path.startsWith('/api/ai/') ? jsonAiLarge : jsonDefault` — but the AI router is mounted inside v1Routes (routes/v1/index.js:63) which is served at BOTH /api/v1 (index.js:297) and /api (index.js:299). A POST to /api/v1/ai/deep-review/... therefore gets the 10kb cap. The frontend and docs/api/API.md:1749+ consistently use /api/ai/, so only versioned-path consumers are affected.
- **Impact:** External integrators using the versioned prefix (the stated canonical namespace — /api is documented as the back-compat alias) get 413 Payload Too Large on any real PR-diff payload, an inconsistency that is confusing to debug because the same call works on /api/ai/.
- **Fix:** Change the predicate to a regex covering both prefixes, e.g. `/^\/api\/(v1\/)?ai\//.test(req.path)`, next to the existing comment explaining the carve-out.


### Premium & professional polish

> The premium baseline is genuinely strong: a documented motion vocabulary with broad adoption, a graceful quota/upsell system (QuotaExceededState + shared upgrade CTA + BYOK escape hatch), actionable empty states, deep keyboard/command-palette coverage, and a pricing parity gate that keeps four pricing surfaces honest against feature-flags.js — and all four Premium-High findings from the 2026-06-26 audit are verified fixed. The remaining risk is concentrated exactly where paid-product perception is won or lost: the monetization surfaces have fresh honesty drift the parity gate does not cover — a cosmetic yearly-billing toggle that displays a 20%-discounted price but always checks out at the monthly Stripe price, a Settings upgrade prompt selling 10,000 AI queries (real cap: 5,000) plus a roadmap feature as if shipped, unverifiable SOC 2/encryption/data-residency claims in the pricing FAQ, and a Roadmap "shipped" item that contradicts the pricing page on Free-tier write-back. A handful of known-open polish items (Portuguese strings, fabricated setup progress, window.alert) also remain untouched since the last audit.

**Already premium in this dimension:**

- Branding surface is complete and professional: index.html:5-24 has a real title, meta description, full og:/twitter: card set with a product screenshot + alt text, SVG favicon, self-hosted preloaded display font, and a dark-mode pre-paint script (index.html:27-33) that prevents theme flash.
- Quota UX is genuinely premium, not a dead end: QuotaExceededState.jsx:42-63 shows feature, used/limit, reset date, a shared QuotaUpgradeButton (ui/QuotaUpgradeButton.jsx:22-34 -> navigateToPricing app event), AND a 'Configure your own AI key (BYOK)' alternative — three graceful paths out of a hard limit.
- Pricing parity gate works where it is wired: tests/pricing-feature-parity.test.js:10-55 asserts PricingPage, FeatureComparison, Landing PricingPreview, README matrix and even Stripe free-trial copy against server/lib/feature-flags.js; I verified FeatureComparison.jsx values match feature-flags.js field-by-field (200 repos, 75 searches, 5/50/15 per-feature caps, 1 full migration/mo, teams 3x5), and sync preview-free/apply-Pro is really implemented (server/routes/v1/repos-sync.js:22 preview requireAuth-only, :44 apply requireTier('pro')).
- Motion is a real system: src/components/ui/motion.js:1-81 documents durations/eases/springs mirroring the CSS tokens plus a reduced-motion contract via <MotionConfig reducedMotion="user">, and the vocabulary is consumed in 40+ app components (97 references found).
- All four Premium-High findings from the 2026-06-26 panel are verified FIXED: CreateRepoModal.jsx:88-98 now reads res.reply with typed-error handling; WorkBoardCapReachedBanner.jsx:80-82 now targets the real #ai-cap anchor; TransferModal dry-run and Button default-type were fixed in the tier-1 commit batch.
- Empty states sell next actions instead of dead-ending: EmptyState primitive adopted across ~40 files with CTAs (CompareSimilarDrawer.jsx:102-110 'Index now', OrgManagerModal.jsx:370-375 'View members on GitHub', RepoList/index.jsx:136-141 create/import/clear-filters).
- Keyboard/power-user coverage is a real premium signal: a 764-line CommandPalette plus per-surface help overlays (KeyboardShortcutsHelp.jsx, PRReview/KeyboardHelpOverlay.jsx, WorkBoard/KeyboardHelpModal.jsx, MigrationWizard ShortcutsOverlay.jsx) and a shared Kbd primitive.
- Error microcopy helpers are broadly adopted: toast.errorFromException/formatUserError used 84 times across 39 files; no JSON.stringify(error) leaks into any JSX render path.
- Version display is single-sourced: vite.config.js:47-49 injects package.json version as VITE_APP_VERSION so the Landing hero badge (HeroSection.jsx:63) can never drift the way the old hardcoded literal did.
- Checkout failure UX is honest: PricingPage.jsx:258-280 maps Stripe-missing 503 to a dismissible ServiceUnavailable banner offering the Free path and a license-key alternative instead of a raw error.

#### [HIGH · verified] Yearly billing toggle is cosmetic — card shows a 20%-discounted price but checkout always charges the monthly Stripe price

- **Status:** new · **Effort:** M
- **Evidence:** src/components/Pricing/PricingPage.jsx:78-87 (`YEARLY_DISCOUNT = 0.8` applied only to the DISPLAYED price) and :181 (`body: JSON.stringify({ tier })` — the billing period is never sent). server/routes/billing.js:11-13 (`checkoutSchema = z.object({ tier: ... })` accepts no period) and :48 (`const priceId = tier === 'pro' ? config.stripePriceProMonthly : config.stripePriceEnterpriseMonthly` — always monthly) even though server/config.js:50 defines `stripePriceProYearly` from STRIPE_PRICE_PRO_YEARLY. Display compounds it: PricingCard.jsx:100-104 renders the discounted `$15` big number with unit `/{period}` = "/year", and :121-122 renders "$180/year · Save 20%".
- **Impact:** A buyer who toggles Yearly sees "$15 /year" (strike-through $19) and "Save 20%", clicks Upgrade to Pro, and lands in a Stripe checkout for the $19/month monthly subscription. The advertised discount does not exist anywhere in the purchase path — a pricing-integrity failure on the single highest-stakes premium surface, same false-affordance class as the already-fixed TransferModal "Simulate" bug (PH-3).
- **Fix:** Thread the period through: client sends `{ tier, interval: 'month'|'year' }`, extend `checkoutSchema` with `interval: z.enum(['month','year'])`, and select `stripePriceProYearly`/`stripePriceEnterpriseYearly` (already in config.js) when interval==='year'; 503 with the existing ServiceUnavailable banner path when the yearly price env is unset. Also fix PricingCard's unit to "/mo billed yearly". Add an assertion to tests/pricing-feature-parity.test.js that the checkout body/schema honours the interval.
- **Verification:** Verified every cited line against current code. PricingPage.jsx:80-87 discounts only the displayed price (YEARLY_DISCOUNT=0.8); the checkout POST at :181 sends only { tier } and isYearly never enters the purchase path (sole callsite confirmed by grep). billing.js:11-13 schema accepts only tier and :48 hardcodes the monthly Stripe price IDs; config.js defines stripePriceProYearly/stripePriceEnterpriseYearly but grep shows they are used nowhere in server/ — no wrapper, webhook, or alternate route mitigates this. PricingCard.jsx:100-105 + 119-125 render "$15 /year" (strike $19) and "$180/year · Save 20%", so the yearly UI is fully built while the backend cannot sell a yearly plan at all. Git log shows the recent pricing-honesty commits (02cddd0, d0500aa, a8fb721, 802cf74) never touched this path — not fixed. Only softener: Stripe's hosted checkout displays the real $19/month before payment, so no silent wrong charge — but the advertised discount is unpurchasable, a pricing-integrity failure on the main conversion surface, consistent with how prior audits rated pricing lies. High stands.

#### [HIGH · verified] Settings upgrade prompt sells wrong quota numbers and an unshipped feature — the 5th pricing surface the parity gate doesn't cover

- **Status:** new · **Effort:** S
- **Evidence:** src/components/Settings/LicensePlanSection.jsx:125: `{['Unlimited repositories', '10,000 AI queries/month', 'Priority support', 'Advanced analytics'].map(...)}`. Ground truth: server/lib/feature-flags.js:51 `aiQueriesPerMonth: 5000` for Pro; FeatureComparison.jsx:129 Support row is `['Community', 'Email', 'Priority + SLA']` (Priority is Enterprise-only); "Advanced Analytics Dashboard" is an UNSHIPPED 'next' roadmap item (RoadmapPage.jsx:24). tests/pricing-feature-parity.test.js:10-45 reads only PricingPage.jsx, FeatureComparison.jsx, PricingPreview.jsx, billing.js and README — LicensePlanSection is not parsed, so this drift is invisible to the gate.
- **Impact:** The in-app upsell shown to every Free user in Settings promises double the real Pro AI quota, a support level the tier doesn't include, and a feature that doesn't exist. This is exactly the "pricing lies" class the 2026-06-05 excellence panel treated as high and PR #87's gate was built to prevent — a paying user can reasonably claim they were missold.
- **Fix:** Correct the four bullets to match feature-flags.js ('Unlimited repositories', '5,000 AI queries/month', 'Email support', e.g. 'Advanced bulk + mirror sync'), and wire LicensePlanSection.jsx into tests/pricing-feature-parity.test.js the same way PricingPreview was retro-added (its comment at :32-34 records the identical lesson). Longer term this is the DM-23 fix: derive all five surfaces from one pricing catalog module.
- **Verification:** Verified every cited line against current code. (1) src/components/Settings/LicensePlanSection.jsx:125 — the Pro upgrade card shown to Free users lists 'Unlimited repositories', '10,000 AI queries/month', 'Priority support', 'Advanced analytics'. Ground truth contradicts three of four: server/lib/feature-flags.js:51 sets Pro aiQueriesPerMonth: 5000, and the canonical PricingPage.jsx itself sells Pro as '5,000' queries (line 49) with 'Email support' (line 56) — 'Priority Support + SLA' is Enterprise-only (line 73), matching FeatureComparison.jsx:129 ['Community', 'Email', 'Priority + SLA']. 'Advanced Analytics Dashboard' is an unshipped 'next' roadmap item at RoadmapPage.jsx:24, and tiered ENTERPRISE there — so the Pro card sells a feature that neither exists nor would belong to Pro. (2) Not already fixed: git log on the file shows d0c222e ('stop advertising SSO as shipped') patched the Enterprise card in this same component ('SSO / SAML (coming soon)' at line 150) but left the Pro card untouched — the file was audited for this exact defect class and this instance was missed. (3) No mitigating guard: grep of tests/pricing-feature-parity.test.js finds zero references to LicensePlanSection/Settings; the gate reads only PricingPage.jsx, FeatureComparison.jsx, PricingPreview.jsx, billing.js and README (test lines 10-55), so the drift is invisible to CI. Severity high is fair and consistent: the 2026-06-05 excellence panel classified equivalent 'pricing lies' (e.g. PR #87 scope) as high, and this surface is the conversion point where a Free user decides to pay — 2x-inflated quota, wrong support tier, and a nonexistent feature at the moment of purchase is a genuine missold-customer risk, though the fix (correct 4 strings + add the file to the parity gate) is trivial.

#### [HIGH · verified] Pricing page makes unverifiable compliance claims: "SOC 2-hardened", "all data encrypted at rest (AES-256)", "custom data-residency options"

- **Status:** new · **Effort:** S
- **Evidence:** src/components/Pricing/PricingPage.jsx:377 social-proof strip: `{ icon: Shield, text: 'SOC 2-hardened architecture' }`. PricingPage.jsx:101 FAQ: 'All data is encrypted in transit (TLS 1.3) and at rest (AES-256). Enterprise plans include audit logs and custom data-residency options.' Reality: only BYOK keys and Azure PATs are AES-256-GCM encrypted (server/lib/user-ai-config.js:4, server/lib/azure-credentials-manager.js:14); the main SQLite store (server/repos.db) has no at-rest encryption; TLS is deployment-dependent (Express on :3001); grep finds 'data-residency' NOWHERE in src/ or server/ outside this FAQ line; there is no SOC 2 attestation — internal code honestly calls it 'SOC 2 code hardening' controls (RoadmapPage.jsx:61, server/index.js:50). Note feature-flags.js:106-108 deliberately keeps `sso: false` "so no surface advertises it as delivered" — the FAQ violates that same discipline.
- **Impact:** Legal/trust exposure on the commercial page: prospects (and any enterprise security review) will read "SOC 2-hardened" + "all data AES-256 at rest" + "custom data-residency" as delivered capabilities. Misrepresenting security posture in sales copy is the highest-consequence form of vaporware, and the readme-honesty/parity CI gates don't parse FAQ prose so nothing prevents it from shipping.
- **Fix:** Rewrite to what's true, following the pattern the codebase itself established for SSO: 'Credentials and API keys encrypted with AES-256-GCM', 'append-only audit log with SHA-256 hash chain', 'self-hosted — your data never leaves your infrastructure' (the actually stronger self-hosting story), and drop 'SOC 2-hardened'/'TLS 1.3'/'custom data-residency' or move them to the roadmap. Extend the honesty gate to assert the FAQ/social-proof strings don't contain 'SOC 2', 'data-residency', or 'at rest' claims unless flagged true.
- **Verification:** Verified all cited lines in the current working tree: PricingPage.jsx:377 still ships 'SOC 2-hardened architecture' (directly under a comment forbidding unverified claims) and :101 still claims all-data AES-256 at rest, TLS 1.3, and custom data-residency. Reality holds: AES-256-GCM covers only BYOK keys (user-ai-config.js:4) and Azure PATs (azure-credentials-manager.js:14); server/db.js has no SQLCipher — the main SQLite store is plaintext at rest; TLS is deployment-dependent (plain HTTP on :3001); 'data-residency' exists nowhere else in src/ or server/; internal code honestly calls the shipped controls 'SOC 2 code hardening' (RoadmapPage.jsx:61, server/index.js:50) and feature-flags.js:106-108 codifies the exact discipline the FAQ violates. Recent pricing-honesty commits (802cf74, 02cddd0, d0c222e) fixed tier/SSO/trial claims but left these untouched, and tests/pricing-feature-parity.test.js parses feature-flag numbers/README/FeatureComparison — not FAQ prose or the social-proof strip — so no gate mitigates it. Minor nuances that don't overturn: 'Enterprise plans include audit logs' is true, and some SOC 2-inspired controls do exist, making 'SOC 2-hardened' the most defensible (but still attestation-implying) of the three claims. High is the right severity — same class the 2026-06-05 panel rated high (pricing lies), with legal/trust exposure but no active data compromise.

#### [MEDIUM] Roadmap advertises "PR Review write-back tier gating" as shipped while the pricing page grants Free full write-back and the backend gates nothing

- **Status:** new · **Effort:** S
- **Evidence:** src/components/Roadmap/RoadmapPage.jsx:59 (shipped section): 'PR Review write-back tier gating — Free tier is strictly read-only; Pro+ required for approve / request-changes / comment / merge', tier: 'Pro + Enterprise'. Contradicted by FeatureComparison.jsx:97-99 ('PR Review Experience: Full + write-back' in ALL three tier columns) and PricingPage.jsx:26-27 (Free includes 'PR Review with write-back comments: true'). Backend: server/routes/repos/pulls.js has zero requireTier — grep shows only stale comments at :113, :276, :326, :361-362 claiming 'Pro+ tier-gated' while the header :19 says available to 'all tiers including Free'.
- **Impact:** The two public marketing surfaces tell opposite monetization stories: a prospect reading the Roadmap believes write-back requires Pro (an upsell reason), while the pricing page says it's free. Whichever is intended, one page is currently lying, and the backend contradicts the roadmap. This erodes exactly the pricing-trust the parity gate was built to protect (the gate doesn't parse RoadmapPage).
- **Fix:** Decide the policy once: since feature-flags.js has no prReviewWriteBack gate and pricing sells it as free, remove the RoadmapPage.jsx:59 'shipped' item (or reword to 'PR write-back on all tiers') and delete the four stale 'Pro+ tier-gated' comments in pulls.js (known-open PL-8). If gating is actually wanted, add requireTier('pro') to the four write routes and flip the two pricing rows — then add the row to the parity gate.

#### [MEDIUM] document.title never changes — every view, deep link and browser-history entry shows the same static marketing title

- **Status:** new · **Effort:** S
- **Evidence:** Grep for `document.title` across src/ returns zero matches. index.html:7 fixes '<title>GitHub Repo Manager — AI-Powered Repository Management</title>' for the app's lifetime. Meanwhile the app ships bidirectional hash deep-linking — App.jsx:274 'Bidirectional hash <-> activeView routing (deep-links + view->hash sync)' and RoadmapPage.jsx:49 markets '#/repos / #/work / #/teams / #/roadmap / #/pricing' as a shipped feature.
- **Impact:** Users with multiple tabs (dashboard + a PR review + settings) see identical tab labels; bookmarks and browser history are indistinguishable; shared deep links preview with the generic marketing title. Per-view titles are a table-stakes premium signal in every comparable tool (Linear, GitHub itself), and the deep-linking investment already did the hard part.
- **Fix:** Add a ~15-line useDocumentTitle hook driven by the same activeView/repoDetail state that drives the hash sync in App.jsx (e.g. 'owner/repo · Pull Requests — Repo Manager', 'Work Board — Repo Manager'), resetting to the base title on unmount. Mirror the existing view→hash map so the two can't drift.

#### [MEDIUM] Portuguese strings still shipping in five English-product surfaces (dashboard sync chip, migration history, wizard progress)

- **Status:** known-open · **Effort:** S
- **Evidence:** All still present as of this audit: src/components/Dashboard/HeroSyncChip.jsx:20 `syncing ? 'A sincronizar…'`; src/components/MigrationHistory/MarksBadge.jsx:34 `return 'Sem tags'`; MigrationHistory/MarksDetailModal.jsx:20 `'— nada escrito'`; MigrationWizard/Steppers.jsx:231 `Progresso` (and :163 JSDoc example 'A validar credenciais…'). Documented as PM-6/PL-27/PL-28 in docs/reports/2026-06-26-codebase-audit-panel.md and as the 'app-wide PT follow-up' remaining item in the 2026-06-05 excellence audit; the anti-PT guard from PR #89 evidently doesn't cover these files.
- **Impact:** Mixed-language copy on the dashboard hero (the first screen a user sees while syncing) and throughout the migration flow reads as unfinished localization — a visible unprofessionalism marker for an English-marketed SaaS.
- **Fix:** Translate the five strings ('Syncing…', 'No tags', 'nothing written', 'Progress') and extend the existing anti-PT lint/CI guard (shipped in PR #89 for Wizard+Settings) to cover src/components/Dashboard and src/components/MigrationHistory so the class can't regress.

#### [MEDIUM] System Setup still shows fabricated step progress on fixed timers regardless of backend outcome

- **Status:** known-open · **Effort:** M
- **Evidence:** src/components/Setup/SystemSetup.jsx:32-39 — '// Step 2 -> 3 (Simulate progress matching backend simulation)' followed by three `await wait(1000)` calls that turn 'Creating SQLite Database', 'Running Migrations' and 'Verifying Security' green on timers; only the initial POST's res.ok is checked (:17). Documented as PM-22 in the 2026-06-26 panel; not in the applied tier-1 commit list, confirmed unchanged.
- **Impact:** If a migration fails server-side after the initial 200, the bootstrap screen still shows all-green and 'Launch Workspace' — a trust/honesty gap on the very first screen a self-hosting evaluator sees, in a product whose recent initiatives (Migration AI Review honesty rework) were specifically about not faking progress.
- **Fix:** Drive the steps from a real status endpoint or SSE (the codebase already has SSE streaming infra from the Repo Advisor work), or collapse to a single honest 'Initializing…' spinner + final verified state, matching the honest-loading pattern shipped in the migration-review rework.

#### [LOW] ErrorBoundary shows raw exception text ("Cannot read properties of undefined…") to end users

- **Status:** new · **Effort:** S
- **Evidence:** src/components/ErrorBoundary.jsx:77 — `{this.state.error?.message || 'An unexpected error occurred. ...'}` renders the JS exception message verbatim in the crash card body; the surrounding card is otherwise polished (retry + reload + backend telemetry at :22-35).
- **Impact:** The most common render-crash messages are developer artifacts ('x is not a function', minified identifiers in prod builds) — exactly the jargon-leak the crash surface of a paid product shouldn't show, and it duplicates information already sent to /api/system/client-error.
- **Fix:** Show static friendly copy by default and tuck error.message into a collapsed 'Technical details' <details> block (pattern already used by formatUserError surfaces); keep the telemetry POST as the real diagnostic channel.

#### [LOW] Landing/Pricing/Roadmap hardcode Framer transitions instead of the motion.js vocabulary that declares itself the single source of truth

- **Status:** new · **Effort:** S
- **Evidence:** Grep: `ease: [0.16, 1, 0.3, 1]` hardcoded 24 times across 10 marketing files (PricingPage.jsx x8 e.g. :170/:301, FeatureComparison.jsx:170, CTASection.jsx x4, RoadmapPage.jsx x3, PricingPreview.jsx:66, etc.) with ad-hoc durations 0.45/0.6/0.65 outside the DURATION scale — while src/components/ui/motion.js:1-3 declares itself 'the single source of truth for durations, easing curves…' and :32 defines the identical array as EASE.emphasized.
- **Impact:** No visual inconsistency today (values match EASE.emphasized), but the marketing tier is unmoored from the token system: a future motion-tuning pass (like the CSS duration-300 migration already spec'd) won't reach these 24 sites, and they set the copy-paste template for new marketing sections.
- **Fix:** Mechanical sweep: import { EASE, DURATION } from '../ui/motion' and replace the literal arrays; add marketing-scale durations (e.g. DURATION.reveal = 0.6) to motion.js rather than leaving them inline. Piggyback on the anti-drift lint gate planned in docs/specs/2026-06-25-layout-premium-responsive.md workstream 3.

#### [LOW] WorkBoard command-palette 'Save preset' still falls back to a native window.alert()

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/WorkBoard/WorkBoardPage.jsx:186-187 — `window.alert('Use the Presets dropdown in the filter bar to save the current filters as a preset.')`. Documented as PM-26 in the 2026-06-26 panel; confirmed unchanged.
- **Impact:** A jarring unstyled blocking OS dialog fires from inside the premium command palette — the single most style-breaking primitive available, in the flagship Work Board surface.
- **Fix:** Replace with toast.info via the existing useToast, or better, emit an APP_EVENTS entry that opens the PresetDropdown directly (the palette already routes richer actions through the app event bus).

#### [LOW] Landing footer still hardcodes 'Vite 7' (project is on Vite 8)

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/Landing/LandingPage.jsx:45 — `{' '}· React 19 + Vite 7 + Tailwind CSS v4` — while HeroSection.jsx:63 in the same page correctly sources v{import.meta.env.VITE_APP_VERSION} from the single-sourced version. Documented as PL-24 in the 2026-06-26 panel; confirmed unchanged.
- **Impact:** A stale version number in the public landing footer of a developer-audience product is a small but telling credibility ding — the exact audience that notices.
- **Fix:** Drop the framework version numbers from the tagline ('React + Vite + Tailwind') or derive from package.json via the same vite.config.js define mechanism already used for VITE_APP_VERSION.

#### [LOW] No in-app version or what's-new surface — logged-in users never learn the app updated

- **Status:** new · **Effort:** M
- **Evidence:** VITE_APP_VERSION is rendered exactly once in the codebase, on the logged-OUT landing hero (src/components/Landing/HeroSection.jsx:63, grep confirms sole match). A maintained CHANGELOG.md exists at the repo root and releases are versioned (v4.1.1), but no Settings section, footer, or dialog exposes the running version or release notes to an authenticated user; the in-app Roadmap 'shipped' list (RoadmapPage.jsx:45-66) is unversioned and undated.
- **Impact:** Self-hosted operators can't tell which version they're running when reporting issues (support cost: every bug report needs a 'what version?' round-trip), and users never see new features they're paying for — weakening upgrade/retention value. A version string + what's-new is a standard paid-product signal.
- **Fix:** Cheapest slice: render 'v{import.meta.env.VITE_APP_VERSION}' in the SettingsModal footer (version is already injected app-wide by vite.config.js:47-49). Optional second slice: a 'What's new' entry in the CommandPalette/Settings that shows the top CHANGELOG.md section via the existing SafeMarkdown primitive.


### Accessibility (professional baseline)

> Accessibility here is well above the typical internal-tool baseline: focus trapping, live regions, combobox/tablist ARIA, reduced-motion, skip links, and an axe CI gate are all engineered into shared primitives rather than sprinkled ad-hoc. The remaining debt sits at the edges — a handful of unnamed destructive icon buttons, SSE migration progress with no progressbar/announcement semantics, bespoke menus (ContextMenu, SavedCredentialsPicker, mobile FAB) that bypass the excellent primitives, and a deliberately critical-only axe gate that scans only 4 of the app's ~10 major surfaces, letting serious violations (button-name, nested-interactive) ship silently. All are fixable with the primitives that already exist; nothing found is architectural.

**Already premium in this dimension:**

- Dialog focus management is infrastructure, not ad-hoc: shared useFocusTrap (src/hooks/useFocusTrap.js:21-98) does trap + Escape + initial-focus + restore-on-close, and is consumed by Modal (src/components/ui/Modal.jsx:104), Drawer (ui/Drawer.jsx:63), and all three Header popovers (Header.jsx:497,610,744). The 2026-06-20 'focus not restored on modal dismiss' finding is RESOLVED (useFocusTrap.js:84-93).
- Live-region discipline is pervasive: Toast has role=status/alert + aria-live + aria-atomic (ui/Toast.jsx:59-61); the AI chat is role=log aria-live=polite aria-relevant=additions (AIAssistant.jsx:497-503); 70+ role=status/alert sites across banners, wizard steps, and error states (grep across src).
- Custom widgets on primary paths implement full ARIA patterns: ui/Select is a complete combobox (aria-expanded/controls/activedescendant + arrows/Home/End/Escape, Select.jsx:264-272,154-195); TabBar has roving tabindex + arrow/Home/End nav (ui/TabBar.jsx:37-81); ModelCombobox mirrors the combobox pattern (Settings/AIConfig/ModelCombobox.jsx:127-131); CommandPalette rides cmdk + Radix Dialog with sr-only Title/Description (CommandPalette.jsx:415-429); RepoFilterBar's bulk-selection menu has real roving focus + Escape-restores-trigger (RepoList/RepoFilterBar.jsx:100-113).
- Reduced motion is genuinely global: a CSS kill-switch zeroes all animations/transitions (design-system.css:306-322), spinner keyframes have a dedicated fallback (index.css:247-253), Framer runs under MotionConfig reducedMotion=user, and primitives individually honor it (CountUp.jsx:24-45, Tooltip.jsx:206, Modal.jsx:156-159).
- Landmark/heading skeleton is correct: skip links marked 'WCAG 2.1 requirement' (App.jsx:612-624), single main landmark (App.jsx:669), one h1 per view via the PageHeader primitive (ui/PageHeader.jsx:44-48) with the brand header deliberately demoted to h2 (Header.jsx:106-114), labelled nav landmarks (MigrationWizard/Steppers.jsx:250,340; Dashboard/Premium/InboxPanel.jsx:148).
- Form labeling is consistently right: every sampled checkbox is wrapped in an implicit <label> (BranchProtectionPanel.jsx:248+, RepoDetail/SettingsTab.jsx:302, TransferModal.jsx:386, ScheduleStep.jsx:271); only 3 native inputs app-wide lack id/aria-label and those are already owned by the 2026-06-26 report (PatPasteGuide/ServerPicker).
- Icon-only buttons are near-universally named — a full-source scan found only 3 unnamed out of hundreds, thanks partly to Tooltip auto-mirroring its label into aria-label for unnamed triggers (ui/Tooltip.jsx:187-188).
- Tooling exists on both axes: eslint-plugin-jsx-a11y configured with aria-* correctness rules at error level (eslint.config.js:59-81) and an axe-core Playwright gate with a documented escalation policy (e2e/a11y-helpers.js:1-50, e2e/a11y-smoke.spec.js).
- Button primitive enforces the 44px minimum target size with an explicit, documented opt-out list (ui/Button.jsx:38-57); clickable list rows (PR/issue/repo cards) are role=button + tabIndex=0 + aria-label + Enter/Space handlers (RepoDetail/PullRequestsTab.jsx:279-293, RepoList/RepoCard.jsx:117-123) — the 2026-06-20 'role=presentation onClick' finding is effectively resolved (the div only stops propagation; real Buttons inside are keyboard-operable).

#### [MEDIUM · verified] Destructive icon-only buttons have no accessible name (delete release, delete webhook, paste-card submit)

- **Status:** new · **Effort:** S · reported high, calibrated to medium
- **Evidence:** src/components/RepoDetail/ReleasesTab.jsx:170-172 — `<Button variant="ghost" size="sm" onClick={() => handleDelete(r)} className="text-red-500..."><Trash2 .../></Button>` (no aria-label/title/text). Same pattern src/components/RepoDetail/SettingsTab.jsx:403-405 (webhook delete, Trash2; sibling Ping button at :400 has only title="Ping"). src/components/AIAssistantPasteCard.jsx:87-89 — submit `<Button type="submit" ...><ArrowRight/></Button>` unnamed. Confirmed via full-source scan: these are the ONLY unnamed icon-only buttons in src.
- **Impact:** Screen-reader users hear just "button" for actions that permanently delete a GitHub release or webhook — activating blind risks data loss; axe flags this as serious (button-name) but the CI gate only blocks critical, so it ships.
- **Fix:** Add aria-label ("Delete release {name}", "Delete webhook", "Send"), or wrap in the existing ui/Tooltip which auto-mirrors label→aria-label (Tooltip.jsx:187-188) — the pattern DLQTable.jsx:185-194 and WorkBoard/InlineActions.jsx:15-23 already follow.
- **Verification:** Verified all three cited sites in the current working tree: ReleasesTab.jsx:170-172 (release delete, Trash2), SettingsTab.jsx:403-405 (webhook delete, Trash2), AIAssistantPasteCard.jsx:87-89 (icon-only submit, ArrowRight) are genuinely unnamed — no aria-label/title/text, the shared ui/Button.jsx primitive adds no name fallback, no Tooltip wrapper (which mirrors labels into aria-label), and git log shows no recent fix. The gate-escape claim also holds: e2e/a11y-helpers.js hard-fails only impact==='critical' AND a11y-smoke.spec.js scans only dashboard/repositories/work-board/status, never RepoDetail tabs or the paste card. However, severity 'high' rests on 'activating blind risks data loss', which is refuted: both deletes route through ConfirmModal (ReleasesTab:185, SettingsTab:636 via setConfirmAction at :223) whose Modal primitive wires aria-labelledby, so an SR user gets an announced confirmation before anything is deleted. (Minor evidence error too: axe rates button-name as critical impact, not serious — it ships due to scan coverage, not the impact tier.) Residual defect is a real WCAG 2.1 A 4.1.2 failure — SR users hear only 'button' and cannot identify three controls — but it is 3 isolated instances in an otherwise heavily-labeled codebase with a confirm-gate backstop: medium, not high.

#### [MEDIUM] Migration progress bars have no progressbar semantics and failure/completion is never announced

- **Status:** new · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/ProgressStep.jsx:377-384 — overall SSE progress is a bare div+motion.div width animation, no role/aria-valuenow. src/components/MigrationWizard/steps/SimpleProgressStep.jsx:22-33 — same bare ProgressBar; failed-state panel at :204-208 has no role="alert". Meanwhile the shared primitive ui/StatBar.jsx:66-68 already exposes role="progressbar" + aria-valuenow/min/max.
- **Impact:** During the product's hero flow (migration), screen-reader users get zero perceivable progress state and no announcement when the migration completes or fails — they must manually re-scan the page to learn a multi-minute job's outcome.
- **Fix:** Reuse ui/StatBar for both bars (or add role=progressbar + aria-valuenow + aria-label); add role="alert" to the failed panel and a polite sr-only live region announcing 'Migration complete/failed' state transitions, mirroring PRReview/ReviewToolbar/ReviewStatusBar.jsx:118's sr-only aria-live pattern.

#### [MEDIUM] ContextMenu arrow-key navigation is invisible to assistive tech (no aria-activedescendant) and focus is not restored on close

- **Status:** new · **Effort:** M
- **Evidence:** src/components/ui/ContextMenu.jsx:267-278 — container is role="menu" tabIndex={-1} with focus set once on mount (:217-221); arrow keys only update focusedIndex state + a visual ring (:115-137, :336) while DOM focus stays on the container; menuitems (:311-319) have no id wired to any aria-activedescendant on the menu; onClose unmounts with no focus restore (contrast useFocusTrap.js:84-93 which the Header popovers use).
- **Impact:** Screen-reader users who open the right-click menu (Shift+F10 on a focused RepoCard fires onContextMenu) hear nothing as they arrow through items — the current item is announced only visually; on close, focus drops to <body>, losing the user's place in the repo grid.
- **Fix:** Give each menuitem an id and set aria-activedescendant on the role=menu container from focusedIndex (the codebase already does exactly this in ui/Select.jsx:272), or switch to real roving focus like RepoFilterBar.jsx:105-113; snapshot document.activeElement on mount and restore it in a cleanup, as useFocusTrap does.

#### [MEDIUM] Primary Repositories view has no h1, and SPA view switches are neither announced nor focus-managed

- **Status:** new · **Effort:** S
- **Evidence:** src/App.jsx:709-741 — the activeView==='repos' branch renders OrgSidebar + RepoList with no PageHeader/h1 (grep for '<Heading|<h1' in src/components/RepoList returns nothing), while Header.jsx:106-110 documents that "the page-level h1 lives in each route's PageHeader". src/components/ui/ViewShell.jsx:20-30 — view switch wrapper has no focus move or live announcement.
- **Impact:** On the app's default working view, screen-reader heading navigation jumps from the h2 brand label straight to card-level headings — there is no page title to land on; switching views via the header nav gives AT users no confirmation the content changed.
- **Fix:** Render PageHeader (the existing primitive, ui/PageHeader.jsx:44) or an sr-only h1 'Repositories' in the repos branch; add a small route announcer (sr-only aria-live=polite div in App that speaks the view name on activeView change) — the OnboardingTour aria-live pattern (Onboarding/OnboardingTour.jsx:96) is the in-repo precedent.

#### [MEDIUM] axe CI gate blocks only 'critical' impact and scans just 4 views — the wizard, repo detail, settings, and PR review are never scanned

- **Status:** new · **Effort:** M
- **Evidence:** e2e/a11y-helpers.js:24 — `const blocking = results.violations.filter((v) => v.impact === 'critical')`; serious/moderate are console.warn only (:28-33), with the comment (:5-11) acknowledging color-contrast and RepoCard nested-interactive are parked. e2e/a11y-smoke.spec.js:5-36 — exactly 4 tests: dashboard, repositories, work board, public status. The migration wizard, RepoDetail tabs, SettingsModal, and PRReview — where every finding in this audit lives — have no axe coverage.
- **Impact:** Serious-impact regressions (unnamed buttons, nested-interactive, contrast) merge green today — finding #1 of this audit is proof: axe button-name would have flagged it on a ReleasesTab scan that doesn't exist.
- **Fix:** Add axe checks inside existing e2e specs that already open the wizard/RepoDetail/Settings (reuse checkA11y after the surface renders); then promote 'serious' to blocking with a short documented allowlist, per the escalation path the helper's own comment describes.

#### [MEDIUM] Interactive controls nested inside role="button" rows (RepoCard, PR/Issue rows) — axe nested-interactive

- **Status:** known-open · **Effort:** M
- **Evidence:** src/components/RepoList/RepoCard.jsx:117-123 — card root is role="button" tabIndex=0 with inner action buttons (:41-56, :170); src/components/RepoDetail/PullRequestsTab.jsx:276-293 — Card role="button" containing Merge/Close Buttons (:321-325) and a View link (:312-316); IssuesTab.jsx:247-251 same. Acknowledged as parked debt in e2e/a11y-helpers.js:8-11 ("a RepoCard refactor for nested-interactive").
- **Impact:** ARIA role=button treats descendants as presentational — some screen readers hide or misreport the inner Merge/Delete/View controls, and the row's accessible name swallows all inner text; axe rates this serious (currently unblocked by the gate).
- **Fix:** Restructure rows so the row itself is a plain container with one primary action link/button (title as the clickable element) and sibling action buttons — or at minimum keep the current UX but move role=button onto an absolutely-positioned overlay button (the 'card action cover' pattern), leaving inner controls as real siblings in the a11y tree.

#### [MEDIUM] SavedCredentialsPicker is a bespoke dropdown with no expanded/menu semantics, no Escape, no outside-click

- **Status:** known-open · **Effort:** M
- **Evidence:** src/components/MigrationWizard/steps/SourceStep/SavedCredentialsPicker.jsx:93-158 — trigger button has no aria-expanded/aria-haspopup (:93-105); open list is a plain <ul> of buttons (:107-157); grep for role=/onKeyDown/Escape in the file returns only the aria-live at :85-86. Matches PM-10 in docs/reports/2026-06-26-codebase-audit-panel.md (line 898); verified still open.
- **Impact:** Screen-reader users aren't told the token picker expands or that it collapsed; keyboard users can't dismiss it with Escape (must Tab out); state changes are silent — on the credential step of the migration wizard, a security-sensitive choice.
- **Fix:** Consume ui/Select with sections + extraOption ("Paste a different PAT instead") as the 2026-06-26 report already prescribes — Select provides combobox ARIA, Escape, outside-click, and arrow nav for free (Select.jsx:264-272).

#### [MEDIUM] AzureTargetForm ModeCard selection state is color-only (no aria-pressed / radio semantics)

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/TargetConfigStep/AzureTargetForm.jsx:72-91 — ModeCard renders `<button type="button" onClick...>` where the active state is only border/bg classes (:78-80); no aria-pressed or role=radio/aria-checked. Flagged in docs/reports/2026-06-26-codebase-audit-panel.md PL-31 (line 1139: "AzureTargetForm ModeCards ... have the same issue"); its sibling ServerPicker toggle was fixed (ServerPicker.jsx:192 now has aria-pressed) but ModeCard was not.
- **Impact:** Screen-reader users choosing the migration target mode (GitHub vs same/existing/new Azure project) cannot tell which mode is currently selected — a wrong assumption here changes where repos get migrated.
- **Fix:** Wrap the grid in role="radiogroup" aria-label="Target mode" and give each ModeCard role="radio" aria-checked={active} (or minimally aria-pressed={active}), matching the fixed ServerPicker pattern in the same wizard.

#### [LOW] MobileQuickActionsFab menu: Escape works but focus never moves into the menu and there is no arrow-key navigation

- **Status:** known-open · **Effort:** S
- **Evidence:** src/components/MobileQuickActionsFab.jsx:28 — only `if (e.key === 'Escape') setOpen(false)`; role="menu" at :67 and labelled menuitems at :89-91 exist, but no focus-into-menu on open and no roving focus. Matches the 2026-06-26 report finding (line 1165); verified still open.
- **Impact:** Keyboard/switch users who reach the FAB can open the menu but focus stays on the trigger; they must Tab blindly. Mitigated by being a mobile-first surface where touch dominates.
- **Fix:** On open, focus the first menuitem and add ArrowUp/ArrowDown roving focus — copy the 14-line handler from RepoFilterBar.jsx:105-113 which solves exactly this.

#### [LOW] AnimatedCounter ignores prefers-reduced-motion and duplicates the CountUp primitive

- **Status:** new · **Effort:** S
- **Evidence:** src/components/MigrationWizard/steps/AIReview/AnimatedCounter.jsx:11-24 — unconditional requestAnimationFrame easing loop with no reduced-motion check; src/components/ui/CountUp.jsx:24-45 is the existing primitive that renders the final value instantly under reduced motion (`const shown = reduced ? safeTarget : displayed`).
- **Impact:** Users with vestibular/motion sensitivity who set prefers-reduced-motion still get ~1.2s of rapidly mutating numbers in the AI Review step — the one animation class the global CSS kill-switch (design-system.css:306) cannot stop because it is JS-driven state.
- **Fix:** Delete AnimatedCounter and use ui/CountUp (same API shape: value prop) — dedup + a11y fix in one edit.

#### [LOW] Webhook active/inactive state is a color-only dot

- **Status:** new · **Effort:** S
- **Evidence:** src/components/RepoDetail/SettingsTab.jsx:396 — `<div className={"w-2 h-2 rounded-full " + (hook.active ? 'bg-green-500' : 'bg-slate-400')} />` with no text/aria alternative; adjacent row content is only the URL (:397-399).
- **Impact:** Screen-reader users can't tell whether a webhook is active or disabled; low-vision users must distinguish green vs grey at 8px (fails WCAG 1.4.1 use-of-color).
- **Fix:** Follow the in-repo labelled-dot pattern: PRReview/AIInsights/FileRiskBadge.jsx:40-46 uses role="img" + aria-label on the same 8px dot — or add a Badge ("Active"/"Inactive") from ui/Badge.

#### [LOW] Tooltip content is not dismissible with Escape (WCAG 1.4.13)

- **Status:** new · **Effort:** S
- **Evidence:** src/components/ui/Tooltip.jsx:191-199 — dismissal handlers are only onMouseLeave/onBlur/outside-pointerdown (:157-165); no keydown listener while visible, so a focused trigger's tooltip can only be removed by moving focus.
- **Impact:** WCAG 1.4.13 requires hover/focus-triggered content to be dismissible without moving pointer or focus (Escape) — keyboard users can't clear a tooltip that occludes adjacent content; low impact given the small bubbles, but Tooltip is used everywhere so the fix is high leverage.
- **Fix:** In the `visible` effect that already adds pointer listeners (Tooltip.jsx:150-171), also add a keydown listener that hides on Escape without blurring the trigger.

#### [LOW] TabBar's tablist container is itself focusable, creating a duplicate tab stop before the active tab

- **Status:** new · **Effort:** S
- **Evidence:** src/components/ui/TabBar.jsx:66-71 — `<div role="tablist" tabIndex={0} ... onKeyDown={handleKeyDown}>` while tabs already implement roving tabindex (`tabIndex={isActive ? 0 : -1}` at :81).
- **Impact:** Every tabbed surface (Modal tabs, Settings, RepoDetail) costs keyboard users one extra Tab press and announces a focusable element with no action; minor friction multiplied across the app.
- **Fix:** Remove tabIndex={0} from the tablist container (keep onKeyDown — key events bubble from the focused tab); the roving tabindex on the tab buttons is already the correct WAI-ARIA pattern.
