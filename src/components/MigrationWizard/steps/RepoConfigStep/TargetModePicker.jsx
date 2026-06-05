import { Cloud, Server, Check } from 'lucide-react'
import { classifyProvider, providerToneClasses } from '../../../../utils/azureProvider'

/**
 * Target mode picker for Azure-source migrations.
 *
 * Two modes today:
 *   - 'github' (default): push the converted Git history to a new GitHub repo
 *   - 'azure-devops': create a new (or reuse an empty existing) Git repo
 *     inside an Azure DevOps / TFS project on the SAME server. Defaults to
 *     the source's own project but the Configure step lets the user pick any
 *     project on the same org. Only useful for TFVC migrations; for Git→Git
 *     copies we just show a hint that no migration is needed.
 *
 * Renders only when source is Azure. Hidden when there are no TFVC repos
 * selected (in-place mode is currently TFVC-only — Git→Git in-place would
 * be a noop / clone-and-rename which isn't worth a wizard).
 */
export default function TargetModePicker({ source, selectedRepos, onChange }) {
  if (source?.sourceType !== 'azure') return null
  const hasTfvc = selectedRepos?.some?.((r) => r.isTfvc)
  // For pure Git→Git Azure migrations the in-place option is meaningless,
  // so we don't even show the picker (GitHub stays the only target).
  if (!hasTfvc) return null

  const mode = source.azureTargetMode || 'github'
  const provider = classifyProvider(source.host)
  const tone = providerToneClasses(provider.tone)

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50/60 dark:bg-slate-900/40">
      <div className="px-4 py-2 bg-slate-100/60 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
        <div className="ds-text-micro font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Para onde queres migrar?
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-slate-200 dark:bg-slate-700/50">
        <ModeCard
          active={mode === 'github'}
          onClick={() => onChange({ azureTargetMode: 'github' })}
          icon={Cloud}
          title="GitHub"
          subtitle="Creates a new repo on GitHub and pushes the converted history."
          tag="public/private repo · multi-tenant"
        />
        <ModeCard
          active={mode === 'azure-devops'}
          onClick={() => onChange({ azureTargetMode: 'azure-devops' })}
          icon={Server}
          title={`${provider.shortName} (same server)`}
          subtitle={
            <>
              Converts TFVC to Git and lands in a project of your choice on the same <code className="px-1 rounded bg-slate-200 dark:bg-slate-700 ds-text-meta">{source.host}</code> — never leaves the server.
            </>
          }
          tag="in-place conversion · no GitHub"
          accentClass={tone.iconText}
        />
      </div>
      {mode === 'azure-devops' && (
        <div className="px-4 py-2.5 ds-text-meta text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/30">
          ℹ️ Choose the <strong>target project</strong> in the header below (default: same as the source).
          For each repo you can create a <strong>new</strong> one or reuse an <strong>existing empty</strong> one in that project.
          TFVC history is preserved via the Import API.
        </div>
      )}
    </div>
  )
}

function ModeCard({ active, onClick, icon: Icon, title, subtitle, tag, accentClass = 'text-indigo-500 dark:text-[color:var(--ds-accent-brand-dark)]' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 transition-all
        ${active
          ? 'bg-white dark:bg-slate-900/60 ring-2 ring-inset ring-indigo-400 dark:ring-indigo-500'
          : 'bg-white/40 dark:bg-slate-900/30 hover:bg-white/70 dark:hover:bg-slate-900/50'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center
          ${active ? 'bg-indigo-500/15' : 'bg-slate-100 dark:bg-slate-800'}`}>
          <Icon className={`w-4 h-4 ${active ? accentClass : 'text-slate-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-semibold ${active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
              {title}
            </span>
            {active && (
              <span className="inline-flex items-center gap-0.5 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-md bg-indigo-500 text-white">
                <Check className="w-2.5 h-2.5" /> escolhido
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          {tag && (
            <p className="ds-text-micro text-slate-400 dark:text-slate-500 mt-1 font-mono uppercase tracking-wider">
              {tag}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}
