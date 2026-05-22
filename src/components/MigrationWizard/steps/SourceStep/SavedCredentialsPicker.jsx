import { useState, useEffect } from 'react'
import { KeyRound, ChevronDown, Plus, Check, Settings } from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'

/**
 * Pick a previously-saved Azure PAT for the current host. Loads /api/azure/
 * credentials?host=X and offers a one-click "Use this token" action.
 *
 * Picking a saved credential sets `source.savedCredentialId` — the runtime
 * never exposes the PAT to the browser. The backend decrypts internally
 * when validating / migrating, keyed on the user's own session.
 *
 * Renders nothing when the user has no saved credentials for the host —
 * the empty case shouldn't add noise to the form.
 */
export default function SavedCredentialsPicker({ host, org, value, onPick, onOpenSettings }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!host) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears derived state when source removed
      setItems([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/azure/credentials?host=${encodeURIComponent(host)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return
        setItems(data.items || [])
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [host])

  // If the currently selected credential id no longer belongs to this host's
  // list (e.g., user switched hosts and the previous pick was for a cloud
  // account), clear the selection so the backend isn't asked to decrypt a
  // token meant for a different server. Without this the validation silently
  // 401s. Runs only after items have loaded — `loading` guards against
  // wiping the selection during the empty initial render.
  useEffect(() => {
    if (loading) return
    if (value && !items.some((c) => c.id === value)) {
      onPick(null)
    }
  }, [items, loading, value, onPick])

  // Best-match: same host + same org. Falls back to same-host-only.
  const matching = items.filter((c) => !org || !c.org || c.org === org)
  const others = items.filter((c) => !matching.includes(c))
  const ordered = [...matching, ...others]

  if (!host || (!loading && ordered.length === 0)) return null

  const picked = value ? items.find((c) => c.id === value) : null

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/15 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <KeyRound className="w-3.5 h-3.5" />
          {loading
            ? 'A procurar tokens guardados…'
            : ordered.length === 1
              ? '1 token guardado para este servidor'
              : `${ordered.length} tokens guardados para este servidor`}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1"
        >
          <Settings className="w-3 h-3" />
          Gerir
        </button>
      </div>

      {loading ? (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-2 py-1.5"
        >
          <Spinner size="sm" tone="muted" label="A carregar credenciais" /> A carregar…
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors text-left"
          >
            <KeyRound className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="flex-1 min-w-0 truncate">
              {picked
                ? <><strong>{picked.label}</strong> <span className="text-slate-500 font-mono text-xs">· {picked.prefix}</span></>
                : <span className="text-slate-500">Escolhe um token guardado…</span>}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <ul className="absolute z-10 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
              {ordered.map((c) => {
                const isPicked = c.id === value
                const isExactOrg = org && c.org === org
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(c.id)
                        setOpen(false)
                      }}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors
                        ${isPicked ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        {isPicked
                          ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          : <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                        <span className="flex-1 min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">
                          {c.label}
                        </span>
                        {isExactOrg && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40">
                            correspondência exacta
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 ml-5 mt-0.5 font-mono truncate">
                        {c.org ? `${c.org} · ` : ''}{c.prefix}
                        {c.lastUsedAt && <> · usado {formatRelative(c.lastUsedAt)}</>}
                      </div>
                    </button>
                  </li>
                )
              })}
              <li className="border-t border-slate-100 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => {
                    onPick(null)
                    setOpen(false)
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700/50 inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3" />
                  Colar um PAT diferente em vez disso
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {picked && (
        <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 px-1">
          ✓ A usar token guardado · o PAT nunca sai do servidor (decriptado on-demand)
        </p>
      )}
    </div>
  )
}

function formatRelative(iso) {
  try {
    const d = new Date(iso)
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24))
    if (days < 1) return 'hoje'
    if (days < 30) return `há ${days}d`
    if (days < 365) return `há ${Math.floor(days / 30)}m`
    return `há ${Math.floor(days / 365)}+ anos`
  } catch { return '' }
}
