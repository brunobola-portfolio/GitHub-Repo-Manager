# Migration Wizard Redesign

**Date:** 2026-03-25
**Status:** Approved

## Overview

Full redesign of the Migration Wizard covering: smart Azure DevOps URL paste with auto-fill, a tri-option credential panel with inline setup instructions, automatic validation without a manual button, and a visual refresh across all wizard steps.

## Goals

1. Allow users to paste any Azure DevOps URL (browser URL, clone URL, SSH, shorthand) and have org + project + repo extracted automatically.
2. Make credential options explicit, self-explanatory, and self-configuring — server PAT, personal PAT, and OAuth each explained with setup instructions when not available.
3. Remove the manual "Validate" button — validation triggers automatically when conditions are met.
4. Apply a consistent, polished visual design across all wizard steps.

## Non-Goals

- No changes to the migration logic or data model.
- No changes to the URL import flow (UrlInputStep, GitHubSourceStep) — only the Azure DevOps flow.
- No changes to step navigation logic in `useMigrationWizard.js`, except adding new fields to `INITIAL_SOURCE`.

---

## Section 1 — Smart URL Paste

### 1.1 What

A prominent "Paste Azure DevOps URL" field appears at the top of the Connect step, before any manual fields.

### 1.2 Behaviour

- Accepts any Azure DevOps URL format: `https://dev.azure.com/org/project/_git/repo`, browser page URLs, SSH clone URLs (`git@ssh.dev.azure.com:v3/org/project/repo`), shorthand `org/project` or `org/project/repo`.
- Uses the existing `src/utils/azureUrlParser.js` (no changes needed to the parser).
- On input change: the raw parser result is inspected for non-null fields. Badges are shown for whichever of `org`, `project`, and `repo` are non-null in the result, regardless of `result.error`:
  - org + project + repo: "org: myorg · project: myproject · repo: myrepo"
  - org + project only: "org: myorg · project: myproject"
  - org only (e.g. `https://dev.azure.com/myorg` returns `{ org: 'myorg', project: null, error: '...' }`): "org: myorg"
  - No non-null fields or empty input: no badges shown; parser error shown in muted text if present.
- A bare org name (e.g. `myorg` with no slash) is not a supported shorthand and will show no badges. Supported shorthands are `org/project` and `org/project/repo`.
- From the parser result, the following are written to wizard state: `source.org` (if non-null), `source.urlParsedProject` (if non-null), `source.urlParsedRepo` (if non-null). Null values do not overwrite existing manual input.
- `source.project` is **not** written from the URL parse. Only user interaction with the Project dropdown sets `source.project`. `urlParsedProject` is used only to pre-select the dropdown once the project list is loaded, preventing the `azureConnect` validator from passing on a stale pre-filled value.
- Known parser edge case: `https://dev.azure.com/myorg/_git/myrepo` returns `{ org: 'myorg', project: 'myrepo', repo: 'myrepo' }` (project equals repo name). This is correct behaviour for Azure DevOps single-repo projects. If `urlParsedProject` does not match any project in the returned list, the user selects manually — no error is shown.
- If the URL contains a repo name, `source.urlParsedRepo` is set and used in `RepoSelectStep` to auto-select the matching repo.

### 1.3 Project selection and Next button

The existing `azureConnect` validator requires `source.validated === true` AND `source.project` non-empty. `source.project` is only set when the user selects from the Project dropdown (including auto-selection from `urlParsedProject`). Flow:

1. Auto-validation sets `source.validated = true` on success.
2. Project dropdown appears. If `urlParsedProject` matches an item in the list, it is auto-selected via `onChange({ project: matchedName })`.
3. If no match, user must manually select.
4. Next becomes active once both conditions are true.

### 1.4 New wizard state fields

Add to `INITIAL_SOURCE` in `useMigrationWizard.js`:

- `urlParsedRepo: ''` — repo name from URL paste; used for auto-selection in RepoSelectStep.
- `urlParsedProject: ''` — project name from URL paste; used only to pre-select the Project dropdown.
- `credentialMode: ''` — active credential card: `'serverPat' | 'personalPat' | 'oauth' | ''`. Stored in wizard state so all downstream steps can read `source.credentialMode` to omit `pat` appropriately.

### 1.5 Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — smart paste field, parser wiring.
- `src/hooks/useMigrationWizard.js` — add `urlParsedRepo`, `urlParsedProject`, `credentialMode` to `INITIAL_SOURCE`.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — auto-select via `urlParsedRepo`.

---

## Section 2 — Credential Panel

### 2.1 What

