import { test, expect } from '@playwright/test'
import { SAMPLE_PUBLIC_REPO } from './helpers'

test.describe('Dashboard & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for app to fully load in mock mode
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
  })

  test('should show dashboard as default view when authenticated', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible()
  })

  test('should navigate between Dashboard, Repositories, and Teams', async ({ page }) => {
    // Click Repositories
    await page.getByRole('button', { name: 'Repositories' }).click()
    await expect(page.getByPlaceholder(/search repositories/i)).toBeVisible({ timeout: 10000 })

    // Click Teams
    await page.getByRole('button', { name: 'Teams' }).click()

    // Click back to Dashboard
    await page.getByRole('button', { name: 'Dashboard' }).click()
  })

  test('should toggle theme between dark and light mode', async ({ page }) => {
    const themeButton = page.getByRole('button', { name: /dark mode|light mode/i })
    await expect(themeButton).toBeVisible()

    const htmlElement = page.locator('html')
    const initialIsDark = await htmlElement.evaluate(el => el.classList.contains('dark'))

    // Toggle theme
    await themeButton.click()
    const afterToggleIsDark = await htmlElement.evaluate(el => el.classList.contains('dark'))
    expect(afterToggleIsDark).toBe(!initialIsDark)

    // Toggle back
    await themeButton.click()
    const finalIsDark = await htmlElement.evaluate(el => el.classList.contains('dark'))
    expect(finalIsDark).toBe(initialIsDark)
  })

  test('should display repos in repository view', async ({ page }) => {
    await page.getByRole('button', { name: 'Repositories' }).click()

    // Mock repos should be visible
    await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('fintech-dashboard').first()).toBeVisible()
    await expect(page.getByText('react-component-library').first()).toBeVisible()
  })

  test('should show pagination controls', async ({ page }) => {
    await page.getByRole('button', { name: 'Repositories' }).click()
    await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible({ timeout: 10000 })

    // Pagination should show page info
    await expect(page.getByText(/showing/i)).toBeVisible()
    await expect(page.getByText(/1 \/ 3/)).toBeVisible()
  })

  test('should show skip links for accessibility', async ({ page }) => {
    const skipLink = page.getByText('Skip to main content')
    await expect(skipLink).toBeAttached()
  })

  test('should open user menu dropdown', async ({ page }) => {
    const userMenuButton = page.getByLabel(/open user menu|close user menu/i)
    await expect(userMenuButton).toBeVisible()
    await userMenuButton.click()

    await expect(page.getByText('Logout')).toBeVisible()
    await expect(page.getByText('View Profile')).toBeVisible()
  })

  test('should open notifications panel', async ({ page }) => {
    const notifButton = page.getByLabel(/show notifications|hide notifications/i)
    await expect(notifButton).toBeVisible()
    await notifButton.click()

    await expect(page.getByText('Notifications')).toBeVisible()
  })

  test('should filter repos by search in repos view', async ({ page }) => {
    await page.getByRole('button', { name: 'Repositories' }).click()
    await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible({ timeout: 10000 })

    const searchInput = page.getByPlaceholder(/search repositories/i)
    await searchInput.fill('blockchain')

    await page.waitForTimeout(300)
    await expect(page.getByText('blockchain-wallet-core').first()).toBeVisible()
  })
})
