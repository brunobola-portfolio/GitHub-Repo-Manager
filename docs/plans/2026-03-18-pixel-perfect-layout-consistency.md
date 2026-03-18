# Pixel-Perfect Layout Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify header group styling, align sidebars pixel-perfectly with center content, and make all spacing responsive.

**Architecture:** CSS custom properties (`--header-height`, `--layout-py`) drive sticky positioning formulas in CollapsiblePanel/RepoList. Header restructured into 3 visually identical container groups. Tailwind responsive classes handle padding/gap scaling.

**Tech Stack:** React 19, Tailwind CSS v4, Vite 7, Lucide icons

**Spec:** `docs/specs/2026-03-18-pixel-perfect-layout-consistency.md`

---

### Task 1: Add `--layout-py` CSS variable and update `--header-height`

**Files:**
- Modify: `src/index.css:7-25`

- [ ] **Step 1: Update `--header-height` and add `--layout-py` in `:root`**

In `src/index.css`, replace the current `:root` block (lines 7-17) with:

```css
:root {
	--safe-area-inset-top: env(safe-area-inset-top, 0px);
	--safe-area-inset-right: env(safe-area-inset-right, 0px);
	--safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
	--safe-area-inset-left: env(safe-area-inset-left, 0px);

	/* Layout tokens */
	--header-height: 4rem;
	--bottom-nav-height: 0px;
	--card-min-width: 300px;
	--layout-py: 0.75rem;
}
```

- [ ] **Step 2: Update mobile media query**

Replace `@media (max-width: 639px)` block (lines 19-25) with:

```css
@media (max-width: 639px) {
	:root {
		--header-height: 3.5rem;
		--bottom-nav-height: 4rem;
		--card-min-width: 100%;
	}
}
```

- [ ] **Step 3: Add `--layout-py` responsive media queries**

After the `@media (min-width: 1280px)` block (line 37), add:

```css
@media (min-width: 768px) {
	:root {
		--layout-py: 1rem;
	}
}

@media (min-width: 1024px) {
	:root {
		--layout-py: 1.25rem;
	}
}
```

- [ ] **Step 4: Verify the app still loads**

Run: `npm run dev` and open the browser. No visual change expected yet — the CSS variable `--header-height` is updated to `4rem` but the header component still uses `h-14` (changed in Task 5). Verify no layout breaks.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(layout): add --layout-py CSS variable and update --header-height"
```

---

### Task 2: Update CollapsiblePanel sticky positioning

**Files:**
- Modify: `src/components/ui/CollapsiblePanel.jsx:46-50`

- [ ] **Step 1: Update `top` and `maxHeight` style formulas**

In `src/components/ui/CollapsiblePanel.jsx`, replace the `style` object (lines 46-50):

```jsx
// BEFORE:
style={{
  width: `${width}px`,
  top: 'var(--header-height)',
  maxHeight: 'calc(100vh - var(--header-height) - 1rem)',
}}

// AFTER:
style={{
  width: `${width}px`,
  top: 'calc(var(--header-height) + var(--layout-py))',
  maxHeight: 'calc(100vh - var(--header-height) - 2 * var(--layout-py))',
}}
```

- [ ] **Step 2: Verify sidebars align with content**

Open the app, go to Repositories view. The sidebars should start at the same vertical position as the main content area, and their bottom edges should align with the viewport minus padding.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/CollapsiblePanel.jsx
git commit -m "fix(layout): align sidebar sticky position with --layout-py"
```

---

### Task 3: Update RepoList toolbar sticky position

**Files:**
- Modify: `src/components/RepoList.jsx:179`

- [ ] **Step 1: Update toolbar `top` style**

In `src/components/RepoList.jsx`, line 179, find the toolbar div's inline style and update:

```jsx
// BEFORE:
style={{ top: 'calc(var(--header-height) + 0.5rem)' }}

// AFTER:
style={{ top: 'calc(var(--header-height) + var(--layout-py))' }}
```

- [ ] **Step 2: Verify toolbar and sidebars share the same sticky top**

