# Azure DevOps Smart Import — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Azure DevOps import from 6 steps to 2-4 by adding a smart URL parser, auto-PAT from server `.env`, and combined target+review step.

**Architecture:** New pure utility `azureUrlParser.js` handles all URL parsing. Backend azure routes gain env PAT fallback. ImportWizard gets a redesigned Azure flow with fewer steps. AzureImportModal is removed (duplicate).

**Tech Stack:** React 19, Express, Tailwind CSS v4, Framer Motion, Lucide icons, better-sqlite3

**Spec:** `docs/specs/2026-03-12-azure-smart-import-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/utils/azureUrlParser.js` | Create | Pure URL parser: `parseAzureUrl(input)` returns `{org, project, repo, error, suggestion}` |
| `src/utils/azureUrlParser.test.js` | Create | Unit tests for all 20+ URL formats |
| `server/azure-service.js` | Modify | Add `resolvePat(pat)` helper that falls back to `process.env.AZURE_PAT` |
| `server/routes/azure.js` | Modify | Add `GET /api/azure/env-auth`, make PAT optional in all 3 POST endpoints |
| `server/routes/import.js` | Modify | Make `azurePat` optional in `POST /api/import/azure`, use env fallback |
| `src/components/ImportWizard.jsx` | Modify | Replace azure-creds + azure-source + target + review with smart-url + repo-select(conditional) + target-confirm |
| `src/components/AzureImportModal.jsx` | Delete | Redundant — ImportWizard covers all Azure flows |
| `src/App.jsx` | Modify | Remove AzureImportModal import and rendering |
| `src/components/Sidebar.jsx` | Modify | Remove `onAzureImport` prop |
| `src/contexts/ModalContext.jsx` | Modify | Remove `showAzureImport` from modal names |

---

## Chunk 1: URL Parser Utility

### Task 1: Create `parseAzureUrl` with tests

**Files:**
- Create: `src/utils/azureUrlParser.js`
- Create: `src/utils/azureUrlParser.test.js`

- [ ] **Step 1: Create the test file with all URL format cases**

Create `src/utils/azureUrlParser.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseAzureUrl } from './azureUrlParser'

describe('parseAzureUrl', () => {
  // Standard dev.azure.com
  it('parses org/project URL', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs')
    expect(r).toEqual({ org: 'brunobola', project: 'BolaLabs', repo: null, error: null, suggestion: null })
  })

  it('parses org/project/_git/repo URL', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo')
    expect(r).toEqual({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo', error: null, suggestion: null })
  })

  it('parses org/_git/project (repo = project)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/_git/BolaLabs')
    expect(r).toEqual({ org: 'brunobola', project: 'BolaLabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  // URLs with query params, fragments, trailing slashes
  it('strips query params', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo?path=/src&version=GBmain')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBe('BolaLabs')
    expect(r.repo).toBe('MyRepo')
  })

  it('strips fragments', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs#readme')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBe('BolaLabs')
  })

  it('strips trailing slashes', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBe('BolaLabs')
  })

  // Subpages (user browsing Azure DevOps)
  it('parses _git/repo/pullrequests', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/pullrequests')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _git/repo/commits', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/commits')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _git/repo/branches', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/branches')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _git/repo/pullrequest/42', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_git/MyRepo/pullrequest/42')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses _boards page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_boards/board/t/Team/Stories')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _workitems page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_workitems/edit/123')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _build page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_build')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _releases page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_releases')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _wiki page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_wiki/wikis/MyRepo.wiki')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _settings page (no repo)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_settings/repositories')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses _apis/git/repositories URL (repo may be GUID)', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/BolaLabs/_apis/git/repositories/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // Clone URLs
  it('parses authenticated HTTPS clone URL (user@)', () => {
    const r = parseAzureUrl('https://brunobola@dev.azure.com/brunobola/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses SSH clone URL', () => {
    const r = parseAzureUrl('git@ssh.dev.azure.com:v3/brunobola/BolaLabs/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // Legacy visualstudio.com
  it('parses visualstudio.com project URL', () => {
    const r = parseAzureUrl('https://brunobola.visualstudio.com/BolaLabs')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses visualstudio.com repo URL', () => {
    const r = parseAzureUrl('https://brunobola.visualstudio.com/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses visualstudio.com with DefaultCollection', () => {
    const r = parseAzureUrl('https://brunobola.visualstudio.com/DefaultCollection/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  it('parses visualstudio.com clone URL with credentials', () => {
    const r = parseAzureUrl('https://brunobola@brunobola.visualstudio.com/BolaLabs/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // Shorthand
  it('parses org/project shorthand', () => {
    const r = parseAzureUrl('brunobola/BolaLabs')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: null })
  })

  it('parses org/project/repo shorthand', () => {
    const r = parseAzureUrl('brunobola/BolaLabs/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs', repo: 'MyRepo' })
  })

  // URL-encoded names
  it('decodes %20 in project name', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola/My%20Project/_git/MyRepo')
    expect(r).toMatchObject({ org: 'brunobola', project: 'My Project', repo: 'MyRepo' })
  })

  // Edge cases
  it('trims whitespace', () => {
    const r = parseAzureUrl('  https://dev.azure.com/brunobola/BolaLabs  ')
    expect(r).toMatchObject({ org: 'brunobola', project: 'BolaLabs' })
  })

  it('returns error for empty input', () => {
    const r = parseAzureUrl('')
    expect(r.error).toBeTruthy()
    expect(r.org).toBeNull()
  })

  it('returns error for null/undefined', () => {
    expect(parseAzureUrl(null).error).toBeTruthy()
    expect(parseAzureUrl(undefined).error).toBeTruthy()
  })

  // Non-Azure URL detection
  it('detects GitHub URL with suggestion', () => {
    const r = parseAzureUrl('https://github.com/user/repo')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/GitHub/)
  })

  it('detects GitLab URL with suggestion', () => {
    const r = parseAzureUrl('https://gitlab.com/user/repo')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/GitLab/)
  })

  it('detects Bitbucket URL with suggestion', () => {
    const r = parseAzureUrl('https://bitbucket.org/user/repo')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/Bitbucket/)
  })

  // On-premises TFS detection
  it('detects on-premises TFS URL', () => {
    const r = parseAzureUrl('https://tfs.company.com/tfs/DefaultCollection/MyProject')
    expect(r.error).toBeTruthy()
    expect(r.suggestion).toMatch(/on-premises/)
  })

  // Azure URL without project
  it('returns error for org-only URL', () => {
    const r = parseAzureUrl('https://dev.azure.com/brunobola')
    expect(r.org).toBe('brunobola')
    expect(r.project).toBeNull()
    expect(r.error).toBeTruthy()
  })

  // Unrecognizable
  it('returns error for random URL', () => {
    const r = parseAzureUrl('https://example.com/something')
    expect(r.error).toBeTruthy()
  })

  it('returns error for single word', () => {
    const r = parseAzureUrl('hello')
    expect(r.error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npx vitest run src/utils/azureUrlParser.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `parseAzureUrl`**

Create `src/utils/azureUrlParser.js`:

```js
/**
 * Parse any Azure DevOps URL format and extract org, project, and optionally repo.
 * Pure function — no side effects, no network calls.
 *
 * @param {string} input - URL or shorthand (e.g., "org/project")
 * @returns {{ org: string|null, project: string|null, repo: string|null, error: string|null, suggestion: string|null }}
 */
