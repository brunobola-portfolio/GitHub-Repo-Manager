# Health Dashboard Premium Visual Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the CommunityHealthDashboard modal with skeleton loading, animated SVG score ring, and glassmorphism visual treatment.

**Architecture:** Refactor in-place — all changes in `src/components/CommunityHealthDashboard.jsx` with internal sub-components. No new files except tests. No backend changes.

**Tech Stack:** React 19, Framer Motion (`motion.circle`, `AnimatePresence`, `useMotionValue`, `useSpring`, `useReducedMotion`), Tailwind CSS v4, Lucide React.

---

### Task 1: Commit package-lock.json Cleanup

**Files:**
- Commit: `package-lock.json`

- [ ] **Step 1: Stage and commit the lockfile**

```bash
git add package-lock.json
git commit -m "chore: stabilize package-lock.json peer dependency flags"
```

Expected: clean commit with 24 lines changed (adds `"peer": true` to OpenTelemetry/Babel deps).

---

### Task 2: Restructure Modal Shell — Glassmorphism Container & Header

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`

This task upgrades the modal container and sticky header to the premium glass style, and moves the loading state inside the modal (so the header is always visible).

- [ ] **Step 1: Update imports**

In `src/components/CommunityHealthDashboard.jsx`, replace the import line:

```jsx
import { motion } from 'framer-motion';
```

with:

```jsx
import { motion, AnimatePresence, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
```

- [ ] **Step 2: Update modal container classes**

Replace the outer `motion.div` className (the modal panel, line 77):

```jsx
className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-auto"
```

with:

```jsx
className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-auto"
```

- [ ] **Step 3: Update sticky header classes**

Replace the sticky header div className (line 78):

```jsx
className="sticky top-0 z-10 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between rounded-t-3xl"
```

with:

```jsx
className="sticky top-0 z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-white/10 dark:border-white/5 px-6 py-3 sm:py-4 flex items-center justify-between rounded-t-3xl"
```

- [ ] **Step 4: Update button touch targets**

Update the Refresh button className (line 88) — change `py-2` to `py-2.5`:

```jsx
className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
```

Update the Close button className (line 94) — change `py-2` to `py-2.5`:

```jsx
className="px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors"
```

- [ ] **Step 5: Move loading state inside the modal**

Currently the loading check (lines 50-56) returns a spinner before the modal renders. Move the conditional inside the modal body so the header always shows. Replace the entire early return block:

```jsx
    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
            </div>
        );
    }

    if (!health) return null;
```

with just:

```jsx
    const showContent = !loading && health;
```

Then wrap the body content (`<div className="p-6 space-y-6">`) with `<AnimatePresence mode="wait">`. The skeleton and content states will be added in the next tasks. For now, keep the existing content visible only when `showContent` is true:

```jsx
<AnimatePresence mode="wait">
    {!showContent ? (
        <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="p-6"
        >
            {/* Skeleton placeholder — will be built in Task 3 */}
            <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
            </div>
        </motion.div>
    ) : (
        <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="p-6 space-y-6"
        >
            {/* existing content sections go here unchanged */}
        </motion.div>
    )}
</AnimatePresence>
```

Move all existing content (Health Score banner, File Checklist, Activity Metrics, Recommendations, Last Updated) into the content branch.

- [ ] **Step 6: Verify the modal renders**

```bash
npm run dev
```

Open the app, navigate to a repo, click the Health/Shield icon. Verify:
- Modal opens with glass background (semi-transparent, blurred)
- Header is visible immediately with repo name, Refresh, Close
- Loading shows the temporary spinner (will be replaced in Task 3)
- When data loads, content appears with a fade

- [ ] **Step 7: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "refactor(health): glassmorphism modal shell with sticky header"
```

---

