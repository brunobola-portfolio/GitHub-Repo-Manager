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

- No changes to the migration logic, API routes, or data model.
- No changes to the URL import flow (UrlInputStep, GitHubSourceStep) — only the Azure DevOps flow.
- No changes to step navigation logic in `useMigrationWizard.js`.

---

## Section 1 — Smart URL Paste (Connect Step)

### What

A prominent "Paste Azure DevOps URL" field appears at the top of the Connect step, before any manual fields.

### Behaviour

- Accepts any Azure DevOps URL format: `https://dev.azure.com/org/project/_git/repo`, browser page URLs, SSH clone URLs (`git@ssh.dev.azure.com:v3/org/project/repo`), shorthand `org/project`.
- Uses the existing `src/utils/azureUrlParser.js` (no changes needed to the parser).
- On input change: parses the value and if org and/or project are found, fills the manual fields below.
- Parsed values shown as confirmation badges inline (e.g. "org: myorg · project: myproject · repo: myrepo").
- Manual Org and Project fields remain below, pre-filled but editable — for corrections or partial URLs.
- If the URL contains a repo name, that value is stored in `source.urlParsedRepo` and passed to `RepoSelectStep` to pre-select the matching repo.
- If the URL contains only the org (no project), only the Org field is filled; the Project dropdown appears after validation.

### Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — add smart paste field at top, wire to `azureUrlParser.js`, pre-fill org/project, store `urlParsedRepo`.
- `src/hooks/useMigrationWizard.js` — add `urlParsedRepo` to `INITIAL_SOURCE`.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — read `source.urlParsedRepo` and auto-select matching repo on mount.

---

## Section 2 — Credential Panel

### What

The credential section is redesigned as three selectable cards, one active at a time.

### Card 1 — Server PAT

- Label: "Server PAT" with subtitle "Configured in the server .env file — no credentials entered here."
- If `AZURE_PAT` env var is set on the server: card shows green "Configured" badge, is selectable.
- If not set: card shows grey "Not configured" badge and expands with setup instructions:
  ```
  Add to your server .env file:
  AZURE_PAT=<your-personal-access-token>
  Then restart the server.
  ```
- Card is always visible (not hidden when unconfigured) — the user can see what the option is and how to enable it.

### Card 2 — Personal PAT

- Label: "Personal Access Token" with subtitle "Paste your own PAT — stays in this browser session only."
- Password input with show/hide toggle.
- Link: "Create PAT →" opens `https://dev.azure.com/{org}/_usersSettings/tokens` (org inserted when available).
- Hint: "Minimum scope: Code (Read). Add Work Items (Read) and Wiki (Read) for full migration."

### Card 3 — OAuth / Browser

- Label: "OAuth / Browser Login" with subtitle "Authenticate via Azure AD — no credentials stored."
- If not configured: shows grey "Not configured" badge and setup instructions:
  ```
  1. Register an app in Azure Portal (Azure Active Directory → App Registrations).
  2. Set Redirect URI to: http://localhost:3001/api/auth/azure/callback
  3. Add to your server .env file:
     AZURE_CLIENT_ID=<app-client-id>
     AZURE_CLIENT_SECRET=<app-client-secret>
     AZURE_TENANT_ID=<tenant-id> (or "common" for multi-tenant)
  4. Restart the server.
  ```
- If configured: shows "Open browser to authenticate" button that opens the OAuth flow in a popup/new tab, with a polling mechanism to detect completion.

### Implementation notes

- Server endpoint `GET /api/azure/oauth-status` returns `{ configured: boolean }` — checked on mount.
- OAuth flow: `GET /api/azure/oauth/start` → redirects to Azure AD → callback `GET /api/azure/oauth/callback` → stores token in session → wizard polls `GET /api/azure/oauth/token` until resolved.
- New server routes in `server/routes/azure.js`.
- New hook `src/hooks/useAzureOAuth.js` manages the OAuth flow state (pending, success, error).

### Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — full credential section rewrite with card UI.
- `src/hooks/useAzureOAuth.js` — new hook for OAuth flow.
- `server/routes/azure.js` — add `/azure/oauth-status`, `/azure/oauth/start`, `/azure/oauth/callback`, `/azure/oauth/token` routes.

---

## Section 3 — Auto-validation

### What

The "Validate" button is removed. Validation triggers automatically.

### Behaviour

- Trigger condition: org is non-empty AND one of: server PAT configured (card 1 selected), personal PAT non-empty (card 2 selected), or OAuth token available (card 3 authenticated).
- On trigger: spinner appears inline next to the org field. No full-page loading state.
- Debounce: 400ms after the last change to org or credential to avoid firing on every keystroke.
- On success: project dropdown slides in with animation. If `source.urlParsedRepo` project is in the list, it is pre-selected.
- On error: contextual message. "Invalid credentials" → suggests checking PAT scope. "Organization not found" → suggests checking the org name. Retry link inline — clicking re-triggers validation immediately.
- Validation and project list fetch run in parallel (single network roundtrip saved vs current sequential flow).

