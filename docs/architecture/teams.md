# Teams Architecture

Last Updated: 2026-04-03

## Overview

Teams in GitHub Repo Manager are **local groupings** managed in SQLite. All GitHub-related
operations (activity feeds, collaborator management, Actions workflows) go through the
GitHub REST API. Azure DevOps is used exclusively for repository migration and is not
involved in day-to-day team management.

---

## Frontend Components

All team UI lives in `src/components/Teams/`.

### TeamHub (`src/components/Teams/TeamHub.jsx`)

Top-level list and management view for teams.

- Create, edit, and delete teams.
- Displays member count and repository count per team.
- Clicking a team card navigates to the detail view.

### TeamDetails (`src/components/Teams/TeamDetails.jsx`)

Detail view for a single team with four tabs:

| Tab | Icon | Description |
| --- | ---- | ----------- |
| **Activity** | Activity | Aggregated GitHub event stream across all assigned repos. |
| **Members** | Users | Invite members by GitHub username, update roles, remove members. |
| **Repos** | Github | Assign repositories from the user's GitHub account to the team. |
| **Actions** | Zap | View GitHub Actions workflows and runs for assigned repos. |

Permissions are enforced per role: owners and admins can manage members and repos;
regular members have read-only access.

### ActivityTab (`src/components/Teams/ActivityTab.jsx`)

Renders the activity feed for a team. Fetches events from `GET /api/teams/:id/activity`.
Supports `MOCK_MODE` for local development when the backend is unavailable.

---

## API Endpoints

All team routes are defined in `server/routes/teams.js` and mounted at `/api/teams`.
Requests require an authenticated session (`requireAuth` middleware). Input is validated
with schemas from `server/lib/validators.js`.

### Team CRUD

| Method | Path | Description | Permission |
| ------ | ---- | ----------- | ---------- |
| `GET` | `/api/teams` | List teams the authenticated user belongs to | Member |
| `POST` | `/api/teams` | Create a new team (creator becomes owner) | Authenticated |
| `GET` | `/api/teams/:id` | Get team details including members and assigned repos | Member |
| `PUT` | `/api/teams/:id` | Update team name and description | Owner / Admin |
| `DELETE` | `/api/teams/:id` | Delete team and all associated data | Owner only |

### Members

| Method | Path | Description | Permission |
| ------ | ---- | ----------- | ---------- |
| `POST` | `/api/teams/:id/members` | Add a member by GitHub username (fetches from GitHub API if not cached locally) | Owner / Admin |
| `PUT` | `/api/teams/:id/members/:userId` | Update member role (`admin` or `member`) | Owner / Admin |
| `DELETE` | `/api/teams/:id/members/:userId` | Remove a member (cannot remove the owner) | Owner / Admin |

### Repository Assignments

| Method | Path | Description | Permission |
| ------ | ---- | ----------- | ---------- |
| `POST` | `/api/teams/:id/repos` | Assign a GitHub repository to the team | Owner / Admin |

---

## Database Schema

Schema is defined in `server/db.js` (`initDB()`). All team-related tables use foreign
keys with `ON DELETE CASCADE` where appropriate.

### `users`

Caches GitHub user profiles retrieved via the GitHub API.

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,          -- GitHub user ID
    username TEXT NOT NULL,
    avatar_url TEXT,
    email TEXT,
    last_login TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

### `teams`

Local team definitions owned by a user.

```sql
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
)
```

### `team_members`

Many-to-many relationship between teams and users with a role.

```sql
CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT CHECK(role IN ('owner', 'admin', 'member')) DEFAULT 'member',
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

### `repo_assignments`

Associates GitHub repositories with teams.

```sql
CREATE TABLE IF NOT EXISTS repo_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    repo_full_name TEXT NOT NULL,    -- e.g. "owner/repo"
    repo_id INTEGER NOT NULL,        -- GitHub Repo ID
    assigned_by INTEGER NOT NULL,
    assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id)
)
```

### `workflow_runs` / `workflows_meta`

Used by the Actions tab to cache GitHub Actions data locally for statistics. Defined in
`server/db.js` alongside the tables above; see the full schema there.

---

## Data Flows

### Activity Feed

```
User opens Activity tab
  -> TeamDetails fetches GET /api/teams/:id/activity
    -> Backend looks up repos assigned to the team (repo_assignments)
      -> For each repo: GET /repos/{owner}/{repo}/events (GitHub API)
        -> Aggregates, deduplicates, sorts by date
          -> Returns unified event list
```

### Adding a Member

```
User searches for a GitHub username
  -> POST /api/teams/:id/members { username }
    -> Backend checks local users table
      -> If not found: GET /users/{username} (GitHub API) and caches the result
        -> Inserts into team_members with role 'member'
          -> Audit log entry created
```

### Assigning a Repository

```
User selects a repo from their GitHub account
  -> POST /api/teams/:id/repos { repoFullName, repoId }
    -> Backend validates membership and admin/owner role
      -> Inserts into repo_assignments
        -> Team can now manage collaborators for this repo via GitHub API
```

### Managing Collaborators

```
User expands a repo in the Repos tab
  -> GET /api/repos/{owner}/{repo}/collaborators (GitHub API)
    -> Shows current collaborators
      -> User clicks "Add" for a team member
        -> PUT /api/repos/{owner}/{repo}/collaborators/{username} (GitHub API)
          -> GitHub sends invitation
```

---

## Audit Logging

Team operations (create, delete, member add, member remove) are recorded via
`auditLog()` from `server/lib/audit.js`. Actions are written to the `audit_log_v2`
table (hash-chained, append-only) with the acting user's ID, action, resource type,
resource id, and details as JSON.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `server/routes/teams.js` | All team API route handlers |
| `server/db.js` | Database schema including team tables |
| `server/lib/validators.js` | Request validation schemas (`teamCreateSchema`, `teamMemberSchema`, `teamRepoSchema`) |
| `server/lib/audit.js` | Audit logging helper |
| `server/lib/github-api.js` | GitHub API client used for user lookup |
| `server/middleware/auth.js` | `requireAuth`, `safeError`, `errorResponse` |
| `src/components/Teams/TeamHub.jsx` | Team list and CRUD UI |
| `src/components/Teams/TeamDetails.jsx` | Team detail view with tabs |
| `src/components/Teams/ActivityTab.jsx` | Activity feed component |