The credential section is redesigned as three selectable cards, one active at a time, tracked in `source.credentialMode`. Changes call `onChange({ credentialMode: '...' })`. Because `credentialMode` is in wizard state, all steps that call Azure APIs can read `source.credentialMode` via their existing `source` prop.

**Instantiation:** `useAzureOAuth` is instantiated in `MigrationWizard.jsx` and passed to `SourceStep` as an `oauthHook` prop. This ensures OAuth state survives Back navigation to `SourceStep`.

**Initialisation:** on mount, `SourceStep` calls `GET /api/azure/env-auth` and `GET /api/azure/oauth-status` in parallel. While in flight, the credential panel shows a loading skeleton. Once both resolve, if `credentialMode` is still `''`:

- If `envAuth.available === true` → `onChange({ credentialMode: 'serverPat' })`.
- Else → `onChange({ credentialMode: 'personalPat' })`.
- OAuth is never auto-selected as default.

If `credentialMode` is already set (user navigated Back), it is preserved.

**Switching credential mode:** switching calls `onChange({ credentialMode: newMode, validated: false })` and clears the local project list. `oauthStatus` is **not** reset when switching away from `'oauth'` — the success state is preserved so the user can switch back without re-authenticating.

### 2.2 Card 1 — Server PAT

`credentialMode: 'serverPat'`

- Label: "Server PAT" with subtitle "Configured in the server .env file — no credentials entered here."
- Availability from `GET /api/azure/env-auth` → `{ available: boolean }` (unchanged).
- If available: green "Configured" badge, selectable.
- If not available: grey "Not configured" badge, not selectable, expands with setup instructions:

  ```text
  Add to your server .env file:
    AZURE_PAT=<your-personal-access-token>
  Then restart the server.
  ```

- Always visible even when unconfigured.

### 2.3 Card 2 — Personal PAT

`credentialMode: 'personalPat'`

- Label: "Personal Access Token" with subtitle "Paste your own PAT — used only for this session, transmitted per API call, never persisted."
- PAT stored in `source.pat`. Sent as `pat` in request body. Not stored server-side.
- Password input with show/hide toggle.
- Link: "Create PAT →" opens `https://dev.azure.com/{org}/_usersSettings/tokens`.
- Hint: "Minimum scope: Code (Read). Add Work Items (Read) and Wiki (Read) for full migration."

### 2.4 Card 3 — OAuth / Browser

`credentialMode: 'oauth'`

- Label: "OAuth / Browser Login" with subtitle "Authenticate via Azure AD — token stored in server session only."
- Availability from `GET /api/azure/oauth-status` → `{ configured: boolean }`. `configured` is `true` when `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID` are all present and non-empty.
- If not configured: grey "Not configured" badge, not selectable, expands with setup instructions:

  ```text
  1. Register an app in Azure Portal (Azure Active Directory → App Registrations).
  2. Set Redirect URI to: http://localhost:3001/api/azure/oauth/callback
  3. Add to your server .env file:
       AZURE_CLIENT_ID=<app-client-id>
       AZURE_CLIENT_SECRET=<app-client-secret>
       AZURE_TENANT_ID=<tenant-id>  (or "common" for multi-tenant)
  4. Restart the server.
  ```

- If configured: shows "Open browser to authenticate" button. Clicking calls `startOAuth()` which calls `window.open('/api/azure/oauth/start', '_blank')` and starts polling. If popup blocked: show "Popup blocked — allow popups for this page and try again."
- `useAzureOAuth` polling: 1000ms interval, max 120 seconds. State transitions:
  - `{ ready: true }` → `oauthStatus: 'success'` → stop polling → auto-validate fires immediately.
  - 120s timeout → `oauthStatus: 'timeout'` → "Authentication timed out — try again."
  - Network error → `oauthStatus: 'error'` → error with retry button.
- **Polling lifecycle:** polling is paused (interval cleared) when `credentialMode` switches away from `'oauth'`. On switching back to `'oauth'`: if `oauthStatus === 'success'`, polling is not restarted (user is already authenticated); if `oauthStatus === 'idle'`, user must click "Open browser" again.
- **User closes tab without completing:** the 120s polling timeout is the detection mechanism. There is no fast-path close detection. `requireAuth` on OAuth routes returns 401 (not a redirect) when unauthenticated, so the popup shows a 401 rather than navigating away; polling continues until timeout.
- `GET /api/azure/oauth/callback` stores token in session and returns an HTML page: "Authentication complete — you can close this tab." with a `window.close()` script.
- Token is stored in server session only. `GET /api/azure/oauth/token` returns `{ ready: boolean }` — token never sent to client.

### 2.5 `useAzureOAuth` hook API

