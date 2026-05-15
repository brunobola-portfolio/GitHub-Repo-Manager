# Theme Audit — Kill List Callsites
Date: 2026-05-14

## Summary
- Total files touching at least one killed pattern: **107**
- Total individual callsites: **244**

> Note: `src/design-system.css` is excluded from all counts — Task 3 rewrites it directly.

---

## By family

### Header & shell
- `src/components/Header.jsx` — uses: `backdrop-blur-xl` (lines 76, 299, 469, 580, 749 — 5 occurrences), `ds-btn-shimmer` (lines 90, 282 — 2 occurrences), `from-indigo-500` (line 276 — 1 occurrence)
- `src/App.jsx` — uses: `backdrop-blur-xl` (lines 1064, 1129 — 2 occurrences), `from-indigo-500` (line 857 — 1 occurrence)
- `src/components/MobileQuickActionsFab.jsx` — uses: `ds-btn-shimmer` (line 94 — 1 occurrence)

### Dashboard
- `src/components/Dashboard/DashboardHero.jsx` — uses: `ds-gradient-text` (line 72 — 1 occurrence)
- `src/components/Dashboard/StatCard.jsx` — uses: `ds-card-shimmer` (line 63 — 1 occurrence), `backdrop-blur-xl` (line 63 — 1 occurrence), `from-indigo-500` (lines 66, 81 — 2 occurrences)
- `src/components/Dashboard/OrganizationCard.jsx` — uses: `ds-card-shimmer` (line 38 — 1 occurrence), `backdrop-blur-xl` (line 38 — 1 occurrence), `from-indigo-500` (line 42 — 1 occurrence)
- `src/components/Dashboard/AttentionFeed.jsx` — uses: `backdrop-blur-xl` (line 189 — 1 occurrence), `from-indigo-500` (line 187 — 1 occurrence)
- `src/components/Dashboard/ActivityChart.jsx` — uses: `backdrop-blur-xl` (line 70 — 1 occurrence)
- `src/components/Dashboard/HeroChip.jsx` — uses: `backdrop-blur-xl` (line 8 — 1 occurrence)
- `src/components/Dashboard/HeroTimeRangeChip.jsx` — uses: `backdrop-blur-2xl` (line 41 — 1 occurrence)
- `src/components/Dashboard/HeroOrgChip.jsx` — uses: `backdrop-blur-2xl` (line 114 — 1 occurrence)
- `src/components/Dashboard/OrganizationSelector.jsx` — uses: `backdrop-blur-xl` (line 24 — 1 occurrence), `backdrop-blur-2xl` (line 60 — 1 occurrence)
- `src/components/Dashboard/CategorySection.jsx` — uses: `backdrop-blur-xl` (line 28 — 1 occurrence), `from-indigo-500` (lines 28, 37 — 2 occurrences)
- `src/components/Dashboard/WhatNeedsYouGrid.jsx` — uses: `backdrop-blur-xl` (line 78 — 1 occurrence), `from-indigo-500` (line 129 — 1 occurrence)
- `src/components/Dashboard/LanguageChart.jsx` — uses: `backdrop-blur-xl` (line 90 — 1 occurrence)
- `src/components/Dashboard/AIPromoStrip.jsx` — uses: `ds-btn-shimmer` (line 89 — 1 occurrence), `from-indigo-500` (lines 63, 65, 89 — 3 occurrences)
- `src/components/Dashboard/DashboardPremium.jsx` — uses: `backdrop-blur-xl` (lines 282, 433, 481 — 3 occurrences)
- `src/components/Dashboard/Premium/InboxPanel.jsx` — uses: `backdrop-blur-xl` (line 112 — 1 occurrence)

### RepoList
- `src/components/RepoList/RepoCard.jsx` — uses: `ds-card-shimmer` (line 128 — 1 occurrence), `backdrop-blur-xl` (line 126 — 1 occurrence), `from-indigo-500` (line 143 — 1 occurrence)
- `src/components/RepoList/RepoFilterBar.jsx` — uses: `backdrop-blur-xl` (line 148 — 1 occurrence), `backdrop-blur-2xl` (line 106 — 1 occurrence)
- `src/components/RepoList/RepoStates.jsx` — uses: `from-indigo-500` (line 72 — 1 occurrence)

