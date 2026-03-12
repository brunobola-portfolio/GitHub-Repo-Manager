# GitHub Repo Manager - API Reference

**Base URL:** `http://localhost:3001/api`
**Authentication:** GitHub OAuth via session cookies. Most endpoints require an authenticated session (`requireAuth` middleware). The server never exposes raw access tokens to the client.
**Total Endpoints:** 106

---

## Table of Contents

- [Authentication](#authentication-apiauthx)
- [User](#user-apiuserx)
- [Repositories](#repositories-apireposx)
- [Organizations](#organizations-apiorgsx)
- [Teams](#teams-apiteamsx)
- [AI](#ai-apiaix)
- [Bulk Operations](#bulk-operations-apix)
- [Import](#import-apiimportx)
- [Azure DevOps](#azure-devops-apiazurex)
- [Webhooks](#webhooks-apiwebhooksx)
- [Statistics](#statistics-apistatsx)
- [System](#system-apisystemx)

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

**Request Body:**

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | string | Required | New branch name |
| `source_branch` | string | `"main"` | Branch to create from |

**Response (200):**
```json
{
  "success": true,
  "ref": { ... }
}
```

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

All AI endpoints require both authentication and a configured Gemini API key (`requireAI` middleware), unless noted otherwise.

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
- `401` (`INVALID_API_KEY`) - Invalid Gemini API key
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
- `401` (`INVALID_API_KEY`) - Invalid Gemini API key
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

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | Yes | Search query |

**Response (200):** Array of search results with scores and metadata.

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

## Bulk Operations (`/api/*`)

All bulk operations process repositories sequentially and return multi-status responses (HTTP 207) when some operations succeed and others fail.

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
| `X-Cache-TTL` | `5` | Cache TTL in minutes |

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
| Auth required | Yes |

**Response (200):**
```json
{
  "success": true
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
