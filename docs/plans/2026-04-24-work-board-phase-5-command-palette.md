# Work Board Premium UX — Phase 5: Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `⌘K` CommandPalette with Work Board tracking commands — pin/mute/untrack per tracked repo, global "Refresh discovery / Refresh board / Toggle muted filter" — and surface a `⌘K` discovery chip in the Header so power users can do everything keyboard-first.

**Architecture:** A pure helper (`buildTrackedRepoCommands`) generates per-repo command items from the `useTrackedRepos` context. Results are injected as a new "Tracked Repositories" group in the existing `CommandPalette.jsx`. Also adds four global commands (Refresh discovery, Refresh Work Board, Toggle muted filter, Clear filters) and an `/ai` reserved placeholder for Phase 6. `⌘K` chip in the Header is a small trigger next to the logo that opens the palette.

**Tech Stack:** React 19, `cmdk` 1.1.1 (already used), lucide-react, Vitest 4 + React Testing Library.

**Spec reference:** `docs/specs/2026-04-24-work-board-premium-ux.md` §4 (Command palette, Layer 3).

**Depends on:** Phases 1-4 (shipped). `useTrackedRepos` context + existing CommandPalette at `src/components/CommandPalette.jsx`.

**Out of scope:** AI Assistant (`/ai` prefix actions are gated; Phase 6-7). Cross-account search. Server-side repo fuzzy via `/repo-search` on non-tracked repos (future — Phase 5.1).

---

## File Structure

| File | Purpose | Status |
|---|---|---|
| `src/components/CommandPalette/trackedRepoCommands.js` | Pure function `buildTrackedRepoCommands(repos)` → array of per-repo items | Create |
| `src/components/CommandPalette/workBoardGlobalCommands.js` | 4 global commands (Refresh discovery, Refresh board, Toggle muted, Clear filters) | Create |
| `src/components/CommandPalette.jsx` | Render new group + call helpers; wire up handlers from `useTrackedRepos` | Modify |
| `src/components/Header.jsx` | Add `⌘K` chip next to logo that dispatches the `toggleCommandPalette` event | Modify |
| `tests/components/CommandPalette/trackedRepoCommands.test.js` | Unit tests for the pure builder | Create |
| `tests/components/CommandPalette/workBoardGlobalCommands.test.js` | Unit tests for global commands | Create |
| `tests/components/CommandPalette/CommandPalette-workboard.test.jsx` | Integration test: palette renders tracked repo commands + handlers fire | Create |

---

## Branching

Direct push to `main` — no branch, no PR (established workflow for Phases 2+).

---

## Task 1: TrackedRepoCommands builder + global commands

**Files:**

- Create: `src/components/CommandPalette/trackedRepoCommands.js`
- Create: `src/components/CommandPalette/workBoardGlobalCommands.js`
- Create: `tests/components/CommandPalette/trackedRepoCommands.test.js`
- Create: `tests/components/CommandPalette/workBoardGlobalCommands.test.js`

### Scene

Two pure functions, both testable in isolation without React. Each returns an array of plain command descriptors:

```javascript
{
    id: string,           // unique stable id (e.g. 'track-pin-acme/x')
    label: string,        // human-readable item label ("Pin acme/x")
    searchValue: string,  // what cmdk matches against: "pin acme/x"
    actionType: string,   // 'pin' | 'unpin' | 'mute' | 'unmute' | 'untrack' | 'refresh-discovery' | ...
    repoFullName?: string,// present when action is repo-scoped
    icon: string,         // lucide icon name as string ('Pin', 'PinOff', etc.) — resolved in JSX
}
```

The JSX component (CommandPalette) resolves the icon string to a component and wires handlers. Keeping the builder pure means we can unit-test it without rendering anything.

### Step 1: Failing test for trackedRepoCommands