export function parseAzureUrl(input) {
  const empty = { org: null, project: null, repo: null, error: null, suggestion: null }

  if (!input || typeof input !== 'string') {
    return { ...empty, error: 'Paste an Azure DevOps URL to get started.' }
  }

  let url = input.trim()
  if (!url) return { ...empty, error: 'Paste an Azure DevOps URL to get started.' }

  // Detect non-Azure services before any processing
  const otherService = detectOtherService(url)
  if (otherService) return { ...empty, error: otherService.error, suggestion: otherService.suggestion }

  // Handle SSH clone URLs: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const sshMatch = url.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)\s*$/)
  if (sshMatch) {
    return {
      org: decodeURIComponent(sshMatch[1]),
      project: decodeURIComponent(sshMatch[2]),
      repo: decodeURIComponent(sshMatch[3]),
      error: null,
      suggestion: null
    }
  }

  // Shorthand: no protocol, no dots → org/project or org/project/repo
  if (!url.includes('://') && !url.includes('.')) {
    return parseShorthand(url)
  }

  // Pre-process URL
  url = preprocess(url)

  // Detect on-premises TFS (has /tfs/ in path but not dev.azure.com or visualstudio.com)
  if (isOnPremisesTfs(url)) {
    return {
      ...empty,
      error: 'Azure DevOps Server (on-premises) is not currently supported.',
      suggestion: 'This tool works with Azure DevOps Services (dev.azure.com).'
    }
  }

  // Try dev.azure.com
  const devResult = parseDevAzureCom(url)
  if (devResult) return devResult

  // Try visualstudio.com
  const vsResult = parseVisualStudioCom(url)
  if (vsResult) return vsResult

  return { ...empty, error: 'Could not identify as an Azure DevOps URL.', suggestion: 'Example: https://dev.azure.com/org/project' }
}

function preprocess(url) {
  // Remove fragment
  url = url.split('#')[0]
  // Remove query params
  url = url.split('?')[0]
  // Remove trailing slashes
  url = url.replace(/\/+$/, '')
  // Strip username@ prefix from URLs (e.g., user@dev.azure.com)
  url = url.replace(/^(https?:\/\/)[^@]+@/, '$1')
  return url
}

