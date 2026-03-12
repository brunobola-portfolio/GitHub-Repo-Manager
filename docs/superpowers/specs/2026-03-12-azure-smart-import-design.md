# Azure DevOps Smart Import — Design Spec

**Date:** 2026-03-12
**Status:** Approved
**Scope:** Simplify Azure DevOps import flow in ImportWizard with smart URL parsing and auto-authentication

---

## Problem

The current Azure DevOps import flow has 6 steps and requires users to manually enter organization name and PAT separately. Users who have an Azure DevOps URL (e.g., `https://dev.azure.com/brunobola/BolaLabs`) must manually extract the org name and type it in. There's no way to reuse credentials across imports.

## Solution

Replace the Azure credentials step with a single smart URL field that auto-parses any Azure DevOps URL format, combined with automatic PAT resolution from the server `.env`. This reduces the flow from 6 steps to 2-4 depending on context.

---

## 1. Smart URL Parser

### Supported URL Formats

The parser must extract `org`, `project`, and optionally `repo` from all of these formats:

#### Standard dev.azure.com URLs
| Input | Org | Project | Repo |
|---|---|---|---|
| `https://dev.azure.com/{org}/{project}` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_git/{repo}` | org | project | repo |
| `https://dev.azure.com/{org}/_git/{project}` | org | project | project |

#### URLs with subpages (user is browsing Azure DevOps)
| Input | Org | Project | Repo |
|---|---|---|---|
| `https://dev.azure.com/{org}/{project}/_git/{repo}?path=/src&version=GBmain` | org | project | repo |
| `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequests` | org | project | repo |
| `https://dev.azure.com/{org}/{project}/_git/{repo}/commits` | org | project | repo |
| `https://dev.azure.com/{org}/{project}/_git/{repo}/branches` | org | project | repo |
| `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/42` | org | project | repo |
| `https://dev.azure.com/{org}/{project}/_boards/board/t/Team/Stories` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_workitems/edit/123` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_build` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_releases` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_wiki/wikis/...` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_settings/repositories` | org | project | — |
| `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}` | org | project | repo |

#### Clone URLs (from "Clone" button)
| Input | Org | Project | Repo |
|---|---|---|---|
| `https://{org}@dev.azure.com/{org}/{project}/_git/{repo}` | org | project | repo |
| `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}` | org | project | repo |

#### Legacy visualstudio.com format
| Input | Org | Project | Repo |
|---|---|---|---|
| `https://{org}.visualstudio.com/{project}` | org | project | — |
| `https://{org}.visualstudio.com/{project}/_git/{repo}` | org | project | repo |
| `https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}` | org | project | repo |

#### Shorthand (no full URL)
| Input | Org | Project | Repo |
|---|---|---|---|
| `{org}/{project}` | org | project | — |
| `{org}/{project}/{repo}` | org | project | repo |

### Pre-processing

Before parsing, the input is:
1. Trimmed of whitespace
2. Query parameters (`?...`) removed
3. Fragment (`#...`) removed
4. Trailing slashes removed
5. URL-decoded (`%20` → space, etc.)
6. Username prefix stripped (`user@` from clone URLs)
7. `DefaultCollection/` segment stripped (TFS legacy)

### Non-Azure URL Detection

If the URL contains known domains from other services, show a helpful redirect:
- `github.com` → "This looks like a GitHub URL. Use the 'Git URL' option to import."
- `gitlab.com` → "This looks like a GitLab URL. Use the 'Git URL' option to import."
- `bitbucket.org` → "This looks like a Bitbucket URL. Use the 'Git URL' option to import."

### Real-time Visual Feedback

As the user types/pastes, show parsed results below the field:
- `✓ Organization: brunobola`
- `✓ Project: BolaLabs`
- `✓ Repository: MyRepo` (if detected)
- Or: `⚠ Could not parse URL. Examples: https://dev.azure.com/org/project`

### Implementation Location

Create a new utility: `src/utils/azureUrlParser.js`
- Pure function, no side effects, fully testable
- `parseAzureUrl(input)` → `{ org, project, repo, error, suggestion }`

---

## 2. PAT Authentication Flow

### Resolution Hierarchy

1. **Server `.env`** — If `AZURE_DEVOPS_PAT` is set, use it automatically
2. **Manual input** — If no env PAT, show field to user

### New Backend Endpoint

**GET `/api/azure/has-pat`** (authenticated)
- Returns `{ hasPat: boolean }` — whether server has a PAT configured
- Does NOT return the PAT itself to the client
- Used by frontend to decide whether to show PAT field

### UX: PAT from `.env`

After URL is parsed, frontend calls `/api/azure/has-pat`:
- If `true`: shows "Authenticated via server configuration" and auto-validates
- Validation calls existing `POST /api/azure/validate` (backend uses env PAT when no PAT in request body)
- If validation fails: shows error + falls back to manual PAT field

### UX: Manual PAT

When no server PAT is available:
- PAT field appears inline below the parsed URL feedback
- Placeholder: "Paste your Personal Access Token"
- Direct link: "Create PAT at dev.azure.com/{org}/_usersSettings/tokens" (org from parsed URL)
- Visibility toggle (eye icon)
- Scope hint: "Required scope: Code (Read)"

