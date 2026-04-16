import { test, expect } from '@playwright/test'

async function installMocks(page) {
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

  // Repos list (GET and POST variants)
  const repoPayload = JSON.stringify({
    repos: [
      { id: 'r1', name: 'api', size: 1024, branches: 1, isTfvc: false, lastCommitDate: '2025-01-01' },
      { id: 'r2', name: 'huge', size: 11 * 1024 * 1024, branches: 3, isTfvc: false, lastCommitDate: '2025-01-01' },
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
    await page.goto('/')

    // Wait for mock-mode app to mount (keyboard shortcut only active once authenticated)
    await expect(page.getByRole('button', { name: 'Repositories' })).toBeVisible({ timeout: 15000 })

    // Open Migration Wizard via keyboard shortcut
    await page.keyboard.press('i')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })

    // Step 1: SourceTypeStep — click Azure DevOps (auto-advances to azureConnect)
    await page.getByRole('button', { name: /Azure DevOps/i }).click()

    // Step 2: azureConnect (SourceStep)
    // With env-auth available, credentialMode defaults to 'serverPat'.
    // Type an org name — the debounced auto-validate fires against the mocked endpoints.
    const orgInput = page.getByRole('textbox', { name: /organization/i })
    await expect(orgInput).toBeVisible({ timeout: 10000 })
    await orgInput.fill('myorg')

    // Wait for validation + project list to load, then select APOS project
    const projectSelect = page.getByRole('combobox', { name: /project/i })
    await expect(projectSelect).toBeVisible({ timeout: 10000 })
    await projectSelect.selectOption('APOS')

    // Click Next to advance to repoSelect
    await page.getByRole('button', { name: /Next/i }).click()

    // Step 3: repoSelect — wait for the "Select Repositories" heading
    await expect(page.getByRole('heading', { name: /Select Repositories/i })).toBeVisible({ timeout: 15000 })

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

    // AutoFixDrawer opens (role=dialog, labelled "Fix issues")
    const drawer = page.locator('[role="dialog"][aria-labelledby="autofix-drawer-title"]')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Accept the AI suggestion for the large repo ("huge")
    // The AISuggestionBanner renders an "Accept" button
    await expect(drawer.getByRole('button', { name: /Accept/i })).toBeVisible({ timeout: 8000 })
    await drawer.getByRole('button', { name: /Accept/i }).click()

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
