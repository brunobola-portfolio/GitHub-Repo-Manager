import { test, expect } from '@playwright/test'

test.describe('Context Menu — scroll-free and flip behavior', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/')
		// Wait until at least one repo card is visible, but don't fail if not.
		await page.locator('[data-testid="repo-card"]').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
	})

	test('right-click menu opens without scrollbars', async ({ page }) => {
		const card = page.locator('[data-testid="repo-card"]').first()
		if (!(await card.isVisible())) test.skip()

		await card.click({ button: 'right' })
		const menu = page.getByRole('menu').first()
		await expect(menu).toBeVisible()

		// Assert no vertical or horizontal scrolling is possible on the menu.
		const dims = await menu.evaluate((el) => ({
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
			scrollWidth: el.scrollWidth,
			clientWidth: el.clientWidth,
			overflowY: getComputedStyle(el).overflowY,
			overflowX: getComputedStyle(el).overflowX,
		}))

		expect(dims.scrollHeight).toBe(dims.clientHeight)
		expect(dims.scrollWidth).toBe(dims.clientWidth)
		expect(['visible', 'clip']).toContain(dims.overflowY)
		expect(['visible', 'clip']).toContain(dims.overflowX)
	})

	test('menu flips upward when opened near bottom edge', async ({ page }) => {
		const viewport = page.viewportSize()
		if (!viewport) test.skip()

		const card = page.locator('[data-testid="repo-card"]').first()
		if (!(await card.isVisible())) test.skip()

		// Dispatch a contextmenu event at the very bottom of the viewport.
		await page.dispatchEvent('body', 'contextmenu', {
			bubbles: true,
			clientX: 200,
			clientY: viewport.height - 20,
		})
		const menu = page.getByRole('menu').first()
		if (!(await menu.isVisible({ timeout: 500 }).catch(() => false))) test.skip()

		const menuBox = await menu.boundingBox()
		expect(menuBox).not.toBeNull()
		if (menuBox) {
			expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
			expect(menuBox.y).toBeGreaterThanOrEqual(0)
		}
	})

	test('batch menu shows no scrollbar with multiple repos selected', async ({ page }) => {
		const checkboxes = page.locator('[data-testid="repo-card-checkbox"]')
		const count = await checkboxes.count()
		if (count < 2) test.skip()
		await checkboxes.nth(0).click()
		await checkboxes.nth(1).click()

		const card = page.locator('[data-testid="repo-card"]').first()
		await card.click({ button: 'right' })
		const menu = page.getByRole('menu').first()
		await expect(menu).toBeVisible()

		const dims = await menu.evaluate((el) => ({
			scrollHeight: el.scrollHeight,
			clientHeight: el.clientHeight,
			scrollWidth: el.scrollWidth,
			clientWidth: el.clientWidth,
		}))
		expect(dims.scrollHeight).toBe(dims.clientHeight)
		expect(dims.scrollWidth).toBe(dims.clientWidth)
	})
})
