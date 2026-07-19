import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { createRequire } from 'module'
import path from 'path'
import { isProxyDownError, BACKEND_DOWN_HINT, makeThrottle } from './scripts/dev/format.mjs'

// Single source of truth for the displayed app version: package.json. Injected
// as import.meta.env.VITE_APP_VERSION so UI (e.g. the Landing hero badge) never
// drifts from the real release the way a hardcoded literal did.
const pkg = createRequire(import.meta.url)('./package.json')

// Opt-in bundle analyzer — enabled via `npm run build:analyze`
// (sets ANALYZE=true). Pure observer: does not alter chunk contents.
const analyzePlugins = process.env.ANALYZE === 'true'
  ? [visualizer({
      filename: 'dist/bundle-analysis.html',
      open: true,
      gzipSize: true,
      brotliSize: true,
      template: 'treemap',
    })]
  : []

// Dev-only logging polish: when the API on :3001 isn't running, Vite's proxy
// floods the terminal with repeating "http proxy error … ECONNREFUSED" stacks.
// Wrap the logger so that collapses into ONE throttled, actionable hint. Other
// logs pass through untouched. (The orchestrator at scripts/dev.mjs supplies its
// own logger, so this only affects the standalone `npm run dev`.)
const devLogger = createLogger()
const baseLoggerError = devLogger.error.bind(devLogger)
const warnBackendDown = makeThrottle(15000)
devLogger.error = (msg, options) => {
  if (isProxyDownError(msg)) {
    if (warnBackendDown(Date.now())) {
      devLogger.warn(`  ⚠  ${BACKEND_DOWN_HINT}`, { timestamp: true })
    }
    return
  }
  baseLoggerError(msg, options)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...analyzePlugins],
  customLogger: devLogger,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      // Proxy API requests to the Express backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/components': path.resolve(__dirname, './src/components'),
      '@/contexts': path.resolve(__dirname, './src/contexts'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/api': path.resolve(__dirname, './src/api'),
      // Replaces @git-diff-view/lowlight's createLowlight(all) (190+ language
      // grammars, ~330 KB gzip) with createLowlight(common) + dart + vue.
      // The shim exports the identical highlighter API that @git-diff-view/core
      // imports, so no runtime behaviour changes — just fewer bundled grammars.
      '@git-diff-view/lowlight': path.resolve(__dirname, 'src/lib/diff-highlighter-shim.js'),
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          // recharts is deliberately NOT force-grouped into its own manual chunk.
          // ActivityChart/LanguageChart (its only 2 consumers) are React.lazy()
          // behind DashboardPremium, itself lazy from App.jsx — recharts is only
          // reachable via dynamic import(). Naming it as a manualChunks group here
          // made rolldown hoist the chunk into a STATIC import of the entry
          // (index-*.js), eagerly shipping ~100 KB gz of recharts to every user on
          // every load (confirmed via a temporary generateBundle() dump: the entry
          // chunk's own `imports` list included vendor-charts even though
          // getModuleInfo showed zero static importers into recharts — the manual
          // grouping itself caused the hoist). Left to the default per-consumer
          // chunking, recharts stays lazy, and rolldown can dedupe its d3-*
          // transitive deps against mermaid's (also d3-based) lazy diagram chunks —
          // see tests/build/bundle-budget.test.js for the eager-entry budget this fixes.
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion'
          // Split lucide-react into its own chunk so its gzipped footprint
          // is measurable and it doesn't pollute vendor-ui. Rollup already
          // tree-shakes the lucide barrel natively (sideEffects: false) so
          // only icons actually imported under src/ land here.
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return 'vendor-ui'
          if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return 'vendor-markdown'
          // @git-diff-view/* + lowlight (common subset via alias shim) + highlight.js
          // languages. The shiki/* packages listed here are kept for future-proofing
          // in case @git-diff-view adds a shiki code path; they produce no output
          // today because nothing imports them after the lowlight alias redirect.
          if (/[\\/]node_modules[\\/](@git-diff-view|lowlight|highlight\.js|shiki|@shikijs)[\\/]/.test(id)) return 'vendor-diff'
        }
      }
    }
  }
})