Scroll the repos view. The toolbar and sidebars should be at exactly the same vertical position when sticky.

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoList.jsx
git commit -m "fix(layout): align RepoList toolbar sticky top with --layout-py"
```

---

### Task 4: Update App.jsx main padding, gap, and org overlay

**Files:**
- Modify: `src/App.jsx:515` (main padding)
- Modify: `src/App.jsx:563` (panel gap)
- Modify: `src/App.jsx:637-640` (org overlay style)

- [ ] **Step 1: Update main element padding**

In `src/App.jsx`, line 515, change the main element classes:

```jsx
// BEFORE:
<main id="main-content" className="max-w-[1920px] mx-auto px-3 sm:px-5 lg:px-6 xl:px-8 py-6 pb-20 md:pb-6 transition-all duration-300 relative z-[1]">

// AFTER:
<main id="main-content" className="max-w-[1920px] mx-auto px-3 sm:px-5 lg:px-6 xl:px-8 pt-3 md:pt-4 lg:pt-5 pb-20 md:pb-6 transition-all duration-300 relative z-[1]">
```

- [ ] **Step 2: Update panel gap classes**

In `src/App.jsx`, line 563, update the flex container gap:

```jsx
// BEFORE:
<div className="flex gap-3 lg:gap-4 min-h-0">

// AFTER:
<div className="flex gap-2 md:gap-3 lg:gap-4 min-h-0">
```

- [ ] **Step 3: Update org overlay panel positioning**

In `src/App.jsx`, lines 637-640, update the org overlay style:

```jsx
// BEFORE:
style={{
  top: 'var(--header-height)',
  maxHeight: 'calc(100vh - var(--header-height) - 1rem)',
}}

// AFTER:
style={{
  top: 'calc(var(--header-height) + var(--layout-py))',
  maxHeight: 'calc(100vh - var(--header-height) - 2 * var(--layout-py))',
}}
```

- [ ] **Step 4: Verify all panels align top and bottom**

Open the app at Repositories view. Resize the browser through mobile/tablet/desktop breakpoints. All 3 panels should share the same top and bottom edges. The org overlay (click the expand chevron in slim mode) should also align.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(layout): responsive padding, gap, and org overlay alignment"
```

---

### Task 5: Restructure Header — Left group (logo container)

**Files:**
- Modify: `src/components/Header.jsx:59-87`

- [ ] **Step 1: Update header height and outer container**

In `src/components/Header.jsx`, line 60, update the inner div:

```jsx
// BEFORE:
<div className="max-w-[1920px] mx-auto px-3 sm:px-5 lg:px-6 xl:px-8 h-14 flex items-center gap-3 safe-area-left safe-area-right">

// AFTER:
<div className="max-w-[1920px] mx-auto px-3 sm:px-5 lg:px-6 xl:px-8 h-16 flex items-center gap-3 safe-area-left safe-area-right">
```

- [ ] **Step 2: Restructure left group into container**

Replace the left group (lines 62-87) with:

```jsx
{/* Left: Logo & Title */}
<div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink-0">
    {user && (
      <button
        onClick={onToggleOrgDrawer}
        className="md:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
        aria-label="Open organizations"
      >
        <Menu className="w-5 h-5 text-slate-600 dark:text-slate-300" />
      </button>
    )}
    <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-950 p-[5px] pr-2.5 rounded-[14px] border border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-600 p-2.5 rounded-[10px] shadow-lg shadow-indigo-500/25 dark:shadow-indigo-500/30 ds-btn-shimmer flex-shrink-0">
            <Github className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0 hidden sm:block">
            <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-none ds-font-display truncate">
                <span className="hidden xs:inline">GitHub </span>Repo Manager
                {isMockMode && (
                    <span className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full text-[10px] font-medium ml-1.5 flex-shrink-0">
                        <FlaskConical className="w-2.5 h-2.5" />
                        Demo
                    </span>
                )}
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Organize & migrate</p>
        </div>
    </div>
</div>
```

- [ ] **Step 3: Verify logo container renders correctly**

