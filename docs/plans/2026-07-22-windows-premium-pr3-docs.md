# Windows Premium PR 3 — Documentation Premium Pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring `docs/windows.md`, `README.md`, `docs/index.md`, and the stale Windows SVG up to a premium, professional standard that accurately describes the launcher/installer (PR #251) and one-click update (PR #252) — correcting the now-stale pre-launcher text and adding the new maintenance/update stories, while keeping every claim strictly true so the honesty gates stay green.

**Architecture:** Documentation-only. No source changes. The single source of truth for the shipped behavior is the code (`packaging/windows/*`, `server/lib/updater.js`, `server/routes/system.js`, `src/components/Settings/AboutSection.jsx`) and the already-accurate `packaging/windows/README-WINDOWS.txt`.

**Spec:** `docs/specs/2026-07-21-windows-premium-install-experience.md` §7.

## Global Constraints

- **Every claim must be literally true against the shipped code.** Two scoping rules are load-bearing and MUST be stated precisely:
  1. **One-click "Update now" is installed/managed-Windows only** (`canSelfUpdate = isManaged() && process.platform === 'win32'`). Never claim it for the dev/Docker/self-hosted web app or demo mode.
  2. **Automatic rollback is PORTABLE-ONLY.** The installer path (`setup.exe /VERYSILENT /UPDATED=1`) has **no** automatic app/DB rollback — recovery there is manual (reinstall prior version / restore the pre-update snapshot). This must be stated as an honest limit.
- **Honesty gates must stay green** (run them, do not weaken them):
  - `tests/build/readme-honesty.test.js` — asserts a fixed forbidden-phrase list never appears in README outside `## Roadmap`. None of the Windows claims match it; just never write those exact phrases and never add a `##` heading that changes the Roadmap slice.
  - `tests/pricing-feature-parity.test.js` — slices README between `## Plans & Pricing` and the next `\n## `. **Do NOT add any `## ` heading between `## Plans & Pricing` and `## Azure DevOps Migration Suite`.** Windows content lives under `## Installation` (line ~315), far clear of that slice — safe.
