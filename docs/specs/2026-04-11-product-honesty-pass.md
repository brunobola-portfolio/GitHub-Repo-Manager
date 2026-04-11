# Product Honesty & Completeness Pass

**Date:** 2026-04-11
**Status:** Draft
**Scope:** Eliminate all visible vaporware from the product surface: implement the 6 disabled/stub context menu items, wire orphan AI endpoints to working UI, add missing RepoDetail parity (Actions tab + Insights entry point), redesign the Pricing Page without "Coming Soon" labels, introduce a dedicated Roadmap page, rewrite README/ROADMAP.md for honesty, and do a systematic UI polish sweep activating the dormant `ds-*` design system.
**Companion spec:** `2026-04-11-licensing-enforcement.md` (separate, to be written after this spec is approved) — handles backend tier gating and activation UX.

---

## Problem

Three months of feature shipping have left the product with a credibility debt:

1. **Vaporware in the primary interaction surface.** The repository context menu exposes 6 items that do not work — three are `disabled: true` with "Coming soon" tooltips ([RepoContextMenu.jsx:68-85](../../src/components/RepoContextMenu.jsx#L68-L85)), one (`Sync Repository`) is disabled without a fix path, and two (`Dry-Run`, `Export Metadata`) are enabled but fall into the `default` handler fallback in [RepoList.jsx:524](../../src/components/RepoList.jsx#L524) and silently do nothing. Every user who right-clicks a repository can see the gaps.

2. **Orphan AI endpoints in the backend.** Three complete AI features exist server-side but have no UI entry point:
   - `POST /api/ai/readme/enhance` ([ai.js:376](../../server/routes/ai.js#L376)) — `aiApi.enhanceReadme()` exists in [api/ai.js:169](../../src/api/ai.js#L169) but no component calls it.
   - `POST /api/ai/batch-index` ([ai.js:484](../../server/routes/ai.js#L484)) — `aiApi.batchIndex()` exists but no UI triggers it.
   - `CommitGeneratorModal` ([CommitGeneratorModal.jsx](../../src/components/CommitGeneratorModal.jsx)) is rendered by App.jsx via `ModalContext`, but `openModal('showCommitGenerator')` is called nowhere — the modal is unreachable.

   Additionally, the hooks `suggestAI()` and `generateReadmeAI()` are exported from [useAI.js:66,98](../../src/hooks/useAI.js#L66) but destructured by no caller.

3. **Missing RepoDetail parity.** `GitHub Actions Analytics` is advertised in the README but only exists inside `TeamDetails.jsx` (team-level view). [RepoDetail.jsx:17-24](../../src/components/RepoDetail/RepoDetail.jsx#L17-L24) has tabs for Overview, Branches, Releases, Issues, Pull Requests, Settings — no Actions tab. Likewise, `RepoInsightsModal` works but is only reachable from the repo list context menu, never from the detail view.

4. **Marketing promises not backed by code.** [PricingPage.jsx](../../src/components/Pricing/PricingPage.jsx) Enterprise tier advertises "Full migration (Azure + GitLab)". GitLab migration does not exist. The README Roadmap section and ROADMAP.md both list GitLab, Bitbucket, GitHub Enterprise Server, Plugin system, and Mobile app as upcoming work with zero code behind any of it. ROADMAP.md has not been updated since February and omits the six major features shipped in March–April 2026 (PR Review Experience, License Mint Automation, License Badge, Landing Page, Modal System Redesign, Rate Limit UX).

5. **Dormant design system.** A systematic scan of [design-system.css](../../src/design-system.css) versus all components shows that only **27 of 98 components** use `ds-*` classes (27%). Seven premium classes have **zero usages** across the codebase:
   - `ds-animate-fade-in-up`, `ds-animate-scale-in`, `ds-hover-lift`, `ds-hover-glow`, `ds-hover-scale`, `ds-focus-ring*`, `ds-border-glow`.

   `ds-card-shimmer`, `ds-btn-shimmer`, and `ds-gradient-text` each exist but are used in fewer than 10 places. [Skeleton.jsx:4](../../src/components/ui/Skeleton.jsx#L4) applies `animate-pulse` Tailwind instead of the premium `ds-skeleton` shimmer. [Card.jsx](../../src/components/ui/Card.jsx) accepts a `hover={true}` prop that does nothing. These are not new features — they are already-paid-for design investment that is not being applied.

6. **Dead code.** [ProgressBar.jsx](../../src/components/ui/ProgressBar.jsx) (77 lines) is imported by nothing. [WelcomeHero.jsx](../../src/components/WelcomeHero.jsx) (337 lines) needs verification — if it is genuinely orphan, it must go.

The sum of these issues is a product that feels larger than it is on the surface, while being more complete than it appears under the hood. This spec closes the gap in both directions.

## Goals

1. **Zero vaporware in any user-visible surface.** Every menu item, button, tab, and pricing feature that the user can see must either work or not appear.
2. **Every backend capability has a UI entry point.** No orphan endpoints, no orphan modals, no orphan hooks.
3. **RepoDetail has feature parity with the advertised feature set** — Actions tab and Insights entry point.
4. **Pricing Page shows only features that work today.** "Coming Soon" and "Future Release" labels live in a new dedicated Roadmap surface, never mixed with the buy decision.
5. **A new Tier Matrix** is reflected in Pricing Page, README, and documentation. Free becomes more generous (to build a community), Pro gains features that are already built (to show value), Enterprise gets compliance + scale (honestly scoped).
6. **The dormant `ds-*` design system is activated systematically** across components, raising perceived visual quality without adding new CSS.
7. **README.md and ROADMAP.md are rewritten for honesty** — they accurately describe what ships today versus what is planned.
8. **All new code is covered by unit + e2e tests** before shipping.

## Non-goals

- **No retroactive `requireTier` gating on pre-existing endpoints.** Adding `requireTier('pro')` to `/ai/search`, adding `requireTier('enterprise')` to `/api/v1/audit`, team members limit validation, and API keys limit validation are all explicitly deferred to the companion spec `2026-04-11-licensing-enforcement.md`. **Exception:** new endpoints introduced by this spec (export, sync, compare, security) include `requireTier` from day one because it would be absurd to ship them without gates.
- **No `LicenseActivationModal`, no expiry warnings in `LicenseBadge`, no usage dashboard.** All deferred to the companion spec.
- **Rate limiting (`checkUsageLimit` + `incrementUsage`) on existing AI endpoints IS in scope** — see Wave 2.6. The reason it is not deferred: without consistent rate limiting, the new Tier Matrix is unenforceable at the product surface and the Pricing Page would be lying about quotas. This is a narrow, surgical wiring pass that does not require any middleware redesign.
- **No new AI models or AI providers.** Continue using Gemini via `aiService`. No OpenAI, Claude, or local model integration in this spec.
- **No new icon library, font, or external assets.**
- **No new runtime dependencies.** `simple-git`, `octokit`, `framer-motion`, `lucide-react` are all already installed.
- **No refactor of the existing `MigrationWizard`** — wave 1 only adds new entry points that open it in specific states.
- **No refactor of `ModalContext`.** New modals register through the existing pattern.
- **No GitLab, Bitbucket, or GHES import code.** Those become honest entries in the new Roadmap page.
- **No new Azure DevOps on-premise code.** Also goes to the Roadmap page as "Coming Soon".
- **No Plugin system, no Mobile app, no SSO/SAML, no Advanced Analytics dashboards.** All go to Roadmap as "Later".

---

## Tier Matrix (final, what the new Pricing Page will reflect)

| Feature | **Free** | **Pro** | **Enterprise** |
|---|---|---|---|
| Repositories managed | **50** | ∞ | ∞ |
| AI queries / month | **100** | **2,000** | ∞ |
| Dashboard + Dark mode + Keyboard shortcuts | ✅ | ✅ | ✅ |
| Community Health Dashboard | ✅ | ✅ | ✅ |
| Dry-Run Migration (simulate) | ✅ | ✅ | ✅ |
| Export Metadata (JSON) | ✅ | ✅ | ✅ |
| Repo Insights / Quality Report | ✅ 5 / month | ✅ unlimited | ✅ unlimited |
| README Generator (AI) | ✅ 3 / month | ✅ unlimited | ✅ unlimited |
| Commit Generator (AI) | ✅ 20 / month | ✅ unlimited | ✅ unlimited |
| Basic Bulk on own repos (archive, delete, visibility) | ✅ | ✅ | ✅ |
| Basic Search & Filters | ✅ | ✅ | ✅ |
| API Keys | **2** | **10** | **50** |
| — | — | — | — |
| Semantic Search (AI) | ❌ | ✅ | ✅ |
| AI Assistant (conversational chat) | ❌ | ✅ | ✅ |
| Azure DevOps Cloud Migration | ❌ | ✅ | ✅ |
| Migration Risk Analysis (AI) | ❌ | ✅ | ✅ |
| Advanced Bulk (transfer, mirror, cross-org) | ❌ | ✅ | ✅ |
| Teams collaboration | ❌ | ✅ up to **15** members | ✅ unlimited |
| PR Review Experience | ❌ | ✅ | ✅ |
| Sync Repository (mirror sync) | ❌ | ✅ | ✅ |
| Compare with Existing (semantic) | ❌ | ✅ | ✅ |
| Security & Secrets Scan | ❌ | ✅ | ✅ |
| README Enhance (AI diff) | ❌ | ✅ | ✅ |
| Batch Indexing | ❌ | ✅ | ✅ |
| — | — | — | — |
| Audit Logs | ❌ | ❌ | ✅ |
| Priority Support + SLA | Community | Email | ✅ SLA |

Every row above must be backed by working code by the end of this spec. "Coming Soon" items — **Azure DevOps Server on-premise**, **GitLab Importer**, **Bitbucket Importer**, **GitHub Enterprise Server**, **SSO/SAML**, **Advanced Analytics**, **Plugin System**, **Mobile App** — do not appear in the Pricing Page. They live in the new Roadmap page only.

---

## Solution overview

### Strategy: Three-wave delivery inside a single spec

One spec, one plan, three implementation waves. Each wave is independently shippable and leaves the product in a better state than before. The waves are ordered by risk (lowest first) and by dependency (wave 2 builds on wave 1 infra, wave 3 applies polish to everything wave 1 + 2 introduced).

| Wave | Theme | Wall-clock effort | Ship independently? |
|---|---|---|---|
| **Wave 1** | Zero Vaporware — make every existing menu item work, delete dead code | ~1 day | Yes |
| **Wave 2** | AI Completeness — wire orphan endpoints to UI, implement semantic compare + security scan | ~1.5 days | Yes |
| **Wave 3** | UI Polish & Parity — activate `ds-*`, add ActionsTab, Insights entry, Pricing/Roadmap/README rewrite | ~1 day | Yes |

---

## Wave 1 — Zero Vaporware

### 1.1 Dry-Run (Simulate)

**Current state:** [RepoContextMenu.jsx:55](../../src/components/RepoContextMenu.jsx#L55) dispatches `onAction('dryRun', repo)`. [RepoList.jsx:524](../../src/components/RepoList.jsx#L524) falls into the `default` case and calls `onQuickAction(action, data)`, which has no handler for `dryRun` → no-op.

**Solution:** Dry-Run opens the existing MigrationWizard with its `dryRun` flag pre-selected. The wizard already supports `isDryRun:true` on `POST /api/migration/plans` ([migration.js:56](../../server/routes/migration.js#L56)) and the `TransferModal` already has a "Simulate" checkbox.

**Changes:**
- [RepoList.jsx](../../src/components/RepoList.jsx): add a handler for `dryRun` that calls `openModalWithData('showMigrationWizard', { targetRepo: repo, initialDryRun: true })`.
- [MigrationWizard/index.jsx](../../src/components/MigrationWizard/): accept `initialDryRun` prop from modal data and set it on the wizard's initial state.
- Batch variant: `dryRun_selected` (from [RepoContextMenu.jsx:131](../../src/components/RepoContextMenu.jsx#L131)) opens the wizard with all selected repos and dryRun=true.
- No backend changes.

**UX:** The wizard header gains a persistent yellow pill "Dry-Run Mode" when `isDryRun=true`, and the final step says "Simulate" instead of "Execute". The existing dry-run implementation already returns a simulated plan with zero side effects on GitHub — the only gap is the entry point.

### 1.2 Migration Risk Analysis (shortcut)

**Current state:** [RepoContextMenu.jsx:68-73](../../src/components/RepoContextMenu.jsx#L68-L73) has `disabled: true`, tooltip "Coming soon — planned for the migration wizard". The full analysis logic already exists inside [MigrationWizard/steps/AIReviewStep.jsx](../../src/components/MigrationWizard/steps/AIReviewStep.jsx).

**Solution:** Remove `disabled: true`. Wire `onAction('aiRisk', repo)` to open the MigrationWizard with `initialStep: 'ai-review'` and the target repo pre-selected. This is a menu shortcut to an already-shipped wizard step.

**Changes:**
- [RepoContextMenu.jsx:68-73](../../src/components/RepoContextMenu.jsx#L68-L73): remove `disabled` and `tooltip`, keep `onClick`.
- [RepoList.jsx](../../src/components/RepoList.jsx): handler for `aiRisk` opens wizard with `initialStep='ai-review'`.
- [MigrationWizard/index.jsx](../../src/components/MigrationWizard/): accept `initialStep` and jump directly to that step.
- No new endpoint.

**Tier gate:** `aiRisk` is Pro-only at the UI level (the menu item checks `licenseTier !== 'free'`). Backend enforcement is in the companion licensing spec.

### 1.3 Export Metadata (JSON)

**Current state:** [RepoContextMenu.jsx:95](../../src/components/RepoContextMenu.jsx#L95) is enabled but falls into `default` handler → no-op. No backend endpoint.

**Solution:** New endpoint `GET /api/v1/repos/:owner/:repo/export`, returns a structured JSON payload, frontend triggers a browser download.

**New endpoint:** `server/routes/v1/repos-export.js` (new file)

```js
router.get('/repos/:owner/:repo/export', requireAuth, async (req, res) => {
  const { owner, repo } = req.params
  // Fetch repo metadata + topics + languages + contributors + open issues count
  // + open PRs count + release count + branch count from GitHub API via octokit.
  // Aggregate into a single JSON object.
  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: req.session.user.login,
    schemaVersion: 1,
    repository: { /* name, owner, visibility, description, stars, forks, ... */ },
    topics: [...],
    languages: { /* name: bytes */ },
    contributors: [...],
    branches: { count, default },
    issues: { open, closed },
    pullRequests: { open, closed, merged },
    releases: [...],
    community: { health: {...}, files: {...} }
  }
  await auditLog(req, 'repo.export', 'repo', `${owner}/${repo}`, { size: JSON.stringify(payload).length })
  res.setHeader('Content-Disposition', `attachment; filename="${repo}-export-${Date.now()}.json"`)
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify(payload, null, 2))
})
```

Mounted in [server/routes/v1/index.js](../../server/routes/v1/index.js) with the rest of the v1 routes.

**Frontend:**
- New api method `reposApi.exportMetadata(owner, repo)` in `src/api/repos.js` — fetches and triggers download via Blob + anchor element.
- [RepoList.jsx](../../src/components/RepoList.jsx): handler for `exportMeta` calls the api method and shows a toast on success/failure.
- Batch variant: `exportMeta_selected` downloads a single bundle JSON containing an array of repo exports (re-uses the same endpoint in a loop or a new bulk endpoint `POST /api/v1/repos/bulk-export`).

**Tier gate:** Free (per the new Tier Matrix). Available to all users for data portability.

### 1.4 Sync Repository

**Current state:** [RepoContextMenu.jsx:94](../../src/components/RepoContextMenu.jsx#L94) is `disabled: true`, tooltip "Only available for mirrored repos".

**Solution:** Detect mirrored repos via a new metadata flag, enable the menu item conditionally, and implement the sync backend using `simple-git` (already used for imports in [server/import-service.js](../../server/import-service.js)).

**New endpoint:** `POST /api/v1/repos/:owner/:repo/sync` in `server/routes/v1/repos-sync.js`

```js
router.post('/repos/:owner/:repo/sync', requireAuth, requireTier('pro'), async (req, res) => {
  // Look up the mirror source from migration_jobs table
  // (field already tracks imported-from URL for mirrored repos).
  const job = db.prepare(
    `SELECT source_url FROM migration_jobs WHERE target_owner=? AND target_repo=? AND is_mirror=1 ORDER BY id DESC LIMIT 1`
  ).get(req.params.owner, req.params.repo)
  if (!job) return res.status(404).json({ error: 'Not a tracked mirror' })
  // git clone --mirror source into temp dir
  // git push --mirror target
  // Return { syncedAt, commits: { behind, ahead }, duration }
  await auditLog(req, 'repo.sync', 'repo', `${owner}/${repo}`, { sourceUrl: job.source_url })
})
```

**Schema change:** `migration_jobs` table gets a new column `is_mirror INTEGER DEFAULT 0`. Migration adds it via `ALTER TABLE`. A repo is marked as mirror if it was created via the existing Mirror/Fork flow ([TransferModal.jsx](../../src/components/TransferModal.jsx) mirror mode → [bulk.js:204](../../server/routes/bulk.js#L204)). Backfill: mark any repos in `migration_jobs` where the import was a `--mirror` clone.

**Frontend:**
- [RepoContextMenu.jsx:94](../../src/components/RepoContextMenu.jsx#L94): remove `disabled: true`, replace with conditional `disabled: !repo.isMirror` and tooltip "Only available for mirrored repos".
- `useRepoDetail` (or `useGitHub`) extends the repo object with `isMirror: boolean` via a join against `migration_jobs`.
- New toast on sync: "Synced N commits from {sourceUrl}".
- Visual badge "Mirror" on repo cards in `RepoList.jsx` when `repo.isMirror=true`.

**Tier gate:** Pro (new endpoint adds `requireTier('pro')` from day one — this is the narrow exception to the non-goal above).

### 1.5 Dashboard "Coming Soon" placeholder cleanup

**Current state:** [DashboardPremium.jsx:198-204, 223-229](../../src/components/Dashboard/DashboardPremium.jsx#L198-L229) renders two `<EmptyState />` cards titled "Pull Request Analytics Coming Soon" and "GitHub Actions Dashboard Coming Soon".

**Solution:** Replace both with real widgets. By the end of Wave 3 the app has a real ActionsTab in RepoDetail and the PR Review Experience is shipped — the dashboard should show aggregate versions:
- "Pull Request Analytics" card aggregates open PR count + review-awaiting count across all repos from the existing PR Review data layer.
- "GitHub Actions" card shows total workflow runs in the last 7 days (success/failure split) from the same data source as the new ActionsTab (Wave 3).

If aggregation proves too expensive for this spec, the fallback is to replace the placeholders with a link to the new RoadmapPage ("See what's next →") rather than leaving them as static "Coming Soon" cards.

### 1.6 Delete orphan code

| File | Action | Reason |
|---|---|---|
| [src/components/ui/ProgressBar.jsx](../../src/components/ui/ProgressBar.jsx) (77 lines) | Delete | Imported by zero files |
| [src/components/WelcomeHero.jsx](../../src/components/WelcomeHero.jsx) (337 lines) | Verify, then delete if orphan | Possibly used by landing page — grep must confirm |
| `suggestAI()` in [src/hooks/useAI.js:66-91](../../src/hooks/useAI.js#L66) | Delete | Exported, destructured by nothing |
| `generateReadmeAI()` in [src/hooks/useAI.js:98-116](../../src/hooks/useAI.js#L98) | Delete | Exported, destructured by nothing |

Deletion is done only after a `grep -r` confirms zero usages, and the imports in the respective files are cleaned up.

### 1.7 Wave 1 tests

- Unit test for new `reposApi.exportMetadata()` (fetch mock + blob URL creation).
- Unit test for new `POST /api/v1/repos/:owner/:repo/export` endpoint (permissions + payload shape).
- Unit test for `POST /api/v1/repos/:owner/:repo/sync` (permissions + mirror detection + error when not mirrored).
- E2E test `e2e/context-menu-wave-1.spec.js`:
  1. Dry-Run opens wizard with dry-run pill visible
  2. Migration Risk Analysis opens wizard directly on AI Review step
  3. Export Metadata triggers a file download
  4. Sync Repository is disabled for non-mirrored repos and enabled for mirrored ones

---

## Wave 2 — AI Completeness

### 2.1 Wire `CommitGeneratorModal` to a real entry point

**Current state:** [CommitGeneratorModal.jsx](../../src/components/CommitGeneratorModal.jsx) is registered in ModalContext and rendered in App.jsx, but `openModal('showCommitGenerator')` is called nowhere.

**Solution:** Add "Generate Commit Message" as an AI submenu item in the repository context menu, accessible only when the repo detail view has a selected branch (for staging context). In absence of branch context, the action is also available from [BranchesTab.jsx](../../src/components/RepoDetail/BranchesTab.jsx) as a per-branch button.

**Changes:**
- [RepoContextMenu.jsx:63](../../src/components/RepoContextMenu.jsx#L63): add new AI submenu entry "Generate Commit Message" that calls `onAction('aiCommit', repo)`.
- [BranchesTab.jsx](../../src/components/RepoDetail/BranchesTab.jsx): per-branch "✨ AI Commit" button that opens the modal pre-populated with branch context.
- [RepoList.jsx](../../src/components/RepoList.jsx): `aiCommit` handler → `openModalWithData('showCommitGenerator', { repo, branch })`.
- [CommitGeneratorModal.jsx](../../src/components/CommitGeneratorModal.jsx): extend to accept `repo` + `branch` from modal data and pre-fill context.

**Tier gate:** Free, with 20 generations / month limit per the new Tier Matrix.

### 2.2 Wire `README Enhance` orphan endpoint

**Current state:** `POST /api/ai/readme/enhance` works, `aiApi.enhanceReadme()` exists, no UI.

**Solution:** Add an "Enhance with AI" button on the README tab of `RepoInsightsModal`. Clicking opens a new sub-panel showing a side-by-side diff of current README vs AI-enhanced README, with "Apply" and "Copy" buttons.

**Changes:**
- [src/components/AI/RepoInsightsModal.jsx](../../src/components/AI/RepoInsightsModal.jsx): new button "Enhance README" in the README tab.
- New component `src/components/AI/ReadmeEnhanceDiffPanel.jsx` — renders diff using a lightweight inline diff library already available (`diff` package if installed, otherwise hand-rolled word-level diff — inspect package.json first).
- No backend changes.

**Tier gate:** Pro.

### 2.3 Wire `Batch Indexing` orphan endpoint

**Current state:** `POST /api/ai/batch-index` exists, accepts up to 10 repos per call, no UI.

**Solution:** New bulk action "AI → Batch Index Selected" in [RepoList.jsx](../../src/components/RepoList.jsx) bulk menu. Opens a progress modal showing live progress (N/M repos indexed), successes, failures.

**Changes:**
- [RepoContextMenu.jsx:117+](../../src/components/RepoContextMenu.jsx#L117) (batch section): new entry "Batch Index with AI" that calls `onAction('aiBatchIndex_selected', selected)`.
- New component `src/components/AI/BatchIndexProgressModal.jsx`.
- [RepoList.jsx](../../src/components/RepoList.jsx): `aiBatchIndex_selected` handler chunks the selection into groups of 10, calls the endpoint, aggregates results, updates progress modal.

**Tier gate:** Pro.

### 2.4 Compare with Existing

**Current state:** [RepoContextMenu.jsx:74-79](../../src/components/RepoContextMenu.jsx#L74-L79) is `disabled: true` with tooltip "Coming soon — will use semantic search to find similar repos".

**Solution:** Reuse the existing vector embeddings infrastructure behind `/api/ai/search`. New mode on that endpoint: `?mode=similar-by-id&repoId=<id>` returns the top K repos most similar by cosine distance.

**Backend change:** Extend [server/routes/ai.js](../../server/routes/ai.js) handler for `/ai/search` to accept `mode=similar-by-id`. When that mode is active, the handler looks up the embedding vector for the given repo, finds the top 5 nearest neighbors (excluding the repo itself) via the existing vector index, and returns them with similarity scores.

**Indexing precondition:** Semantic similarity depends on a vector embedding existing for the target repo. If the repo has not been indexed yet (not in the `repo_embeddings` table or equivalent), the drawer:

1. Shows a first-state "This repository has not been indexed yet — index now?" CTA.
2. Clicking the CTA calls `aiApi.indexRepo(repo)` with a progress indicator.
3. On completion, automatically re-fetches the similar-by-id results.

This avoids silent empty states and gives the user a clear one-click path to the real feature.

**Frontend:**
- [RepoContextMenu.jsx:74-79](../../src/components/RepoContextMenu.jsx#L74-L79): remove `disabled`. Wire `onAction('aiCompare', repo)`.
- New component `src/components/AI/CompareSimilarDrawer.jsx` — right-side slide-in drawer showing:
  - Top 5 similar repos as cards with similarity score (0-100%)
  - Tech stack diff per pair (language breakdown comparison)
  - "Open" button per result
  - Empty state when nothing is above a 50% similarity threshold
  - Index-first state described above when the target repo lacks an embedding

**Tier gate:** Pro (semantic search is already Pro-only in the tier matrix).

### 2.5 Security & Secrets Scan

**Current state:** [RepoContextMenu.jsx:81-85](../../src/components/RepoContextMenu.jsx#L81-L85) is `disabled: true` with tooltip "Coming soon — credential & vulnerability scanning".

**Solution:** GitHub already exposes native security scanning alerts via three APIs. Aggregate them into one view.

**New endpoint:** `GET /api/v1/repos/:owner/:repo/security` in `server/routes/v1/repos-security.js`

```js
router.get('/repos/:owner/:repo/security', requireAuth, requireTier('pro'), async (req, res) => {
  const { owner, repo } = req.params
  const octokit = getUserOctokit(req)
  // Fire all three requests in parallel, each wrapped in a try/catch that converts
  // 403 (insufficient token scope) into { available: false } instead of failing the whole request.
  const [secretScanning, codeScanning, dependabot] = await Promise.allSettled([
    octokit.rest.secretScanning.listAlertsForRepo({ owner, repo, state: 'open' }),
    octokit.rest.codeScanning.listAlertsForRepo({ owner, repo, state: 'open' }),
    octokit.rest.dependabot.listAlertsForRepo({ owner, repo, state: 'open' })
  ])
  const result = {
    secretScanning: parseSettled(secretScanning),
    codeScanning: parseSettled(codeScanning),
    dependabot: parseSettled(dependabot),
    summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
  }
  // Sum severities across all three sources into result.summary
  await auditLog(req, 'repo.security-scan', 'repo', `${owner}/${repo}`, { total: result.summary.total })
  res.json(result)
})
```

Each of the three APIs can return 403 if the authenticated user's token lacks `security_events` scope or if the feature is disabled on the repo. The helper `parseSettled` converts those into `{ available: false, reason: '...' }` so the overall request still succeeds with partial data.

**Frontend:**
- [RepoContextMenu.jsx:81-85](../../src/components/RepoContextMenu.jsx#L81-L85): remove `disabled`. Wire `onAction('aiSecurity', repo)`.
- New component `src/components/security/SecurityScanModal.jsx`:
  - Header with severity donut chart (critical / high / medium / low)
  - Three expandable sections (Secret Scanning, Code Scanning, Dependabot) — each shows either the alerts list with severity badges or an "unavailable" banner if the API returned `{ available: false }`
  - Empty state when total=0: "No open security alerts — this repository is clean."
  - Link to GitHub's native security tab for each alert

**Tier gate:** Pro.

### 2.6 Rate limiting consistency across `/ai/*`

**Current state:** Only `/ai/chat` calls `checkUsageLimit()` and `incrementUsage()`.

**Solution (within this spec's scope):** The new `/ai/*` endpoints introduced in this spec (`/ai/search?mode=similar-by-id`, `/ai/readme/enhance` UI wiring) wire `checkUsageLimit()` from day one. The retroactive fix for existing `/ai/suggest`, `/ai/readme`, `/ai/readme/enhance`, `/ai/quality-report`, `/ai/batch-index` endpoints is explicitly in scope here (not deferred to Spec 2) because they are required for the tier matrix to be enforceable at all.

**Changes:**
- Add `checkUsageLimit(userId, 'ai_queries')` + return 429 if exceeded + `incrementUsage(userId, 'ai_queries')` on success to: `/ai/suggest`, `/ai/readme`, `/ai/readme/enhance`, `/ai/quality-report`, `/ai/batch-index`.
- Batch indexing increments by `repos.length` (not 1) to reflect true cost.
- Add audit logging to every `/ai/*` endpoint: `auditLog(req, 'ai.<action>', 'ai', null, { repoId, tokensUsed })`.

### 2.7 `/ai/readme` hardening

[server/routes/ai.js:231-259](../../server/routes/ai.js#L231-L259) currently has no prompt sanitization (unlike `/ai/chat`) and no model availability fallback. Add:
- `sanitizeForPrompt()` on inputs.
- Model availability check + fallback to `gemini-2.5-flash-lite` when primary model returns 404.
- Structured JSON response: `{ success, readme, model, tokensUsed }`.

### 2.8 Wave 2 tests

- Unit: `ReadmeEnhanceDiffPanel` renders diff correctly.
- Unit: `CompareSimilarDrawer` renders empty state and populated state.
- Unit: `SecurityScanModal` handles all three alert sources + their `{ available: false }` fallback.
- Unit: `/api/ai/search?mode=similar-by-id` returns top K neighbors.
- Unit: `/api/v1/repos/:owner/:repo/security` handles partial availability gracefully.
- E2E `e2e/ai-completeness-wave-2.spec.js`:
  1. Commit Generator opens from BranchesTab
  2. Enhance README button generates and shows diff
  3. Batch Index from bulk menu shows progress modal
  4. Compare with Existing opens drawer with similar repos
  5. Security Scan opens modal with severity breakdown

---

## Wave 3 — UI Polish & Parity

### 3.1 `ds-*` design system activation sweep

Seven classes have zero usages, three are dramatically underused. This wave applies them systematically with the following rules:

| `ds-*` class | Apply to | Via |
|---|---|---|
| `ds-hover-lift` | All `<Card hover />`, pricing cards, dashboard stat cards, repo cards, team cards | Add to className when `hover` prop true |
| `ds-card-shimmer` | All premium cards (pricing tiers, featured dashboard widgets, RepoInsightsModal) | ClassName patch |
| `ds-btn-shimmer` | All primary buttons across the app | [Button.jsx](../../src/components/ui/Button.jsx) — add to `variants.primary` |
| `ds-gradient-text` | All H1 and H2 in Landing, Pricing, Dashboard, Roadmap | Global sweep |
| `ds-focus-ring` | All interactive elements currently using `focus-visible:ring-*` | Button, Input, IconButton |
| `ds-animate-fade-in-up` | Modal body content, card grids on first mount | Wrap in className |
| `ds-animate-scale-in` | Icons inside EmptyState, toast notifications | ClassName |
| `ds-border-glow` | Active tier card on PricingPage, selected item in lists | Conditional className |
| `ds-hover-glow` | CTA buttons in Landing and Pricing | ClassName |
| `ds-hover-scale` | Icon buttons (close, refresh, menu) | ClassName |

The sweep is done component-by-component. For each file that receives `ds-*` classes, the existing visual behavior must be preserved — `ds-hover-lift` is additive, not a replacement.

### 3.2 `Skeleton.jsx` upgrade

[Skeleton.jsx:4](../../src/components/ui/Skeleton.jsx#L4) currently:

```jsx
<div className={`animate-pulse bg-slate-200 dark:bg-slate-800 rounded ${className}`} />
```

Upgrade to:

```jsx
<div className={`ds-skeleton ${className}`} role="status" aria-busy="true" aria-label="Loading" />
```

The `ds-skeleton` class already contains the shimmer gradient and dark mode variants. Add a `variant` prop for common shapes: `text`, `title`, `avatar`, `card`, `button`.

### 3.3 `Card.jsx` hover lift

[Card.jsx](../../src/components/ui/Card.jsx) has a `hover` prop that currently does nothing. Implement:

```jsx
const hoverClasses = hover ? 'ds-hover-lift cursor-pointer' : ''
```

Add a Framer Motion `whileHover={{ y: -2 }}` wrapper when `hover=true`.

### 3.4 EmptyState sweep in RepoDetail tabs

Replace fallback text with the `<EmptyState />` component:
- [OverviewTab.jsx:57-59](../../src/components/RepoDetail/OverviewTab.jsx#L57-L59): `<p>No README found</p>` → `<EmptyState icon={BookOpen} title="No README" description="This repository doesn't have a README yet." action={{ label: 'Generate with AI', onClick }} />`
- [IssuesTab.jsx](../../src/components/RepoDetail/IssuesTab.jsx): empty list → EmptyState with Circle icon
- [BranchesTab.jsx](../../src/components/RepoDetail/BranchesTab.jsx): empty list → EmptyState with GitBranch icon
- [ReleasesTab.jsx](../../src/components/RepoDetail/ReleasesTab.jsx): empty list → EmptyState with Tag icon
- [PullRequestsTab.jsx](../../src/components/RepoDetail/PullRequestsTab.jsx): empty list → EmptyState with GitPullRequest icon

### 3.5 Transitions standardization

Introduce a CSS custom property in [design-system.css](../../src/design-system.css):

```css
:root {
  --ds-transition-standard: 0.2s var(--ds-ease-out-expo);
  --ds-transition-fast: 0.12s var(--ds-ease-out-expo);
  --ds-transition-slow: 0.35s var(--ds-ease-spring);
}
```

Sweep the codebase for hardcoded `transition-all duration-150`, `duration-200`, `duration-300` and replace with the appropriate standard via a utility class `ds-transition-standard` or inline style.

### 3.6 RepoDetail ActionsTab

Copy the actions tab logic from [TeamDetails.jsx:245-300](../../src/components/Teams/TeamDetails.jsx#L245-L300) (workflow listing + run trigger + run history) into a new tab component `src/components/RepoDetail/ActionsTab.jsx`. Adapt it from team-scoped to repo-scoped.

**Changes:**
- New file: `src/components/RepoDetail/ActionsTab.jsx`
- [RepoDetail.jsx:17-24](../../src/components/RepoDetail/RepoDetail.jsx#L17-L24): add `{ id: 'actions', label: 'Actions', icon: Zap }` between `releases` and `issues`.
- Backend reuse: the existing team workflow endpoint generalizes to per-repo or a thin wrapper reuses `octokit.rest.actions.listRepoWorkflows()`.
- Permissions: ActionsTab gracefully handles repos without Actions enabled (shows EmptyState with "Actions not enabled" message).

### 3.7 RepoDetail Insights entry point

On [OverviewTab.jsx](../../src/components/RepoDetail/OverviewTab.jsx), add a new card "AI Insights" with a button "View Quality Report" that calls `openModal('showRepoInsights', { repo, initialTab: 'quality' })`. The modal infrastructure already exists and works.

### 3.8 New Pricing Page

Rewrite [PricingPage.jsx](../../src/components/Pricing/PricingPage.jsx) with:
- Three tier cards reflecting the final Tier Matrix from this spec.
- `ds-border-glow` on the user's current tier.
- `ds-card-shimmer` on all three cards.
- Feature rows with tooltips "Why this tier?" on hover.
- Zero "Coming Soon" badges. Zero "Future Release" badges.
- A footer link: "See what's next on our Roadmap →" pointing to the new RoadmapPage (Wave 3.9).
- The "Enterprise" card has a "Contact Sales" CTA that captures the email and routes to `bruno@bolalabs.pt`.
- Remove the line "Full migration (Azure + GitLab)" from the Enterprise feature list.

### 3.9 New Roadmap page

New route: `/roadmap` → `src/components/Roadmap/RoadmapPage.jsx`.

Layout: vertical timeline with three stages:
- **Shipping Now (Q2 2026)** — features currently in active development that will ship within 1-2 months
- **Next (Q3 2026)** — features scoped, committed, on the timeline
- **Later (Q4 2026+)** — features on the wishlist, under exploration, no committed date

Each stage is a colored column (green/amber/blue) with cards per feature. Cards include:
- Feature name
- Short description
- Tier destination (Free / Pro / Enterprise)
- Optional "Vote" button that captures interest (local storage for now, email list integration later)

**Initial Roadmap content:**

**Shipping Now (Q2 2026):**
- Azure DevOps Server (on-premise) support → Enterprise
- GitLab migration importer → Pro + Enterprise
- Advanced Analytics dashboard (commit heatmaps, contributor insights) → Enterprise
- Dependency graph visualizer → Pro
- CODEOWNERS generator + validator → Free

**Next (Q3 2026):**
- Bitbucket migration importer → Pro + Enterprise
- SSO / SAML (Okta, Azure AD) → Enterprise
- Backup & Restore system → Enterprise
- Security Alerts Dashboard (cross-repo CVE aggregation) → Pro
- SBOM export (CycloneDX, SPDX) → Enterprise
- Release Notes Generator (AI, via commits + PRs) → Pro

**Later (Q4 2026+):**
- GitHub Enterprise Server support → Enterprise
- Plugin / Extension system → Free + Pro
- Mobile app (React Native) → all tiers
- Custom AI model selection (OpenAI, Claude, local) → Pro + Enterprise
- Org Permissions Sync → Enterprise
- Dependabot aggregation (multi-repo review) → Pro
- Custom Workflow Templates → Pro

### 3.10 README.md rewrite

Sweeping update to [README.md](../../README.md):
- **Features section**: remove or rewrite any line that does not correspond to working code. Specifically: remove "Full migration (Azure + GitLab)", remove GitLab/Bitbucket from the Migration feature description, add PR Review Experience, add License Badge, add Landing Page.
- **Roadmap section**: replace with a two-line pointer to the new `/roadmap` page and to `ROADMAP.md`.
- **Pricing section**: reflect the new Tier Matrix.
- **Recently Shipped** subsection: add entries for every feature shipped in March-April 2026 that is currently missing.
- **Self-hosted setup**: add a note pointing to the companion licensing spec's activation flow (once Spec 2 ships).

### 3.11 ROADMAP.md rewrite

[ROADMAP.md](../../ROADMAP.md) becomes a thin file that mirrors the Roadmap page content structure: the three stages (Now / Next / Later) with the same feature lists. It should be short — the source of truth is the `/roadmap` React page.

### 3.12 Wave 3 tests

- Unit: new `ActionsTab` renders workflows, handles disabled-actions empty state.
- Unit: new `Skeleton` variants render correctly.
- Unit: new `Card` with `hover=true` applies lift classes.
- Unit: `RoadmapPage` renders all three stages with the correct feature counts.
- E2E `e2e/ui-polish-wave-3.spec.js`:
  1. RepoDetail has an Actions tab and clicking it shows the workflows list
  2. OverviewTab "View Quality Report" opens the Insights modal
  3. PricingPage renders without any "Coming Soon" labels
  4. RoadmapPage loads and shows the three stages

---

## Architecture — shared concerns

### Modal infrastructure

All new modals in this spec (`ReadmeEnhanceDiffPanel` as sub-panel, `BatchIndexProgressModal`, `CompareSimilarDrawer`, `SecurityScanModal`) use the existing `<Modal />` primitive from [src/components/ui/Modal.jsx](../../src/components/ui/Modal.jsx). None are hand-rolled.

`CompareSimilarDrawer` is a drawer, not a modal — it uses [MobileDrawer.jsx](../../src/components/MobileDrawer.jsx) or a similar side-drawer primitive if one exists, else introduces a new thin `<Drawer />` variant.

### ModalContext registration

Any new modal is registered in [src/contexts/ModalContext.jsx](../../src/contexts/ModalContext.jsx) following the existing pattern. No orphan `openModal('showX')` calls — every new key is wired to a real component mounted in [App.jsx](../../src/App.jsx).

### API layer

All new frontend API methods live in `src/api/` following the existing module pattern (`src/api/ai.js`, `src/api/repos.js`, etc.). No inline fetch calls in components.

### Auditing

Every new backend endpoint calls `auditLog(req, action, entityType, entityId, metadata)` from [server/lib/audit.js](../../server/lib/audit.js) on both success and failure. Existing endpoints also gain audit calls as part of Wave 2.6.

### Visual consistency

Every new component uses:
- Framer Motion for entrance animations (stagger, fade-in-up, scale-in)
- Lucide icons (no new icon library)
- Tailwind + `ds-*` classes (never hardcoded colors)
- Dark mode variants via `dark:` prefix
- Loading states via `<Skeleton />` (not spinners, except for buttons)
- Empty states via `<EmptyState />` (not `<p>No X found</p>`)
- Error states via Card with `bg-red-50 dark:bg-red-950/30 border-red-200` pattern

---

## Data flow — complete picture

For the 6 context menu items after Wave 1 + Wave 2:

```
User right-clicks repo card
  → RepoContextMenu renders
    → click "Migration → Dry-Run"
      → onAction('dryRun', repo)
        → RepoList handler
          → openModalWithData('showMigrationWizard', { targetRepo, initialDryRun: true })
            → MigrationWizard mounts with dryRun pill visible
              → Execute → POST /api/migration/plans { isDryRun: true }
                → auditLog + returns simulated plan
                → Toast "Dry-run complete — no changes applied"

    → click "Migration → Migration Risk Analysis"
      → onAction('aiRisk', repo)
        → openModalWithData('showMigrationWizard', { targetRepo, initialStep: 'ai-review' })
          → Wizard jumps directly to AIReviewStep
            → Existing step renders Gemini-powered risk analysis

    → click "Management → Export Metadata (JSON)"
      → onAction('exportMeta', repo)
        → reposApi.exportMetadata(owner, repo)
          → GET /api/v1/repos/:owner/:repo/export
            → Aggregates from octokit + db
            → Returns Content-Disposition: attachment
          → Browser downloads file
          → Toast "Exported {repo}-export-{ts}.json"

    → click "Management → Sync Repository" (only enabled if repo.isMirror)
      → onAction('sync', repo)
        → ConfirmModal "Sync {repo} from {sourceUrl}?"
          → reposApi.syncMirror(owner, repo)
            → POST /api/v1/repos/:owner/:repo/sync
              → Look up source in migration_jobs
              → simple-git clone --mirror + push --mirror
              → auditLog
              → Returns { syncedAt, commits }
            → Toast "Synced N commits"

    → click "AI → Compare with Existing"
      → onAction('aiCompare', repo)
        → CompareSimilarDrawer opens
          → GET /api/ai/search?mode=similar-by-id&repoId={id}
            → Vector index top-5 nearest neighbors
          → Renders cards with similarity % + tech stack diff

    → click "AI → Security / Secrets Scan"
      → onAction('aiSecurity', repo)
        → SecurityScanModal opens
          → GET /api/v1/repos/:owner/:repo/security
            → Promise.allSettled of 3 octokit calls
            → Aggregates severity summary
          → Renders donut + 3 expandable sections
```

---

## Error handling

| Situation | Handling |
|---|---|
| Dry-Run dispatched but wizard fails to open | Toast error "Could not open wizard. Please try again." |
| Export Metadata endpoint returns 500 | Toast error with request ID from response header |
| Sync on non-mirrored repo | 404 from backend → toast "This repository is not tracked as a mirror." |
| Sync git operation fails mid-flight | Backend returns 500 with partial progress in body → toast with retry CTA |
| Compare returns zero similar repos | Drawer shows EmptyState "No similar repositories found above 50% similarity." |
| Security Scan: token lacks scope on all three APIs | Modal shows a single "Your token does not have `security_events` scope — enable it in Settings to view alerts" banner |
| Security Scan: token lacks scope on one API | That section shows "Unavailable — insufficient permissions" inline, other sections still render |
| Batch Index exceeds rate limit | 429 response → progress modal shows "Rate limit reached, N of M repos indexed" and stops gracefully |
| README Enhance: AI returns malformed content | Diff panel shows "Could not generate enhancement. Please try again." with original README preserved |

All error toasts use the existing [Toast.jsx](../../src/components/ui/Toast.jsx) component with `variant='error'` and include actionable recovery when possible.

---

## Testing strategy

### Unit tests (Vitest)

- **New endpoints:** 3 backend unit tests (`server/__tests__/repos-export.test.js`, `repos-sync.test.js`, `repos-security.test.js`) covering auth, tier gates (where applicable), happy path, error paths, audit logging.
- **New modified AI endpoint:** `server/__tests__/ai-search-similar-mode.test.js` covering the new `mode=similar-by-id` branch.
- **New frontend components:** Vitest + React Testing Library for `ReadmeEnhanceDiffPanel`, `BatchIndexProgressModal`, `CompareSimilarDrawer`, `SecurityScanModal`, `ActionsTab` (RepoDetail), `RoadmapPage`.
- **Modified components:** regression tests for `RepoContextMenu` (new menu items render and dispatch correctly), `Skeleton` (variant prop), `Card` (hover prop), `RepoDetail` (Actions tab present), `PricingPage` (no "Coming Soon" labels).
- **Modified hooks:** test that `useAI.js` no longer exports the deleted hooks.

### E2E tests (Playwright)

Three new spec files, one per wave:
- `e2e/context-menu-wave-1.spec.js` — Dry-Run, Migration Risk, Export Metadata, Sync Repository.
- `e2e/ai-completeness-wave-2.spec.js` — CommitGenerator, README Enhance, Batch Index, Compare, Security Scan.
- `e2e/ui-polish-wave-3.spec.js` — RepoDetail Actions tab, Insights entry, new Pricing page, Roadmap page.

Each spec creates its own test fixtures (mock repos, mock migration_jobs entries, etc.) and does not rely on state from other specs.

### Manual visual QA

Before shipping each wave, run the app manually and verify:
- Every new surface renders with expected `ds-*` classes active (inspect element → confirm `class` attribute contains `ds-hover-lift` etc.)
- Animations play smoothly (no jank at 60fps)
- Dark mode variants work
- Mobile viewport renders correctly (new surfaces gracefully stack or use drawer variants)
- `prefers-reduced-motion: reduce` disables stagger and large movements

---

## Shipping order and rollout

Each wave can ship independently. Recommended order:
1. **Wave 1 first** — no risk, pure win, delivers the "zero vaporware in menus" outcome fast.
2. **Wave 3 next** — UI polish + Pricing/Roadmap/README rewrite. Lower code risk, high visual impact, gives the marketing story honest foundations.
3. **Wave 2 last** — AI completeness is the most code-heavy wave and benefits from the polish of Wave 3 being already in place.

Alternative order (if Wave 2's AI features are business-critical): Wave 1 → Wave 2 → Wave 3. Either ordering is valid.

After all three waves ship, the companion spec **Licensing Enforcement & Activation UX** begins — it handles the retroactive `requireTier` middleware updates for existing endpoints, the LicenseActivationModal, expiry warnings in LicenseBadge, and the Usage dashboard.

---

## Open questions

1. **Does `diff` or similar package exist in `package.json`** for the README Enhance diff view? If not, Wave 2.2 either adds it (allowed as a genuine dependency need) or uses a hand-rolled word-level diff.
2. **Is there an existing Drawer primitive?** `MobileDrawer.jsx` exists but needs inspection to confirm it supports desktop right-side layout for `CompareSimilarDrawer`.
3. **Are the mock mode fixtures rich enough** to populate the new features in demo mode, or do they need extending (e.g. mock security alerts, mock similar-by-id results)?
4. **Should ActionsTab gracefully disable** when the repo does not have GitHub Actions enabled, or hide the tab entirely? Recommendation: show the tab but render an EmptyState inside.
5. **Dashboard "Coming Soon" placeholders**: real aggregation widgets or link to RoadmapPage? Recommendation: link to RoadmapPage as the minimum, upgrade to real aggregation only if the data layer makes it a one-line change.

These are resolved during the implementation plan phase (next step after this spec is approved).

---

## Success metrics

- **Zero** menu items in [RepoContextMenu.jsx](../../src/components/RepoContextMenu.jsx) with `disabled: true` and a "Coming soon" tooltip.
- **Zero** backend AI endpoints without a UI entry point (excluding internal helpers).
- **Zero** orphan `.jsx` files in `src/components/` with no importers.
- **Zero** `"Coming Soon"` or `"Future Release"` labels on [PricingPage.jsx](../../src/components/Pricing/PricingPage.jsx).
- **≥ 70%** of components in `src/components/` use at least one `ds-*` class.
- **100%** of new endpoints have matching unit tests.
- **100%** of new user-facing features have matching e2e tests.
- [ROADMAP.md](../../ROADMAP.md) mentions every feature shipped in March–April 2026.
- [README.md](../../README.md) contains no sentence that does not correspond to working code.
