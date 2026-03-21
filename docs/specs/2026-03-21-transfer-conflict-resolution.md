# Transfer Conflict Resolution

## Context

When transferring repos between orgs/accounts, the target may already have a repo with the same name. Currently this fails silently with a GitHub 422 "Validation Failed" error and the user gets no actionable feedback. This spec adds pre-transfer conflict detection with inline comparison and resolution options so the user never loses data and always stays in control.

## Behavior

### Pre-check Flow

When the user selects a target org in the TransferModal:

1. Frontend calls `POST /api/transfer/check-conflicts` with the selected repos and target org
2. While checking, each repo row shows a subtle loading indicator (spinner replacing the arrow icon)
3. Results update each repo row:
   - **No conflict**: green check, normal preview (`→ target-org/repo-name`)
   - **Conflict**: amber warning icon, expandable comparison panel

### Conflict Comparison Panel

For each conflicting repo, an inline panel shows a side-by-side summary:

| Field | Source (origin) | Target (destination) |
|-------|-----------------|---------------------|
| Last updated | Jan 16, 2026 | Dec 01, 2025 |
| Default branch commits | 42 | 38 |
| Branches | 3 | 2 |
| Size | 2.4 MB | 2.1 MB |
| Language | JavaScript | JavaScript |
| Stars / Forks | 0 / 0 | 0 / 0 |

Below the table, a smart summary line: "Source is **newer** (+4 commits, updated 46 days later)" or "Repos appear **identical**" or "Target is **newer**".

### Resolution Options (per repo)

Each conflicting repo gets three action buttons:

- **Replace** (red/destructive) — Delete the target repo, then transfer source to its place. Shows confirmation: "This will permanently delete `target-org/repo-name` and replace it with your version."
- **Rename** — Transfer source with a different name. Auto-suggests `repo-name-2` with an editable input field.
- **Skip** (default) — Don't transfer this repo. Greyed out in the preview.

### Transfer Button State

The main Transfer button:
- **Disabled** while conflict check is loading
- **Disabled** if any conflicting repo has no resolution selected
- **Enabled** once all conflicts are resolved (Replace/Rename/Skip)
- Label updates to show count: "Transfer 3 repos (1 replace, 1 rename, 1 skip)"

## API

### `POST /api/transfer/check-conflicts`

**Request:**
```json
{
  "repos": ["brunobola/Auto-Claude", "brunobola/my-app"],
  "targetOrg": "brunobola-forks"
}
```

**Response:**
```json
{
  "conflicts": {
    "Auto-Claude": {
      "exists": true,
      "source": {
        "full_name": "brunobola/Auto-Claude",
        "updated_at": "2026-01-16T...",
        "size": 2400,
        "default_branch": "main",
        "stargazers_count": 0,
        "forks_count": 0,
        "language": "JavaScript",
        "description": "Autonomous multi-session AI coding"
      },
      "target": {
        "full_name": "brunobola-forks/Auto-Claude",
        "updated_at": "2025-12-01T...",
        "size": 2100,
        "default_branch": "main",
        "stargazers_count": 0,
        "forks_count": 0,
        "language": "JavaScript",
        "description": "Autonomous multi-session AI coding"
      }
    },
    "my-app": {
      "exists": false,
      "source": { ... }
    }
  }
}
```

Implementation: For each repo name, call `GET /repos/{targetOrg}/{repoName}`. If 200, fetch source metadata too. If 404, no conflict. Runs checks in parallel with `Promise.all`.

### `POST /api/transfer` (updated)

**Request** (extended):
```json
{
  "repos": ["brunobola/Auto-Claude", "brunobola/my-app"],
  "toOrg": "brunobola-forks",
  "strategies": {
    "brunobola/Auto-Claude": { "action": "replace" },
    "brunobola/my-app": { "action": "transfer" }
  }
}
```

**Strategy actions:**
- `"transfer"` — Normal transfer (no conflict or no strategy needed)
- `"replace"` — `DELETE /repos/{targetOrg}/{repoName}`, then transfer
- `"rename"` — Transfer with `{ new_owner, new_name }` in the GitHub API body
- `"skip"` — Excluded from processing, returned as `{ success: true, skipped: true }`

**Backward compatible**: If `strategies` is omitted, all repos use `"transfer"` (current behavior).

## Files to Modify

### Backend
- `server/routes/bulk.js` — New `/transfer/check-conflicts` endpoint; update `/transfer` to handle strategies
- `server/lib/validators.js` — New `checkConflictsSchema`; update `bulkTransferSchema` with optional `strategies`

### Frontend
- `src/components/TransferModal.jsx` — Conflict UI: loading states, comparison panels, resolution buttons, rename input
- `src/hooks/useRepos.js` — `performAction` passes strategies to backend
- `src/config.js` — New `API_ENDPOINTS.checkConflicts` entry
- `src/App.jsx` — Pass strategies from TransferModal through to performAction

## Safety

- **Skip is default** — No data is modified unless user explicitly chooses Replace or Rename
- **Replace confirmation** — Red destructive button with explicit warning text
- **Comparison first** — User sees metadata comparison before deciding
- **No silent failures** — Every conflict is surfaced with actionable options
- **Backward compatible** — Existing transfer calls without strategies continue to work

## Verification

1. Select repos and target org → conflict check fires automatically
2. Repos without conflicts show green check
3. Repos with conflicts show amber warning with expandable comparison
4. Replace shows destructive confirmation, executes delete+transfer
5. Rename shows input with auto-suggestion, transfers with new name
6. Skip greys out the repo, excludes from transfer
7. Transfer button label shows resolution summary
8. All unit tests pass
9. E2E: select repo with known conflict → resolve → verify transfer
