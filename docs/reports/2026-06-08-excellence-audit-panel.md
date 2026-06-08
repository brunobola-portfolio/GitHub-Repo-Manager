# Excellence Audit Panel — 2026-06-08

**Method:** 8-dimension multi-agent panel (security, pricing-honesty, correctness, a11y, dead-code, test-coverage, perf, maintainability) → adversarial verification → synthesis. Run against `main` after PRs #142–#150.

**Overall:** needs-attention — 22/22 medium+ findings confirmed after adversarial verify.

> Across security, pricing-honesty, accessibility, dead-code, test-coverage, performance, and maintainability dimensions, 20 findings were confirmed against source. One genuine security defect stands out: any authenticated user can drive a server-side SSRF through the BYOK "local" AI provider endpoint, reaching cloud metadata / internal hosts with a body-leaking oracle, because the AI-config path bypasses the SSRF guard the import path already uses. The other high-value cluster is pricing honesty: the "14-day free trial" advertised on two surfaces is never implemented in Stripe checkout (charges immediately, requires a card), and the landing PricingPreview is an unchecked 4th pricing surface still showing stale Free-tier caps (50 repos / 50 searches vs the real 200 / 75) — the parity gate that was supposed to prevent this has structural blind spots (never reads PricingPreview; no assertion on the PR-review row; no trial-vs-Stripe check). Accessibility has a real, app-wide gap: the two custom comboboxes (ui/Select and ModelCombobox) and the PR-review file tree highlight options visually but never expose aria-activedescendant or proper tree/roving-tabindex semantics, so screen-reader users get no announcement while navigating. The remaining items are honest-but-lower: untested sensitive logic (tenant-scoping branches and pure scoring math), an N+1 fetch per repo card, latent SQLite scan patterns, three dead/orphaned modules, and several genuine but non-urgent monolith/duplication refactors. Nothing is at-risk of imminent data loss, but the SSRF plus the live pricing lies warrant prompt attention.

---

