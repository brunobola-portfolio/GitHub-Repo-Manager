// Zero-config honesty regression — verifies that without VITE_MOCK_MODE
// the app never renders mock repository names or other forbidden strings.
//
// The strongest guard is in tests/build/build-honesty.test.js (greps the
// dist/ bundle), but this spec catches surfaces that *could* render mock
// strings dynamically at runtime if a future refactor accidentally
// imports from src/__mocks__/ outside the dev-only guard.
import { test, expect } from '@playwright/test'

const FORBIDDEN_TEXTS = [
  'nlp-chatbot-engine',
  'web-assembly-video-editor',
  'design-system-tokens',
  'fintech-dashboard',
  'ai-analytics-platform',
]

test.describe('zero-config honesty', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
  })

  test('logged-out landing renders without mock repo strings', async ({ page }) => {
    await page.goto('/')
    const body = page.locator('body')
    for (const text of FORBIDDEN_TEXTS) {
      await expect(body).not.toContainText(text)
    }
  })
})