### Backend Changes to `POST /api/azure/validate`

Modify to support optional PAT in request body:
- If `pat` is provided in body → use it (current behavior)
- If `pat` is not provided → use `process.env.AZURE_DEVOPS_PAT`
- If neither exists → return error

Same logic applies to `POST /api/azure/projects` and `POST /api/azure/repos`.

### Error Messages (Actionable)

| Situation | Message |
|---|---|
| Env PAT invalid/expired | "Server authentication failed (PAT invalid or expired)." → Show manual field |
| Env PAT wrong org | "Server PAT doesn't have access to organization X." → Show manual field |
| Manual PAT invalid | "Invalid token. Make sure you copied the full PAT." |
| Manual PAT wrong scope | "This PAT lacks Code (Read) permissions. Create a new one with the correct scope." |
| Network timeout | "Could not reach Azure DevOps. Check your connection." + Retry button |
| Rate limited | "Azure DevOps is rate limiting requests. Retrying..." + auto backoff |
| Org doesn't exist | "Organization 'brunobla' not found on Azure DevOps. Check the URL." |

---

## 3. Simplified Flow

### Step Reduction

| Scenario | Steps | Details |
|---|---|---|
| URL with repo + env PAT | 2 | URL → Target+Confirm |
| URL with project + env PAT | 3 | URL → Pick repo → Target+Confirm |
| URL + manual PAT | 3-4 | URL+PAT → (Pick repo) → Target+Confirm |

All scenarios end with the existing progress step (polling `/api/import/status/{id}`).

### Step 1: Smart URL Input

**Layout:**
- Large input field with placeholder examples
- Real-time parse feedback below
- PAT field (conditional — only if no env PAT)
- Validate button triggers: PAT validation → project/repo fetch

**Auto-skip logic:**
- If URL contained a specific repo AND PAT validates → skip repo selection, go to Target+Confirm
- If URL was project-level → load repos, show selection step
- If project has exactly 1 repo → auto-select it, skip to Target+Confirm

### Step 2: Repo Selection (conditional)

Only shown when URL pointed to a project (not a specific repo) and project has 2+ repos.

**Repo list shows:**
- Repo name
- Size (formatted)
- Default branch
- Status badges: "Disabled" (not selectable), "Empty" (selectable with warning)

### Step 3: Target + Confirm (combined)

Combines the old Target and Review steps into one:
- Source summary (read-only): "Azure DevOps · brunobola/BolaLabs/MyRepo"
- GitHub Owner dropdown (personal + orgs)
- Repository Name (auto-filled from source repo name)
- Description (optional)
- Private checkbox (default: true)
- Info note: "Imports Git code and history. Issues, PRs, and pipelines are not migrated."
- Import button

**Pre-validation on target name:**
- Check if repo already exists on GitHub before allowing import
- If exists: yellow warning "Repository 'MyRepo' already exists under brunobola."

### Step 4: Progress

Unchanged from current implementation — progress bar, polling every 2s, success/error states.

---

## 4. Error Handling & Edge Cases

### Parse Errors (inline, never blocking)

| Situation | Behavior |
|---|---|
| Empty field | Show placeholder examples, no error |
| URL from another service | Redirect message with link to switch source type |
| Unrecognizable URL | "Could not identify as Azure DevOps URL." + examples |
| Azure URL without project | "URL recognized (org: X) but no project found. Paste a project or repo URL." |

### Repo States

| Situation | Behavior |
|---|---|
| 0 repos in project | "This project has no repositories." + check permissions hint |
| 1 repo in project | Auto-select, skip picker |
| Repo disabled | Show in list with "Disabled" badge, not selectable |
| Repo empty (no commits) | Selectable with "Empty" warning |
| Large repo (>500MB) | Warning before confirm: "This repository is ~X GB. Import may take a while." |
| Repo with LFS | Info badge: "Git LFS detected. LFS objects will be migrated automatically." |

### Import Errors

| Situation | Behavior |
|---|---|
| GitHub repo name conflict | Pre-check before import, warn user |
| Import fails mid-way | Error + details + "Retry" button (cleans up partial GitHub repo) |
| Modal closed during import | Import continues in background. Notification on completion. |
| Git not installed on server | Error at step 1: "Git is not available on the server." |

---

## 5. Files to Modify

### New Files
- `src/utils/azureUrlParser.js` — Pure URL parser function

### Modified Files
- `src/components/ImportWizard.jsx` — Replace azure-creds step, add smart URL input, combine target+review
- `server/routes/azure.js` — Add `GET /api/azure/has-pat`, modify endpoints to support env PAT fallback
- `server/azure-service.js` — Accept optional PAT parameter with env fallback

### Potentially Remove
- `src/components/AzureImportModal.jsx` — Deprecated, replaced by improved ImportWizard

---

## 6. Non-Goals

- Storing PAT in the database (may be added later)
- Multi-org PAT management
- Migrating issues, PRs, wikis, or pipelines
- Azure DevOps Server (on-premises) support