### Files affected

- `src/components/MigrationWizard/steps/SourceStep.jsx` — remove validate button, add debounced auto-validate effect.

---

## Section 4 — Visual Redesign (All Steps)

### Step Indicator

- Connecting lines between circles (CSS flex with `::before` pseudo-element or a `<div>` line).
- Line fills with `bg-emerald-500` for completed segments, `bg-slate-200 dark:bg-slate-700` for future.
- Active circle: larger (w-8 h-8), indigo ring, scale-110.
- Completed circle: emerald, checkmark icon.
- Labels below each circle: unchanged.

### Modal Header

- Each step defines a `title` and `subtitle` — passed up to the wizard and rendered in the modal header area beneath the wizard title.
- Removes the `<h3>` / `<p>` description block from inside each step's content — reduces vertical clutter.
- `MigrationWizard.jsx` passes `stepTitle` and `stepSubtitle` props derived from current step metadata.

### SourceTypeStep

- Three options (Azure DevOps, Git URL, GitHub) become full-width **clickable cards**:
  - Large icon (top or left)
  - Title (bold)
  - One-line description
  - "Recommended" badge on Azure DevOps
- Clicking a card selects it (visual highlight) and auto-advances after 300ms.

### RepoSelectStep / RepoConfigStep

- Repo list items: larger checkbox hit area, repo name in semibold, description in muted text below.
- Selected count badge fixed at top of list: "3 of 12 selected".
- Select All / Deselect All buttons.

### All Other Steps (WorkItems, Wiki, AIReview, Schedule, Summary, Progress)

- Standardise padding, font sizes, and label styles to match the new Connect step.
- No functional changes.

### Files affected

- `src/components/MigrationWizard/MigrationWizard.jsx` — step indicator with connecting lines, step title/subtitle in header.
- `src/components/MigrationWizard/steps/SourceTypeStep.jsx` — card-based layout.
- `src/components/MigrationWizard/steps/RepoSelectStep.jsx` — larger items, selected count badge, select all.
- `src/components/MigrationWizard/steps/SourceStep.jsx` — visual consistency (part of Connect step rewrite).
- All other step files — minor padding/typography standardisation.

---

## Data Flow Summary

```
User pastes URL
  → azureUrlParser extracts { org, project, repo }
  → source.org, source.project, source.urlParsedRepo updated
  → auto-validate fires (debounced 400ms)
    → /api/azure/validate + /api/azure/projects in parallel
    → on success: project dropdown shows, project pre-selected if matched
    → on failure: contextual error + retry
  → user clicks Next
    → RepoSelectStep mounts, pre-selects repo matching source.urlParsedRepo
```

---

## Server: New OAuth Routes (Approach B OAuth card)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/azure/oauth-status` | Returns `{ configured: boolean }` |
| GET | `/api/azure/oauth/start` | Redirects to Azure AD authorization URL |
| GET | `/api/azure/oauth/callback` | Azure AD callback, stores token in session |
| GET | `/api/azure/oauth/token` | Returns `{ ready: boolean, token?: string }` for polling |

Token is stored in the server session only — never sent to the client as a plain value, only used server-side for Azure API calls (same pattern as existing `AZURE_PAT`).

---

## Environment Variables Added

| Variable | Required for | Description |
|----------|-------------|-------------|
| `AZURE_PAT` | Server PAT card | Already exists |
| `AZURE_CLIENT_ID` | OAuth card | Azure AD app client ID |
| `AZURE_CLIENT_SECRET` | OAuth card | Azure AD app client secret |
| `AZURE_TENANT_ID` | OAuth card | Tenant ID or `"common"` |

---

## File Change Summary

| File | Change |
|------|--------|
| `src/components/MigrationWizard/steps/SourceStep.jsx` | Full rewrite — smart paste, credential cards, auto-validate |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Step indicator lines, step title/subtitle in header |
| `src/components/MigrationWizard/steps/SourceTypeStep.jsx` | Card-based layout |
| `src/components/MigrationWizard/steps/RepoSelectStep.jsx` | Larger items, count badge, select all |
| `src/hooks/useMigrationWizard.js` | Add `urlParsedRepo` to `INITIAL_SOURCE` |
| `src/hooks/useAzureOAuth.js` | New — OAuth flow state management |
| `server/routes/azure.js` | Add 4 OAuth routes |
| All other step files | Minor padding/typography standardisation |
