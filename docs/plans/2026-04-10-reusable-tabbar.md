# Reusable TabBar Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `<TabBar>` component with 3 visual variants, full WAI-ARIA compliance, and keyboard navigation, then migrate all 8 consumers to use it.

**Architecture:** Create `src/components/ui/TabBar.jsx` with pill/underline/segmented variants. Each variant provides consistent ARIA semantics and keyboard navigation. Migrate consumers one-by-one, replacing their inline tab rendering with the shared component. Consumers keep their own tab state and content rendering.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Vitest + Testing Library

**Spec:** `docs/specs/2026-04-10-reusable-tabbar-design.md`

---

### Task 1: Create the TabBar component

**Files:**
- Create: `src/components/ui/TabBar.jsx`

- [ ] **Step 1: Create `src/components/ui/TabBar.jsx`**

```jsx
import { motion } from 'framer-motion';

const VARIANT_CONTAINER = {
    pill: 'flex gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40',
    underline: 'flex border-b border-slate-200/50 dark:border-slate-800/40',
    segmented: 'flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden',
};

const VARIANT_BUTTON = {
    pill: {
        active: 'text-slate-900 dark:text-white',
        inactive: 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
    },
    underline: {
        active: 'text-indigo-600 dark:text-indigo-400',
        inactive: 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
    },
    segmented: {
        active: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-md',
        inactive: 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
    },
};

const VARIANT_INDICATOR = {
    pill: 'absolute inset-0 rounded-xl bg-white dark:bg-slate-700 shadow-sm',
    underline: 'absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full',
    segmented: null,
};

const SIZE_CLASSES = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
};

export function TabBar({ tabs, activeTab, onTabChange, variant = 'pill', layoutId, className = '', size = 'md' }) {
    const handleKeyDown = (e) => {
        const currentIndex = tabs.findIndex(t => t.id === activeTab);
        let nextIndex;

        switch (e.key) {
            case 'ArrowRight':
                nextIndex = (currentIndex + 1) % tabs.length;
                break;
            case 'ArrowLeft':
                nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = tabs.length - 1;
                break;
            default:
                return;
        }

        e.preventDefault();
        onTabChange(tabs[nextIndex].id);
        document.getElementById(`tab-${layoutId}-${tabs[nextIndex].id}`)?.focus();
    };

    const indicatorClass = VARIANT_INDICATOR[variant];

    return (
        <div
            role="tablist"
            className={`${VARIANT_CONTAINER[variant]} ${className}`}
            onKeyDown={handleKeyDown}
        >
            {tabs.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                const buttonStyle = VARIANT_BUTTON[variant];
                return (
                    <button
                        key={id}
                        id={`tab-${layoutId}-${id}`}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        aria-controls={`tabpanel-${layoutId}-${id}`}
                        onClick={() => onTabChange(id)}
                        className={`relative flex items-center gap-1.5 ${SIZE_CLASSES[size]} font-medium whitespace-nowrap transition-colors ${
                            isActive ? buttonStyle.active : buttonStyle.inactive
                        }`}
                    >
                        {isActive && indicatorClass && (
                            <motion.div
                                layoutId={layoutId}
                                className={indicatorClass}
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className={indicatorClass ? 'relative z-10 flex items-center gap-1.5' : 'flex items-center gap-1.5'}>
                            {Icon && <Icon className="w-4 h-4" />}
                            {label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 2: Verify file created without errors**

Run: `npx vitest run --passWithNoTests`
Expected: No import errors. All existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/TabBar.jsx
git commit -m "feat(ui): create reusable TabBar component with 3 variants and keyboard nav"
```

---

### Task 2: Add TabBar unit tests

**Files:**
- Create: `tests/components/ui/TabBar.test.jsx`

- [ ] **Step 1: Create the test file**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabBar } from '../../../src/components/ui/TabBar';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', async () => {
    const actual = await vi.importActual('framer-motion');
    return {
        ...actual,
        useReducedMotion: () => true,
    };
});

const TABS = [
    { id: 'files', label: 'Files' },
    { id: 'activity', label: 'Activity' },
    { id: 'settings', label: 'Settings' },
];

const MockIcon = ({ className }) => <svg data-testid="mock-icon" className={className} />;

const TABS_WITH_ICONS = [
    { id: 'files', label: 'Files', icon: MockIcon },
    { id: 'activity', label: 'Activity', icon: MockIcon },
];

