# Assistant Paste-URL Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user paste an Azure DevOps or GitHub URL directly into the AI Assistant chat. The chat detects the URL, asks for up to two missing pieces of information (target GitHub org, optional rename), and then opens the Migration Wizard with source + target pre-filled — equivalent to clicking the existing "Preencher" button in the wizard.

**Architecture:** 100% client-side. A new pure-function URL dispatcher (`detectRepoUrl`) wraps the existing `parseAzureUrl` and a new `parseGitHubUrl`. A new `PasteDialogCard` component inside the AI Assistant renders a templated, dynamic dialog driven by missing fields. When ready, it calls `openModalWithData('showMigrationWizard', { initialSource, initialStep })` — the Migration Wizard is extended to accept seeded source state and an initial step name. The backend `/api/ai/chat` endpoint is **not** modified.

**Tech Stack:** React 19, Vite 7, Vitest 4 + React Testing Library, Framer Motion 12, Playwright (E2E). No new dependencies.

**Spec:** [docs/specs/2026-04-18-assistant-paste-url-dialog.md](../specs/2026-04-18-assistant-paste-url-dialog.md)

---

## File Layout

### New files

| Path | Purpose |
|---|---|
| `src/utils/githubUrlParser.js` | Parse GitHub URL variants → `{ owner, repo, error, suggestion }` |
| `src/utils/repoUrlDetector.js` | Dispatcher that picks Azure vs GitHub and normalises the shape |
| `src/components/AIAssistantPasteDialog.jsx` | In-chat card: preview + dynamic question + final action button |
| `tests/utils/githubUrlParser.test.js` | Unit tests for the GitHub parser |
| `tests/utils/repoUrlDetector.test.js` | Unit tests for the dispatcher |
| `tests/components/AIAssistantPasteDialog.test.jsx` | Component tests |
| `e2e/assistant-paste-url.spec.js` | End-to-end happy path |

### Modified files

| Path | Change |
|---|---|
| `src/hooks/useMigrationWizard.js` | Accept `initialSource`, `initialRepos`, `initialStep` options and seed state |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Forward props from App to the hook |
| `src/App.jsx:1014` | Read the new fields from modal data |
| `src/components/AIAssistant.jsx` | Intercept URL in `handleSubmit`, manage `pasteDialog` state, render `AIAssistantPasteDialog` |
| `tests/hooks/useMigrationWizard.test.jsx` | New cases covering the seeded options |
| `tests/components/AIAssistant.test.jsx` | New cases covering the paste-URL interception |

---

## Task 1 — GitHub URL Parser

**Files:**
- Create: `src/utils/githubUrlParser.js`
- Create: `tests/utils/githubUrlParser.test.js`

- [ ] **Step 1: Write the failing test file.**

Create `tests/utils/githubUrlParser.test.js` with the complete content:

```jsx
import { describe, it, expect } from 'vitest'
import { parseGitHubUrl } from '@/utils/githubUrlParser'

describe('parseGitHubUrl', () => {
  it('parses https://github.com/owner/repo', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs'))
      .toEqual({ owner: 'bolalabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  it('parses https URL with .git suffix', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs.git'))
      .toEqual({ owner: 'bolalabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  it('parses SSH clone URL', () => {
    expect(parseGitHubUrl('git@github.com:bolalabs/BolaLabs.git'))
      .toEqual({ owner: 'bolalabs', repo: 'BolaLabs', error: null, suggestion: null })
  })

  it('strips /tree/<branch> subpaths', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs/tree/main'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('strips /pull/<n>, /issues, /blob/<path> subpaths', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs/pull/42'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs/blob/main/README.md'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('strips query params and fragments', () => {
    expect(parseGitHubUrl('https://github.com/bolalabs/BolaLabs?tab=readme#foo'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('accepts http:// as well as https://', () => {
    expect(parseGitHubUrl('http://github.com/bolalabs/BolaLabs'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('is case-insensitive on the host', () => {
    expect(parseGitHubUrl('https://GitHub.com/bolalabs/BolaLabs'))
      .toMatchObject({ owner: 'bolalabs', repo: 'BolaLabs' })
  })

  it('returns an error when the owner is missing', () => {
    const r = parseGitHubUrl('https://github.com/')
    expect(r.owner).toBeNull()
    expect(r.repo).toBeNull()
    expect(r.error).toMatch(/owner/i)
  })

  it('returns an error when the repo is missing (owner only)', () => {
    const r = parseGitHubUrl('https://github.com/bolalabs')
    expect(r.owner).toBe('bolalabs')
    expect(r.repo).toBeNull()
    expect(r.error).toMatch(/repo/i)
  })

  it('returns a typed error for non-GitHub URLs', () => {
    const r = parseGitHubUrl('https://dev.azure.com/bruno/AWIP')
    expect(r.error).toMatch(/not a github/i)
    expect(r.owner).toBeNull()
  })

  it('returns a typed error for empty input', () => {
    expect(parseGitHubUrl('')).toEqual({
      owner: null, repo: null,
      error: 'Paste a GitHub repository URL to get started.',
      suggestion: null,
    })
  })

  it('returns a typed error for null input', () => {
    expect(parseGitHubUrl(null).error).toMatch(/paste/i)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `npx vitest run tests/utils/githubUrlParser.test.js`

Expected: all tests fail with `Cannot find module '@/utils/githubUrlParser'` or similar.

- [ ] **Step 3: Implement the parser.**

Create `src/utils/githubUrlParser.js` with the complete content:

```js
/**
 * Parse a GitHub repository URL and extract { owner, repo }.
 * Pure function — no side effects, no network calls.
 *
 * Supported shapes:
 *   - https://github.com/{owner}/{repo}
 *   - https://github.com/{owner}/{repo}.git
 *   - https://github.com/{owner}/{repo}/tree/{branch}
 *   - https://github.com/{owner}/{repo}/blob/{branch}/{path}
 *   - https://github.com/{owner}/{repo}/pull/{n}
 *   - https://github.com/{owner}/{repo}/issues
 *   - git@github.com:{owner}/{repo}.git
 *
 * @param {string} input
 * @returns {{ owner: string|null, repo: string|null, error: string|null, suggestion: string|null }}
 */