### RepoDetail tabs
- `src/components/RepoDetail/OverviewTab.jsx` — uses: `ds-btn-shimmer` (line 70 — 1 occurrence)
- `src/components/RepoDetail/PRDetailPanel.jsx` — uses: `from-indigo-500` (line 232 — 1 occurrence)
- `src/components/RepoDetail/AIIssuePlanner.jsx` — uses: `from-indigo-500` (line 78 — 1 occurrence)
- `src/components/RepoDetail/BranchHygieneCard.jsx` — uses: `backdrop-blur-xl` (line 32 — 1 occurrence), `from-indigo-500` (line 30 — 1 occurrence)
- `src/components/RepoDetail/BranchProtectionPanel.jsx` — uses: `from-indigo-500` (line 208 — 1 occurrence)
- `src/components/RepoDetail/SettingsTab.jsx` — uses: `from-indigo-500` (line 268 — 1 occurrence)

### UI primitives
- `src/components/ui/Card.jsx` — uses: `ds-card-shimmer` (line 31 — 1 occurrence), `backdrop-blur-xl` (line 22 — 1 occurrence)
- `src/components/ui/PageHeader.jsx` — uses: `ds-gradient-text` (line 28 — 1 occurrence)
- `src/components/ui/InsightCard.jsx` — uses: `ds-card-shimmer` (line 42 — 1 occurrence), `from-purple-500` (line 9 — 1 occurrence)
- `src/components/ui/QuotaExceededState.jsx` — uses: `ds-card-shimmer` (line 37 — 1 occurrence), `ds-border-glow` (line 59 — 1 occurrence), `from-indigo-500` (line 59 — 1 occurrence)
- `src/components/ui/Modal.jsx` — uses: `ds-glass` (line 244 — 1 occurrence), `to-cyan` (lines 13, 54 — 2 occurrences), `from-indigo-500` (lines 11, 12, 51 — 3 occurrences)
- `src/components/ui/WizardPanel.jsx` — uses: `ds-hover-glow` (line 82 — 1 occurrence), `ds-glass` (lines 146, 174 — 2 occurrences)
- `src/components/ui/Button.jsx` — uses: `ds-btn-shimmer` (line 4 — 1 occurrence)
- `src/components/ui/AIQuotaExhaustedCard.jsx` — uses: `backdrop-blur-xl` (line 44 — 1 occurrence), `from-indigo-500` (line 73 — 1 occurrence)
- `src/components/ui/AIQuotaMeter.jsx` — uses: `from-indigo-500` (line 173 — 1 occurrence)
- `src/components/ui/EmptyState.jsx` — uses: `from-indigo-500` (lines 14, 23 — 2 occurrences; line 14 is a JSDoc comment)
- `src/components/ui/SectionPanel.jsx` — uses: `backdrop-blur-xl` (line 86 — 1 occurrence), `from-indigo-500` (line 54 — 1 occurrence)
- `src/components/ui/Select.jsx` — uses: `backdrop-blur-xl` (lines 275, 317 — 2 occurrences)
- `src/components/ui/ContextMenu.jsx` — uses: `backdrop-blur-xl` (line 267 — 1 occurrence)
- `src/components/ui/RateLimitNotice.jsx` — uses: `backdrop-blur-xl` (line 113 — 1 occurrence)
- `src/components/ui/HeroHalo.jsx` — uses: `from-indigo-500` (line 20 — 1 occurrence)
- `src/components/ui/StatBar.jsx` — uses: `to-cyan` (line 6 — 1 occurrence), `from-indigo-500` (line 4 — 1 occurrence)
- `src/components/ui/Drawer.jsx` — uses: `from-indigo-500` (line 117 — 1 occurrence)

### Sidebar
- `src/components/Sidebar.jsx` — uses: `backdrop-blur-xl` (lines 58, 248, 410, 489 — 4 occurrences), `from-indigo-500` (line 289 — 1 occurrence)

### AI Assistant
- `src/components/AIAssistant.jsx` — uses: `ds-btn-shimmer` (lines 269, 398, 526 — 3 occurrences), `ds-glass-strong` (line 299 — 1 occurrence), `from-indigo-500` (lines 266, 269, 426, 488, 499, 526 — 6 occurrences)
- `src/components/AI/AINotConfiguredBanner.jsx` — uses: `ds-btn-shimmer` (line 89 — 1 occurrence), `from-indigo-500` (lines 69, 72, 89 — 3 occurrences)
- `src/components/AI/AINotHealthyBanner.jsx` — uses: `ds-btn-shimmer` (line 74 — 1 occurrence)
- `src/components/AI/ChatPrimitives.jsx` — uses: `from-indigo-500` (lines 36, 67, 86 — 3 occurrences)
- `src/components/AI/PremiumRationale.jsx` — uses: `from-indigo-500` (line 25 — 1 occurrence)
- `src/components/AI/RepoInsightsModal.jsx` — uses: `ds-btn-shimmer` (line 239 — 1 occurrence), `from-indigo-500` (lines 239, 651 — 2 occurrences)
- `src/components/AI/SuggestNameDescriptionModal.jsx` — uses: `ds-btn-shimmer` (line 324 — 1 occurrence), `from-indigo-500` (lines 21, 324 — 2 occurrences)
- `src/components/AIPolish/PolishReview.jsx` — uses: `ds-btn-shimmer` (line 207 — 1 occurrence), `from-indigo-500` (lines 40, 207 — 2 occurrences)

