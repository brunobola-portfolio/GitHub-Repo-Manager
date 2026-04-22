import { test, expect } from '@playwright/test'
import { checkA11y } from './a11y-helpers.js'
import { MOCK_USER } from './helpers.js'

test.describe('accessibility smoke', () => {
  test('dashboard has no serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await checkA11y(page, {
      // Known violations — address rather than extend this list when possible.
      allowlist: []
    })
  })

  test('repositories view has no serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /repositories/i }).first().click()
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('work board has no serious a11y violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText(MOCK_USER.login)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /work board/i }).first().click()
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })

  test('public status page has no serious a11y violations', async ({ page }) => {
    await page.goto('/status')
    await page.waitForLoadState('networkidle')
    await checkA11y(page)
  })
})
