# Community Health Dashboard — Tabbed Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed interface to the Community Health Dashboard on desktop while preserving the current scroll layout on mobile.

**Architecture:** Add an inline `useIsDesktop` hook (matchMedia 1024px) and a `TabBar` sub-component to `CommunityHealthDashboard.jsx`. On desktop, the Health Score stays always visible while Files/Activity/Recommendations are shown in tabs with animated transitions. On mobile (< 1024px), everything renders as-is.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Vitest + Testing Library

**Spec:** `docs/specs/2026-04-10-community-health-tabs-design.md`

---

### Task 1: Add `useIsDesktop` hook inline

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx:1-9` (imports/top of file)

- [ ] **Step 1: Add the `useIsDesktop` hook after existing imports**

Add this function after line 9 (after the `useFocusTrap` import), before `getScoreConfig`:

```jsx
function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);

    useEffect(() => {
        const mql = window.matchMedia('(min-width: 1024px)');
        const onChange = (e) => setIsDesktop(e.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return isDesktop;
}
```

This follows the exact same pattern as `src/hooks/useMobileBreakpoint.jsx` but targets `min-width: 1024px`.

- [ ] **Step 2: Verify no syntax errors**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: All 6 existing tests PASS (hook is defined but not yet used).

- [ ] **Step 3: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): add useIsDesktop hook for responsive tab layout"
```

---

### Task 2: Add `TabBar` sub-component

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx` (add before `CommunityHealthDashboard` export)

- [ ] **Step 1: Write the failing test for TabBar rendering**

Add this test to `tests/components/CommunityHealthDashboard.test.jsx`, inside the existing `describe` block, after the last `it`:

```jsx
it('renders tab bar on desktop viewport', async () => {
    // Mock desktop viewport
    window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));

    global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealthData)
    });

    render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

    await waitFor(() => {
        expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent('Files');
    expect(tabs[1]).toHaveTextContent('Activity');
    expect(tabs[2]).toHaveTextContent('Recommendations');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: FAIL — no element with role `tablist` found.

- [ ] **Step 3: Add the `TabBar` component**

Add this function in `CommunityHealthDashboard.jsx`, right before the `CommunityHealthDashboard` export function:

```jsx
const TABS = [
    { id: 'files', label: 'Files', icon: FileText },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'recommendations', label: 'Recommendations', icon: TrendingUp },
];

function TabBar({ activeTab, onTabChange }) {
    return (
        <div
            role="tablist"
            className="flex gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40"
        >
            {TABS.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                return (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`tabpanel-${id}`}
                        onClick={() => onTabChange(id)}
                        className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                            isActive
                                ? 'text-slate-900 dark:text-white'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="health-tab-indicator"
                                className="absolute inset-0 rounded-xl bg-white dark:bg-slate-700 shadow-sm"
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className="relative z-10 flex items-center gap-2">
                            <Icon className="w-4 h-4" />
                            {label}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: Still FAIL — `TabBar` exists but is not yet rendered in the main component. That happens in Task 3.

- [ ] **Step 5: Commit the TabBar component (no integration yet)**

```bash
git add src/components/CommunityHealthDashboard.jsx tests/components/CommunityHealthDashboard.test.jsx
git commit -m "feat(health): add TabBar sub-component and desktop tab test"
```

---

### Task 3: Integrate tabs into the main component (desktop path)

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx:66-264` (the `CommunityHealthDashboard` function)

- [ ] **Step 1: Add state and hook to `CommunityHealthDashboard`**

Inside the `CommunityHealthDashboard` function, after the existing `useFocusTrap` line (line 71), add:

```jsx
const isDesktop = useIsDesktop();
const [activeTab, setActiveTab] = useState('files');
const [tabDirection, setTabDirection] = useState(0);

const handleTabChange = (newTab) => {
    const currentIndex = TABS.findIndex(t => t.id === activeTab);
    const newIndex = TABS.findIndex(t => t.id === newTab);
    setTabDirection(newIndex > currentIndex ? 1 : -1);
    setActiveTab(newTab);
};
```

- [ ] **Step 2: Refactor the content area to branch on `isDesktop`**

Replace the content inside the `<motion.div key="content" ...>` (lines 149-247 approximately) with the following structure. The Health Score section stays the same. After it, branch:

```jsx
{/* Health Score — always visible */}
<div className="rounded-3xl p-8 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 border border-indigo-200/30 dark:border-indigo-500/20">
    <div className="flex flex-col sm:flex-row items-center gap-6">
        <HealthScoreRing score={health.score} />
        <div className="text-center sm:text-left space-y-1">
            <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">Overall Health Score</div>
            <div className="text-4xl font-bold text-slate-900 dark:text-white">{health.score}<span className="text-lg text-slate-400">%</span></div>
            <ScoreBadge score={health.score} />
        </div>
    </div>
</div>

{isDesktop ? (
    <>
        {/* Tab Bar */}
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} />

        {/* Tab Content */}
        <AnimatePresence mode="wait" custom={tabDirection}>
            <motion.div
                key={activeTab}
                role="tabpanel"
                id={`tabpanel-${activeTab}`}
                custom={tabDirection}
                initial={{ opacity: 0, x: tabDirection * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: tabDirection * -24 }}
                transition={{ duration: 0.2 }}
            >
                {activeTab === 'files' && (
                    <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                            <FileText className="w-5 h-5 text-indigo-500" />
                            Community Files
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(health.metrics.files).map(([file, data]) => (
                                <FileCheckItem key={file} file={file} exists={data.exists} size={data.size} />
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'activity' && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard title="Contributors" value={health.metrics.activity.contributorCount} icon={Users} color="blue" index={0} />
                        <MetricCard title="Commits (30d)" value={health.metrics.activity.commitsLast30Days} icon={Activity} color="green" index={1} />
                        <MetricCard title="Open Issues" value={health.metrics.activity.openIssues} icon={AlertCircle} color="amber" index={2} />
                        <MetricCard title="Closed Issues" value={health.metrics.activity.closedIssues} icon={CheckCircle} color="emerald" index={3} />
                    </div>
                )}

                {activeTab === 'recommendations' && (
                    <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                            <TrendingUp className="w-5 h-5 text-indigo-500" />
                            Recommendations
                        </h3>
                        <div className="space-y-3">
                            {health.recommendations.map((rec, idx) => (
                                <RecommendationItem key={idx} recommendation={rec} />
                            ))}
                            {health.recommendations.length === 0 && (
                                <p className="text-slate-500 dark:text-slate-400 italic">
                                    Great job! No recommendations at this time.
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </motion.div>
        </AnimatePresence>
    </>
) : (
    <>
        {/* Mobile: stacked scroll layout (unchanged) */}
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
        >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-500" />
                Community Files
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(health.metrics.files).map(([file, data]) => (
                    <FileCheckItem key={file} file={file} exists={data.exists} size={data.size} />
                ))}
            </div>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Contributors" value={health.metrics.activity.contributorCount} icon={Users} color="blue" index={0} />
            <MetricCard title="Commits (30d)" value={health.metrics.activity.commitsLast30Days} icon={Activity} color="green" index={1} />
            <MetricCard title="Open Issues" value={health.metrics.activity.openIssues} icon={AlertCircle} color="amber" index={2} />
            <MetricCard title="Closed Issues" value={health.metrics.activity.closedIssues} icon={CheckCircle} color="emerald" index={3} />
        </div>

        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
        >
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-500" />
                Recommendations
            </h3>
            <div className="space-y-3">
                {health.recommendations.map((rec, idx) => (
                    <RecommendationItem key={idx} recommendation={rec} />
                ))}
                {health.recommendations.length === 0 && (
                    <p className="text-slate-500 dark:text-slate-400 italic">
                        Great job! No recommendations at this time.
                    </p>
                )}
            </div>
        </motion.div>
    </>
)}

{/* Last Updated — always visible */}
<div className="text-center text-sm text-slate-400">
    Last analyzed: {new Date(health.lastUpdated).toLocaleString()}
    {health.cached && ' (cached)'}
</div>
```

- [ ] **Step 3: Run the new desktop tab test**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: The "renders tab bar on desktop viewport" test from Task 2 now PASSES. All existing tests should also pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): integrate tabbed layout for desktop viewport"
```

---

### Task 4: Add tab switching and mobile exclusion tests

**Files:**
- Modify: `tests/components/CommunityHealthDashboard.test.jsx`

- [ ] **Step 1: Add test for tab switching**

Add inside the existing `describe` block:

```jsx
it('switches tab content when clicking a tab on desktop', async () => {
    window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));

    global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealthData)
    });

    const user = userEvent.setup();
    render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

    await waitFor(() => {
        expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    // Default tab is Files — verify Files content visible
    expect(screen.getByText('Community Files')).toBeInTheDocument();

    // Click Activity tab
    const activityTab = screen.getByRole('tab', { name: /Activity/i });
    await user.click(activityTab);

    await waitFor(() => {
        expect(screen.getByText('Contributors')).toBeInTheDocument();
    });

    // Click Recommendations tab
    const recsTab = screen.getByRole('tab', { name: /Recommendations/i });
    await user.click(recsTab);

    await waitFor(() => {
        expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Add test that mobile does NOT show tabs**

```jsx
it('does not render tab bar on mobile viewport', async () => {
    window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));

    global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealthData)
    });

    render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

    await waitFor(() => {
        expect(screen.getByText('Overall Health Score')).toBeInTheDocument();
    });

    // No tablist on mobile
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    // All sections visible simultaneously on mobile
    expect(screen.getByText('Community Files')).toBeInTheDocument();
    expect(screen.getByText('Contributors')).toBeInTheDocument();
    expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: All 9 tests PASS (6 existing + 3 new: desktop tab render, tab switching, mobile no tabs).

- [ ] **Step 4: Commit**

```bash
git add tests/components/CommunityHealthDashboard.test.jsx
git commit -m "test(health): add tab switching and mobile exclusion tests"
```

---

### Task 5: Fix existing tests for matchMedia compatibility

**Files:**
- Modify: `tests/components/CommunityHealthDashboard.test.jsx`

The 6 existing tests do not mock `window.matchMedia` for the new `useIsDesktop` hook. They rely on the default jsdom `matchMedia` which returns `matches: false` for all queries, meaning they will run in mobile mode (stacked layout). This is correct behavior — the existing tests validate the mobile/stacked path.

- [ ] **Step 1: Verify all existing tests still pass without modification**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`

If all 9 tests pass: the existing tests are naturally running the mobile path (which is identical to the old layout). Skip to Step 3.

If any existing test fails: it's likely because `window.matchMedia` is not defined in jsdom. In that case, add a global mock in `beforeEach`:

```jsx
beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    // Ensure matchMedia is available (jsdom default: mobile)
    if (!window.matchMedia) {
        window.matchMedia = vi.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
    }
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run tests/components/CommunityHealthDashboard.test.jsx`
Expected: All 9 tests PASS.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add tests/components/CommunityHealthDashboard.test.jsx
git commit -m "test(health): ensure matchMedia compatibility in existing tests"
```

---

### Task 6: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full project test suite**

Run: `npx vitest run`
Expected: All tests across the project PASS.

- [ ] **Step 2: Start the dev server and visually verify**

Run: `npm run dev`

Verify in browser:
1. Open the Community Health Dashboard for any repo
2. **Desktop (>= 1024px):** Tab bar visible below the score. Clicking each tab switches content with a slide animation. Score and "Last updated" are always visible.
3. **Mobile (< 1024px or narrow browser):** No tabs — all sections stacked with scroll, identical to the previous layout.
4. **Resize browser** across the 1024px boundary — layout switches dynamically between tabs and scroll.

- [ ] **Step 3: Final commit if any tweaks were needed**

```bash
git add -A
git commit -m "style(health): polish tab layout after visual review"
```
