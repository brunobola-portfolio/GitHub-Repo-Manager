import { motion, AnimatePresence } from 'framer-motion'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { SPRING } from '../ui/motion'

function statusIcon(s) {
  return s === 'written' ? '✓' : s === 'skipped' ? '⚠' : s === 'failed' ? '✗' : '·'
}

function statusClass(s) {
  return s === 'written' ? 'text-emerald-400'
       : s === 'skipped' ? 'text-amber-400'
       : s === 'failed'  ? 'text-rose-400'
       : 'text-slate-500'
}

function ScopeSection({ scope, marks }) {
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{scope}</div>
      {marks.length === 0
        ? <div className="text-sm text-slate-500 italic">— nothing written</div>
        : marks.map(m => (
            <div key={m.id} className="flex items-start gap-2 py-1 text-sm">
              <span className={statusClass(m.status)} aria-label={`status: ${m.status}`}>{statusIcon(m.status)}</span>
              <code className="ds-font-mono text-slate-300 text-xs">{m.target_kind}</code>
              <span className="text-slate-400">→</span>
              <span className="text-slate-200 truncate flex-1">{m.target_id}</span>
              {m.skip_reason && (
                <span className="text-xs text-amber-300/80 shrink-0">{m.skip_reason}</span>
              )}
              {m.error_message && (
                <span className="text-xs text-rose-300/80 truncate max-w-[40%]">{m.error_message}</span>
              )}
            </div>
          ))}
    </div>
  )
}

export function MarksDetailModal({ open, onClose, planId, byScope }) {
  const scopes = byScope || { source: [], destination: [], 'git-tag': [] }
  // Trap focus inside the dialog while open and restore it to the trigger on
  // close. The hook also wires Escape → onClose, which the previous ad-hoc
  // implementation lacked.
  const trapRef = useFocusTrap(open, onClose)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[var(--ds-z-modal)] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="marks-detail-title"
            tabIndex={-1}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={SPRING.drawer}
            onClick={e => e.stopPropagation()}
            className="max-w-2xl w-full rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-md shadow-2xl p-6"
          >
            <div className="flex items-baseline justify-between mb-4">
              <h3 id="marks-detail-title" className="ds-font-display text-xl text-slate-100">
                Migration marks · plan #{planId}
              </h3>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-200 transition"
                aria-label="Close migration marks dialog"
              >
                ✕
              </button>
            </div>
            <ScopeSection scope="source" marks={scopes.source || []} />
            <ScopeSection scope="destination" marks={scopes.destination || []} />
            <ScopeSection scope="git-tag" marks={scopes['git-tag'] || []} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