export function parseGitHubUrl(input) {
  const empty = { owner: null, repo: null, error: null, suggestion: null }

  if (!input || typeof input !== 'string') {
    return { ...empty, error: 'Paste a GitHub repository URL to get started.' }
  }

  let url = input.trim()
  if (!url) return { ...empty, error: 'Paste a GitHub repository URL to get started.' }

  // SSH clone form: git@github.com:{owner}/{repo}.git
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?\s*$/i)
  if (sshMatch) {
    return {
      owner: decodeURIComponent(sshMatch[1]).trim(),
      repo: decodeURIComponent(sshMatch[2]).trim(),
      error: null,
      suggestion: null,
    }
  }

  // Strip query string, fragment, trailing slashes
  url = url.split('#')[0].split('?')[0].replace(/\/+$/, '')

  // Lowercase host matching
  const httpsMatch = url.match(/^https?:\/\/github\.com\/?(.*)$/i)
  if (!httpsMatch) {
    return { ...empty, error: 'URL is not a GitHub repository URL.', suggestion: 'Example: https://github.com/owner/repo' }
  }

  const rest = httpsMatch[1]
  if (!rest) {
    return { ...empty, error: 'GitHub URL is missing the owner.', suggestion: 'Example: https://github.com/owner/repo' }
  }

  const segments = rest.split('/').filter(Boolean)
  const owner = decodeURIComponent(segments[0])
  if (segments.length < 2) {
    return { owner, repo: null, error: 'GitHub URL is missing the repo name.', suggestion: `Example: https://github.com/${owner}/my-repo` }
  }

  let repo = decodeURIComponent(segments[1])
  if (repo.endsWith('.git')) repo = repo.slice(0, -4)

  return { owner, repo, error: null, suggestion: null }
}
```

- [ ] **Step 4: Run the test and verify it passes.**

Run: `npx vitest run tests/utils/githubUrlParser.test.js`

Expected: all 12 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/githubUrlParser.js tests/utils/githubUrlParser.test.js
git commit -m "feat(utils): add parseGitHubUrl for chat URL detection"
```

---

## Task 2 — Repo URL Dispatcher

**Files:**
- Create: `src/utils/repoUrlDetector.js`
- Create: `tests/utils/repoUrlDetector.test.js`

- [ ] **Step 1: Write the failing test file.**

Create `tests/utils/repoUrlDetector.test.js` with the complete content:

```jsx
import { describe, it, expect } from 'vitest'
import { detectRepoUrl } from '@/utils/repoUrlDetector'

describe('detectRepoUrl', () => {
  it('returns sourceType=azure with parsed Azure fields', () => {
    expect(detectRepoUrl('https://dev.azure.com/bruno/AWIP/_git/Cacadores')).toEqual({
      sourceType: 'azure',
      parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
      error: null,
      suggestion: null,
    })
  })

  it('returns sourceType=azure for visualstudio.com URLs', () => {
    expect(detectRepoUrl('https://bruno.visualstudio.com/AWIP/_git/Cacadores').sourceType)
      .toBe('azure')
  })

  it('returns sourceType=azure for the Azure shorthand (org/project/repo)', () => {
    expect(detectRepoUrl('bruno/AWIP/Cacadores')).toEqual({
      sourceType: 'azure',
      parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
      error: null,
      suggestion: null,
    })
  })

  it('returns sourceType=github with parsed GitHub fields', () => {
    expect(detectRepoUrl('https://github.com/bolalabs/BolaLabs')).toEqual({
      sourceType: 'github',
      parsed: { owner: 'bolalabs', repo: 'BolaLabs' },
      error: null,
      suggestion: null,
    })
  })

  it('returns sourceType=github for SSH GitHub URLs', () => {
    expect(detectRepoUrl('git@github.com:bolalabs/BolaLabs.git').sourceType)
      .toBe('github')
  })

  it('returns sourceType=null with an error for GitLab URLs', () => {
    const r = detectRepoUrl('https://gitlab.com/foo/bar')
    expect(r.sourceType).toBeNull()
    expect(r.error).toMatch(/gitlab/i)
  })

  it('returns sourceType=null with an error for Bitbucket URLs', () => {
    const r = detectRepoUrl('https://bitbucket.org/foo/bar')
    expect(r.sourceType).toBeNull()
    expect(r.error).toMatch(/bitbucket/i)
  })

  it('returns sourceType=null with error for empty input', () => {
    const r = detectRepoUrl('')
    expect(r.sourceType).toBeNull()
    expect(r.error).toBeTruthy()
  })

  it('returns sourceType=null with error for a free-text message (no URL)', () => {
    const r = detectRepoUrl('hello, how are you')
    expect(r.sourceType).toBeNull()
    expect(r.error).toBeTruthy()
  })

  it('returns sourceType=null for on-prem Azure DevOps Server URLs (explicitly unsupported)', () => {
    const r = detectRepoUrl('https://tfs.client.local/tfs/DefaultCollection/Proj/_git/Repo')
    expect(r.sourceType).toBeNull()
    expect(r.error).toMatch(/on-?prem|server/i)
  })

  it('prefers Azure when the host matches Azure (Azure wins over generic github-like path)', () => {
    expect(detectRepoUrl('https://dev.azure.com/github.com/x').sourceType).toBe('azure')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `npx vitest run tests/utils/repoUrlDetector.test.js`

Expected: all 11 tests fail with `Cannot find module '@/utils/repoUrlDetector'`.

- [ ] **Step 3: Implement the dispatcher.**

Create `src/utils/repoUrlDetector.js` with the complete content:

```js
import { parseAzureUrl } from './azureUrlParser'
import { parseGitHubUrl } from './githubUrlParser'

