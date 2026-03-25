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
- On input change: the raw parser result is inspected for non-null fields. Badges are shown for whichever of `org`, `project`, and `repo` are non-null in the result, regardless of whether `result.error` is also set:
  - org + project + repo: "org: myorg · project: myproject · repo: myrepo"
  - org + project only: "org: myorg · project: myproject"
  - org only (e.g. `https://dev.azure.com/myorg` returns `{ org: 'myorg', project: null, error: '...' }`): "org: myorg"
  - No non-null fields: no badges shown; parser error message shown in muted text if non-empty.
- Note: a bare org name (e.g. `myorg` with no slash) is not a supported shorthand in the existing parser and will show no badges. The supported shorthands are `org/project` and `org/project/repo`.
- Non-null field values from the parser are written to `source.org`, `source.project`, and `source.urlParsedRepo`. Null values do not overwrite existing manual input.
- Manual Org and Project fields remain below, pre-filled but editable — for corrections or partial URLs.
- If the URL contains a repo name (`_git/repo` segment or three-segment shorthand), that value is stored in `source.urlParsedRepo` and used in `RepoSelectStep` to auto-select the matching repo on mount.
- If the URL yields only an org (no project), only the Org field is filled; the Project dropdown appears after validation completes.

### 1.3 Project selection and Next button

The existing `azureConnect` validator in `useMigrationWizard.js` requires both `source.validated === true` AND `source.project` to be non-empty before Next is allowed. This is unchanged. The flow is:

1. Auto-validation sets `source.validated = true` on success.
2. The Project dropdown appears.
3. The user selects (or confirms the pre-selected) project.
4. Next becomes active.

Even if the pasted URL contained a project name that was pre-selected in the dropdown, the user still sees the dropdown and can change their choice before clicking Next.

### 1.4 Back navigation and state reset

If the user navigates Back from a later step and returns to `SourceStep`, the `credentialMode` state is preserved but switching to a different `credentialMode` resets `source.validated = false` and clears the project list (`setProjects([])`). This ensures the user cannot proceed with stale validation from a previous credential selection.

### 1.5 New wizard state fields

Add to `INITIAL_SOURCE` in `useMigrationWizard.js`:

- `urlParsedRepo: ''` — repo name extracted from URL paste, used for pre-selection in RepoSelectStep.
- `credentialMode: ''` — which credential card is active: `'serverPat' | 'personalPat' | 'oauth' | ''`.

### 1.6 Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — add smart paste field at top, wire to `azureUrlParser.js`, pre-fill org/project, store `urlParsedRepo`.
- `src/hooks/useMigrationWizard.js` — add `urlParsedRepo` and `credentialMode` to `INITIAL_SOURCE`.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — read `source.urlParsedRepo` and auto-select matching repo on mount.

---

## Section 2 — Credential Panel

### 2.1 What

The credential section is redesigned as three selectable cards, one active at a time. The active card is tracked in `source.credentialMode`.

**Initialisation on mount:** `SourceStep` calls `GET /api/azure/env-auth` and `GET /api/azure/oauth-status` in parallel. While both calls are in flight, the credential panel shows a loading skeleton (three greyed-out cards). Once resolved:

- If server PAT available → default `credentialMode` to `'serverPat'`.
- Else default to `'personalPat'`.

### 2.2 Card 1 — Server PAT

`credentialMode: 'serverPat'`

- Label: "Server PAT" with subtitle "Configured in the server .env file — no credentials entered here."
- Availability determined by existing `GET /api/azure/env-auth` → `{ available: boolean }` (unchanged).
- If available: card shows green "Configured" badge, is selectable.
- If not available: card shows grey "Not configured" badge, is not selectable, and expands with setup instructions:

  ```text
  Add to your server .env file:
    AZURE_PAT=<your-personal-access-token>
  Then restart the server.
  ```

- Card is always visible even when unconfigured.

### 2.3 Card 2 — Personal PAT

`credentialMode: 'personalPat'`

- Label: "Personal Access Token" with subtitle "Paste your own PAT — used only for this session, transmitted per API call to the server, never persisted."
- PAT stored in `source.pat` (same as today). Sent in the body of each Azure API request. Not stored server-side.
- Password input with show/hide toggle.
- Link: "Create PAT →" opens `https://dev.azure.com/{org}/_usersSettings/tokens` (org inserted when available).
- Hint: "Minimum scope: Code (Read). Add Work Items (Read) and Wiki (Read) for full migration."

### 2.4 Card 3 — OAuth / Browser

`credentialMode: 'oauth'`