Create `tests/components/CommandPalette/trackedRepoCommands.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { buildTrackedRepoCommands } from '../../../src/components/CommandPalette/trackedRepoCommands'

function repo(name, overrides = {}) {
    return { repo_full_name: name, is_pinned: 0, is_muted: 0, ...overrides }
}

describe('buildTrackedRepoCommands', () => {
    it('returns empty array for no repos', () => {
        expect(buildTrackedRepoCommands([])).toEqual([])
    })

    it('emits 3 items per unpinned unmuted repo: Pin, Mute, Untrack', () => {
        const items = buildTrackedRepoCommands([repo('acme/x')])
        expect(items).toHaveLength(3)
        expect(items.map(i => i.actionType).sort()).toEqual(['mute', 'pin', 'untrack'])
    })

    it('shows Unpin instead of Pin for pinned repo', () => {
        const items = buildTrackedRepoCommands([repo('acme/x', { is_pinned: 1 })])
        expect(items.some(i => i.actionType === 'unpin')).toBe(true)
        expect(items.some(i => i.actionType === 'pin')).toBe(false)
    })

    it('shows Unmute instead of Mute for muted repo', () => {
        const items = buildTrackedRepoCommands([repo('acme/x', { is_muted: 1 })])
        expect(items.some(i => i.actionType === 'unmute')).toBe(true)
        expect(items.some(i => i.actionType === 'mute')).toBe(false)
    })

    it('each item has unique id, label includes repo name, and searchValue has verb + repo', () => {
        const items = buildTrackedRepoCommands([repo('acme/x')])
        const ids = new Set(items.map(i => i.id))
        expect(ids.size).toBe(items.length)

        const pin = items.find(i => i.actionType === 'pin')
        expect(pin.label).toContain('acme/x')
        expect(pin.searchValue).toBe('pin acme/x')
        expect(pin.repoFullName).toBe('acme/x')
    })

    it('emits items for all repos in the list (bulk smoke test)', () => {
        const repos = Array.from({ length: 5 }, (_, i) => repo(`org/r${i}`))
        const items = buildTrackedRepoCommands(repos)
        expect(items).toHaveLength(5 * 3)
    })
})
```

### Step 2: Run — expect FAIL

```bash
npx vitest run tests/components/CommandPalette/trackedRepoCommands.test.js
```

### Step 3: Implement

Create `src/components/CommandPalette/trackedRepoCommands.js`:

```javascript
// Pure builder — generates cmdk command items for every tracked repo.
// Kept JSX-free so it can be unit-tested without rendering.

/**
 * @typedef {object} TrackedRepoCommand
 * @property {string} id — unique stable id
 * @property {string} label — visible text
 * @property {string} searchValue — cmdk match string ("pin acme/x")
 * @property {'pin'|'unpin'|'mute'|'unmute'|'untrack'} actionType
 * @property {string} repoFullName
 * @property {string} icon — lucide icon name
 */

/**
 * @param {Array<{repo_full_name: string, is_pinned: number, is_muted: number}>} repos
 * @returns {TrackedRepoCommand[]}
 */
export function buildTrackedRepoCommands(repos) {
    const items = []
    for (const r of repos) {
        const name = r.repo_full_name

        if (r.is_pinned === 1) {
            items.push({
                id: `track-unpin-${name}`,
                label: `Unpin ${name}`,
                searchValue: `unpin ${name}`,
                actionType: 'unpin',
                repoFullName: name,
                icon: 'PinOff',
            })
        } else {
            items.push({
                id: `track-pin-${name}`,
                label: `Pin ${name}`,
                searchValue: `pin ${name}`,
                actionType: 'pin',
                repoFullName: name,
                icon: 'Pin',
            })
        }

        if (r.is_muted === 1) {
            items.push({
                id: `track-unmute-${name}`,
                label: `Unmute ${name}`,
                searchValue: `unmute ${name}`,
                actionType: 'unmute',
                repoFullName: name,
                icon: 'Bell',
            })
        } else {
            items.push({
                id: `track-mute-${name}`,
                label: `Mute ${name}`,
                searchValue: `mute ${name}`,
                actionType: 'mute',
                repoFullName: name,
                icon: 'BellOff',
            })
        }

        items.push({
            id: `track-untrack-${name}`,
            label: `Stop tracking ${name}`,
            searchValue: `untrack ${name}`,
            actionType: 'untrack',
            repoFullName: name,
            icon: 'X',
        })
    }
    return items
}
```