/**
 * Detect the source type of a pasted URL and return the parsed fields.
 * Pure function. Tries Azure first, then GitHub. Bitbucket / GitLab / random
 * inputs return { sourceType: null, error }.
 *
 * @param {string} input
 * @returns {{
 *   sourceType: 'azure' | 'github' | null,
 *   parsed: object | null,
 *   error: string | null,
 *   suggestion: string | null,
 * }}
 */
export function detectRepoUrl(input) {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return {
      sourceType: null, parsed: null,
      error: 'Paste a repository URL to get started.',
      suggestion: null,
    }
  }

  const lower = input.toLowerCase()

  // GitHub hosts — match SSH or hostname explicitly
  if (/^git@github\.com:/i.test(input) || /github\.com\//i.test(lower)) {
    const gh = parseGitHubUrl(input)
    if (gh.error) {
      return { sourceType: null, parsed: null, error: gh.error, suggestion: gh.suggestion }
    }
    return {
      sourceType: 'github',
      parsed: { owner: gh.owner, repo: gh.repo },
      error: null, suggestion: null,
    }
  }

  // Azure DevOps (cloud) — parseAzureUrl already rejects on-prem + other services
  const az = parseAzureUrl(input)
  if (az.error) {
    return { sourceType: null, parsed: null, error: az.error, suggestion: az.suggestion }
  }
  return {
    sourceType: 'azure',
    parsed: { org: az.org, project: az.project, repo: az.repo },
    error: null, suggestion: null,
  }
}
```

- [ ] **Step 4: Run the test and verify it passes.**

Run: `npx vitest run tests/utils/repoUrlDetector.test.js`

Expected: all 11 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/repoUrlDetector.js tests/utils/repoUrlDetector.test.js
git commit -m "feat(utils): add detectRepoUrl dispatcher for Azure/GitHub URLs"
```

---

## Task 3 — Seed Migration Wizard State

**Files:**
- Modify: `src/hooks/useMigrationWizard.js` (lines 163 signature + lines 164-170 seed section + add initial-step resolver)
- Modify: `tests/hooks/useMigrationWizard.test.jsx` (add new cases)

- [ ] **Step 1: Add failing test cases to `tests/hooks/useMigrationWizard.test.jsx`.**

Open `tests/hooks/useMigrationWizard.test.jsx`. After the last existing test inside the main `describe('useMigrationWizard', …)` block (at the end of the file, before the closing `})`), insert the following cases:

```jsx
  it('seeds source fields from initialSource option', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: {
          sourceType: 'azure',
          org: 'bruno',
          project: 'AWIP',
          targetOrg: 'bolalabs',
          targetName: 'AWIP',
        },
      })
    )
    expect(result.current.source.sourceType).toBe('azure')
    expect(result.current.source.org).toBe('bruno')
    expect(result.current.source.project).toBe('AWIP')
    expect(result.current.source.targetOrg).toBe('bolalabs')
    expect(result.current.source.targetName).toBe('AWIP')
  })

  it('seeds repos from initialRepos option (used for Azure single-repo auto-select)', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: { sourceType: 'azure' },
        initialRepos: [
          { id: 'seed-1', name: 'Cacadores', selected: true, targetName: 'Cacadores' },
        ],
      })
    )
    expect(result.current.repos).toHaveLength(1)
    expect(result.current.repos[0].selected).toBe(true)
    expect(result.current.repos[0].name).toBe('Cacadores')
  })

  it('starts at initialStep when provided and valid for the sourceType', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: { sourceType: 'azure' },
        initialStep: 'repoConfig',
      })
    )
    expect(result.current.currentStep).toBe('repoConfig')
  })

  it('falls back to step 0 when initialStep does not exist in the sourceType flow', () => {
    const { result } = renderHook(() =>
      useMigrationWizard({
        initialSource: { sourceType: 'github' },
        initialStep: 'repoConfig', // github flow has no repoConfig
      })
    )
    expect(result.current.currentStep).toBe('sourceType')
  })

  it('remains backward-compatible when called with no options (INITIAL_SOURCE used)', () => {
    const { result } = renderHook(() => useMigrationWizard())
    expect(result.current.currentStep).toBe('sourceType')
    expect(result.current.source.sourceType).toBe('')
    expect(result.current.repos).toEqual([])
  })
```

- [ ] **Step 2: Run the test and verify the new cases fail.**

Run: `npx vitest run tests/hooks/useMigrationWizard.test.jsx`

Expected: 5 new tests fail. Existing tests still pass.

- [ ] **Step 3: Update the hook signature and seed state.**

Open `src/hooks/useMigrationWizard.js`.

Replace line 163:

