import { motion } from 'framer-motion'
import { Github, ArrowRight, GitBranch, Shield, Zap } from 'lucide-react'

const floatingOrb = (delay, duration, x, y, size, color) => ({
  className: `absolute rounded-full blur-3xl opacity-20 dark:opacity-30 pointer-events-none ${color}`,
  style: { width: size, height: size, left: x, top: y },
  animate: {
    y: [0, -30, 0],
    x: [0, 15, 0],
    scale: [1, 1.1, 1],
  },
  transition: { duration, delay, repeat: Infinity, ease: 'easeInOut' },
})

const features = [
  { icon: GitBranch, label: 'Repositories', desc: 'Organize & migrate' },
  { icon: Shield, label: 'Teams', desc: 'Manage access' },
  { icon: Zap, label: 'Workflows', desc: 'Monitor & automate' },
]

export function WelcomeHero({ onLogin }) {
  return (
    <div className="relative flex flex-col items-center justify-center min-h-[70vh] lg:min-h-[75vh] text-center px-4 overflow-hidden select-none">
      {/* Atmospheric background orbs */}
      <motion.div {...floatingOrb(0, 8, '10%', '15%', '340px', 'bg-indigo-500')} />
      <motion.div {...floatingOrb(2, 10, '65%', '10%', '280px', 'bg-purple-600')} />
      <motion.div {...floatingOrb(4, 9, '40%', '60%', '220px', 'bg-cyan-500')} />
      <motion.div {...floatingOrb(1, 11, '75%', '55%', '180px', 'bg-pink-500')} />

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      {/* Radial fade at edges */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--tw-gradient-from))] from-slate-50 dark:from-slate-950" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center max-w-2xl">
        {/* Icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative mb-8 sm:mb-10"
        >
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-[1.75rem] bg-gradient-to-br from-indigo-500 via-purple-500 to-cyan-400 p-[2px] shadow-2xl shadow-indigo-500/30 dark:shadow-indigo-500/20">
            <div className="w-full h-full rounded-[1.65rem] bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl flex items-center justify-center">
              <Github className="w-11 h-11 sm:w-14 sm:h-14 text-indigo-600 dark:text-indigo-400" strokeWidth={1.5} />
            </div>
          </div>
          {/* Pulsing ring */}
          <motion.div
            className="absolute inset-0 rounded-[1.75rem] border-2 border-indigo-400/30 dark:border-indigo-400/20"
            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 sm:mb-6 ds-font-display"
        >
          <span className="text-slate-800 dark:text-white">GitHub </span>
          <span className="ds-gradient-text-premium">Repo Manager</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="text-slate-500 dark:text-slate-400 text-lg sm:text-xl max-w-md lg:max-w-lg mb-10 sm:mb-12 leading-relaxed ds-font-display"
        >
          A premium local-first workspace to organize repositories, manage teams, and monitor workflows.
        </motion.p>

        {/* CTA Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <button
            onClick={onLogin}
            className="group relative px-8 sm:px-10 py-3.5 sm:py-4 rounded-2xl font-bold text-base sm:text-lg text-white
              bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-[length:200%_100%]
              hover:bg-right
              shadow-xl shadow-indigo-500/25 hover:shadow-2xl hover:shadow-indigo-500/40
              hover:scale-[1.04] active:scale-[0.97]
              transition-all duration-500
              focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-950 focus:outline-none
              ds-btn-shimmer"
          >
            <span className="flex items-center gap-2.5">
              Sign in with GitHub
              <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </button>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 mt-10 sm:mt-14"
        >
          {features.map(({ icon: Icon, label, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.55 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl
                bg-white/60 dark:bg-white/[0.06] backdrop-blur-lg
                border border-slate-200/70 dark:border-white/[0.08]
                shadow-sm dark:shadow-none
                hover:border-indigo-300/60 dark:hover:border-indigo-500/30
                hover:bg-white/80 dark:hover:bg-white/[0.1]
                transition-all duration-300"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 flex items-center justify-center">
                <Icon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
              </div>
              <div className="text-left">
                <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200 leading-tight">{label}</span>
                <span className="block text-xs text-slate-400 dark:text-slate-500 leading-tight">{desc}</span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  )
}
