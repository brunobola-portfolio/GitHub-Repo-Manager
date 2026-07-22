/*
 * GitHub Repo Manager
 * Mock system/update-check data — DEV ONLY (see mockRepos.js header).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 */

// Deliberately claims an update is available so the demo/e2e/axe suite
// actually renders AboutSection's "vX available" banner (real mock mode has
// no authenticated session, so the real /api/system/update-check 401s and
// the banner never mounts — see docs/reports for the axe-coverage gap this
// closes).
//
// canSelfUpdate is hardcoded false — self-update triggers a real download +
// installer/script handoff + process restart, which is never something a
// demo/mock session should be able to claim it can do (grounded honesty:
// the "Update now" button must never render outside a real managed install).
export function getMockUpdateCheck() {
  return {
    current: import.meta.env.VITE_APP_VERSION || '0.0.0',
    latest: '99.0.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v99.0.0',
    disabled: false,
    canSelfUpdate: false,
  }
}
