import { motion, useMotionValue, useTransform } from 'framer-motion'
import { useState, useEffect } from 'react'
import {
  Github, ArrowRight, GitBranch, Shield, Zap, Download,
  FolderGit2, Users, BarChart3, Cloud, Lock, Globe,
  Sparkles, ChevronRight
} from 'lucide-react'
import { AppLogoIcon } from './AppLogo'

/* ──────── Animated counter ──────── */
function AnimatedNumber({ target, duration = 2, suffix = '' }) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let start = 0
    const step = target / (duration * 60)
    const id = setInterval(() => {
      start += step
      if (start >= target) { setVal(target); clearInterval(id) }
      else setVal(Math.floor(start))
    }, 1000 / 60)
    return () => clearInterval(id)
  }, [target, duration])
  return <>{val.toLocaleString()}{suffix}</>
}

/* ──────── Orb config ──────── */
const orb = (delay, dur, x, y, size, color) => ({
  className: `absolute rounded-full blur-3xl pointer-events-none ${color}`,
  style: { width: size, height: size, left: x, top: y },
  animate: { y: [0, -40, 0], x: [0, 20, 0], scale: [1, 1.15, 1] },
  transition: { duration: dur, delay, repeat: Infinity, ease: 'easeInOut' },
})

/* ──────── Feature cards data ──────── */
const features = [
  {
    icon: FolderGit2, title: 'Smart Import',
    desc: 'Import from Git URLs, Azure DevOps (Git & TFVC), or GitHub with intelligent protocol detection.',
    gradient: 'from-blue-500 to-cyan-400',
    glow: 'group-hover:shadow-cyan-500/20',
  },
  {
    icon: Cloud, title: 'TFVC Migration',
    desc: 'Automatically convert Team Foundation Version Control to Git with up to 180 days of history preserved.',
    gradient: 'from-amber-500 to-orange-400',
    glow: 'group-hover:shadow-orange-500/20',
  },
  {
    icon: Users, title: 'Team Management',
    desc: 'Organize teams, manage access, assign repositories and track collaboration across your organization.',
    gradient: 'from-purple-500 to-pink-400',
    glow: 'group-hover:shadow-purple-500/20',
  },
  {
    icon: BarChart3, title: 'Analytics Dashboard',
    desc: 'Activity charts, language breakdowns, migration tracking, and AI-powered migration planning.',
    gradient: 'from-emerald-500 to-teal-400',
    glow: 'group-hover:shadow-emerald-500/20',
  },
  {
    icon: Lock, title: 'Bulk Operations',
    desc: 'Change visibility, archive, transfer, or delete multiple repos at once with conflict resolution.',
    gradient: 'from-indigo-500 to-violet-400',
    glow: 'group-hover:shadow-indigo-500/20',
  },
  {
    icon: Sparkles, title: 'AI Assistant',
    desc: 'Get intelligent insights, migration risk analysis, and automated recommendations powered by Gemini.',
    gradient: 'from-pink-500 to-rose-400',
    glow: 'group-hover:shadow-pink-500/20',
  },
]

/* ──────── Quick feature pills ──────── */
const pills = [
  { icon: GitBranch, label: 'Repositories', desc: 'Organize & migrate' },
  { icon: Shield, label: 'Teams', desc: 'Manage access' },
  { icon: Zap, label: 'Workflows', desc: 'Monitor & automate' },
  { icon: Download, label: 'Import', desc: 'Git, Azure, TFVC' },
  { icon: Globe, label: 'Multi-org', desc: 'All orgs in one place' },
]

