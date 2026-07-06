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

test.describe('accessibility smoke', () => {
  test('dashboard has no critical/serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await checkA11y(page, {
      // Known violations — address rather than extend this list when possible.
      allowlist: []
    })
  })

  test('repositories view has no critical/serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /repositories/i }).first().click()
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('work board has no critical/serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /work board/i }).first().click()
    await page.waitForLoadState('networkidle')
    // The Work Board rows adopted the same stretched-control fix as RepoCard /
    // PR / Issue rows: WorkBoardRowLink's role="button" wrapper was replaced by
    // an absolute z-0 open-in-app <button> overlay with the inner controls
    // lifted to z-10. This scan guards against a regression of that shape.
    await checkA11y(page)
  })

  test('public status page has no critical/serious a11y violations', async ({ page }) => {
    await page.goto('/status')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('repo detail (overview) has no critical/serious a11y violations', async ({ page }) => {
    await openFirstRepoDetail(page)
    await checkA11y(page)
  })

  test('repo detail — pull requests tab has no critical/serious a11y violations', async ({ page }) => {
    await openFirstRepoDetail(page)
    await page.getByRole('tab', { name: /pull requests/i }).click()
    await page.waitForLoadState('networkidle')
    // Exercises the PR row list — the nested-interactive fix (stretched title
    // button over each Card) is what this scan protects.
    await checkA11y(page)
  })

  test('repo detail — issues tab has no critical/serious a11y violations', async ({ page }) => {
    await openFirstRepoDetail(page)
    await page.getByRole('tab', { name: /issues/i }).click()
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('migration wizard (first step) has no critical/serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    // Keyboard shortcut `i` opens the Migration Wizard on its first step.
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('settings dialog has no critical/serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await page.getByLabel(/open user menu/i).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })
})