function detectOtherService(url) {
  const lower = url.toLowerCase()
  if (lower.includes('github.com')) {
    return { error: 'This looks like a GitHub URL.', suggestion: "Use the 'Git URL' option to import from GitHub." }
  }
  if (lower.includes('gitlab.com')) {
    return { error: 'This looks like a GitLab URL.', suggestion: "Use the 'Git URL' option to import from GitLab." }
  }
  if (lower.includes('bitbucket.org')) {
    return { error: 'This looks like a Bitbucket URL.', suggestion: "Use the 'Git URL' option to import from Bitbucket." }
  }
  return null
}

function isOnPremisesTfs(url) {
  const lower = url.toLowerCase()
  // Has /tfs/ in path and is NOT dev.azure.com or visualstudio.com
  return lower.includes('/tfs/') && !lower.includes('dev.azure.com') && !lower.includes('visualstudio.com')
}

function parseDevAzureCom(url) {
  const empty = { org: null, project: null, repo: null, error: null, suggestion: null }

  // Match https://dev.azure.com/{org}/...
  const match = url.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/?(.*)$/)
  if (!match) return null

  const org = decodeURIComponent(match[1])
  const rest = match[2]

  if (!rest) {
    return { org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const segments = rest.split('/').filter(Boolean)
  // Remove DefaultCollection if present
  if (segments[0]?.toLowerCase() === 'defaultcollection') segments.shift()

  // Pattern: _git/{repo} (repo = project, project segment omitted)
  if (segments[0] === '_git' && segments[1]) {
    const repoName = decodeURIComponent(segments[1])
    return { org, project: repoName, repo: repoName, error: null, suggestion: null }
  }

  // Pattern: {project}/...
  const project = decodeURIComponent(segments[0])
  const subSegments = segments.slice(1)

  // No further segments — just org/project
  if (subSegments.length === 0) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  // _git/{repo}/...
  if (subSegments[0] === '_git' && subSegments[1]) {
    const repo = decodeURIComponent(subSegments[1])
    return { org, project, repo, error: null, suggestion: null }
  }

  // _apis/git/repositories/{repo}
  if (subSegments[0] === '_apis' && subSegments[1] === 'git' && subSegments[2] === 'repositories' && subSegments[3]) {
    const repo = decodeURIComponent(subSegments[3])
    return { org, project, repo, error: null, suggestion: null }
  }

  // Any other _underscore page (_boards, _build, _workitems, _wiki, _releases, _settings, etc.)
  if (subSegments[0]?.startsWith('_')) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  // Unknown path after project — treat as project-only
  return { org, project, repo: null, error: null, suggestion: null }
}

function parseVisualStudioCom(url) {
  // Match https://{org}.visualstudio.com/...
  const match = url.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/?(.*)$/)
  if (!match) return null

  const org = decodeURIComponent(match[1])
  const rest = match[2]

  if (!rest) {
    return { org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  let segments = rest.split('/').filter(Boolean)
  // Remove DefaultCollection if present
  if (segments[0]?.toLowerCase() === 'defaultcollection') segments.shift()

  if (segments.length === 0) {
    return { org, project: null, repo: null, error: `URL recognized (org: ${org}) but no project found.`, suggestion: 'Paste a project or repository URL.' }
  }

  const project = decodeURIComponent(segments[0])
  const subSegments = segments.slice(1)

  if (subSegments.length === 0) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  if (subSegments[0] === '_git' && subSegments[1]) {
    const repo = decodeURIComponent(subSegments[1])
    return { org, project, repo, error: null, suggestion: null }
  }

  if (subSegments[0]?.startsWith('_')) {
    return { org, project, repo: null, error: null, suggestion: null }
  }

  return { org, project, repo: null, error: null, suggestion: null }
}

function parseShorthand(input) {
  const segments = input.split('/').filter(Boolean)

  if (segments.length === 2) {
    return {
      org: segments[0],
      project: segments[1],
      repo: null,
      error: null,
      suggestion: null
    }
  }

  if (segments.length === 3) {
    return {
      org: segments[0],
      project: segments[1],
      repo: segments[2],
      error: null,
      suggestion: null
    }
  }

  return { org: null, project: null, repo: null, error: 'Could not identify as an Azure DevOps URL.', suggestion: 'Example: https://dev.azure.com/org/project' }
}
```

- [ ] **Step 4: Run tests — confirm they all pass**

Run: `npx vitest run src/utils/azureUrlParser.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/azureUrlParser.js src/utils/azureUrlParser.test.js
git commit -m "feat(import): add Azure DevOps smart URL parser with tests"
```

---

## Chunk 2: Backend — Env PAT Fallback

### Task 2: Add `resolvePat` helper to azure-service.js

**Files:**
- Modify: `server/azure-service.js`

- [ ] **Step 1: Add `resolvePat` function**

At the top of `server/azure-service.js`, after the `API_VERSION` constant, add:

```js
/**
 * Resolve PAT: use provided value, or fall back to AZURE_PAT env var.
 * @param {string|undefined} pat - PAT from request body (may be undefined)
 * @returns {string|null}
 */
function resolvePat(pat) {
    return pat || process.env.AZURE_PAT || null;
}
```

- [ ] **Step 2: Export `resolvePat`**

Add `resolvePat` to the export block at the bottom:

```js
export {
    validatePat,
    listProjects,
    listRepos,
    getRepoDetails,
    listBranches,
    buildAuthenticatedCloneUrl,
    resolvePat
};
```

- [ ] **Step 3: Commit**

```bash
git add server/azure-service.js
git commit -m "feat(azure): add resolvePat helper for env PAT fallback"
```

### Task 3: Add `GET /api/azure/env-auth` and update existing routes

**Files:**
- Modify: `server/routes/azure.js`

- [ ] **Step 1: Add env-auth endpoint and update validate/projects/repos to use resolvePat**

Replace the full content of `server/routes/azure.js`:

```js
import express from 'express';
import * as azureService from '../azure-service.js';
import { requireAuth, safeError } from '../middleware/auth.js';

const router = express.Router();

// Check if server has AZURE_PAT configured (never returns the PAT itself)
router.get('/azure/env-auth', requireAuth, (req, res) => {
    res.json({ available: !!process.env.AZURE_PAT });
});

router.post('/azure/validate', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org) {
            return res.status(400).json({ error: 'Organization is required' });
        }
        if (!pat) {
            return res.status(400).json({ error: 'No PAT provided and no server PAT configured' });
        }
        const result = await azureService.validatePat(org, pat);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Azure validation failed') });
    }
});

