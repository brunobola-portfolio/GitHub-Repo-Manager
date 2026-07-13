import { test, expect } from '@playwright/test'
import { checkA11y } from './a11y-helpers.js'
import { MOCK_USER } from './helpers.js'

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
 * The nine views the smoke gate scans, each with a `setup` that drives the app
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
]

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
 * nine views by a design-conserving pass (LegalFooter muted text
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
      test(`${view.name} has no critical/serious a11y violations`, async ({ page }) => {
        await view.setup(page)
        await checkA11y(page)
      })
    }
  })
}
