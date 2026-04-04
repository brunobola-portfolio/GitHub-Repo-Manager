import { motion } from 'framer-motion'
import { Github } from 'lucide-react'
import { HeroSection } from './HeroSection'
import { FeaturesSection } from './FeaturesSection'
import { PricingPreview } from './PricingPreview'
import { CTASection } from './CTASection'

function LandingFooter() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="border-t border-slate-200/50 dark:border-white/[0.06] py-8 px-4"
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-slate-400 dark:text-slate-500 ds-font-display">
          Built by{' '}
          <a
            href="https://www.linkedin.com/in/bolalabs/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-600 dark:text-slate-300 font-medium hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors duration-200"
          >
            Bruno Marques
          </a>
          {' '}· React 19 + Vite 7 + Tailwind CSS v4
        </p>

        <div className="flex items-center gap-5">
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200"
          >
            <Github className="w-4 h-4" />
            GitHub
          </a>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 ds-font-display"
          >
            Docs
          </a>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 ds-font-display"
          >
            Changelog
          </a>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 ds-font-display"
          >
            AGPL v3
          </a>
        </div>
      </div>
    </motion.footer>
  )
}

export function LandingPage({ onSignIn }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white overflow-x-hidden">

      {/* Minimal top nav */}
      <motion.nav
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-20 backdrop-blur-xl bg-white/75 dark:bg-slate-950/75 border-b border-slate-200/50 dark:border-white/[0.06]"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
              <Github className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 dark:text-white text-sm ds-font-display">
              Repo Manager
            </span>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors duration-200 ds-font-display"
            >
              <Github className="w-4 h-4" />
              Star on GitHub
            </a>
            <button
              onClick={onSignIn}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white
                bg-gradient-to-r from-indigo-600 to-purple-600
                hover:from-indigo-500 hover:to-purple-500
                shadow-md shadow-indigo-500/25
                hover:scale-[1.03] active:scale-[0.97]
                transition-all duration-200
                focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
                focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 focus:outline-none
                ds-btn-shimmer ds-font-display"
            >
              Sign in
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Page sections */}
      <main>
        <HeroSection onSignIn={onSignIn} />

        {/* Divider */}
        <div className="max-w-6xl mx-auto px-4">
          <div className="h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-white/[0.06] to-transparent" />
        </div>

        <FeaturesSection />

        <div className="max-w-6xl mx-auto px-4">
          <div className="h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-white/[0.06] to-transparent" />
        </div>

        <PricingPreview onSignIn={onSignIn} />

        <div className="max-w-6xl mx-auto px-4">
          <div className="h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-white/[0.06] to-transparent" />
        </div>

        <CTASection onSignIn={onSignIn} />
      </main>

      <LandingFooter />
    </div>
  )
}