/* ──────── Main component ──────── */
export function WelcomeHero({ onLogin }) {
  return (
    <div className="relative flex flex-col items-center min-h-screen text-center overflow-hidden select-none">

      {/* ── Background layer ── */}
      <div className="absolute inset-0">
        {/* Gradient orbs */}
        <motion.div {...orb(0, 8, '5%', '8%', '400px', 'bg-indigo-500 opacity-15 dark:opacity-25')} />
        <motion.div {...orb(2, 10, '60%', '5%', '350px', 'bg-purple-600 opacity-15 dark:opacity-25')} />
        <motion.div {...orb(4, 9, '30%', '50%', '300px', 'bg-cyan-500 opacity-10 dark:opacity-20')} />
        <motion.div {...orb(1, 11, '80%', '45%', '250px', 'bg-pink-500 opacity-10 dark:opacity-15')} />
        <motion.div {...orb(3, 12, '15%', '70%', '200px', 'bg-amber-500 opacity-10 dark:opacity-15')} />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Radial fade */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_30%,var(--tw-gradient-from))] from-slate-50 dark:from-slate-950" />

        {/* Top spotlight beam */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent dark:from-indigo-500/15 dark:via-purple-500/8 blur-2xl pointer-events-none" />
      </div>

      {/* ── Hero section ── */}
      <div className="relative z-10 flex flex-col items-center max-w-3xl pt-20 sm:pt-28 lg:pt-32 px-4">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 border border-indigo-500/20 dark:border-indigo-500/25 mb-8"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 tracking-wide">Now with TFVC Migration Support</span>
        </motion.div>

        {/* Icon */}
        <motion.div
          initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative mb-8 sm:mb-10"
        >
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-[1.75rem] bg-gradient-to-br from-indigo-500 via-purple-500 to-cyan-400 p-[2px] shadow-2xl shadow-indigo-500/30 dark:shadow-indigo-500/20">
            <div className="w-full h-full rounded-[1.65rem] bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl flex items-center justify-center">
              <AppLogoIcon className="w-11 h-11 sm:w-14 sm:h-14 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <motion.div
            className="absolute inset-0 rounded-[1.75rem] border-2 border-indigo-400/30 dark:border-indigo-400/20"
            animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          {/* Floating sparkle dots */}
          <motion.div
            className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/50"
            animate={{ y: [0, -8, 0], opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute -bottom-1 -left-3 w-3 h-3 rounded-full bg-purple-400 shadow-lg shadow-purple-400/50"
            animate={{ y: [0, 6, 0], opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2.5, delay: 0.5, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight mb-5 sm:mb-6 ds-font-display"
        >
          <span className="text-slate-800 dark:text-white">GitHub </span>
          <span className="ds-gradient-text-premium">Repo Manager</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="text-slate-500 dark:text-slate-400 text-lg sm:text-xl max-w-xl lg:max-w-2xl mb-10 sm:mb-12 leading-relaxed ds-font-display"
        >
          The all-in-one workspace to organize repositories, migrate from Azure DevOps,
          manage teams, and monitor workflows — with AI-powered insights.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col sm:flex-row gap-3 sm:gap-4"
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
              <Github className="w-5 h-5" />
              Sign in with GitHub
              <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </span>
          </button>
          <a
            href="https://github.com/features"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-3.5 rounded-2xl font-semibold text-base text-slate-600 dark:text-slate-300
              bg-white/60 dark:bg-white/[0.06] backdrop-blur-lg
              border border-slate-200/70 dark:border-white/[0.1]
              hover:border-indigo-300 dark:hover:border-indigo-500/40
              hover:bg-white/80 dark:hover:bg-white/[0.1]
              transition-all duration-300"
          >
            Learn More
          </a>
        </motion.div>

        {/* Stats ticker */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex items-center gap-6 sm:gap-10 mt-12 sm:mt-16"
        >
          {[
            { value: 112, suffix: '+', label: 'API Endpoints' },
            { value: 5, suffix: '', label: 'Source Types' },
            { value: 20, suffix: '+', label: 'Bulk Actions' },
          ].map((stat, i) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white ds-font-display">
                <AnimatedNumber target={stat.value} suffix={stat.suffix} duration={1.5 + i * 0.3} />
              </div>
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── Feature pills row ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="relative z-10 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 mt-12 sm:mt-16 px-4"
      >
        {pills.map(({ icon: Icon, label, desc }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.65 + i * 0.06 }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl
              bg-white/60 dark:bg-white/[0.06] backdrop-blur-lg
              border border-slate-200/60 dark:border-white/[0.08]
              hover:border-indigo-300/60 dark:hover:border-indigo-500/30
              hover:bg-white/80 dark:hover:bg-white/[0.1]
              transition-all duration-300 cursor-default"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 flex items-center justify-center">
              <Icon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
            </div>
            <div className="text-left">
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">{label}</span>
              <span className="block text-[10px] text-slate-400 dark:text-slate-500 leading-tight">{desc}</span>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* ── Feature showcase cards ── */}
      <div className="relative z-10 w-full max-w-6xl mt-16 sm:mt-24 px-4 pb-16 sm:pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-center mb-10 sm:mb-14"
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white ds-font-display mb-3">
            Everything you need to manage{' '}
            <span className="ds-gradient-text">your repos</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            From simple imports to complex multi-source migrations with AI-assisted planning.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {features.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.9 + i * 0.08 }}
              className={`group relative p-6 rounded-2xl
                bg-white/50 dark:bg-white/[0.04] backdrop-blur-xl
                border border-slate-200/50 dark:border-white/[0.06]
                hover:border-slate-300 dark:hover:border-white/[0.12]
                hover:shadow-2xl ${feat.glow}
                hover:bg-white/70 dark:hover:bg-white/[0.07]
                transition-all duration-500 cursor-default`}
            >
              {/* Gradient accent line */}
              <div className={`absolute top-0 left-6 right-6 h-[2px] rounded-full bg-gradient-to-r ${feat.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feat.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                <feat.icon className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-2">{feat.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{feat.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Bottom tech bar ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.3 }}
        className="relative z-10 w-full border-t border-slate-200/50 dark:border-white/[0.05] py-8 px-4"
      >
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 font-medium">
          <span>React 19</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span>Vite 7</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span>Tailwind CSS v4</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span>Azure DevOps API v7.1</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span>GitHub REST API</span>
          <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
          <span>Gemini AI</span>
        </div>
      </motion.div>
    </div>
  )
}