### Work Board
- `src/components/WorkBoard/AISummaryCard.jsx` — uses: `ds-gradient-text` (line 214 — 1 occurrence), `ds-card-shimmer` (line 177 — 1 occurrence), `backdrop-blur-xl` (lines 130, 177 — 2 occurrences), `from-indigo-500` (line 183 — 1 occurrence)
- `src/components/WorkBoard/WorkBoardPage.jsx` — uses: `backdrop-blur-xl` (line 358 — 1 occurrence)
- `src/components/WorkBoard/KpiRow.jsx` — uses: `backdrop-blur-xl` (line 79 — 1 occurrence), `from-indigo-500` (line 67 — 1 occurrence), `from-purple-500` (line 64 — 1 occurrence)
- `src/components/WorkBoard/EmptyStateDiscovery.jsx` — uses: `from-indigo-500` (line 34 — 1 occurrence)
- `src/components/WorkBoard/shared/shared-ui.jsx` — uses: `from-indigo-500` (line 44 — 1 occurrence)

### Onboarding
- `src/components/Onboarding/OnboardingTour.jsx` — uses: `ds-card-shimmer` (line 72 — 1 occurrence), `from-indigo-500` (lines 128, 137 — 2 occurrences)
- `src/components/Onboarding/onboardingSteps.js` — uses: `from-indigo-500` (line 9 — 1 occurrence), `to-cyan` (line 23 — 1 occurrence)

### MigrationWizard
- `src/components/MigrationWizard/MigrationWizard.jsx` — uses: `ds-btn-shimmer` (line 670 — 1 occurrence), `from-indigo-500` (lines 116, 162, 209, 354, 673 — 5 occurrences)
- `src/components/MigrationWizard/ui/repo/SkeletonRow.jsx` — uses: `ds-card-shimmer` (line 3 — 1 occurrence)
- `src/components/MigrationWizard/steps/SourceTypeStep.jsx` — uses: `ds-card-shimmer` (line 141 — 1 occurrence)
- `src/components/MigrationWizard/steps/AIReviewStep.jsx` — uses: `ds-btn-shimmer` (line 377 — 1 occurrence)
- `src/components/MigrationWizard/steps/RepoConfigStep.jsx` — uses: `to-cyan` (line 414 — 1 occurrence), `from-indigo-500` (line 746 — 1 occurrence)
- `src/components/MigrationWizard/steps/TargetConfigStep.jsx` — uses: `from-indigo-500` (line 182 — 1 occurrence)
- `src/components/MigrationWizard/steps/ScheduleStep.jsx` — uses: `from-indigo-500` (line 291 — 1 occurrence)
- `src/components/MigrationWizard/steps/ProgressStep.jsx` — uses: `from-indigo-500` (line 335 — 1 occurrence)
- `src/components/MigrationWizard/steps/SummaryStep.jsx` — uses: `from-indigo-500` (lines 528, 669 — 2 occurrences)
- `src/components/MigrationWizard/steps/AIReview/ExecutionPipeline.jsx` — uses: `from-indigo-500` (line 59 — 1 occurrence)
- `src/components/MigrationWizard/steps/AIReview/MigrationRouteCard.jsx` — uses: `from-indigo-500` (lines 27, 63 — 2 occurrences)
- `src/components/MigrationWizard/steps/RepoSelectStep/RepoDetailPanel.jsx` — uses: `ds-card-shimmer` (line 85 — 1 occurrence), `from-indigo-500` (line 129 — 1 occurrence)
- `src/components/MigrationWizard/steps/RepoSelectStep/SelectionSummaryBar.jsx` — uses: `backdrop-blur-xl` (line 24 — 1 occurrence)
- `src/components/MigrationWizard/steps/RepoSelectStep/SmartSelectMenu.jsx` — uses: `backdrop-blur-xl` (line 86 — 1 occurrence), `from-indigo-500` (line 72 — 1 occurrence)
- `src/components/MigrationWizard/steps/RepoSelectStep/RepoRow.jsx` — uses: `from-indigo-500` (line 10 — 1 occurrence)

