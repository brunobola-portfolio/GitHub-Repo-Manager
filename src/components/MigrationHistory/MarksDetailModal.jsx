import { Tag } from 'lucide-react'
import { Modal } from '../ui/Modal'

function statusIcon(s) {
  return s === 'written' ? '✓' : s === 'skipped' ? '⚠' : s === 'failed' ? '✗' : '·'
}

// Text tokens, not the 400/500 fills: these are read as text on both themes.
function statusClass(s) {
  return s === 'written' ? 'text-[color:var(--ds-risk-low-text)] dark:text-emerald-400'
       : s === 'skipped' ? 'text-amber-700 dark:text-amber-400'
       : s === 'failed'  ? 'text-rose-700 dark:text-rose-400'
       : 'text-slate-500 dark:text-slate-400'
}

function ScopeSection({ scope, marks }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="ds-eyebrow text-slate-500 dark:text-slate-400 mb-1">{scope}</div>
      {marks.length === 0
        ? <div className="text-sm text-slate-500 dark:text-slate-400 italic">— nothing written</div>
        : marks.map(m => (
            <div key={m.id} className="flex items-start gap-2 py-1 text-sm">
              <span className={statusClass(m.status)} aria-label={`status: ${m.status}`}>{statusIcon(m.status)}</span>
              <code className="ds-font-mono text-xs text-slate-700 dark:text-slate-300">{m.target_kind}</code>
              <span className="text-slate-500 dark:text-slate-400" aria-hidden="true">→</span>
              <span className="text-slate-900 dark:text-slate-100 truncate flex-1">{m.target_id}</span>
              {m.skip_reason && (
                <span className="text-xs text-amber-700 dark:text-amber-300 shrink-0">{m.skip_reason}</span>
              )}
              {m.error_message && (
                <span className="text-xs text-rose-700 dark:text-rose-300 truncate max-w-[40%]">{m.error_message}</span>
              )}
            </div>
          ))}
    </div>
  )
}

/**
 * Provenance marks for one migration plan. Built on the shared Modal so it
 * follows the theme: the previous bespoke shell was a permanently dark slab
 * with its own backdrop, spring and a text "✕" close control.
 */
export function MarksDetailModal({ open, onClose, planId, byScope }) {
  const scopes = byScope || { source: [], destination: [], 'git-tag': [] }

  return (
    <Modal
      isOpen={!!open}
      onClose={onClose}
      size="lg"
      icon={Tag}
      title={`Migration marks · plan #${planId}`}
      subtitle="What was written to the source, the destination and as git tags"
    >
      <ScopeSection scope="source" marks={scopes.source || []} />
      <ScopeSection scope="destination" marks={scopes.destination || []} />
      <ScopeSection scope="git-tag" marks={scopes['git-tag'] || []} />
    </Modal>
  )
}
