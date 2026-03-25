import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Globe, GitBranch, AlertTriangle, Loader2, Star } from 'lucide-react'

const SOURCE_TYPES = [
  {
    value: 'azure',
    label: 'Azure DevOps',
    desc: 'Import repos, work items, and wikis from Azure DevOps',
    icon: Cloud,
    recommended: true,
  },
  {
    value: 'url',
    label: 'Git URL',
    desc: 'Any public or private Git repository URL',
    icon: Globe,
    recommended: false,
  },
  {
    value: 'github',
    label: 'GitHub',
    desc: 'Clone or mirror between GitHub organizations',
    icon: GitBranch,
    recommended: false,
  },
]

export default function SourceTypeStep({ source, onChange }) {
  const [gitAvailable, setGitAvailable] = useState(null)
  const [pendingType, setPendingType] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    fetch('/api/import/git-status', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setGitAvailable(data.available !== false))
      .catch(() => setGitAvailable(false))
  }, [])

  // Clean up pending timer on unmount to avoid state updates after unmount
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const handleSelect = (value) => {
    if (pendingType) return // debounce double-clicks
    setPendingType(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      onChange({ sourceType: value })
      setPendingType(null)
    }, 300)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {gitAvailable === null && (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking git availability...
        </div>
      )}
      {gitAvailable === false && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Git is not installed on the server. Imports may not work correctly.</span>
        </div>
      )}
      <div className="space-y-3">
        {SOURCE_TYPES.map((st) => {
          const Icon = st.icon
          const selected = source.sourceType === st.value || pendingType === st.value
          return (
            <button
              key={st.value}
              onClick={() => handleSelect(st.value)}
              className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left
                ${selected
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 scale-[1.01]'
                  : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
            >
              <div className={`p-3 rounded-xl transition-colors ${selected ? 'bg-indigo-100 dark:bg-indigo-900/40' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <Icon className={`w-6 h-6 ${selected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{st.label}</span>
                  {st.recommended && (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                      <Star className="w-3 h-3" />
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{st.desc}</p>
              </div>
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}
