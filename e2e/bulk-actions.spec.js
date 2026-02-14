import { test, expect } from '@playwright/test'
import { SAMPLE_PUBLIC_REPO, FIRST_PAGE_REPOS } from './helpers'

test.describe('Bulk Actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for app to load
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    // Navigate to Repositories view
    await page.getByRole('button', { name: 'Repositories' }).click()
    // Wait for repos to load
    await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible({ timeout: 10000 })
  })

  test('should display repo cards', async ({ page }) => {
    // Several mock repos should be visible
    for (const repo of FIRST_PAGE_REPOS.slice(0, 5)) {
      await expect(page.getByText(repo).first()).toBeVisible()
    }
  })

  test('should select a repo by clicking on its card', async ({ page }) => {
    // Click on a repo card to toggle selection
    const repoCard = page.getByRole('button', { name: new RegExp(SAMPLE_PUBLIC_REPO, 'i') }).first()
    await repoCard.click()

    // Floating selection bar should appear
    const selectionBar = page.locator('.fixed.bottom-6')
    await expect(selectionBar).toBeVisible({ timeout: 5000 })
  })

  test('should select all repos via header checkbox', async ({ page }) => {
    // Click the "Select all" checkbox
    const selectAll = page.getByRole('checkbox', { name: /select all/i })
    await selectAll.click()

    // Floating selection bar should appear with count
    const selectionBar = page.locator('.fixed.bottom-6')
    await expect(selectionBar).toBeVisible({ timeout: 5000 })
  })

  test('should show selection menu dropdown', async ({ page }) => {
    // Find and click the dropdown arrow next to select-all
    const selectionGroup = page.locator('[role="checkbox"]').locator('..')
    const dropdownButton = selectionGroup.locator('button').first()
    await dropdownButton.click()

    // Selection menu items should appear
    await expect(page.getByText('Select All').or(page.getByText('Deselect All'))).toBeVisible()
    await expect(page.getByText('Invert Selection')).toBeVisible()
    await expect(page.getByText('Clear Selection')).toBeVisible()
  })

  test('should toggle view mode between grid and list', async ({ page }) => {
    // Find view toggle buttons (grid/list)
    const viewToggles = page.locator('.flex.rounded-xl.p-1 button')
    const count = await viewToggles.count()

    if (count >= 2) {
      // Click list view (second button)
      await viewToggles.nth(1).click()
      // Repos should still be visible
      await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible()

      // Click back to grid view
      await viewToggles.nth(0).click()
      await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible()
    }
  })

  test('should filter repos by search query', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search repositories/i)
    await searchInput.fill('fintech')

    // Wait for filter to apply
    await page.waitForTimeout(300)

    // Matching repo should be visible
    await expect(page.getByText('fintech-dashboard').first()).toBeVisible()
  })

  test('should show pagination info', async ({ page }) => {
    await expect(page.getByText(/showing/i)).toBeVisible()
    await expect(page.getByText(/1 \/ 3/)).toBeVisible()
  })
})
