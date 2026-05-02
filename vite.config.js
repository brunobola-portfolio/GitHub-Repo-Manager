import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...analyzePlugins],
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
      '@/api': path.resolve(__dirname, './src/api')
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return 'vendor-charts'
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion'
          // Split lucide-react into its own chunk so its gzipped footprint
          // is measurable and it doesn't pollute vendor-ui. Rollup already
          // tree-shakes the lucide barrel natively (sideEffects: false) so
          // only icons actually imported under src/ land here.
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
          if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return 'vendor-ui'
          if (/[\\/]node_modules[\\/]react-markdown[\\/]/.test(id)) return 'vendor-markdown'
          // @git-diff-view/* + transitive highlight.js / lowlight / shiki
          // (~1 MB before splitting, ~330 KB gzipped). Both consumers
          // (PRReview DiffPanel + ReadmeEnhanceDiffPanel) already lazy() the
          // import, but without this manualChunks rule rolldown was packing
          // the deps into the default ESM bundle that loaded eagerly.
          // Pinning to vendor-diff keeps it on-demand.
          if (/[\\/]node_modules[\\/](@git-diff-view|lowlight|highlight\.js|shiki|@shikijs)[\\/]/.test(id)) return 'vendor-diff'
        }
      }
    }
  }
})