### Task 3: Skeleton Loading State with Rotating Messages

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`

- [ ] **Step 1: Add the skeleton sub-component**

Add this internal component at the bottom of the file, before the final `export`:

```jsx
function SkeletonState() {
    const [messageIndex, setMessageIndex] = useState(0);
    const messages = [
        'Checking community files...',
        'Analyzing repository activity...',
        'Calculating health score...',
        'Generating recommendations...'
    ];

    useEffect(() => {
        const interval = setInterval(() => {
            setMessageIndex(i => (i + 1) % messages.length);
        }, 1500);
        return () => clearInterval(interval);
    }, [messages.length]);

    return (
        <div className="space-y-6">
            {/* Rotating message */}
            <div className="flex justify-center py-2">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={messageIndex}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.35 } }}
                        exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
                        className="text-sm font-medium text-indigo-600 dark:text-indigo-400"
                    >
                        {messages[messageIndex]}
                    </motion.p>
                </AnimatePresence>
            </div>

            {/* Score ring skeleton */}
            <div className="rounded-3xl p-8 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 border border-indigo-200/30 dark:border-indigo-500/20">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="w-28 h-28 md:w-36 md:h-36 rounded-full bg-slate-200/60 dark:bg-slate-700/40 animate-pulse" />
                    <div className="space-y-3 flex-1">
                        <div className="h-4 w-40 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                        <div className="h-8 w-24 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                        <div className="h-4 w-32 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                    </div>
                </div>
            </div>

            {/* File checklist skeleton */}
            <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                <div className="h-5 w-36 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse mb-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-12 bg-slate-200/40 dark:bg-slate-700/30 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>

            {/* Metric cards skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-2xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                        <div className="w-12 h-12 bg-slate-200/60 dark:bg-slate-700/40 rounded-xl animate-pulse mb-4" />
                        <div className="h-7 w-16 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse mb-2" />
                        <div className="h-4 w-24 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse" />
                    </div>
                ))}
            </div>

            {/* Recommendations skeleton */}
            <div className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60">
                <div className="h-5 w-40 bg-slate-200/60 dark:bg-slate-700/40 rounded-lg animate-pulse mb-4" />
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 bg-slate-200/40 dark:bg-slate-700/30 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Wire the skeleton into the modal**

Replace the temporary spinner placeholder in the skeleton branch (from Task 2, Step 5) with the new component:

```jsx
{!showContent ? (
    <motion.div
        key="skeleton"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.2 } }}
        className="p-6"
    >
        <SkeletonState />
    </motion.div>
) : (
```

- [ ] **Step 3: Verify skeleton loading**

```bash
npm run dev
```

Open the Health modal. Verify:
- Skeleton structure appears immediately (circle, cards, bars — all pulsing)
- Rotating messages cycle every 1.5s with smooth fade transitions
- Messages don't flicker or collide (exit + enter ≤ 0.6s)
- When data loads, skeleton fades out and content fades in

- [ ] **Step 4: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): skeleton loading state with rotating status messages"
```

---

### Task 4: Animated Score Ring (HealthScoreRing)

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`

- [ ] **Step 1: Add the score color/label helper**

Add this helper function at the top of the file, after the imports:

```jsx
function getScoreConfig(score) {
    if (score >= 80) return { color: '#10b981', tailwind: 'emerald', label: 'Excellent' };
    if (score >= 60) return { color: '#3b82f6', tailwind: 'blue', label: 'Good' };
    if (score >= 40) return { color: '#f59e0b', tailwind: 'amber', label: 'Fair' };
    return { color: '#ef4444', tailwind: 'red', label: 'Needs Improvement' };
}
```

- [ ] **Step 2: Add the HealthScoreRing sub-component**

Add this internal component after `getScoreConfig`:

```jsx
function HealthScoreRing({ score }) {
    const reducedMotion = useReducedMotion();
    const config = getScoreConfig(score);
    const normalizedScore = Math.min(Math.max(score, 0), 100) / 100;

    // Animated counter
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, {
        stiffness: 80,
        damping: 20,
        duration: reducedMotion ? 0 : 1.2
    });
    const [displayScore, setDisplayScore] = useState(reducedMotion ? score : 0);

    useEffect(() => {
        motionValue.set(score);
    }, [score, motionValue]);

    useEffect(() => {
        const unsubscribe = springValue.on('change', v => {
            setDisplayScore(Math.round(v));
        });
        return unsubscribe;
    }, [springValue]);

    const radius = 52;
    const strokeWidth = 8;
    const center = 64;

    return (
        <div className="w-28 h-28 md:w-36 md:h-36 relative">
            <svg
                viewBox="0 0 128 128"
                className="w-full h-full -rotate-90"
                aria-label={`Health score: ${score}% — ${config.label}`}
                role="img"
            >
                {/* Background track */}
                <circle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    className="text-slate-200/40 dark:text-slate-700/40"
                />
                {/* Animated progress */}
                <motion.circle
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="none"
                    stroke={config.color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    initial={{ pathLength: reducedMotion ? normalizedScore : 0 }}
                    animate={{ pathLength: normalizedScore }}
                    transition={reducedMotion ? { duration: 0 } : {
                        duration: 1.2,
                        ease: 'easeOut'
                    }}
                />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
                <span className="text-3xl md:text-5xl font-bold text-slate-900 dark:text-white">
                    {displayScore}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {config.label}
                </span>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Add the score badge helper**

Add this small component for the colored badge used in both the score section and the header:

```jsx
function ScoreBadge({ score, className = '' }) {
    const config = getScoreConfig(score);
    const badgeColors = {
        emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
        blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
        amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
    };

    return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badgeColors[config.tailwind]} ${className}`}>
            {config.label}
        </span>
    );
}
```

