import { test, expect } from '@playwright/test'

test.describe('Authentication Flow (Mock Mode)', () => {
  test('should auto-authenticate in mock mode and show app', async ({ page }) => {
    await page.goto('/')

    // In mock mode, the app auto-authenticates via useGitHub hook
    // User avatar should be visible (mock user: dev-user)
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })
  })

  test('should show navigation tabs when authenticated', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Teams' })).toBeVisible()
  })

  test('should show user menu with logout option', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })

    const userMenuButton = page.getByLabel(/open user menu/i)
    await userMenuButton.click()

    await expect(page.getByText('Logout')).toBeVisible()
    await expect(page.getByText('View Profile')).toBeVisible()
    await expect(page.getByText('Re-authorize Permissions')).toBeVisible()
  })

  test('should show app title in header', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /Repo Manager/i })).toBeVisible({ timeout: 15000 })
  })
})