describe('TabBar', () => {
    it('renders all tabs with correct ARIA attributes', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.getByRole('tablist')).toBeInTheDocument();
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);

        expect(tabs[0]).toHaveTextContent('Files');
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[0]).toHaveAttribute('tabindex', '0');
        expect(tabs[0]).toHaveAttribute('aria-controls', 'tabpanel-test-files');
        expect(tabs[0]).toHaveAttribute('id', 'tab-test-files');

        expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
        expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    });

    it('calls onTabChange when a tab is clicked', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        await user.click(screen.getByRole('tab', { name: /Activity/i }));
        expect(onTabChange).toHaveBeenCalledWith('activity');
    });

    it('navigates with ArrowRight and wraps around', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="settings" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        screen.getByRole('tab', { name: /Settings/i }).focus();
        await user.keyboard('{ArrowRight}');
        expect(onTabChange).toHaveBeenCalledWith('files');
    });

    it('navigates with ArrowLeft and wraps around', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        screen.getByRole('tab', { name: /Files/i }).focus();
        await user.keyboard('{ArrowLeft}');
        expect(onTabChange).toHaveBeenCalledWith('settings');
    });

    it('navigates with Home and End keys', async () => {
        const onTabChange = vi.fn();
        const user = userEvent.setup();

        render(
            <TabBar tabs={TABS} activeTab="activity" onTabChange={onTabChange} variant="pill" layoutId="test" />
        );

        screen.getByRole('tab', { name: /Activity/i }).focus();
        await user.keyboard('{Home}');
        expect(onTabChange).toHaveBeenCalledWith('files');

        await user.keyboard('{End}');
        expect(onTabChange).toHaveBeenCalledWith('settings');
    });

    it('renders icons when provided', () => {
        render(
            <TabBar tabs={TABS_WITH_ICONS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.getAllByTestId('mock-icon')).toHaveLength(2);
    });

    it('renders without icons when not provided', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.queryByTestId('mock-icon')).not.toBeInTheDocument();
    });

    it('renders pill variant with correct container class', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" />
        );

        expect(screen.getByRole('tablist').className).toContain('rounded-2xl');
    });

    it('renders underline variant with correct container class', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="underline" layoutId="test" />
        );

        expect(screen.getByRole('tablist').className).toContain('border-b');
    });

    it('renders segmented variant with correct container class', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="segmented" layoutId="test" />
        );

        expect(screen.getByRole('tablist').className).toContain('rounded-lg');
    });

    it('applies size="sm" classes', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" size="sm" />
        );

        const tab = screen.getAllByRole('tab')[0];
        expect(tab.className).toContain('text-xs');
    });

    it('applies custom className to container', () => {
        render(
            <TabBar tabs={TABS} activeTab="files" onTabChange={() => {}} variant="pill" layoutId="test" className="mt-4" />
        );

        expect(screen.getByRole('tablist').className).toContain('mt-4');
    });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/components/ui/TabBar.test.jsx`
Expected: All 11 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/components/ui/TabBar.test.jsx
git commit -m "test(ui): add TabBar unit tests for variants, ARIA, and keyboard nav"
```

---

### Task 3: Export TabBar from ui barrel

**Files:**
- Modify: `src/components/ui/index.js`

- [ ] **Step 1: Add export**

Add this line at the end of `src/components/ui/index.js`:

```js
export { TabBar } from './TabBar'
```

- [ ] **Step 2: Verify**

Run: `npx vitest run tests/components/ui/TabBar.test.jsx`
Expected: All 11 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/index.js
git commit -m "chore(ui): export TabBar from ui barrel"
```

---

### Task 4: Migrate CommunityHealthDashboard

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`
- Modify: `tests/components/CommunityHealthDashboard.test.jsx`

- [ ] **Step 1: Replace inline TabBar with shared component**

In `src/components/CommunityHealthDashboard.jsx`:

1. Add import at top (after the `useFocusTrap` import):
```jsx
import { TabBar } from './ui/TabBar';
```

2. Remove the `TABS` constant (lines ~79-83).

3. Remove the entire `TabBar` function (lines ~85-150 approximately — the function including `handleKeyDown`).

4. Add a new module-level constant (where TABS was):
```jsx
const HEALTH_TABS = [
    { id: 'files', label: 'Files', icon: FileText },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'recommendations', label: 'Recommendations', icon: TrendingUp },
];
```

5. In the `CommunityHealthDashboard` function, remove `handleTabChange` and `tabDirection` state. Replace with:
```jsx
const isDesktop = useIsDesktop();
const [activeTab, setActiveTab] = useState('files');
```

