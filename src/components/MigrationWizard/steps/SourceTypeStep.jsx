import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Cloud, Globe, GitBranch, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react'

const SOURCE_TYPES = [
  { value: 'azure', label: 'Azure DevOps', icon: Cloud, desc: 'Import from Azure DevOps with PAT authentication' },
  { value: 'url', label: 'Git URL', icon: Globe, desc: 'Any public or private Git repository URL' },
  { value: 'github', label: 'GitHub', icon: GitBranch, desc: 'Clone or mirror between GitHub organizations' },
]

export default function SourceTypeStep({ source, onChange }) {
  const [gitAvailable, setGitAvailable] = useState(null)

  useEffect(() => {
    fetch('/api/import/git-status', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => setGitAvailable(data.available !== false))
      .catch(() => setGitAvailable(false))
  }, [])

  const handleSelect = (value) => {
    onChange({ sourceType: value })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Choose the source of the repository you want to import.
      </p>

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

      <div className="space-y-2">
        {SOURCE_TYPES.map((st) => {
          const Icon = st.icon
          const selected = source.sourceType === st.value
          return (
            <button
              key={st.value}
              onClick={() => handleSelect(st.value)}
              className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left
                ${selected
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
            >
              <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                <Icon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100">{st.label}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{st.desc}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}