### Step 4: Run — expect 6/6 PASS

### Step 5: Failing test for workBoardGlobalCommands

Create `tests/components/CommandPalette/workBoardGlobalCommands.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { WORK_BOARD_GLOBAL_COMMANDS } from '../../../src/components/CommandPalette/workBoardGlobalCommands'

describe('WORK_BOARD_GLOBAL_COMMANDS', () => {
    it('exposes 4 global commands', () => {
        expect(WORK_BOARD_GLOBAL_COMMANDS).toHaveLength(4)
    })

    it('includes Refresh discovery, Refresh board, Toggle muted, Clear filters', () => {
        const ids = WORK_BOARD_GLOBAL_COMMANDS.map(c => c.actionType).sort()
        expect(ids).toEqual(['clear-filters', 'refresh-board', 'refresh-discovery', 'toggle-muted'])
    })

    it('each command has id, label, searchValue, and icon', () => {
        for (const c of WORK_BOARD_GLOBAL_COMMANDS) {
            expect(c.id).toBeTruthy()
            expect(c.label).toBeTruthy()
            expect(c.searchValue).toBeTruthy()
            expect(c.icon).toBeTruthy()
        }
    })

    it('searchValue includes a verb so fuzzy matching feels natural', () => {
        const refresh = WORK_BOARD_GLOBAL_COMMANDS.find(c => c.actionType === 'refresh-discovery')
        expect(refresh.searchValue.toLowerCase()).toContain('refresh')
    })
})
```

### Step 6: Run — expect FAIL

### Step 7: Implement

Create `src/components/CommandPalette/workBoardGlobalCommands.js`:

```javascript
/**
 * Global Work Board commands — no repo context needed. These appear in the
 * palette regardless of the active view.
 *
 * Handlers are wired up in CommandPalette.jsx (which has access to
 * useTrackedRepos + window event dispatch).
 */

export const WORK_BOARD_GLOBAL_COMMANDS = [
    {
        id: 'wb-cmd-refresh-discovery',
        label: 'Refresh discovery',
        searchValue: 'refresh discovery',
        actionType: 'refresh-discovery',
        icon: 'RefreshCw',
    },
    {
        id: 'wb-cmd-refresh-board',
        label: 'Refresh Work Board',
        searchValue: 'refresh board',
        actionType: 'refresh-board',
        icon: 'RotateCw',
    },
    {
        id: 'wb-cmd-toggle-muted',
        label: 'Toggle muted repos in Work Board',
        searchValue: 'toggle muted',
        actionType: 'toggle-muted',
        icon: 'BellOff',
    },
    {
        id: 'wb-cmd-clear-filters',
        label: 'Clear Work Board filters',
        searchValue: 'clear filters',
        actionType: 'clear-filters',
        icon: 'Eraser',
    },
]
```

### Step 8: Run — expect 4/4 PASS

### Step 9: Commit + push

```bash
git add src/components/CommandPalette/trackedRepoCommands.js src/components/CommandPalette/workBoardGlobalCommands.js tests/components/CommandPalette/trackedRepoCommands.test.js tests/components/CommandPalette/workBoardGlobalCommands.test.js
git commit -m "feat(work-board): command palette builders for tracked repos"
git push origin main
```

---

## Task 2: Wire tracked-repo + global commands into CommandPalette

**Files:**

- Modify: `src/components/CommandPalette.jsx`
- Create: `tests/components/CommandPalette/CommandPalette-workboard.test.jsx`

### Scene

`src/components/CommandPalette.jsx` exports `CommandPalette({ isOpen, onClose, repos, activeView, onViewChange, onOpenModal, onSelectRepo, isAdmin })`.