The Git icon + title should appear inside a container with a subtle border, matching the style of center/right groups. On mobile, only the Git icon should be visible (text hidden via `hidden sm:block`).

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.jsx
git commit -m "feat(header): wrap logo in unified container with shared tokens"
```

---

### Task 6: Restructure Header — Center group (nav tabs)

**Files:**
- Modify: `src/components/Header.jsx:89-113` (nav container)
- Modify: `src/components/Header.jsx:312-328` (NavButton component)

- [ ] **Step 1: Update nav container to shared tokens**

Replace the nav container (lines 90-112):

```jsx
{/* Center: Navigation (desktop) */}
<div className="flex-1 flex justify-center min-w-0">
    {user && (
        <nav className="hidden md:flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-[5px] rounded-[14px] border border-slate-200/50 dark:border-slate-700/50 flex-shrink-0">
            <NavButton
                active={activeView === 'dashboard'}
                onClick={() => onViewChange?.('dashboard')}
                icon={LayoutDashboard}
                label="Dashboard"
            />
            <NavButton
                active={activeView === 'repos'}
                onClick={() => onViewChange?.('repos')}
                icon={FolderGit2}
                label="Repositories"
            />
            <NavButton
                active={activeView === 'teams'}
                onClick={() => onViewChange?.('teams')}
                icon={Users}
                label="Teams"
            />
        </nav>
    )}
</div>
```

- [ ] **Step 2: Update NavButton component**

Replace the NavButton function (lines 312-328):

```jsx
function NavButton({ active, onClick, icon, label }) {
    const IconComponent = icon
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ds-font-display ${active
                ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white/50 dark:hover:bg-slate-600/40'
                }`}
        >
            {IconComponent && <IconComponent className="w-4 h-4" />}
            {label}
        </button>
    )
}
```

Key changes: `rounded-lg` → `rounded-[10px]`, `py-2.5` → `py-2`, removed `min-h-[44px]` (container provides touch area), `shadow-md` → `shadow-sm`.

- [ ] **Step 3: Verify nav tabs match the container style**

The nav tabs should now have the same `bg-slate-100 dark:bg-slate-950` + `rounded-[14px]` + `border` as the logo container.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.jsx
git commit -m "feat(header): unify nav tabs with shared container tokens"
```

---

### Task 7: Restructure Header — Right group (actions + theme toggle)

**Files:**
- Modify: `src/components/Header.jsx:115-248` (right group)
- Modify: `src/components/Header.jsx:288-309` (ThemeToggleButton)

- [ ] **Step 1: Replace the right group section**

Replace the entire right group (lines 116-248) with:

```jsx
{/* Right: Actions & User */}
<div className="flex items-center gap-1.5 flex-shrink-0">
    {user ? (
        <>
            {/* Quick Actions Container */}
            <div className="hidden sm:flex items-center gap-0.5 bg-slate-100 dark:bg-slate-950 p-[5px] rounded-[14px] border border-slate-200/50 dark:border-slate-700/50">
                <button
                    type="button"
                    onClick={onCreateRepo}
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                    aria-label="Create new repository"
                >
                    <Plus className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={onImport}
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                    title="Import Repository"
                    aria-label="Import Repository"
                >
                    <Download className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={onOpenCommitGen}
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                    title="AI Commit Generator"
                    aria-label="AI Commit Generator"
                >
                    <Wand2 className="w-4 h-4" />
                </button>
            </div>

            {/* Utility Container */}
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-950 p-[5px] rounded-[14px] border border-slate-200/50 dark:border-slate-700/50">
                {/* Theme Toggle */}
                <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />

                {/* Sync */}
                <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncing}
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors disabled:opacity-50"
                    title="Sync organizations"
                    aria-label="Sync organizations"
                >
                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                </button>

                {/* Notifications */}
                <div className="relative" ref={notifRef}>
                    <button
                        type="button"
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="w-9 h-9 rounded-[10px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors relative"
                        aria-label={showNotifications ? 'Hide notifications' : 'Show notifications'}
                        aria-expanded={showNotifications}
                        aria-haspopup="true"
                    >
                        <Bell className="w-4 h-4" />
                        {syncStatus?.hasUpdates && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-indigo-500 rounded-full" />
                        )}
                    </button>

                    {showNotifications && (
                        <NotificationsDropdown
                            syncStatus={syncStatus}
                            orgs={orgs}
                        />
                    )}
                </div>

                {/* User Menu */}
                <div className="relative" ref={menuRef}>
                    <button
                        type="button"
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        className="flex items-center gap-1.5 px-1 py-1 rounded-[10px] hover:bg-white/80 dark:hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={showUserMenu ? 'Close user menu' : 'Open user menu'}
                        aria-haspopup="true"
                        aria-expanded={showUserMenu}
                    >
                        <img
                            src={user.avatar_url || 'https://github.com/ghost.png'}
                            alt={user.login}
                            className="w-7 h-7 rounded-full ring-2 ring-slate-200 dark:ring-slate-600"
                        />
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showUserMenu && (
                        <UserDropdown
                            user={user}
                            orgs={orgs}
                            onLogout={onLogout}
                            onReauthorize={onReauthorize}
                            onOpenOrgManager={onOpenOrgManager}
                            onOpenSettings={onOpenSettings}
                            onMigrationHistory={onMigrationHistory}
                            onClose={() => setShowUserMenu(false)}
                        />
                    )}
                </div>
            </div>
        </>
    ) : (
        <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Theme Toggle for non-logged in users */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-950 p-[5px] rounded-[14px] border border-slate-200/50 dark:border-slate-700/50">
                <ThemeToggleButton isDark={isDark} toggleTheme={toggleTheme} />
            </div>
            <Button variant="primary" size="sm" onClick={onLogin}>
                <Github className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Login with GitHub</span>
                <span className="sm:hidden">Login</span>
            </Button>
        </div>
    )}
