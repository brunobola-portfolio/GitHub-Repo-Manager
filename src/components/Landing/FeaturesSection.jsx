import { motion } from 'framer-motion'
import { Brain, Search, GitBranch, Users, FileText, LayoutDashboard } from 'lucide-react'

const features = [
  {
    icon: Brain,
    title: 'AI-Powered Insights',
    description:
      'Quality reports, code health scoring, migration risk analysis, and actionable suggestions — all powered by Gemini AI.',
    iconColor: 'text-indigo-500 dark:text-indigo-400',
    glow: 'group-hover:shadow-indigo-500/20',
    iconBg: 'from-indigo-500/15 to-purple-500/15 dark:from-indigo-500/25 dark:to-purple-500/25',
    accent: 'from-indigo-500 to-purple-500',
  },
  {
    icon: Search,
    title: 'Semantic Search',
    description:
      'Find repositories by meaning, not just keywords. Describe what you need and let AI surface the right repos instantly.',
    iconColor: 'text-cyan-500 dark:text-cyan-400',
    glow: 'group-hover:shadow-cyan-500/20',
    iconBg: 'from-cyan-500/15 to-blue-500/15 dark:from-cyan-500/25 dark:to-blue-500/25',
    accent: 'from-cyan-500 to-blue-500',
  },
  {
    icon: GitBranch,
    title: 'Smart Migration',
    description:
      'Move from Azure DevOps (Git & TFVC) to GitHub with AI-assisted risk analysis, history preservation, and LFS support.',
    iconColor: 'text-amber-500 dark:text-amber-400',
    glow: 'group-hover:shadow-amber-500/20',
    iconBg: 'from-amber-500/15 to-orange-500/15 dark:from-amber-500/25 dark:to-orange-500/25',
    accent: 'from-amber-500 to-orange-500',
  },
  {
    icon: Users,
    title: 'Team Collaboration',
    description:
      'Shared dashboards, activity feeds, per-team repo assignment, and fine-grained access management across organizations.',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    glow: 'group-hover:shadow-emerald-500/20',
    iconBg: 'from-emerald-500/15 to-teal-500/15 dark:from-emerald-500/25 dark:to-teal-500/25',
    accent: 'from-emerald-500 to-teal-500',
  },
  {
    icon: FileText,
    title: 'README Generation',
    description:
      'AI-crafted documentation in seconds. Auto-detect project structure, tech stack, and generate polished READMEs.',
    iconColor: 'text-pink-500 dark:text-pink-400',
    glow: 'group-hover:shadow-pink-500/20',
    iconBg: 'from-pink-500/15 to-rose-500/15 dark:from-pink-500/25 dark:to-rose-500/25',
    accent: 'from-pink-500 to-rose-500',
  },
  {
    icon: LayoutDashboard,
    title: 'Premium Dashboard',
    description:
      'Beautiful analytics, language breakdowns, commit activity, dark mode, and 20+ bulk operations at your fingertips.',
    iconColor: 'text-violet-500 dark:text-violet-400',
    glow: 'group-hover:shadow-violet-500/20',
    iconBg: 'from-violet-500/15 to-purple-500/15 dark:from-violet-500/25 dark:to-purple-500/25',
    accent: 'from-violet-500 to-purple-500',
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
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
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
            'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(99,102,241,0.05) 0%, transparent 70%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto">
        {/* Section heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-14 sm:mb-16"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 dark:text-indigo-400 mb-3 ds-font-display">
            Features
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight ds-font-display mb-4">
            Everything you need,{' '}
            <span className="ds-gradient-text">nothing you don&apos;t</span>
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
                hover:shadow-2xl ${feat.glow}
                backdrop-blur-sm
                transition-all duration-500
                ds-hover-lift ds-card-shimmer`}
            >
              {/* Gradient accent top line */}
              <div
                className={`absolute top-0 left-6 right-6 h-[2px] rounded-full bg-gradient-to-r ${feat.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
              />

              {/* Icon */}
              <div
                className={`w-11 h-11 rounded-xl bg-gradient-to-br ${feat.iconBg} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}
              >
                <feat.icon
                  className={`w-5 h-5 ${feat.iconColor}`}
                  strokeWidth={2}
                />
              </div>

              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2 ds-font-display">
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
