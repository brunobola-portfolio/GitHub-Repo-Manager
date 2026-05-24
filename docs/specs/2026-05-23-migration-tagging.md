# Migration Tagging — Design Spec

**Date:** 2026-05-23
**Status:** Draft, pending implementation plan
**Scope:** Mark every successful migration on three layers (source, destination, git history) so anyone — inside or outside the app — can tell at a glance which projects/repositories were migrated, when, and where to.

---

## Problem

After running a migration the only proof it ever happened lives inside the app's SQLite (`migration_plans`/`migration_tasks`). The source project on Azure DevOps and the destination repository on GitHub carry no visible mark. Consequences:

- Two engineers in the same org cannot tell whether a project was already migrated and risk re-running the migration.
- Auditors must open the app (or its database) to prove a migration occurred.
- A cloned repo gives no clue about its provenance.
- If the app is decommissioned or its DB is lost, all migration history is gone.

## Goals

1. Every successful migration leaves a **visible, machine-readable mark** on the source Azure project, the destination GitHub repository, and the git history itself.
2. Marks are **idempotent** — re-running the same plan updates the existing mark, never duplicates.
3. Marks are **opt-out, not opt-in** — automatic by default, with a wizard checkbox to disable per migration.
4. Marking **never fails the migration**. The repo is migrated even if marking fails partially; the failure is recorded and surfaced in the UI.
5. The app surfaces "Migrated" badges in `RepoList`/`RepoDetail`/`MigrationHistory` driven by the same data, so internal UX matches external truth.

## Non-Goals

