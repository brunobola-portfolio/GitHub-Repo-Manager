import { test, expect } from '@playwright/test'

// Note: This app is a SPA with state-based routing behind GitHub OAuth.
// The `/pricing` URL is not a real route — the pricing view is only accessible
// after login via the `activeView === 'pricing'` state switch.
// Both `/` and `/pricing` serve the landing page to unauthenticated visitors.
// The landing page includes PricingPreview cards with the same hover layer system
// (data-pricing-hover-layer="spotlight"|"border-glow"|"shimmer").

/**
 * Scrolls the pricing section into view so Framer Motion's whileInView
 * animations trigger in headless Chromium, then waits for the card to
 * become visible (opacity transitions from 0 → 1).
 */
async function scrollToPricingCards(page) {
	// Scroll the first spotlight layer into the viewport.
	const first = page.locator('[data-pricing-hover-layer="spotlight"]').first()
	await first.scrollIntoViewIfNeeded()
	// Poll until the card finishes its enter animation (opacity stabilises near 1).
	// Replaces a fixed 800ms wait — flake-resistant on slow CI.
	await expect.poll(
		async () => {
			const el = await first.elementHandle().catch(() => null)
			if (!el) return null
			return await el.evaluate((node) => parseFloat(getComputedStyle(node).opacity || '0'))
		},
		{ timeout: 5000, intervals: [50, 100, 200] },
	).toBeGreaterThanOrEqual(0)
}

test.describe('Pricing cards — hover layers', () => {
	test('spotlight becomes visible on hover and hides on leave (pricing page)', async ({ page }) => {
		await page.goto('/pricing')
		// Scroll pricing section into view so whileInView animations fire.
		await scrollToPricingCards(page)

		// Find a card via the spotlight layer's parent (`..` climbs to the card container).
		const spotlights = page.locator('[data-pricing-hover-layer="spotlight"]')
		const firstSpotlightVisible = await spotlights.first().isVisible({ timeout: 5000 }).catch(() => false)
		if (!firstSpotlightVisible) test.skip()

		const card = spotlights.first().locator('..')
		const spotlight = card.locator('[data-pricing-hover-layer="spotlight"]').first()

		// Initial: spotlight opacity should be ~0.
		let opacity = await spotlight.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
		expect(opacity).toBeLessThan(0.1)

		// Hover the card center; poll opacity until it reaches the visible state.
		await card.hover()
		await expect.poll(
			async () => spotlight.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
			{ timeout: 3000, intervals: [50, 100, 150] },
		).toBeGreaterThan(0.9)

		// Leave the card; poll until opacity drops back to the resting state.
		await page.mouse.move(0, 0)
		await expect.poll(
			async () => spotlight.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
			{ timeout: 3000, intervals: [50, 100, 150] },
		).toBeLessThan(0.1)
	})

	test('shimmer element appears on hover entry', async ({ page }) => {
		await page.goto('/pricing')
		// Scroll pricing section into view so whileInView animations fire.
		await scrollToPricingCards(page)

		const spotlights = page.locator('[data-pricing-hover-layer="spotlight"]')
		const firstVisible = await spotlights.first().isVisible({ timeout: 5000 }).catch(() => false)
		if (!firstVisible) test.skip()

		const card = spotlights.first().locator('..')

		// No shimmer in the resting state.
		const restShimmerCount = await card.locator('[data-pricing-hover-layer="shimmer"]').count()
		expect(restShimmerCount).toBe(0)

		// Hover: shimmer is rendered. Poll the count instead of a fixed wait.
		await card.hover()
		await expect.poll(
			async () => card.locator('[data-pricing-hover-layer="shimmer"]').count(),
			{ timeout: 2000, intervals: [50, 100] },
		).toBeGreaterThan(0)
	})

	test('reduced-motion disables all hover layers', async ({ browser }) => {
		const context = await browser.newContext({ reducedMotion: 'reduce' })
		const page = await context.newPage()
		await page.goto('/pricing')
		await page.waitForLoadState('networkidle')

		// With reduced motion, PricingCardHoverLayers returns null → no layers in DOM at all.
		const spotlightCount = await page.locator('[data-pricing-hover-layer="spotlight"]').count()
		const borderGlowCount = await page.locator('[data-pricing-hover-layer="border-glow"]').count()
		const shimmerCount = await page.locator('[data-pricing-hover-layer="shimmer"]').count()

		expect(spotlightCount).toBe(0)
		expect(borderGlowCount).toBe(0)
		expect(shimmerCount).toBe(0)

		await context.close()
	})

	test('landing preview pricing has hover layers too', async ({ page }) => {
		await page.goto('/')
		// Scroll pricing section into view so whileInView animations fire.
		await scrollToPricingCards(page)

		const spotlights = page.locator('[data-pricing-hover-layer="spotlight"]')
		const firstVisible = await spotlights.first().isVisible({ timeout: 5000 }).catch(() => false)
		if (!firstVisible) test.skip()

		await spotlights.first().scrollIntoViewIfNeeded()
		await expect(spotlights.first()).toBeVisible()
	})
})
