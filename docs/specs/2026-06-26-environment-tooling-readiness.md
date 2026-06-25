# Environment Tooling Readiness — Design Spec

- **Date:** 2026-06-26
- **Status:** Approved (design) — pending implementation plan
- **Owner:** Bruno Marques
- **Related:** [import-service.js](../../server/import-service.js), [git-tfs-runner.js](../../server/lib/git-tfs-runner.js), [check-native-modules.js](../../server/check-native-modules.js), [dev.mjs](../../scripts/dev.mjs)

## Problem

NPM-level bootstrap is solid (`scripts/dev/ensure-deps.mjs` reconciles `node_modules` with the
lockfile; `postinstall` validates the `better-sqlite3` native ABI). But detection of the **system
CLI tools** the migration engine depends on — `git`, `git-lfs`, `git-tfs`, and the TFVC `tf`
client — is **lazy, scattered, and reactive**. Each tool checks itself at its point of use and only
fails *mid-migration*:

- `git` → `checkGitInstalled()` ([import-service.js:39](../../server/import-service.js#L39))
- `git-lfs` → `ensureGitLfs()` throws `GIT_LFS_MISSING` with a manual link ([import-service.js:163](../../server/import-service.js#L163))
- `git-tfs` → `isAvailable()`, Windows-only, needs VS Build Tools + TFS Client OM ([git-tfs-runner.js:28](../../server/lib/git-tfs-runner.js#L28))
- `tf` / TFVC → used in [routes/import/azure/tfvc.js](../../server/routes/import/azure/tfvc.js)

There is no unified preflight ("doctor"), no UI showing tool status, and no assisted installation.
A user discovers `git-lfs` is missing only when a migration explodes. That is the opposite of premium.

## Goals

1. **Proactive readiness** — surface missing/outdated tooling *before* a migration runs, in the
   terminal (self-host/CI) and in the app (operator).
2. **Assisted, consented installation** — one-command/one-click install via the host's native
   package manager (winget/choco/scoop · apt/dnf/pacman/zypper · brew), with a manual-instructions
   fallback when elevation is required or no manager is available.
3. **Single source of truth** — one declarative engine drives every surface; the existing lazy
   checks delegate to it rather than re-implementing detection.

## Non-Goals

- Auto-installing **without consent** (rejected — requires elevation, breaks CI/restricted hosts).
- Installing tools that have no scriptable installer (e.g. VS Build Tools + TFS Client OM for
  `git-tfs`) — these are **guidance-only** with docs links.
- Exposing install actions to **SaaS tenants** — installing CLIs on a shared worker is an operator
  concern. Tenants see read-only status at most.
- Covering tools the server does not invoke (e.g. GitHub CLI `gh`) — YAGNI.

## Architecture

A single declarative engine under `server/lib/env/`, consumed by three clients (CLI doctor, app
Settings panel, migration preflight). Units are small and independently testable.

### Engine — `server/lib/env/`

| File | Responsibility | Pure? |
|---|---|---|
| `tool-registry.js` | Declarative catalog of tools (no I/O) | yes |
| `detect.js` | `detectTool(entry)` → status/version/path; TTL cache + manual invalidation | no (child process via injected runner) |
| `package-managers.js` | Resolve the host's native manager + whether elevation is required | no |
| `installer.js` | `installTool(id, {onProgress})` — consented, static args, re-detect, audit | no |
| `readiness.js` | `getReadiness({capabilities})` + `assertReady()` (typed `EnvironmentError`) | no |

**Registry entry shape** (declarative, one object per tool):

```
{
  id: 'git-lfs',
  label: 'Git LFS',
  docsUrl: 'https://git-lfs.com',
  platforms: ['win32', 'darwin', 'linux'],   // git-tfs → ['win32'] only
  detect: { cmd: 'git', args: ['lfs', 'version'], versionRegex: /git-lfs\/(\d+\.\d+\.\d+)/ },
  minVersion: '2.0.0',                         // optional
  capabilities: ['lfs', 'lfs-migrate'],        // migration routes that need this tool
  required: true,                              // vs optional
  installers: {                                // per package manager
    winget: { id: 'GitHub.GitLFS' },
    choco:  { id: 'git-lfs' },
    scoop:  { id: 'git-lfs' },
    apt:    { id: 'git-lfs' },
    brew:   { id: 'git-lfs' },
  },
  postInstall: ['lfs', 'install'],             // optional one-time setup command
  notes: null,                                 // guidance string when not auto-installable
}
```

**Tools covered (v1):** `git`, `git-lfs`, `git-tfs` (win32; `notes` explains the non-scriptable
VS Build Tools / TFS Client OM prerequisite), `tf` (TFVC client). The existing native-module check
([check-native-modules.js](../../server/check-native-modules.js)) is folded in as one more readiness
row (`id: 'better-sqlite3'`, detect = native ABI probe, installer = `npm rebuild`) so `doctor`
becomes the single readiness command.

**`detectTool` output:** `{ id, status: 'ok' | 'outdated' | 'missing' | 'n/a', version, path, satisfiesMin }`.
`n/a` when the tool is irrelevant on the current platform. Detection **never throws**. Results are
memoized with a short TTL; the API/UI can force a refresh.

### Unification refactor

The three existing checks become thin adapters that delegate to `detect.js`, keeping their current
signatures and throw/return contracts so callers are untouched:

- `ensureGitLfs(runRaw)` → `assertReady(['lfs'])`, preserving the `GIT_LFS_MISSING` code/message.
- `git-tfs` `isAvailable()` → `detectTool('git-tfs').status === 'ok'`.
- `checkGitInstalled()` → `detectTool('git')`.

### Runner seam

`detect.js` and `installer.js` take an injectable runner (default = `execFile`/`spawn`, mirroring
[git-tfs-runner.js](../../server/lib/git-tfs-runner.js) and import-service's `runRaw`). Tests inject
a fake — no real process spawns in unit tests.

## Surfaces

### 1. CLI — `npm run doctor` / `npm run doctor:fix`

`scripts/doctor.mjs`, reusing [scripts/dev/format.mjs](../../scripts/dev/format.mjs) for the banner,
color, and tag styling. Lists each tool with a status pill + version; when missing, prints the exact
install command. `--fix` installs (consent prompt; `--yes` for non-interactive/CI). Exits non-zero
when a **required** tool is missing → CI-friendly. Optional non-blocking hint wired into `predev`.

### 2. API — `server/routes/env.js` (mounted at `/api/env`)

Express router styled after [health.js](../../server/routes/health.js).

- `GET /api/env/tooling` → `{ platform, managers, tools[], readiness }`. Read-only; operator/admin
  context. Safe to expose read-only in SaaS.
- `POST /api/env/tooling/:id/install` → **SSE** progress stream (same pattern as the migration
  stream). **Admin/operator-gated**, rate-limited, `:id` validated against the registry allowlist.
  Disabled entirely in SaaS multi-tenant mode.

### 3. UI — `src/components/Settings/EnvironmentToolingSection.jsx`

Clones the [ProbeStatsSection.jsx](../../src/components/Settings/ProbeStatsSection.jsx) pattern:
`useTabData('/api/env/tooling')`, `PanelHeader`, `Card`, `Button`, `EmptyState`, `Skeleton`, lucide
icons, `ds-*` classes, toast on action. Per-tool row: status pill (ok / outdated / missing / n/a),
version, and "Install" / "Copy command" / docs link / "Refresh". Framer Motion reveals the SSE
install progress. Same admin gate as ProbeStats; non-admins see an `EmptyState` explaining the gate.

### 4. Migration preflight

Before a migration route runs, `assertReady(routeCapabilities)` fails **early** with a structured,
actionable `EnvironmentError` (code + offending tool + how-to-fix + deep link to the doctor/Settings)
instead of failing mid-run.

## Security

- **Multi-tenant gating:** install endpoint + UI install buttons are operator/self-host only; never
  reachable by SaaS tenants. Aligns with the open-core + SaaS transformation.
- **No shell injection:** install commands use static, allowlisted args (as
  [ensure-deps.mjs:62](../../scripts/dev/ensure-deps.mjs#L62) already does); never interpolate input.
- **No silent elevation:** if admin/sudo is required, surface the command for the operator to run;
  never auto-elevate.
- **Secret hygiene:** reuse `sanitizeStderr` from
  [git-tfs-runner.js:151](../../server/lib/git-tfs-runner.js#L151) across all captured output.
- **Audit:** every install is recorded via the existing audit log.

## Error Handling

- Detection returns status objects, never throws.
- `installer.js` returns structured `{ ok, code, output, redetected }`; failures are non-fatal to the
  process.
- SSE stream emits incremental progress + a terminal verdict event.
- Preflight throws `EnvironmentError { code, tool, fix, docsUrl }`; the migration route maps it to an
  actionable user-facing error.

## Testing

Unit tests in `server/__tests__/env/`, using the injected runner seam (no real spawns):

- `tool-registry` — shape/invariants (every entry has detect + installers or notes).
- `detect` — version parsing, `minVersion` comparison, `n/a` on wrong platform, cache behaviour.
- `package-managers` — manager resolution per platform (mock `process.platform`), elevation flag.
- `installer` — command construction is injection-free; re-detect after install; unknown-id refusal.
- `readiness` — aggregation + `assertReady` error mapping.

UI: `tests/components/Settings/EnvironmentToolingSection.test.jsx` — loading / error / admin-gate /
row rendering / install button calls the endpoint.

CLI: pure formatting + aggregation tested with mocked detection.

## Rollout

1. Engine + registry + unit tests.
2. Refactor the three lazy checks to delegate (behaviour-preserving; existing tests stay green).
3. `npm run doctor` CLI.
4. `/api/env` routes + migration preflight integration.
5. Settings UI section + tests.

Each step is independently shippable; the engine + delegation refactor delivers value (early,
unified failure) even before the doctor/UI land.
