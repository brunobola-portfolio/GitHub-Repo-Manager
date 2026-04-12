# Settings Modal & User Dropdown Overhaul

**Date:** 2026-04-12
**Status:** Draft
**Scope:** Fix crashes, eliminate scrollbars, restructure tabs, add License section

---

## Problem Statement

The Settings modal has three categories of issues:

1. **Crash on tab switch** -- Clicking API Keys, Usage, or Audit Log tabs crashes the app (ErrorBoundary catches it). Root cause: framer-motion `staggerChildren` variant propagation in Modal.jsx conflicts with explicit `initial`/`animate` animations in child tab components.

2. **User dropdown scrollbar** -- The organizations list uses `max-h-48` (192px) which forces a scrollbar even with just 5 organizations (~200px of content). The native scrollbar looks ugly against the dark glassmorphism design.

3. **Missing License section** -- License information is buried inside the Billing tab. Users can't easily see their license status, plan, seats, or expiration at a glance. The Usage tab is sparse and disconnected from the plan context.

---

## Design

### 1. Fix Animation Crashes

**Root cause:** Modal.jsx line 228 wraps tab content in `<motion.div variants={STAGGER_VARIANTS} initial="hidden" animate="visible">`. This propagates variant names to all child `motion` elements. Components that use explicit `initial={{ ... }}` and `animate={{ ... }}` instead of matching `variants` objects create a conflict in framer-motion's animation resolution.

**Affected components:**
- `ApiKeysSection.jsx` -- NewKeyForm (line 66), NewKeyReveal (line 175), KeyRow (line 232) all use explicit animations
- `UsageSection.jsx` -- Metric card wrappers (line 229) use explicit animations with custom delay

**Safe components (use matching variants):**
- `InsightCard.jsx` (General tab) -- uses `variants` with "hidden"/"visible" keys
- `AuditLogSection.jsx` -- `motion.tr` uses `variants={rowVariants}` with "hidden"/"visible"
- `BillingSection.jsx` -- only uses `whileHover`, no initial/animate

**Fix approach:** Wrap each tab's content in a plain `<div>` inside SettingsModal.jsx to break framer-motion's variant propagation chain. This is the least invasive fix -- no changes needed inside any tab component, and the General tab's stagger effect on InsightCards continues to work because InsightCard already defines its own matching variants internally.

```jsx
// Before (crashes):
{activeTab === 'api-keys' && <ApiKeysSection />}

// After (fixed):
{activeTab === 'api-keys' && <div><ApiKeysSection /></div>}
```

Apply this wrapper to all non-General tabs (API Keys, License & Plan, Audit Log). The General tab does NOT need wrapping because InsightCard already uses matching "hidden"/"visible" variants and benefits from the stagger effect.

This works because framer-motion only propagates variants through `motion.*` elements, not through regular HTML elements. A plain `<div>` wrapper breaks the chain without affecting the component's own internal animations.

### 2. User Dropdown -- Eliminate Scrollbar

**File:** `src/components/Header.jsx` line 362

**Current:** `max-h-48` (192px) with `overflow-y-auto`
**Problem:** 5 organizations at ~40px each = ~200px, exceeding the max-height

**Fix:** Change to `max-h-64` (256px). This comfortably fits up to 6 organizations without scroll. For users with 7+ orgs, the `custom-scrollbar` class (already available in the project) provides a subtle, design-consistent scrollbar that only appears on hover.

```jsx
// Before:
<div className="max-h-48 overflow-y-auto">

// After:
<div className="max-h-64 overflow-y-auto custom-scrollbar">
```

### 3. Restructure Settings Tabs: 5 → 4

**Current tabs:** General, API Keys, Usage, Billing, Audit Log
**New tabs:** General, API Keys, License & Plan, Audit Log

**Rationale:**
- The Usage tab is sparse -- it only shows 1-2 metric bars
- Usage data is contextually tied to the plan/license (limits come from the tier)
- Combining them creates a richer, more informative single view
- 4 tabs fit better visually in the tab bar, especially on mobile

**Changes to SettingsModal.jsx:**
- Remove the `usage` tab entry from TABS array
- Rename `billing` tab to `license` with label "License & Plan"
- Change icon from `CreditCard` to `Shield` (or a custom license icon)
- Route `activeTab === 'license'` to a new `LicensePlanSection` component

### 4. New LicensePlanSection Component

**File:** `src/components/Settings/LicensePlanSection.jsx` (new, replaces BillingSection)

This component combines the best of BillingSection and UsageSection into a single cohesive view. Layout:

```
┌─────────────────────────────────────────────────┐
│  🏢  License & Plan                             │
│  Manage your license, plan and usage            │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  🏛️  Enterprise Plan    [Licensed]      │    │
│  │  Bola Labs Dev          [Manage License]│    │
│  │                                         │    │
│  │  ┌──────────────┐ ┌──────────────┐      │    │
│  │  │ Seats        │ │ Expires      │      │    │
│  │  │ 2 of 100     │ │ 31 Mar 2028  │      │    │
│  │  │ ████░░░░░░░░ │ │              │      │    │
│  │  └──────────────┘ └──────────────┘      │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  [🔑 Activate License Key]                      │
│                                                 │
│  ── Usage This Month ──────────────────────     │
│                                                 │
│  ┌──────────────────┐ ┌──────────────────┐      │
│  │ AI Queries    0  │ │ API Keys     0   │      │
│  │ ████████ Unlim.  │ │ ████████ Unlim.  │      │
│  └──────────────────┘ └──────────────────┘      │
│                                                 │
│  ── Plan Limits ───────────────────────────     │
│                                                 │
│  Current tier:          Enterprise               │
│  Max repos:             Unlimited                │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Data flow:**
1. Fetch `/api/v1/license` first (existing pattern from BillingSection)
2. If active license key → show LicenseCard hero
3. If no license key → fetch `/api/v1/billing/subscription` for Stripe data → show PlanCard
4. Fetch `/api/v1/usage` for usage metrics (shown below the plan card)
5. Show "Activate License Key" button always
6. Show UsageDashboard (merged from current component)

**Reuse:** Move the existing `LicenseCard`, `PlanCard`, `UpgradePrompt` sub-components from BillingSection.jsx into the new LicensePlanSection.jsx file -- they're well-built and need no changes. Import `UsageDashboard` from the existing file (kept as-is). The new component is primarily a layout reorganization, not a rewrite.

### 5. Cleanup

After implementing LicensePlanSection:
- Delete `src/components/Settings/BillingSection.jsx` (replaced)
- Delete `src/components/Settings/UsageSection.jsx` (merged into LicensePlanSection)
- Keep `src/components/Settings/UsageDashboard.jsx` (reused within LicensePlanSection)
- Update imports in SettingsModal.jsx

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/components/SettingsModal.jsx` | Edit | Fix stagger wrapping, restructure tabs 5→4, update imports |
| `src/components/Header.jsx` | Edit | Increase org list max-h, add custom-scrollbar |
| `src/components/Settings/LicensePlanSection.jsx` | Create | New combined License & Plan tab |
| `src/components/Settings/BillingSection.jsx` | Delete | Replaced by LicensePlanSection |
| `src/components/Settings/UsageSection.jsx` | Delete | Merged into LicensePlanSection |
| `src/components/Settings/UsageDashboard.jsx` | Keep | Reused within LicensePlanSection |

---

## Out of Scope

- Backend changes (all endpoints already exist and work)
- ErrorBoundary redesign (works correctly, just catches the crash)
- LicenseActivationModal changes (already well-implemented)
- LicenseBadge in header (already works)
- Mobile-specific layout changes (current mobile patterns are adequate)