### Other
- `src/components/Pricing/PricingCard.jsx` — uses: `ds-card-shimmer` (line 97 — 1 occurrence), `ds-border-glow` (line 99 — 1 occurrence), `ds-btn-shimmer` (line 240 — 1 occurrence), `backdrop-blur-xl` (line 102 — 1 occurrence), `from-indigo-500` (lines 79, 237 — 2 occurrences), `to-cyan` (line 79 — 1 occurrence)
- `src/components/Pricing/PricingPage.jsx` — uses: `ds-gradient-text` (lines 301, 415 — 2 occurrences), `ds-gradient-text-premium` (line 459 — 1 occurrence), `ds-btn-shimmer` (line 471 — 1 occurrence), `from-indigo-500` (line 469 — 1 occurrence), `to-cyan` (line 443 — 1 occurrence)
- `src/components/Pricing/FeatureComparison.jsx` — uses: `ds-gradient-text` (line 171 — 1 occurrence)
- `src/components/Roadmap/RoadmapPage.jsx` — uses: `ds-gradient-text` (line 110 — 1 occurrence)
- `src/components/Roadmap/RoadmapItem.jsx` — uses: `ds-card-shimmer` (line 20 — 1 occurrence)
- `src/components/Landing/HeroSection.jsx` — uses: `ds-gradient-text` (line 73 — 1 occurrence), `ds-btn-shimmer` (line 100 — 1 occurrence), `from-indigo-500` (line 47 — 1 occurrence)
- `src/components/Landing/FeaturesSection.jsx` — uses: `ds-gradient-text` (line 113 — 1 occurrence), `ds-card-shimmer` (line 140 — 1 occurrence), `from-indigo-500` (lines 12, 13 — 2 occurrences), `from-pink-500` (lines 52, 53 — 2 occurrences)
- `src/components/Landing/CTASection.jsx` — uses: `ds-gradient-text-premium` (line 48 — 1 occurrence), `ds-btn-shimmer` (line 80 — 1 occurrence)
- `src/components/Landing/PricingPreview.jsx` — uses: `ds-gradient-text` (line 260 — 1 occurrence), `ds-btn-shimmer` (line 215 — 1 occurrence), `from-indigo-500` (line 111 — 1 occurrence), `to-cyan` (line 111 — 1 occurrence)
- `src/components/Landing/LandingPage.jsx` — uses: `ds-btn-shimmer` (line 133 — 1 occurrence), `backdrop-blur-xl` (line 100 — 1 occurrence), `from-indigo-500` (line 127 — 1 occurrence)
- `src/components/CommunityHealthDashboard.jsx` — uses: `ds-card-shimmer` (line 377 — 1 occurrence), `from-indigo-500` (lines 212, 525 — 2 occurrences)
- `src/components/OrgPanel.jsx` — uses: `backdrop-blur-xl` (line 147 — 1 occurrence), `from-indigo-500` (lines 35, 211, 232 — 3 occurrences)
- `src/components/Setup/SystemSetup.jsx` — uses: `from-indigo-500` (line 68 — 1 occurrence)
- `src/components/Teams/TeamHub.jsx` — uses: `ds-btn-shimmer` (line 239 — 1 occurrence), `from-indigo-500` (lines 227, 228, 239 — 3 occurrences)
- `src/components/security/SecurityScanModal.jsx` — uses: `ds-card-shimmer` (line 35 — 1 occurrence), `from-indigo-500` (line 83 — 1 occurrence)
- `src/components/Settings/AIConfigSection.jsx` — uses: `ds-btn-shimmer` (line 526 — 1 occurrence), `backdrop-blur-xl` (line 368 — 1 occurrence), `from-indigo-500` (lines 349, 385, 526 — 3 occurrences)
- `src/components/Settings/WorkBoard/WorkBoardSummary.jsx` — uses: `backdrop-blur-xl` (line 22 — 1 occurrence), `from-indigo-500` (line 21 — 1 occurrence)
- `src/components/Settings/WorkBoard/WorkBoardSettingsSection.jsx` — uses: `from-indigo-500` (lines 138, 158 — 2 occurrences)
- `src/components/Settings/AIInstructionsSection.jsx` — uses: `from-indigo-500` (line 464 — 1 occurrence)
- `src/components/Settings/LicensePlanSection.jsx` — uses: `from-indigo-500` (line 29 — 1 occurrence)
- `src/components/Settings/AIConfig/CurrentConfigSummary.jsx` — uses: `backdrop-blur-xl` (line 70 — 1 occurrence), `from-indigo-500` (line 69 — 1 occurrence)
- `src/components/Settings/AIConfig/CapabilityMatrix.jsx` — uses: `backdrop-blur-xl` (line 34 — 1 occurrence), `from-indigo-500` (line 74 — 1 occurrence)
- `src/components/DevToolkit/DevToolkitPanel.jsx` — uses: `backdrop-blur-xl` (line 165 — 1 occurrence)
- `src/components/DevToolkit/CommitTab/CommitTab.jsx` — uses: `ds-btn-shimmer` (line 234 — 1 occurrence), `from-indigo-500` (line 234 — 1 occurrence)
- `src/components/DevToolkit/PRTab/PRTab.jsx` — uses: `ds-btn-shimmer` (line 253 — 1 occurrence), `from-indigo-500` (line 253 — 1 occurrence)
- `src/components/DevToolkit/ReviewTab/ReviewTab.jsx` — uses: `from-indigo-500` (line 191 — 1 occurrence)
- `src/components/PRReview/AIDeepReview/AIInlineComment.jsx` — uses: `from-indigo-500` (line 29 — 1 occurrence)
- `src/components/PRReview/PRReviewView.jsx` — uses: `from-indigo-500` (line 491 — 1 occurrence)
- `src/components/CreateRepoModal.jsx` — uses: `ds-btn-shimmer` (line 128 — 1 occurrence)
- `src/components/LicenseBadge.jsx` — uses: `from-purple-500` (line 151 — 1 occurrence), `from-indigo-500` (line 162 — 1 occurrence)
- `src/components/states/UpgradeRequired.jsx` — uses: `ds-btn-shimmer` (line 165 — 1 occurrence), `backdrop-blur-xl` (line 85 — 1 occurrence), `from-indigo-500` (lines 8, 231 — 2 occurrences)
- `src/components/states/ServiceUnavailable.jsx` — uses: `backdrop-blur-xl` (line 65 — 1 occurrence)

