import { test, expect } from '@playwright/test'
import { checkA11y } from './a11y-helpers.js'
import { MOCK_USER } from './helpers.js'

/**
 * Hover the first match of a list/grid locator, skipping quietly if the mock
 * fixture happens to render zero items — mirrors the guard already used in
 * e2e/work-board-suggestions.spec.js so an empty fixture doesn't hard-fail
 * the a11y gate over an unrelated data question.
 */
async function hoverFirstIfVisible(page, locator) {
  if (await locator.isVisible().catch(() => false)) await locator.hover()
}

/**
 * Open the repo browser and deep-link into the first repo's detail view.
 * Returns once the RepoDetail tab bar is on screen.
 */
async function openFirstRepoDetail(page) {
  await page.goto('/')
  await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: /repositories/i }).first().click()
  // The repo-name button (data-testid="repo-card-open") navigates; clicking the
  // card body only toggles selection.
  await page.getByTestId('repo-card-open').first().click()
  await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible({ timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

/**
 * The twelve views the smoke gate scans, each with a `setup` that drives the app
 * to that screen and returns once it's ready to scan. Both the light and the
 * dark describe blocks below iterate this same list so a view is only defined
 * once — a new scanned view is added here and both themes pick it up.
 */
const VIEWS = [
  {
    name: 'dashboard',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    },
  },
  {
    name: 'repositories view',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: /repositories/i }).first().click()
      await page.waitForLoadState('networkidle')
      // Hover pass (panel-2026-09-04 gap #1): axe never entered the hovered
      // state, so `group-hover:` colour swaps on the card title were invisible
      // to the gate (finding A1). Hover the first card before scanning.
      await hoverFirstIfVisible(page, page.getByTestId('repo-card-open').first())
    },
  },
  {
    name: 'work board',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: /work board/i }).first().click()
      await page.waitForLoadState('networkidle')
      // The Work Board rows adopted the same stretched-control fix as RepoCard /
      // PR / Issue rows: WorkBoardRowLink's role="button" wrapper was replaced by
      // an absolute z-0 open-in-app <button> overlay with the inner controls
      // lifted to z-10. This scan guards against a regression of that shape.
      // Hover pass (gap #1): the default "My Reviews" tab renders rows with
      // data-testid="review-row"; hover the first one before scanning.
      await hoverFirstIfVisible(page, page.locator('[data-testid="review-row"]').first())
    },
  },
  {
    name: 'public status page',
    async setup(page) {
      await page.goto('/status')
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'repo detail (overview)',
    async setup(page) {
      await openFirstRepoDetail(page)
    },
  },
  {
    name: 'repo detail — pull requests tab',
    async setup(page) {
      await openFirstRepoDetail(page)
      await page.getByRole('tab', { name: /pull requests/i }).click()
      await page.waitForLoadState('networkidle')
      // Exercises the PR row list — the nested-interactive fix (stretched title
      // button over each Card) is what this scan protects.
    },
  },
  {
    name: 'repo detail — issues tab',
    async setup(page) {
      await openFirstRepoDetail(page)
      await page.getByRole('tab', { name: /issues/i }).click()
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'repo detail — commits tab',
    async setup(page) {
      await openFirstRepoDetail(page)
      await page.getByRole('tab', { name: /commits/i }).click()
      await page.waitForLoadState('networkidle')
      // Exercises the commit row list — the nested-interactive fix (stretched
      // message button over each row) is what this scan protects.
    },
  },
  {
    name: 'migration wizard (first step)',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
      // Keyboard shortcut `i` opens the Migration Wizard on its first step.
      await page.keyboard.press('i')
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'settings dialog',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByLabel(/open user menu/i).click()
      await page.getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByRole('dialog', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'settings dialog — about tab',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByLabel(/open user menu/i).click()
      await page.getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByRole('dialog', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
      await page.getByRole('tab', { name: /about/i }).click()
      await page.waitForLoadState('networkidle')
      // Exercises AboutSection's version badge, Changelog link, and (when an
      // update is available) the dismissable banner — this scan is what
      // caught the Dismiss button's sub-AA contrast on the tinted banner.
    },
  },
  {
    // The pricing page had ZERO axe coverage while carrying the most
    // hand-tuned colour in the product: tier badges, the "Most Popular"
    // ribbon, CTA fills and the monthly/yearly toggle. Every one of those
    // ratios was measured by hand and gated by nothing, so the next edit
    // could walk them back with the whole suite green.
    name: 'pricing page',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Pricing' }).first().click()
      await expect(page.getByRole('heading', { name: /pricing|plans/i }).first())
        .toBeVisible({ timeout: 15000 })
      await page.waitForLoadState('networkidle')
    },
  },

  // --- Overlays (panel-2026-09-04 gap #3) --------------------------------
  // The gate previously scanned exactly one modal (settings) and one wizard
  // step. These six entries are each one `setup()` — the rest of the harness
  // (theme loop, checkA11y) already generalizes to any view.
  {
    name: 'command palette (with query)',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })
      // A3 only fires once a query filters the list (clean before typing), so
      // an empty-palette scan would miss it — type a real query.
      await page.getByPlaceholder(/type a command or search/i).fill('repo')
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'dev toolkit',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      // Keyboard shortcut `g` opens Dev Toolkit regardless of viewport width —
      // the header trigger is `hidden nav:flex` (1340px breakpoint) and would
      // not be reachable at the desktop project's default 1280px viewport.
      await page.keyboard.press('g')
      await expect(page.getByRole('dialog', { name: /dev toolkit/i })).toBeVisible({ timeout: 10000 })
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'prompt studio',
    async setup(page) {
      await page.goto('/#/ai/prompts')
      await expect(page.getByRole('heading', { name: /prompt studio/i })).toBeVisible({ timeout: 15000 })
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'keyboard shortcuts help',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.keyboard.press('?')
      await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeVisible({ timeout: 10000 })
      await page.waitForLoadState('networkidle')
    },
  },
  {
    name: 'teams (hub)',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Teams', exact: true }).click()
      await expect(page.getByRole('heading', { name: /team hub/i })).toBeVisible({ timeout: 15000 })
      await page.waitForLoadState('networkidle')
      // Hover pass (gap #1): Teams is a card grid just like Repositories.
      await hoverFirstIfVisible(page, page.getByRole('button', { name: /^Open team/ }).first())
    },
  },
  {
    name: 'team detail page',
    // Discovered by this gate expansion (not in a11y-responsive.md, which
    // never opened this view) — real source bugs, not scan noise:
    //  light: TabBar's `pill` variant inactive-tab text (the canonical
    //    text-slate-500/dark:text-slate-400 pair) sits on the pill's tinted
    //    bg-slate-100/80 container and measures 4.43:1, below AA — same
    //    "canonical pair, tinted ground" root cause as A15/A9.
    //    src/components/ui/TabBar.jsx:13. Plus ActivityTab's date-divider
    //    text (`text-slate-400`, no dark-safe pairing) at 2.51:1 —
    //    src/components/Teams/ActivityTab.jsx:109,187.
    //  dark: TeamDetails "Back to Teams" link is `text-slate-500` at REST
    //    in dark mode (only `dark:hover:text-white` is set — no resting
    //    dark override) at 4.23:1 — src/components/Teams/TeamDetails.jsx:187.
    //    Plus ActivityTab repo-name chips (`text-brand-500`, no dark
    //    variant) at 3.94:1 — src/components/Teams/ActivityTab.jsx:145.
    // See the final report for the full axe node dump.
    knownFailing: {
      light: 'GATE-NEW-1: TabBar pill inactive-tab text 4.43:1 on tinted ground (TabBar.jsx:13) + ActivityTab date divider 2.51:1 (ActivityTab.jsx:109)',
      dark: 'GATE-NEW-2: TeamDetails "Back to Teams" resting-state text 4.23:1 in dark (TeamDetails.jsx:187) + ActivityTab repo-name chip text-brand-500 3.94:1 in dark (ActivityTab.jsx:145)',
    },
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Teams', exact: true }).click()
      await expect(page.getByRole('heading', { name: /team hub/i })).toBeVisible({ timeout: 15000 })
      const firstTeam = page.getByRole('button', { name: /^Open team/ }).first()
      if (!await firstTeam.isVisible().catch(() => false)) test.skip(true, 'no teams in the mock fixture')
      await firstTeam.click()
      await expect(page.getByRole('button', { name: /back to teams/i })).toBeVisible({ timeout: 15000 })
      await page.waitForLoadState('networkidle')
    },
  },
]

