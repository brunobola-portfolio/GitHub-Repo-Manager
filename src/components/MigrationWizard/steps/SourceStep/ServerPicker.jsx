import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Server, Cloud, Check, AlertCircle, Pencil, ShieldCheck, ShieldAlert } from 'lucide-react'
import { classifyProvider, providerToneClasses, PROVIDERS } from '../../../../utils/azureProvider'

/**
 * Always-visible "Server" picker. Eliminates the silent dev.azure.com
 * fallback that previously bit users who pasted on-prem TFS URLs (or
 * typed an org name directly without pasting a URL first).
 *
 * Two presets + a free-form mode:
 *   - Azure DevOps Cloud     → host = "dev.azure.com"
 *   - On-premises TFS / ADS  → host = user-entered (e.g. "tfs.company.com")
 *
 * VSTS (*.visualstudio.com) auto-detected from URL paste — no preset
 * since few people use it deliberately anymore.
 */
export default function ServerPicker({ host, onHostChange, locked = false, allowlistStatus = null }) {
  // allowlistStatus: null (unknown) | true (allowed) | false (rejected)
  const provider = classifyProvider(host)
  const tone = providerToneClasses(provider.tone)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(host || '')

  // Reset local draft buffer when the canonical `host` prop changes (paste vs
  // manual edit). Computing during render would race with the edit mode toggle.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs derived state with prop
    setDraft(host || '')
  }, [host])

  const commit = () => {
    const v = draft.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!v) return
    onHostChange(v)
    setEditing(false)
  }

  const pickCloud = () => {
    onHostChange('dev.azure.com')
    setEditing(false)
  }

  const startCustomEdit = () => {
    setDraft(provider.type === PROVIDERS.ON_PREM ? (host || '') : '')
    setEditing(true)
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/15 p-3 space-y-2.5">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Server className="w-3.5 h-3.5" />
          Enter your on-premises server hostname (without <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">https://</code>):
        </div>
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            }}
            placeholder="e.g. tfs.company.com  or  tfs.company.com:8080"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            autoFocus
          />
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-2 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
        </div>
        <p className="ds-text-meta text-slate-500 dark:text-slate-400">
          💡 Tip: even faster — paste the full Azure DevOps / TFS URL in the field above and this server is detected automatically.
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border ${tone.bg} ${tone.border} overflow-hidden`}>
      <div className="px-3.5 py-2.5 flex items-center gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${tone.bg} border ${tone.border}`}>
          {provider.type === PROVIDERS.ON_PREM
            ? <Server className={`w-4 h-4 ${tone.iconText}`} />
            : <Cloud className={`w-4 h-4 ${tone.iconText}`} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="ds-text-micro uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              Server
            </span>
            <span className={`text-sm font-semibold ${tone.text}`}>{provider.label}</span>
            {!host && (
              <span className="inline-flex items-center gap-1 ds-text-micro uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">
                <AlertCircle className="w-3 h-3" />
                not set
              </span>
            )}
            {host && allowlistStatus === true && (
              <span
                className="inline-flex items-center gap-1 ds-text-micro uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-semibold"
                title="Server authorized by the backend (.env)"
              >
                <ShieldCheck className="w-3 h-3" />
                authorized
              </span>
            )}
            {host && allowlistStatus === false && (
              <span
                className="inline-flex items-center gap-1 ds-text-micro uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold"
                title="The backend has an allowlist and this host isn't included"
              >
                <ShieldAlert className="w-3 h-3" />
                not authorized in .env
              </span>
            )}
          </div>
          <div className="text-xs font-mono text-slate-600 dark:text-slate-400 mt-0.5 truncate">
            {host || 'Paste a URL or choose below'}
          </div>
        </div>
        {!locked && (
          <div className="shrink-0 flex items-center gap-1">
            <PresetButton
              // Both modern cloud (dev.azure.com) AND legacy VSTS
              // (*.visualstudio.com) are cloud — light up "Cloud" for either so
              // a pasted VSTS URL auto-selects instead of leaving both unset.
              active={provider.isCloud}
              onClick={pickCloud}
              title="Use Azure DevOps Cloud"
            >
              <Cloud className="w-3.5 h-3.5" />
              Cloud
            </PresetButton>
            <PresetButton
              active={provider.type === PROVIDERS.ON_PREM}
              onClick={startCustomEdit}
              title="Specify an on-premises TFS server"
            >
              <Server className="w-3.5 h-3.5" />
              On-prem
            </PresetButton>
            {host && (
              <button
                type="button"
                onClick={startCustomEdit}
                className="ml-1 p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Edit server"
                title="Edit manually"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <AnimatePresence>
        {!host && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-2.5 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-700/40 pt-2">
              To get started: paste a URL from your Azure DevOps / TFS in the field above,
              or click <strong>Cloud</strong> / <strong>On-prem</strong> here on the right.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PresetButton({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors
        ${active
          ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'}`}
    >
      {active && <Check className="w-3 h-3" />}
      {children}
    </button>
  )
}