- [ ] **Step 4: Replace the score section in the modal content**

Replace the existing Health Score banner (the `bg-gradient-to-r from-indigo-500 to-purple-600` div and its contents):

```jsx
{/* Health Score */}
<div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-3xl p-8 text-white">
    <div className="flex items-center justify-between">
        <div>
            <div className="text-sm uppercase tracking-wide text-indigo-100 mb-2">Overall Health Score</div>
            <div className="text-6xl font-bold">{health.score}</div>
            <div className="text-xl text-indigo-100 mt-2">{getScoreLabel(health.score)}</div>
        </div>
        <div className="w-32 h-32 rounded-full border-8 border-white/30 flex items-center justify-center">
            <div className="text-4xl font-bold">{health.score}%</div>
        </div>
    </div>
</div>
```

with:

```jsx
{/* Health Score */}
<motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
    className="rounded-3xl p-8 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 backdrop-blur-xl border border-indigo-200/30 dark:border-indigo-500/20"
>
    <div className="flex flex-col sm:flex-row items-center gap-6">
        <HealthScoreRing score={health.score} />
        <div className="text-center sm:text-left">
            <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                Community Health Score
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                {repo.full_name}
            </h2>
            <ScoreBadge score={health.score} />
        </div>
    </div>
</motion.div>
```

- [ ] **Step 5: Add the score badge to the sticky header**

In the header section, after the repo name paragraph, add the badge (only visible when data is loaded):

```jsx
<div>
    <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
        Community Health
        {showContent && <ScoreBadge score={health.score} />}
    </h1>
    <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{repo.full_name}</p>
</div>
```

- [ ] **Step 6: Remove the old `getScoreLabel` function**

Delete the `getScoreLabel` function (lines 60-65) since `getScoreConfig` now handles this:

```jsx
    const getScoreLabel = (score) => {
        if (score >= 80) return 'Excellent';
        if (score >= 60) return 'Good';
        if (score >= 40) return 'Fair';
        return 'Needs Improvement';
    };
```

- [ ] **Step 7: Verify the score ring**

```bash
npm run dev
```

Open the Health modal. Verify:
- Ring animates from empty to the score value (smooth draw)
- Counter number animates up from 0 to the score
- Color matches the score range (emerald for 80+, blue for 60-79, etc.)
- Badge appears in both the score section and the sticky header
- On mobile: ring stacks above text (centered)
- On desktop: ring is left, text is right

- [ ] **Step 8: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): animated SVG score ring with counter and color-coded badge"
```

---

### Task 5: Premium Visual Treatment — FileCheckItem

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`

- [ ] **Step 1: Update FileCheckItem component**

Replace the entire `FileCheckItem` function:

```jsx
function FileCheckItem({ file, exists, size }) {
    return (
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3">
                {exists ? (
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                ) : (
                    <XCircle className="w-5 h-5 text-slate-400" />
                )}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{file}</span>
            </div>
            {exists && size > 0 && (
                <span className="text-xs text-slate-400">{(size / 1024).toFixed(1)} KB</span>
            )}
        </div>
    );
}
```

with:

```jsx
function FileCheckItem({ file, exists, size }) {
    return (
        <motion.div
            whileHover={{ y: -1 }}
            className={`flex items-center justify-between p-3 rounded-xl min-h-[44px] ds-card-shimmer
                bg-white/60 dark:bg-slate-900/60
                border ${exists ? 'border-slate-200/40 dark:border-slate-800/40' : 'border-red-300/40 dark:border-red-500/20'}
                transition-all`}
        >
            <div className="flex items-center gap-3">
                {exists ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                        <CheckCircle className="w-5 h-5 text-emerald-500" />
                    </motion.div>
                ) : (
                    <XCircle className="w-5 h-5 text-red-400 dark:text-red-500" />
                )}
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{file}</span>
            </div>
            {exists && size > 0 && (
                <span className="text-xs text-slate-400">{(size / 1024).toFixed(1)} KB</span>
            )}
        </motion.div>
    );
}
```

