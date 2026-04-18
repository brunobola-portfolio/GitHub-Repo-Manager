import { motion } from 'framer-motion'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { Github } from '../icons/GithubIcon'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
})

export function HeroSection({ onSignIn }) {
  return (
    <section className="relative flex flex-col items-center text-center overflow-hidden pt-24 pb-20 sm:pt-32 sm:pb-28 px-4">

      {/* Background orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <motion.div
          className="absolute rounded-full blur-3xl bg-indigo-500 opacity-15 dark:opacity-25"
          style={{ width: 480, height: 480, left: '-5%', top: '-10%' }}
          animate={{ y: [0, -30, 0], x: [0, 20, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-purple-600 opacity-15 dark:opacity-25"
          style={{ width: 380, height: 380, right: '0%', top: '0%' }}
          animate={{ y: [0, 30, 0], x: [0, -20, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-cyan-500 opacity-10 dark:opacity-20"
          style={{ width: 280, height: 280, left: '40%', bottom: '0%' }}
          animate={{ y: [0, -20, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 opacity-[0.025] dark:opacity-[0.05]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(99,102,241,0.8) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Top spotlight */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[450px] bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent dark:from-indigo-500/15 dark:via-purple-500/8 blur-3xl" />
      </div>

      {/* Badge */}
      <motion.div
        {...fadeUp(0)}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full
          bg-indigo-500/10 dark:bg-indigo-500/15
          border border-indigo-500/20 dark:border-indigo-500/30
          mb-8"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 tracking-wide ds-font-display">
          Open-source · AI-powered · v2.5
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        {...fadeUp(0.1)}
        className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.08] mb-6 max-w-4xl ds-font-display"
      >
        <span className="text-slate-900 dark:text-white">Manage your GitHub repos with </span>
        <span className="ds-gradient-text">AI superpowers</span>
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        {...fadeUp(0.2)}
        className="text-lg sm:text-xl text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed mb-10 ds-font-display"
      >
        The open-source platform for intelligent repository management — migrate, organize, analyze,
        and collaborate with the help of AI.
      </motion.p>

      {/* CTA Buttons */}
      <motion.div
        {...fadeUp(0.3)}
        className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4"
      >
        <button
          onClick={onSignIn}
          className="group relative px-8 py-3.5 rounded-2xl font-bold text-base text-white
            bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_100%]
            hover:bg-right
            shadow-xl shadow-indigo-500/30 hover:shadow-2xl hover:shadow-indigo-500/50
            hover:scale-[1.04] active:scale-[0.97]
            transition-all duration-500
            focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2
            focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 focus:outline-none
            ds-btn-shimmer"
        >
          <span className="flex items-center gap-2.5">
            <Github className="w-5 h-5" />
            Sign in with GitHub
            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
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
            hover:border-indigo-300/70 dark:hover:border-indigo-500/40
            hover:bg-white/90 dark:hover:bg-white/[0.1]
            backdrop-blur-sm
            transition-all duration-300
            focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus:outline-none"
        >
          <Github className="w-5 h-5" />
          View on GitHub
          <ExternalLink className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
        </a>
      </motion.div>

      {/* Trust line */}
      <motion.p
        {...fadeUp(0.45)}
        className="mt-6 text-xs text-slate-400 dark:text-slate-500 ds-font-display"
      >
        Free & open-source · No credit card required · Self-host with Docker
      </motion.p>
    </section>
  )
}
