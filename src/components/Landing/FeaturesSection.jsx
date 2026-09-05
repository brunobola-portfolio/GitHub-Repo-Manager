import { motion } from 'framer-motion'
import { EASE, DURATION } from '../ui/motion'
import { Brain, Search, GitBranch, Users, FileText, LayoutDashboard } from 'lucide-react'
import { BACKDROP_WASH_COLOR } from '../ui/_variants'

const features = [
  {
    icon: Brain,
    title: 'AI-Powered Insights',
    description:
      'Quality reports, code health scoring, migration risk analysis, and actionable suggestions — all powered by your configured AI provider.',
    iconColor: 'text-brand-500 dark:text-[color:var(--ds-accent-brand-dark)]',
    glow: '',
    iconBg: 'bg-brand-500/15 dark:bg-brand-500/25',
    accent: 'bg-brand-500',
  },
  {
    icon: Search,
    title: 'Semantic Search',
    description:
      'Find repositories by meaning, not just keywords. Describe what you need and let your AI provider surface the right ones.',
    iconColor: 'text-brand-500 dark:text-brand-400',
    glow: '',
    iconBg: 'bg-brand-500/15 dark:bg-brand-500/25',
    accent: 'bg-brand-500',
  },
  {
    icon: GitBranch,
    title: 'Smart Migration',
    description:
      'Move from Azure DevOps (Git & TFVC) to GitHub with AI-assisted risk analysis, history preservation, and LFS support.',
    iconColor: 'text-amber-500 dark:text-amber-400',
    glow: '',
    iconBg: 'bg-amber-500/15 dark:bg-amber-500/25',
    accent: 'bg-amber-500',
  },
  {
    icon: Users,
    title: 'Team Collaboration',
    description:
      'Shared dashboards, activity feeds and per-team repository assignment. Teams live in your instance and never change GitHub permissions.',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    glow: '',
    iconBg: 'bg-emerald-500/15 dark:bg-emerald-500/25',
    accent: 'bg-emerald-500',
  },
  {
    icon: FileText,
    title: 'README Generation',
    description:
      'Generates a README from your detected stack and structure, with TODO placeholders instead of invented commands or versions.',
    iconColor: 'text-brand-500 dark:text-brand-400',
    glow: '',
    iconBg: 'bg-brand-500/15 dark:bg-brand-500/25',
    accent: 'bg-brand-500',
  },
  {
    icon: LayoutDashboard,
    title: 'Premium Dashboard',
    description:
      // Counted, not estimated: seven multi-select actions in the repository
      // batch menu plus three on the Work Board bulk bar. A gate keeps this
      // figure from drifting above what ships — see
      // tests/components/Landing/FeaturesSectionClaims.test.jsx.
      'Language breakdowns, commit activity, dark mode, and 10 bulk operations, all in one dashboard.',
    iconColor: 'text-brand-500 dark:text-brand-400',
    glow: '',
    iconBg: 'bg-brand-500/15 dark:bg-brand-500/25',
    accent: 'bg-brand-500',
  },
]

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.ambient, ease: EASE.emphasized },
  },
}

export function FeaturesSection() {
  return (
    <section className="relative py-20 sm:py-28 px-4 overflow-hidden">

      {/* Subtle background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            `radial-gradient(ellipse 80% 50% at 50% 0%, ${BACKDROP_WASH_COLOR} 0%, transparent 70%)`,
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Section heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: DURATION.ambient, ease: EASE.emphasized }}
          className="text-center mb-14 sm:mb-16"
        >
          <p className="ds-eyebrow text-brand-500 dark:text-[color:var(--ds-accent-brand-dark)] mb-3 ds-font-display">
            Features
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 dark:text-slate-100 tracking-tight ds-font-display mb-4">
            Everything you need,{' '}
            <span className="text-slate-900 dark:text-slate-100 font-semibold">nothing you don&apos;t</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-xl mx-auto text-lg leading-relaxed ds-font-display">
            A complete toolkit for developers and engineering teams who take GitHub seriously.
          </p>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"
        >
          {features.map((feat) => (
            <motion.div
              key={feat.title}
              variants={cardVariants}
              className={`group relative p-6 rounded-2xl cursor-default
                bg-white/60 dark:bg-white/[0.04]
                border border-slate-200/60 dark:border-white/[0.07]
                hover:border-slate-300/80 dark:hover:border-white/[0.14]
                hover:bg-white/80 dark:hover:bg-white/[0.07]
                hover:shadow-lg
                backdrop-blur-sm
                transition-all duration-[var(--ds-duration-slow)]`}
            >
              {/* Gradient accent top line */}
              <div
                className={`absolute top-0 left-6 right-6 h-[2px] rounded-full ${feat.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
              />

              {/* Icon */}
              <div
                className={`w-11 h-11 rounded-xl ${feat.iconBg} flex items-center justify-center mb-5 transition-transform duration-[var(--ds-duration-slow)]`}
              >
                <feat.icon
                  className={`w-5 h-5 ${feat.iconColor}`}
                  strokeWidth={2}
                />
              </div>

              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-2 ds-font-display">
                {feat.title}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {feat.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