router.post('/azure/projects', requireAuth, async (req, res) => {
    try {
        const { org, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org) {
            return res.status(400).json({ error: 'Organization is required' });
        }
        if (!pat) {
            return res.status(400).json({ error: 'No PAT provided and no server PAT configured' });
        }
        const projects = await azureService.listProjects(org, pat);
        res.json({ projects });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to list Azure projects') });
    }
});

router.post('/azure/repos', requireAuth, async (req, res) => {
    try {
        const { org, project, pat: bodyPat } = req.body;
        const pat = azureService.resolvePat(bodyPat);
        if (!org || !project) {
            return res.status(400).json({ error: 'Organization and project are required' });
        }
        if (!pat) {
            return res.status(400).json({ error: 'No PAT provided and no server PAT configured' });
        }
        const repos = await azureService.listRepos(org, project, pat);
        res.json({ repos });
    } catch (error) {
        res.status(error.status || 500).json({ error: safeError(error, 'Failed to list Azure repos') });
    }
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/azure.js
git commit -m "feat(azure): add env-auth endpoint and PAT fallback to all routes"
```

### Task 4: Update import route for optional azurePat

**Files:**
- Modify: `server/routes/import.js`

- [ ] **Step 1: Update the `POST /api/import/azure` validation and PAT resolution**

In `server/routes/import.js`, change the azure import handler. Replace lines 33-37:

Old:
```js
const { azureOrg, azureProject, azureRepo, azurePat, targetOrg, targetName, makePrivate, description } = req.body;

if (!azureOrg || !azureProject || !azureRepo || !azurePat) {
    return errorResponse(res, 400, 'Azure organization, project, repository, and PAT are required', 'MISSING_PARAMS');
}
```

New:
```js
const { azureOrg, azureProject, azureRepo, azurePat: bodyPat, targetOrg, targetName, makePrivate, description } = req.body;
const azurePat = azureService.resolvePat(bodyPat);

if (!azureOrg || !azureProject || !azureRepo) {
    return errorResponse(res, 400, 'Azure organization, project, and repository are required', 'MISSING_PARAMS');
}
if (!azurePat) {
    return errorResponse(res, 400, 'No PAT provided and no server PAT configured', 'MISSING_PAT');
}
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/import.js
git commit -m "feat(import): make azurePat optional with env fallback"
```

---

## Chunk 3: Frontend — Redesigned ImportWizard Azure Flow

### Task 5: Replace Azure flow in ImportWizard

**Files:**
- Modify: `src/components/ImportWizard.jsx`

This is the largest task. The changes are:
1. Replace `STEPS_AZURE` from 6 steps to 4: `['source-type', 'azure-smart', 'azure-repo', 'azure-confirm', 'progress']`
2. Replace the `azure-creds` step with `azure-smart` (URL input + conditional PAT)
3. Replace `azure-source` + `target` + `review` with `azure-repo` (conditional) + `azure-confirm` (combined target+review)
4. Add new state for: `azureUrl`, `azureParsed`, `envAuthAvailable`, `envAuthChecked`, `showManualPat`

- [ ] **Step 1: Update imports — add Eye, EyeOff icons**

In the lucide-react import line (line 6-8), add `Eye, EyeOff, Info` to the import list:

```js
import {
    GitBranch, Globe, Cloud, CheckCircle2, XCircle, Loader2,
    ArrowRight, ArrowLeft, ExternalLink, Lock, Unlock, Link2,
    KeyRound, User, AlertTriangle, Download, Eye, EyeOff, Info
} from 'lucide-react'
```

- [ ] **Step 2: Add `parseAzureUrl` import**

After the lucide import, add:

```js
import { parseAzureUrl } from '../utils/azureUrlParser'
```

- [ ] **Step 3: Replace `STEPS_AZURE` constant**

Change line 19:

Old: `const STEPS_AZURE = ['source-type', 'azure-creds', 'azure-source', 'target', 'review', 'progress']`

New: `const STEPS_AZURE = ['source-type', 'azure-smart', 'azure-repo', 'azure-confirm', 'progress']`

- [ ] **Step 4: Replace Azure state variables**

Replace lines 44-54 (old Azure state):

Old:
```js
// Azure source state
const [azureOrg, setAzureOrg] = useState('')
const [azurePat, setAzurePat] = useState('')
const [patStatus, setPatStatus] = useState(null)
const [patError, setPatError] = useState('')
const [projects, setProjects] = useState([])
const [selectedProject, setSelectedProject] = useState('')
const [repos, setRepos] = useState([])
const [selectedRepo, setSelectedRepo] = useState('')
const [loadingProjects, setLoadingProjects] = useState(false)
const [loadingRepos, setLoadingRepos] = useState(false)
```

New:
```js
// Azure smart import state
const [azureUrl, setAzureUrl] = useState('')
const [azureParsed, setAzureParsed] = useState({ org: null, project: null, repo: null, error: null, suggestion: null })
const [azureOrg, setAzureOrg] = useState('')
const [azurePat, setAzurePat] = useState('')
const [patStatus, setPatStatus] = useState(null) // null | 'validating' | 'valid' | 'invalid'
const [patError, setPatError] = useState('')
const [envAuthAvailable, setEnvAuthAvailable] = useState(null) // null | true | false
const [showManualPat, setShowManualPat] = useState(false)
const [showPatText, setShowPatText] = useState(false)
const [selectedProject, setSelectedProject] = useState('')
const [repos, setRepos] = useState([])
const [selectedRepo, setSelectedRepo] = useState('')
const [loadingRepos, setLoadingRepos] = useState(false)
const [validating, setValidating] = useState(false)
```

- [ ] **Step 5: Update reset-on-close effect**

In the `useEffect` that resets on close (around line 84-112), replace the Azure state resets:

Old resets to remove: `setAzureOrg('')`, `setAzurePat('')`, `setPatStatus(null)`, `setPatError('')`, `setProjects([])`, `setSelectedProject('')`, `setRepos([])`, `setSelectedRepo('')`

New resets to add:
```js
setAzureUrl('')
setAzureParsed({ org: null, project: null, repo: null, error: null, suggestion: null })
setAzureOrg('')
setAzurePat('')
setPatStatus(null)
setPatError('')
setEnvAuthAvailable(null)
setShowManualPat(false)
setShowPatText(false)
setSelectedProject('')
setRepos([])
setSelectedRepo('')
setLoadingRepos(false)
setValidating(false)
```

- [ ] **Step 6: Add check-env-auth effect**

After the git-availability effect, add:

```js
// Check if server has AZURE_PAT configured
useEffect(() => {
    if (isOpen && envAuthAvailable === null) {
        fetch('/api/azure/env-auth', { credentials: 'include' })
            .then(r => r.json())
            .then(data => setEnvAuthAvailable(data.available))
            .catch(() => setEnvAuthAvailable(false))
    }
}, [isOpen, envAuthAvailable])
```

- [ ] **Step 7: Add URL change handler**

After the env-auth effect:

```js
// Parse Azure URL on change
useEffect(() => {
    const parsed = parseAzureUrl(azureUrl)
    setAzureParsed(parsed)
    if (parsed.org) setAzureOrg(parsed.org)
    if (parsed.project) setSelectedProject(parsed.project)
}, [azureUrl])
```

- [ ] **Step 8: Replace `fetchProjects` and `validateAzurePat` with unified `connectAzure`**

Remove the old `fetchProjects` useCallback (lines 115-126) and `validateAzurePat` function (lines 200-222). Replace with:

```js
const connectAzure = async () => {
    const { org, project, repo } = azureParsed
    if (!org) return

    setValidating(true)
    setPatStatus('validating')
    setPatError('')

    try {
        // Build PAT payload — omit if using env auth
        const patPayload = showManualPat || !envAuthAvailable ? azurePat : undefined

        // Validate PAT
        const valRes = await fetch('/api/azure/validate', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ org, pat: patPayload })
        })
        const valData = await valRes.json()

        if (!valData.valid) {
            setPatStatus('invalid')
            setPatError(valData.error || 'Invalid credentials')
            // If env auth failed, show manual PAT field
            if (envAuthAvailable && !showManualPat) setShowManualPat(true)
            setValidating(false)
            return
        }

        setPatStatus('valid')

        // If we have a specific repo from URL, skip to confirm
        if (repo) {
            // Fetch repos to get metadata (size, default branch) for the specific repo
            const reposRes = await fetch('/api/azure/repos', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org, project, pat: patPayload })
            })
            const reposData = await reposRes.json()
            if (reposRes.ok) {
                setRepos(reposData.repos || [])
                const found = (reposData.repos || []).find(r => r.name.toLowerCase() === repo.toLowerCase())
                if (found) {
                    setSelectedRepo(found.name)
                    if (!targetName) setTargetName(found.name)
                }
            }
            setValidating(false)
            // Skip to confirm step
            const steps = getSteps('azure')
            setStep(steps.indexOf('azure-confirm'))
            return
        }

        // Project-level: fetch repos
        setLoadingRepos(true)
        const reposRes = await fetch('/api/azure/repos', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ org, project, pat: patPayload })
        })
        const reposData = await reposRes.json()
        if (reposRes.ok) {
            const repoList = reposData.repos || []
            setRepos(repoList)
            // Auto-select if only 1 repo
            if (repoList.length === 1 && !repoList[0].isDisabled) {
                setSelectedRepo(repoList[0].name)
                if (!targetName) setTargetName(repoList[0].name)
                setLoadingRepos(false)
                setValidating(false)
                const steps = getSteps('azure')
                setStep(steps.indexOf('azure-confirm'))
                return
            }
        }
        setLoadingRepos(false)
        setValidating(false)
        // Go to repo selection step
        const steps = getSteps('azure')
        setStep(steps.indexOf('azure-repo'))
    } catch (e) {
        setPatStatus('invalid')
        setPatError('Could not reach Azure DevOps. Check your connection.')
        setValidating(false)
    }
}
```

- [ ] **Step 9: Remove old `fetchRepos` useEffect (lines 129-147)**

Delete the `useEffect` that auto-fetches repos when `selectedProject` changes — the new `connectAzure` handles this.

- [ ] **Step 10: Update `startImport` — omit PAT from body when using env auth**

In the `startImport` function, change the azure body:

Old:
```js
body = {
    azureOrg,
    azureProject: selectedProject,
    azureRepo: selectedRepo,
    azurePat,
    ...
}
```

New:
```js
body = {
    azureOrg,
    azureProject: selectedProject,
    azureRepo: selectedRepo,
    azurePat: showManualPat || !envAuthAvailable ? azurePat : undefined,
    targetOrg: targetOrg || undefined,
    targetName: targetName || selectedRepo,
    makePrivate,
    description
}
```

- [ ] **Step 11: Replace the `azure-creds` JSX with `azure-smart` step**

Remove the entire `{currentStep === 'azure-creds' && (...)}` block (lines 458-497). Replace with:

```jsx
{/* Azure Smart URL Step */}
{currentStep === 'azure-smart' && (
    <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">Paste any Azure DevOps URL — project page, repo, clone URL, or shorthand.</p>

        {/* URL Input */}
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Azure DevOps URL *</label>
            <div className="relative">
                <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={azureUrl} onChange={e => setAzureUrl(e.target.value)}
                    placeholder="https://dev.azure.com/org/project"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
            </div>
        </div>

        {/* Parse Feedback */}
        {azureUrl && (
            <div className="space-y-1 text-xs">
                {azureParsed.org && (
                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Organization: <strong>{azureParsed.org}</strong></span>
                    </div>
                )}
                {azureParsed.project && (
                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Project: <strong>{azureParsed.project}</strong></span>
                    </div>
                )}
                {azureParsed.repo && (
                    <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Repository: <strong>{azureParsed.repo}</strong></span>
                    </div>
                )}
                {azureParsed.error && (
                    <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <div>
                            <span>{azureParsed.error}</span>
                            {azureParsed.suggestion && <p className="text-slate-500 dark:text-slate-400 mt-0.5">{azureParsed.suggestion}</p>}
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* PAT Section */}
        {azureParsed.org && !azureParsed.error && (
            <>
                {envAuthAvailable && !showManualPat ? (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                        <KeyRound className="w-4 h-4 shrink-0" />
                        <span>Authenticated via server configuration</span>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                            Personal Access Token *
                        </label>
                        <div className="relative">
                            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type={showPatText ? 'text' : 'password'}
                                value={azurePat}
                                onChange={e => { setAzurePat(e.target.value); setPatStatus(null) }}
                                placeholder="Paste your Personal Access Token"
                                className="w-full pl-9 pr-10 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPatText(!showPatText)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                            >
                                {showPatText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span>Scope: Code (Read)</span>
                            <a href={`https://dev.azure.com/${encodeURIComponent(azureParsed.org)}/_usersSettings/tokens`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-indigo-500 hover:text-indigo-400 flex items-center gap-1">
                                Create PAT <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    </div>
                )}
            </>
        )}

        {/* Validation status */}
        {patStatus === 'invalid' && (
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{patError}</span>
            </div>
        )}

        <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => { setStep(0); setSourceType('') }} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button
                onClick={connectAzure}
                disabled={!azureParsed.org || !azureParsed.project || azureParsed.error !== null || validating || (!envAuthAvailable && !azurePat) || (showManualPat && !azurePat)}
                className="flex-1"
            >
                {validating ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Connecting...</> : <>Continue <ArrowRight className="w-4 h-4 ml-1" /></>}
            </Button>
        </div>
    </div>
)}
```

- [ ] **Step 12: Replace the `azure-source` + `target` + `review` steps with `azure-repo` and `azure-confirm`**

Remove the entire `{currentStep === 'azure-source' && (...)}` block (lines 500-536).

Add the new `azure-repo` step (conditional repo selection):

```jsx
{/* Azure Repo Selection (conditional — only when URL was project-level) */}
{currentStep === 'azure-repo' && (
    <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
            Select a repository from <strong>{azureParsed.org}/{selectedProject}</strong>
        </p>

        {loadingRepos ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading repositories...
            </div>
        ) : repos.length === 0 ? (
            <div className="text-center py-6">
                <p className="text-sm text-slate-500 dark:text-slate-400">This project has no repositories.</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Check that your PAT has the correct permissions.</p>
            </div>
        ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {repos.map(repo => (
                    <button
                        key={repo.id}
                        disabled={repo.isDisabled}
                        onClick={() => { setSelectedRepo(repo.name); if (!targetName) setTargetName(repo.name) }}
                        className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all text-sm
                            ${repo.isDisabled
                                ? 'opacity-50 cursor-not-allowed border-slate-200 dark:border-slate-700'
                                : selectedRepo === repo.name
                                    ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                                    : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                    >
                        <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                                {repo.name}
                                {repo.isDisabled && <span className="text-xs px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-500 rounded">Disabled</span>}
                                {!repo.isDisabled && repo.size === 0 && <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded">Empty</span>}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                {(repo.size / 1024).toFixed(1)} MB
                                {repo.defaultBranch && ` · ${repo.defaultBranch.replace('refs/heads/', '')}`}
                            </div>
                        </div>
                        {selectedRepo === repo.name && <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />}
                    </button>
                ))}
            </div>
        )}

        <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => { const steps = getSteps('azure'); setStep(steps.indexOf('azure-smart')) }} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button onClick={() => { const steps = getSteps('azure'); setStep(steps.indexOf('azure-confirm')) }} disabled={!selectedRepo} className="flex-1">
                Next <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
        </div>
    </div>
)}
```

Add the combined `azure-confirm` step (target + review in one):

```jsx
{/* Azure Confirm (combined target + review) */}
{currentStep === 'azure-confirm' && (
    <div className="space-y-4">
        {/* Source summary */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400">Source</div>
                <button onClick={() => { const steps = getSteps('azure'); setStep(steps.indexOf('azure-smart')) }}
                    className="text-xs text-indigo-500 hover:text-indigo-400">Change</button>
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                Azure DevOps · {azureOrg}/{selectedProject}/{selectedRepo}
            </div>
            {(() => {
                const repoObj = repos.find(r => r.name === selectedRepo)
                if (!repoObj) return null
                return (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-3">
                        {repoObj.size > 0 && <span>{(repoObj.size / 1024).toFixed(1)} MB</span>}
                        {repoObj.defaultBranch && <span>{repoObj.defaultBranch.replace('refs/heads/', '')}</span>}
                        {repoObj.size > 512000 && (
                            <span className="text-amber-500 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Large repo — import may take a while
                            </span>
                        )}
                    </div>
                )
            })()}
        </div>

        {/* Target config */}
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">GitHub Owner</label>
            <Select value={targetOrg} onChange={setTargetOrg}
                options={[{ value: '', label: 'My personal account' }, ...(orgs?.map(o => ({ value: o.login, label: o.login })) || [])]} />
        </div>
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repository Name</label>
            <input type="text" value={targetName} onChange={e => setTargetName(e.target.value)}
                placeholder="my-imported-repo"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
        </div>
        <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Description (optional)</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder={`Imported from Azure DevOps: ${azureOrg}/${selectedProject}/${selectedRepo}`}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={makePrivate} onChange={e => setMakePrivate(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-indigo-600 focus:ring-indigo-500" />
            <span className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-1">
                {makePrivate ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                {makePrivate ? 'Private' : 'Public'} repository
            </span>
        </label>

        {/* Info note */}
        <div className="flex items-start gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Imports Git code and history. Issues, PRs, and pipelines are not migrated.</span>
        </div>

        <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setStep(step - 1)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button onClick={startImport} disabled={importing || gitAvailable === false || !targetName} className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500">
                {importing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Starting...</> : 'Import'}
            </Button>
        </div>
    </div>
)}
```

- [ ] **Step 13: Fix Retry button in progress step for Azure flows**

In the progress step JSX, the Retry button (around line 691) navigates to `steps.indexOf('review')`. Since Azure flows no longer have a `'review'` step, this returns `-1` and breaks. Update:

Old:
```js
setStep(steps.indexOf('review'))
```

New:
```js
setStep(steps.indexOf(sourceType === 'azure' ? 'azure-confirm' : 'review'))
```

- [ ] **Step 14: For non-Azure flows, the existing `target` and `review` steps remain unchanged**

The `target` and `review` steps only render for URL and GitHub flows — no changes needed there.

- [ ] **Step 15: Add loading state for env-auth check in PAT section**

In the `azure-smart` step JSX, wrap the PAT section in a loading guard. Replace:

```jsx
{azureParsed.org && !azureParsed.error && (
```

With:

```jsx
{azureParsed.org && !azureParsed.error && envAuthAvailable !== null && (
```

This prevents a brief flash of the manual PAT field while the env-auth check is still loading.

- [ ] **Step 14: Commit**

```bash
git add src/components/ImportWizard.jsx
git commit -m "feat(import): redesign Azure flow with smart URL parser and combined confirm step"
```

---

## Chunk 4: Cleanup — Remove AzureImportModal

### Task 6: Remove AzureImportModal and all references

**Files:**
- Delete: `src/components/AzureImportModal.jsx`
- Modify: `src/App.jsx` (lines 26, 392, 552-555)
- Modify: `src/components/Sidebar.jsx` (line 52)
- Modify: `src/contexts/ModalContext.jsx` (line 23)

- [ ] **Step 1: Delete AzureImportModal.jsx**

```bash
git rm src/components/AzureImportModal.jsx
```

- [ ] **Step 2: Remove from App.jsx**

Remove these 3 references in `src/App.jsx`:
1. Line 26: `const AzureImportModal = lazy(...)` — delete entire line
2. Line 392: `onAzureImport={() => openModal('showAzureImport')}` — delete this prop from Sidebar
3. Lines 551-557: Delete the entire `<Suspense fallback={null}><AzureImportModal ... /></Suspense>` block

- [ ] **Step 3: Remove from Sidebar.jsx**

In `src/components/Sidebar.jsx`, remove these 3 references:
1. Line 52: `onAzureImport={() => openModal('showAzureImport')}` — prop passed to QuickActions
2. Line 71: Remove `onAzureImport` from the `QuickActions` destructured parameters
3. Lines 136-165: Delete the entire `<motion.button onClick={onAzureImport} ...>` block (the "Azure DevOps Quick import wizard" button). The "Import Repository" button at lines 106-135 already covers Azure via the unified ImportWizard.

- [ ] **Step 4: Remove from ModalContext.jsx**

In `src/contexts/ModalContext.jsx`, remove `'showAzureImport'` from the modal names array (line 23).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(import): remove deprecated AzureImportModal"
```

---

## Chunk 5: Final Verification

### Task 7: End-to-end verification

- [ ] **Step 1: Run unit tests**

```bash
npx vitest run src/utils/azureUrlParser.test.js
```

Expected: All tests pass

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Expected: No new errors

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 4: Manual smoke test (if dev server available)**

Start the app with `npm run dev:all` and verify:
1. Click "Import" in sidebar → Import Wizard opens
2. Select "Azure DevOps" → Smart URL step appears
3. Paste `https://dev.azure.com/brunobola/BolaLabs` → parse feedback shows org + project
4. If `AZURE_PAT` is in `.env`: "Authenticated via server configuration" appears
5. Click Continue → repo list or confirm step appears
6. The old "Azure Import" dedicated button is gone from sidebar

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix(import): address smoke test findings"
```

---

## Update docs/index.md

After all implementation is complete, update the Azure spec status in `docs/index.md` from "Approved" to "Implemented".