6. Replace the `<TabBar activeTab={activeTab} onTabChange={handleTabChange} />` usage with:
```jsx
<TabBar
    tabs={HEALTH_TABS}
    activeTab={activeTab}
    onTabChange={setActiveTab}
    variant="pill"
    layoutId="health-tabs"
/>
```

7. Replace the tabpanel `motion.div` attributes. Remove `custom={tabDirection}` and direction-based animation. Replace with simple fade:
```jsx
<AnimatePresence mode="wait">
    <motion.div
        key={activeTab}
        role="tabpanel"
        id={`tabpanel-health-tabs-${activeTab}`}
        aria-labelledby={`tab-health-tabs-${activeTab}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
    >
```

Note: The directional slide animation (`tabDirection`) added earlier is removed because the shared TabBar doesn't manage direction state. A simple fade is cleaner and consistent. If directional animation is wanted later, it can be added to all consumers uniformly.

- [ ] **Step 2: Update tests**

In `tests/components/CommunityHealthDashboard.test.jsx`, update the tab ID assertions. The new IDs use the `layoutId` prefix. Update any `getByRole('tab', { name: ... })` calls if they break — they should still work since they match by text content, not ID.

Check the keyboard navigation test — it should still pass since the shared TabBar has the same keyboard handling.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: All 11 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx tests/components/CommunityHealthDashboard.test.jsx
git commit -m "refactor(health): migrate to shared TabBar component"
```

---

### Task 5: Migrate SettingsModal

**Files:**
- Modify: `src/components/SettingsModal.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from './ui/TabBar';
```

- [ ] **Step 2: Replace inline tab rendering**

The existing tab bar is at approximately lines 122-144. Replace:

```jsx
{/* Tab bar */}
<div className="flex border-b border-slate-200/50 dark:border-slate-800/40 bg-slate-50/50 dark:bg-slate-900/40 px-4 overflow-x-auto flex-shrink-0">
    {TABS.map(({ id, label, icon: TabIcon }) => (
        <button
            key={id}
            onClick={() => setActiveTab(id)}
            ...
        </button>
    ))}
</div>
```

With:

```jsx
{/* Tab bar */}
<div className="bg-slate-50/50 dark:bg-slate-900/40 px-4 overflow-x-auto flex-shrink-0">
    <TabBar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        variant="underline"
        layoutId="settings-tabs"
    />
</div>
```

- [ ] **Step 3: Add tabpanel attributes to content container**

Find the `<div className="flex-1 overflow-y-auto">` that wraps tab content. Add ARIA attributes:

```jsx
<div className="flex-1 overflow-y-auto" role="tabpanel" id={`tabpanel-settings-tabs-${activeTab}`} aria-labelledby={`tab-settings-tabs-${activeTab}`}>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.jsx
git commit -m "refactor(settings): migrate to shared TabBar component"
```

---

### Task 6: Migrate RepoDetail

**Files:**
- Modify: `src/components/RepoDetail/RepoDetail.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from '../ui/TabBar'
```

- [ ] **Step 2: Replace inline tab rendering**

Replace the tabs section (approximately lines 130-152):

```jsx
{/* Tabs */}
<div className="border-b border-slate-200 dark:border-slate-700">
    <nav className="flex gap-1 -mb-px overflow-x-auto custom-scrollbar">
        {TABS.map(tab => {
            ...
        })}
    </nav>
</div>
```

With:

```jsx
{/* Tabs */}
<TabBar
    tabs={TABS}
    activeTab={activeTab}
    onTabChange={setActiveTab}
    variant="underline"
    layoutId="repo-detail-tabs"
    className="overflow-x-auto"
/>
```

- [ ] **Step 3: Add tabpanel attributes to content container**

Find the `<div>` that wraps the tab content (the one with `{activeTab === 'overview' && ...}`). Add:

```jsx
<div role="tabpanel" id={`tabpanel-repo-detail-tabs-${activeTab}`} aria-labelledby={`tab-repo-detail-tabs-${activeTab}`}>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoDetail/RepoDetail.jsx
git commit -m "refactor(repo-detail): migrate to shared TabBar component"
```

---

### Task 7: Migrate RepoInsightsModal

**Files:**
- Modify: `src/components/AI/RepoInsightsModal.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from '../ui/TabBar';
```

- [ ] **Step 2: Replace inline tab rendering**

