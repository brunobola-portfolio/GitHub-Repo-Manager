import { test, expect } from '@playwright/test'

test.describe('AI Assistant — paste URL flow', () => {
  test('pastes an Azure URL, answers the dialog, and opens the wizard pre-filled', async ({ page }) => {
    await page.goto('/')

    // Wait for auto-auth (mock mode)
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })

    // Open the AI Assistant
    await page.getByRole('button', { name: /open ai assistant/i }).click()
    await expect(page.getByRole('dialog', { name: /ai assistant/i })).toBeVisible()

    // Paste an Azure URL
    const input = page.getByRole('textbox', { name: /message the ai assistant/i })
    await input.fill('https://dev.azure.com/bruno/AWIP/_git/Cacadores')
    await input.press('Enter')

    // Paste-URL card should appear with the parsed fields
    await expect(page.getByText(/URL detectado/i)).toBeVisible()
    await expect(page.getByText(/bruno/)).toBeVisible()
    await expect(page.getByText(/AWIP/)).toBeVisible()
    await expect(page.getByText(/Cacadores/)).toBeVisible()

    // Answer 1: target org. Use the placeholder text — it's the most stable
    // handle for the dynamic dialog input (the label regex broke when Field
    // started wrapping the label in a <span>).
    const targetOrgInput = page.getByPlaceholder('p.ex. bolalabs')
    await expect(targetOrgInput).toBeVisible({ timeout: 10000 })
    await targetOrgInput.fill('bolalabs')
    await targetOrgInput.press('Enter')

    // Answer 2: target name
    const nameInput = page.getByPlaceholder(/escreve "manter" para usar o original/)
    await expect(nameInput).toBeVisible({ timeout: 10000 })
    await nameInput.fill('manter')
    await nameInput.press('Enter')

    // Confirm button appears
    const confirmButton = page.getByRole('button', { name: /abrir wizard/i })
    await expect(confirmButton).toBeVisible()
    await confirmButton.click()

    // The Migration Wizard should open, seeded on the Configure step
    await expect(page.getByTestId('wizard-step-repoConfig')).toBeVisible({ timeout: 10000 })
  })

  test('falls back to the normal chat when no URL is pasted', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /open ai assistant/i }).click()
    await expect(page.getByRole('dialog', { name: /ai assistant/i })).toBeVisible()

    const input = page.getByRole('textbox', { name: /message the ai assistant/i })
    await input.fill('olá, ajuda-me com um repo novo')
    await input.press('Enter')

    // No paste-URL card; the message is handled by the normal chat flow.
    await expect(page.getByText(/URL detectado/i)).not.toBeVisible()
  })

  test('dismisses the paste dialog when cancel is clicked', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByAltText('dev-user')).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /open ai assistant/i }).click()
    await expect(page.getByRole('dialog', { name: /ai assistant/i })).toBeVisible()

    const input = page.getByRole('textbox', { name: /message the ai assistant/i })
    await input.fill('https://github.com/bolalabs/BolaLabs')
    await input.press('Enter')

    await expect(page.getByText(/URL detectado/i)).toBeVisible()
    await page.getByRole('button', { name: /cancelar/i }).click()
    await expect(page.getByText(/URL detectado/i)).not.toBeVisible()
  })
})