We extend it to:
1. Import `useTrackedRepos` and `useToast`.
2. Call `buildTrackedRepoCommands(hook.repos)` + read `WORK_BOARD_GLOBAL_COMMANDS`.
3. Render two new `<Command.Group>` blocks ("Tracked Repositories" and "Work Board Actions").
4. Each item's `onSelect` calls the matching handler (`hook.pin/mute/.../discover/refresh`) then `onClose()`.
5. Global commands dispatch events via `window.dispatchEvent` for board-level reactions (Refresh Work Board, Toggle muted, Clear filters). `Refresh discovery` calls `hook.discover()` directly.

Handler wiring — single dispatcher function:

```javascript
async function runTrackedAction(item) {
    const repo = item.repoFullName
    switch (item.actionType) {
        case 'pin':    return hook.pin(repo)
        case 'unpin':  return hook.unpin(repo)
        case 'mute':   return hook.mute(repo)
        case 'unmute': return hook.unmute(repo)
        case 'untrack': return hook.untrack(repo)
        case 'refresh-discovery': return hook.discover()
        case 'refresh-board': window.dispatchEvent(new CustomEvent('workboard:refresh-all')); return null
        case 'toggle-muted': window.dispatchEvent(new CustomEvent('workboard:toggle-muted')); return null
        case 'clear-filters': window.dispatchEvent(new CustomEvent('workboard:clear-filters')); return null
        default: return null
    }
}
```

Each success calls `toast.success(item.label + ' ✓', { action: 'Undo', onAction: async () => { await hook.undo(result.operation_id) } })` when `result.operation_id` exists.

### Step 1: Write integration test

Create `tests/components/CommandPalette/CommandPalette-workboard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHook = {
    repos: [
        { repo_full_name: 'acme/x', is_pinned: 0, is_muted: 0 },
        { repo_full_name: 'acme/y', is_pinned: 1, is_muted: 0 },
    ],
    pin: vi.fn().mockResolvedValue({ operation_id: 'op-p', new_state: { is_pinned: 1 } }),
    unpin: vi.fn().mockResolvedValue({ operation_id: 'op-up', new_state: { is_pinned: 0 } }),
    mute: vi.fn().mockResolvedValue({ operation_id: 'op-m', new_state: { is_muted: 1 } }),
    unmute: vi.fn().mockResolvedValue({}),
    untrack: vi.fn().mockResolvedValue({ operation_id: 'op-un', new_state: null }),
    discover: vi.fn().mockResolvedValue({ discovered: 3, added: 3, removed: 0 }),
    refresh: vi.fn(),
    undo: vi.fn(),
}
vi.mock('../../../src/hooks/useTrackedRepos', () => ({
    useTrackedRepos: () => mockHook,
}))

const mockToast = { success: vi.fn(), error: vi.fn() }
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: mockToast }),
}))

vi.mock('../../../src/api/search', () => ({
    searchApi: { github: vi.fn().mockResolvedValue({ prs: [], issues: [], repos: [] }) },
}))

const { CommandPalette } = await import('../../../src/components/CommandPalette')

beforeEach(() => {
    for (const k of ['pin', 'unpin', 'mute', 'unmute', 'untrack', 'discover', 'undo']) mockHook[k].mockClear()
    mockToast.success.mockClear()
    mockToast.error.mockClear()
})

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    repos: [],
    activeView: 'dashboard',
    onViewChange: vi.fn(),
    onOpenModal: vi.fn(),
    onSelectRepo: vi.fn(),
    isAdmin: false,
}

describe('CommandPalette — Work Board commands', () => {
    it('renders Tracked Repositories group with Pin/Mute/Untrack per repo', () => {
        render(<CommandPalette {...baseProps} />)
        expect(screen.getByText(/Pin acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/Mute acme\/x/i)).toBeInTheDocument()
        expect(screen.getByText(/Stop tracking acme\/x/i)).toBeInTheDocument()
        // Pinned repo shows "Unpin" instead of "Pin"
        expect(screen.getByText(/Unpin acme\/y/i)).toBeInTheDocument()
    })

    it('selecting Pin acme/x calls hook.pin', async () => {
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Pin acme\/x/i))
        await waitFor(() => expect(mockHook.pin).toHaveBeenCalledWith('acme/x'))
    })

    it('selecting Refresh discovery calls hook.discover', async () => {
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Refresh discovery/i))
        await waitFor(() => expect(mockHook.discover).toHaveBeenCalled())
    })

    it('selecting Refresh Work Board dispatches workboard:refresh-all event', () => {
        const listener = vi.fn()
        window.addEventListener('workboard:refresh-all', listener)
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Refresh Work Board/i))
        expect(listener).toHaveBeenCalled()
        window.removeEventListener('workboard:refresh-all', listener)
    })

    it('selecting a mutation surfaces an undo toast when operation_id is present', async () => {
        render(<CommandPalette {...baseProps} />)
        fireEvent.click(screen.getByText(/Pin acme\/x/i))
        await waitFor(() => expect(mockToast.success).toHaveBeenCalled())
        const [, opts] = mockToast.success.mock.calls[0]
        expect(opts?.action).toBe('Undo')
    })
})
```