```js
export function useMigrationWizard({ initialDryRun = false } = {}) {
```

with:

```js
export function useMigrationWizard({
  initialDryRun = false,
  initialSource,
  initialRepos,
  initialStep,
} = {}) {
```

Replace lines 164-166 (the `useState` lines for `currentStepIndex`, `source`, `repos`):

```js
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [source, setSource] = useState(INITIAL_SOURCE)
  const [repos, setRepos] = useState([])
```

with:

```js
  const [currentStepIndex, setCurrentStepIndex] = useState(() => {
    if (!initialStep) return 0
    const initialSteps = getStepsForSourceType(initialSource?.sourceType, false, false)
    const idx = initialSteps.indexOf(initialStep)
    return idx >= 0 ? idx : 0
  })
  const [source, setSource] = useState(() => ({ ...INITIAL_SOURCE, ...(initialSource || {}) }))
  const [repos, setRepos] = useState(() => initialRepos || [])
```

Note: each `useState` takes a lazy initializer so `initialSource` / `initialRepos` / `initialStep` are captured exactly once, on mount. Later updates to those props are intentionally ignored — the modal payload is set at open time and should not re-drive internal wizard state mid-session.

- [ ] **Step 4: Run the tests and verify they all pass.**

Run: `npx vitest run tests/hooks/useMigrationWizard.test.jsx`

Expected: all tests pass (existing + 5 new = 25 total, adjust count if file has grown).

- [ ] **Step 5: Commit.**

```bash
git add src/hooks/useMigrationWizard.js tests/hooks/useMigrationWizard.test.jsx
git commit -m "feat(wizard): seed source/repos/step from hook options"
```

---

## Task 4 — Thread Modal Payload Through MigrationWizard and App

**Files:**
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx:368` (hook call)
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx` component signature (wherever props are destructured at the top of the component)
- Modify: `src/App.jsx:1009-1016` (the `{modalStates.showMigrationWizard && …}` block)

- [ ] **Step 1: Locate the current `MigrationWizard` props destructuring.**

Run: `grep -n "export default function MigrationWizard\|export function MigrationWizard" "src/components/MigrationWizard/MigrationWizard.jsx"`

Expected: one match, something like `export default function MigrationWizard({ onClose, orgs, initialDryRun }) {`. Note the exact parameter list.

- [ ] **Step 2: Extend the component signature to accept `initialSource`, `initialRepos`, `initialStep`.**

Edit `src/components/MigrationWizard/MigrationWizard.jsx`. Replace the current `MigrationWizard` signature line (the one `grep` just found) so the prop list becomes:

```js
export default function MigrationWizard({
  onClose,
  orgs,
  initialDryRun = false,
  initialSource,
  initialRepos,
  initialStep,
}) {
```

(If the current export syntax is different, e.g. `export function MigrationWizard(props)`, adapt while preserving the existing default export mechanism — the key is that the three new props are received.)

- [ ] **Step 3: Forward the new props to the hook.**

Replace line 368 of the same file:

```js
  const wizard = useMigrationWizard({ initialDryRun })
```

with:

```js
  const wizard = useMigrationWizard({ initialDryRun, initialSource, initialRepos, initialStep })
```

- [ ] **Step 4: Pass the modal payload fields from App.jsx.**

Edit `src/App.jsx`. Replace lines 1009-1017 (the `{modalStates.showMigrationWizard && …}` block) with:

```jsx
      {modalStates.showMigrationWizard && (
        <Suspense fallback={null}>
          <MigrationWizard
            onClose={() => closeModal('showMigrationWizard')}
            orgs={orgs}
            initialDryRun={getModalData('showMigrationWizard')?.initialDryRun}
            initialSource={getModalData('showMigrationWizard')?.initialSource}
            initialRepos={getModalData('showMigrationWizard')?.initialRepos}
            initialStep={getModalData('showMigrationWizard')?.initialStep}
          />
        </Suspense>
      )}
```

- [ ] **Step 5: Run the existing wizard unit tests to confirm nothing regressed.**

Run: `npx vitest run tests/hooks/useMigrationWizard.test.jsx tests/components/MigrationWizard/`

Expected: all existing tests pass unchanged.

- [ ] **Step 6: Commit.**

```bash
git add src/components/MigrationWizard/MigrationWizard.jsx src/App.jsx
git commit -m "feat(wizard): accept initialSource/Repos/Step via modal payload"
```

---

## Task 5 — PasteDialogCard Component

**Files:**
- Create: `src/components/AIAssistantPasteDialog.jsx`
- Create: `tests/components/AIAssistantPasteDialog.test.jsx`

- [ ] **Step 1: Write the failing test file.**

Create `tests/components/AIAssistantPasteDialog.test.jsx` with the complete content:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AIAssistantPasteDialog } from '../../src/components/AIAssistantPasteDialog'

function renderDialog(overrides = {}) {
  const props = {
    dialog: {
      status: 'collecting',
      sourceType: 'azure',
      parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
      answers: {},
      nextField: 'targetOrg',
    },
    onAnswer: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<AIAssistantPasteDialog {...props} />) }
}