- [ ] **Step 2: Update the File Checklist section wrapper**

Replace the File Checklist container classes:

```jsx
<div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700">
```

with:

```jsx
<motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay: 0.2 }}
    className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
>
```

Also update the closing `</div>` to `</motion.div>`.

- [ ] **Step 3: Verify file items**

```bash
npm run dev
```

Open the Health modal. Verify:
- File items have glass background
- Existing files show a check icon with spring scale-in
- Missing files have a subtle red border
- Hover shows shimmer effect and slight lift
- Items are at least 44px tall (touch-friendly)

- [ ] **Step 4: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): premium FileCheckItem with glassmorphism and animations"
```

---

### Task 6: Premium Visual Treatment — MetricCard with Counter Animation

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`

- [ ] **Step 1: Add AnimatedNumber helper**

Add this small component near the other helpers:

```jsx
function AnimatedNumber({ value }) {
    const reducedMotion = useReducedMotion();
    const motionValue = useMotionValue(0);
    const springValue = useSpring(motionValue, {
        stiffness: 100,
        damping: 20,
        duration: reducedMotion ? 0 : 0.8
    });
    const [display, setDisplay] = useState(reducedMotion ? value : 0);

    useEffect(() => {
        motionValue.set(value);
    }, [value, motionValue]);

    useEffect(() => {
        const unsubscribe = springValue.on('change', v => setDisplay(Math.round(v)));
        return unsubscribe;
    }, [springValue]);

    return <>{display}</>;
}
```

- [ ] **Step 2: Update MetricCard component**

Replace the entire `MetricCard` function:

```jsx
function MetricCard({ title, value, icon: Icon, color }) {
    const colors = {
        blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
        green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
        amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
        emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700">
            <div className={`p-3 rounded-xl ${colors[color]} w-fit mb-4`}>
                <Icon className="w-6 h-6" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mb-1">{value}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{title}</div>
        </div>
    );
}
```

with:

```jsx
function MetricCard({ title, value, icon: Icon, color, index = 0 }) {
    const gradients = {
        blue: 'from-blue-500/10 to-cyan-500/10',
        green: 'from-green-500/10 to-emerald-500/10',
        amber: 'from-amber-500/10 to-orange-500/10',
        emerald: 'from-emerald-500/10 to-teal-500/10'
    };
    const iconColors = {
        blue: 'text-blue-600 dark:text-blue-400',
        green: 'text-green-600 dark:text-green-400',
        amber: 'text-amber-600 dark:text-amber-400',
        emerald: 'text-emerald-600 dark:text-emerald-400'
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 + index * 0.08 }}
            className="rounded-2xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
        >
            <div className={`p-3 rounded-xl bg-gradient-to-br ${gradients[color]} w-fit mb-4`}>
                <Icon className={`w-6 h-6 ${iconColors[color]}`} />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                <AnimatedNumber value={value} />
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{title}</div>
        </motion.div>
    );
}
```

- [ ] **Step 3: Pass index to MetricCards for stagger**

Update the Activity Metrics section where `MetricCard` components are rendered. Add `index` prop to each:

```jsx
{/* Activity Metrics */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
    <MetricCard title="Contributors" value={health.metrics.activity.contributorCount} icon={Users} color="blue" index={0} />
    <MetricCard title="Commits (30d)" value={health.metrics.activity.commitsLast30Days} icon={Activity} color="green" index={1} />
    <MetricCard title="Open Issues" value={health.metrics.activity.openIssues} icon={AlertCircle} color="amber" index={2} />
    <MetricCard title="Closed Issues" value={health.metrics.activity.closedIssues} icon={CheckCircle} color="emerald" index={3} />
</div>
```

- [ ] **Step 4: Verify metrics**

```bash
npm run dev
```

Open the Health modal. Verify:
- Metric cards appear with stagger (each 80ms apart, starting 400ms after modal)
- Numbers animate from 0 to their values
- Icons have gradient backgrounds
- Cards have glass treatment (semi-transparent, no inner blur)

- [ ] **Step 5: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): premium MetricCard with animated counters and stagger"
```

---

### Task 7: Premium Visual Treatment — RecommendationItem

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`

- [ ] **Step 1: Update RecommendationItem component**

Replace the entire `RecommendationItem` function:

