import { test, expect } from '@playwright/test'

test.describe('Context Menu — scroll-free and flip behavior', () => {
	test.beforeEach(async ({ page }) => {
		// Repo cards live on the repositories view (goto '/' lands on the
		// dashboard, where every test below would self-skip).
		await page.goto('/#/repos')
		await page.locator('[data-testid="repo-card"]').first().waitFor({ state: 'visible', timeout: 15000 })
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

		// Fire the contextmenu event ON a card (so the app's handler runs) but
		// with pointer coordinates at the very bottom of the viewport — a
		// downward-opening menu would overflow, so the position math must
		// flip/clamp it fully on screen. (The old version dispatched on <body>,
		// which no card handler ever receives, so the test always self-skipped.)
		await page.locator('[data-testid="repo-card"]').first().dispatchEvent('contextmenu', {
			bubbles: true,
			clientX: 200,
			clientY: viewport.height - 20,
		})
		const menu = page.getByRole('menu').first()
		await expect(menu).toBeVisible()

		const menuBox = await menu.boundingBox()
		expect(menuBox).not.toBeNull()
		expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
		expect(menuBox.y).toBeGreaterThanOrEqual(0)
	})

	test('batch menu shows no scrollbar with multiple repos selected', async ({ page }) => {
		const cards = page.locator('[data-testid="repo-card"]')
		const count = await cards.count()
		if (count < 2) test.skip()

		// Click two cards to select them (clicking the whole card toggles selection).
		await cards.nth(0).click()
		await cards.nth(1).click()

		// Right-click one of the selected cards to open the batch context menu.
		await cards.nth(0).click({ button: 'right' })
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