- Label: "OAuth / Browser Login" with subtitle "Authenticate via Azure AD — token stored in server session only."
- Availability: `GET /api/azure/oauth-status` returns `{ configured: boolean }`. `configured` is `true` when `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID` are all present and non-empty in the server environment.
- If not configured: card shows grey "Not configured" badge, is not selectable, and expands with setup instructions:

  ```text
  1. Register an app in Azure Portal (Azure Active Directory → App Registrations).
  2. Set Redirect URI to: http://localhost:3001/api/azure/oauth/callback
  3. Add to your server .env file:
       AZURE_CLIENT_ID=<app-client-id>
       AZURE_CLIENT_SECRET=<app-client-secret>
       AZURE_TENANT_ID=<tenant-id>  (or "common" for multi-tenant)
  4. Restart the server.
  ```

- If configured: shows "Open browser to authenticate" button. Clicking calls `window.open('/api/azure/oauth/start', '_blank')`. If the browser blocks the popup, show fallback: "Popup blocked — allow popups for this page and try again." Note: all OAuth routes apply `requireAuth` middleware. Since users are already authenticated to the app when using this wizard, the redirect-to-login case should not occur in practice.
- After opening, `useAzureOAuth.js` polls `GET /api/azure/oauth/token` every 1000ms for up to 120 seconds.
  - `ready: true` → stop polling, mark OAuth ready, trigger auto-validate.
  - Timeout (120s) → stop polling, show "Authentication timed out — try again."
  - Network error → stop polling, show error with retry button.
- The access token is stored in the server session only. `GET /api/azure/oauth/token` returns `{ ready: boolean }` — the token value is never sent to the client.

### 2.5 `useAzureOAuth` hook API

```js
// src/hooks/useAzureOAuth.js
const { oauthStatus, startOAuth, retryOAuth } = useAzureOAuth()
// oauthStatus: 'idle' | 'pending' | 'success' | 'error' | 'timeout'
// startOAuth(): opens the OAuth tab and starts polling
// retryOAuth(): resets to 'idle' so the user can try again
```

`SourceStep` reads `oauthStatus` to determine whether the OAuth credential is ready for auto-validate.

### 2.6 Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — full credential section rewrite with card UI.
- `src/hooks/useAzureOAuth.js` — new hook: state machine (idle → pending → success/error/timeout), polling (1000ms interval, 120s max).
- `server/routes/azure.js` — add 4 OAuth routes; `GET /api/azure/env-auth` unchanged.
- `server/azure-service.js` — extend `resolvePat(bodyPat, session)` to also check `session.azureToken` as a fallback, enabling OAuth-authenticated requests to all existing Azure API endpoints.

---

## Section 3 — Auto-validation

### 3.1 What

The "Validate" button is removed. Validation triggers automatically.

### 3.2 Behaviour

**Validation is org-level** — it checks that the org name is valid and credentials work. Project is not required to trigger validation; projects are fetched in the same auto-validate call and the Project dropdown appears on success.

**Trigger condition:** `source.org` is non-empty AND one of:

- `credentialMode === 'serverPat'` (server PAT available)
- `credentialMode === 'personalPat'` AND `source.pat` is non-empty
- `credentialMode === 'oauth'` AND `oauthStatus === 'success'`

**Debounce:** 400ms after the last change to `source.org` or `source.pat`. Exception: switching `credentialMode` to `'serverPat'` (when already confirmed available) or OAuth reaching `'success'` triggers validation immediately.

**Parallel fetch:** `POST /api/azure/validate` and `POST /api/azure/projects` are called with `Promise.all`. Both use `POST` with body `{ org: source.org, pat: credentialMode === 'personalPat' ? source.pat : undefined }`. For `serverPat` and `oauth` modes, `pat` is omitted — the server resolves credentials from `process.env.AZURE_PAT` (server PAT mode) or `req.session.azureToken` (OAuth mode) via the updated `resolvePat(bodyPat, session)`.

If `/api/azure/validate` returns `valid: false`, the project list response is discarded and the error is shown.

**On success:**

- Call `onChange({ validated: true })` — required so the existing `azureConnect` validator allows Next.
- Project dropdown slides in with animation.
- If `source.project` (pre-filled from URL parse) matches a name in the project list, it is pre-selected.

**On error:** contextual message — "Invalid credentials" suggests checking PAT scope; "Organization not found" suggests checking the org name. Retry link re-triggers validation immediately.

Spinner appears inline next to the org field during validation. No full-page loading state.

**Switching credential mode after validation:** switching `credentialMode` resets `source.validated = false`, clears the project list, and re-triggers auto-validate with the new credential (subject to the trigger condition above).

### 3.3 Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — remove validate button, add debounced auto-validate `useEffect`, handle `oauthStatus` from `useAzureOAuth`.
- `server/azure-service.js` — update `resolvePat` signature to `resolvePat(bodyPat, session)`, checking `session?.azureToken` as fallback.
- `server/routes/azure.js` — pass `req.session` to `resolvePat` in all existing route handlers.

---

## Section 4 — Visual Redesign

### 4.1 Step Indicator

- Connecting lines between circles implemented as `<div>` elements with `flex-1` between each circle, filled with `bg-emerald-500` for completed segments and `bg-slate-200 dark:bg-slate-700` for future segments.
- Active circle: larger (w-8 h-8), indigo ring, scale-110.
- Completed circle: emerald background, checkmark icon.
- Labels below each circle: unchanged.