- Comments/prose: no emojis in code fences; keep the existing doc voice. No AI attribution in commits. Conventional Commits, subject < 72 chars.
- Markdown is not covered by `npm run lint` (eslint), but run `npm run lint` anyway to confirm no collateral, and run the two honesty-gate tests explicitly.
- Branch: `feat/windows-premium-docs` (create from `main` AFTER PR #252 merges, so the docs describe the merged reality; base is post-#252 main).

## Verified claims checklist (every new statement must map to one of these — all confirmed true against code)

1. 3-step install: download → double-click `GitHub Repo Manager.exe` → browser opens.
2. Runs hidden in the background, **no console window** (flashless GUI launcher).
3. One-click "Update now" in Settings → About — **installed/managed Windows only**.
4. Update flow: download → SHA256 verify → DB snapshot → apply → restart, with progress.
5. Automatic rollback on failed health check — **portable ZIP only**; installed = manual.
6. Server logs at `data\logs\server-YYYY-MM-DD.log`, 7-day retention; Start Menu → "View server logs".
7. Stop via Start Menu "Stop GitHub Repo Manager" or `GitHub Repo Manager.exe stop` (graceful).
8. Optional autostart on Windows login (background, `--no-browser`), opt-in unchecked.
9. Repair / Uninstall maintenance dialog when re-running setup over an existing install.
10. Uninstall keeps data by default; interactive prompt (default No) or silent `/PURGEDATA` deletes it.
11. Silent install: `/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /LOG= [/DIR=]`, per-user, no UAC.
12. Installing over a running instance now gracefully stops it (no longer a hard block).
13. Schema-downgrade guard: refuses to boot on a future-schema DB, points at the pre-update snapshot.
14. Honest limits kept: unsigned binaries / SmartScreen; x64 only (ARM64 via emulation); not a tray app (drop the "own console window" wording); winget not yet submitted; installed-mode rollback manual.

---

### Task 1: `docs/windows.md` — corrective + premium rewrite

**Files:** Modify `docs/windows.md` (304 lines).

Rewrite these sections (use `packaging/windows/README-WINDOWS.txt` as the accurate source, extend with the one-click update the txt omits):

- **Install → Option A / Option B / What first run does**: update to the launcher exe (double-click `GitHub Repo Manager.exe`), note the server runs hidden and the browser opens when ready. Keep the honest SmartScreen note.
- **Where your data lives**: add `logs\` (7-day retention) and `updates\` (download staging, backups, `pre-update-<ver>.db` snapshot, markers) to the data-dir description.
- **Updating** (REWRITE, currently says "nothing self-updates" — now false): three ways, honestly scoped —
  1. **One-click (Update now)** — Settings → About, installed/managed Windows only; describe the flow (download → verify SHA256 → DB snapshot → restart → "Updated to vX" toast) and that the page reloads automatically.
  2. **Automatic rollback** — portable ZIP: a failed health check reverts app + runtime + DB snapshot together and relaunches, with a "rolled back" toast. Installed: **manual** — the previous `setup.exe` is kept under `data\updates\`; reinstall it or restore the snapshot (state this plainly).
  3. **Manual** — installer: run the new `setup.exe` (it gracefully stops a running instance); portable: extract over the folder. Data untouched.
  Keep the in-app update-notification note (still true) but fold it into this section.
- **NEW section `## Maintenance`** (after Updating, before Connecting): Repair / Uninstall dialog on re-running setup; graceful close-app on install-over-running; keep-data vs `/PURGEDATA`; autostart task; the Start Menu shortcut inventory (GitHub Repo Manager / Stop / View server logs / Open data folder / Uninstall).
- **Troubleshooting** (fix stale bullets): "Where are the logs?" → now `data\logs\server-*.log` + Start Menu "View server logs" (drop "no log file by default / console window"); "Stop a stuck instance" → Start Menu Stop or `GitHub Repo Manager.exe stop` (drop the Task-Manager `node.exe` hunt; pidfile is `data\.grm.pid`). Add a "Update failed / rolled back" row (check `data\updates\apply-update-*.log`, the toast, and for installed mode the retained setup.exe) and a "Schema from a newer version" row (the downgrade-guard message + pre-update snapshot location).
- **Limits (honest)** (fix stale): **drop** the "own console window / closing the console window stops it" wording from "Not a tray app" (keep the no-tray/no-minimize spirit — it's genuinely not a tray app, just no longer console-windowed). Add a new bullet: **installed-mode update rollback is manual** (portable is automatic). Keep unsigned, x64-only, winget-not-yet as-is.

- [ ] **Step 1:** Rewrite the sections above. Every sentence maps to a checklist item; do not add any capability not in the checklist. Keep the existing TOC (`## Contents`) in sync with any heading changes (the new `## Maintenance` and any renamed troubleshooting anchors).
- [ ] **Step 2:** Self-check: grep the file for now-false strings — `Start GitHub Repo Manager.cmd` as the primary launch (demote to advanced/console only), "nothing self-updates", "no log file by default", "console window" (except where accurately describing the optional `.cmd` console mode). Fix each.
- [ ] **Step 3:** Verify internal anchor links still resolve (the `## Contents` list, and any `[Troubleshooting](#troubleshooting)` cross-links elsewhere in the file).
- [ ] **Step 4:** Commit `docs(windows): rewrite for launcher, one-click update, maintenance`.

---

### Task 2: `README.md` — stronger Windows section + honesty gates

**Files:** Modify `README.md` (the `### Windows — no Docker, no Node required` subsection at ~line 324, within `## Installation`). Test: run `tests/build/readme-honesty.test.js` + `tests/pricing-feature-parity.test.js`.

- [ ] **Step 1:** Replace/expand the Windows subsection in place (do NOT add a top-level `## ` heading anywhere; keep it under `## Installation`). Content, shallow and true:
  - Headline + **3-step install** (download `setup.exe` or ZIP → double-click `GitHub Repo Manager.exe` → browser opens; SmartScreen note kept).
  - One line each on: **one-click updates** (Settings → About, installed Windows) with automatic rollback on the portable build; Start Menu shortcuts + optional autostart; a **silent-install one-liner** for admins (`setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES`).
  - Keep the existing `docs/images/windows-install.svg` `<picture>` block and the link to `docs/windows.md` for the full guide.
  - Scope honestly: do not imply one-click update works for Docker/self-host.
- [ ] **Step 2:** Run `npx vitest run tests/build/readme-honesty.test.js tests/pricing-feature-parity.test.js` → both green. If red, the prose tripped a forbidden phrase or shifted a section boundary — fix the prose, never the gate.
- [ ] **Step 3:** Commit `docs(readme): premium Windows install and update section`.

---

### Task 3: `docs/index.md` refresh + stale SVG fix

**Files:** Modify `docs/index.md` (line ~87 Windows feature-guide summary + the "Recent releases" framing if a new release is described), `docs/images/windows-first-run.svg` (its diagram/alt text references `Start.cmd` — correct to the launcher exe).

- [ ] **Step 1:** Update `docs/index.md` line ~87 summary to mention one-click update + rollback + maintenance (keep it one line, true). If the "Recent releases" section lists a version, add/adjust an entry describing the launcher + one-click update honestly (portable auto-rollback, installed manual) — or leave release notes to the release process if that's how the repo does it (check surrounding entries' provenance before inventing a version number).
- [ ] **Step 2:** In `windows-first-run.svg`, replace the `Start.cmd` reference (label text and/or the `<img alt="...">` where it's embedded in `windows.md`) with `GitHub Repo Manager.exe`. Keep the SVG theme-aware and its `viewBox` unchanged. Verify it still renders (open in a browser or confirm valid XML).
- [ ] **Step 3:** Commit `docs: refresh index and correct stale launcher reference in SVG`.

---

### Task 4: Verification + PR

- [ ] **Step 1:** Run `npx vitest run tests/build/readme-honesty.test.js tests/pricing-feature-parity.test.js` → green; `npm run lint` → clean (no collateral). 
- [ ] **Step 2:** Fact-check pass: re-read the checklist (Global Constraints) against the final `docs/windows.md` + `README.md` — every sentence about Windows must map to a verified-true item; especially confirm the one-click-update scoping (installed/managed only) and rollback scoping (portable auto / installed manual) are stated, not implied.
- [ ] **Step 3:** Link-check: grep both files for markdown links and confirm relative targets exist and anchors resolve.
- [ ] **Step 4:** Write `.dev/pr3-body.md` (what changed, the correct-stale-docs framing, honesty-gate evidence, the two scoping rules called out). Push `feat/windows-premium-docs`, `gh pr create`. Final whole-branch review (docs review: accuracy vs code, honesty, no overclaim) before merge.