```js
// Instantiated in MigrationWizard.jsx; passed to SourceStep as oauthHook prop
const oauthHook = useAzureOAuth()
// oauthHook.oauthStatus: 'idle' | 'pending' | 'success' | 'error' | 'timeout'
// oauthHook.startOAuth():   opens OAuth tab, starts polling (idle → pending)
// oauthHook.retryOAuth():   resets to 'idle'
// oauthHook.pausePolling(): clears the interval (called when credentialMode !== 'oauth')
// oauthHook.resumePolling(): restarts polling if status is 'pending' (called when credentialMode === 'oauth')
```

### 2.6 Downstream credential propagation

`source.credentialMode` is in wizard state and accessible via the `source` prop in all step files (same as `source.pat`, `source.org`, etc.). All steps that call Azure API endpoints update their fetch calls to:

```js
pat: source.credentialMode === 'personalPat' ? source.pat : undefined
```

This applies to: the repo fetch in `RepoSelectStep`, the `pat-permissions` call in `EmptyRepoState` (inside `RepoSelectStep`), `WorkItemsStep`, and `WikiStep`.

**Prerequisite:** the server-side `resolvePat` change (Section 3.3) must be deployed before OAuth-mode credential propagation will work. Without it, all Azure API calls with `pat: undefined` in OAuth mode will return 400.

### 2.7 Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — credential card UI.
- `src/components/MigrationWizard/MigrationWizard.jsx` — instantiate `useAzureOAuth`, pass as `oauthHook` prop to `SourceStep`.
- `src/hooks/useAzureOAuth.js` — new hook with polling lifecycle management.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — PAT propagation fix (fetch + EmptyRepoState).
- `src/components/MigrationWizard/steps/WorkItemsStep.jsx` — PAT propagation fix.
- `src/components/MigrationWizard/steps/WikiStep.jsx` — PAT propagation fix.
- `server/routes/azure.js` — add 4 OAuth routes; update all 10 POST route handlers to call `resolvePat(bodyPat, req.session)`.
- `server/azure-service.js` — update `resolvePat(bodyPat, session)` to check `session?.azureToken`.

---

## Section 3 — Auto-validation

### 3.1 What

The "Validate" button is removed. Validation triggers automatically.

### 3.2 Behaviour

**Validation is org-level.** Project is not required; projects are fetched in the same call.

**Trigger condition:** `source.org` is non-empty AND one of:

- `credentialMode === 'serverPat'` (confirmed available on mount)
- `credentialMode === 'personalPat'` AND `source.pat` is non-empty
- `credentialMode === 'oauth'` AND `oauthHook.oauthStatus === 'success'`

**Debounce:** 400ms after the last change to `source.org` or `source.pat`. No debounce when switching `credentialMode` to `'serverPat'` or when `oauthStatus` reaches `'success'`.

**Parallel fetch:** `POST /api/azure/validate` and `POST /api/azure/projects` via `Promise.all`. Body: `{ org: source.org, pat: source.credentialMode === 'personalPat' ? source.pat : undefined }`. Server resolves credentials via `resolvePat(bodyPat, req.session)`.

If `/api/azure/validate` returns `valid: false`, the project list is discarded and the error shown.

**On success:** `onChange({ validated: true })`. Project dropdown slides in. If `urlParsedProject` matches a project in the list, `onChange({ project: matchedName })` is called.

**On error:** contextual message with retry link (bypasses debounce). Spinner inline next to org field.

### 3.3 Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — remove validate button, debounced auto-validate `useEffect`.
- `server/azure-service.js` — update `resolvePat(bodyPat, session)`: check `session?.azureToken` after `process.env.AZURE_PAT`.
- `server/routes/azure.js` — all 10 POST route handlers pass `req.session` to `resolvePat`.

---

## Section 4 — Visual Redesign

### 4.1 Step Indicator

- Connecting lines between circles: `<div>` elements with `flex-1` between each pair.
- Completed segment: `bg-emerald-500`. Future: `bg-slate-200 dark:bg-slate-700`.
- Active circle: w-8 h-8, indigo ring, scale-110. Completed: emerald + checkmark. Future: unchanged.

### 4.2 Modal Header / Step Titles

A `STEP_META` map in `MigrationWizard.jsx` maps step keys to `{ title, subtitle }`:

```js
const STEP_META = {
  azureConnect: { title: 'Connect to Azure DevOps', subtitle: 'Enter your organization and credentials.' },
  repoSelect:   { title: 'Select Repositories', subtitle: 'Choose which repos to migrate.' },
  // ... etc.
}
```

Step files remove their internal `<h3>` / `<p>` description blocks.

### 4.3 SourceTypeStep