describe('AIAssistantPasteDialog', () => {
  it('renders the parsed Azure preview when collecting', () => {
    renderDialog()
    expect(screen.getByText(/azure devops/i)).toBeInTheDocument()
    expect(screen.getByText(/bruno/)).toBeInTheDocument()
    expect(screen.getByText(/AWIP/)).toBeInTheDocument()
    expect(screen.getByText(/Cacadores/)).toBeInTheDocument()
  })

  it('renders the first dynamic question (targetOrg)', () => {
    renderDialog()
    expect(screen.getByRole('textbox', { name: /github.*org.*destino/i })).toBeInTheDocument()
  })

  it('calls onAnswer with the field and value when user submits a question', () => {
    const { props } = renderDialog()
    const input = screen.getByRole('textbox', { name: /github.*org/i })
    fireEvent.change(input, { target: { value: 'bolalabs' } })
    fireEvent.submit(input.closest('form'))
    expect(props.onAnswer).toHaveBeenCalledWith('targetOrg', 'bolalabs')
  })

  it('renders the second question when nextField is targetName', () => {
    renderDialog({
      dialog: {
        status: 'collecting',
        sourceType: 'azure',
        parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
        answers: { targetOrg: 'bolalabs' },
        nextField: 'targetName',
      },
    })
    expect(screen.getByRole('textbox', { name: /nome final.*repo/i })).toBeInTheDocument()
  })

  it('renders the confirm button when status is ready', () => {
    renderDialog({
      dialog: {
        status: 'ready',
        sourceType: 'azure',
        parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
        answers: { targetOrg: 'bolalabs', targetName: 'Cacadores' },
        nextField: null,
      },
    })
    expect(screen.getByRole('button', { name: /abrir wizard/i })).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', () => {
    const { props } = renderDialog({
      dialog: {
        status: 'ready',
        sourceType: 'azure',
        parsed: { org: 'bruno', project: 'AWIP', repo: 'Cacadores' },
        answers: { targetOrg: 'bolalabs', targetName: 'Cacadores' },
        nextField: null,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /abrir wizard/i }))
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the cancel button is clicked', () => {
    const { props } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores submit when the input is empty (does not fire onAnswer)', () => {
    const { props } = renderDialog()
    const input = screen.getByRole('textbox', { name: /github.*org/i })
    fireEvent.submit(input.closest('form'))
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it('renders a GitHub preview when sourceType=github', () => {
    renderDialog({
      dialog: {
        status: 'collecting',
        sourceType: 'github',
        parsed: { owner: 'bolalabs', repo: 'BolaLabs' },
        answers: {},
        nextField: 'targetOrg',
      },
    })
    expect(screen.getByText(/github/i)).toBeInTheDocument()
    expect(screen.getByText(/bolalabs/)).toBeInTheDocument()
    expect(screen.getByText(/BolaLabs/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `npx vitest run tests/components/AIAssistantPasteDialog.test.jsx`

Expected: all 9 tests fail with `Cannot find module`.

- [ ] **Step 3: Implement the component.**

Create `src/components/AIAssistantPasteDialog.jsx` with the complete content:

```jsx
import { useState } from 'react'
import { Wand2, X, ArrowRight, Check, Cloud, Github } from 'lucide-react'

/**
 * Inline chat card that drives the paste-URL dialog.
 * Pure presentational + local input state only. All interaction goes through
 * the three callbacks so the parent component (AIAssistant) owns the state
 * machine.
 *
 * @param {object} props
 * @param {object} props.dialog  Current dialog state (see state shape below)
 * @param {(field: string, value: string) => void} props.onAnswer
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 *
 * dialog shape:
 *   status:     'collecting' | 'ready'
 *   sourceType: 'azure' | 'github'
 *   parsed:     { org, project, repo }            for azure
 *               { owner, repo }                    for github
 *   answers:    { targetOrg?, targetName? }
 *   nextField:  'targetOrg' | 'targetName' | null
 */
export function AIAssistantPasteDialog({ dialog, onAnswer, onConfirm, onCancel }) {
  const [value, setValue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onAnswer(dialog.nextField, trimmed)
    setValue('')
  }

  const question = QUESTIONS[dialog.nextField]
  const isReady = dialog.status === 'ready'

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-900/20 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <Wand2 className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
            URL detectado
          </p>
          <Preview dialog={dialog} />
          <ConfirmedAnswers dialog={dialog} />
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar"
          className="p-1 rounded hover:bg-white/50 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!isReady && question && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
            {question.label}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={question.placeholder}
              aria-label={question.label}
              className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50"
              disabled={!value.trim()}
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {question.hint && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{question.hint}</p>
          )}
        </form>
      )}

      {isReady && (
        <button
          type="button"
          onClick={onConfirm}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-500 text-white hover:bg-indigo-600"
        >
          <Check className="w-4 h-4" /> Abrir wizard com isto preenchido
        </button>
      )}
    </div>
  )
}

function Preview({ dialog }) {
  if (dialog.sourceType === 'azure') {
    const { org, project, repo } = dialog.parsed || {}
    return (
      <p className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1 flex-wrap">
        <Cloud className="w-3 h-3 text-indigo-500" /> Azure DevOps
        {org && <> &middot; <span className="font-mono">{org}</span></>}
        {project && <> / <span className="font-mono">{project}</span></>}
        {repo && <> / <span className="font-mono">{repo}</span></>}
      </p>
    )
  }
  if (dialog.sourceType === 'github') {
    const { owner, repo } = dialog.parsed || {}
    return (
      <p className="text-sm text-slate-700 dark:text-slate-200 flex items-center gap-1 flex-wrap">
        <Github className="w-3 h-3 text-slate-700 dark:text-slate-200" /> GitHub
        {owner && <> &middot; <span className="font-mono">{owner}</span></>}
        {repo && <> / <span className="font-mono">{repo}</span></>}
      </p>
    )
  }
  return null
}

function ConfirmedAnswers({ dialog }) {
  const entries = Object.entries(dialog.answers || {})
  if (entries.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
      {entries.map(([k, v]) => (
        <li key={k} className="flex items-center gap-1">
          <Check className="w-3 h-3 text-emerald-500" />
          <span className="font-medium">{ANSWER_LABELS[k] || k}:</span>
          <span className="font-mono">{v}</span>
        </li>
      ))}
    </ul>
  )
}

const QUESTIONS = {
  targetOrg: {
    label: 'Qual a GitHub org de destino?',
    placeholder: 'p.ex. bolalabs',
    hint: 'Organização ou utilizador GitHub onde o repo vai ser criado.',
  },
  targetName: {
    label: 'Nome final do repo no GitHub?',
    placeholder: 'escreve "manter" para usar o original',
    hint: 'Deixa vazio ou "manter" para manter o nome detetado.',
  },
}

const ANSWER_LABELS = {
  targetOrg: 'GitHub org',
  targetName: 'Nome final',
}
```

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `npx vitest run tests/components/AIAssistantPasteDialog.test.jsx`

Expected: all 9 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add src/components/AIAssistantPasteDialog.jsx tests/components/AIAssistantPasteDialog.test.jsx
git commit -m "feat(ai-assistant): add PasteDialog card for URL-driven flow"
```

---

## Task 6 — Integrate PasteDialog into AIAssistant

**Files:**
- Modify: `src/components/AIAssistant.jsx` (imports + `handleSubmit` + new state + render the dialog)
- Modify: `tests/components/AIAssistant.test.jsx` (add new cases)

### Integration contract

The AIAssistant keeps the paste dialog state local:

```js
const [pasteDialog, setPasteDialog] = useState(null)
// null          = no dialog active (normal chat)
// { status, sourceType, parsed, answers, nextField } = dialog in progress
```

Interception happens in `handleSubmit`. If `detectRepoUrl(trimmed).sourceType` is truthy, we build the initial dialog and skip `sendMessage`. Otherwise we fall through to the normal flow.

Answer flow:
- `onAnswer(field, value)` updates `answers[field]`, recomputes `nextField`, and transitions to `'ready'` when `nextField === null`.
- `onConfirm()` builds the wizard payload, calls `openModalWithData`, and clears `pasteDialog`.
- `onCancel()` clears `pasteDialog`.

### Missing-field order

For both Azure and GitHub, ask: `targetOrg` (required) → `targetName` (optional; empty or "manter" keeps the detected name).

### Wizard payload construction

```js
function buildWizardPayload(dialog) {
  const detectedName = dialog.sourceType === 'azure'
    ? dialog.parsed.repo
    : dialog.parsed.repo   // github parsed also has .repo
  const answerName = dialog.answers.targetName
  const finalName = !answerName || answerName.toLowerCase() === 'manter'
    ? detectedName
    : answerName

  if (dialog.sourceType === 'azure') {
    const { org, project, repo } = dialog.parsed
    return {
      initialSource: {
        sourceType: 'azure',
        org,
        project,
        targetOrg: dialog.answers.targetOrg,
        targetName: finalName || '',
      },
      initialRepos: repo
        ? [{ id: `paste-${repo}`, name: repo, selected: true, targetName: finalName || repo }]
        : [],
      initialStep: repo ? 'repoConfig' : 'repoSelect',
    }
  }
  // github
  const { owner, repo } = dialog.parsed
  return {
    initialSource: {
      sourceType: 'github',
      githubSourceUrl: `https://github.com/${owner}/${repo}`,
      targetOrg: dialog.answers.targetOrg,
      targetName: finalName || '',
    },
    initialRepos: [],
    initialStep: 'targetConfig',
  }
}
```

### Tasks

- [ ] **Step 1: Add failing test cases to `tests/components/AIAssistant.test.jsx`.**

Append new cases inside the main `describe('AIAssistant', …)` block, after the existing tests and before the closing `})`:

```jsx
  it('intercepts a pasted Azure URL, shows the dialog, and does not call askAI', async () => {
    const askAI = vi.fn()
    renderAssistant({ askAI })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://dev.azure.com/bruno/AWIP/_git/Cacadores' } })
      fireEvent.submit(input.closest('form'))
    })

    expect(askAI).not.toHaveBeenCalled()
    expect(await screen.findByText(/URL detectado/i)).toBeInTheDocument()
    expect(screen.getByText(/bruno/)).toBeInTheDocument()
    expect(screen.getByText(/AWIP/)).toBeInTheDocument()
    expect(screen.getByText(/Cacadores/)).toBeInTheDocument()
  })

  it('falls back to askAI for free-text input (no URL detected)', async () => {
    const askAI = vi.fn().mockResolvedValue({ reply: 'Hello there', actions: [] })
    renderAssistant({ askAI })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'hello there' } })
      fireEvent.submit(input.closest('form'))
    })

    expect(askAI).toHaveBeenCalledWith('hello there', expect.any(Object))
  })

  it('dismisses the paste dialog when cancel is clicked', async () => {
    renderAssistant({ askAI: vi.fn() })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://github.com/bolalabs/BolaLabs' } })
      fireEvent.submit(input.closest('form'))
    })

    fireEvent.click(await screen.findByRole('button', { name: /cancelar/i }))
    await waitFor(() => expect(screen.queryByText(/URL detectado/i)).not.toBeInTheDocument())
  })

  it('transitions to the confirm button after both answers are collected', async () => {
    renderAssistant({ askAI: vi.fn() })
    await openAssistant()

    const input = screen.getByRole('textbox', { name: /message the ai assistant/i })
    await act(async () => {
      fireEvent.change(input, { target: { value: 'https://dev.azure.com/bruno/AWIP/_git/Cacadores' } })
      fireEvent.submit(input.closest('form'))
    })

    // Answer 1: targetOrg
    const orgInput = await screen.findByRole('textbox', { name: /github.*org.*destino/i })
    await act(async () => {
      fireEvent.change(orgInput, { target: { value: 'bolalabs' } })
      fireEvent.submit(orgInput.closest('form'))
    })

    // Answer 2: targetName
    const nameInput = await screen.findByRole('textbox', { name: /nome final.*repo/i })
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'manter' } })
      fireEvent.submit(nameInput.closest('form'))
    })

    expect(await screen.findByRole('button', { name: /abrir wizard/i })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests and verify the new cases fail.**

Run: `npx vitest run tests/components/AIAssistant.test.jsx`

Expected: 4 new tests fail. Existing tests still pass.

- [ ] **Step 3: Add the new imports to `src/components/AIAssistant.jsx`.**

Open `src/components/AIAssistant.jsx`. Replace line 8:

```js
import { sanitizeActions, dispatchAction } from '../utils/aiActions'
```

with:

```js
import { sanitizeActions, dispatchAction } from '../utils/aiActions'
import { detectRepoUrl } from '../utils/repoUrlDetector'
import { AIAssistantPasteDialog } from './AIAssistantPasteDialog'
```

- [ ] **Step 4: Add paste dialog state and helpers inside the component.**

Still in `src/components/AIAssistant.jsx`, immediately after line 27 (`const { openModal } = useModal()`), insert:

```js
    const { openModalWithData } = useModal()
    const [pasteDialog, setPasteDialog] = useState(null)

    const computeNextField = (answers) => {
      if (!answers.targetOrg) return 'targetOrg'
      if (answers.targetName === undefined) return 'targetName'
      return null
    }

    const handlePasteAnswer = useCallback((field, value) => {
      setPasteDialog((prev) => {
        if (!prev) return prev
        const nextAnswers = { ...prev.answers, [field]: value }
        const nextField = computeNextField(nextAnswers)
        return {
          ...prev,
          answers: nextAnswers,
          nextField,
          status: nextField === null ? 'ready' : 'collecting',
        }
      })
    }, [])

    const handlePasteCancel = useCallback(() => setPasteDialog(null), [])

    const handlePasteConfirm = useCallback(() => {
      setPasteDialog((prev) => {
        if (!prev) return prev
        const payload = buildWizardPayload(prev)
        openModalWithData('showMigrationWizard', payload)
        return null
      })
    }, [openModalWithData])
```

- [ ] **Step 5: Replace the existing `handleSubmit` (lines 111-117) with the interception version.**

Replace:

```js
    const handleSubmit = (e) => {
        e.preventDefault()
        const trimmed = input.trim()
        if (!trimmed || isLoading) return
        setInput('')
        sendMessage(trimmed)
    }
```

with:

```js
    const handleSubmit = (e) => {
        e.preventDefault()
        const trimmed = input.trim()
        if (!trimmed || isLoading) return
        setInput('')

        const detection = detectRepoUrl(trimmed)
        if (detection.sourceType) {
          const answers = {}
          const nextField = 'targetOrg'
          setPasteDialog({
            status: 'collecting',
            sourceType: detection.sourceType,
            parsed: detection.parsed,
            answers,
            nextField,
          })
          return
        }

        sendMessage(trimmed)
    }
```

- [ ] **Step 6: Add `buildWizardPayload` as a local helper at the bottom of the file.**

Append to `src/components/AIAssistant.jsx`, outside the component export (at the very bottom of the file, after the closing `}` of the `AIAssistant` function):

```js
function buildWizardPayload(dialog) {
  const detectedName = dialog.parsed.repo
  const answerName = (dialog.answers.targetName || '').trim()
  const finalName = !answerName || answerName.toLowerCase() === 'manter'
    ? detectedName
    : answerName

  if (dialog.sourceType === 'azure') {
    const { org, project, repo } = dialog.parsed
    return {
      initialSource: {
        sourceType: 'azure',
        org: org || '',
        project: project || '',
        targetOrg: dialog.answers.targetOrg,
        targetName: finalName || '',
      },
      initialRepos: repo
        ? [{ id: `paste-${repo}`, name: repo, selected: true, targetName: finalName || repo }]
        : [],
      initialStep: repo ? 'repoConfig' : 'repoSelect',
    }
  }
  const { owner, repo } = dialog.parsed
  return {
    initialSource: {
      sourceType: 'github',
      githubSourceUrl: `https://github.com/${owner}/${repo}`,
      targetOrg: dialog.answers.targetOrg,
      targetName: finalName || '',
    },
    initialRepos: [],
    initialStep: 'targetConfig',
  }
}
```

- [ ] **Step 7: Render the PasteDialog card inside the chat scroll area.**

Still in `src/components/AIAssistant.jsx`, find the messages list render (the `messages.map(...)` at line ~228). Right after the closing `))}` of the `.map` call and before the `{isLoading && <TypingIndicator />}` line, insert:

```jsx
                                                {pasteDialog && (
                                                  <AIAssistantPasteDialog
                                                    dialog={pasteDialog}
                                                    onAnswer={handlePasteAnswer}
                                                    onConfirm={handlePasteConfirm}
                                                    onCancel={handlePasteCancel}
                                                  />
                                                )}