```jsx
function RecommendationItem({ recommendation }) {
    const priorityColors = {
        high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        low: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    };

    return (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
            <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5" />
            <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-white">{recommendation.action}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Category: {recommendation.category}
                </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border ${priorityColors[recommendation.priority]}`}>
                {recommendation.priority}
            </span>
        </div>
    );
}
```

with:

```jsx
function RecommendationItem({ recommendation }) {
    const priorityColors = {
        high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
        medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        low: 'bg-blue-100/60 dark:bg-blue-900/20 text-blue-600 dark:text-blue-500 border-blue-200/50 dark:border-blue-800/30'
    };

    const iconGradients = {
        high: 'from-red-500 to-orange-500',
        medium: 'from-amber-500 to-yellow-500',
        low: 'from-blue-400 to-cyan-400'
    };

    return (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-800/40">
            <div className={`mt-0.5 bg-gradient-to-br ${iconGradients[recommendation.priority]} rounded-lg p-1`}>
                <AlertCircle className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-white">{recommendation.action}</div>
                <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Category: {recommendation.category}
                </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full border ${priorityColors[recommendation.priority]} ${recommendation.priority === 'high' ? 'animate-pulse' : ''}`}>
                {recommendation.priority}
            </span>
        </div>
    );
}
```

- [ ] **Step 2: Update the Recommendations section wrapper**

Replace the Recommendations container:

```jsx
<div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700">
```

with:

```jsx
<motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay: 0.6 }}
    className="rounded-3xl p-6 border border-slate-200/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60"
>
```

Also update the closing `</div>` to `</motion.div>`.

- [ ] **Step 3: Verify recommendations**

```bash
npm run dev
```

Open the Health modal. Verify:
- Recommendations appear with 600ms delay (last section)
- Icons have gradient backgrounds matching priority
- High priority badges have a pulse animation
- Low priority items are more muted
- Glass background on cards

- [ ] **Step 4: Commit**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "feat(health): premium RecommendationItem with gradient icons and priority pulse"
```

---

### Task 8: Write Tests

**Files:**
- Create: `tests/components/CommunityHealthDashboard.test.jsx`

- [ ] **Step 1: Create the test file**

Create `tests/components/CommunityHealthDashboard.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommunityHealthDashboard } from '../../src/components/CommunityHealthDashboard';

// Mock framer-motion to avoid animation timing issues in tests
vi.mock('framer-motion', async () => {
    const actual = await vi.importActual('framer-motion');
    return {
        ...actual,
        useReducedMotion: () => true, // Force reduced motion in tests
    };
});

// Mock hooks
vi.mock('../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { error: vi.fn(), success: vi.fn() } })
}));

vi.mock('../../src/hooks/useFocusTrap', () => ({
    useFocusTrap: () => ({ current: null })
}));

const mockRepo = {
    full_name: 'owner/test-repo',
    name: 'test-repo'
};

const mockHealthData = {
    score: 85,
    metrics: {
        files: {
            'README.md': { exists: true, size: 2048 },
            'LICENSE': { exists: true, size: 1024 },
            'CONTRIBUTING.md': { exists: false, size: 0 },
            'CODE_OF_CONDUCT.md': { exists: false, size: 0 },
            'SECURITY.md': { exists: true, size: 512 },
            '.github/ISSUE_TEMPLATE': { exists: false, size: 0 },
            '.github/PULL_REQUEST_TEMPLATE.md': { exists: false, size: 0 }
        },
        activity: {
            contributorCount: 5,
            commitsLast30Days: 23,
            openIssues: 3,
            closedIssues: 12
        }
    },
    recommendations: [
        { action: 'Add CONTRIBUTING.md', category: 'documentation', priority: 'high' },
        { action: 'Add issue templates', category: 'templates', priority: 'medium' }
    ],
    lastUpdated: '2026-04-10T12:00:00Z',
    cached: false
};