---

## By pattern

| Pattern | File count | Occurrence count |
|---|---|---|
| `backdrop-blur-xl` | 38 | 50 |
| `from-indigo-500` | 74 | 110 |
| `ds-btn-shimmer` | 25 | 28 |
| `ds-card-shimmer` | 16 | 17 |
| `to-cyan` | 7 | 8 |
| `backdrop-blur-2xl` | 4 | 4 |
| `from-purple-500` | 3 | 3 |
| `ds-gradient-text` | 10 | 12 |
| `ds-gradient-text-premium` | 2 | 2 |
| `from-pink-500` | 1 | 2 |
| `ds-glass` | 3 | 4 |
| `ds-glass-strong` | 1 | 1 |
| `ds-border-glow` | 2 | 2 |
| `ds-hover-glow` | 1 | 1 |
| `ds-shadow-glow` | 0 | 0 |
| `ds-animate-float` | 0 | 0 |
| `ds-pulse-glow` | 0 | 0 |
| `shadow-glow` | 0 | 0 |
| `animate-float` | 0 | 0 |

> Patterns with 0 occurrences exist only in `src/design-system.css` (the CSS definition file, excluded from this report) and are not referenced in any component.
>
> `ds-gradient-text` file/occurrence counts include `ds-gradient-text-premium` lines (substring match). `ds-glass` counts include `ds-glass-strong` lines. Both are listed as separate rows for planning purposes.

---

## Notes for Phase 2 engineers

1. `from-indigo-500` is the highest-volume pattern (110 occurrences across 74 files). Many hits are incidental low-opacity backgrounds or icon avatars — review per-line to distinguish structural gradients from decorative tints.
2. `backdrop-blur-xl` (50 occurrences, 38 files) is pervasive in the shell, panels, and dropdown surfaces. The replacement is a solid `bg-white dark:bg-slate-900` pattern with a conventional border.
3. `ds-btn-shimmer` (28 occurrences, 25 files) is used on nearly every primary action button. Removing it is safe once `Button.jsx` (line 4) is updated — downstream uses via `<Button variant="primary">` resolve automatically.
4. `ds-card-shimmer` (17 occurrences, 16 files) includes both direct class application and re-export via `ui/Card.jsx` hover prop and `ui/InsightCard.jsx`. Fixing those two primitives eliminates many downstream uses automatically.
5. `ds-shadow-glow`, `ds-pulse-glow`, `ds-animate-float`, `shadow-glow`, and `animate-float` have **zero callsites** in component files — they can be deleted from `design-system.css` without touching any component.