// Mobile-only surfaces that either don't exist at desktop widths (the FAB and
// the bottom-nav "More" sheet are both `md:hidden`/mobile nav elements) or are
// worth re-scanning at 375×667 because A2/A10/A17/A18/A21/A22 all needed only
// a narrow viewport to reproduce. Runs under the `mobile-a11y` project only
// (panel-2026-09-04 gap #2).
const MOBILE_ONLY_VIEWS = [
  {
    name: 'quick-actions FAB (open)',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: /quick actions/i }).click()
      await expect(page.getByRole('menuitem', { name: /create/i })).toBeVisible({ timeout: 10000 })
    },
  },
  {
    name: 'mobile "More" sheet (open)',
    async setup(page) {
      await page.goto('/')
      await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: /more/i }).click()
      await expect(page.getByRole('button', { name: /settings/i })).toBeVisible({ timeout: 10000 })
    },
  },
]

// Reuses the same setup() functions VIEWS already defines for these four —
// one definition per view, scanned at both the desktop and mobile viewport —
// plus the two mobile-only overlays above.
const MOBILE_VIEW_NAMES = ['dashboard', 'repositories view', 'repo detail (overview)', 'work board']
const MOBILE_VIEWS = [
  ...VIEWS.filter((v) => MOBILE_VIEW_NAMES.includes(v.name)),
  ...MOBILE_ONLY_VIEWS,
]

