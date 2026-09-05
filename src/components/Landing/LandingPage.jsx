import { motion } from 'framer-motion'
import { Sun, Moon } from 'lucide-react'
import { EASE, DURATION } from '../ui/motion'
import { Github } from '../icons/GithubIcon'
import { AppLogo } from '../AppLogo'
import { HeroSection } from './HeroSection'
import { FeaturesSection } from './FeaturesSection'
import { PricingPreview } from './PricingPreview'
import { CTASection } from './CTASection'
import { useTheme } from '../../hooks/useTheme'

function ThemeToggleButton() {
  const { isDark, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ds-focus-ring"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}

function LandingFooter() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: DURATION.ambient }}
      className="border-t border-slate-200/50 dark:border-white/[0.06] py-8 px-4"
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-slate-500 dark:text-slate-400 ds-font-display">
          Built by{' '}
          <a
            href="https://www.linkedin.com/in/bolalabs/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-600 dark:text-slate-300 font-medium hover:text-brand-600 dark:hover:text-brand-400 transition-colors duration-200"
          >
            Bruno Marques
          </a>
          {' '}· React 19 + Vite 8 + Tailwind CSS v4
        </p>

        <div className="flex items-center gap-5">
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200"
          >
            <Github className="w-4 h-4" />
            GitHub
          </a>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/README.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 ds-font-display"
          >
            Docs
          </a>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 ds-font-display"
          >
            Changelog
          </a>
          <span className="text-slate-200 dark:text-slate-700">·</span>
          <a
            href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors duration-200 ds-font-display"
          >
            Apache-2.0
          </a>
        </div>
      </div>
    </motion.footer>
  )
}

export function LandingPage({ onSignIn }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-x-hidden">

      {/* Minimal top nav */}
      <motion.nav
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION.gentle, ease: EASE.emphasized }}
        className="sticky top-0 z-20 backdrop-blur-md bg-white/75 dark:bg-slate-950/75 border-b border-slate-200/50 dark:border-white/[0.06]"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* The product mark, not GitHub's. RepoManager manages GitHub
                and is not affiliated with it — borrowing the Octocat as our own
                app icon is the one thing docs/BRAND.md forbids outright. */}
            <AppLogo size={28} className="shadow-md" title="" />
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
            <ThemeToggleButton />
            <button
              onClick={onSignIn}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white
                bg-[color:var(--ds-accent-brand)] dark:bg-[color:var(--ds-accent-brand-fill-dark)] hover:bg-[color:var(--ds-accent-brand-hover)] dark:hover:bg-[color:var(--ds-accent-brand)]
                shadow-md
                transition-colors duration-200
                ds-focus-ring
                ds-font-display"
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
