import { test, expect } from '@playwright/test'
import { SAMPLE_PUBLIC_REPO } from './helpers'

test.describe('Modal Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Repositories' }).click()
    await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible({ timeout: 10000 })
  })

  test('should show context menu with all options on right-click', async ({ page }) => {
    const repoCard = page.getByRole('button', { name: new RegExp(SAMPLE_PUBLIC_REPO, 'i') }).first()
    await repoCard.click({ button: 'right' })

    const contextMenu = page.locator('.fixed.z-50.w-64')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    // Verify all context menu sections
    await expect(contextMenu.getByText('Open on GitHub')).toBeVisible()
    await expect(contextMenu.getByText('Copy Clone URL')).toBeVisible()
    await expect(contextMenu.getByText('AI Insights')).toBeVisible()
    await expect(contextMenu.getByText('Archive')).toBeVisible()
    await expect(contextMenu.getByText('Delete Repository')).toBeVisible()
  })

  test('should close context menu when clicking elsewhere', async ({ page }) => {
    const repoCard = page.getByRole('button', { name: new RegExp(SAMPLE_PUBLIC_REPO, 'i') }).first()
    await repoCard.click({ button: 'right' })

    const contextMenu = page.locator('.fixed.z-50.w-64')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    // Click on header to close context menu
    await page.locator('header').click({ position: { x: 10, y: 10 } })
    await expect(contextMenu).not.toBeVisible({ timeout: 5000 })
  })

  test('should open user menu and close it', async ({ page }) => {
    const userMenu = page.getByLabel(/open user menu/i)
    await userMenu.click()
    await expect(page.getByText('Logout')).toBeVisible()

    // Click elsewhere to close
    await page.locator('header').click({ position: { x: 10, y: 10 } })
    await expect(page.getByText('Logout')).not.toBeVisible({ timeout: 5000 })
  })

  test('should show user menu options', async ({ page }) => {
    const userMenu = page.getByLabel(/open user menu/i)
    await userMenu.click()

    await expect(page.getByText('Logout')).toBeVisible()
    await expect(page.getByText('View Profile')).toBeVisible()
    await expect(page.getByText('Re-authorize Permissions')).toBeVisible()
  })
})
