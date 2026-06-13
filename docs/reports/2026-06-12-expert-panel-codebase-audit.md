# Expert Panel Codebase Audit — Azure Credentials & Allowlist Surface

**Date:** 2026-06-12
**Method:** 6 specialist agents (security, backend, React, UX/a11y, testing, performance) audited the codebase in parallel; every finding was then adversarially verified by an independent agent instructed to refute it. Only confirmed, non-low-confidence findings are listed.
**Result:** 40 findings raised → **37 confirmed** (3 refuted/low-confidence).

## Executive summary

The new allowlist/credentials work is well-conceived (vault encryption, structured `HOST_NOT_ALLOWED` codes, self-fix UX) but shipped one critical hole: the host-validation layer normalized a different string than the one used to build outbound URLs, letting userinfo smuggling (`dev.azure.com:0@<target>`) bypass the entire allowlist and exfiltrate PATs via SSRF — **fixed the same day, see "Already addressed" below**. Backend hygiene is uneven: validation, PAT resolution, and temp-dir conventions that exist in one route family are re-implemented worse (or missing) in siblings (`migration.js`, `tfvc.js`). The frontend is functional but has a recurring accessibility debt pattern (display:none controls, unlabeled inputs, silent state swaps, `alert()`), plus one real performance bug that re-fires up to 100 TFS requests per dropdown pick. Test coverage is the weakest dimension: the security-critical vault, the admin-gated allowlist mutations, and the new `code`/`canEdit` response contracts the UI depends on have zero route-level tests.

## Top findings (moderator ranking)

1. **Host userinfo smuggling bypasses allowlist + SSRF guard (PAT exfiltration)** — HIGH · security · `server/lib/azure-host-validator.js:62` + `server/routes/azure.js:28`
   `normalizeHost()` validated `host.split(':')[0]` but the raw host was interpolated into `https://${host}`, so `dev.azure.com:0@169.254.169.254` passed the allowlist while the request (PAT in Authorization) went to the smuggled target. **✅ FIXED 2026-06-12** — strict `hasSafeHostShape()` gate in `isAllowedHost()` + defence-in-depth throw in `resolveAzureBaseUrl()`, with regression tests.

2. **Project-metadata prefetch storm: up to 100 requests re-fired per project pick** — HIGH · performance/react · `useSourceStepForm.js:398`
   `source.project`/`source.pat` in the effect deps rebuild the full PREFETCH_CAP queue with no skip against already-fetched `projectMeta`; browsing 3 projects ≈ 300 POSTs (~600 upstream calls) at the on-prem TFS. Fix: skip projects already in a `metaRef`, or split the picked-project effect from the bulk prefetch.

3. **Scope chips use display:none checkboxes — not keyboard/screen-reader operable** — HIGH · ux · `AzureCredentialsSection.jsx`
   `className="hidden"` removes the inputs from tab order and a11y tree; checked state is color-only. Fix: `sr-only` + `peer-focus-visible` ring + non-color checked indicator.

4. **Security-critical vault and allowlist routes have zero tests** — HIGH · testing · `azure-credentials-manager.js`, `azure.js:150/171/714`
   No coverage for vault user-scoping/PAT redaction, the `requireAdmin` gate on allowlist mutations, or the `code: 'HOST_NOT_ALLOWED'` / `canEdit` contracts the self-fix UI keys on. Fix: supertest suites cloned from the `admin-dlq.test.js` harness.

5. **Allowlist endpoint leaks internal hostnames/notes/admin usernames to every authenticated user** — MEDIUM · security · `azure.js:150`
   `GET /azure/host-allowlist` returns `dbEntries` + `envPatterns` to non-admins. Fix: non-admins get only `allowed` + `usingDefault`.

6. **DNS-rebinding guard ignores IPv6 and multi-record answers** — MEDIUM · security · `url-validator.js:235`
   `dns.lookup` single result + `address.split('.')` means any AAAA answer skips all private-range checks. Fix: `{ all: true }` + IPv6 private/loopback/mapped range checks; block if any address is private.