### Step 2: Run — expect FAIL (palette doesn't render these groups yet)

```bash
npx vitest run tests/components/CommandPalette/CommandPalette-workboard.test.jsx
```

### Step 3: Modify `src/components/CommandPalette.jsx`

At the top of the file, add imports (near existing icon imports around line 3-7). Update the lucide-react import to include `Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser`:

```javascript
import {
    GitFork, LayoutDashboard, Users, Tag, Map, Wand2, History, Plus,
    ArrowRightLeft, Settings, Kanban, GitPullRequest, CircleDot, Loader2,
    AlertTriangle, Wrench, BarChart3, Sparkles, Bookmark, ShieldAlert,
    Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser,
} from 'lucide-react'
```

Add imports for the hooks and builders (after the `searchApi` import):

```javascript
import { useTrackedRepos } from '../hooks/useTrackedRepos'
import { useToast } from '../hooks/useToast'
import { buildTrackedRepoCommands } from './CommandPalette/trackedRepoCommands'
import { WORK_BOARD_GLOBAL_COMMANDS } from './CommandPalette/workBoardGlobalCommands'
```

Add an icon resolver map near the top of the file (after the static items like NAVIGATE_ITEMS, ACTION_ITEMS):

```javascript
const WORK_BOARD_CMD_ICONS = {
    Pin, PinOff, Bell, BellOff, X, RefreshCw, RotateCw, Eraser,
}
```

Inside `CommandPalette({ ... })` (around line 111), right after the existing `const [query, setQuery] = useState('')` or equivalent state, call the hook and compute the commands:

```jsx
const trackedHook = useTrackedRepos()
const { toast } = useToast()
const trackedRepoCommands = buildTrackedRepoCommands(trackedHook.repos)
```

Add the action dispatcher (before the return):

```jsx
async function runWorkBoardCommand(item) {
    try {
        let result = null
        switch (item.actionType) {
            case 'pin':    result = await trackedHook.pin(item.repoFullName); break
            case 'unpin':  result = await trackedHook.unpin(item.repoFullName); break
            case 'mute':   result = await trackedHook.mute(item.repoFullName); break
            case 'unmute': result = await trackedHook.unmute(item.repoFullName); break
            case 'untrack': result = await trackedHook.untrack(item.repoFullName); break
            case 'refresh-discovery': result = await trackedHook.discover(); break
            case 'refresh-board': window.dispatchEvent(new CustomEvent('workboard:refresh-all')); break
            case 'toggle-muted': window.dispatchEvent(new CustomEvent('workboard:toggle-muted')); break
            case 'clear-filters': window.dispatchEvent(new CustomEvent('workboard:clear-filters')); break
            default: return
        }
        if (result?.operation_id) {
            toast.success(`${item.label} ✓`, {
                action: 'Undo',
                onAction: async () => { await trackedHook.undo(result.operation_id); toast.success('Reverted') },
            })
        } else {
            toast.success(`${item.label} ✓`)
        }
    } catch (e) {
        toast.error(`${item.label} failed: ${e.message}`)
    }
}
```

