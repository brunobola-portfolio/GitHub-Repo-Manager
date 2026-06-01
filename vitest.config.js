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
      // Floors set 2pp below current actual (measured 2026-04-26) so PRs that
      // erode coverage by more than 2pp fail. Aspirational target stays at 80%;
      // raise the floors as follow-up tests land.
      thresholds: {
        lines: 48,       // actual 49.68%
        functions: 42,   // actual 43.78%
        branches: 38,    // actual 39.86%
        statements: 46,  // actual 48.22%
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