```

- [ ] **Step 8: Run all the AIAssistant tests and verify they pass.**

Run: `npx vitest run tests/components/AIAssistant.test.jsx tests/components/AIAssistantPasteDialog.test.jsx`

Expected: every test passes, including the 4 new interception cases.

- [ ] **Step 9: Run the full frontend test suite to confirm no regressions.**

Run: `npx vitest run`

Expected: all tests pass. The baseline was 550 frontend + 341 backend; this task adds roughly 4 + 9 + 12 + 11 + 5 = 41 new tests, so expect ~591 frontend, ~341 backend, all passing.

- [ ] **Step 10: Commit.**

```bash
git add src/components/AIAssistant.jsx tests/components/AIAssistant.test.jsx
git commit -m "feat(ai-assistant): intercept pasted URLs and drive populate flow"
```

---

## Task 7 — End-to-End Happy Path

**Files:**
- Create: `e2e/assistant-paste-url.spec.js`

The E2E suite uses Playwright against `npm run dev:all`. Per project convention (see [feedback_avoid_long_local_tests.md](../../C:/Users/bruno/.claude/projects/s--Git-Hub-Repo-Manager/memory/feedback_avoid_long_local_tests.md)), write the test but **do not** run the full E2E suite locally — push the branch and let CI validate.

- [ ] **Step 1: Create the E2E test file.**

Create `e2e/assistant-paste-url.spec.js` with the complete content:

```js
import { test, expect } from '@playwright/test'
import { login, openAssistant } from './helpers.js'