- Marking external systems other than Azure DevOps (Cloud + Server) and GitHub. Generic-URL → GitHub migrations only get destination + git-tag marks (no source mark — we don't own the source).
- Marking pull requests, work items, or wiki pages.
- Automatically un-marking a repo when the underlying migration plan is deleted (deletion only purges local DB; an explicit "Remove migration marks" action is the user-facing affordance).
- Mirroring the marks to a third system (Slack, email digest). Out of scope for v1.

---

## Architecture

```
┌────────────────────┐    plan-complete    ┌──────────────────────────┐
│  migration-engine  ├─────────event──────▶│  migration-tagging-svc   │
└────────────────────┘                     │  (applyTaggingForPlan)   │
                                           └────────┬─────────────────┘
                                                    │ fan-out
                          ┌─────────────────────────┼─────────────────────────┐
                          ▼                         ▼                         ▼
                 ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
                 │  github-writer  │       │  azure-writer   │       │ git-tag-writer  │
                 └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
                          │                         │                         │
                          ▼                         ▼                         ▼
                   GitHub REST API           Azure DevOps REST          simple-git push
                                                                       (origin + source)

                          ▲                         ▲                         ▲
                          └─────────────────────────┴─────────────────────────┘
                                                    │
                                          writes one row per mark
                                                    │
                                                    ▼
                                          ┌─────────────────────┐
                                          │  migration_marks    │
                                          └─────────────────────┘
```

`migration-engine.js` keeps zero knowledge of tagging mechanics. Wiring is done at composition time in `server/index.js`: after instantiating both `MigrationEngine` and `MigrationTaggingService`, `engine.on('plan-complete', evt => taggingService.applyTaggingForPlan(evt.planId))`. The service is the only writer of `migration_marks`.

### Module boundaries

- **`server/migration-tagging-service.js`** — orchestration only. Reads plan + policy, calls writers, persists marks. No HTTP code.
- **`server/lib/tagging/github-writer.js`** — all GitHub REST calls (topics, description, custom properties). Uses existing `lib/github-api.js`.
- **`server/lib/tagging/azure-writer.js`** — all Azure DevOps REST calls (project properties, repo description). Uses existing `azure-service.js` HTTP helpers.
- **`server/lib/tagging/git-tag-writer.js`** — creates annotated tag via `simple-git`, pushes to destination (always) and source (if it's a git source).
- **`server/lib/migration-tagging-constants.js`** — naming conventions, topic slugs, property names. All conventions live here so they can be tuned without touching writers.
- **`server/routes/migration-marks.js`** — read-only HTTP API for the UI (`GET /api/migration/marks?targetFullName=foo/bar`, `GET /api/migration/plans/:id/marks`), plus `DELETE /api/migration/plans/:id/marks` for "remove marks".

Each writer is independently testable, has one job, and knows nothing about the other writers or the database.

---

## Data model

New migration `server/migrations/003-migration-tagging.sql`:

```sql
-- One row per mark attempt. A successful migration typically writes 5–8 rows.
CREATE TABLE IF NOT EXISTS migration_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER,                    -- nullable; null = plan-level mark
  scope TEXT NOT NULL,                -- 'source' | 'destination' | 'git-tag'
  target_kind TEXT NOT NULL,          -- enum, see below
  target_id TEXT NOT NULL,            -- repo full_name, project guid, or tag name
  payload TEXT NOT NULL,              -- JSON of what was actually written
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'written' | 'skipped' | 'failed'
  skip_reason TEXT,                   -- enum, see below
  error_message TEXT,
  written_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_marks_plan ON migration_marks(plan_id);
CREATE INDEX idx_marks_status ON migration_marks(status);
CREATE INDEX idx_marks_target ON migration_marks(target_kind, target_id);

-- Policy column on the plan. JSON so it survives schema changes.
ALTER TABLE migration_plans ADD COLUMN tagging_policy TEXT;
-- Default value applied in code (SQLite limits in ALTER TABLE DEFAULT):
-- {"enabled":true,"writeSource":true,"writeDestination":true,"writeGitTag":true,"hideSourceName":false}
```

`target_kind` enum: `github-topic` | `github-description` | `github-custom-property` | `azure-project-property` | `azure-repo-description` | `git-annotated-tag`

`skip_reason` enum: `policy-disabled` | `pat-scope-missing` | `topic-limit-reached` | `personal-account-no-props` | `unsupported-source-type` | `org-policy-blocks-custom-props`

### Why a separate table

- Each mark can succeed or fail independently. A column on `migration_plans` cannot express "destination wrote, source skipped because of scope, git-tag failed".
- Removing marks (undo) needs the exact `payload` written, per mark.
- Reverse lookup ("is this repo migrated?") becomes a single indexed query on `(target_kind, target_id)`.

---

## Tagging conventions

Single source of truth: `server/lib/migration-tagging-constants.js`.

### GitHub destination

| Mark | Value | Notes |
|---|---|---|
| Topic (always) | `migrated` | base marker |
| Topic (source kind) | `from-azure` \| `from-tfvc` \| `from-bitbucket` \| `from-git` | depends on `source_type` |
| Topic (source slug) | `mig-<slug(project)>` | max 40 chars; e.g. `mig-acme-billing`. Skipped if 20-topic ceiling hit |
| Description suffix | ` [Migrated from azure://acme/Billing on 2026-05-23]` | appended once; dedup via regex `/ \[Migrated from .+? on \d{4}-\d{2}-\d{2}\]$/` |
| Custom Property `migration_source` | `azure://acme/Billing` | org-level Custom Properties only; skipped on personal accounts |
| Custom Property `migration_date` | `2026-05-23` | ISO date |
| Custom Property `migration_plan_id` | `42` | ties back to local DB |

Privacy mode (`hideSourceName: true`): `source slug` topic becomes `mig-${sha1(source).slice(0,8)}`; description suffix uses `<redacted>` for the project name. Custom Properties still carry the real value (org-private).

### Azure DevOps source

Project-level properties (`PATCH /_apis/projects/{projectId}/properties`):

| Path | Value |
|---|---|
| `/Migration.Target` | `github.com/foo/bar` (or `azure://destOrg/destProject` for Azure→Azure) |
| `/Migration.Date` | `2026-05-23` |
| `/Migration.PlanId` | `42` |
| `/Migration.Status` | `completed` |
| `/Migration.SourceRepoIds` | comma-separated list, append-on-rerun |

Repo-level (`PATCH /_apis/git/repositories/{repoId}`): append ` [Migrated → github.com/foo/bar on 2026-05-23]` to description, dedup as on GitHub side.

### Git annotated tag

- Name: `migration/${YYYY-MM-DD}-${planId}`
- Created at HEAD of the destination default branch.
- Message: JSON `{ "planId": 42, "source": "azure://acme/Billing", "target": "github.com/foo/bar", "date": "2026-05-23T10:00:00Z", "executedBy": "brunobola@github" }`
- Pushed to destination remote. If the source is also git (not TFVC) and source PAT has push rights, also pushed there.
- On re-run with same `planId`, tag is force-updated locally then `git push --force-with-lease`.

---

## Public API of the tagging service

```js
// Idempotent. Re-running on an already-tagged plan refreshes marks in place.
applyTaggingForPlan(planId, { logger }) → Promise<Summary>
//   Summary = { written: number, skipped: number, failed: number, marks: MarkRecord[] }

// Called by the wizard's "Tagging" step before user confirms.
previewTaggingCapabilities(plan, credentials) → Promise<Capabilities>
//   Capabilities = {
//     github: { canWriteTopics, canWriteDescription, canWriteCustomProps, topicSlotsAvailable, warnings: string[] },
//     azure:  { canWriteProjectProps, canWriteRepoDesc, missingScopes: string[], warnings: string[] },
//     gitTag: { supported: boolean, reason?: string }
//   }

// Reverse mark to "not migrated" — deletes topics, restores description, deletes git tag, removes Azure properties.
removeMarksForPlan(planId, { logger }) → Promise<Summary>
```

`previewTaggingCapabilities` performs cheap probes:
- GitHub: `GET /repos/{owner}/{repo}/topics` → counts existing topics, infers slots. Tries `GET /orgs/{org}/properties/schema` to confirm Custom Properties are available.
- Azure: `GET /_apis/projects/{projectId}/properties` → if 403, PAT lacks `vso.project_manage` (project administrator). Records as warning.
- Git tag: always supported when the destination is git.

---

## Flow

1. **Wizard** — new `Tagging` step (between `Review` and `Execute`). Calls `previewTaggingCapabilities` and shows:
   - 3 checkboxes, all enabled by default (source / destination / git tag).
   - "Hide source name in public repos" checkbox (privacy).
   - Preview block: list of every mark that *will* be written, with warnings for what will be skipped and why.
   - A "Skip tagging entirely" master toggle.
2. **Execution** — engine runs the plan as today. On `plan-status: completed`:
   - Engine emits `plan-complete` (already exists, line 404).
   - `migration-tagging-service` listens for it, loads policy from `migration_plans.tagging_policy`, calls writers.
   - For each mark, writes a row to `migration_marks` (status `pending` → `written` / `skipped` / `failed`).
   - Emits new events: `tagging-started`, `tagging-mark-progress`, `tagging-completed`.
3. **UI feedback**:
   - Wizard's post-execution screen shows tagging summary ("✓ 6 marks written, ⚠ 1 skipped: topic limit").
   - `MigrationHistory.jsx` gains a "Tags" column with a badge (✓ / ⚠ / ✗ / —). Click opens detail modal.
   - `RepoList.jsx` shows a small "Migrated" pill when the repo has at least one mark with `target_kind = github-*` and `status = written`. Tooltip: source + date.
   - `RepoDetail`'s Overview tab shows a "Migration provenance" card with full mark history.

### Failure isolation

Tagging runs *after* `plan-complete`. The engine has already committed the plan as completed; the migration is done. Tagging failures only:
- write rows with `status='failed'`,
- emit `tagging-completed` with `{ failed: n }`,
- surface as warnings in the UI.

A complete tagging failure never reverts a migration.

---

## Error handling, retries, idempotency

- **HTTP retries**: each writer retries 3× with exponential backoff (1s, 3s, 9s) on 5xx and 429. Body uses ETag/If-Match where the API supports it.
- **Permission errors (401, 403)**: no retry. Mark recorded as `failed` with `error_message` capturing the API response. Surfaced as actionable warning ("PAT needs `vso.project_manage` scope to mark Azure project").
- **20-topic ceiling**: when adding topics would exceed 20, drop the optional `mig-<slug>` topic first, keep the two essentials (`migrated`, `from-<kind>`). If still over, write `skip_reason='topic-limit-reached'` for the optional topic and continue with description + custom properties.
- **Description dedup**: writers always `GET` current description first, then strip any existing `[Migrated from … on …]` suffix before appending the new one. No duplicated stamps.
- **Custom Property availability**: GitHub Custom Properties are org-only. For personal accounts, write `skip_reason='personal-account-no-props'` and continue with topics + description.
- **Re-run on same plan**: same `planId` → same git tag name → `--force-with-lease`. Same Azure property keys → `add` op is upsert. Same GitHub topics → set-merge (no duplicates by API design). Description suffix is deduped as above.
- **Concurrent migrations to same target repo**: marks have a unique-ish lookup `(target_kind, target_id, plan_id)` but we *don't* lock; last write wins, and the `migration_marks` history preserves both attempts.

---

## Risks and open questions

1. **PAT scope for Azure project properties.** I could not confirm the exact required scope from public docs (`vso.project_manage` is my best guess based on related endpoints). Plan handling: probe at runtime, surface a clear warning if missing, never block the migration. Treat as a discovery item in the implementation plan.
2. **Azure DevOps Server (on-prem) API version.** `7.1-preview.1` exists from Azure DevOps Server 2022+. Older Servers may need `6.0-preview.1` or may lack project properties entirely. Plan: feature-detect with a `GET` on the properties endpoint; if 404, mark `azure-project-property` as unsupported and continue with repo description only.
3. **GitHub Custom Properties availability.** Requires GHEC or modern GH Enterprise Server (3.10+). Probe via `GET /orgs/{org}/properties/schema`; if 404, skip with `skip_reason='org-policy-blocks-custom-props'`.
4. **Topic name conflicts with existing conventions.** If the destination org already uses `migrated` for something else, our marker collides. Mitigated by also writing the more specific `from-<kind>` and `mig-<slug>` topics; reverse lookup uses any of the three.
5. **Privacy leakage in public repos.** Default behaviour exposes the source project name in a public topic. Mitigated by the "hide source name" checkbox; not enabled by default because most users want the provenance visible.
6. **Tag push race with branch protection.** `git push origin migration/*` may be blocked by a rule that restricts tag creation. Plan: handle 403 from the push, record as `failed`, suggest user grant tag-push permission.
7. **Plan deletion semantics.** `ON DELETE CASCADE` purges marks from local DB but does not remove the external marks. Plan: surface a confirmation dialog when deleting plans with marks, offering "Also remove marks from GitHub/Azure" before purging.
8. **Slug collisions.** Two source projects with similar names slug to the same topic (`mig-acme-billing` from "Acme Billing" and "ACME-Billing"). Acceptable — the description + Custom Property still disambiguate.

---

## Testing

| Layer | File | What |
|---|---|---|
| Unit | `server/__tests__/migration-tagging-service.test.js` | orchestration, policy parsing, mark persistence, idempotency, failure isolation |
| Unit | `server/__tests__/tagging/github-writer.test.js` | topic merge, 20-cap, description dedup, custom-property fallback (mock HTTP with `nock`) |
| Unit | `server/__tests__/tagging/azure-writer.test.js` | JSON-Patch shape, property upsert, repo description append, scope-error handling |
| Unit | `server/__tests__/tagging/git-tag-writer.test.js` | annotated tag creation, force-with-lease on re-run, source-push when supported |
| Integration | `server/__tests__/migration-engine-tagging.test.js` | engine emits `plan-complete` → service fires → marks persisted → events emitted in order |
| Frontend unit | `tests/components/MigrationHistory.test.jsx` | badge renders correctly for `written` / `skipped` / `failed` / mixed |
| Frontend unit | `tests/components/MigrationWizard/TaggingStep.test.jsx` | preview rendering, checkbox state, warnings shown |
| E2E | `e2e/migration-tagging.spec.js` | full wizard flow with mocked Azure/GitHub, badge appears in MigrationHistory after run |

All tests run via `npx vitest` (unit) and `npx playwright test` (E2E). Follows existing project conventions in `CLAUDE.md`.

---

## Out of scope (deliberately deferred)

- **Slack/email notifications** on tagging completion. Use existing notification primitives if needed later.
- **Bulk re-tag** for historical migrations done before this feature. Possible follow-up: `POST /api/migration/plans/:id/marks` retroactive endpoint.
- **Tag custom values** (e.g. user-defined labels per migration). v1 ships fixed conventions only.
- **Webhook listener** that auto-removes marks if the repo is deleted on GitHub. Manual `DELETE` only in v1.