Cards (left icon, bold title, one-line description, "Recommended" badge on Azure). Clicking calls `onChange({ sourceType: value })` immediately. The 300ms visual "selected" flash is implemented entirely within `SourceTypeStep` using local state (`pendingType`) that is set on click and cleared after 300ms, at which point `onChange` is called. The existing `MigrationWizard.jsx` `useEffect` auto-advance continues to work as-is — no `setTimeout` is added to it. This avoids reintroducing the stale-closure bug the current implementation explicitly guards against.

### 4.4 RepoSelectStep

Visual improvements only: larger checkbox hit area, repo name in semibold, description in muted text.

**Auto-select from `urlParsedRepo`:** a `useEffect` with dependency `[repos, source.urlParsedRepo]` fires after repos are fetched and set via `onSetRepos`. If `urlParsedRepo` is non-empty and a matching repo is found, `onSetRepos` is called with that repo's `selected` set to `true`. No auto-scroll or separate visual highlight beyond the existing selected state.

### 4.5 All Other Steps

Remove internal `<h3>` / `<p>` headers, standardise padding/font sizes. No functional changes.

### 4.6 Files affected

- `src/components/MigrationWizard/MigrationWizard.jsx` — step indicator, `STEP_META`, pass `oauthHook` to `SourceStep`.
- `src/components/MigrationWizard/steps/SourceTypeStep.jsx` — card layout with local `pendingType` state for visual flash, remove header.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — visual improvements, auto-select `useEffect`, PAT propagation fix, remove header.
- `src/components/MigrationWizard/steps/SourceStep.jsx` — remove internal header.
- All other step files — remove internal headers, minor padding/typography.

---

## Data Flow Summary

```text
User pastes URL → azureUrlParser extracts { org, project, repo }
  → onChange({ org, urlParsedProject: project, urlParsedRepo: repo })
  → badges shown for non-null fields
  → auto-validate fires (debounced 400ms, or immediately for serverPat/oauth-success)
    → PREREQUISITE: server resolvePat must be updated first (for OAuth/serverPat modes)
    → Promise.all([POST /api/azure/validate, POST /api/azure/projects])
    → on success:
        onChange({ validated: true })
        project dropdown appears
        if urlParsedProject matches → onChange({ project: matchedName })
    → on failure: show contextual error + retry
  → user selects project → Next active
  → RepoSelectStep mounts → fetch repos → useEffect auto-selects urlParsedRepo if matched
```

---

## Server: New OAuth Routes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/azure/oauth-status` | Returns configured boolean (all 3 env vars present) |
| GET | `/api/azure/oauth/start` | Redirects browser to Azure AD authorization URL |
| GET | `/api/azure/oauth/callback` | Stores token in session; returns close-tab HTML page |
| GET | `/api/azure/oauth/token` | Returns ready boolean — token never sent to client |

Existing `GET /api/azure/env-auth` is unchanged. All 10 POST route handlers are updated to pass `req.session` to `resolvePat`.

---

## Environment Variables

| Variable | Required for | Description |
| --- | --- | --- |
| `AZURE_PAT` | Server PAT card | Already exists |
| `AZURE_CLIENT_ID` | OAuth card | Azure AD app client ID |
| `AZURE_CLIENT_SECRET` | OAuth card | Azure AD app client secret |
| `AZURE_TENANT_ID` | OAuth card | Tenant ID or "common" for multi-tenant |

---

## File Change Summary

| File | Change |
| --- | --- |
| `src/components/MigrationWizard/steps/SourceStep.jsx` | Full rewrite — smart paste, credential cards, auto-validate |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Step indicator, STEP_META, instantiate useAzureOAuth, pass oauthHook |
| `src/components/MigrationWizard/steps/SourceTypeStep.jsx` | Card layout with pendingType flash state, remove header |
| `src/components/MigrationWizard/steps/RepoSelectStep.jsx` | Visual improvements, auto-select useEffect, PAT propagation fix (incl. EmptyRepoState), remove header |
| `src/components/MigrationWizard/steps/WorkItemsStep.jsx` | PAT propagation fix |
| `src/components/MigrationWizard/steps/WikiStep.jsx` | PAT propagation fix |
| `src/hooks/useMigrationWizard.js` | Add urlParsedRepo, urlParsedProject, credentialMode to INITIAL_SOURCE |
| `src/hooks/useAzureOAuth.js` | New — OAuth state machine, polling with pause/resume lifecycle |
| `server/routes/azure.js` | Add 4 OAuth routes; all 10 POST handlers pass req.session to resolvePat |
| `server/azure-service.js` | Update resolvePat(bodyPat, session) to check session.azureToken |
| All other step files | Remove internal headers, minor padding/typography |
