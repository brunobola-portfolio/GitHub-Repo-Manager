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

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    // Verify core context menu sections via the per-item data-testid contract
    // (exposed by the action registry's menu renderer). Targeting the testid
    // avoids strict-mode violations when an item description happens to share
    // a substring with another menu label (e.g. Archive's description mentions
    // "unarchived", which used to collide with `getByText('Archive')`).
    // "AI Insights" was removed from the context menu in f33acba.
    await expect(contextMenu.getByTestId('menu-item-open_on_github')).toBeVisible()
    // "Copy Clone URL" is a parent submenu without its own testid; targeting
    // its label text works because no other menu item shares that string.
    await expect(contextMenu.getByText('Copy Clone URL')).toBeVisible()
    await expect(contextMenu.getByTestId('menu-item-archive')).toBeVisible()
    await expect(contextMenu.getByTestId('menu-item-delete')).toBeVisible()
  })

  test('should close context menu when clicking elsewhere', async ({ page }) => {
    const repoCard = page.getByRole('button', { name: new RegExp(SAMPLE_PUBLIC_REPO, 'i') }).first()
    await repoCard.click({ button: 'right' })

    const contextMenu = page.locator('[role="menu"]')
    await expect(contextMenu).toBeVisible({ timeout: 5000 })

    // The context menu renders a full-viewport backdrop (z-99) that intercepts
    // clicks. Press Escape to dismiss — that's the actual close-on-click-outside
    // interaction a user would perform with the keyboard.
    await page.keyboard.press('Escape')
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
