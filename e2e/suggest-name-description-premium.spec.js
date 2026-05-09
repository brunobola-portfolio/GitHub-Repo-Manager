import { test, expect } from '@playwright/test';

test.describe('Premium Suggest Name & Description', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?demo=1'); // assumes the existing demo / mock-mode entry point
    });

    test('opens modal, expands ContextPicker, runs suggest, sees confidence pill', async ({ page }) => {
        test.fixme(true, 'requires mock-mode demo entry point (/?demo=1) to be wired in app shell');
        // Navigate into a repo's settings (the existing entry point that opens the modal).
        await page.getByRole('button', { name: /settings/i }).first().click();
        await page.getByRole('button', { name: /suggest name & description/i }).click();

        const modal = page.getByRole('dialog');
        await expect(modal).toBeVisible();

        // Expand ContextPicker
        await modal.getByRole('button', { name: /context/i }).click();

        // Default signals visible
        await expect(modal.getByLabelText(/README/i)).toBeChecked();
        await expect(modal.getByLabelText(/Manifest/i)).toBeChecked();

        // Enable entrypoints
        await modal.getByLabelText(/entrypoints/i).check();

        // Click suggest
        await modal.getByRole('button', { name: /suggest with ai|suggest \(heuristic\)/i }).click();

        // Premium rationale renders with a confidence label
        await expect(modal.getByText(/Confidence (HIGH|MEDIUM|LOW)/i)).toBeVisible();

        // Apply path stays unchanged
        await modal.getByRole('button', { name: /apply changes/i }).click();
    });

    test('rejects when custom files exceed budget', async ({ page: _page }) => {
        // This relies on the dev mock returning a rejected /ai/suggest-name-description
        // when customFiles is non-empty AND under 8 KB cap. With no mock support, the test
        // is .fixme until backend mock is wired.
        test.fixme(true, 'requires mock-mode wiring of customFiles → 400 path');
    });
});
