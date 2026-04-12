# Context Menu Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken bulk actions, remove misleading duplicate menu items, and add missing icons for full visual consistency across all context menus.

**Architecture:** Two files change — `RepoContextMenu.jsx` (menu structure, icons, items) and `App.jsx` (missing `handleQuickAction` cases for bulk operations). No backend changes needed.

**Tech Stack:** React 19, lucide-react icons, existing ModalContext + useSelection hooks.

---

### Task 1: Add missing icons and clean up imports in RepoContextMenu.jsx

**Files:**
- Modify: `src/components/RepoContextMenu.jsx:1-6` (imports), lines 51-84 (menu items)

- [ ] **Step 1: Update icon imports**

Replace the existing import block at line 3-6:

```jsx
import {
	ExternalLink, Copy, Settings, Rocket, Sparkles, Package,
	Lock, Unlock, Archive, Trash2, RefreshCw, Wand2, GitCompare, Shield,
	BarChart3, Lightbulb, ArrowRightLeft, GitFork, Download, Upload, History, FlaskConical
} from 'lucide-react'
```

- [ ] **Step 2: Add icons to Migration submenu children (lines 51-55)**

Replace the Migration children array with:

```jsx
children: [
	{ label: 'Migrate to GitHub', icon: Upload, onClick: () => onAction('migrate', repo) },
	{ label: 'Migration History', icon: History, onClick: () => onAction('migrationHistory', repo) },
	{ label: 'Dry-Run (Simulate)', icon: FlaskConical, onClick: () => onAction('dryRun', repo) }
]
```

This removes the duplicate "Migrate Work Items" and "Migrate Wiki" entries (they opened the exact same wizard with no differentiation) and adds icons to all remaining items.

- [ ] **Step 3: Add icons to AI submenu children (lines 62-68)**

Replace the AI children array with:

```jsx
children: [
	{ label: 'Generate Commit Message', icon: Wand2, onClick: () => onAction('aiCommit', repo) },
	{ label: 'Quality Report', icon: BarChart3, onClick: () => onAction('aiQuality', repo) },
	{ label: 'Suggest Name & Description', icon: Lightbulb, onClick: () => onAction('aiSuggest', repo) },
	{ label: 'Compare with Existing', icon: GitCompare, onClick: () => onAction('aiCompare', repo) },
	{ label: 'Security / Secrets Scan', icon: Shield, onClick: () => onAction('aiSecurity', repo) }
]
```

- [ ] **Step 4: Add icons to Management submenu children (lines 73-85)**

Replace the Management children array with:

```jsx
children: [
	{ label: 'Transfer to Org', icon: ArrowRightLeft, onClick: () => onAction('transfer', repo) },
	{ label: 'Mirror / Fork', icon: GitFork, onClick: () => onAction('mirror', repo) },
	{
		id: 'sync',
		label: 'Sync Repository',
		icon: RefreshCw,
		disabled: !repo.isMirror,
		tooltip: repo.isMirror ? null : 'Only available for mirrored repos',
		onClick: () => onAction('sync', repo)
	},
	{ label: 'Export Metadata (JSON)', icon: Download, onClick: () => onAction('exportMeta', repo) }
]
```

- [ ] **Step 5: Verify the app compiles**

Run: `cd "s:/Git Hub Repo Manager" && npx vite build --mode development 2>&1 | head -20`
Expected: Build succeeds with no errors about missing imports.

- [ ] **Step 6: Commit**

```bash
git add src/components/RepoContextMenu.jsx
git commit -m "fix(menu): add missing icons, remove duplicate migration items"
```

---

### Task 2: Fix broken bulk action handlers in App.jsx

**Files:**
- Modify: `src/App.jsx:314-382` (handleQuickAction switch)

- [ ] **Step 1: Add `archive_selected` case**

After the existing `case 'archive':` block (line 352), add this new case before `case 'transfer':`:

```jsx
      case 'archive_selected':
        openModalWithData('showConfirm', {
          title: `Archive ${selectedRepos.length} repositories?`,
          message: `This will archive ${selectedRepos.length} repositories, making them read-only. You can unarchive them later.`,
          variant: 'warning',
          onConfirm: async () => {
            try {
              await archiveRepos(selectedRepos.map(r => r.full_name), true)
              toast.success(`${selectedRepos.length} repositories archived`)
              closeModal('showConfirm')
              refresh()
            } catch (err) {
              toast.error(`Failed to archive: ${err.message}`)
            }
          }
        })
        break
```

Note: `selectedRepos` is already in scope (computed at line 417, and `handleQuickAction` is a closure defined at line 314 within the same component scope).

- [ ] **Step 2: Add `delete_selected` case**

After the new `archive_selected` case, add:

```jsx
      case 'delete_selected':
        openModalWithData('showConfirm', {
          title: `Delete ${selectedRepos.length} repositories?`,
          message: `This will permanently delete ${selectedRepos.length} repositories and all their data. This action cannot be undone.`,
          variant: 'danger',
          confirmText: 'Delete All',
          onConfirm: async () => {
            try {
              await deleteRepos(selectedRepos.map(r => r.full_name))
              toast.success(`${selectedRepos.length} repositories deleted`)
              closeModal('showConfirm')
              refresh()
            } catch (err) {
              toast.error(`Failed to delete: ${err.message}`)
            }
          }
        })
        break
```

- [ ] **Step 3: Add `transfer_selected` case**

After `case 'mirror':` (line 360), add:

```jsx
      case 'transfer_selected':
        openModalWithData('showTransfer', selectedRepos)
        break
```

- [ ] **Step 4: Remove dead cases from RepoList.jsx onAction handler**

In `src/components/RepoList.jsx`, the `onAction` handler (line 484) has cases for the removed migration actions. Remove these dead cases:

```jsx
// Remove these two lines from the case group at lines 506-507:
case 'migrateWorkItems':
case 'migrateWiki':
```

So the migration case becomes just:
```jsx
case 'migrate':
case 'migrate_selected':
	openModal('showMigrationWizard')
	break
```

- [ ] **Step 5: Verify the app compiles**

Run: `cd "s:/Git Hub Repo Manager" && npx vite build --mode development 2>&1 | head -20`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/RepoList.jsx
git commit -m "fix(menu): wire bulk archive/delete/transfer handlers in handleQuickAction"
```

---

### Task 3: Visual verification

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `cd "s:/Git Hub Repo Manager" && npm run dev`

- [ ] **Step 2: Verify single-repo context menu**

Right-click a repo card and verify:
1. All Migration submenu items have icons (Upload, History, FlaskConical)
2. "Migrate Work Items" and "Migrate Wiki" are gone — only 3 items remain
3. All AI submenu items have icons (Wand2, BarChart3, Lightbulb, GitCompare, Shield)
4. All Management submenu items have icons (ArrowRightLeft, GitFork, RefreshCw, Download)

- [ ] **Step 3: Verify bulk context menu**

Select 2+ repos, right-click, and verify:
1. "Archive N repos" opens a confirmation modal and works
2. "Delete N repos" opens a confirmation modal (with danger styling) and works
3. Migration > "Migrate N repos" opens the migration wizard
4. Management > "Transfer N repos" opens the transfer modal
5. Management > "Export Metadata (JSON)" downloads JSON files

- [ ] **Step 4: Verify toolbar buttons**

With 2+ repos selected, verify the toolbar Archive and Delete buttons now trigger confirmation modals (they use the same `archive_selected`/`delete_selected` actions).
