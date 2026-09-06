import { motion } from 'framer-motion'
import { EASE, LOOP, reveal } from '../ui/motion'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { Github } from '../icons/GithubIcon'

// The same arrival the promo film uses, so the landing reads as a still of it.
const fadeUp = reveal

// The dashboard in both themes, captured from the real app in mock mode at
// 1440×900. The class-based theme (not prefers-color-scheme) picks which one
// shows, so both ship and only one paints.
const SHOT = { width: 1440, height: 900 }

export function HeroSection({ onSignIn }) {
  return (
    <section className="relative flex flex-col items-center text-center overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-20 px-4">

      {/* Background: one soft brand wash and a dot grid — quiet, so the
          product shot below is the loudest thing on the page. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <motion.div
          className="absolute rounded-full blur-3xl bg-brand-500 opacity-15 dark:opacity-25"
          style={{ width: 480, height: 480, left: '-5%', top: '-10%' }}
          animate={{ y: [0, -30, 0], x: [0, 20, 0] }}
          transition={{ duration: LOOP.drift, repeat: Infinity, ease: EASE.standard }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-brand-600 opacity-15 dark:opacity-25"
          style={{ width: 380, height: 380, right: '0%', top: '0%' }}
          animate={{ y: [0, 30, 0], x: [0, -20, 0] }}
          transition={{ duration: LOOP.driftLong, repeat: Infinity, ease: EASE.standard }}
        />
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(85,131,27,0.8) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[450px] bg-brand-500/8 dark:bg-brand-500/12 blur-3xl" />
      </div>

      {/* Badge */}
      <motion.div
        {...fadeUp(0)}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full
          bg-brand-500/10 dark:bg-brand-500/15
          border border-brand-500/20 dark:border-brand-500/30
          mb-8"
      >
        <span className="inline-flex rounded-full h-2 w-2 bg-brand-500" aria-hidden="true" />
        <span className="text-xs font-semibold text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] tracking-wide ds-font-display">
          Open source · Bring your own AI key · v{import.meta.env.VITE_APP_VERSION}
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        {...fadeUp(0.1)}
        className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.08] mb-6 max-w-4xl ds-font-display text-slate-900 dark:text-slate-100"
      >
        Manage, migrate and review every GitHub repository from one place
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        {...fadeUp(0.2)}
        className="text-lg sm:text-xl text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed mb-10 ds-font-display"
      >
        A cross-repo Work Board with DORA metrics, AI Deep Review you publish yourself, and
        Azure DevOps and TFVC migration with a dry run first. Your server, your AI key,
        Apache-2.0.
      </motion.p>

      {/* CTA Buttons */}
      <motion.div
        {...fadeUp(0.3)}
        className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4"
      >
        <button
          onClick={onSignIn}
          className="group relative px-8 py-3.5 rounded-2xl font-bold text-base text-white
            bg-[color:var(--ds-cta)] hover:bg-[color:var(--ds-cta-hover)]
            ds-elevation-md
            transition-colors duration-200
            ds-focus-ring"
        >
          <span className="flex items-center gap-2.5">
            <Github className="w-5 h-5" />
            Continue with GitHub
            <ArrowRight className="w-4 h-4 transition-transform duration-[var(--ds-duration)] group-hover:translate-x-1" />
          </span>
        </button>

        <a
          href="https://github.com/brunobola-portfolio/GitHub-Repo-Manager"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2.5 px-8 py-3.5 rounded-2xl font-semibold text-base
            text-slate-700 dark:text-slate-300
            bg-white/70 dark:bg-white/[0.06]
            border border-slate-200/80 dark:border-white/10
            hover:border-brand-300/70 dark:hover:border-brand-500/40
            hover:bg-white/90 dark:hover:bg-white/[0.1]
            backdrop-blur-sm
            transition-all duration-[var(--ds-duration)]
            ds-focus-ring"
        >
          <Github className="w-5 h-5" />
          View on GitHub
          <ExternalLink className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
        </a>
      </motion.div>

      {/* Trust line */}
      <motion.p
        {...fadeUp(0.45)}
        className="mt-6 text-xs text-slate-500 dark:text-slate-400 ds-font-display"
      >
        Apache-2.0 · Bring your own AI key, on every plan · Self-host on Docker, IIS or Windows · No credit card
      </motion.p>

      {/* The product itself. Eager and high priority: it is the largest thing
          above the fold and the reason to keep reading. */}
      <motion.figure
        {...fadeUp(0.55)}
        className="relative z-10 mt-14 w-full max-w-5xl rounded-2xl overflow-hidden
          border border-slate-200/80 dark:border-white/10
          bg-white dark:bg-slate-900
          ds-elevation-lg"
      >
        <div
          aria-hidden="true"
          className="flex items-center gap-1.5 border-b border-slate-200/70 dark:border-white/10 bg-slate-50 dark:bg-slate-900/80 px-4 py-2.5"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>
        <img
          src="/landing/dashboard-light.jpg"
          width={SHOT.width}
          height={SHOT.height}
          alt="The dashboard in the light theme: a greeting, the three numbers that need you today, and the live inbox of pull requests waiting for review."
          className="block w-full h-auto dark:hidden"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <img
          src="/landing/dashboard-dark.jpg"
          width={SHOT.width}
          height={SHOT.height}
          alt="The dashboard in the dark theme: a greeting, the three numbers that need you today, and the live inbox of pull requests waiting for review."
          className="hidden w-full h-auto dark:block"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </motion.figure>
    </section>
  )
}
