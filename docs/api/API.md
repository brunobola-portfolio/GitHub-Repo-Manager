# GitHub Repo Manager - API Reference

**Base URL:** `http://localhost:3001/api`
**Versioned alias:** Every route below is served under both `/api/*` (legacy) and `/api/v1/*`. The two prefixes hit the same handlers — `server/index.js` mounts the v1 aggregator at both (`app.use('/api/v1', v1Routes)` and `app.use('/api', v1Routes)`).
**Authentication:** GitHub OAuth via session cookies, or an API key sent as `Authorization: Bearer grm_live_...`. Most endpoints require an authenticated session (`requireAuth` middleware). The server never exposes raw access tokens to the client.
**CSRF:** All mutating `/api/*` requests (non-GET/HEAD/OPTIONS) require a valid `X-CSRF-Token` header. The OAuth flow and signature-verified webhooks are exempt.
**Request validation:** Write endpoints validate their JSON body with Zod (`validateBody` middleware). An invalid body returns `400 { error, code: 'VALIDATION_ERROR' }` — see [Shared Response Envelopes](#shared-response-envelopes).
**Total Endpoints:** 351 route handlers (342 across `server/routes/**` — 77 route files, recounted via `grep -rEc "^\s*router\.(get|post|put|patch|delete)\(" server/routes` — plus 9 app-level routes mounted directly in `server/index.js`: webhooks, health, and the brand guide at `/brand`). This document gives full entries for the public-facing and recently-changed surface; lower-level internal routes are summarised under [Additional Endpoints](#additional-endpoints-grouped).

---

## Table of Contents

- [Shared Response Envelopes](#shared-response-envelopes)
- [Authentication](#authentication-apiauth)
- [User](#user-api)
- [User Data & Privacy (GDPR)](#user-data--privacy-gdpr-apiuserdata)
- [Repositories](#repositories-apirepos)
- [Organizations](#organizations-apiorgs)
- [Teams](#teams-apiteams)
- [AI](#ai-apiai)
- [Bulk Operations](#bulk-operations-api)
- [Import](#import-apiimport)
- [Azure DevOps](#azure-devops-apiazure)
- [Webhooks](#webhooks-apiwebhooks)
- [Migration Plans](#migration-plans-apimigration)
- [Migration Marks](#migration-marks-apimigrationmarks)
- [Statistics](#statistics-apistats)
- [System](#system-apisystem)
- [Health Probes](#health-probes-apihealth)
- [Billing](#billing-apibilling)
- [Audit Log](#audit-log-apiaudit)
- [Usage Metrics](#usage-metrics-apiusage)
- [API Keys](#api-keys-apiapi-keys)
- [Stripe Webhooks](#stripe-webhooks-apiv1webhooksstripe)
- [Dashboard](#dashboard-apiv1dashboard)
- [Additional Endpoints](#additional-endpoints-grouped)

---

## Shared Response Envelopes

These envelopes are produced by shared middleware and apply across the entire API. Individual endpoint entries below do not repeat them.

### Validation error — `400`

Emitted by `validateBody` / `validateQuery` / `validateParams`
(`server/middleware/validate-request.js`) when a request body/query/params fails
its Zod schema. The message names the offending field.

```json
{
  "error": "title: String must contain at least 1 character(s)",
  "code": "VALIDATION_ERROR"
}
```

`validation_failed` — the pre-rename value — is aliased for one release for
any caller still matching on it; new code should compare against
`VALIDATION_ERROR`. A handful of older endpoints not yet migrated onto this
shared helper (e.g. the git-ref and SVG/README path checks noted inline
below) still emit `validation_failed` directly.

### Authentication required — `401`

Emitted by `requireAuth` (`server/middleware/auth.js`) when there is no valid
session token or API key:

```json
{ "error": "Session expired. Please login again." }
```

An invalid `Authorization: Bearer grm_live_...` key returns `{ "error": "Invalid API key" }`.

### Tier gate — `403`

Emitted by `requireTier(minTier)` (`server/middleware/require-tier.js`,
payload from `tierRequiredPayload` in `server/lib/usage-meter.js`) when the
caller's tier is below the required tier. `code` is `TIER_REQUIRED_PRO` or
`TIER_REQUIRED_ENTERPRISE`.

```json
{
  "error": "Tier required",
  "code": "TIER_REQUIRED_PRO",
  "feature": "/repos/owner/repo/sync",
  "currentTier": "free",
  "requiredTier": "pro"
}
```

### AI not configured — `400`

Emitted by `requireAI` when no AI provider key (user BYOK or server fallback) is available:

```json
{
  "error": "AI_NOT_CONFIGURED",
  "message": "AI features require a provider API key. Configure one in Settings → AI Configuration.",
  "configureUrl": "/settings#ai"
}
```

### AI quota / usage-limit exceeded — `429`

Emitted by metered AI endpoints (`quotaExceededResponse` in
`server/lib/usage-meter.js`) once a per-feature or global `ai_queries` cap is hit:

```json
{
  "error": "usage_limit_exceeded",
  "code": "QUOTA_EXCEEDED",
  "feature": "ai_semantic_search",
  "resetAt": "2026-08-01T00:00:00.000Z",
  "upgradeTo": "pro",
  "message": "Semantic Search limit reached (375/375 this month). Upgrade to Pro for unlimited.",
  "metric": "ai_semantic_search",
  "limit": 375,
  "current": 375,
  "remaining": 0,
  "upgradeUrl": "/pricing"
}
```

### Server error — `500`

The global error handler and per-route `catch` blocks return
`{ "error": "<message>" }`. In production the message is the generic fallback
(`safeError` hides internals); in development it carries the real error text.

### Multi-status — `207`

Bulk operations return `207` when some items succeed and others fail; the body
carries a per-item `results` array.

---

## Authentication (`/api/auth/*`)

### `GET /api/auth/login`

Initiates the GitHub OAuth flow. Redirects the user to GitHub's authorization page.

| Detail | Value |
|---|---|
| Auth required | No |
| OAuth scopes requested | `repo`, `delete_repo`, `read:org`, `admin:org` |

**Response:** `302` redirect to GitHub OAuth authorize URL.

---

### `GET /api/auth/callback`

Handles the OAuth callback from GitHub. Exchanges the temporary code for an access token, upserts the user in the local database, and stores the token in the session.

| Detail | Value |
|---|---|
| Auth required | No |

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `code` | string | Temporary authorization code from GitHub |
| `state` | string | CSRF protection state parameter |

**Response:** `302` redirect to `FRONTEND_URL` on success, or with `?error=<code>` on failure.

**Error Codes:**
- `no_code` - No authorization code received
- `invalid_state` - CSRF state mismatch
- `auth_failed` - Token exchange or user fetch failed
- `session_error` - Session regeneration/save failed

---

### `GET /api/auth/session`

Check the current session status.

| Detail | Value |
|---|---|
| Auth required | No |

**Success Response (200):**
```json
{
  "authenticated": true,
  "userId": 12345,
  "hasToken": true
}
```

**Unauthenticated Response (401):**
```json
{
  "authenticated": false
}
```

---

### `POST /api/auth/logout`

Destroy the current session.

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**
```json
{
  "success": true
}
```

---

### `POST /api/auth/mock`

Create a mock login session for development. Disabled in production.

| Detail | Value |
|---|---|
| Auth required | No |
| Environment | Development only |

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": 999999,
    "username": "dev-user",
    "avatar_url": "https://github.com/ghost.png",
    "email": "dev@example.com"
  }
}
```

**Error (404):** Returns `Not found` in production.

---

## User (`/api/*`)

### `GET /api/user`

Get the authenticated user's GitHub profile.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** GitHub user object (see [GitHub API docs](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)).

**Error Codes:**
- `401` - Token invalid; session is destroyed

---

### `GET /api/activity`

Get activity events for a GitHub user.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `username` | string | Yes | GitHub username |

**Response (200):** Array of GitHub event objects.

**Error Codes:**
- `400` - Missing or invalid username

---

### `GET /api/search/users`

Search GitHub users by query string.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes | Search query |

**Response (200):** Array of GitHub user objects (max 5 results).

---

## User Data & Privacy (GDPR) (`/api/user/data/*`)

Self-service data portability (GDPR Article 20) and erasure (GDPR Article 17 / SOC 2 CC6.5). Backed by `server/routes/user-data.js`; mounted at `/api/user/data`. Erasure is registry-driven: an `ERASURE_REGISTRY` classifies every user-keyed table as `erase`, `cascade`, `tombstone`, or `survive`, and a completeness test fails CI if a new user-keyed table is left unclassified.

### `GET /api/user/data/export`

Export every row keyed to the authenticated user across the tables the erasure handler would wipe. Read-only; no side effects. Streams a downloadable JSON attachment (`Content-Disposition: attachment; filename="<login>-data-export-<ts>.json"`). Secret material is never included — encrypted Azure PATs and API-key material are excluded (only metadata/prefixes are exported). Heavy tables are capped at 50,000 rows each and flagged in a `truncated` map.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** JSON body with `exportedAt`, `schemaVersion: 2`, `user`, and per-table arrays (`aiConfig`, `subscriptions`, `apiKeys`, `migrationJobs`, `migrationPlans`, `prEvents`, `issueEvents`, `reviewAssignments`, `communityHealthCache`, `repoMetadata`, `workflowRuns`, `workflowsMeta`, `usageMetrics`, `teamMemberships`, `azureCredentials`, `aiPrompts`, `aiReviewPrompts`, `aiPrReviews`, `aiPrCommands`, `aiPrChatMessages`, `workBoardPrefs`, `workBoardTrackedRepos`, `workBoardPresets`, `truncated`).

**Error Codes:**
- `404` - User not found
- `500` - Export failed

---

### `DELETE /api/user/data`

Wipe all personal-data rows for the authenticated user and tombstone the `users` row (email/avatar nulled, `username` set to `deleted-user`, `deleted_at` set) so audit history keeps referential integrity. Runs as a single transaction, then destroys the session.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `confirmString` | string | Yes | Must equal exactly `ERASE MY DATA` |

**Response (200):**

```json
{
  "deleted": { "user_ai_config": 1, "migration_jobs": 4, "gh_outbox": 0 },
  "tombstoned": ["user", "audit_log_v2"]
}
```

`deleted` maps each erased table to its deleted-row count. `tombstoned` lists the retained-but-anonymised records (the `users` row and the append-only `audit_log_v2` hash chain, which is retained for compliance).

**Error Codes:**
- `400` - `confirmString` does not match exactly, or the user still has an active subscription (cancel it first)
- `404` - User not found, or already erased
- `500` - Erasure failed (no data was changed)

---

## Repositories (`/api/repos/*`)

### `GET /api/repos`

List repositories (personal or for a specific organization).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `per_page` | number | 30 | Results per page |
| `org` | string | "" | Organization login (empty for all user repos) |

**Response (200):**
```json
{
  "repos": [...],
  "page": 1,
  "totalPages": 5
}
```

---

### `POST /api/repos`

Create a new repository (personal or in an organization).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Repository name |
| `description` | string | No | Repository description |
| `org` | string | No | Organization login (omit for personal) |
| `private` | boolean | No | Default `true` |
| `auto_init` | boolean | No | Default `true` |

**Response (200):**
```json
{
  "success": true,
  "repo": { ... }
}
```

**Error Codes:**
- `400` - Missing or invalid repository name / invalid org name

---

### `POST /api/repos/generate`

Create a repository from a template.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `template_owner` | string | Yes | Template repository owner |
| `template_repo` | string | Yes | Template repository name |
| `owner` | string | Yes | Target owner (user or org) |
| `name` | string | Yes | New repository name |
| `description` | string | No | Description |
| `include_all_branches` | boolean | No | Include all branches from template |
| `private` | boolean | No | Visibility |

**Response (200):**
```json
{
  "success": true,
  "repo": { ... }
}
```

---

### `GET /api/repos/:owner/:repo`

Get details for a single repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** GitHub repository object.

---

### `PATCH /api/repos/:owner/:repo`

Update repository settings.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body (all optional):**

| Field | Type | Description |
|---|---|---|
| `name` | string | Repository name |
| `description` | string | Description |
| `homepage` | string | Homepage URL |
| `private` | boolean | Visibility |
| `has_issues` | boolean | Enable issues |
| `has_projects` | boolean | Enable projects |
| `has_wiki` | boolean | Enable wiki |
| `default_branch` | string | Default branch name |
| `allow_squash_merge` | boolean | Allow squash merging |
| `allow_merge_commit` | boolean | Allow merge commits |
| `allow_rebase_merge` | boolean | Allow rebase merging |
| `delete_branch_on_merge` | boolean | Auto-delete head branches |

**Response (200):** Updated repository object.

---

### `PUT /api/repos/:owner/:repo/topics`

Replace repository topics.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `names` | string[] | Yes | Array of topic names |

**Response (200):** Topics object from GitHub.

---

### `POST /api/repos/:owner/:repo/forks`

Fork a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body (all optional):**

| Field | Type | Description |
|---|---|---|
| `organization` | string | Fork into this organization |
| `name` | string | Custom fork name |
| `default_branch_only` | boolean | Fork only the default branch |

**Response (200):**
```json
{
  "success": true,
  "repo": { ... }
}
```

---

### Collaborators

#### `GET /api/repos/:owner/:repo/collaborators`

List collaborators for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of GitHub user objects. Returns `[]` if insufficient permissions (403).

---

#### `PUT /api/repos/:owner/:repo/collaborators/:username`

Add a collaborator to a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `permission` | string | `"push"` | Permission level (`pull`, `push`, `admin`) |

**Response (200):**
```json
{
  "success": true,
  "invitation": { ... }
}
```

**Error Codes:**
- `400` - Invalid username format

---

### Branches

#### `GET /api/repos/:owner/:repo/branches`

List branches for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `protected` | boolean | - | Filter to protected branches only |
| `per_page` | number | 100 | Results per page |

**Response (200):** Array of branch objects.

---

#### `GET /api/repos/:owner/:repo/branches/:branch`

Get details for a specific branch.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Branch object.

---

#### `POST /api/repos/:owner/:repo/branches`

Create a new branch.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body** (validated by `branchCreateSchema`, `.strict()` — unknown keys are rejected):

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | Required | New branch name. Validated against a `git check-ref-format` subset: no leading `-`, no `..`, no `//`, no `@{`, no whitespace and none of `~ ^ : ? * \ [`, no control chars (1–255 chars) |
| `from` | string | `"main"` | Branch to create from (its head SHA becomes the new ref's base) |

**Response (200):**
```json
{
  "success": true,
  "ref": { ... }
}
```

**Error Codes:**
- `400 VALIDATION_ERROR` - Invalid git ref name, or an unknown body key was sent

---

#### `DELETE /api/repos/:owner/:repo/branches/:branch`

Delete a branch.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Branch <name> deleted"
}
```

---

#### `GET /api/repos/:owner/:repo/branches/:branch/protection`

Get branch protection rules.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Branch protection object, or `{ "protected": false }` if no protection exists.

---

#### `PUT /api/repos/:owner/:repo/branches/:branch/protection`

Set or update branch protection rules.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Description |
|---|---|---|
| `required_status_checks` | object/null | Status check requirements |
| `enforce_admins` | boolean | Enforce for admins |
| `required_pull_request_reviews` | object/null | PR review requirements |
| `restrictions` | object/null | Push restrictions |

**Response (200):** Branch protection object.

---

#### `DELETE /api/repos/:owner/:repo/branches/:branch/protection`

Remove branch protection.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Branch protection removed"
}
```

---

### Tags and Releases

#### `GET /api/repos/:owner/:repo/tags`

List tags.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `per_page` | number | 30 | Results per page |

**Response (200):** Array of tag objects.

---

#### `GET /api/repos/:owner/:repo/releases`

List releases.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `per_page` | number | 30 | Results per page |

**Response (200):** Array of release objects.

---

#### `POST /api/repos/:owner/:repo/releases`

Create a release.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `tag_name` | string | Yes | Tag name for the release |
| `target_commitish` | string | No | Branch or commit SHA |
| `name` | string | No | Release title |
| `body` | string | No | Release notes |
| `draft` | boolean | No | Create as draft |
| `prerelease` | boolean | No | Mark as pre-release |
| `generate_release_notes` | boolean | No | Auto-generate notes |

**Response (200):**
```json
{
  "success": true,
  "release": { ... }
}
```

---

#### `DELETE /api/repos/:owner/:repo/releases/:release_id`

Delete a release.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Release deleted"
}
```

---

### Issues

#### `GET /api/repos/:owner/:repo/issues`

List issues for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `state` | string | `"open"` | `open`, `closed`, or `all` |
| `labels` | string | - | Comma-separated label names |
| `sort` | string | `"created"` | `created`, `updated`, `comments` |
| `direction` | string | `"desc"` | `asc` or `desc` |
| `per_page` | number | 30 | Results per page |

**Response (200):** Array of issue objects.

---

#### `POST /api/repos/:owner/:repo/issues`

Create an issue.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Issue title |
| `body` | string | No | Issue body (Markdown) |
| `labels` | string[] | No | Label names |
| `assignees` | string[] | No | Assignee usernames |
| `milestone` | number | No | Milestone number |

**Response (200):**
```json
{
  "success": true,
  "issue": { ... }
}
```

---

#### `GET /api/repos/:owner/:repo/issues/:issue_number`

Get a single issue.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Issue object.

---

#### `PATCH /api/repos/:owner/:repo/issues/:issue_number`

Update an issue.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body (all optional):**

| Field | Type | Description |
|---|---|---|
| `title` | string | Issue title |
| `body` | string | Issue body |
| `state` | string | `open` or `closed` |
| `labels` | string[] | Label names |
| `assignees` | string[] | Assignee usernames |
| `milestone` | number | Milestone number |

**Response (200):** Updated issue object.

---

#### `GET /api/repos/:owner/:repo/issues/:issue_number/comments`

List comments on an issue.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of comment objects (max 100).

---

#### `POST /api/repos/:owner/:repo/issues/:issue_number/comments`

Add a comment to an issue.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `body` | string | Yes | Comment body (Markdown) |

**Response (200):**
```json
{
  "success": true,
  "comment": { ... }
}
```

---

### Pull Requests

#### `GET /api/repos/:owner/:repo/pulls`

List pull requests.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `state` | string | `"open"` | `open`, `closed`, or `all` |
| `sort` | string | `"created"` | `created`, `updated`, `popularity`, `long-running` |
| `direction` | string | `"desc"` | `asc` or `desc` |
| `per_page` | number | 30 | Results per page |

**Response (200):** Array of pull request objects.

---

#### `POST /api/repos/:owner/:repo/pulls`

Create a pull request.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | PR title |
| `body` | string | No | PR description |
| `head` | string | Yes | Head branch (e.g., `feature-branch`) |
| `base` | string | Yes | Base branch (e.g., `main`) |
| `draft` | boolean | No | Create as draft PR |
| `maintainer_can_modify` | boolean | No | Allow maintainer edits |

**Response (200):**
```json
{
  "success": true,
  "pull_request": { ... }
}
```

---

#### `GET /api/repos/:owner/:repo/pulls/:pull_number`

Get a single pull request.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Pull request object.

---

#### `PATCH /api/repos/:owner/:repo/pulls/:pull_number`

Update a pull request.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body (all optional):**

| Field | Type | Description |
|---|---|---|
| `title` | string | PR title |
| `body` | string | PR description |
| `state` | string | `open` or `closed` |
| `base` | string | Base branch |
| `maintainer_can_modify` | boolean | Allow maintainer edits |

**Response (200):** Updated pull request object.

---

#### `PUT /api/repos/:owner/:repo/pulls/:pull_number/merge`

Merge a pull request.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `commit_title` | string | - | Merge commit title |
| `commit_message` | string | - | Merge commit message |
| `merge_method` | string | `"merge"` | `merge`, `squash`, or `rebase` |

**Response (200):**
```json
{
  "success": true,
  "merged": true,
  "message": "Pull Request successfully merged"
}
```

---

#### `GET /api/repos/:owner/:repo/pulls/:pull_number/reviews`

List reviews on a pull request.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of review objects.

---

#### `GET /api/repos/:owner/:repo/pulls/:pull_number/files`

List files changed in a pull request.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of file diff objects (max 100).

---

### Repository Webhooks

#### `GET /api/repos/:owner/:repo/hooks`

List webhooks for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of webhook objects.

---

#### `POST /api/repos/:owner/:repo/hooks`

Create a webhook.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `config` | object | Yes | Webhook config (`url`, `content_type`, `secret`) |
| `events` | string[] | Yes | Events to subscribe to |
| `active` | boolean | No | Default `true` |

**Response (200):**
```json
{
  "success": true,
  "hook": { ... }
}
```

---

#### `PATCH /api/repos/:owner/:repo/hooks/:hook_id`

Update a webhook.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body (all optional):**

| Field | Type | Description |
|---|---|---|
| `config` | object | Webhook config |
| `events` | string[] | Events list |
| `active` | boolean | Active state |
| `add_events` | string[] | Events to add |
| `remove_events` | string[] | Events to remove |

**Response (200):** Updated webhook object.

---

#### `DELETE /api/repos/:owner/:repo/hooks/:hook_id`

Delete a webhook.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Webhook deleted"
}
```

---

#### `POST /api/repos/:owner/:repo/hooks/:hook_id/pings`

Ping (test) a webhook.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Ping sent"
}
```

---

### Repository Contents and Files

#### `GET /api/repos/:owner/:repo/contents`

Get file or directory contents.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `path` | string | `""` | File or directory path (must be relative, no `..`) |
| `ref` | string | - | Branch, tag, or commit SHA |

**Response (200):** File or directory content object(s).

**Error Codes:**
- `400` - Invalid path (contains `..`, null bytes, or starts with `/`)

---

#### `PUT /api/repos/:owner/:repo/contents`

Create or update a file.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | File path |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | Commit message |
| `content` | string | Yes | Base64-encoded file content |
| `branch` | string | No | Target branch |
| `sha` | string | Conditional | Required when updating an existing file |

**Response (200):**
```json
{
  "success": true,
  "commit": { ... },
  "content": { ... }
}
```

**Error Codes:**
- `400` - Missing path or invalid path format

---

#### `DELETE /api/repos/:owner/:repo/contents`

Delete a file.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | File path |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | Commit message |
| `sha` | string | Yes | File blob SHA |
| `branch` | string | No | Target branch |

**Response (200):**
```json
{
  "success": true,
  "commit": { ... }
}
```

**Error Codes:**
- `400` - Missing path or invalid path format

---

#### `GET /api/repos/:owner/:repo/readme`

Get the repository README file.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** README content object, or `{ "exists": false }` if no README is found.

---

### Labels

#### `GET /api/repos/:owner/:repo/labels`

List labels for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of label objects (max 100).

---

#### `POST /api/repos/:owner/:repo/labels`

Create a label.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Label name |
| `color` | string | Yes | Hex color (without `#`) |
| `description` | string | No | Label description |

**Response (200):**
```json
{
  "success": true,
  "label": { ... }
}
```

---

#### `DELETE /api/repos/:owner/:repo/labels/:name`

Delete a label.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Label deleted"
}
```

---

### Commits and Comparison

#### `GET /api/repos/:owner/:repo/commits`

List commits.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `sha` | string | - | Branch name or commit SHA |
| `path` | string | - | Only commits touching this file path |
| `author` | string | - | Filter by author |
| `since` | string | - | ISO 8601 date |
| `until` | string | - | ISO 8601 date |
| `per_page` | number | 30 | Results per page |

**Response (200):** Array of commit objects.

---

#### `GET /api/repos/:owner/:repo/compare/:basehead`

Compare two commits or branches.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Path Parameters:**

| Param | Description |
|---|---|
| `basehead` | Comparison spec, e.g., `main...feature-branch` |

**Response (200):** Comparison object with commits, files, and diff stats.

---

### GitHub Actions (per-repo)

#### `GET /api/repos/:owner/:repo/actions/workflows`

List workflows for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of workflow objects.

---

#### `POST /api/repos/:owner/:repo/actions/workflows/:id/dispatches`

Trigger a workflow dispatch event.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `ref` | string | `"main"` | Branch or tag ref |
| `inputs` | object | `{}` | Workflow input parameters |

**Response (200):**
```json
{
  "message": "Workflow triggered successfully"
}
```

---

#### `GET /api/repos/:owner/:repo/actions/runs`

List recent workflow runs (last 10).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of workflow run objects.

---

#### `POST /api/repos/:owner/:repo/actions/sync`

Sync workflow runs from GitHub into the local database.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "message": "Synced <count> workflow runs"
}
```

---

#### `GET /api/repos/:owner/:repo/actions/stats`

Get actions statistics for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `days` | number | 30 | Number of days to analyze |

**Response (200):**
```json
{
  "stats": { ... },
  "trends": [ ... ],
  "repo": "owner/repo"
}
```

---

#### `GET /api/repos/:owner/:repo/workflows/:workflowId/stats`

Get statistics for a specific workflow.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Workflow statistics object.

---

### Community Health

#### `GET /api/repos/:owner/:repo/community-health`

Get or refresh community health analysis for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `refresh` | boolean | `false` | Force re-analysis instead of using cache |

**Response (200):**
```json
{
  "score": 85,
  "metrics": { ... },
  "recommendations": [ ... ],
  "lastUpdated": "2025-01-01T00:00:00Z",
  "cached": true
}
```

---

### README Studio

Free, deterministic scoring endpoint (Wave 6, Feature 1). The grounded AI
"improve" call that pairs with it lives under [AI](#ai-apiai) as
`POST /api/ai/readme-studio/improve` since it's metered — see there for the
quota-gated half of this feature.

#### `GET /api/repos/:owner/:repo/readme-studio/score`

Compute a deterministic README quality score (license correctness,
badge/reality consistency, install-vs-stack match, screenshots, section
order) and the same signal set the grounded improve call re-uses. Zero AI
cost — no `requireAI`, no quota check.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No |
| Quota | None (free, deterministic) |

**Response (200):**
```json
{
  "success": true,
  "report": { "score": 78, "checks": [ ... ] },
  "repo": "owner/repo",
  "hasReadme": true,
  "readmeTruncated": false,
  "hasLicense": true
}
```

`readmeTruncated: true` means a README file exists but is too large or
binary for GitHub to inline — a distinct state from "no README" so the UI
never tells a repo with an unreadable README to "add one".

---

### Agent Rules Generator

AGENTS.md / CLAUDE.md generator (Wave 6, Feature 3). Generation never
hard-blocks on AI availability — see `deterministic`/`reason` in the
response below.

#### `POST /api/repos/:owner/:repo/agent-rules/generate`

Detect real build/test/lint/CI signals (package.json scripts, lockfile
family, test dirs, lint configs, workflow job names, LICENSE) and generate
AGENTS.md and/or CLAUDE.md content grounded in them. Falls back to a
zero-AI-cost deterministic template (same section skeleton, filled directly
from detected signals) whenever no AI provider is configured, the provider
errors, or the spend cap is hit — a quota-exceeded `429` still ships the
deterministic fallback rather than a hard failure.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No (degrades to a deterministic template) |
| Scope | `ai` (API-key callers) |
| Quota | Per-feature (`ai_agent_rules`, Free: 20/month) + global `ai_queries` — only charged when the AI path actually runs |

**Request Body** (`agentRulesGenerateSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `targetFiles` | `('AGENTS.md'\|'CLAUDE.md')[]` | No | Files to generate (1-2, default `['AGENTS.md']`) |
| `mode` | `'create'\|'refresh'` | No | `refresh` feeds the existing file back and asks for only-changed-sections (default `create`) |
| `sections` | object | No | Boolean toggles: `setup`, `codeStyle`, `testing`, `devEnv`, `prInstructions`, `security`, `repoLayout` |
| `strictness` | `'concise'\|'detailed'` | No | Default `concise` |

**Response (200):**
```json
{
  "deterministic": false,
  "files": [{ "filePath": "AGENTS.md", "content": "..." }],
  "sections": { "setup": true, "testing": true },
  "existing": {},
  "notes": [],
  "signals": { "language": "JavaScript", "testFramework": "vitest" }
}
```

`deterministic: true` responses additionally carry `reason`
(`ai_not_configured` | `spend_cap_reached` | `ai_error`) so the client can
explain why it fell back.

**Error Codes:**
- `429 usage_limit_exceeded` — `ai_agent_rules` or `ai_queries` cap hit; response still includes `deterministic: true` + `files` so the caller isn't blocked

---

#### `POST /api/repos/:owner/:repo/agent-rules/commit`

Commit previously generated AGENTS.md/CLAUDE.md content (client-echoed, not
re-generated server-side) — one `commitOrOpenPR()` call per target file.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Quota | None — this is a plain write action; generation above already spent the AI call |

**Request Body** (`agentRulesCommitSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `files` | object[] | Yes | 1-2 entries: `{ filePath: 'AGENTS.md'\|'CLAUDE.md', content, commitMessage }` |
| `mode` | `'direct'\|'pr'` | No | Default `direct` |

**Response (200):** `{ "committed": true, "results": [ ... ] }` — one `commitOrOpenPR()` result per file.

---

### Security Posture

10-check deterministic report card layered on the existing alerts scan
(Wave 6, Feature 4) — moved off the Pro paywall to Free in the same
2026-07-18 rebalance.

#### `GET /api/repos/:owner/:repo/security`

Aggregate secret-scanning / code-scanning / Dependabot alerts with a
10-check deterministic report card (branch protection, alert severity,
secret scanning + push protection, Dependabot security updates, code
scanning, `SECURITY.md`, workflow token permissions, org 2FA). Every
admin-gated check renders `unknown` on a `403` — distinct from `fail` — so
a non-admin collaborator is never misinformed.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | Free (moved off Pro 2026-07-18) |

**Response (200):**
```json
{
  "secretScanning": { "available": true, "alerts": [] },
  "codeScanning": { "available": true, "alerts": [] },
  "dependabot": { "available": true, "alerts": [] },
  "summary": { "critical": 0, "high": 0, "medium": 0, "low": 0, "total": 0 },
  "checks": [
    { "id": "branch_protection_review", "label": "...", "status": "pass", "severity": null }
  ],
  "score": { "passing": 8, "total": 10 }
}
```

---

#### `POST /api/repos/:owner/:repo/security/summary`

AI narrative summary of the report card `GET /security` just returned. The
client submits back the *same* checks (id/label/status/severity only —
never raw alert bodies) so the prompt can't be fed secret/PII fragments.
Cached per `(user, repo, check-result-hash)` so re-opening the panel
without a posture change doesn't re-bill the provider.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |
| Scope | `ai` (API-key callers) |
| Quota | Per-feature (`ai_security_posture`, Free: 75/month) + global `ai_queries` |

**Request Body** (`securityPostureSummarySchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | `{ full_name, private? }` |
| `checks` | object[] | Yes | 1-10 entries echoed back from `GET /security`'s `checks`, whitelisted to `id`/`label`/`status`/`severity` |

**Response (200):** `{ "topActions": [...], "summary": "...", "cached": false }`

**Error Codes:**
- `429 usage_limit_exceeded` — `ai_security_posture` or `ai_queries` cap hit

---

## Organizations (`/api/orgs/*`)

### `GET /api/orgs`

List the authenticated user's organizations (with personal account as first entry).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of organization objects. The first entry is always the personal account with `isPersonal: true`.

```json
[
  {
    "login": "username",
    "avatar_url": "...",
    "public_repos": 10,
    "total_private_repos": 5,
    "description": "Personal Account",
    "isPersonal": true
  },
  {
    "login": "my-org",
    "avatar_url": "...",
    "public_repos": 20,
    "total_private_repos": 15,
    "isPersonal": false
  }
]
```

---

### `GET /api/orgs/:org`

Get details for a specific organization.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** GitHub organization object.

---

### `PATCH /api/orgs/:org`

Update organization settings. Only whitelisted fields are accepted.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body (all optional):**

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name |
| `description` | string | Description |
| `company` | string | Company name |
| `location` | string | Location |
| `email` | string | Public email |
| `blog` | string | Blog URL |
| `default_repository_permission` | string | Default repo permission |
| `members_can_create_repositories` | boolean | Allow members to create repos |

**Response (200):** Updated organization object.

---

### `GET /api/orgs/:org/repos`

List repositories for an organization (or personal repos if `:org` matches the authenticated user).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `per_page` | number | 30 | Results per page |

**Response (200):**
```json
{
  "repos": [...],
  "page": 1,
  "totalPages": 5,
  "org": "org-login"
}
```

---

### `GET /api/orgs/:org/members`

List organization members.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `per_page` | number | 30 | Results per page |

**Response (200):** Array of GitHub user objects.

---

### `POST /api/orgs/:org/repos`

Create a repository in an organization.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Repository name |
| `description` | string | No | Description |
| `private` | boolean | No | Default `true` |
| `auto_init` | boolean | No | Default `true` |

**Response (200):**
```json
{
  "success": true,
  "repo": { ... }
}
```

---

## Teams (`/api/teams/*`)

Teams are managed locally in SQLite. They provide a way to group repositories and members for organization within the app.

### `GET /api/teams`

List teams the authenticated user belongs to.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of team objects with `member_count`, `repo_count`, and user's `role`.

---

### `POST /api/teams`

Create a new team. The creator becomes the owner.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Team name |
| `description` | string | No | Team description |

**Response (200):**
```json
{
  "success": true,
  "teamId": 1
}
```

**Error Codes:**
- `400` (`MISSING_NAME`) - Team name is required

---

### `GET /api/teams/:id`

Get team details including members and assigned repositories.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Must be a team member |

**Response (200):**
```json
{
  "team": { ... },
  "members": [ ... ],
  "repos": [ ... ],
  "currentUserRole": "owner"
}
```

**Error Codes:**
- `403` (`FORBIDDEN`) - Not a team member

---

### `PUT /api/teams/:id`

Update team name and description.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Admin or Owner |

**Request Body:**

| Field | Type | Description |
|---|---|---|
| `name` | string | Team name |
| `description` | string | Team description |

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `403` (`FORBIDDEN`) - Admin access required
- `404` (`NOT_FOUND`) - Team not found

---

### `DELETE /api/teams/:id`

Delete a team and all associated members/repo assignments.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Owner only |

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `403` (`FORBIDDEN`) - Owner access required
- `404` (`NOT_FOUND`) - Team not found

---

### `POST /api/teams/:id/members`

Add a member to a team by GitHub username. If the user is not in the local database, they are fetched from GitHub.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Admin or Owner |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `username` | string | Yes | GitHub username |

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `400` (`MISSING_USERNAME`) - Username required
- `400` (`INVALID_USERNAME`) - Invalid username format
- `400` (`DUPLICATE_MEMBER`) - User is already a member
- `403` (`FORBIDDEN`) - Admin access required
- `404` (`USER_NOT_FOUND`) - User not found on GitHub

---

### `PUT /api/teams/:id/members/:userId`

Update a team member's role.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Admin or Owner |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `role` | string | Yes | `admin` or `member` |

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `400` (`INVALID_ROLE`) - Role must be `admin` or `member`
- `403` (`FORBIDDEN`) - Permission denied or cannot change owner role

---

### `DELETE /api/teams/:id/members/:userId`

Remove a member from a team, or leave the team (if removing self).

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Admin/Owner to remove others; any member to leave |

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `403` (`FORBIDDEN`) - Cannot remove owner, or insufficient permissions

---

### `POST /api/teams/:id/repos`

Assign a repository to a team.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Authorization | Admin or Owner |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repoFullName` | string | Yes | Full repo name (e.g., `owner/repo`) |
| `repoId` | number | Yes | GitHub repository ID |

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `403` (`FORBIDDEN`) - Admin access required

---

### `GET /api/teams/:id/activity`

Get aggregated activity events from all repositories assigned to a team (max 10 repos, 50 events).

| Detail | Value |
|---|---|
| Auth required | Yes |

> Also available at `GET /api/team/:id/activity` (alias).

**Response (200):** Array of GitHub event objects with `repo_name` field.

---

### `POST /api/teams/:id/actions/stats`

Get aggregated GitHub Actions statistics for all repositories assigned to a team.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `days` | number | 30 | Number of days to analyze |

**Response (200):**
```json
{
  "repos": [
    {
      "repoId": 123,
      "repoFullName": "owner/repo",
      "totalRuns": 50,
      "successRate": 92.5,
      "avgDuration": 120
    }
  ],
  "teamAverages": {
    "totalRuns": 150,
    "avgSuccessRate": 91.5,
    "avgDuration": 115
  }
}
```

---

## AI (`/api/ai/*`)

All AI endpoints require both authentication and a configured AI provider key (`requireAI` middleware), unless noted otherwise. The provider is resolved per request: a user BYOK key (see [User AI configuration](#additional-endpoints-grouped)) takes precedence, falling back to the server-configured provider. When no key is available, `requireAI` returns `400 AI_NOT_CONFIGURED` (see [Shared Response Envelopes](#shared-response-envelopes)).

**Scopes:** API-key callers additionally need the `ai` scope on these generation endpoints — see [Scope enforcement](#the-ai-scope-is-enforced-not-just-a-creation-option) under API Keys.

**Rate limits:** beyond the per-feature `ai_queries` quota (see "AI quota / usage-limit exceeded — `429`" in [Shared Response Envelopes](#shared-response-envelopes) above):

- AI routes sit behind a per-tier request bucket (`createTenantLimiters('ai')`, mounted on `/api/ai/` and `/api/v1/ai/`): 10/50/200 requests per 15 minutes for free/pro/enterprise in production. For `grm_live_` bearer callers the api/ai buckets are keyed per API key (SHA-256 of the bearer token) rather than per user, and bearer requests resolve to the conservative free-tier ceiling before auth runs — so with a Pro key, high-frequency API usage can hit this app-level ceiling before any route-level quota binds.
- The Work Board AI actions carry dedicated per-user limiters: `suggest-action` is limited to 10/hour, mirroring `draft-comment`'s existing 10/hour. Exceeding either returns `429 { error, code: 'rate_limited' }`. See [WORK-BOARD-API.md](./WORK-BOARD-API.md).
- Four previously unmetered endpoints now record `ai_queries` usage: `POST /api/v1/work-board/ai-summary`, `POST /api/v1/work-board/suggest-action`, `POST /api/v1/work-board/draft-comment`, and `POST /api/repos/:owner/:repo/community-health/generate` (its AI branch only — deterministic license/`.gitignore` generation stays unmetered). All four check quota first and charge only after a successful provider call, returning the standard quota-exceeded `429` envelope when the cap is hit.

### `GET /api/config/ai-status`

Check whether AI features are configured.

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**
```json
{
  "configured": true,
  "provider": "gemini"
}
```

---

### `POST /api/ai/chat`

Chat with the AI assistant.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `message` | string | Yes | User message |
| `context` | object | No | Contextual data (current repo, etc.) |

**Response (200):**
```json
{
  "message": "AI response in Markdown..."
}
```

**Error Codes:**
- `400` (`MESSAGE_REQUIRED`) - Empty message
- `422` (`INVALID_API_KEY`) - Invalid Gemini API key
- `404` (`MODEL_NOT_FOUND`) - AI model not available
- `429` (`QUOTA_EXCEEDED`) - API quota exceeded
- `503` (`MODEL_UNAVAILABLE`) - Model failed to load

---

### `POST /api/ai/suggest`

Get AI-powered improvement suggestions for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | GitHub repository object |

**Response (200):**
```json
{
  "suggestions": [
    {
      "title": "Improve Description",
      "description": "Add more detail...",
      "type": "improvement"
    }
  ],
  "analysis": "Brief summary of the repo's current state"
}
```

**Error Codes:**
- `400` (`REPO_REQUIRED`) - Repository data is required
- `422` (`INVALID_API_KEY`) - Invalid Gemini API key
- `404` (`MODEL_NOT_FOUND`) - AI model not available
- `429` (`QUOTA_EXCEEDED`) - API quota exceeded
- `503` (`MODEL_UNAVAILABLE`) - Model failed to load

---

### `POST /api/ai/readme`

Generate a professional README for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Project name |
| `description` | string | No | Project description |
| `language` | string | No | Primary language |
| `topics` | string[] | No | Repository topics |

**Response (200):**
```json
{
  "readme": "# Project Name\n..."
}
```

---

### `POST /api/ai/readme/enhance`

Enhance an existing README by fetching the current one from GitHub and improving it with AI.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repository object (must include `full_name`) |

**Response (200):**
```json
{
  "success": true,
  "enhancedReadme": "...",
  "suggestions": [ ... ],
  "currentReadme": "..."
}
```

**Error Codes:**
- `400` - Repo data required

---

### `POST /api/ai/index`

Index a repository: analyze with AI and generate embeddings for semantic search.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Full GitHub repository object |

**Response (200):**
```json
{
  "success": true,
  "analysis": {
    "summary": "...",
    "suggested_topics": [...],
    "health_score": 85
  }
}
```

**Error Codes:**
- `400` - Repo data required

---

### `GET /api/ai/search`

Semantic search across indexed repositories.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |
| Quota | Per-feature (`ai_semantic_search`, Free: 375/month) + global `ai_queries` |

Available on Free tier since 2026-04-15 — previously Pro-only.

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes (unless `mode=similar-by-id`) | Search query |
| `mode` | string | No | `similar-by-id` to look up repos similar to a given repo ID |
| `repoId` | string | Only with `mode=similar-by-id` | Repo ID to compare against |

**Response (200):** Array of search results with scores and metadata. For `mode=similar-by-id`, returns `{ mode, similar }`.

**Error Codes:**
- `429 usage_limit_exceeded` — hit `ai_semantic_search` or `ai_queries` cap; response includes `metric`, `limit`, `current`, `upgradeUrl`

---

### `POST /api/ai/migration-risk`

Analyze a repository's migration risk to a target platform before executing the migration.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |
| Quota | Per-feature (`ai_migration_risk`, Free: 25/month) + global `ai_queries` |

Pulls signals from the source repo (size, LFS, branches, workflows, languages, visibility, wiki/pages) and prompts Gemini for a structured risk report.

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` at minimum; `size`, `open_issues_count`, `private`, `archived`, `has_wiki`, `has_pages` improve accuracy |
| `source` | string | No | Source platform label (default `github`) |
| `target` | string | No | Target platform label (default `github`) |

**Response (200):**
```json
{
  "success": true,
  "report": {
    "repo": "owner/repo",
    "source": "github",
    "target": "github",
    "signals": { "sizeMB": 123, "branches": 42, "hasLFS": false, "workflowCount": 3, "languages": ["JavaScript"], "private": false, "archived": false, "hasWiki": true, "hasPages": false, "openIssues": 7 },
    "overallRisk": "medium",
    "score": 45,
    "summary": "Manageable with manual intervention on workflows.",
    "blockers": [],
    "warnings": ["3 CI workflows need secret re-wiring on the target."],
    "recommendations": ["Audit GitHub Actions secrets before migration."],
    "estimatedDurationMinutes": 45
  }
}
```

**Error Codes:**
- `400 VALIDATION_ERROR` — `repo.full_name` missing
- `429 usage_limit_exceeded` — per-feature or global AI cap hit

---

### `GET /api/ai/metadata/:repoId`

Get cached AI metadata for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No |

**Response (200):** Metadata object or `null` if not indexed.

```json
{
  "repo_id": 123,
  "summary": "...",
  "topics": "[\"react\", \"nodejs\"]",
  "health_score": 85,
  "last_indexed": "2025-01-01T00:00:00Z"
}
```

---

### `POST /api/ai/quality-report`

Generate a comprehensive quality report for a repository.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Full GitHub repository object |

**Response (200):**
```json
{
  "success": true,
  "report": { ... },
  "repo": "owner/repo"
}
```

**Error Codes:**
- `400` - Repo data required

---

### `POST /api/ai/batch-index`

Index multiple repositories at once (max 10 per request).

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | object[] | Yes | Array of GitHub repository objects |

**Response (200):**
```json
{
  "success": true,
  "processed": 5,
  "results": [
    { "repo": "owner/repo", "success": true, "health_score": 85 },
    { "repo": "owner/repo2", "success": false, "error": "Analysis failed" }
  ],
  "skipped": 0
}
```

**Error Codes:**
- `400` - Array of repos required

---

### `POST /api/ai/readme-studio/improve`

Grounded README improve (Wave 6, Feature 1) — the metered counterpart to
the free `GET /api/repos/:owner/:repo/readme-studio/score`. Replaces
`/api/ai/readme` + `/api/ai/readme/enhance` for new call sites; those two
routes stay unchanged for backward compatibility. Never invents license
claims, commands, or badges — only what's grounded in real repo signals
(manifest, entrypoints, folder structure, topics, language, LICENSE).

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |
| Scope | `ai` (API-key callers) |
| Quota | Per-feature (`ai_readme`, Free: 25/month — shared with `/api/ai/readme`) + global `ai_queries` |

**Request Body** (`aiReadmeStudioImproveSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` |
| `mode` | `'missing-sections'\|'full-rewrite'` | No | Default `missing-sections` |
| `tone` | `'professional'\|'concise'\|'enthusiastic'` | No | Default `professional` |
| `sections` | string[] | No | Up to 20 section names to target |
| `license` | string | No | Max 50 chars |
| `stackOverride` | string | No | Max 100 chars |
| `badges` | boolean | No | Default `false` |

**Response (200):** `{ "success": true, "markdown": "...", "confidence": "high", "warnings": [], "missingSections": [], "badges": [], "mode": "missing-sections", "currentReadme": "...", "readmeTruncated": false }`

**Error Codes:**
- `429 usage_limit_exceeded` — `ai_readme` or `ai_queries` cap hit

---

### `POST /api/ai/readme-studio/improve/deterministic`

Zero-AI-cost README patch fallback (License/Install/TOC sections built
directly from `detectLicense()`'s verified fingerprint and the detected
manifest/lockfile). Offered by the client whenever the AI improve call
above is unavailable — no provider configured, a provider error, or the
`readmeGenPerMonth` quota is exhausted.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No |
| Scope | `ai` (API-key callers) |
| Quota | None (free, deterministic) |

**Request Body** (`deterministicReadmeStudioSchema`): `{ repo: { full_name }, mode?: 'missing-sections'|'full-rewrite' }`

**Response (200):** `{ "success": true, "deterministic": true, "markdown": "...", "sections": [...], "mode": "...", "missingSections": [...], "currentReadme": "...", "readmeTruncated": false }`

---

### `POST /api/ai/generate-diagram`

Grounded architecture-diagram generator (Wave 6, Feature 2) — prompts for a
Mermaid diagram from the repo's top-level tree + README. Supports
`?stream=true` for SSE token streaming and a retry-once self-repair pass
(`retry`/`failedSource`/`parseError`) when the client-side Mermaid render
fails.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | Yes |
| Scope | `ai` (API-key callers) |
| Quota | Per-feature (`ai_diagram`, Free: 15/month) + global `ai_queries` — only the initial (non-retry) attempt is charged |

**Request Body** (`aiGenerateDiagramSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` |
| `diagramType` | `'architecture'` | No | Enum-limited to `architecture` for v1 |
| `focus` | string | No | Max 300 chars |
| `retry` | boolean | No | Self-repair retry — requires `failedSource` |
| `failedSource` | string | Retry only | The Mermaid text that failed to render, max 8000 chars |
| `parseError` | string | No | Max 2000 chars |

**Response (200):** `{ "success": true, "mermaid": "graph TD...", "diagramType": "architecture", "truncated": false }`

**Error Codes:**
- `429 usage_limit_exceeded` — `ai_diagram` or `ai_queries` cap hit

---

### `POST /api/ai/generate-diagram/deterministic`

Zero-AI-cost fallback: a depth-2, node-capped `flowchart TD` of the
top-level directory structure. Always succeeds, never calls a provider —
used by the embed flow when the AI-generated Mermaid still fails to render
after the retry-once self-repair attempt above.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No |
| Scope | `ai` (API-key callers) |
| Quota | None (free, deterministic) |

**Request Body** (`deterministicDiagramSchema`): `{ repo: { full_name }, diagramType?: 'architecture' }`

**Response (200):** `{ "success": true, "mermaid": "...", "diagramType": "architecture", "truncated": false, "deterministic": true }`

---

### `POST /api/ai/generate-diagram/embed-preview`

Build a preview of embedding an already-generated diagram into the repo —
either as an idempotent README Mermaid fence (marker-delimited, regen
replaces in place) or a sanitized SVG at `docs/diagrams/<type>.svg` with a
README image reference. Never calls a provider — the Mermaid/SVG was
already generated. Must be followed by `embed-commit` to actually write.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Quota | None — no `requireAI`/scope/quota gating, a plain read-and-diff action |

**Request Body** (`embedDiagramPreviewSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` |
| `diagramType` | `'architecture'` | No | Default `architecture` |
| `target` | `'readme-mermaid'\|'svg-file'` | Yes | Embed target |
| `mermaid` | string | If `target=readme-mermaid` | Max 50,000 chars |
| `svg` | string | If `target=svg-file` | Max 600,000 chars |
| `placement` | `'top'\|'after-intro'\|'end'\|'custom'` | No | Default `after-intro` |
| `customAnchor` | string | If `placement=custom` | Max 200 chars |
| `truncated` | boolean | No | Default `false` |

**Response (200):** `{ "success": true, "target": "readme-mermaid", "hasReadme": true, "readOnly": false, "action": "insert", "notice": null, "readme": { "path": "README.md", "before": "...", "after": "...", "commitMessage": "..." } }`

**Error Codes:**
- `422 invalid_svg` — generated SVG failed sanitizer validation and cannot be embedded

---

### `POST /api/ai/generate-diagram/embed-commit`

Commit the previewed diagram embed. Embed paths are always server-derived
(`svg.path` must equal `svgPathFor(diagramType)`; `readme.path` must be a
`README.md` path with no traversal) — defence in depth against a client
requesting an arbitrary write location.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Quota | None — no provider call, a plain GitHub write action |

**Request Body** (`embedDiagramCommitSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` |
| `diagramType` | `'architecture'` | No | Default `architecture` |
| `target` | `'readme-mermaid'\|'svg-file'` | Yes | Embed target |
| `readme` | object | If `target=readme-mermaid` | `{ path?, content, commitMessage }` |
| `svg` | object | If `target=svg-file` | `{ path, content, commitMessage }` |
| `mode` | `'direct'\|'pr'` | No | Default `direct` |

**Response (200):** `{ "success": true, "target": "readme-mermaid", "readme": { ... } }`

**Error Codes:**
- `400 VALIDATION_ERROR` — `svg.path`/`readme.path` don't match the server-derived path
- `403 read_only_access` — caller lacks push access (PR-from-fork is not supported)
- `422 invalid_svg` — SVG failed sanitizer re-validation at commit time

---

### `GET /api/ai/generate-image/capability`

Resolve whether AI image generation is available for the caller's
configured provider (static per-provider capability matrix + key-presence
gate), and the three fixed presets' resolved dimensions.

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No (reports availability rather than requiring it) |

**Response (200):** `{ "available": true, "provider": "openai", "model": "gpt-image-1", "reason": null, "substitutedFrom": null, "presets": { "social": { ... }, "hero": { ... }, "logo": { ... } } }`

---

### `POST /api/ai/generate-image`

Generate an AI raster image (repo banner / README hero / logo draft) —
Wave 6c. Three fixed presets (`social`/`hero`/`logo`) with a grounded,
content-safety-constrained prompt; `promptExtras` is additive-only, never a
free-text prompt replacement. Quota is checked before the provider call and
only charged on a genuine successful generation (a capability failure,
pricing failure, or content refusal never burns quota).

| Detail | Value |
|---|---|
| Auth required | Yes |
| AI required | No (capability-gated instead — see `/generate-image/capability`) |
| Scope | `ai` (API-key callers) |
| Quota | Per-feature (`ai_image`, Free: 5/month) + global `ai_queries` — charged only after a successful generation |

**Request Body** (`aiGenerateImageSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` |
| `preset` | `'social'\|'hero'\|'logo'` | Yes | Fixed output preset |
| `promptExtras` | string | No | Max 150 chars — additive style/color hint only |

**Response (200):** `{ "success": true, "preset": "hero", "path": "docs/images/hero.png", "dimensions": "1200x630", "base64": "...", "mimeType": "image/png", "provider": "openai", "model": "gpt-image-1", "costCents": 4, "estimatedCost": "$0.04" }`

**Error Codes:**
- `422 IMAGE_REFUSAL` — provider refused the prompt on content-safety grounds
- `404` — no image-capable model available for the resolved provider
- `501 image_pricing_unavailable` — no pricing entry for the resolved provider/model/quality combo
- `429 usage_limit_exceeded` — `ai_image` or `ai_queries` cap hit

---

### `POST /api/ai/generate-image/commit`

Commit a previously generated, client-echoed image (binary-safe base64
passthrough — never re-encoded as UTF-8 text) to a server-derived
`docs/images/<preset>.png` path. There is no `path` field in the request:
the destination is always derived from `preset`, so a caller can't request
an arbitrary write location.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Quota | None — no provider call, a plain GitHub write action |

**Request Body** (`commitImageSchema`):

| Field | Type | Required | Description |
|---|---|---|---|
| `repo` | object | Yes | Repo object with `full_name` |
| `preset` | `'social'\|'hero'\|'logo'` | Yes | Must match the preset the image was generated for |
| `base64` | string | Yes | Base64-encoded PNG bytes, up to ~4 MB decoded |
| `commitMessage` | string | No | Max 500 chars |
| `mode` | `'direct'\|'pr'` | No | Default `direct` |

**Response (200):** `{ "success": true, "preset": "hero", "path": "docs/images/hero.png", ... }`

---

## Bulk Operations (`/api/*`)

All bulk operations process repositories sequentially and return multi-status responses (HTTP 207) when some operations succeed and others fail.

**Tier gating:** none of these routes are tier-gated — `bulkAdvanced`
(transfer / mirror / cross-org / delete) moved to Free in the 2026-07-18
free-first rebalance, and every route below is `requireAuth` only; there is
no `requireTier('pro')` anywhere in `bulk.js`. `POST /api/transfer`,
`POST /api/mirror`, and `POST /api/delete` instead share a
**tier-independent** daily anti-abuse ceiling (`bulk_destructive_daily`,
default 200/day, overridable via `BULK_DESTRUCTIVE_DAILY_MAX`) enforced
atomically through `guardedDailyIncrement()` — see
[`server/lib/feature-flags.js`](../../server/lib/feature-flags.js) and
[`server/lib/usage-meter.js`](../../server/lib/usage-meter.js).

### `POST /api/visibility`

Change visibility for multiple repositories.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings |
| `makePublic` | boolean | Yes | `true` for public, `false` for private |

**Response (200/207/500):**
```json
{
  "message": "Successfully changed visibility for 3 repositories.",
  "results": [
    { "repo": "owner/repo1", "success": true },
    { "repo": "owner/repo2", "success": false, "error": "..." }
  ]
}
```

**Error Codes:**
- `400` (`MISSING_REPOS`) - No repositories specified
- `400` (`INVALID_FORMAT`) - Invalid repository format
- `400` (`INVALID_PARAM`) - `makePublic` must be boolean

---

### `POST /api/transfer`

Transfer multiple repositories to an organization.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings |
| `toOrg` | string | Yes | Target organization login |

**Response (200/207/500):**
```json
{
  "message": "Transferred 3 repositories to org-name.",
  "results": [ ... ]
}
```

**Error Codes:**
- `400` (`MISSING_PARAMS`) - Missing repos or target org
- `400` (`INVALID_ORG`) - Invalid organization name
- `400` (`INVALID_FORMAT`) - Invalid repository format

---

### `POST /api/transfer/check-conflicts`

Check for naming conflicts before transferring repositories to an organization. For each repo, checks whether a repo with the same name already exists in the target org and returns metadata for both source and target.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings |
| `targetOrg` | string | Yes | Target organization login |

**Response (200):**
```json
{
  "conflicts": {
    "repo-name": {
      "exists": true,
      "source": {
        "full_name": "owner/repo-name",
        "updated_at": "...",
        "size": 1024,
        "language": "JavaScript",
        "description": "..."
      },
      "target": {
        "full_name": "org/repo-name",
        "updated_at": "...",
        "size": 2048,
        "language": "JavaScript",
        "description": "..."
      }
    },
    "other-repo": {
      "exists": false
    }
  }
}
```

**Error Codes:**
- `400` (`INVALID_ORG`) - Invalid target organization name

---

### `POST /api/mirror`

Mirror (fork) multiple repositories to an organization.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings |
| `toOrg` | string | Yes | Target organization login |

**Response (200/207/500):**
```json
{
  "message": "Mirrored 3 repositories to org-name.",
  "results": [
    { "repo": "owner/repo", "success": true, "mirrorUrl": "https://github.com/..." }
  ]
}
```

**Error Codes:**
- `400` (`MISSING_PARAMS`) - Missing repos or target org
- `400` (`INVALID_ORG`) - Invalid organization name
- `400` (`INVALID_FORMAT`) - Invalid repository format

---

### `POST /api/archive`

Archive or unarchive multiple repositories.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `repos` | string[] | Required | Array of `owner/repo` strings |
| `archive` | boolean | `true` | `true` to archive, `false` to unarchive |

**Response (200/207/500):**
```json
{
  "message": "Archived 3 repositories.",
  "results": [ ... ]
}
```

**Error Codes:**
- `400` (`MISSING_REPOS`) - No repositories specified
- `400` (`INVALID_FORMAT`) - Invalid repository format

---

### `POST /api/delete`

Delete multiple repositories. This action is irreversible.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings |

**Response (200/207/500):**
```json
{
  "message": "Deleted 3 repositories.",
  "results": [ ... ]
}
```

**Error Codes:**
- `400` (`MISSING_REPOS`) - No repositories specified
- `400` (`INVALID_FORMAT`) - Invalid repository format

---

### `POST /api/community-health/compare`

Compare community health scores for multiple repositories.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of `owner/repo` strings |

**Response (200):**
```json
{
  "comparison": [
    { "repo": "owner/repo", "score": 85, "hasCachedData": true },
    { "repo": "owner/repo2", "score": 0, "hasCachedData": false }
  ]
}
```

**Error Codes:**
- `400` (`INVALID_FORMAT`) - Invalid repos array

---

## Import (`/api/import/*`)

### `GET /api/import/git-status`

Check if Git is installed and available on the server.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "installed": true,
  "version": "2.43.0"
}
```

---

### `POST /api/import/validate-url`

Validate a source repository URL before importing.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Source repository URL |
| `credentials` | object | No | Authentication credentials |

**Response (200):** Validation result object.

**Error Codes:**
- `400` (`MISSING_URL`) - URL is required

---

### `POST /api/import/azure`

Import a repository from Azure DevOps to GitHub. The import runs asynchronously.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azureOrg` | string | Yes | Azure DevOps organization |
| `azureProject` | string | Yes | Azure DevOps project |
| `azureRepo` | string | Yes | Azure DevOps repository name |
| `azurePat` | string | Yes | Azure Personal Access Token |
| `targetOrg` | string | No | Target GitHub organization |
| `targetName` | string | No | Target repo name (defaults to source name) |
| `makePrivate` | boolean | No | Default `true` |
| `description` | string | No | Repository description |

**Response (200):**
```json
{
  "success": true,
  "jobId": 1,
  "message": "Import started"
}
```

**Error Codes:**
- `400` (`MISSING_PARAMS`) - Missing required Azure parameters
- `400` (`MISSING_CLONE_URL`) - Could not obtain clone URL

---

### `POST /api/import/azure/batch`

Batch import multiple Azure DevOps repositories to GitHub. Runs imports with a concurrency limit of 2.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Max repos | 20 |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azureOrg` | string | Yes | Azure DevOps organization |
| `azureProject` | string | Yes | Azure DevOps project |
| `azurePat` | string | No | PAT (uses server PAT if omitted) |
| `targetOrg` | string | No | Target GitHub organization |
| `makePrivate` | boolean | No | Default `true` |
| `repos` | object[] | Yes | Array of `{ azureRepo, targetName }` objects |

**Response (200):**

```json
{
  "success": true,
  "jobs": [
    { "repoName": "source-repo", "targetName": "target-repo", "jobId": 1, "skipped": false, "error": null },
    { "repoName": "other-repo", "targetName": "other-repo", "jobId": null, "skipped": true, "error": "Import already in progress" }
  ]
}
```

**Error Codes:**
- `400` (`MISSING_PARAMS`) - Missing org, project, or repos array
- `400` (`MISSING_PAT`) - No PAT available
- `400` (`TOO_MANY_REPOS`) - More than 20 repos in batch

---

### `POST /api/import/url`

Import a repository from any Git URL to GitHub. The import runs asynchronously.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceUrl` | string | Yes | Source Git repository URL |
| `credentials` | object | No | `{ type: "pat", token: "..." }` or similar |
| `targetOrg` | string | No | Target GitHub organization |
| `targetName` | string | No | Target repo name (inferred from URL if omitted) |
| `makePrivate` | boolean | No | Default `true` |
| `description` | string | No | Repository description |

**Response (200):**
```json
{
  "success": true,
  "jobId": 1,
  "message": "Import started"
}
```

**Error Codes:**
- `400` (`MISSING_URL`) - Source URL is required

---

### `GET /api/import/status/:id`

Get the status of an import job.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "id": 1,
  "sourceType": "azure",
  "sourceName": "org/project/repo",
  "targetRepo": "repo-name",
  "targetFullName": "owner/repo-name",
  "status": "complete",
  "progressPct": 100,
  "progressMessage": "Import completed successfully!",
  "errorMessage": null,
  "startedAt": "2025-01-01T00:00:00Z",
  "completedAt": "2025-01-01T00:05:00Z",
  "metadata": {
    "branchCount": 3,
    "hasLFS": false,
    "repoUrl": "https://github.com/owner/repo"
  }
}
```

**Error Codes:**
- `404` (`NOT_FOUND`) - Migration job not found (or belongs to another user)

---

### `GET /api/migrations`

List all migration jobs for the authenticated user (paginated).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `per_page` | number | 20 | Results per page (max 100) |

**Response (200):**
```json
{
  "migrations": [ ... ],
  "total": 15,
  "page": 1,
  "totalPages": 1
}
```

---

## Azure DevOps (`/api/azure/*`)

### `GET /api/azure/env-auth`

Check if the server has an Azure DevOps PAT configured via environment variable. The PAT value itself is never exposed.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "available": true
}
```

---

### `POST /api/azure/validate`

Validate Azure DevOps credentials (organization + PAT).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `pat` | string | Yes | Personal Access Token |

**Response (200):** Validation result object.

**Error Codes:**
- `400` - Organization and PAT are required

---

### `POST /api/azure/projects`

List projects in an Azure DevOps organization.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `pat` | string | Yes | Personal Access Token |

**Response (200):**
```json
{
  "projects": [ ... ]
}
```

**Error Codes:**
- `400` - Organization and PAT are required

---

### `POST /api/azure/repos`

List repositories in an Azure DevOps project.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | Yes | Personal Access Token |

**Response (200):**
```json
{
  "repos": [ ... ]
}
```

**Error Codes:**
- `400` - Organization, project, and PAT are required

**Note:** When no Git repos are found, the response includes `versionControlType: 'Tfvc'` if the project uses TFVC.

---

### `POST /api/azure/wikis`

List wikis in an Azure DevOps project.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | No | PAT (uses server PAT if omitted) |

**Response (200):**

```json
{
  "wikis": [ ... ]
}
```

**Error Codes:**
- `400` - Organization and project are required

---

### `POST /api/azure/work-items/counts`

Get work item counts by type for an Azure DevOps project.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | No | PAT (uses server PAT if omitted) |

**Response (200):**

```json
{
  "counts": { ... }
}
```

**Error Codes:**
- `400` - Organization and project are required

---

### `POST /api/azure/work-items/preview`

Preview work items from an Azure DevOps project, optionally filtered by type.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | No | PAT (uses server PAT if omitted) |
| `types` | string[] | No | Work item types to filter (empty for all) |

**Response (200):**

```json
{
  "items": [ ... ]
}
```

**Error Codes:**
- `400` - Organization and project are required

---

### `POST /api/azure/project-info`

Get project info including version control type (Git or TFVC).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | No | PAT (uses server PAT if omitted) |

**Response (200):**

```json
{
  "id": "project-guid",
  "name": "MyProject",
  "versionControlType": "Git" | "Tfvc"
}
```

---

### `POST /api/azure/branches`

List branches for a specific repository in an Azure DevOps project.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `repoId` | string | Yes | Azure DevOps repository ID |
| `pat` | string | No | PAT (uses server PAT if omitted) |

**Response (200):**

```json
{
  "branches": [ ... ]
}
```

**Error Codes:**
- `400` - Organization, project, and repoId are required

---

### `POST /api/azure/pat-permissions`

Check what permissions a PAT has for a given Azure DevOps project. Tests code (repos), work items, and wiki access.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | No | PAT (uses server PAT if omitted) |

**Response (200):**

```json
{
  "permissions": {
    "code": true,
    "workItems": true,
    "wiki": false
  }
}
```

**Error Codes:**
- `400` - Organization and project are required

---

### `POST /api/azure/tfvc/items`

List TFVC items (files/folders) under a given path.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `org` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `pat` | string | No | PAT (uses server PAT if omitted) |
| `scopePath` | string | No | TFVC path (defaults to `$/{project}`) |

**Response (200):**

```json
{
  "items": [
    { "path": "$/MyProject/Folder", "isFolder": true, "size": 0, "changeDate": "..." }
  ]
}
```

---

### `GET /api/azure/organizations`

List Azure DevOps organizations for the authenticated user. Requires an active Azure OAuth session (not PAT-based). Rate-limited to 10 requests per minute.

| Detail | Value |
|---|---|
| Auth required | Yes (Azure OAuth session) |

**Response (200):**

```json
{
  "organizations": [ ... ]
}
```

**Error Codes:**
- `401` - OAuth session required or token expired
- `429` - Too many requests

---

### `GET /api/azure/oauth-status`

Check whether Azure DevOps OAuth is configured on the server (environment variables present).

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "configured": true
}
```

---

### `GET /api/azure/oauth/start`

Initiate the Azure DevOps OAuth flow. Redirects the user to Azure AD for authentication.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response:** `302` redirect to Azure AD authorization URL.

**Error Codes:**
- `503` - OAuth not configured

---

### `GET /api/azure/oauth/callback`

Handle the OAuth callback from Azure AD. Exchanges the authorization code for an access token and stores it in the session.

| Detail | Value |
|---|---|
| Auth required | No (state parameter provides CSRF protection) |

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `code` | string | Authorization code from Azure AD |
| `state` | string | CSRF protection state parameter |

**Response:** HTML page indicating success or failure. The popup window auto-closes on completion.

**Error Codes:**
- `400` - No code received or invalid state parameter
- `503` - OAuth not configured

---

### `GET /api/azure/oauth/token`

Poll for Azure OAuth token readiness. Used by the frontend after initiating the OAuth flow in a popup. Never exposes the token to the client.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "ready": true,
  "error": false
}
```

---

### `POST /api/import/azure-tfvc`

Import a TFVC path to GitHub. Converts TFVC to Git via Azure DevOps Import Request API, then clones and pushes to GitHub. Falls back to ZIP snapshot if conversion fails.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azureOrg` | string | Yes | Azure DevOps organization |
| `azureProject` | string | Yes | Project name |
| `tfvcPath` | string | Yes | TFVC path (must start with `$/`) |
| `azurePat` | string | No | PAT (uses server PAT if omitted) |
| `targetOrg` | string | No | GitHub target organization |
| `targetName` | string | No | Target repo name |
| `makePrivate` | boolean | No | Make target private (default: true) |
| `importHistory` | boolean | No | Import history up to 180 days (default: true) |

**Response (200):**

```json
{ "success": true, "jobId": 42, "message": "TFVC import started" }
```

---

### `POST /api/import/azure-tfvc/batch`

Batch import multiple TFVC paths. Same pipeline as single import with concurrency limit of 2.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Max items | 20 |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azureOrg` | string | Yes | Azure DevOps organization |
| `azureProject` | string | Yes | Project name |
| `azurePat` | string | No | PAT |
| `targetOrg` | string | No | GitHub target organization |
| `makePrivate` | boolean | No | Make targets private |
| `items` | array | Yes | `[{ tfvcPath, targetName }]` |

---

### `GET /api/migrations/stats`

Get migration statistics summary for the dashboard.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "total": 15,
  "completed": 12,
  "failed": 1,
  "running": 2,
  "tfvc": 3,
  "recent": [ { "id": 1, "sourceType": "azure-tfvc", "sourceName": "...", "status": "complete", ... } ]
}
```

---

### `POST /api/import/check-duplicates`

Check whether target repository names already exist on GitHub before importing. Used to warn users about potential conflicts.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | string[] | Yes | Array of repository names to check |
| `targetOwner` | string | Yes | Target GitHub owner (user or org) |

**Response (200):**

```json
{
  "duplicates": {
    "repo-name": true,
    "other-repo": false
  }
}
```

**Error Codes:**
- `400` (`MISSING_REPOS`) - Repos array is required
- `400` (`MISSING_OWNER`) - Target owner is required

---

## Migration Plans (`/api/migration/*`)

Migration plans provide a structured way to plan, validate, execute, and monitor multi-step migrations from Azure DevOps to GitHub. Plans can include repositories, wikis, and work items.

**Tier gating** (none of these routes carry `requireTier` at the route level — the model is metered, not tier-locked):

- Creating, listing, reading, updating, validating, cancelling and pausing plans is available to **all tiers** (each plan is owned by the caller — `WHERE user_id = ?` — so cross-tenant access 404s).
- **Full (non-dry-run) execution is metered** by `requireMigrationQuota`: Free tier gets **5 full migrations per month**; dry-runs are unlimited. Applies to `execute`, `resume`, and the three task-level retry routes.
- **Scheduling** a full migration to auto-run later requires **Pro** — a scheduled run bypasses the interactive execute meter, so `POST /plans` returns `403 upgrade_required` when a Free user submits `schedule.mode: 'scheduled'` with `schedule.isDryRun: false`.

Plan bodies are validated by `createPlanSchema` / `updatePlanSchema` (`server/lib/validators.js`). Zod **strips undeclared task `config` keys**, so only the declared fields survive — per task type: `makePrivate`, `description`, `rollbackPolicy`, `timeout`, `sizeStrategy` (`exclude` | `lfs-migrate`), `onConflict` (`fail` | `replace`); `repo-tfvc` additionally allows `inPlace`, `targetProject`, `existingRepoId`; `work-items` and `wiki` have their own config shapes.

### `POST /api/migration/plans`

Create a new migration plan.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | object | Yes | Source configuration (`org`, `project`, `pat`) |
| `tasks` | object[] | Yes | Array of migration tasks |
| `targetOrg` | string | No | Target GitHub organization |
| `schedule` | object | No | Schedule config (`mode`, `scheduledAt`, `isDryRun`) |

**Response (200):**

```json
{
  "planId": 1
}
```

**Error Codes:**
- `400` - Validation failed

---

### `GET /api/migration/plans`

List migration plans for the authenticated user (paginated).

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `per_page` | number | 20 | Results per page (max 100) |

**Response (200):**

```json
{
  "plans": [ ... ],
  "total": 15,
  "page": 1,
  "perPage": 20
}
```

---

### `GET /api/migration/plans/:id`

Get a migration plan with all tasks and their statuses.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):** Plan object with tasks array.

**Error Codes:**
- `403` - Not the plan owner
- `404` - Plan not found

---

### `PUT /api/migration/plans/:id`

Update a migration plan. Only draft plans can be updated.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `400` - Can only update draft plans or validation failed
- `403` - Not the plan owner

---

### `DELETE /api/migration/plans/:id`

Delete a migration plan. Active plans cannot be deleted.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `400` - Cannot delete an active plan
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/validate`

Run pre-flight validation on a migration plan (check credentials, target availability, etc.).

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):** Validation result object.

**Error Codes:**
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/execute`

Start executing a migration plan. Runs asynchronously.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azurePat` | string | No | Azure PAT for this execution |

**Response (200):**

```json
{
  "success": true,
  "message": "Execution started"
}
```

**Error Codes:**
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/cancel`

Cancel a running migration plan.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/pause`

Pause a running migration plan.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/resume`

Resume a paused migration plan.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azurePat` | string | No | Azure PAT for resumed execution |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/tasks/:taskId/retry`

Retry a failed task within a migration plan.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azurePat` | string | No | Azure PAT for the retry |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `403` - Not the plan owner

---

### `POST /api/migration/plans/:id/tasks/:taskId/replace-retry`

Destructive recovery for a repository task that failed on an "already exists" conflict. Patches the stored task `config` with `onConflict: 'replace'` and re-runs it, so the importer deletes and recreates the target. Works on pre-existing failed plans too (this path does not re-run `createPlanSchema`).

| Detail | Value |
|---|---|
| Auth required | Yes |
| Quota | Metered (`requireMigrationQuota`) — Free: 5 full migrations/month |
| Authorization | Plan owner only |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azurePat` | string | No | Azure PAT for the retry |

**Response (200):** `{ "success": true }`

**Error Codes:**
- `400` - Task type is not `repo`/`repo-tfvc` (Replace only applies to repository tasks)
- `404` - Plan or task not found (or not owned by the caller)
- `409` - Only failed tasks can be replace-retried

---

### `POST /api/migration/plans/:id/tasks/:taskId/retry-lfs`

Recovery for a repository task that failed because files exceed GitHub's 100 MB per-file limit. Patches the stored config with `sizeStrategy: 'lfs-migrate'` (so the re-run runs `git lfs migrate import --above=100MiB` before pushing) and re-runs the task.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Quota | Metered (`requireMigrationQuota`) — Free: 5 full migrations/month |
| Authorization | Plan owner only |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `azurePat` | string | No | Azure PAT for the retry |

**Response (200):** `{ "success": true }`

**Error Codes:**
- `400` - Task type is not `repo`/`repo-tfvc` (Git LFS migration only applies to repository tasks)
- `404` - Plan or task not found (or not owned by the caller)
- `409` - Only failed tasks can be retried

---

### `GET /api/migration/stream/:id`

Subscribe to real-time migration progress via Server-Sent Events (SSE).

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |
| Content-Type | `text/event-stream` |

**Response:** SSE stream with progress events for the migration plan.

---

### `POST /api/migration/analyze`

Analyze a set of repositories for migration planning. Uses AI-powered analysis when available, with a deterministic fallback.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `repos` | object[] | Yes | Array of repository objects (max 200) |

**Response (200):** Analysis result object with recommendations.

**Error Codes:**
- `400` - Invalid context or repos array required

---

### `GET /api/migration/plans/:id/report`

Export a migration report for a completed (or failed) plan.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier | All tiers (full runs metered — see gating note above) |
| Authorization | Plan owner only |

**Response (200):**

```json
{
  "plan": {
    "id": 1,
    "status": "completed",
    "isDryRun": false,
    "startedAt": "...",
    "completedAt": "...",
    "durationSeconds": 120
  },
  "summary": { "total": 5, "success": 4, "failed": 1, "skipped": 0 },
  "tasks": [ ... ],
  "errors": [
    { "taskId": 3, "type": "repo", "error": "...", "suggestion": "..." }
  ],
  "generatedAt": "2025-01-01T00:00:00Z"
}
```

**Error Codes:**
- `403` - Not the plan owner

---

## Migration Marks (`/api/migration/marks/*`)

Read-only provenance for repositories that were produced by a migration. Marks are written to GitHub topics/description/custom-properties, Azure project properties, and a git annotated tag when a plan runs; these endpoints surface them for the "Migrated" pill, the MigrationHistory badge, and the RepoDetail provenance card. Backed by `server/routes/migration-marks.js`; mounted at `/api/migration/marks` behind `requireAuth`. Every query is scoped to the caller through the owning plan (`migration_plans.user_id = ?`), so one tenant can never read another's provenance.

Stored `payload` columns are returned parsed (via `safeJson`).

### `GET /api/migration/marks`

List marks, optionally filtered. Capped at 200 rows, newest first.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `targetFullName` | string | Match marks whose `target_id` is `owner/repo` or `owner/repo#variant` |
| `targetKind` | string | Exact match on `target_kind` (e.g. `github-topic`) |

**Response (200):** `{ "marks": [ { ...markRow, "payload": {...} } ] }`

**Error Codes:**
- `401` - Not authenticated

---

### `GET /api/migration/marks/mine`

Batched lookup of every repo the current user has migrated — a single round-trip replacement for the per-card `?targetFullName=` fetch.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "migrated": {
    "owner/repo": { "writtenAt": "2026-05-23T12:00:00Z" }
  }
}
```

`writtenAt` is the latest `written` timestamp for that repo (used for the pill tooltip), or `null` if no mark has reached `written` status.

**Error Codes:**
- `401` - Not authenticated

---

### `GET /api/migration/marks/plan/:id`

All marks for a single plan, grouped by scope. User-scoped: returns an empty set (never a 403) when the plan belongs to another tenant.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "planId": 1,
  "byScope": { "source": [ ... ], "destination": [ ... ], "git-tag": [ ... ] },
  "marks": [ { ...markRow, "payload": {...} } ]
}
```

**Error Codes:**
- `400` - Invalid plan id (not numeric)
- `401` - Not authenticated

---

## Webhooks (`/api/webhooks/*`)

### `POST /api/webhooks/actions`

Receive GitHub webhook events for Actions workflow runs. Authenticated via webhook signature, not session cookies.

| Detail | Value |
|---|---|
| Auth required | No (webhook signature via `X-Hub-Signature-256` header) |

**Headers:**

| Header | Required | Description |
|---|---|---|
| `X-Hub-Signature-256` | Yes | HMAC-SHA256 signature of the payload |

**Request Body:** GitHub webhook payload (see [GitHub Webhook Events](https://docs.github.com/en/webhooks-and-events/webhooks/webhook-events-and-payloads)).

**Response (200):**
```json
{
  "success": true
}
```

**Error Codes:**
- `401` - Invalid webhook signature

---

## Statistics (`/api/stats/*`)

### `GET /api/stats`

Get repository statistics with server-side caching.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `org` | string | - | Organization login (omit for personal) |

**Headers:**

| Header | Default | Description |
|---|---|---|
| `X-Cache-TTL` | `5` | Cache TTL in minutes, clamped to `[1, 60]`. **`0` disables caching entirely** — every request refetches and nothing is written to the cache. A non-numeric value falls back to the default rather than disabling it. |

**Response Headers:**

| Header | Description |
|---|---|
| `X-Cache-Hit` | `true` or `false` |

**Response (200):**
```json
{
  "totalRepos": 50,
  "publicRepos": 30,
  "privateRepos": 20,
  "forks": 5,
  "sources": 45,
  "archived": 3,
  "totalStars": 150,
  "totalForks": 75,
  "languages": {
    "JavaScript": 20,
    "Python": 10
  }
}
```

**Error Codes:**
- `401` - Authentication expired
- `403` - Rate limit or insufficient permissions
- `404` - Organization not found
- `429` - API rate limit exceeded

---

### `POST /api/stats/clear-cache`

Clear the statistics cache for the authenticated user.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true,
  "cleared": 3
}
```

---

### `GET /api/stats/global`

Get enhanced global statistics including actions and community health data.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `org` | string | - | Organization login (omit for personal) |

**Response (200):**
```json
{
  "totalRepos": 50,
  "publicRepos": 30,
  "privateRepos": 20,
  "forks": 5,
  "sources": 45,
  "archived": 3,
  "totalStars": 150,
  "totalForks": 75,
  "totalWatchers": 200,
  "hasIssues": 45,
  "hasWiki": 40,
  "hasProjects": 30,
  "languages": { ... },
  "hasActions": true,
  "healthAnalyzed": 10
}
```

**Error Codes:**
- `401` - Authentication expired
- `403` - Rate limit or insufficient permissions
- `404` - Organization not found

---

### `GET /api/stats/actions`

Get aggregated GitHub Actions statistics across all repositories.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `days` | number | 30 | Number of days to analyze |

**Response (200):**
```json
{
  "totalRuns": 500,
  "successCount": 450,
  "failureCount": 30,
  "cancelledCount": 20,
  "successRate": 90.00,
  "avgDuration": 120,
  "lastRunAt": "2025-01-01T00:00:00Z"
}
```

---

## System (`/api/system/*`)

### `GET /api/system/status`

Check whether the system has been initialized (setup completed).

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**
```json
{
  "initialized": true
}
```

---

### `POST /api/system/setup`

Run initial system setup (create tables, verify schema, seed data).

| Detail | Value |
|---|---|
| Auth required | No — intentionally public; rate-limited (5/min) and a no-op after the first run |

**Response (200):**
```json
{
  "success": true
}
```

---

### `GET /api/system/source`

Machine-readable provenance. Unauthenticated by design, so anyone can check what a deployment claims to be without reading its HTML. Under the previous AGPL licence this discharged the §13 source-disclosure obligation; under Apache-2.0 there is no such obligation and the endpoint is kept as a courtesy. Forks should edit [`server/routes/system.js`](../../server/routes/system.js) and point `sourceUrl` at their own source — nothing compels it, but answering with someone else's repository tells users something untrue.

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**
```json
{
  "license": "Apache-2.0",
  "sourceUrl": "https://github.com/brunobola-portfolio/GitHub-Repo-Manager",
  "trademarksUrl": "https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/TRADEMARKS.md",
  "notice": "Apache-2.0 grants broad rights over the code and none over the RepoManager name or mark."
}
```

---

### `GET /api/system/update-check`

Self-hosted "new version available" signal for Settings → About. Notify-only everywhere except the packaged Windows build, which exposes `POST /api/system/update` (loopback-only, rate-limited) for a one-click update from the tray launcher. Forwards to [`checkForUpdate()`](../../server/lib/update-check.js), which makes a single unauthenticated `GET` to GitHub's public releases API (no query params, no identifying data) and caches the result — 24h on success, 1h after a failure so a transient outage retries sooner. Never throws: a network failure, a malformed release payload, or a dev build running ahead of the last tag all degrade to an "inconclusive" result rather than a 500, and an unexpected error in the route handler itself still returns `200 { current }`.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200) — update check enabled:**
```json
{
  "current": "4.7.0",
  "latest": "4.7.0",
  "updateAvailable": false,
  "releaseUrl": "https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v4.7.0",
  "checkedAt": "2026-07-19T12:00:00.000Z"
}
```

**Response (200) — disabled via `UPDATE_CHECK=false`:**
```json
{
  "current": "4.7.0",
  "disabled": true
}
```

**Response (200) — inconclusive (fetch failed, timed out, or a non-2xx from GitHub):** `latest`, `updateAvailable`, and `releaseUrl` are all `null` — the check never claims an update is or isn't available when it can't tell.
```json
{
  "current": "4.7.0",
  "latest": null,
  "updateAvailable": null,
  "releaseUrl": null,
  "checkedAt": "2026-07-19T12:00:00.000Z"
}
```

---

### `POST /api/system/client-error`

Report a client-side error. Used by the frontend error boundary. No authentication required since errors may occur before login.

| Detail | Value |
|---|---|
| Auth required | No |

**Request Body:**

| Field | Type | Description |
|---|---|---|
| `message` | string | Error message |
| `stack` | string | Stack trace |
| `componentStack` | string | React component stack |
| `url` | string | Page URL where error occurred |
| `timestamp` | string | ISO 8601 timestamp |

**Response (200):**
```json
{
  "received": true
}
```

---

## Health Probes (`/api/health/*`)

Kubernetes-style liveness/readiness probes plus a legacy shallow health check. Unlike the rest of this document, these are **mounted directly at `/api/health`** (in `server/index.js`, before session/CSRF/rate-limit middleware) — they are **not** served under the `/api/v1` alias. All three are unauthenticated, un-rate-limited, and CSRF-exempt (GETs), so probes work before any session exists and while the stack is degraded.

### `GET /api/health`

Legacy shallow health check (used by the frontend's connectivity detection).

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**

```json
{
  "status": "ok",
  "version": "4.1.1",
  "uptime": 1234,
  "database": "connected",
  "redis": "configured"
}
```

`database` is `disconnected` (and `status` becomes `degraded`) if the `SELECT 1` probe throws. `redis` is present only when `REDIS_URL` is configured.

---

### `GET /api/health/live`

Liveness probe. Returns 200 immediately unless the process is mid-shutdown; touches no downstream dependency so a degraded dependency can't cause the orchestrator to kill the pod.

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):** `{ "status": "alive" }`
**Response (503):** `{ "status": "shutting_down" }` while the server is draining.

---

### `GET /api/health/ready`

Readiness probe. Runs dependency checks, each with a 100 ms RTT budget: the database (`SELECT 1`) and the session store (Redis `PING` when `REDIS_URL` is set, otherwise a trivial SQLite `sessions`-table check).

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**

```json
{ "status": "ready", "checks": { "db": "ok", "session": "ok" } }
```

**Response (503):** returned when any check fails; the `checks` map names the degraded dependency:

```json
{ "status": "degraded", "checks": { "db": "ok", "session": "error: timeout after 100ms" } }
```

---

## Brand Guide (`/brand`)

The one app-level route that serves a document rather than JSON. Every
deployment publishes the brand and media kit at `/brand` — the marks at real
pixel sizes on both grounds, the palette, the type, and the whole kit as a
single download. Registered in `server/index.js` **before** the SPA fallback,
because `express.static` runs with `index: false` and would otherwise hand
`/brand/` to the React app.

The page is copied from `brand/` into `dist/` at build time by the
`copy-brand-kit` Vite plugin, so it ships with the frontend and needs no
separate hosting. It is entirely self-contained — its own fonts, its own SVGs,
no external requests — which is also what lets it satisfy the app's CSP
unchanged.

### `GET /brand`

| Detail | Value |
|---|---|
| Auth required | No |
| Response | `text/html` — the guide (`Cache-Control: no-cache`, so a redeploy is picked up immediately) |
| Absent in dev | The route only mounts when `dist/brand/index.html` exists; running from source, open `brand/index.html` directly |

`GET /brand/repomanager-media-kit.zip` is served by the static handler and
carries every mark, the fonts with their OFL licence, `BRAND.md` and a plain
`README.txt`.

---

## Billing (`/api/billing/*`)

Billing endpoints manage Stripe-based subscriptions. All billing mutation endpoints require Stripe to be configured on the server (`requireStripe` middleware). Returns `503` if Stripe is not configured.

### `GET /api/billing/config`

Public capability probe so the (possibly logged-out) pricing page can feature-detect before rendering the monthly/yearly toggle, and read the prices it is about to advertise. Amounts and currency only — never a price ID, never a secret.

| Detail | Value |
|---|---|
| Auth required | No |

**Response (200):**

```json
{
  "stripeEnabled": true,
  "yearlyBillingAvailable": true,
  "prices": {
    "pro": {
      "monthly": { "amount": 1900, "currency": "usd", "interval": "month" },
      "yearly":  { "amount": 18000, "currency": "usd", "interval": "year" }
    },
    "enterprise": {
      "monthly": { "amount": 9900, "currency": "usd", "interval": "month" }
    }
  }
}
```

- `stripeEnabled` — `true` when a Stripe secret key is configured.
- `yearlyBillingAvailable` — `true` only when Stripe is enabled **and** a Pro yearly price ID (`STRIPE_PRICE_PRO_YEARLY`) is configured. The pricing toggle is Pro-driven (Enterprise is Contact-Sales).
- `prices` — resolved from Stripe with `prices.retrieve()` on each configured `STRIPE_PRICE_*` ID, cached for 10 minutes. `amount` is in **minor units** (Stripe's `unit_amount`), so `1900` is $19.00.

Operators configure Stripe **price IDs**, not amounts — the amount lives in Stripe — so this is the only honest source for what the pricing page should display. Before it existed the page hardcoded `$19` while the checkout charged whatever the operator's price actually was.

A price that cannot be resolved is **omitted**, never guessed: that slot simply does not appear, and the client falls back to its built-in default rather than advertising a number the checkout would not honour. When Stripe is not configured at all, `prices` is `{}`.

---

### `POST /api/billing/checkout`

Create a Stripe Checkout session to subscribe to a paid tier.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Stripe required | Yes |

**Request Body:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `tier` | string | Yes | - | Subscription tier: `pro` or `enterprise` |
| `billingPeriod` | string | No | `"monthly"` | `monthly` or `yearly`. Yearly is honoured only when a matching yearly price ID is configured for the tier; otherwise the request 400s (never silently falls back to monthly) |

**Response (200):**

```json
{
  "url": "https://checkout.stripe.com/c/pay/..."
}
```

**Error Codes:**
- `400` - Invalid input, or price not configured for the requested `tier` + `billingPeriod`
- `503` - Billing is not configured

---

### `POST /api/billing/portal`

Create a Stripe Customer Portal session for managing an existing subscription (update payment method, cancel, etc.).

| Detail | Value |
|---|---|
| Auth required | Yes |
| Stripe required | Yes |

**Response (200):**

```json
{
  "url": "https://billing.stripe.com/p/session/..."
}
```

**Error Codes:**
- `400` - No billing account found
- `503` - Billing is not configured

---

### `GET /api/billing/subscription`

Get the current subscription status for the authenticated user.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "tier": "pro",
  "status": "active",
  "current_period_end": "2025-02-01T00:00:00Z",
  "stripe_subscription_id": "sub_..."
}
```

**Default (no subscription):**

```json
{
  "tier": "free",
  "status": "active",
  "current_period_end": null
}
```

---

## Audit Log (`/api/audit/*`)

The audit router is mounted behind `requireTier('enterprise')`, so all audit endpoints require the **Enterprise** tier (a lower tier gets `403 TIER_REQUIRED_ENTERPRISE`). The frontend consumes this router from its own page (`#/audit`), not a tab inside the Settings modal — Settings now shows a summary that links to it.

### `GET /api/audit`

List audit log entries for the authenticated user (paginated). Supports filtering by action, resource type, and date range.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier required | Enterprise |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Results per page |
| `action` | string | - | Filter by action (e.g., `api_key.create`) |
| `resource_type` | string | - | Filter by resource type |
| `from` | string | - | Start date (ISO 8601) |
| `to` | string | - | End date (ISO 8601) |

**Response (200):**

```json
{
  "entries": [ ... ],
  "total": 150,
  "page": 1,
  "limit": 50
}
```

---

### `GET /api/audit/actions`

Distinct action values already present in the caller's audit log, for populating the `#/audit` page's action filter from real data instead of a hardcoded list.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier required | Enterprise |

---

### `GET /api/audit/verify`

Walks the caller's append-only SHA-256 hash chain (`prev_hash` → `this_hash`) end to end and reports whether it is intact — the same check `npm run audit:verify` performs from the CLI, exposed for the page's **Verify chain** action.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier required | Enterprise |

**Response (200):**

```json
{
  "ok": true,
  "checked": 1204,
  "brokenAt": null,
  "unhashedLegacy": 0
}
```

---

### `GET /api/audit/export`

Bulk download of the audit log for offline retention or compliance review.
Uses keyset pagination (`before`), not page numbers, so an export stays
consistent while new entries are being written.

| Detail | Value |
|---|---|
| Auth required | Yes |
| Tier required | Enterprise |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `format` | string | `csv` | `csv` or `json` |
| `limit` | number | 5000 | Rows per request (capped server-side) |
| `before` | number | - | Keyset cursor: return rows with `id` below this |
| `action` | string | - | Filter by action |
| `resource_type` | string | - | Filter by resource type |
| `from` | string | - | Start date (ISO 8601) |
| `to` | string | - | End date (ISO 8601) |

CSV responses carry `Content-Disposition: attachment` with a dated filename
and include the `prev_hash` / `row_hash` columns, so a downloaded log can be
verified offline against the same chain `npm run audit:verify` walks.

Cells beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe in the
CSV rendering so spreadsheets treat them as text rather than formulas —
`user_agent` and `ip_address` carry client-supplied values. The JSON export is
byte-exact and is the right choice for machine consumption.

**Response (403)** when the tier does not include it:

```json
{
  "error": "Tier required",
  "code": "TIER_REQUIRED_ENTERPRISE",
  "feature": "auditExport",
  "currentTier": "free",
  "requiredTier": "enterprise"
}
```

---

## Usage Metrics (`/api/usage/*`)

### `GET /api/usage`

Get current usage metrics for the authenticated user across all tracked dimensions, including tier-based limits.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "tier": "pro",
  "period_start": "2025-01-01T00:00:00.000Z",
  "metrics": {
    "ai_queries": { "current": 42, "limit": 500 },
    "repos_managed": { "current": 15, "limit": null }
  }
}
```

`limit: null` means unlimited — it is how `Infinity` serialises. Repository
count is **not** capped on any tier, so `repos_managed.limit` is always
`null`; compare against it with an explicit null check rather than
`current >= limit`, which is true for every user when `limit` is null.

---

## API Keys (`/api/api-keys/*`)

### `GET /api/api-keys`

List all API keys for the authenticated user. Key hashes are never returned; only the prefix is shown for identification.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):** Array of API key objects.

```json
[
  {
    "id": "uuid",
    "name": "My CI Key",
    "key_prefix": "ghrm_abc1",
    "scopes": "[\"read\",\"write\"]",
    "last_used_at": null,
    "expires_at": null,
    "created_at": "2025-01-01T00:00:00Z",
    "revoked_at": null
  }
]
```

---

### `POST /api/api-keys`

Generate a new API key. The full key is returned only once in this response and cannot be retrieved later.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Descriptive name for the key (1-100 chars) |
| `scopes` | string[] | No | Permissions: `read`, `write`, `admin`, `ai` (default: `["read"]`) |
| `expires_at` | string | No | Expiration date (ISO 8601 datetime) |

**Response (201):**

```json
{
  "id": "uuid",
  "key": "ghrm_abc123...",
  "name": "My CI Key",
  "prefix": "ghrm_abc1",
  "scopes": ["read", "write"],
  "expires_at": null
}
```

**Error Codes:**
- `400` - Invalid input (name too short/long, invalid scopes)

---

### `DELETE /api/api-keys/:id`

Revoke an API key. The key is soft-deleted (marked with `revoked_at` timestamp) and can no longer be used for authentication.

| Detail | Value |
|---|---|
| Auth required | Yes |

**Response (200):**

```json
{
  "success": true
}
```

**Error Codes:**
- `404` - Key not found or already revoked

### The `ai` scope is enforced, not just a creation option

`ai` (one of the `scopes` values above) is checked by `requireScope('ai')`
(`server/middleware/api-key-auth.js`) on the 20 AI *generation* endpoints
under `/api/ai/*` — chat, suggest, readme, and the rest of the [AI](#ai-apiai)
section below. A key needs `ai` or `admin` in its scopes to call them; a
`read`/`write`-only key gets:

```json
{
  "error": "Insufficient permissions",
  "required": "ai"
}
```

(`403`). Session/cookie auth is never scope-checked — `requireScope` only
runs for API-key requests — so signed-in browser users are unaffected either
way.

The four Pro AI groups that mutate GitHub or persist beyond a single reply —
[AI Deep Review](#ai-deep-review-apiaideep-review), AI Prompt Studio, AI PR
Slash Commands, and AI PR Chat — are **not** covered by the `ai` scope. Their
mutating routes stay behind the existing `write` scope gate (the central
mutation check in `apiKeyAuth`) like every other GitHub-mutating endpoint, so
an `ai`-only key still cannot use them.

---

## Stripe Webhooks (`/api/v1/webhooks/stripe`)

### `POST /api/v1/webhooks/stripe`

Receive and process Stripe webhook events for subscription lifecycle management. Authenticated via Stripe webhook signature, not session cookies. The request body must be raw (not JSON-parsed).

| Detail | Value |
|---|---|
| Auth required | No (Stripe signature via `stripe-signature` header) |
| Content-Type | `application/json` (raw body) |

**Headers:**

| Header | Required | Description |
|---|---|---|
| `stripe-signature` | Yes | Stripe webhook signature |

**Handled Events:**

| Event | Effect |
|---|---|
| `checkout.session.completed` | Activates subscription for the user |
| `customer.subscription.updated` | Updates tier, status, and billing period |
| `customer.subscription.deleted` | Downgrades user to free tier |
| `invoice.payment_failed` | Marks subscription as `past_due` |
| `invoice.paid` | Re-activates subscription after successful payment |

**Response (200):**

```json
{
  "received": true
}
```

**Error Codes:**
- `400` - Invalid signature
- `503` - Stripe webhooks not configured

---

## AI Deep Review (`/api/ai/deep-review/*`)

Drives the premium PR review surface. See the [AI Deep Review feature
guide](../features/ai-deep-review.md) and the
[slice 1a plan](../plans/2026-05-03-ai-deep-review-slice-1a.md) for end-to-end design.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/ai/deep-review/:owner/:repo/:pr` | requireAuth | Generate (or refresh) the AI review draft for a PR. Persists to `ai_pr_reviews`. Rate-limited 10/min/user. Honours `?presetKey=` to apply a Prompt Studio preset. |
| `GET` | `/api/ai/deep-review/:owner/:repo/:pr` | requireAuth | Fetch the latest persisted draft (no LLM call). 404 when none. |
| `PATCH` | `/api/ai/deep-review/:draftId/comments/:idx` | requireAuth | `{action:'dismiss'\|'edit', body?, suggestion?}` — surgical edit of a single line comment in the draft. |
| `POST` | `/api/ai/deep-review/:draftId/publish` | requireAuth | `{event:'COMMENT'\|'APPROVE'\|'REQUEST_CHANGES'}` — batched publish to GitHub via `executeViaOutbox` with idempotency key `pr-deep-review:{draftId}:{event}`. Returns `202 {queued, outboxId}` on async path. **No tier gate** — AI publish is free with BYOK key. |
| `DELETE` | `/api/ai/deep-review/:draftId` | requireAuth | Discard the draft. |

## AI Prompt Studio (`/api/ai/prompt-studio/*`)

Backs Prompt Studio (`/ai/prompts` page). Every endpoint — including the
mutating ones — is `requireAuth` only (moved off the Pro paywall in the
2026-07-18 free-first rebalance); there is no `requireTier('pro')` gate
anywhere in this route file. Free is metered instead: up to 10 saved
presets (`promptPresetsMax`) and 30 test-preset runs/month
(`promptStudioTestPerMonth`, checked via `checkAIFeatureLimit(userId,
'ai_prompt_test')`); Pro/Enterprise are unlimited. See the
[slice 1b plan](../plans/2026-05-04-ai-deep-review-slice-1b.md) and
[`server/lib/feature-flags.js`](../../server/lib/feature-flags.js) for the
authoritative numbers.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/ai/prompt-studio/presets` | requireAuth | List visible presets: 5 built-ins + the caller's user/repo customs + org-shared presets visible to the caller via `getCurrentUserOrgs` + `isOrgMember`. Each row tagged with `builtin`, `shared`, `ownedByUser`. |
| `GET` | `/api/ai/prompt-studio/presets/:id` | requireAuth | Full preset body. Built-in keys (`general`, `security`, …) served from code; numeric ids enforce ownership unless the row is `scope='org'` and the caller is a member. |
| `POST` | `/api/ai/prompt-studio/presets` | requireAuth | Create a custom preset at `scope='user'` / `'repo'` / `'org'`, capped at `promptPresetsMax` per user (10 on Free, unlimited on Pro/Enterprise). Org scope checks membership before saving (403 `NOT_ORG_MEMBER`). Rejects built-in keys (409 `RESERVED_KEY`). Validated by `promptPresetCreateSchema`. |
| `PATCH` | `/api/ai/prompt-studio/presets/:id` | requireAuth | Author-only edit (`WHERE user_id = ?`); other org members get 404. |
| `DELETE` | `/api/ai/prompt-studio/presets/:id` | requireAuth | Author-only. |
| `POST` | `/api/ai/prompt-studio/presets/:id/test` | requireAuth | Run the preset against a fixed sample diff and return the structured output. Metered: 30 runs/month on Free (`ai_prompt_test`), unlimited on Pro/Enterprise. Per-user 1/10s rate limit. |
| `POST` | `/api/ai/prompt-studio/presets/:id/set-default` | requireAuth | Mark the preset as the default for its scope; clears `is_default` on siblings inside the same `(user_id, scope, scope_target)` group. |

## AI PR Slash Commands (`/api/ai/pr-commands/*`)

Backs the Commands tab in `<AIReviewPanel>` — `/describe`, `/test_plan`,
`/improve`. Every route is `requireAuth` only — no `requireTier('pro')`
gate. The generate/refresh endpoint is metered instead: 30/month on Free
(`ai_pr_command`, via `checkAIFeatureLimit`), unlimited on Pro/Enterprise.
Per-user 20/h rate limit with LRU sweep. Results persist in
`ai_pr_commands`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/ai/pr-commands/:owner/:repo/:pr/:command` | requireAuth | Generate (or refresh). `:command` ∈ `{describe, test_plan, improve}`. Metered: 30/month on Free, unlimited on Pro/Enterprise. Returns `{id, output, modelUsed, costUsd}`. |
| `GET` | `/api/ai/pr-commands/:owner/:repo/:pr/:command` | requireAuth | Cached result (no LLM, not metered). 404 when none. |
| `DELETE` | `/api/ai/pr-commands/:owner/:repo/:pr/:command` | requireAuth | Discard. |
| `POST` | `/api/ai/pr-commands/:owner/:repo/:pr/describe/publish` | requireAuth | Apply the `/describe` output by PATCHing the PR body via `executeViaOutbox`. Idempotency key includes a SHA-256 hash of `${title}\n${body}` so a regenerate-then-republish produces a fresh key (silent dedupe was a bug fixed in commit `c90eeb0`). |

## AI PR Chat (`/api/ai/pr-chat/*`)

Backs the streaming Q&A tab. **MIN scope** — server-side tool execution
(`read_pr_file`, `list_pr_comments`) is forward-compatible in the
`ai_pr_chat_messages` schema (`tool_name`, `tool_input_json`,
`tool_output_json` columns) but not yet wired. Per-user 30 messages/hour.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/ai/pr-chat/:owner/:repo/:pr` | requireAuth | Persisted message history (no LLM call). |
| `POST` | `/api/ai/pr-chat/:owner/:repo/:pr` | requireAuth | SSE-stream a new turn. Body: `{message: string}`. Persists user msg + assistant reply. Compacts history at `MAX_HISTORY_TURNS = 10`. Streams via `initSSE` + `streamToSSE` with client-disconnect AbortSignal piped into `provider.generateStream({ signal })`. |
| `DELETE` | `/api/ai/pr-chat/:owner/:repo/:pr` | requireAuth | Clear conversation. |

---

## Dashboard (`/api/v1/dashboard/*`)

All dashboard endpoints require an authenticated session (`requireAuth`). No tier gate — all actions are available to free-tier users.

---

### `GET /api/v1/dashboard/inbox`

Returns the Live Inbox composed from existing event-aggregation helpers.

| Detail | Value |
| --- | --- |
| Auth required | Yes |
| Tier gate | None (free) |

**Query Parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `sections` | string | Comma-separated list: `needs_review`, `my_prs`, `mentions`, `failing_ci`, `stale_drafts`, `dependabot_ready`. Omit for all. |
| `include_archived` | `"1"` | Pass `"1"` to include archived items. Default: excluded. |

**Response `200`:**

```json
{
  "sections": [
    {
      "key": "needs_review",
      "label": "Needs my review",
      "items": [
        {
          "id": "pr:owner/repo#42",
          "kind": "pr",
          "section": "needs_review",
          "repoFullName": "owner/repo",
          "prNumber": 42,
          "title": "feat: add widget",
          "authorLogin": "alice",
          "since": "2026-05-09T10:00:00Z",
          "ageHours": 26
        }
      ]
    }
  ]
}
```

Note: `failing_ci` and `dependabot_ready` sections always return `items: []` in Phase 1 (stubs, wired in Phase 2/3).

---

### `POST /api/v1/dashboard/inbox/:itemId/archive`

Archives an inbox item for the current user. `itemId` must be URL-encoded (e.g., `pr%3Aowner%2Frepo%2323`).

| Detail | Value |
| --- | --- |
| Auth required | Yes |
| Tier gate | None (free) |
| Body | None |

**Response `200`:** `{ "ok": true }`

**Errors:** `500` on DB failure.

---

### `POST /api/v1/dashboard/inbox/:itemId/restore`

Clears both `archived_at` and `snoozed_until` for an item, returning it to the active inbox.

| Detail | Value |
| --- | --- |
| Auth required | Yes |
| Tier gate | None (free) |
| Body | None |

**Response `200`:** `{ "ok": true }`

---

### `POST /api/v1/dashboard/inbox/:itemId/snooze`

Snoozes an inbox item until a future timestamp.

| Detail | Value |
| --- | --- |
| Auth required | Yes |
| Tier gate | None (free) |

**Request Body (`application/json`):**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `until` | ISO 8601 string | Yes | Must be in the future. |

**Response `200`:** `{ "ok": true }`

**Errors:** `400` if `until` is missing, non-parseable, or in the past. `500` on DB failure.

---

## Additional Endpoints (grouped)

Lower-level, internal, and operator routes that back specific UI surfaces. Every route below is served under both `/api/*` and `/api/v1/*` (via the v1 aggregator) **except** the Environment Tooling group, which is mounted only at `/api/env`. `Auth` column: `Yes` = `requireAuth`; `Admin` = additionally `requireAdmin`; `Pro`/`Enterprise` = additionally `requireTier`; `AI` = additionally `requireAI`; `No` = unauthenticated. Write endpoints noting a `*Schema` are Zod-validated (`server/lib/validators.js`).

### Authentication extras (`/api/auth/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/auth/session-info` | No | Session diagnostics (age, absolute-timeout deadline) |
| `POST` | `/api/auth/refresh-session` | No | Roll the session/refresh its expiry |
| `GET` | `/api/auth/csrf-token` | No | Issue a CSRF token for the SPA |

### Search (`/api/search/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/search/github` | Yes | Proxy to the GitHub search API (validated query via `querySchema`) |

### GitHub event webhooks

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/webhooks/github` | No (signature) | Receive GitHub App/event webhooks (raw body, `X-Hub-Signature-256`). Also at `/api/v1/webhooks/github`. |

### Pull request review sub-endpoints (`/api/repos/:owner/:repo/pulls/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `.../pulls/:pull_number/diff` | Yes | Raw unified diff for the PR |
| `GET` | `.../pulls/:pull_number/comments` | Yes | List review comments |
| `POST` | `.../pulls/:pull_number/comments` | Yes | Create a review comment (`prReviewCommentSchema`) |
| `POST` | `.../pulls/:pull_number/comments/:comment_id/replies` | Yes | Reply to a review comment (`prReviewReplySchema`) |
| `POST` | `.../pulls/:pull_number/reviews` | Yes | Submit a review — approve / request-changes / comment (`prReviewSubmitSchema`) |

### Issue labels, assignees & timeline (`/api/repos/:owner/:repo/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `PUT` | `.../issues/:issue_number/labels` | Yes | Replace an issue's labels (`issueLabelsReplaceSchema`; an empty array clears all labels) |
| `POST` | `.../issues/:issue_number/assignees` | Yes | Add assignees (`issueAssigneesSchema`) |
| `DELETE` | `.../issues/:issue_number/assignees` | Yes | Remove assignees (`issueAssigneesSchema`) |
| `GET` | `.../assignees` | Yes | List users assignable to issues/PRs |
| `GET` | `.../issues/:issue_number/timeline` | Yes | Issue timeline events |
| `DELETE` | `.../collaborators/:username` | Yes | Remove a collaborator |

### Commit detail (`/api/repos/:owner/:repo/commits/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `.../commits/:sha` | Yes | Single commit (with files + stats) |
| `GET` | `.../commits/:sha/diff` | Yes | Raw diff for a single commit |

### Repository insights & CODEOWNERS (`/api/repos/:owner/:repo/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `.../commits/style` | Yes | Analyse commit-message conventions |
| `GET` | `.../pr-template` | Yes | Fetch the repo's PR template |
| `GET` | `.../codeowners` | Yes | Fetch the CODEOWNERS file |
| `GET` | `.../codeowners/suggest` | Yes | Suggest CODEOWNERS entries from history |
| `POST` | `.../community-health/generate` | Yes | Generate a community-health file (`communityHealthGenerateSchema`) |
| `POST` | `.../community-health/commit-fix` | Yes | Commit a community-health fix (`communityHealthCommitFixSchema`) |

### Repository tree / export / security / sync

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/repos/:owner/:repo/tree` | Yes | Full recursive git tree |
| `GET` | `/api/repos/:owner/:repo/export` | Yes | Export repository metadata as JSON |
| `GET` | `/api/repos/:owner/:repo/security` | Yes (Free — moved off Pro 2026-07-18) | Alerts + 10-check Security Posture report card — see [Security Posture](#security-posture) |
| `POST` | `/api/repos/:owner/:repo/security/summary` | AI | AI narrative summary of the report card — see [Security Posture](#security-posture) |
| `GET` | `/api/repos/:owner/:repo/sync/preview` | Yes | Preview a fork sync (free — no mutation) |
| `POST` | `/api/repos/:owner/:repo/sync` | Pro | Sync a fork with its upstream |

### AI developer toolkit (`/api/ai/*`)

All require `requireAuth` + `requireAI` and are body-validated.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/ai/review-summary` | AI | Summarise a PR review (`aiReviewSummarySchema`) |
| `POST` | `/api/ai/generate-commit` | AI | Generate a commit message (`aiGenerateCommitSchema`) |
| `POST` | `/api/ai/generate-pr` | AI | Generate PR title/body (`aiGeneratePrSchema`) |
| `POST` | `/api/ai/refine` | AI | Refine supplied text (`aiRefineSchema`) |
| `POST` | `/api/ai/analyze-context` | AI | Analyse staged/diff context (`aiAnalyzeContextSchema`) |
| `POST` | `/api/ai/chat-refine` | AI | Conversational refine turn (`aiChatRefineSchema`) |

### AI — other (`/api/ai/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/ai/attention-narrative` | AI | Narrative summary for the attention feed (`attentionNarrativeSchema`) |
| `POST` | `/api/ai/translate-search` | AI | Translate NL query → search filters (`aiTranslateSearchSchema`) |
| `GET` | `/api/ai/metadata` | Yes | List cached AI metadata across indexed repos |
| `POST` | `/api/ai/suggest-name-description` | Yes | Suggest repo name/description; deterministic fallback when AI is unavailable (`bodySchema`) |
| `POST` | `/api/ai/issue-to-plan` | AI | Convert an issue into a migration/task plan (`aiIssueToPlanSchema`) |
| `POST` | `/api/ai/migration-size-strategy` | AI | Recommend a size strategy for a migration |
| `POST` | `/api/ai/migration-description` | AI | Generate a migration description |
| `GET` | `/api/ai/attention-feed` | Yes | Pure-DB attention feed over tracked repos + migration ledger (free) |

### AI prompt overrides (`/api/ai/prompts/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/ai/prompts` | Yes | List the caller's saved prompt overrides |
| `PUT` | `/api/ai/prompts/:key` | Yes | Set a prompt override (`promptSchema`) |
| `DELETE` | `/api/ai/prompts/:key` | Yes | Clear a prompt override |

### Azure DevOps — enriched repo probes (`/api/azure/*`)

Rate-limited (`enrichedRepoLimiter`). Each accepts `{ org, project, ... , pat? }` and uses the server PAT when `pat` is omitted.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/azure/projects/create` | Yes | Create an Azure DevOps project |
| `POST` | `/api/azure/repos/activity` | Yes | Recent activity for an Azure repo |
| `POST` | `/api/azure/repos/lfs-check` | Yes | Detect Git LFS usage |
| `POST` | `/api/azure/repos/commit-activity` | Yes | Commit-activity histogram |
| `POST` | `/api/azure/repos/readme` | Yes | Fetch the repo README |
| `POST` | `/api/azure/repos/full-stats` | Yes | Aggregated repo statistics |

### Azure DevOps — credentials vault (`/api/azure/credentials/*`)

Encrypted Azure PAT storage; secrets are never returned (only prefix/metadata).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/azure/credentials` | Yes | List saved credentials (metadata only) |
| `POST` | `/api/azure/credentials` | Yes | Save an encrypted Azure PAT |
| `PATCH` | `/api/azure/credentials/:id` | Yes | Update a saved credential |
| `DELETE` | `/api/azure/credentials/:id` | Yes | Delete a saved credential |
| `POST` | `/api/azure/credentials/:id/test` | Yes | Test a saved credential against Azure |

### Azure DevOps — host allowlist (`/api/azure/host-allowlist*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/azure/host-allowlist` | Yes | List allowed Azure hosts |
| `POST` | `/api/azure/host-allowlist` | Admin | Add an allowed host pattern |
| `DELETE` | `/api/azure/host-allowlist/:pattern` | Admin | Remove an allowed host pattern |

### Import — TFVC in-place (`/api/import/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/import/azure-tfvc/in-place` | Yes | Convert a TFVC path to Git in place within Azure DevOps (`azureTfvcInPlaceSchema`) |

### User AI configuration (`/api/user/ai-config/*`)

BYOK provider configuration; encrypted credentials are never returned.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/user/ai-config` | Yes | Current AI provider config (no secrets) |
| `POST` | `/api/user/ai-config` | Yes | Save provider config (`userAIConfigSchema`) |
| `DELETE` | `/api/user/ai-config` | Yes | Clear AI provider config |
| `POST` | `/api/user/ai-config/test` | Yes | Test provider credentials (`testAIConfigSchema`; rate-limited) |

### Licensing (`/api/license/*`)

Self-hosted Pro/Enterprise license-key management.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/license` | No | Current license status |
| `POST` | `/api/license/validate` | No | Validate a license key (rate-limited) |
| `POST` | `/api/license/install` | Yes | Install a license key (rate-limited) |
| `DELETE` | `/api/license/install` | Admin | Uninstall the active license |

### Notifications & outbox

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/notifications/digest` | Yes | Notification digest for the user |
| `POST` | `/api/notifications/mark-seen` | Yes | Mark notifications as seen |
| `GET` | `/api/notifications/digest/settings` | Yes | Current opt-in digest e-mail frequency (`{ frequency: 'off'\|'daily'\|'weekly' }`) |
| `PATCH` | `/api/notifications/digest/settings` | Yes | Set the digest frequency. Body `{ frequency }`, one of `off`/`daily`/`weekly`; `400` on any other value |
| `GET` | `/api/notifications/digest/unsubscribe?token=...` | No | One-click unsubscribe from a digest e-mail link — sets `frequency` to `off`. Not behind `requireAuth`: the signed token (`server/lib/digest-unsubscribe-token.js`) is the only proof of identity, and it can only ever turn the setting off. Renders a minimal standalone HTML confirmation page, not JSON. |
| `GET` | `/api/outbox/pending` | Yes | Pending queued GitHub mutations (gh-outbox) for the user |

### Environment tooling (`/api/env/*`) — not under `/api/v1`

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/env/tooling` | Yes | Tool readiness + detected package managers (platform status) |
| `POST` | `/api/env/tooling/:id/install` | Admin | SSE-streamed assisted install of a tool (`403` when `envToolingInstallEnabled` is false; `404` for an unknown tool) |

### Admin — dead-letter queues (`/api/admin/dlq/*`)

Operator API, gated internally with `requireAuth` + `requireTier('enterprise')` + `requireAdmin`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/dlq/email` | Admin | List dead-lettered emails |
| `GET` | `/api/admin/dlq/email/:id` | Admin | Get one dead-lettered email |
| `POST` | `/api/admin/dlq/email/:id/retry` | Admin | Retry a dead-lettered email |
| `DELETE` | `/api/admin/dlq/email/:id` | Admin | Delete a dead-lettered email |
| `GET` | `/api/admin/dlq/webhook` | Admin | List dead-lettered webhooks |
| `GET` | `/api/admin/dlq/webhook/:id` | Admin | Get one dead-lettered webhook |
| `POST` | `/api/admin/dlq/webhook/:id/retry` | Admin | Retry a dead-lettered webhook |
| `DELETE` | `/api/admin/dlq/webhook/:id` | Admin | Delete a dead-lettered webhook (also `POST .../webhook/:id/delete`) |

### Admin — AI probe stats (`/api/admin/ai/*`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/ai/probe-stats` | Admin | AI-provider probe statistics |
| `POST` | `/api/admin/ai/probe-stats/reset` | Admin | Reset probe statistics |

### Work Board (`/api/v1/work-board/*`)

Tracking, actions, analytics (DORA), and the Work Board AI assistant are documented separately in [WORK-BOARD-API.md](./WORK-BOARD-API.md).

---

## Common Error Responses

All endpoints may return the following common error shapes:

**Authentication Error (401):**
```json
{
  "error": "Authentication required"
}
```

**Server Error (500):**
```json
{
  "error": "Request failed"
}
```

**Structured Error (with error code):**
```json
{
  "error": "Descriptive error message",
  "code": "ERROR_CODE"
}
```

**Multi-Status (207):** Returned by bulk operations when some items succeed and others fail.