Replace the tabs section (approximately lines 105-122):

```jsx
{analysis && !loading && (
    <div className="flex border-b border-slate-200/50 dark:border-slate-800/40 px-4 bg-slate-50/50 dark:bg-slate-900/50">
        {tabs.map(tab => (
            <button ...>
                ...
            </button>
        ))}
    </div>
)}
```

With:

```jsx
{analysis && !loading && (
    <div className="px-4 bg-slate-50/50 dark:bg-slate-900/50">
        <TabBar
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            variant="underline"
            layoutId="repo-insights-tabs"
        />
    </div>
)}
```

- [ ] **Step 3: Add tabpanel attributes to content area**

Find the content wrapper that contains `{activeTab === 'overview' && ...}`. Add:

```jsx
role="tabpanel" id={`tabpanel-repo-insights-tabs-${activeTab}`} aria-labelledby={`tab-repo-insights-tabs-${activeTab}`}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AI/RepoInsightsModal.jsx
git commit -m "refactor(insights): migrate to shared TabBar component"
```

---

### Task 8: Migrate OrgManagerModal

**Files:**
- Modify: `src/components/OrgManagerModal.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from './ui/TabBar';
```

- [ ] **Step 2: Add TABS constant**

The current code uses a raw string array `['overview', 'members', 'settings']`. Add a constant near the top of the file:

```jsx
const ORG_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'settings', label: 'Settings' },
];
```

- [ ] **Step 3: Replace inline tab rendering**

Replace the tabs section (approximately lines 132-146):

```jsx
<div className="flex border-b border-slate-200 dark:border-slate-700 px-6 bg-white/80 dark:bg-slate-900/60">
    {['overview', 'members', 'settings'].map(tab => (
        <button ...>
            {tab}
        </button>
    ))}
</div>
```

With:

```jsx
<div className="px-6 bg-white/80 dark:bg-slate-900/60">
    <TabBar
        tabs={ORG_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        variant="underline"
        layoutId="org-manager-tabs"
    />
</div>
```

- [ ] **Step 4: Add tabpanel attributes to content area**

Find the content wrapper that contains the `activeTab === 'overview'` conditional. Add:

```jsx
role="tabpanel" id={`tabpanel-org-manager-tabs-${activeTab}`} aria-labelledby={`tab-org-manager-tabs-${activeTab}`}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/OrgManagerModal.jsx
git commit -m "refactor(org-manager): migrate to shared TabBar component"
```

---

### Task 9: Migrate PRDetailPanel

**Files:**
- Modify: `src/components/RepoDetail/PRDetailPanel.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from '../ui/TabBar'
```

- [ ] **Step 2: Replace inline tab rendering**

Replace the tabs section (approximately lines 258-272):

```jsx
<div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
    {tabs.map(tab => (
        <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
        >
            {tab.label}
        </button>
    ))}
</div>
```

With:

```jsx
<TabBar
    tabs={tabs}
    activeTab={activeTab}
    onTabChange={setActiveTab}
    variant="segmented"
    layoutId="pr-detail-tabs"
/>
```

- [ ] **Step 3: Add tabpanel attributes to content sections**

Find the wrapper that contains `{activeTab === 'overview' && ...}`. If there is no single wrapper div, wrap the tab content conditionals in:

```jsx
<div role="tabpanel" id={`tabpanel-pr-detail-tabs-${activeTab}`} aria-labelledby={`tab-pr-detail-tabs-${activeTab}`}>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/RepoDetail/PRDetailPanel.jsx
git commit -m "refactor(pr-detail): migrate to shared TabBar component"
```

---

### Task 10: Migrate MigrationHistory

**Files:**
- Modify: `src/components/MigrationHistory.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from './ui/TabBar';
```

- [ ] **Step 2: Add TABS constant**

Add near the top of the file. The current code uses inline buttons with `ListChecks` and `History` icons:

```jsx
import { ListChecks, History } from 'lucide-react';
// ... (verify these are already imported)

const MIGRATION_TABS = [
    { id: 'plans', label: 'Plans', icon: ListChecks },
    { id: 'legacy', label: 'Legacy Jobs', icon: History },
];
```

- [ ] **Step 3: Replace inline tab rendering**

Replace the tab toggle section (approximately lines 119-136):

```jsx
<div className="flex items-center gap-1 mb-4 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 overflow-hidden w-fit">
    <button onClick={() => setActiveTab('plans')} ...>
        <ListChecks className="w-3.5 h-3.5" />
        Plans
    </button>
    <button onClick={() => setActiveTab('legacy')} ...>
        <History className="w-3.5 h-3.5" />
        Legacy Jobs
    </button>
</div>
```

