import { motion } from 'framer-motion'
import { ArrowRight, Terminal } from 'lucide-react'
import { Github } from '../icons/GithubIcon'

const DOCKER_CMD = 'docker compose up -d'

export function CTASection({ onSignIn }) {
  return (
    <section className="relative py-20 sm:py-28 px-4 overflow-hidden">

      {/* Background glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(99,102,241,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Animated orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <motion.div
          className="absolute rounded-full blur-3xl bg-[color:var(--ds-accent-brand)] opacity-10 dark:opacity-20"
          style={{ width: 340, height: 340, left: '-8%', top: '10%' }}
          animate={{ y: [0, -24, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full blur-3xl bg-purple-600 opacity-10 dark:opacity-20"
          style={{ width: 300, height: 300, right: '-6%', bottom: '10%' }}
          animate={{ y: [0, 20, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="relative max-w-3xl mx-auto text-center">

        {/* Headline */}
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-100 ds-font-display mb-5"
        >
          Ready to level up your{' '}
          <span className="text-slate-900 dark:text-slate-100 font-semibold">repo management?</span>
        </motion.h2>

        {/* Sub */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="text-lg text-slate-500 dark:text-slate-400 ds-font-display mb-10"
        >
          Join developers who use AI to manage, migrate, and master their GitHub repos.
        </motion.p>

        {/* Primary CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <button
            onClick={onSignIn}
            className="group relative px-9 py-4 rounded-2xl font-bold text-base text-white
              bg-[color:var(--ds-cta)] hover:bg-[color:var(--ds-cta-hover)]
              shadow-md
              transition-colors duration-200
              ds-focus-ring"
          >
            <span className="flex items-center gap-2.5">
              <Github className="w-5 h-5" />
              Start Free — No credit card required
              <ArrowRight className="w-4 h-4 transition-transform duration-[var(--ds-duration)] group-hover:translate-x-1" />
            </span>
          </button>
        </motion.div>

        {/* Docker self-host block */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10"
        >
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 ds-font-display">
            Or self-host with Docker:
          </p>
          <div
            className="inline-flex items-center gap-3 px-5 py-3 rounded-xl
              bg-slate-900 dark:bg-slate-800/80
              border border-slate-700/60 dark:border-slate-700/50
              shadow-lg shadow-black/10 dark:shadow-black/30"
          >
            <Terminal className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <code className="text-sm text-emerald-300 ds-font-mono tracking-tight select-all">
              {DOCKER_CMD}
            </code>
          </div>
        </motion.div>

      </div>
    </section>
  )
}