</div>
```

- [ ] **Step 2: Replace ThemeToggleButton component**

Replace the ThemeToggleButton function (lines 288-309):

```jsx
function ThemeToggleButton({ isDark, toggleTheme }) {
    return (
        <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={isDark}
            className={`flex items-center gap-1.5 rounded-[10px] transition-colors ${
                isDark
                    ? 'bg-white/10 dark:bg-slate-600 text-slate-100'
                    : 'bg-white text-slate-800 shadow-sm'
            } h-9 px-2.5 sm:px-3`}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span className="hidden sm:inline text-xs font-medium">
                {isDark ? 'Dark mode' : 'Light mode'}
            </span>
        </button>
    )
}
```

Key changes: No longer uses `<Button>` component. Uses `rounded-[10px]` instead of `rounded-full`. Active state shown via filled background. Icon size standardized to `w-4 h-4`.

- [ ] **Step 3: Remove unused `Button` import if no longer needed**

Check if `Button` is still used in the file (it is — for the Login button in the non-logged-in state). Keep the import.

- [ ] **Step 4: Verify the right group renders correctly**

Both sub-containers (quick actions + utility) should have the same visual treatment as the logo and nav containers. The theme toggle should show as a button inside the utility container, not as a separate pill.

- [ ] **Step 5: Test both logged-in and logged-out states**

Logged-in: All 3 container groups visible. Logged-out: Only theme toggle container + login button visible.

- [ ] **Step 6: Commit**

```bash
git add src/components/Header.jsx
git commit -m "feat(header): unify right group with shared container tokens"
```

---

### Task 8: Final verification across breakpoints

**Files:** None (testing only)

- [ ] **Step 1: Test desktop (≥1024px)**

Open the app at full width. Verify:
- Header: 3 groups with identical container styling (bg, border, border-radius)
- Sidebars: Top edge aligns with toolbar top edge
- Sidebars: Bottom edge aligns with viewport minus padding
- Gap between panels scales properly

- [ ] **Step 2: Test tablet (640-1023px)**

Resize to ~800px. Verify:
- Slim sidebars visible
- Nav tabs container visible
- Spacing adapts (smaller gaps, padding)

- [ ] **Step 3: Test mobile (<640px)**

Resize to ~400px. Verify:
- Sidebars hidden
- Bottom nav visible
- Logo shows Git icon only (text hidden)
- Header height slightly shorter

- [ ] **Step 4: Test scroll behavior**

On desktop, scroll up and down in the repos view. Verify:
- Sidebars stay sticky and never overlap the header
- Toolbar stays at exactly the same vertical position as sidebars
- Bottom edges remain consistent
- Org overlay (slim mode chevron) aligns correctly

- [ ] **Step 5: Test dark mode**

Toggle dark mode. Verify all containers use `dark:bg-slate-950` with `dark:border-slate-700/50`. No visual inconsistencies.

- [ ] **Step 6: Commit all remaining changes (if any fixes needed)**

```bash
git add -A
git commit -m "fix(layout): final adjustments from cross-breakpoint testing"
```