Render the two new groups inside the `<Command.List>` — after the existing Navigate group but before the Work Board tabs group (~line 210). Order: Work Board Actions first (global), then Tracked Repositories:

```jsx
<Command.Group heading="Work Board Actions" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
    {WORK_BOARD_GLOBAL_COMMANDS.map((item) => {
        const Icon = WORK_BOARD_CMD_ICONS[item.icon]
        return (
            <Command.Item
                key={item.id}
                value={item.searchValue}
                onSelect={() => { runWorkBoardCommand(item); onClose() }}
                className={ITEM_CLASSES}
            >
                {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                {item.label}
            </Command.Item>
        )
    })}
</Command.Group>

{trackedRepoCommands.length > 0 && (
    <Command.Group heading="Tracked Repositories" className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
        {trackedRepoCommands.map((item) => {
            const Icon = WORK_BOARD_CMD_ICONS[item.icon]
            return (
                <Command.Item
                    key={item.id}
                    value={item.searchValue}
                    onSelect={() => { runWorkBoardCommand(item); onClose() }}
                    className={ITEM_CLASSES}
                >
                    {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
                    {item.label}
                </Command.Item>
            )
        })}
    </Command.Group>
)}
```

### Step 4: Run integration test — expect 5/5 PASS

```bash
npx vitest run tests/components/CommandPalette/
```

Expected: all new tests pass + existing CommandPalette tests continue passing. If an existing CommandPalette test fails because the new groups appear, update the test to ignore them or to explicitly mock `useTrackedRepos` → `{ repos: [] }`.

### Step 5: Full regression

```bash
npx vitest run tests/
```

### Step 6: Commit + push

```bash
git add src/components/CommandPalette.jsx tests/components/CommandPalette/CommandPalette-workboard.test.jsx
git commit -m "feat(work-board): palette commands for pin/mute/track + refresh"
git push origin main
```

---

## Task 3: ⌘K discovery chip in Header + regression + docs

**Files:**

- Modify: `src/components/Header.jsx`
- Modify: `docs/architecture/work-board-tracking.md`

### Scene

