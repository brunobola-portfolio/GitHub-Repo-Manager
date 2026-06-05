import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, ShieldAlert, Plus, Trash2, Lock, Globe,
  Server as ServerIcon, AlertCircle, CheckCircle2, FileCode,
} from 'lucide-react'
import { SpinnerIcon } from '../ui/Spinner'
import { getCsrfToken } from '../../utils/api'

/**
 * Settings → Azure Hosts Allowlist (admin only).
 *
 * Admin-managed control of the SSRF allowlist that governs which Azure
 * DevOps / TFS servers the backend is allowed to contact. Changes here
 * take effect immediately (no server restart) and are audit-logged.
 *
 * The component is informational for non-admins (shows the list + the
 * source of each entry) and read-only for them. Admin actions surface
 * the dedicated 1-click "Add" / "Remove" buttons.
 */
export default function AzureHostsAllowlistSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/azure/host-allowlist', { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed to load allowlist')
      setData(json)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 rounded w-2/3 ds-skeleton" />
        <div className="h-20 rounded-2xl ds-skeleton" />
        <div className="h-20 rounded-2xl ds-skeleton" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
        <AlertCircle className="w-4 h-4 shrink-0" /> {error || 'Error loading'}
      </div>
    )
  }

  const envPatterns = data.envPatterns || []
  const dbEntries = data.dbEntries || []
  const canEdit = !!data.canEdit

  return (
    <div className="space-y-5">
      <Header canEdit={canEdit} />

      {/* Add new — admin only */}
      {canEdit && <AddHostForm onAdded={load} />}

      {/* Combined list with provenance badges */}
      <div className="space-y-4">
        {envPatterns.length > 0 && (
          <Section
            title="Configured in .env"
            description="Entries from the ALLOWED_AZURE_HOSTS variable. They can only be changed by editing the server's .env."
            icon={FileCode}
          >
            {envPatterns.map((p) => (
              <RowReadOnly key={`env:${p}`} pattern={p} source="env" />
            ))}
          </Section>
        )}

        <Section
          title="Managed in the database"
          description="Entries you can add/remove here without restarting the server. Audited."
          icon={ShieldCheck}
        >
          {dbEntries.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-4 py-3">
              No database entries yet.
            </p>
          ) : (
            dbEntries.map((e) => (
              <RowDb
                key={`db:${e.pattern}`}
                entry={e}
                canEdit={canEdit}
                onDeleted={load}
              />
            ))
          )}
        </Section>
      </div>

      <WhyThisExists />
    </div>
  )
}

function Header({ canEdit }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
        Azure / TFS hosts allowlist
        {!canEdit && (
          <span className="ds-text-micro uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 inline-flex items-center gap-1">
            <Lock className="w-3 h-3" /> read-only
          </span>
        )}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
        Controls which Azure DevOps / TFS servers the backend can contact (SSRF protection).
        Non-cloud hosts (such as on-premises TFS) must be explicitly authorized here before
        the migration wizard can connect.
        {!canEdit && <> Ask an administrator to make changes.</>}
      </p>
    </div>
  )
}

function Section({ title, description, icon: Icon, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</span>
        </div>
        <p className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {children}
      </ul>
    </div>
  )
}

function RowReadOnly({ pattern }) {
  const isWildcard = pattern.startsWith('*.')
  return (
    <li className="px-4 py-2.5 flex items-center gap-3">
      <div className="shrink-0 w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        {isWildcard
          ? <Globe className="w-3.5 h-3.5 text-slate-500" />
          : <ServerIcon className="w-3.5 h-3.5 text-slate-500" />}
      </div>
      <code className="flex-1 min-w-0 text-sm font-mono text-slate-800 dark:text-slate-200 truncate">
        {pattern}
      </code>
      <span className="shrink-0 ds-text-micro uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
        .env
      </span>
    </li>
  )
}

function RowDb({ entry, canEdit, onDeleted }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const isWildcard = entry.pattern.startsWith('*.')

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch(`/api/azure/host-allowlist/${encodeURIComponent(entry.pattern)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed')
      }
      onDeleted?.()
    } catch (e) {
      alert(e.message)
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <li className="px-4 py-2.5 flex items-center gap-3">
      <div className="shrink-0 w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
        {isWildcard
          ? <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          : <ServerIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <code className="block text-sm font-mono text-slate-800 dark:text-slate-200 truncate">
          {entry.pattern}
        </code>
        <div className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5">
          {entry.added_by_username
            ? <>Added by <strong>{entry.added_by_username}</strong></>
            : 'Added'}
          {' '}on {formatDate(entry.added_at)}
          {entry.notes ? ` · ${entry.notes}` : ''}
        </div>
      </div>
      {canEdit && (
        <div className="shrink-0">
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? <SpinnerIcon className="w-3 h-3" /> : 'Confirm'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="p-1.5 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              title="Remove from allowlist"
              aria-label="Remove entry"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function AddHostForm({ onAdded }) {
  const [pattern, setPattern] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (!pattern.trim()) return
    setSubmitting(true); setError(''); setSuccess(false)
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch('/api/azure/host-allowlist', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ pattern: pattern.trim(), notes: notes.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setPattern(''); setNotes(''); setSuccess(true)
      onAdded?.()
      setTimeout(() => setSuccess(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50/30 dark:bg-indigo-900/10 p-4 space-y-2.5"
    >
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
        <Plus className="w-4 h-4 text-indigo-500" />
        Add host to allowlist
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr_auto] gap-2">
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="tfs.company.com  or  *.tfs.company.com"
          className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono"
          required
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional) — e.g. 'Acme internal TFS'"
          className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
          maxLength={200}
        />
        <button
          type="submit"
          disabled={!pattern.trim() || submitting}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? <SpinnerIcon className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          Add
        </button>
      </div>
      <p className="ds-text-meta text-slate-500 dark:text-slate-400">
        Subdomain wildcard: <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">*.company.com</code> (covers all subdomains).
        Optional port: <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">tfs.company.com:8080</code>.
      </p>
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}
      {success && (
        <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Added · no restart needed
        </div>
      )}
    </form>
  )
}

function WhyThisExists() {
  return (
    <details className="text-xs text-slate-500 dark:text-slate-400 group">
      <summary className="cursor-pointer inline-flex items-center gap-1.5 hover:text-slate-700 dark:hover:text-slate-200">
        <ShieldAlert className="w-3.5 h-3.5" />
        Why does this exist?
      </summary>
      <div className="mt-2 pl-5 space-y-1.5">
        <p>
          Without an allowlist, an authenticated user could make the backend send requests to internal hosts
          (intranet, AWS metadata, etc.) through the migration wizard — an <strong>SSRF</strong> attack.
        </p>
        <p>
          The allowlist <strong>explicitly</strong> defines which external servers the backend
          can contact. Patterns support an exact <code>hostname</code> and <code>*.domain</code> wildcards.
        </p>
        <p>
          For immutable deployments (Kubernetes ConfigMaps, etc.) you can keep using the env var
          <code className="mx-1 px-1 rounded bg-slate-200 dark:bg-slate-700">ALLOWED_AZURE_HOSTS</code>
          — the two sources (env + DB) are merged.
        </p>
      </div>
    </details>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}
