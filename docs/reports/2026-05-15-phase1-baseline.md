# Phase 1 Baseline — Test Suite State After CSS Rewrite

**Date:** 2026-05-15  
**Branch:** `feat/premium-non-llm-theme`  
**Phase 1 commits in scope:**
- `99b436c` — audit
- `ce7d054` + `0be7e7d` — tests
- `7edf83a` + `7eb8570` — design-system.css rewrite
- `0086ae6` — index.css rewrite

## Result: ALL GREEN

| Metric | Count |
|--------|-------|
| Test files | 440 |
| Test files passed | 438 |
| Test files skipped | 2 |
| Test files failed | **0** |
| Tests total | 3917 |
| Tests passed | 3893 |
| Tests skipped | 24 |
| Tests failed | **0** |

Run duration: ~41 seconds.

## Noise in stdout (not failures)

The following appeared in stdout but did **not** cause any test failure:

1. **`ECONNREFUSED 127.0.0.1:3000`** — integration tests that probe a local server; they catch the error gracefully and still pass.
2. **`[validate] tier must be "pro" or "enterprise"`** — license validation test fixtures exercising error branches; expected.
3. **`[deliver] Resend returned 500: resend down`** — email-delivery test fixtures using a stub that returns 500; expected.

## Triage

There are **zero failures**, so there is nothing to triage.

The Phase 1 changes (removing `ds-card-shimmer`, `ds-gradient-text`, `ds-btn-shimmer`, `ds-hover-lift`, `ds-glass`, `ds-animate-scale-in` from `design-system.css`; removing the old dark-mode body bg from `index.css`) produced **no regressions** in the unit test suite. As expected, the killed CSS class names remain in component `className` strings, but JSX/snapshot tests do not assert on computed styles, so they continue to pass unchanged.

## Decision

**DONE** — Phase 1 baseline is clean. Safe to proceed to Task 6.
