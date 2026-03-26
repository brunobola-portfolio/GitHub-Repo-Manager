import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Globe, GitBranch, AlertTriangle, Loader2, Star, ChevronRight } from 'lucide-react'

const SOURCE_TYPES = [
  {
    value: 'azure',
    label: 'Azure DevOps',
    desc: 'Import repos, work items, and wikis from Azure DevOps',
    icon: Cloud,
    recommended: true,
    accent: {
      icon: 'from-cyan-400 to-blue-500',
      iconText: 'text-white',
      glow: 'shadow-cyan-500/25 dark:shadow-cyan-400/20',
      border: 'border-cyan-400/60 dark:border-cyan-400/40',
      bg: 'bg-cyan-50/80 dark:bg-cyan-950/30',
      ring: 'ring-cyan-400/20',
      badge: 'from-amber-400 to-orange-500',
    },
  },
  {
    value: 'url',
    label: 'Git URL',
    desc: 'Any public or private Git repository URL',
    icon: Globe,
    recommended: false,
    accent: {
      icon: 'from-emerald-400 to-teal-500',
      iconText: 'text-white',
      glow: 'shadow-emerald-500/25 dark:shadow-emerald-400/20',
      border: 'border-emerald-400/60 dark:border-emerald-400/40',
      bg: 'bg-emerald-50/80 dark:bg-emerald-950/30',
      ring: 'ring-emerald-400/20',
    },
  },
  {
    value: 'github',
    label: 'GitHub',
    desc: 'Clone or mirror between GitHub organizations',
    icon: GitBranch,
    recommended: false,
    accent: {
      icon: 'from-violet-400 to-purple-500',
      iconText: 'text-white',
      glow: 'shadow-violet-500/25 dark:shadow-violet-400/20',
      border: 'border-violet-400/60 dark:border-violet-400/40',
      bg: 'bg-violet-50/80 dark:bg-violet-950/30',
      ring: 'ring-violet-400/20',
    },
  },
]

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.08,
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
}

export default function SourceTypeStep({ source, onChange, onAdvance }) {
  const [gitAvailable, setGitAvailable] = useState(null)
  const [pendingType, setPendingType] = useState(null)
  const [hoveredType, setHoveredType] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    fetch('/api/import/git-status', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setGitAvailable(data.available !== false))
      .catch(() => setGitAvailable(false))
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleSelect = (value) => {
    if (pendingType) return
    // Re-selecting the same source: advance directly (auto-advance effect won't fire)
    if (source.sourceType === value) {
      onAdvance?.()
      return
    }
    setPendingType(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onChange({ sourceType: value })
      setPendingType(null)
    }, 300)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[320px]">
      {gitAvailable === null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400 mb-6"
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking git availability...
        </motion.div>
      )}

      {gitAvailable === false && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/90 dark:bg-amber-900/20 border border-amber-200/80 dark:border-amber-700/40 text-amber-700 dark:text-amber-400 text-sm mb-6 max-w-lg w-full backdrop-blur-sm"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Git is not installed on the server. Imports may not work correctly.</span>
        </motion.div>
      )}

      <div className="w-full max-w-lg space-y-3">
        {SOURCE_TYPES.map((st, index) => {
          const Icon = st.icon
          const selected = source.sourceType === st.value || pendingType === st.value
          const hovered = hoveredType === st.value
          const { accent } = st

          return (
            <motion.button
              key={st.value}
              custom={index}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              onClick={() => handleSelect(st.value)}
              onMouseEnter={() => setHoveredType(st.value)}
              onMouseLeave={() => setHoveredType(null)}
              className={`
                ds-card-shimmer ds-focus-ring
                group relative w-full flex items-center gap-4 p-4 rounded-2xl text-left
                transition-all duration-300 ease-out
                ${selected
                  ? `${accent.border} ${accent.bg} ring-2 ${accent.ring} shadow-lg ${accent.glow}`
                  : 'border border-slate-200/50 dark:border-slate-700/40 bg-white/60 dark:bg-slate-800/40 hover:bg-white/90 dark:hover:bg-slate-800/60 hover:border-slate-300/80 dark:hover:border-slate-600/60 hover:shadow-lg hover:shadow-slate-200/40 dark:hover:shadow-black/30'
                }
                ${!selected && hovered ? 'translate-y-[-2px]' : ''}
              `}
            >
              {/* Icon */}
              <div className={`
                relative p-3 rounded-xl bg-gradient-to-br ${accent.icon}
                shadow-md transition-all duration-300
                ${selected ? `shadow-lg ${accent.glow}` : 'shadow-slate-200/60 dark:shadow-black/30'}
                ${hovered && !selected ? `shadow-lg ${accent.glow}` : ''}
              `}>
                <Icon className={`w-5 h-5 ${accent.iconText}`} strokeWidth={2} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className={`
                    font-semibold tracking-tight
                    ${selected
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-800 dark:text-slate-100'
                    }
                  `}>
                    {st.label}
                  </span>
                  {st.recommended && (
                    <span className={`
                      inline-flex items-center gap-1 text-[11px] font-semibold
                      px-2 py-0.5 rounded-full
                      bg-gradient-to-r ${accent.badge} text-white
                      shadow-sm shadow-amber-500/20
                    `}>
                      <Star className="w-3 h-3" fill="currentColor" />
                      Recommended
                    </span>
                  )}
                </div>
                <p className={`
                  text-[13px] mt-0.5 leading-relaxed
                  ${selected
                    ? 'text-slate-600 dark:text-slate-300'
                    : 'text-slate-500 dark:text-slate-400'
                  }
                `}>
                  {st.desc}
                </p>
              </div>

              {/* Arrow indicator */}
              <div className={`
                flex-shrink-0 transition-all duration-300
                ${selected
                  ? 'opacity-100 translate-x-0'
                  : 'opacity-0 -translate-x-2 group-hover:opacity-60 group-hover:translate-x-0'
                }
              `}>
                <ChevronRight className={`
                  w-5 h-5
                  ${selected ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}
                `} />
              </div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