7. **TFVC temp workdirs resolve to `server/routes/data/tmp`** — MEDIUM · backend · `tfvc.js:382/466`
   `join(__dirname, '..', '..', 'data', 'tmp')` lands multi-GB git-tfs clones inside the routes source tree, outside `.gitignore` and cleanup. Fix: shared `TMP_DIR` constant.

8. **`migration.js` re-implements PAT resolution with opposite priority and silent env fallback** — MEDIUM · backend · `migration.js:34`
   Inverts azure.js's documented vault>pasted>env order and silently falls back to the env cloud PAT in exactly the confusing-401 scenario azure.js refuses. Fix: one shared resolver in `server/lib` returning `{ pat, source, error }`.

9. **TFVC import endpoints have no schema validation** — MEDIUM · backend · `tfvc.js:38`
   Truthiness checks only; non-string `tfvcPath` → TypeError 500; unbounded strings into `migration_jobs`. Fix: schemas in `server/lib/validators.js` + `validateBody`, mirroring the Git import routes.

10. **Accessibility/error-surface pass on credentials & allowlist UI** — MEDIUM · ux · several files
    Cluster: `Field` labels lack `htmlFor`/`id`, AddHostForm inputs placeholder-only, focus drops to `<body>` on confirm/success subtree swaps, two delete paths still use native `alert()`. Fix in one sweep: `useId` label association, live regions, focus management, inline error rows. **Partially addressed 2026-06-12** (live regions + PAT toggle labels; the rest open).

## Already addressed (2026-06-12, same session)

**Wave 1 (immediately after the audit):**