## #1 [HIGH] Authenticated SSRF via BYOK "local" AI endpoint URL (no SSRF guard on save or request)
- **Area:** security
- **Where:** `server/lib/validators.js:561,565 -> server/routes/user-ai-config.js (test handler ~158-270) -> server/lib/ai-provider.js:723-726 -> server/lib/providers/local.js:21-28 -> server/lib/providers/openai.js:180,216`
- **Why:** userAIConfigSchema accepts completionEndpointUrl/embeddingEndpointUrl as z.string().url() with no scheme/host restriction, and 'local' is in the provider enum. Any logged-in user can POST /api/user/ai-config/test with completionProvider:'local' + an arbitrary endpointUrl (http://169.254.169.254/..., localhost, RFC1918) and the server fetches it with the supplied Authorization header. The response leaks latencyMs, httpStatus, error code/type, and upstream body via errBody.message, making it a usable semi-blind SSRF reaching cloud metadata / internal services. The import path already uses assertSafeExternalUrl()+resolveAndValidateHost(); the AI path bypasses it entirely (verified: no AI-config file references those helpers).
- **Fix:** Re-validate endpointUrl at request time (not just save) using the existing assertSafeExternalUrl() + resolveAndValidateHost() (https-only, blocks credentials/localhost/RFC1918/link-local + DNS rebinding) in both the POST /api/user/ai-config handler and createProviderForUser as defense-in-depth. Because the 'local' provider legitimately targets loopback/RFC1918, gate arbitrary local endpoints behind an explicit opt-in (env ALLOW_LOCAL_AI_ENDPOINTS or a host allowlist) rather than naively blocking private ranges, and reject everything else.

## #2 [HIGH] "14-day free trial / no credit card" advertised on two surfaces but never implemented in Stripe checkout
- **Area:** pricing-honesty
- **Where:** `src/components/Pricing/PricingPage.jsx:105; src/components/Landing/PricingPreview.jsx:28; server/routes/billing.js:51-58`
- **Why:** The Landing Pro CTA literally reads 'Start 14-day free trial' (the button users click) and the PricingPage FAQ states 'Pro includes a 14-day free trial - no credit card required.' But the checkout session uses mode:'subscription' with a bare line_item and NO subscription_data.trial_period_days / payment_method_collection anywhere (repo-wide grep for trial_period_days in server/ returns zero). The webhook also writes status 'active' and issues a 12-month license immediately. Clicking the CTA initiates an immediate-charge, card-required checkout, directly contradicting both claims - a pricing lie that survived the v3.8.0 honesty audit.
- **Fix:** Either implement the trial: add subscription_data:{ trial_period_days: 14 } and payment_method_collection:'if_required' to stripe.checkout.sessions.create, and honor trialing/trial_end on the success/webhook path. OR remove the trial copy from PricingPage.jsx:105 and PricingPreview.jsx:28. Pick one and make the two surfaces consistent with Stripe config.

## #3 [HIGH] Custom comboboxes (ui/Select + ModelCombobox) never set aria-activedescendant - arrow-key navigation is silent to screen readers
- **Area:** a11y
- **Where:** `src/components/ui/Select.jsx:204-306; src/components/Settings/AIConfig/ModelCombobox.jsx:123-155 + ModelRow.jsx:36-47`
- **Why:** Both render role="combobox" with aria-expanded/aria-controls but NO aria-activedescendant (grep confirms it appears nowhere in src/). ArrowUp/Down only mutate a focusedIndex/highlight that toggles a visual background class; the option elements have no id and are never focused, so an AT user arrowing through hears no change in the active option. ui/Select is the app-wide dropdown primitive (imported by 11+ components incl. RepoFilterBar), making the defect widespread; ModelCombobox is the Settings AI model picker. This is a real WCAG 4.1.2 failure.
- **Fix:** Give each rendered option a stable id (e.g. ${listboxId}-opt-${index}), keep focus on the combobox trigger/input, and set aria-activedescendant to the highlighted option's id (clear it when index < 0). Factor this into one shared listbox helper and apply to both components so they cannot drift independently.

## #4 [MEDIUM] Landing PricingPreview is an unchecked 4th pricing surface with stale Free-tier caps contradicting feature-flags
- **Area:** pricing-honesty
- **Where:** `src/components/Landing/PricingPreview.jsx:15,17 vs server/lib/feature-flags.js:11,28`
- **Why:** The first pricing surface a prospect sees lists 'Up to 50 repositories' and 'Semantic Search (50 / month)', but the source of truth grants free.maxRepos=200 and free.semanticSearchPerMonth=75. These are exactly the two values that previously drifted and were fixed on the other surfaces - but PricingPreview was never wired into the parity gate, so it still understates the Free tier on a conversion-critical public page.
- **Fix:** Update PricingPreview.jsx line 15 to '200 repositories' and line 17 to 'Semantic Search (75 / month)', then extend tests/pricing-feature-parity.test.js to read PricingPreview.jsx and assert its Free numbers against getFeatures('free').maxRepos and .semanticSearchPerMonth so this 4th surface can no longer silently drift. (Combine with rank 6.)

## #5 [MEDIUM] N+1 HTTP requests: MigratedPill fires one /api/migration/marks fetch per repo card (~30 per grid page)
- **Area:** perf
- **Where:** `src/hooks/useMigrationMarks.js:12-29; src/components/RepoList/MigratedPill.jsx:9; src/components/RepoList/RepoCard.jsx:172`
- **Why:** MigratedPill is rendered unconditionally in every RepoCard and runs a per-instance useEffect fetch keyed on [targetFullName] with no shared cache or batch endpoint (grep confirms it is the only caller of that URL). With PAGINATION.defaultPerPage=30 (scaling to 100), each repo-list page mount fires ~30 simultaneous round-trips that each hit the DB, purely to decide a 'migrated' pill that is null for almost every repo. Read-only/parameterized against local sqlite so not dangerous, but a clear efficiency waste deviating from an established cheaper pattern.
- **Fix:** Replace the per-card fetch with a single batched lookup mirroring useRepoMetadata.js (module-singleton + context): add GET /api/migration/marks?targetFullNames=a/b,c/d (or marks-by-user) returning all marks for the visible repos in one call, and have MigratedPill read from that map via O(1) lookup. Collapses ~30 requests to 1, same as RepoCard already does for aiMeta.

## #6 [MEDIUM] Pricing parity gate has coverage gaps (no PricingPreview, no PR-review row, no trial-vs-Stripe check)
- **Area:** pricing-honesty
- **Where:** `tests/pricing-feature-parity.test.js:64-298`
- **Why:** The gate meant to prevent pricing lies reads only PricingPage.jsx, FeatureComparison.jsx, and README.md. It never reads Landing/PricingPreview.jsx (rank 4 slips through), has no assertion on the 'PR Review Experience' row (rank 7 slips through), and nothing anywhere checks the advertised 14-day trial against billing.js (rank 2 slips through). The very mechanism that's supposed to catch these has structural blind spots.
- **Fix:** Extend the gate to (1) parse PricingPreview.jsx and assert its Free maxRepos/semanticSearch against feature-flags; (2) add a cross-surface assertion that the PR-review row is consistent and matches that write-back is requireAuth-only/free; (3) assert no surface claims a '14-day trial' while billing.js omits trial_period_days (or that billing.js sets it when the copy is present).

## #7 [LOW] FeatureComparison labels Free PR Review as 'Read-only', contradicting the other two surfaces and the actual free write-back endpoints
- **Area:** pricing-honesty
- **Where:** `src/components/Pricing/FeatureComparison.jsx:97-99`
- **Why:** The 'PR Review Experience' row shows Free='Read-only', but PricingPage.jsx (lines 26-27) and README.md:331-332 both list free manual write-back, and the endpoints (server/routes/repos/pulls.js: POST /reviews:363, /comments:277, /comments/:id/replies:327) use requireAuth only - no requireTier - a contract locked by server/__tests__/pr-write-tier-gate.test.js. The cell is factually wrong but understates the Free tier (makes Free look worse), so impact is trust/consistency, not revenue leak. Stale inline comments in pulls.js (276,326,361) also wrongly say 'tier-gated as Pro+'.
- **Fix:** Change the Free PR-review cell from 'Read-only' to reflect free manual write-back (e.g. 'Manual write-back' or 'Read + write-back'), reserving the Pro/Enterprise differentiator for AI Deep Review (which is genuinely requireTier('pro') in deep-review.js). Optionally clean up the stale 'Pro+' comments in pulls.js. Covered by the parity assertion added in rank 6.

## #8 [MEDIUM] Untested per-tenant scoping + derived stats in actions-service.js (webhook test mocks the whole service)
- **Area:** test-coverage
- **Where:** `server/actions-service.js:57-278`
- **Why:** getRepoStats/getDailyTrends/getWorkflowStats/getMultiRepoStats each contain a security-relevant branch that adds 'AND user_id = ?' only when userId is provided, else falls back to an UNSCOPED cross-tenant query, plus derived math (divide-by-zero-guarded successRate, Math.round avg duration, GROUP BY DATE bucketing). Every test touching the service mocks it entirely, so the real bodies never run. Given the prior repos-sync cross-tenant HIGH in project memory, the untested scoped-vs-unscoped branch is exactly the regression class that would leak another tenant's CI history. Production callers do pass userId today, so it's a coverage gap not a live leak.
- **Fix:** Add server/__tests__/actions-service.test.js against in-memory sqlite: seed workflow_runs for two user_ids and assert passing userId returns only that tenant's rows while omitting it returns the unscoped aggregate; pin successRate/avgDuration math and the zero-runs (no divide-by-zero) edge for all four read methods plus the store/update upserts.

## #9 [MEDIUM] Untested community-health scoring/recommendation logic (mocked out in every test)
- **Area:** test-coverage
- **Where:** `server/community-health-service.js:91-200`
- **Why:** calculateHealthScore is a non-trivial weighted derivation (file-existence bonuses, activity caps Math.min(x*2,10)/Math.min(commits/5,10), closeRate*5 with an issueTotal>0 divide-by-zero guard, final clamp to 100); generateRecommendations builds and priority-sorts a list; cacheResults does an ON CONFLICT(user_id,repo_id) tenant-scoped upsert. It is live (actions-community.js:465-466) but every importing test stubs it to {} and no test calls the real functions, so a weight/clamp/guard regression would ship silently. These are pure/deterministic functions, making tests cheap and high-value.
- **Fix:** Add server/__tests__/community-health-service.test.js with table-driven cases per contribution and the cap/clamp boundaries (1000 contributors must not exceed +10; total clamps at 100; zero-issue repo must not divide by zero), assert generateRecommendations ordering (high->medium->low) and the README size<500 branch, and cover cacheResults upsert + per-user scoping against in-memory sqlite.

## #10 [MEDIUM] RepoFilterBar bulk-selection dropdown is a non-managed menu (no role, no Escape, no focus move, no arrow keys)
- **Area:** a11y
- **Where:** `src/components/RepoList/RepoFilterBar.jsx:136-165`
- **Why:** The toggle reveals a plain <div> of three action buttons with no role="menu"/role="menuitem". Focus is not moved into the menu on open, there is no Escape handler, and no Arrow-key navigation - dismissal is only via a window-level click/scroll listener. A keyboard user must Tab through the rest of the toolbar to reach items and cannot Escape-close. Degraded rather than blocking (items are real focusable buttons; Select All also has a dedicated keyboard checkbox), but the well-built ui/ContextMenu primitive already handles all of this.
- **Fix:** Reuse the existing ui/ContextMenu primitive, or add role="menu"+role="menuitem", focus the first item on open, support ArrowUp/Down between items, and close on Escape returning focus to the toggle button.

## #11 [MEDIUM] FileRiskBadge conveys PR-file risk by color alone via a title on a non-interactive span
- **Area:** a11y
- **Where:** `src/components/PRReview/AIInsights/FileRiskBadge.jsx:40-45 (rendered per row at src/components/PRReview/FileTree/FileTreeItem.jsx:61)`
- **Why:** The badge is a 2x2 colored dot whose only critical/high/medium/low differentiator is the Tailwind background color; the risk text lives only in title=, which on a non-interactive, non-focusable span is not reliably announced and is unreachable by keyboard. Rendered for every PR file-tree row, so AT/colorblind reviewers get no absolute risk signal (red/green critical-vs-low is a classic confusion pair). The codebase already has the correct pattern (LanguageChart/TrackedDot use role="img"+aria-label).
- **Fix:** Add role="img" and aria-label={title} to the span (or an sr-only text node alongside it), and add a non-color cue (shape/letter) for low-vision users, matching the existing LanguageChart/TrackedDot pattern.

## #12 [MEDIUM] ModelCombobox highlights options visually but exposes no aria-activedescendant
- **Area:** a11y
- **Where:** `src/components/Settings/AIConfig/ModelCombobox.jsx:123-155 + ModelRow.jsx:36-47`
- **Why:** Same WCAG 4.1.2 class as rank 3 but scoped to the single Settings AI model picker and mitigated because the role="combobox" input is a labeled free-text field with live filtering (an AT user can type the model id directly). Arrowing changes only a visual 'highlight' class; rows have data-idx not id, so nothing for aria-activedescendant to point at.
- **Fix:** Assign each ModelRow an id derived from listboxId+dataIdx and set aria-activedescendant on the combobox input to the highlighted row's id (clearing when highlight < 0). Implement via the same shared listbox helper as rank 3.

## #13 [MEDIUM] Virtualized PR file tree breaks role=tree->role=treeitem ownership and lacks roving-tabindex keyboard nav
- **Area:** a11y
- **Where:** `src/components/PRReview/FileTree/FileTree.jsx:94-133 + FileTreeItem.jsx:51-57`
- **Why:** The role="tree" container nests each role="treeitem" two levels deep inside role-less virtualizer wrapper divs, severing the ARIA ownership the tree pattern requires. There is no roving tabindex (every treeitem is independently tabbable -> N tab stops), no ArrowUp/Down/Home/End handler, and no aria-level/setsize/posinset. It announces itself as a 'tree' while violating the pattern in two ways. Still operable (rows clickable/Tab-reachable), so medium not high.
- **Fix:** Add role="presentation"/"group" to the virtualizer wrapper divs so the tree owns its treeitems, implement roving tabindex with ArrowUp/Down/Home/End, and set aria-posinset/aria-setsize per row - or switch to role="listbox"/role="option", which fits a flat virtualized list better.

## #14 [MEDIUM] Dashboard inbox + notifications digest run unbounded full-index GROUP BY scans of pr_events/issue_events per request
- **Area:** perf
- **Where:** `server/lib/event-aggregations.js:62-68 (and :359-363)`
- **Why:** listMyPendingReviews and listTechDebtIssues LEFT JOIN a derived 'latest event per (repo, pr/issue)' table whose inner subquery is SELECT MAX(id) ... GROUP BY repo_id, pr_number with no user/repo predicate. EXPLAIN confirms a covering-index scan over every event row - O(total cross-tenant event volume), independent of the requesting user's slice. Backs the Premium Dashboard inbox and notifications digest, both called per page-load/bell-open with no cache at that layer (unlike work-board which caches). In-process sqlite keeps it sub-10ms today, so it's a latent scalability cliff, not a current latency bug.
- **Fix:** Scope the 'latest event per (repo, pr/issue)' computation before grouping (restrict by the reviewer's review_assignments repo_ids, or by author_login where already filtered), or maintain a pr_state/issue_state summary table (one row per repo+number holding the latest snapshot) updated by webhook handlers so reads become bounded indexed scans.

## #15 [MEDIUM] Orphaned job-queue subsystem: queue.js getQueue/createWorker + both worker factories are never wired in
- **Area:** dead-code
- **Where:** `server/lib/queue.js:49,72; server/workers/ai-worker.js:3; server/workers/migration-worker.js:3`
- **Why:** Only closeAllQueues is imported (index.js:27); getQueue/createWorker have zero references, so the processor factories createAIProcessor/createMigrationProcessor can never attach and the in-memory queue's processor path never fires. Real work runs synchronously elsewhere (migration via engine.executePlan at migration.js:448; AI indexing inline at ai/indexing.js:212-257), and ai-worker calls aiService.indexRepository which doesn't even exist - proof it never ran. No runtime impact, but architecture docs (backend.md) wrongly describe these as live async BullMQ processors, making it actively misleading.
- **Fix:** Delete server/workers/ai-worker.js, server/workers/migration-worker.js, and the unused getQueue/createWorker exports (keep closeAllQueues if it no-ops harmlessly), and correct backend.md - OR wire them up if background processing was actually intended.

## #16 [MEDIUM] server/db.js: 1240-line initDB with inline schema blob + ~15 ad-hoc try/catch ALTER-TABLE migrations and no version tracking
- **Area:** monoliths-maintainability
- **Where:** `server/db.js:22-1163`
- **Why:** initDB defines 49 CREATE TABLE + 84 CREATE INDEX inline in one transaction, then runs out-of-order hand-numbered 'Migration NNN' blocks (line 726=Migration 004 precedes 733=Migration 002) including ~16 ALTER TABLE ADD COLUMN guarded by string-matching catch(err){ if(!err.message.includes('duplicate column')) throw }. There is no migration framework, no schema_migrations/user_version table, and no way to know what ran on a given DB; every new column appends another bespoke try/catch. It is idempotent and works correctly today (so medium, not high), but is real, growing tech debt. (Note: counts are 49 tables / 84 indexes / ~16 ALTERs - the original '87 indexes / 25+ ALTERs' was inflated.)
- **Fix:** Split into per-domain schema modules (schema/teams.js, schema/migrations.js, schema/ai.js, schema/work-board.js, ...) each exporting its CREATE statements, and add a real runner: a schema_migrations(version, applied_at) table plus an ordered array of numbered up() functions run only if not already applied. Replace duplicate-column string-matching with PRAGMA table_info checks (the pattern already at db.js:33-35).

## #17 [MEDIUM] server/migration-engine.js: _executeTask is a ~252-line method switching over 4 task types
- **Area:** monoliths-maintainability
- **Where:** `server/migration-engine.js:670-921`
- **Why:** The single largest method in the class bundles dry-run simulation (target probing + credential checks), case 'repo', case 'repo-tfvc' (two inlined sub-modes), 'work-items', and 'wiki' behind one switch, each with its own source_ref parsing, host/clone-URL derivation, sanitization, and error handling; sibling executePlan is ~203 lines. Testability cost is concrete: every executePlan test must monkey-patch the whole _executeTask (10 sites in migration-engine.test.js) and the four real cases have no isolated unit coverage. Maintainability-only (no correctness bug), so medium.
- **Fix:** Extract each switch case into server/lib/migration/runners/{repo,tfvc,work-items,wiki}.js exposing a uniform run(task, ctx, callbacks), pull dry-run into simulateTask(), and reduce _executeTask to a thin dispatcher (resolve credentials/target, dry-run vs real, look up runner by task.type). Isolates per-type logic for testing and lets new task types register without editing the engine core.

## #18 [MEDIUM] server/routes/azure.js: 739-line file, 30 handlers mixing 6 unrelated concerns with divergent auth/limiters
- **Area:** monoliths-maintainability
- **Where:** `server/routes/azure.js:137-714`
- **Why:** One router spans admin host-allowlist CRUD (requireAdmin), PAT validation, migration-source proxies, enriched repo-stats proxies (behind enrichedRepoLimiter), the full OAuth flow (callback drops requireAuth), and the per-user encrypted credentials vault CRUD - different auth profiles, different rate limiters, changing for different reasons. The codebase already uses the split-router-in-subdir pattern (repos/, ai/, import/azure/), so the refactor is idiomatic and path-transparent. SRP/maintainability, not a defect.
- **Fix:** Split into focused routers under the same /azure prefix - routes/azure/oauth.js, credentials.js, host-allowlist.js, proxy.js (validate + project/repo/wiki/work-item/stats reads) - and keep azure.js as a ~10-line aggregator. Each file then carries a single auth/limiter profile and is independently testable.

## #19 [LOW] Duplicated fetch-state boilerplate in ~19 files ignores existing useTabData / useResilientFetch hooks
- **Area:** monoliths-maintainability
- **Where:** `src/components/Settings/ProbeStatsSection.jsx:38-50 (+ ~18 more)`
- **Why:** The setLoading/try/catch/finally fetch idiom recurs across ~19 files even though useTabData.js exists explicitly to collapse it (and adds AbortController cancellation the hand-rolled copies lack - ProbeStatsSection/AuditLogSection have none, risking benign setState-after-unmount and needing eslint-disable react-hooks/set-state-in-effect). Pure quality cleanup, no user-facing bug, so low. Caveats from review: original counts were inflated (~19 files, not 24/20), and the recommended 'easy starter' cases (ApiKeysSection sets 2 slots, LicensePlanSection sets 5 across 2 fetches) are NOT trivial drop-ins; useResilientFetch already covers the URL-string callers.
- **Fix:** Adopt useTabData (or a sibling useApiData(loader, deps) for apiCall-based callers returning {data,loading,error,reload}) in the genuinely single-data-slot sections first (ProbeStatsSection, AuditLogSection minus pagination nuance) to prove the pattern; route URL-string callers to the existing useResilientFetch; do NOT mechanically sweep the multi-slot sections. Each adoption drops the useState lines, the try/catch fetch fn, and the eslint-disable, and gains free cancellation.

## #20 [LOW] gh-cache.invalidateByRepo uses a leading-wildcard LIKE (bounded by resource_type, not a true full-table scan)
- **Area:** perf
- **Where:** `server/lib/gh-cache.js:174-184`
- **Why:** DELETE ... WHERE resource_key LIKE '%repo%' cannot seek the index on resource_key. But EXPLAIN shows all production callers pass a resourceType, so the plan is SEARCH USING idx_gh_cache_resource_type (resource_type=?) - it scans only within one resource_type partition, not the whole table; a true SCAN occurs only in the unit test that omits the type. The finding's headline 'full-table scan per webhook' was overstated, and its quick fix (anchoring the LIKE) would NOT change the plan because case-insensitive LIKE (the default) disables SQLite's LIKE->range optimization. Genuine micro-inefficiency, minor.
- **Fix:** If addressed at all, store/derive a separate indexed repo_full_name column on gh_cache and DELETE on equality (the only fix that actually changes the query plan under default case-insensitive LIKE). Anchoring the LIKE alone is ineffective. Low priority.