Existing pattern in the codebase: pressing ⌘K (or Ctrl+K) already opens the CommandPalette (grep confirms there's a global key listener). The chip is a visual affordance — discoverability for users who don't know the shortcut exists.

Placement: in the Header, typically to the left of the nav buttons or next to the logo. Should be subtle — a small rounded pill showing "⌘K" in monospace.

### Step 1: Locate Header

```bash
git grep -n "showCommandPalette\|command-palette\|CommandPalette" src/components/Header.jsx src/App.jsx | head -10
```

Identify how App opens the palette (there's likely a modal state or `openModalWithData('showCommandPalette')` pattern). Re-use that.

### Step 2: Add the chip

In `src/components/Header.jsx`, find the main header row (the `<header>` element's primary flex container — usually right after the logo section). Add a small button between the logo and the nav:

```jsx
<button
    type="button"
    onClick={onOpenCommandPalette}
    aria-label="Open command palette (Ctrl+K)"
    title="Open command palette (Ctrl+K)"
    className="hidden md:inline-flex items-center gap-1.5 px-2 h-[28px] rounded-lg text-[11px] font-medium text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/50 bg-white/40 dark:bg-slate-800/40 hover:bg-white/70 dark:hover:bg-slate-800/70 transition-colors"
>
    <kbd className="font-mono">⌘K</kbd>
</button>
```

Add `onOpenCommandPalette` to Header's props destructuring:

```jsx
export function Header({ activeView, onViewChange, onOpenCommandPalette, ... }) {
```

### Step 3: Plumb onOpenCommandPalette from App.jsx

In `src/App.jsx`, locate where `<Header ... />` is rendered. Add the callback. It should dispatch whatever already opens the CommandPalette (check how existing ⌘K shortcut opens it):

```jsx
<Header
    activeView={activeView}
    onViewChange={setActiveView}
    onOpenCommandPalette={() => openModalWithData('showCommandPalette')}
    ... other props
/>
```

Adapt to whatever the existing pattern is. Likely either ModalContext's `openModalWithData` or a local state setter.

### Step 4: Full regression

```bash
npx vitest run tests/
```

Expected: all tests pass. If a Header test breaks because of the new prop, make it optional in the component (default `onOpenCommandPalette = () => {}`) or update the test to pass a stub.

### Step 5: Build

```bash
npm run build
```

### Step 6: Append Phase 5 section to architecture doc

Append to `docs/architecture/work-board-tracking.md`:

```markdown
## Phase 5 Command Palette (shipped)

The `⌘K` palette (existing `src/components/CommandPalette.jsx`) now includes
two new command groups that let power users do tracking operations
keyboard-first from anywhere in the app.

### New command groups

- **Work Board Actions** (global — always visible):
  - Refresh discovery
  - Refresh Work Board (dispatches `workboard:refresh-all`)
  - Toggle muted repos in Work Board (dispatches `workboard:toggle-muted`)
  - Clear Work Board filters (dispatches `workboard:clear-filters`)

- **Tracked Repositories** (one group per active session; rendered only
  when `useTrackedRepos().repos.length > 0`):
  - `Pin <repo>` / `Unpin <repo>`
  - `Mute <repo>` / `Unmute <repo>`
  - `Stop tracking <repo>`

### Discovery chip

A small `⌘K` pill lives in the Header next to the logo (hidden on
mobile). Clicking it opens the palette. Purely a discoverability
affordance — the global keyboard shortcut is unchanged.

### Architecture

Commands come from two pure builders:
- `buildTrackedRepoCommands(repos)` — generates per-repo items.
- `WORK_BOARD_GLOBAL_COMMANDS` — constant array of 4 global items.

Both are framework-free and unit-tested in isolation. `CommandPalette.jsx`
resolves lucide icons from string names and wires handlers via a single
`runWorkBoardCommand(item)` dispatcher that calls `useTrackedRepos` for
repo-scoped actions and `window.dispatchEvent` for view-scoped ones.

Every mutation surfaces an undo toast, matching the Phase 2/3 UX.
```

### Step 7: Commit + push

```bash
git add src/components/Header.jsx src/App.jsx docs/architecture/work-board-tracking.md
git commit -m "feat(work-board): Ctrl+K chip in header + Phase 5 docs"
git push origin main
```

Report:
- Total test count (pass / total)
- Build status
- Commit SHAs from the three tasks

---

## Self-review checklist

- [ ] Builder functions are pure — no React, no `window` access.
- [ ] Icon string → component resolution handles unknown icons (falls back to no-icon).
- [ ] `runWorkBoardCommand` always closes the palette AFTER the action starts, so the mutation and subsequent undo toast are not blocked by the palette dismiss animation.
- [ ] Undo toast is present for every mutation with an `operation_id`.
- [ ] `⌘K` chip hides on mobile (below md breakpoint) where keyboard shortcuts are irrelevant.
- [ ] Existing palette command groups (Navigate, Actions, Work Board tabs, repos, GitHub search) continue working unchanged.

## What's NOT in Phase 5

- **`/ai` prefix handling** — Phase 6-7.
- **Server-side repo fuzzy search** for non-tracked repos — palette currently doesn't let you pin a repo you haven't seen yet. Phase 5.1 can wire `/api/v1/work-board/repo-search` when the user types more than the tracked set covers.
- **Custom keybindings** per action — all wait for cmdk's keybind system in a future iteration.
- **Mobile full-screen palette** — deferred; desktop-only for now.
