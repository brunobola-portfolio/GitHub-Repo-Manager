import { useState, useEffect, useCallback, useRef, useId } from 'react'
import {
  KeyRound, Plus, Trash2, Cloud, Server, Eye, EyeOff,
  CheckCircle2, XCircle, ExternalLink, Sparkles, AlertCircle,
  ShieldCheck, ShieldAlert, Check,
} from 'lucide-react'
import { SpinnerIcon } from '../ui/Spinner'
import AllowlistFixPanel from '../ui/AllowlistFixPanel'
import { Checkbox, Input } from '../ui/form'
import { getCsrfToken } from '../../utils/api'
import { formatUserError } from '../../utils/errors'
import { useHostAllowlist } from '../../hooks/useHostAllowlist'
import { useToast } from '../../hooks/useToast'
import { formatDate, formatRelativeTime } from '../../utils/format'
import { classifyProvider, providerToneClasses, buildPatSettingsUrl } from '../../utils/azureProvider'

/**
 * Settings → Azure Credentials.
 *
 * One place to manage every PAT the user has saved across Azure DevOps
 * cloud / VSTS / TFS on-prem instances. PATs are encrypted at rest and
 * never returned to the client after the initial paste; this view only
 * shows a `prefix` (first/last 4 chars) for visual identification.
 *
 * The migration wizard reads from this list to offer "use saved token"
 * — eliminates the paste-every-session friction we had before.
 */