### 4.2 Modal Header / Step Titles

A `STEP_META` map is defined directly in `MigrationWizard.jsx`. It maps each step key to `{ title, subtitle }`:

```js
const STEP_META = {
  azureConnect: { title: 'Connect to Azure DevOps', subtitle: 'Enter your organization and credentials.' },
  repoSelect:   { title: 'Select Repositories', subtitle: 'Choose which repos to migrate.' },
  // ... etc.
}
```

`MigrationWizard.jsx` renders the current step's title and subtitle beneath the wizard title in the modal header. Each step file removes its internal `<h3>` / `<p>` description block — this content lives in `STEP_META`.

### 4.3 SourceTypeStep

Three options (Azure DevOps, Git URL, GitHub) become full-width clickable cards with:

- Left-aligned icon
- Title (bold)
- One-line description
- "Recommended" badge on Azure DevOps

Clicking a card selects it (visual highlight) and auto-advances after 300ms. This is a **new behaviour** — the current step does not auto-advance.

### 4.4 RepoSelectStep

The existing Select All / Deselect All buttons and selected count already exist — no functional change. Visual improvements only: larger checkbox hit area, repo name in semibold, description in muted text below each repo name. Count badge style updated to match new design.

### 4.5 All Other Steps

WorkItems, Wiki, AIReview, Schedule, Summary, Progress: remove internal `<h3>` / `<p>` headers (moved to `STEP_META`), standardise padding/font sizes/label styles. No functional changes.

### 4.6 Files affected

- `src/components/MigrationWizard/MigrationWizard.jsx` — step indicator with connecting lines, `STEP_META` map, step title/subtitle in header.
- `src/components/MigrationWizard/steps/SourceTypeStep.jsx` — card-based layout, auto-advance on selection, remove internal header.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — visual improvements, remove internal header.
- `src/components/MigrationWizard/steps/SourceStep.jsx` — remove internal header (part of Connect step rewrite).
- All other step files — remove internal `<h3>`/`<p>` headers, minor padding/typography standardisation.

---

## Data Flow Summary

```text
User pastes URL into smart paste field
  → azureUrlParser extracts { org, project, repo }
  → non-null values written to source.org, source.project, source.urlParsedRepo
  → badges shown for extracted fields
  → auto-validate fires (debounced 400ms, or immediately for serverPat/oauth-success)
    → Promise.all([POST /api/azure/validate, POST /api/azure/projects])
    → server resolves credentials: env PAT → session token → body PAT
    → on success:
        onChange({ validated: true })
        project dropdown appears, source.project pre-selected if matched
    → on failure:
        discard project list, show contextual error + retry
  → user selects project → clicks Next
  → RepoSelectStep mounts, auto-selects repo where repo.name === source.urlParsedRepo
```

---

## Server: New OAuth Routes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/azure/oauth-status` | Returns configured boolean (all 3 env vars present) |
| GET | `/api/azure/oauth/start` | Redirects browser to Azure AD authorization URL |
| GET | `/api/azure/oauth/callback` | Azure AD callback; stores access token in session only |
| GET | `/api/azure/oauth/token` | Returns ready boolean — token value never sent to client |

Existing `GET /api/azure/env-auth` is unchanged.

---

## Environment Variables

| Variable              | Required for    | Description                              |
| --------------------- | --------------- | ---------------------------------------- |
| `AZURE_PAT`           | Server PAT card | Already exists                           |
| `AZURE_CLIENT_ID`     | OAuth card      | Azure AD app client ID                   |
| `AZURE_CLIENT_SECRET` | OAuth card      | Azure AD app client secret               |
| `AZURE_TENANT_ID`     | OAuth card      | Tenant ID or `"common"` for multi-tenant |

---

## File Change Summary

| File                                                      | Change                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/components/MigrationWizard/steps/SourceStep.jsx`     | Full rewrite — smart paste, credential cards, auto-validate      |
| `src/components/MigrationWizard/MigrationWizard.jsx`      | Step indicator lines, `STEP_META` map, step title/subtitle       |
| `src/components/MigrationWizard/steps/SourceTypeStep.jsx` | Card-based layout, auto-advance on selection, remove header      |
| `src/components/MigrationWizard/steps/RepoSelectStep.jsx` | Visual improvements, remove internal header                      |
| `src/hooks/useMigrationWizard.js`                         | Add `urlParsedRepo` and `credentialMode` to `INITIAL_SOURCE`     |
| `src/hooks/useAzureOAuth.js`                              | New — OAuth flow state and polling (1s interval, 120s max)       |
| `server/routes/azure.js`                                  | Add 4 OAuth routes; pass `req.session` to `resolvePat`           |
| `server/azure-service.js`                                 | Update `resolvePat(bodyPat, session)` to check `session.azureToken` |
| All other step files                                      | Remove internal headers, minor padding/typography                |
