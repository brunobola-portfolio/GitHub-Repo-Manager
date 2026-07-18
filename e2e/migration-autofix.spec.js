import { test, expect } from '@playwright/test'

async function installMocks(page) {
  // CSRF token — useAutoFixPlan posts to /api/ai/migration-size-strategy
  // and getCsrfToken() throws on a 401 from /api/auth/csrf-token, which
  // would skip the AI fan-out and leave the AISuggestionBanner unmounted.
  await page.route('**/api/auth/csrf-token', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'test-csrf' }) }),
  )

  // AI status
  await page.route('**/api/config/ai-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) }),
  )

  // Azure credential checks (env-auth available so no PAT needed)
  await page.route('**/api/azure/env-auth', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }),
  )
  await page.route('**/api/azure/oauth-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false }) }),
  )

  // Validate credentials
  await page.route('**/api/azure/validate', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true }) }),
  )

  // Orgs list (used by OAuth org dropdown)
  await page.route('**/api/azure/orgs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'myorg' }]) }),
  )

  // Projects list
  await page.route('**/api/azure/projects**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ projects: [{ id: 'p1', name: 'APOS', state: 'wellFormed' }] }),
    }),
  )

  // Repos list (GET and POST variants).
  // 'huge' size = 11 GB so it exceeds SIZE_CRITICAL_BYTES (10 GB) in
  // riskRules.js and triggers the SizeStrategyCard + AISuggestionBanner path
  // the test exercises.
  const repoPayload = JSON.stringify({
    repos: [
      { id: 'r1', name: 'api', size: 1024, branches: 1, isTfvc: false, lastCommitDate: '2025-01-01' },
      { id: 'r2', name: 'huge', size: 11 * 1024 * 1024 * 1024, branches: 3, isTfvc: false, lastCommitDate: '2025-01-01' },
    ],
    versionControlType: 'Git',
  })
  await page.route('**/api/azure/repos**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: repoPayload }),
  )

  // Duplicate check
  await page.route('**/api/import/check-duplicates', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ duplicates: {} }) }),
  )

  // AI size strategy
  await page.route('**/api/ai/migration-size-strategy', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ strategy: 'lfs-migrate', rationale: 'binary assets', confidence: 0.8 }),
    }),
  )

  // Git status (checked on SourceTypeStep)
  await page.route('**/api/import/git-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }),
  )
}

test.describe('Migration Auto-Fix Drawer', () => {
  test('reduces blockers after Apply selected', async ({ page }) => {
    await installMocks(page)
    // e2eLiveAzureAuth: the demo-mode guard in useSourceStepForm skips the
    // env-auth/oauth-status fetches this spec stubs via page.route above.
    await page.goto('/?e2eLiveAzureAuth=1')

    // Wait for mock-mode app to mount (keyboard shortcut only active once authenticated)
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })

    // Open Migration Wizard via keyboard shortcut
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })

    // Step 1: SourceTypeStep — click Azure DevOps (auto-advances to azureConnect)
    await page.getByRole('button', { name: /Azure DevOps/i }).click()

    // Step 1b: pick the Cloud server preset. The redesigned SourceStep
    // (ServerPicker, commit cda09e7) intentionally removed the silent
    // dev.azure.com fallback, so validation now bails until a host is set —
    // without this the project picker never renders.
    const cloudPreset = page.getByRole('button', { name: 'Cloud', exact: true })
    await expect(cloudPreset).toBeVisible({ timeout: 10000 })
    await cloudPreset.click()

    // Step 2: azureConnect (SourceStep)
    // With env-auth available, credentialMode defaults to 'serverPat'.
    // Type an org name — the debounced auto-validate fires against the mocked endpoints.
    const orgInput = page.getByRole('textbox', { name: /organization/i })
    await expect(orgInput).toBeVisible({ timeout: 10000 })
    await orgInput.fill('myorg')

    // Wait for validation + project list to load, then select APOS project.
    // The wizard uses a custom <Select> (button-based combobox), so interact
    // like a user would: click trigger, then click the option.
    const projectSelect = page.getByRole('combobox', { name: /project/i })
    await expect(projectSelect).toBeVisible({ timeout: 10000 })
    await projectSelect.click()
    await page.getByRole('option', { name: 'APOS' }).click()

    // Click Next to advance to repoSelect
    await page.getByRole('button', { name: /Next/i }).click()

    // Step 3: repoSelect — the step title is rendered as a paragraph in the
    // wizard's stepInfo block, not as an ARIA heading, so match by text.
    await expect(page.getByText(/Select Repositories/i).first()).toBeVisible({ timeout: 15000 })

    // Select both repos. The RepoList renders checkboxes (or rows with toggle).
    // Try checkbox role first, fall back to clicking the row.
    const apiCheckbox = page.getByRole('checkbox', { name: /\bapi\b/i })
    const hugeCheckbox = page.getByRole('checkbox', { name: /\bhuge\b/i })
    await expect(apiCheckbox).toBeVisible({ timeout: 10000 })
    await apiCheckbox.click()
    await hugeCheckbox.click()

    // SelectionSummaryBar appears when repos are selected.
    // The 'api' repo name is reserved and the 'huge' repo > 10 GB — both blockers.
    // Button label: "Auto-fix (N)" when all blockers are auto-fixable, otherwise "Fix issues (N)"
    const fixButton = page.getByRole('button', { name: /Auto-fix|Fix issues/i })
    await expect(fixButton).toBeVisible({ timeout: 5000 })
    await fixButton.click()

    // AutoFixDrawer opens — Drawer primitive uses aria-label, not aria-labelledby.
    const drawer = page.locator('[role="dialog"][aria-label="Fix issues"]')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Accept the AI suggestion for the large repo ("huge"). The
    // /api/ai/migration-size-strategy endpoint short-circuits to a
    // deterministic { strategy: 'lfs-migrate', confidence: 0.85 } payload
    // when VITE_MOCK_MODE=true (see server/routes/ai/migration.js), and the
    // page.route stub above guards against any network slop, so the banner
    // is guaranteed to mount and we can assert + click deterministically.
    const acceptBtn = drawer.getByRole('button', { name: /Accept/i })
    await expect(acceptBtn).toBeVisible()
    await acceptBtn.click()

    // Click "Apply selected (N)"
    const applyButton = drawer.getByRole('button', { name: /Apply selected/i })
    await expect(applyButton).toBeEnabled({ timeout: 3000 })
    await applyButton.click()

    // After apply the drawer closes and the repoSelect step should reflect the fixes.
    // The 'api' repo gets renamed to 'api-repo' by the reserved-name autofix rule.
    // Assert the renamed label is visible in the repo list.
    await expect(page.getByText(/api-repo/i)).toBeVisible({ timeout: 5000 })
  })
})