export default function AzureCredentialsSection() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState(null)

  const fetchItems = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/azure/credentials', { credentials: 'include' })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      if (!data) throw new Error('Unexpected response from the server')
      setItems(data.items || [])
    } catch (e) {
      setError(formatUserError(e, { fallbackTitle: "Couldn't load Azure credentials" }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    fetchItems()
  }, [fetchItems])

  return (
    <div className="space-y-5">
      <Header onAdd={() => setShowForm(true)} />

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-700 dark:text-rose-300">
          <XCircle className="w-4 h-4 shrink-0" /> {error.title}
        </div>
      )}

      {showForm && (
        <AddCredentialForm
          onClose={() => setShowForm(false)}
          onCreated={(created) => {
            setItems((prev) => [created, ...prev])
            setShowForm(false)
          }}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-20 rounded-2xl ds-skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        // A failed load says nothing about the user's data; the error banner
        // above is the whole state until a retry succeeds.
        error ? null : <EmptyState onAdd={() => setShowForm(true)} />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <CredentialRow
              key={c.id}
              cred={c}
              onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
              onTested={(id, result) => {
                if (result.valid && result.resolvedOrg && result.resolvedOrg !== c.org) {
                  // Surface auto-discovered org rewrite to the user
                  setItems((prev) => prev.map((x) => x.id === id ? { ...x, org: result.resolvedOrg } : x))
                }
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Header({ onAdd }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-brand-500" />
          Azure DevOps · Saved credentials
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
          Save Personal Access Tokens once and reuse them in the migration wizard.
          Tokens are stored <strong>encrypted</strong> in the database —
          {' '}<span className="text-emerald-700 dark:text-emerald-400">never</span> returned to the browser after being saved.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg ds-brand-solid dark:hover:bg-brand-400 transition-colors shadow-sm ds-focus-ring"
      >
        <Plus className="w-4 h-4" />
        Add PAT
      </button>
    </div>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
      <Sparkles className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-500 mb-2" />
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">No saved PATs yet</h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
        Add a PAT for your Azure DevOps or on-prem TFS and reuse it in every future migration
        without pasting it again.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg ds-brand-solid ds-focus-ring"
      >
        <Plus className="w-4 h-4" />
        Add your first PAT
      </button>
    </div>
  )
}

/** True when a failed test is fixable by adding the host to the allowlist. */
function isHostNotAllowed(result) {
  if (!result || result.valid) return false
  return result.code === 'HOST_NOT_ALLOWED'
    || /ALLOWED_AZURE_HOSTS|not in allowlist/i.test(result.error || '')
}

function CredentialRow({ cred, onDeleted, onTested }) {
  const provider = classifyProvider(cred.host)
  const tone = providerToneClasses(provider.tone)
  const Icon = provider.isCloud ? Cloud : Server
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [allowlistInfo, setAllowlistInfo] = useState(null)
  const dismissTimer = useRef(null)
  const confirmBtnRef = useRef(null)
  const deleteBtnRef = useRef(null)

  useEffect(() => () => clearTimeout(dismissTimer.current), [])

  // Keyboard parity for the inline confirm: focus lands on Confirm when it
  // replaces the trash icon, Escape backs out, focus returns to the trigger.
  useEffect(() => {
    if (confirming) confirmBtnRef.current?.focus()
  }, [confirming])

  const cancelConfirm = useCallback(() => {
    setConfirming(false)
    requestAnimationFrame(() => deleteBtnRef.current?.focus())
  }, [])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch(`/api/azure/credentials/${cred.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Removal failed')
      }
      onDeleted(cred.id)
    } catch (e) {
      toast.errorFromException(e, { fallbackTitle: 'Could not save Azure credentials' })
      setDeleting(false)
      setConfirming(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null); setAllowlistInfo(null)
    clearTimeout(dismissTimer.current)
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch(`/api/azure/credentials/${cred.id}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      })
      const data = await res.json().catch(() => null)
      if (!data) throw new Error(`HTTP ${res.status}`)
      setTestResult(data)
      onTested?.(cred.id, data)
      if (isHostNotAllowed(data)) {
        // Pull allowlist context so the self-fix panel can offer the
        // 1-click add (admin) or "ask your admin" guidance (non-admin).
        const info = await fetch(`/api/azure/host-allowlist?host=${encodeURIComponent(cred.host)}`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        // If the info fetch fails, still render the panel with conservative
        // defaults — the "ask your admin" + .env guidance is always valid.
        setAllowlistInfo(info || { patterns: [], usingDefault: true, canEdit: false })
      }
      if (data.valid) {
        // Successes fade out; failures stay visible so the user can act.
        dismissTimer.current = setTimeout(() => setTestResult(null), 6000)
      }
    } catch (e) {
      setTestResult({ valid: false, error: e.message })
    } finally {
      setTesting(false)
    }
  }

  const patUrl = buildPatSettingsUrl(cred.host, cred.org || '_')
  const lastUsed = cred.lastUsedAt ? `used ${formatRelativeTime(cred.lastUsedAt)}` : 'never used'

  return (
    <li className={`rounded-2xl border ${tone.border} ${tone.bg} overflow-hidden`}>
      <div className="px-4 py-3 flex items-center gap-3">
        <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${tone.bg} border ${tone.border}`}>
          <Icon className={`w-4 h-4 ${tone.iconText}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {cred.label}
            </span>
            <span className={`ds-text-micro uppercase tracking-wider font-semibold ${tone.text}`}>
              {provider.label}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
            {cred.host}{cred.org ? ` · ${cred.org}` : ''} · {cred.prefix}
          </div>
          <div className="ds-text-meta text-slate-500 dark:text-slate-400 mt-0.5">
            Created on {formatDate(cred.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })} · {lastUsed}
            {cred.scopes && cred.scopes.length > 0 && (
              <> · {cred.scopes.join(', ')}</>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 transition-colors ds-focus-ring"
            title="Validate the token against the server"
          >
            {testing
              ? <SpinnerIcon className="w-3.5 h-3.5" />
              : 'Test'}
          </button>
          {patUrl && (
            <a
              href={patUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors ds-focus-ring"
              title="Open the PATs page on the server"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {confirming ? (
            <div className="flex items-center gap-1">
              {/* Cancel first so a rapid double-click on the trash position
                  lands on Cancel, not Confirm. Escape backs out from either. */}
              <button
                type="button"
                onClick={cancelConfirm}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelConfirm() } }}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 ds-focus-ring rounded"
              >
                Cancel
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                onClick={handleDelete}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelConfirm() } }}
                disabled={deleting}
                aria-label={`Confirm removal of "${cred.label}"`}
                className="px-2 py-1 text-xs font-semibold rounded-md bg-rose-600 text-white hover:bg-rose-700 ds-focus-ring"
              >
                {deleting ? '…' : 'Confirm'}
              </button>
            </div>
          ) : (
            <button
              ref={deleteBtnRef}
              type="button"
              onClick={() => setConfirming(true)}
              className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-slate-800 transition-colors ds-focus-ring"
              title="Remove from the local vault"
              aria-label={`Remove credential "${cred.label}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {testResult && (
        <div
          role={testResult.valid ? 'status' : 'alert'}
          className={`px-4 py-2 text-xs border-t ${tone.border}
            ${testResult.valid
              ? 'bg-emerald-50/60 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50/60 dark:bg-rose-900/15 text-rose-700 dark:text-rose-300'}`}
        >
          {testResult.valid
            ? <>✓ Token valid against {cred.host}{testResult.resolvedOrg ? ` (resolved org: ${testResult.resolvedOrg})` : ''}</>
            : <>✗ {testResult.error || 'Validation failed'}</>}
        </div>
      )}
      {isHostNotAllowed(testResult) && allowlistInfo && (
        <div className={`px-4 pb-4 pt-3 border-t ${tone.border}`}>
          <AllowlistFixPanel
            host={cred.host}
            currentPatterns={allowlistInfo.patterns || []}
            usingDefault={!!allowlistInfo.usingDefault}
            canEdit={!!allowlistInfo.canEdit}
            notes={`Added from Settings · credential "${cred.label}"`}
            onAdded={() => handleTest()}
          />
        </div>
      )}
    </li>
  )
}

function AddCredentialForm({ onClose, onCreated }) {
  const formId = useId()
  const ids = {
    label: `${formId}-label`,
    host: `${formId}-host`,
    org: `${formId}-org`,
    pat: `${formId}-pat`,
  }
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [org, setOrg] = useState('')
  const [pat, setPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [scopes, setScopes] = useState({ code: true, project: true, workItems: false, wiki: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const provider = classifyProvider(host)
  const tone = providerToneClasses(provider.tone)
  const allowlist = useHostAllowlist(host)
  const patUrl = host && org ? buildPatSettingsUrl(host, org) : null
  const canSubmit = label.trim() && host.trim() && pat.trim().length >= 20

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (!canSubmit) return
    setSubmitting(true); setError(null)
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const scopeList = Object.entries(scopes).filter(([, v]) => v).map(([k]) => ({
        code: 'Code (Read)',
        project: 'Project & Team (Read)',
        workItems: 'Work Items (Read)',
        wiki: 'Wiki (Read)',
      }[k]))
      const res = await fetch('/api/azure/credentials', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ label: label.trim(), host: host.trim().toLowerCase(), org: org.trim() || null, pat, scopes: scopeList }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || `HTTP ${res.status}`)
      onCreated(data)
    } catch (e) {
      setError(formatUserError(e, { fallbackTitle: 'Failed to save the credential' }))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-brand-300 dark:border-brand-700 bg-brand-50/30 dark:bg-brand-900/10 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Plus className="w-4 h-4 text-brand-500" />
          New PAT
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name (for your reference)" htmlFor={ids.label}>
          <Input
            id={ids.label}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Trigenius TFS · main"
            maxLength={60}
            required
          />
        </Field>

        <Field label="Host (without https://)" htmlFor={ids.host}>
          <Input
            id={ids.host}
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="dev.azure.com  or  tfs.company.com"
            className="font-mono"
            required
          />
          {host && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className={`ds-text-meta inline-flex items-center gap-1 ${tone.text}`}>
                {provider.isCloud ? <Cloud className="w-3 h-3" /> : <Server className="w-3 h-3" />}
                {provider.label}
              </span>
              <HostAllowlistChip status={allowlist.status} />
            </div>
          )}
        </Field>

        <Field label="Organization / Collection (optional)" htmlFor={ids.org}>
          <Input
            id={ids.org}
            type="text"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="e.g. Trigenius  or  tfs/DefaultCollection"
            className="font-mono"
          />
          <p className="ds-text-micro text-slate-500 mt-1">Enables the "Test" button and auto-match in the wizard.</p>
        </Field>

        <Field label="Scopes (informational)">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scopes (informational)">
            {[
              { key: 'code', label: 'Code', required: true },
              { key: 'project', label: 'Project & Team', required: true },
              { key: 'workItems', label: 'Work Items' },
              { key: 'wiki', label: 'Wiki' },
            ].map((s) => (
              <label
                key={s.key}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border cursor-pointer transition-colors
                  focus-within:ring-2 focus-within:ring-brand-500/70 focus-within:ring-offset-1
                  ${scopes[s.key]
                    ? (s.required ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                  : 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-700')
                    : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-white dark:hover:bg-slate-800'}`}
              >
                {/* sr-only (NOT hidden/display:none) keeps the checkbox in the
                    tab order and accessibility tree. */}
                <Checkbox
                  className="sr-only"
                  checked={scopes[s.key]}
                  onChange={(e) => setScopes((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                />
                {scopes[s.key]
                  ? <Check className={`w-3 h-3 ${s.required ? 'text-emerald-500' : 'text-brand-500'}`} aria-hidden="true" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-slate-300" aria-hidden="true" />}
                {s.label}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Personal Access Token" htmlFor={ids.pat}>
        <Input
          id={ids.pat}
          type={showPat ? 'text' : 'password'}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="Paste the PAT generated on the server here"
          className="font-mono"
          required
          trailing={
            <button
              type="button"
              onClick={() => setShowPat((v) => !v)}
              aria-label={showPat ? 'Hide token' : 'Show token'}
              aria-pressed={showPat}
              className="p-1 text-slate-400 hover:text-slate-600 ds-focus-ring rounded"
            >
              {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
        />
        {patUrl && (
          <a
            href={patUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 ds-text-meta text-brand-500 hover:text-brand-400"
          >
            Create a PAT on {host} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </Field>

      {/* Pre-emptive allowlist fix — saving a PAT for a blocked host would
          only fail later at test/migration time, so surface it here. */}
      {allowlist.status === 'blocked' && (
        <AllowlistFixPanel
          host={host.trim().toLowerCase()}
          currentPatterns={allowlist.patterns}
          usingDefault={allowlist.usingDefault}
          canEdit={allowlist.canEdit}
          notes="Added from Settings · new PAT form"
          onAdded={() => allowlist.refresh()}
        />
      )}

      {error && (
        <div role="alert" className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error.title}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md ds-focus-ring"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg ds-brand-solid disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors ds-focus-ring"
        >
          {submitting
            ? <><SpinnerIcon className="w-3.5 h-3.5" /> Saving…</>
            : <><CheckCircle2 className="w-3.5 h-3.5" /> Save encrypted token</>}
        </button>
      </div>
    </form>
  )
}

/** Live allowlist status next to the host field — green / amber / spinner. */
function HostAllowlistChip({ status }) {
  if (status === 'checking') {
    return (
      <span role="status" className="ds-text-meta inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
        <SpinnerIcon className="w-3 h-3" /> checking allowlist…
      </span>
    )
  }
  if (status === 'allowed') {
    return (
      <span role="status" className="ds-text-meta inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="w-3 h-3" /> authorized host
      </span>
    )
  }
  if (status === 'blocked') {
    return (
      <span role="status" className="ds-text-meta inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <ShieldAlert className="w-3 h-3" /> not in the allowlist
      </span>
    )
  }
  return null
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</label>
      {children}
    </div>
  )
}

