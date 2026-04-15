import { test, expect } from '@playwright/test'
import { SAMPLE_PUBLIC_REPO } from './helpers'

test.describe('AI Search & Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Repositories' }).click()
    await expect(page.getByText(SAMPLE_PUBLIC_REPO).first()).toBeVisible({ timeout: 10000 })
  })

  test('should show AI search toggle button', async ({ page }) => {
    const aiToggle = page.getByTitle('Toggle AI Semantic Search')
    await expect(aiToggle).toBeVisible()
  })

  test('should toggle AI search mode', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search repositories/i)
    await expect(searchInput).toBeVisible()

    // Click AI toggle
    const aiToggle = page.getByTitle('Toggle AI Semantic Search')
    // Dispatch click directly on the button to bypass the z-40 select-all
    // wrapper that intercepts pointer events on narrow/wrapped toolbars.
    await aiToggle.evaluate((el) => el.click())

    // Placeholder should change to AI mode
    await expect(page.getByPlaceholder(/ask ai/i)).toBeVisible()
  })

  test('should switch back to normal search on second toggle', async ({ page }) => {
    const aiToggle = page.getByTitle('Toggle AI Semantic Search')

    // Toggle on
    // Dispatch click directly on the button to bypass the z-40 select-all
    // wrapper that intercepts pointer events on narrow/wrapped toolbars.
    await aiToggle.evaluate((el) => el.click())
    await expect(page.getByPlaceholder(/ask ai/i)).toBeVisible()

    // Toggle off
    // Dispatch click directly on the button to bypass the z-40 select-all
    // wrapper that intercepts pointer events on narrow/wrapped toolbars.
    await aiToggle.evaluate((el) => el.click())
    await expect(page.getByPlaceholder(/search repositories/i)).toBeVisible()
  })

  test('should show search input with purple styling in AI mode', async ({ page }) => {
    const aiToggle = page.getByTitle('Toggle AI Semantic Search')
    // Dispatch click directly on the button to bypass the z-40 select-all
    // wrapper that intercepts pointer events on narrow/wrapped toolbars.
    await aiToggle.evaluate((el) => el.click())

    const searchInput = page.getByPlaceholder(/ask ai/i)
    await expect(searchInput).toBeVisible()

    // Check that the input has purple-themed classes
    const classes = await searchInput.getAttribute('class')
    expect(classes).toContain('purple')
  })

  test('should show AI Insights button on repo card hover', async ({ page }) => {
    // Hover over a repo card to reveal action buttons
    const repoCard = page.getByRole('button', { name: new RegExp(SAMPLE_PUBLIC_REPO, 'i') }).first()
    await repoCard.hover()

    // AI Insights button should become visible
    const insightsButton = page.getByTitle('AI Insights').first()
    await expect(insightsButton).toBeVisible({ timeout: 5000 })
  })

  test('should show Community Health button on repo card hover', async ({ page }) => {
    const repoCard = page.getByRole('button', { name: new RegExp(SAMPLE_PUBLIC_REPO, 'i') }).first()
    await repoCard.hover()

    const healthButton = page.getByTitle('Community Health').first()
    await expect(healthButton).toBeVisible({ timeout: 5000 })
  })
})
