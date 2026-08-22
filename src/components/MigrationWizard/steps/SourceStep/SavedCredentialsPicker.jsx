import { useState, useEffect, useMemo } from 'react'
import { KeyRound, Plus, Check, Settings } from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import { Select } from '../../../ui/Select'
import { formatRelativeTime } from '../../../../utils/format'

// Sentinel option value for the "paste a different PAT" row. Selecting it clears
// the saved-credential pick (onPick(null)); modelling it as a real Select option
// means Select closes the dropdown for us on click, like any other selection.
const PASTE_SENTINEL = '__paste_new__'

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

  // Map credentials → Select options (+ a trailing "paste a different PAT"
  // sentinel). Rich per-row content (bold label, exact-match badge, org/prefix/
  // last-used sub-line) is drawn by `renderOption`; the trigger uses Select's
  // native icon/label/badge to show the picked token + its prefix.
  const options = useMemo(() => {
    const creds = ordered.map((c) => ({
      value: c.id,
      label: c.label,
      icon: KeyRound,
      badge: c.prefix,
      badgeColor: 'font-mono text-slate-500 dark:text-slate-400',
      org: c.org,
      prefix: c.prefix,
      lastUsedAt: c.lastUsedAt,
      isExactOrg: !!(org && c.org === org),
    }))
    return [...creds, { value: PASTE_SENTINEL, label: 'Paste a different PAT instead', __paste: true }]
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ordered` is derived from items each render
  }, [items, org])

  const handleChange = (val) => {
    onPick(val === PASTE_SENTINEL ? null : val)
  }

  const renderCredentialOption = (option, { selected }) =>
    option.__paste ? (
      <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Plus className="w-3 h-3 shrink-0" />
        Paste a different PAT instead
      </span>
    ) : (
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {selected
            ? <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            : <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
          <span className="flex-1 min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">
            {option.label}
          </span>
          {option.isExactOrg && (
            <span className="shrink-0 ds-text-micro uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40">
              exact match
            </span>
          )}
        </div>
        <div className="ds-text-meta text-slate-500 dark:text-slate-400 ml-5 mt-0.5 font-mono truncate">
          {option.org ? `${option.org} · ` : ''}{option.prefix}
          {option.lastUsedAt && <> · used {formatRelativeTime(option.lastUsedAt)}</>}
        </div>
      </div>
    )

  if (!host || (!loading && ordered.length === 0)) return null

  const picked = value ? items.find((c) => c.id === value) : null

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/15 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          <KeyRound className="w-3.5 h-3.5" />
          {loading
            ? 'Searching saved tokens…'
            : ordered.length === 1
              ? '1 saved token for this server'
              : `${ordered.length} saved tokens for this server`}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="ds-text-meta text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1"
        >
          <Settings className="w-3 h-3" />
          Manage
        </button>
      </div>

      {loading ? (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-2 py-1.5"
        >
          <Spinner size="sm" tone="muted" label="Loading credentials" /> Loading…
        </div>
      ) : (
        <Select
          options={options}
          value={value ?? ''}
          onChange={handleChange}
          renderOption={renderCredentialOption}
          searchable={ordered.length > 8}
          label="Saved token"
          placeholder="Choose a saved token…"
        />
      )}

      {picked && (
        <p className="ds-text-meta text-emerald-700/80 dark:text-emerald-300/80 px-1">
          ✓ Using a saved token · the PAT never leaves the server (decrypted on-demand)
        </p>
      )}
    </div>
  )
}