With:

```jsx
<div className="mb-4 w-fit">
    <TabBar
        tabs={MIGRATION_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        variant="segmented"
        layoutId="migration-tabs"
        size="sm"
    />
</div>
```

- [ ] **Step 4: Add tabpanel attributes to content area**

Find the content wrapper that conditionally renders based on `activeTab`. Add:

```jsx
role="tabpanel" id={`tabpanel-migration-tabs-${activeTab}`} aria-labelledby={`tab-migration-tabs-${activeTab}`}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/MigrationHistory.jsx
git commit -m "refactor(migration): migrate to shared TabBar component"
```

---

### Task 11: Migrate TeamDetails

**Files:**
- Modify: `src/components/Teams/TeamDetails.jsx`

- [ ] **Step 1: Add import**

Add after existing imports:
```jsx
import { TabBar } from '../ui/TabBar'
```

- [ ] **Step 2: Add TABS constant**

Add near the top of the file:

```jsx
const TEAM_TABS = [
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'members', label: 'Members', icon: Users },
    { id: 'repos', label: 'Repositories', icon: Github },
    { id: 'actions', label: 'Actions', icon: Zap },
];
```

Verify `Activity`, `Users`, `Github`, and `Zap` are already imported from lucide-react. The `Members` tab label currently includes `({members.length})` — since this is dynamic, keep it in the constant but update it with the count. Alternative: use a static label and show counts elsewhere. For consistency with the TabBar API (which expects static labels), use static labels.

- [ ] **Step 3: Replace inline TabButton calls**

Replace the tab buttons section (approximately lines 157-170):

```jsx
<div className="flex gap-4 mt-8">
    <TabButton active={activeTab === 'activity'} onClick={() => setActiveTab('activity')} icon={Activity}>
        Activity
    </TabButton>
    <TabButton active={activeTab === 'members'} onClick={() => setActiveTab('members')} icon={Users}>
        Members ({members.length})
    </TabButton>
    <TabButton active={activeTab === 'repos'} onClick={() => setActiveTab('repos')} icon={Github}>
        Repositories ({assignedRepos.length})
    </TabButton>
    <TabButton active={activeTab === 'actions'} onClick={() => setActiveTab('actions')} icon={Zap}>
        Actions
    </TabButton>
</div>
```

With:

```jsx
<div className="mt-8">
    <TabBar
        tabs={TEAM_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        variant="pill"
        layoutId="team-detail-tabs"
    />
</div>
```

- [ ] **Step 4: Remove the inline `TabButton` function**

Delete the `TabButton` function at the bottom of the file (approximately lines 392-405).

- [ ] **Step 5: Add tabpanel attributes to the AnimatePresence content**

Find the `<AnimatePresence mode="wait">` section that renders tab content. Each `motion.div` inside should get:

```jsx
role="tabpanel" id={`tabpanel-team-detail-tabs-${activeTab}`} aria-labelledby={`tab-team-detail-tabs-${activeTab}`}
```

Since AnimatePresence renders one child at a time, add these attributes to the wrapping `motion.div` of each tab's content.

- [ ] **Step 6: Run tests**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/Teams/TeamDetails.jsx
git commit -m "refactor(teams): migrate to shared TabBar component"
```

---

### Task 12: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full project test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Verify no remaining inline tab patterns**

Run: `grep -r "role=\"tablist\"" src/ --include="*.jsx" -l`
Expected: Only `src/components/ui/TabBar.jsx` should appear.

Run: `grep -rn "activeTab === " src/ --include="*.jsx" | grep -v "TabBar.jsx" | grep -v "test"`
Expected: Only tab content conditionals remain (the `{activeTab === 'overview' && ...}` patterns). No inline tab button rendering.

- [ ] **Step 3: Start the dev server and visually verify**

Run: `npm run dev`

Spot-check in browser:
1. **CommunityHealthDashboard** — pill tabs on desktop, keyboard nav works
2. **SettingsModal** — underline tabs, keyboard nav works
3. **RepoDetail** — underline tabs, keyboard nav works
4. **MigrationHistory** — segmented compact tabs, keyboard nav works

- [ ] **Step 4: Final commit if any tweaks were needed**

```bash
git add -A
git commit -m "style(ui): polish TabBar migrations after visual review"
```
