import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createRequire } from 'module'
import path from 'path'

// Mirror vite.config.js so import.meta.env.VITE_APP_VERSION resolves under the
// test runner (separate config) and components reading it don't render "vundefined".
const pkg = createRequire(import.meta.url)('./package.json')

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    // Vitest's 5s default made the suite non-deterministic, not slow: three
    // consecutive full runs failed on three DIFFERENT tests, every one of them
    // green in isolation. The offenders are the legitimately heavy ones — the
    // anti-drift lint test instantiates a real ESLint and loads the whole flat
    // config, the App tests mount the entire shell, the spend-cap tests boot
    // supertest — and under a saturated fork pool they cross 5s. CI runs on
    // 2-core runners, which is strictly worse than a dev machine.
    testTimeout: 15000,
    hookTimeout: 15000,
    // Pre-bundle dependencies with esbuild so each of the 500+ test files pays
    // a much smaller per-file import cost (the dominant slice of total run time).
    // Safe: this only affects how deps are loaded, not worker isolation — the
    // `forks` pool stays (threads segfault here because happy-dom + native
    // better-sqlite3 can't tear down cleanly in worker threads).
    deps: { optimizer: { web: { enabled: true }, ssr: { enabled: true } } },
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}', 'server/__tests__/**/*.test.js', 'scripts/__tests__/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'e2e'],
    environmentMatchGlobs: [
      ['server/**/*.test.js', 'node'],
      ['scripts/**/*.test.js', 'node'],
      ['tests/styles/**/*.test.js', 'node'],
    ],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Vitest defaults this to false, which means a run with even one failing
      // test emits NO coverage report at all — precisely the run where you
      // need the report to see whether the failure left a region uncovered.
      // CI uploads coverage/ as an artifact, so an empty dir on a red run is
      // a debugging dead end.
      reportOnFailure: true,
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.{js,jsx}',
        '**/*.spec.{js,jsx}',
        'vite.config.js',
        'vitest.config.js',
        'tailwind.config.js',
        'postcss.config.js',
        'server/data/',
        'dist/',
        'build/'
      ],
      include: ['src/**/*.{js,jsx}', 'server/**/*.js'],
      all: true,
      // Coverage thresholds: in Vitest 4+ these MUST live under `thresholds:`.
      // The previous root-level numbers (lines/functions/branches/statements: 80)
      // were silently ignored because of the schema mismatch (see
      // docs/reports/2026-04-26-coverage-audit.md).
      //
      // Floors sit ~2pp below current actual so PRs that erode coverage by more
      // than 2pp fail. Aspirational target stays at 80%; raise the floors as
      // follow-up tests land.
      //
      // Re-baselined 2026-07-27 against `vitest run --coverage` on the full
      // suite. The previous floors (48/42/38/46, measured 2026-04-26) had gone
      // ~18pp stale — they could not have failed on any realistic regression,
      // and they never executed anyway because CI ran plain `npx vitest run`
      // with no --coverage. Both halves are fixed together: stale numbers with
      // no runner is a gate that exists only on paper.
      thresholds: {
        lines: 64,       // actual 66.39%
        functions: 57,   // actual 59.87%
        branches: 54,    // actual 56.94%
        statements: 62,  // actual 64.25%
      },
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/contexts': path.resolve(__dirname, './src/contexts'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/api': path.resolve(__dirname, './src/api')
    }
  }
})