describe('CommunityHealthDashboard', () => {
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('shows skeleton loading state with rotating messages', async () => {
        // Never resolve — keep loading
        global.fetch.mockReturnValue(new Promise(() => {}));

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        // Header should be visible immediately
        expect(screen.getByText('Community Health')).toBeInTheDocument();
        expect(screen.getByText('owner/test-repo')).toBeInTheDocument();

        // Should show a rotating message (first one)
        await waitFor(() => {
            expect(screen.getByText('Checking community files...')).toBeInTheDocument();
        });
    });

    it('renders health data with score ring after loading', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        // Wait for content to load
        await waitFor(() => {
            expect(screen.getByText('Community Health Score')).toBeInTheDocument();
        });

        // Score badge should appear
        expect(screen.getAllByText('Excellent').length).toBeGreaterThan(0);

        // File items should render
        expect(screen.getByText('README.md')).toBeInTheDocument();
        expect(screen.getByText('CONTRIBUTING.md')).toBeInTheDocument();

        // Metric values should be present (reduced motion = instant)
        expect(screen.getByText('Contributors')).toBeInTheDocument();
        expect(screen.getByText('Commits (30d)')).toBeInTheDocument();

        // Recommendations should render
        expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
    });

    it('shows red border on missing files', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getByText('CONTRIBUTING.md')).toBeInTheDocument();
        });

        // The CONTRIBUTING.md row should have a red border class
        const contributingRow = screen.getByText('CONTRIBUTING.md').closest('[class*="border-red"]');
        expect(contributingRow).toBeInTheDocument();
    });

    it('calls onClose when Close button is clicked', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        const user = userEvent.setup();
        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        const closeButton = screen.getByText('Close');
        await user.click(closeButton);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('displays score badge in header after data loads', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            // Should have badge in both header and score section
            const badges = screen.getAllByText('Excellent');
            expect(badges.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('applies correct color for different score ranges', async () => {
        const lowScoreData = { ...mockHealthData, score: 30 };
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(lowScoreData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getAllByText('Needs Improvement').length).toBeGreaterThan(0);
        });
    });

    it('high priority recommendations have pulse animation class', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve(mockHealthData)
        });

        render(<CommunityHealthDashboard repo={mockRepo} onClose={onClose} />);

        await waitFor(() => {
            expect(screen.getByText('Add CONTRIBUTING.md')).toBeInTheDocument();
        });

        const highBadge = screen.getByText('high');
        expect(highBadge.className).toContain('animate-pulse');
    });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/components/CommunityHealthDashboard.test.jsx
```

Expected: All 7 tests pass.

- [ ] **Step 3: Fix any failures**

If tests fail due to animation timing or DOM structure, adjust selectors. The `useReducedMotion` mock ensures animations are instant, so timing shouldn't be an issue.

- [ ] **Step 4: Commit**

```bash
git add tests/components/CommunityHealthDashboard.test.jsx
git commit -m "test(health): add CommunityHealthDashboard tests for loading, score, and premium UI"
```

---

### Task 9: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All existing tests still pass + new tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: No new lint errors.

- [ ] **Step 3: Manual verification checklist**

```bash
npm run dev
```

Open the app and verify the complete flow:

1. Click Health/Shield icon on any repo card
2. Modal opens with glass background — header visible immediately
3. Skeleton shows with pulsing placeholders matching content structure
4. Rotating messages cycle smoothly every 1.5s
5. When data arrives: skeleton fades out, content fades in with stagger
6. Score ring draws itself with correct color for the score range
7. Number counter animates from 0 to actual score
8. Score badge appears in both header and score section
9. File items: glass cards, check icons scale in, missing files have red border
10. Metric cards: stagger animation, gradient icons, counter animation
11. Recommendations: gradient icon backgrounds, high priority pulses
12. Scroll: header stays sticky with badge visible
13. Mobile: score section stacks vertically, touch targets ≥ 44px
14. Close modal: click Close button or click backdrop

- [ ] **Step 4: Verify reduced motion**

In browser DevTools, enable "Prefer reduced motion" (Rendering tab). Reopen the modal and verify:
- Ring appears at final position instantly (no draw animation)
- Counter numbers show final values immediately
- Shimmer is disabled
- Fade transitions still work (they're minimal)

- [ ] **Step 5: Final commit if any adjustments were needed**

```bash
git add src/components/CommunityHealthDashboard.jsx
git commit -m "fix(health): final polish adjustments from manual verification"
```

Only commit if changes were made in step 3/4.

---

## Summary

| Task | Description | Estimated Steps |
|------|-------------|-----------------|
| 1 | Commit package-lock.json | 1 |
| 2 | Glassmorphism modal shell & header | 7 |
| 3 | Skeleton loading + rotating messages | 4 |
| 4 | Animated score ring + badge | 8 |
| 5 | Premium FileCheckItem | 4 |
| 6 | Premium MetricCard + counter animation | 5 |
| 7 | Premium RecommendationItem | 4 |
| 8 | Tests | 4 |
| 9 | Final verification | 5 |

**Total:** 9 tasks, 42 steps, all in a single file + 1 test file.
