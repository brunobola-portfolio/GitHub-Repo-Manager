import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.{js,ts}',

  // Maximum time one test can run. Bumped from 30s → 90s on CI because the
  // GitHub Actions runner is consistently slower than dev machines for
  // first-mount tests (Vite dev compile + mock data dynamic import + React
  // hydration adds 5-15s of cold-start overhead before hover/click are usable);
  // tests that lazy-load a whole panel (PR Review, AI Deep Review) routinely
  // need more than 60s end-to-end on CI even though every individual assertion
  // is well under its own timeout.
  timeout: process.env.CI ? 90 * 1000 : 30 * 1000,

  // Per-action assertion timeout. Most CI failures were "expect(...).toBeVisible
  // timeout" on the default 5s; 25s on CI absorbs cold-mount latency for
  // lazy-loaded panels without hiding genuine bugs.
  expect: { timeout: process.env.CI ? 25 * 1000 : 5 * 1000 },

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry once on CI to absorb environmental flakes; two retries was just
  // tripling every failure's runtime without improving signal.
  retries: process.env.CI ? 1 : 0,

  // Parallelize on CI. workers=1 was forcing serial execution (~28min suite).
  // Two workers completes the suite in ~half the time; requests are idempotent.
  // Locally, `undefined` meant one worker PER CORE — a dozen Chromium
  // instances saturating the machine and producing a different random
  // timeout flake on each full run (dashboard nav, settings panel, …).
  // Four workers keeps the suite fast (~2 min) without the starvation.
  workers: process.env.CI ? 2 : 4,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: 'http://localhost:5173',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Per-action timeout for click/hover/etc — same logic as `expect.timeout`.
    // Default Playwright is "no timeout" which is too permissive in dev;
    // 25s on CI absorbs the same lazy-chunk cold-load lag that affects
    // expect.timeout above.
    actionTimeout: process.env.CI ? 25 * 1000 : 10 * 1000,

    // Navigation timeout for page.goto() — Vite dev cold-start can take
    // up to 30s on CI runners as the entry chunks compile.
    navigationTimeout: process.env.CI ? 30 * 1000 : 15 * 1000,
  },

  // Configure projects for major browsers. Mobile project moved behind an
  // env flag — running every test twice (desktop + mobile) doubles CI time
  // for little marginal signal; mobile is spot-checked via responsive.spec.js
  // which exercises mobile viewports explicitly where it matters.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    ...(process.env.E2E_MOBILE
      ? [{ name: 'mobile', use: { ...devices['iPhone 13'] } }]
      : [])
  ],

  // Start both the Express backend (3001) and the Vite dev server (5173) and
  // wait for BOTH before running tests. Previously only 5173 was awaited,
  // creating a race where the frontend was ready but /api/* proxied to an
  // unavailable Express process, causing every test to fail at boot.
  webServer: [
    {
      command: 'npm run dev:server',
      // Same PORT the backend and the Vite proxy read, so a machine where
      // :3001 is unavailable (Windows reserves 2906-3005 for Hyper-V on
      // some installs) runs the suite with PORT=3006 and nothing else.
      url: `http://localhost:${Number(process.env.PORT) || 3001}/api/system/status`,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      stdout: 'ignore',
      stderr: 'pipe',
      // Force mock/test env regardless of user's local .env
      env: { NODE_ENV: 'test', VITE_MOCK_MODE: 'true' }
    },
    {
      // `--mode test` makes Vite load .env.test (which pins VITE_MOCK_MODE=true)
      // with higher precedence than the developer's local .env. Without this,
      // a `.env` setting of VITE_MOCK_MODE=false would cripple the entire
      // e2e suite (the mock user in useAuth would never set).
      command: 'npx vite --mode test',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      stdout: 'ignore',
      stderr: 'pipe'
    }
  ]
})