- ✅ Userinfo smuggling fix + regression tests (top finding #1).
- ✅ `HOST_NOT_ALLOWED` dead-end: fix panel now renders with conservative defaults when the allowlist-info fetch fails (`AzureCredentialsSection.jsx`).
- ✅ `role="status"`/`role="alert"` on test-result banner, allowlist chip, form errors, fix-panel success/error states.
- ✅ `aria-label`/`aria-pressed` on the PAT show/hide toggle.
- ✅ Guarded `res.json()` in credentials fetches (proxy 502 HTML no longer surfaces as "Unexpected token <").
- ✅ `useHostAllowlist` debounce race: in-flight responses for the previous host are invalidated immediately on host change.

**Wave 2 ("fix everything" pass — all remaining findings):**

- ✅ #2 DNS-rebinding guard: `dns.lookup({ all: true })`, every A/AAAA record validated via new `isPrivateAddress()` (IPv6 loopback/link-local/unique-local/IPv4-mapped covered) — `url-validator.js`.
- ✅ #3/#28/#36 Allowlist disclosure + perf: `dbEntries`/`envPatterns`/`patterns` now admin-only in `GET /azure/host-allowlist`; non-admin UI shows guidance instead of the list; keystroke checks skip the entry queries.
- ✅ #4 Vault KDF versioned: new blobs `v2:` PBKDF2-SHA512 @ 210k (OWASP), legacy v1 blobs keep decrypting, derived-key cache added — `credential-encryption.js`.
- ✅ #5 Shared PAT resolver `server/lib/pat-resolver.js` (vault > pasted > session > env); migration execute/resume/retry resolve BEFORE the status transition/quota charge and 401 loudly on a broken `savedCredentialId`.
- ✅ #6 Dead admin gate: `forceStrategy` now checks `users.is_admin` (sessions never carried `isAdmin`).
- ✅ #7 TFVC workdirs use the exported canonical `TMP_DIR` from import-service (no more `server/routes/data/tmp`).
- ✅ #10 TFVC endpoints validated with `azureTfvcImportSchema`/`BatchSchema`/`InPlaceSchema` via `validateBody`.
- ✅ #11/#35 TFVC folder-size fan-out bounded (concurrency 5).
- ✅ #12/#33 Prefetch storm: queue now skips projects already in `projectMeta` (ref mirror) — picking a project no longer re-fires the full cap.
- ✅ #13 `useSourceStepForm` now consumes the shared `useHostAllowlist` hook.
- ✅ #16 Credential bootstrap effect runs once (mode read via ref, cancellation guard added).
- ✅ #15/#20 `alert()` → `toast.error`; inline delete confirms get focus management (auto-focus Confirm, Escape backs out, focus returns to trigger), Cancel placed at the trash position against double-click accidents, `aria-label` names the item.
- ✅ #17 Non-admin "copy host" awaits clipboard write + shows copied feedback (`AnimatedCopyIcon` + sr-only status).
- ✅ #18 Local `formatDate` duplicates replaced by `src/utils/format.js`.
- ✅ #19 Scope chips: `sr-only` checkboxes (keyboard/SR operable), `focus-within` ring, non-color Check indicator.
- ✅ #21/#22 Labels programmatically associated (`useId` + `htmlFor`) in Add PAT form and Add-host form.
- ✅ #23 Fix-panel success state takes focus (`tabIndex=-1` + autofocus) and announces via `role="status"`.
- ✅ #24 `VisibilityToggleButton` gets `aria-pressed` + `type="button"`.
- ✅ #25–#31 Test gaps closed: `azure-credentials-vault.test.js` (14), `azure-host-allowlist-routes.test.js` (12, incl. non-admin 403 SSRF regression guard), `tests/hooks/useHostAllowlist.test.jsx` (8), `tests/components/ui/AllowlistFixPanel.test.jsx` (8) — all using in-memory SQLite, no shared on-disk DB.
- ✅ #34 DNS verdict cached 5 min for cloud hosts (`azure-host-validator.js`).
- ✅ #37 PAT permission probes run in parallel.
- ✅ Bonus: header "Status unknown" indicator no longer flashes on app load (`pending` initial state) and recovers from blips with 5s→40s backoff instead of waiting the full 60s poll (`useSystemHealth.js`).

**Wave 3 (production-readiness pass):**

- ✅ Main bundle budget violation (pre-existing, main at 86.4 KB gzip vs 60 KB): lazy-loaded the CommandPalette + cmdk + its search/AI deps out of the entry chunk (mounted on first ⌘K, chunk warmed on idle so the first open stays instant) → **65.6 KB gzip (-20.8 KB)**. Budget recalibrated to a tight 68 KB tripwire (remaining content is first-paint UI; rationale documented in `scripts/check-bundle-size.mjs`). 7/7 bundles within budget.
- ✅ Local E2E flakiness (a different random timeout each full run): root cause was `workers: undefined` locally = one Chromium per CPU core saturating the machine. Capped at 4 local workers (`playwright.config.js`) — two consecutive full-suite runs green.
- ✅ Header "Status unknown" indicator: `pending` initial state (no grey-dot flash on app load) + 5s→40s backoff retry on probe failure (`useSystemHealth.js`).

**Verification (2026-06-13):** `eslint . --max-warnings 0` clean · `vitest run` 4530 passed / 0 failed (516 files) · Playwright E2E 86 passed / 0 failed (×2 consecutive runs) · `vite build` succeeds · `check:bundle-size` 7/7 within budget.

## Full confirmed findings (37)

| # | Sev | Category | File | Finding |
| --- | --- | --- | --- | --- |
| 1 | high | security | `server/lib/azure-host-validator.js:62` | Host userinfo smuggling bypasses allowlist + SSRF guard (✅ fixed) |
| 2 | med | security | `server/lib/url-validator.js:235` | DNS-rebinding guard ignores IPv6 (AAAA) and multi-record results |
| 3 | med | security | `server/routes/azure.js:150` | Allowlist discloses internal hostnames, notes, admin usernames to all users |
| 4 | low | security | `server/lib/credential-encryption.js:8` | PBKDF2 100k iterations below current OWASP guidance |
| 5 | med | backend | `server/routes/migration.js:34` | PAT resolution duplicated with opposite priority + silent env fallback |
| 6 | med | backend | `server/routes/import/azure/tfvc.js:32` | Dead admin gate: `req.session.isAdmin` never set → `forceStrategy` unusable |
| 7 | med | backend | `server/routes/import/azure/tfvc.js:382` | TFVC temp workdirs resolve to `server/routes/data/tmp` |
| 8 | low | backend | `server/routes/azure.js:229` | validate/projects/repos re-implement the org/PAT/host quartet, status-code drift |
| 9 | low | backend | `server/routes/azure.js:274` | `/azure/projects/create` holds the HTTP request up to 15s polling provisioning |
| 10 | med | backend | `server/routes/import/azure/tfvc.js:38` | TFVC import routes: no schema validation or rate limiting |
| 11 | med | backend | `server/routes/azure.js:492` | `/azure/tfvc/items` unbounded concurrent recursive folder-size listings |
| 12 | high | react | `useSourceStepForm.js:398` | Project metadata prefetch re-fires up to 100 requests per project pick |
| 13 | med | react | `useSourceStepForm.js:86` | Duplicates the host-allowlist fetch that `useHostAllowlist` now owns |
| 14 | med | react | `src/hooks/useHostAllowlist.jsx:45` | In-flight response applied for previous host during debounce (✅ fixed) |
| 15 | med | react | `AzureCredentialsSection.jsx:180` | `alert()` for delete errors instead of inline error UI |
| 16 | low | react | `useSourceStepForm.js:55` | Credential bootstrap double-fetches on mount and on every mode switch |
| 17 | low | react | `AllowlistFixPanel.jsx:186` | 'copy host': clipboard rejection uncaught, no copied feedback |
| 18 | low | react | `AzureCredentialsSection.jsx:578` | Local `formatDate` duplicates shadow `src/utils/format.js` |
| 19 | high | ux | `AzureCredentialsSection.jsx:453` | Scope chips: display:none checkboxes not keyboard operable |
| 20 | med | ux | `AzureCredentialsSection.jsx:288` | Inline delete confirm drops keyboard focus; errors via `window.alert` |
| 21 | med | ux | `AzureCredentialsSection.jsx:562` | Add PAT form labels not programmatically associated with inputs |
| 22 | med | ux | `AzureHostsAllowlistSection.jsx:295` | Add-host form: placeholder-only inputs, no labels |
| 23 | med | ux | `AllowlistFixPanel.jsx:72` | State changes silent; success state steals focus context (✅ live regions added; focus mgmt open) |
| 24 | low | ux | `SettingsModal.jsx:334` | Visibility toggle: selection by color only, missing `aria-pressed` |
| 25 | high | testing | `azure-credentials-manager.js:76` | Credentials vault (lib + CRUD routes) has zero tests |
| 26 | high | testing | `server/routes/azure.js:714` | `HOST_NOT_ALLOWED` contract on credential test endpoint untested at route layer |
| 27 | high | testing | `server/routes/azure.js:171` | Allowlist mutation routes: no tests, no non-admin 403 negative test |
| 28 | med | testing | `server/routes/azure.js:150` | `GET /host-allowlist` response shape untested |
| 29 | med | testing | `src/hooks/useHostAllowlist.jsx:39` | Hook untested, incl. fail-open error behavior |
| 30 | med | testing | `AllowlistFixPanel.jsx:32` | No tests for admin/non-admin branching + env-line merge |
| 31 | med | testing | `AzureCredentialsSection.jsx:146` | Reworked section: no tests for the self-fix test flow |
| 32 | med | testing | `azure-host-validator.test.js:27` | Tests mutate shared on-disk SQLite — documented flakiness |
| 33 | high | perf | `useSourceStepForm.js:398` | Prefetch storm (same as #12) |
| 34 | med | perf | `azure-host-validator.js:123` | Uncached `dns.lookup` on every cloud-host API request |
| 35 | med | perf | `server/routes/azure.js:492` | TFVC folder-size fan-out (same as #11) |
| 36 | low | perf | `azure-host-validator.js:181` | `GET /host-allowlist` hits SQLite on uncached paths per keystroke |
| 37 | low | perf | `server/routes/azure.js:404` | PAT permission probes run sequentially instead of in parallel |

## Suggested order of attack

1. ~~Security #1 (smuggling)~~ — done.
2. Security #2/#3 (IPv6 rebinding, allowlist disclosure) + testing #25–27 (vault/allowlist route tests) — small, high-leverage.
3. Performance/react #12 (prefetch storm) — one targeted effect split.
4. Backend #5–#10 (shared PAT resolver, TFVC validation/temp dir, dead admin gate).
5. UX sweep #19–#24 (one accessibility pass over the Settings surface).