// PR Review is scanned in e2e/pr-review.spec.js instead: reaching it needs the
// /api/repos/** route stubs that spec already sets up, and duplicating them
// here would buy a second, flakier copy of the same coverage.

/**
 * Seed the persisted theme to `dark` BEFORE any page script runs. `useTheme.jsx`
 * reads this exact localStorage key on mount and toggles `.dark` on <html>, so
 * the whole app renders in dark mode from first paint (no flash, no toggle
 * click). Registered via addInitScript so it applies to the initial load and
 * survives the client-side navigations each view's setup performs.
 */
async function seedDarkTheme(page) {
  await page.addInitScript(() => {
    localStorage.setItem('github-repo-manager-theme', 'dark')
  })
}

/**
 * Both themes are HARD-gated on `critical`/`serious` (see {@link checkA11y}).
 * The dark scan was added once its contrast debt was driven to zero across all
 * twelve views by a design-conserving pass (LegalFooter muted text
 * `dark:text-slate-500`→`-400`; SettingsModal theme-tile + visibility-toggle
 * dark tokens). Colours settle before each scan via settleAnimations so the
 * check reads final composited colours, not a mid-fade blend.
 */
for (const theme of ['light', 'dark']) {
  test.describe(`accessibility smoke (${theme})`, () => {
    test.beforeEach(async ({ page }) => {
      if (theme === 'dark') await seedDarkTheme(page)
    })

    for (const view of VIEWS) {
      test(`${view.name} has no critical/serious a11y violations`, async ({ page }, testInfo) => {
        // Desktop views run under the default (desktop) project; the mobile
        // pass below re-uses a subset of these same setup() functions at
        // 375×667, so skip the duplicate registration here rather than
        // scanning every desktop-only overlay twice.
        test.skip(testInfo.project.name === 'mobile-a11y', 'desktop-only view; see MOBILE_VIEWS')
        const knownFailure = view.knownFailing?.[theme]
        if (knownFailure) test.fixme(true, knownFailure)
        await view.setup(page)
        await checkA11y(page)
      })
    }

    for (const view of MOBILE_VIEWS) {
      test(`[mobile 375×667] ${view.name} has no critical/serious a11y violations`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile-a11y', 'runs only under the mobile-a11y project')
        const knownFailure = view.knownFailing?.[theme]
        if (knownFailure) test.fixme(true, knownFailure)
        await view.setup(page)
        await checkA11y(page)
      })
    }
  })
}