test.describe('AI Assistant — paste URL flow', () => {
  test('pastes an Azure URL, answers the dialog, and opens the wizard pre-filled', async ({ page }) => {
    await login(page)
    await openAssistant(page)

    const input = page.getByRole('textbox', { name: /message the ai assistant/i })
    await input.fill('https://dev.azure.com/bruno/AWIP/_git/Cacadores')
    await input.press('Enter')

    await expect(page.getByText(/URL detectado/i)).toBeVisible()
    await expect(page.getByText(/bruno/)).toBeVisible()
    await expect(page.getByText(/AWIP/)).toBeVisible()
    await expect(page.getByText(/Cacadores/)).toBeVisible()

    const targetOrgInput = page.getByRole('textbox', { name: /github.*org.*destino/i })
    await targetOrgInput.fill('bolalabs')
    await targetOrgInput.press('Enter')

    const nameInput = page.getByRole('textbox', { name: /nome final.*repo/i })
    await nameInput.fill('manter')
    await nameInput.press('Enter')

    await page.getByRole('button', { name: /abrir wizard/i }).click()

    // The wizard should open on the repoConfig step with fields pre-filled.
    await expect(page.getByTestId('wizard-step-repoConfig')).toBeVisible()
  })

  test('falls back to the normal chat when no URL is pasted', async ({ page }) => {
    await login(page)
    await openAssistant(page)

    const input = page.getByRole('textbox', { name: /message the ai assistant/i })
    await input.fill('olá, ajuda-me com um repo novo')
    await input.press('Enter')

    await expect(page.getByText(/URL detectado/i)).not.toBeVisible()
  })
})
```

- [ ] **Step 2: Check that the `openAssistant` helper exists in `e2e/helpers.js`. If not, add it.**

Run: `grep -n "openAssistant" e2e/helpers.js`

If the grep finds a match, skip to Step 3. If it does not, open `e2e/helpers.js` and append:

```js
export async function openAssistant(page) {
  await page.getByRole('button', { name: /open ai assistant/i }).click()
  await page.getByRole('dialog', { name: /ai assistant/i }).waitFor()
}
```

- [ ] **Step 3: Push the branch and let CI run the E2E suite.**

```bash
git add e2e/assistant-paste-url.spec.js e2e/helpers.js
git commit -m "test(e2e): paste-URL flow happy path in AI Assistant"
git push
```

The E2E workflow in CI will run the new spec alongside the existing ones. Monitor the CI run and fix locally if it fails (re-running locally only if needed, using `npx playwright test e2e/assistant-paste-url.spec.js --headed` for debugging).

---

## Done

All seven tasks commit-small and commit-often. After Task 6 the feature is already shippable without E2E. Task 7 is the safety net.

### Self-review checklist

- [ ] Spec section 2 "In scope" — all bullets covered by Tasks 1, 2, 5, 6 (Azure + GitHub parsing; dialog up to 2 questions; final button; cancel)
- [ ] Spec section 4.4 data flow — Tasks 5 and 6 implement it end-to-end
- [ ] Spec section 4.5 initial step resolver — Task 6's `buildWizardPayload` chooses `repoConfig` / `repoSelect` / `targetConfig`; Task 3 honours `initialStep` in the hook
- [ ] Spec section 5 error table — fallback to chat (Task 6 Step 5), cancel (Task 5 test 7), non-repo URLs (Task 2 tests), on-prem Azure (Task 2 test 10)
- [ ] No placeholders, TBDs, or "add appropriate error handling" phrases
- [ ] Identifier consistency: `detectRepoUrl`, `parseGitHubUrl`, `AIAssistantPasteDialog`, `pasteDialog`, `buildWizardPayload`, `handlePasteAnswer`, `handlePasteConfirm`, `handlePasteCancel` — all used identically across tasks
- [ ] Test file paths mirror `src/` structure per CLAUDE.md
- [ ] Commit messages follow Conventional Commits, no `Co-Authored-By`
