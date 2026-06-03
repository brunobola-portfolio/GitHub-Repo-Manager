import { useState, useEffect, useCallback } from 'react'
import {
  KeyRound, Plus, Trash2, Cloud, Server, Eye, EyeOff,
  CheckCircle2, XCircle, ExternalLink, Sparkles, AlertCircle,
} from 'lucide-react'
import { SpinnerIcon } from '../ui/Spinner'
import { getCsrfToken } from '../../utils/api'
import { classifyProvider, providerToneClasses, PROVIDERS, buildPatSettingsUrl } from '../../utils/azureProvider'

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
  const [error, setError] = useState('')

  const fetchItems = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/azure/credentials', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to load credentials')
      setItems(data.items || [])
    } catch (e) {
      setError(e.message)
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
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
            <div key={i} className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState onAdd={() => setShowForm(true)} />
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
          <KeyRound className="w-4 h-4 text-indigo-500" />
          Azure DevOps · Credenciais guardadas
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
          Guarda Personal Access Tokens uma vez e reutiliza-os no wizard de migração.
          Os tokens ficam <strong>encriptados</strong> na base de dados —
          {' '}<span className="text-emerald-600 dark:text-emerald-400">nunca</span> são devolvidos ao browser depois de guardados.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] dark:bg-indigo-500 dark:hover:bg-indigo-400 transition-colors shadow-sm"
      >
        <Plus className="w-4 h-4" />
        Adicionar PAT
      </button>
    </div>
  )
}

function EmptyState({ onAdd }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
      <Sparkles className="w-8 h-8 mx-auto text-slate-400 dark:text-slate-500 mb-2" />
      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Ainda sem PATs guardados</h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
        Adiciona um PAT para o teu Azure DevOps ou TFS on-prem e podes reutilizá-lo em todas as migrações futuras
        sem voltar a colar.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)]"
      >
        <Plus className="w-4 h-4" />
        Adicionar o primeiro PAT
      </button>
    </div>
  )
}

function CredentialRow({ cred, onDeleted, onTested }) {
  const provider = classifyProvider(cred.host)
  const tone = providerToneClasses(provider.tone)
  const Icon = provider.isCloud ? Cloud : Server
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

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
        throw new Error(data?.error || 'Falhou a remoção')
      }
      onDeleted(cred.id)
    } catch (e) {
      alert(e.message)
      setDeleting(false)
      setConfirming(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch(`/api/azure/credentials/${cred.id}/test`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      })
      const data = await res.json()
      setTestResult(data)
      onTested?.(cred.id, data)
    } catch (e) {
      setTestResult({ valid: false, error: e.message })
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 6000)
    }
  }

  const patUrl = buildPatSettingsUrl(cred.host, cred.org || '_')
  const lastUsed = cred.lastUsedAt ? formatRelative(cred.lastUsedAt) : 'nunca usado'

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
          <div className="ds-text-meta text-slate-400 dark:text-slate-500 mt-0.5">
            Criado em {formatDate(cred.createdAt)} · {lastUsed}
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
            className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            title="Validar o token contra o servidor"
          >
            {testing
              ? <SpinnerIcon className="w-3.5 h-3.5" />
              : 'Testar'}
          </button>
          {patUrl && (
            <a
              href={patUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              title="Abrir página de PATs no servidor"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? '…' : 'Confirmar'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="p-1.5 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              title="Remover do vault local"
              aria-label="Remover credencial"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {testResult && (
        <div
          className={`px-4 py-2 text-xs border-t ${tone.border}
            ${testResult.valid
              ? 'bg-emerald-50/60 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50/60 dark:bg-red-900/15 text-red-700 dark:text-red-300'}`}
        >
          {testResult.valid
            ? <>✓ Token válido contra {cred.host}{testResult.resolvedOrg ? ` (org resolvida: ${testResult.resolvedOrg})` : ''}</>
            : <>✗ {testResult.error || 'Validação falhou'}</>}
        </div>
      )}
    </li>
  )
}

function AddCredentialForm({ onClose, onCreated }) {
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('')
  const [org, setOrg] = useState('')
  const [pat, setPat] = useState('')
  const [showPat, setShowPat] = useState(false)
  const [scopes, setScopes] = useState({ code: true, project: true, workItems: false, wiki: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const provider = classifyProvider(host)
  const tone = providerToneClasses(provider.tone)
  const patUrl = host && org ? buildPatSettingsUrl(host, org) : null
  const canSubmit = label.trim() && host.trim() && pat.trim().length >= 20

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (!canSubmit) return
    setSubmitting(true); setError('')
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
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      onCreated(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50/30 dark:bg-indigo-900/10 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <Plus className="w-4 h-4 text-indigo-500" />
          Novo PAT
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          Cancelar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nome (para reconheceres)">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex: Trigenius TFS · principal"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
            maxLength={60}
            required
          />
        </Field>

        <Field label="Host (sem https://)">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="dev.azure.com  ou  tfs.empresa.com"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono"
            required
          />
          {host && (
            <div className={`mt-1 ds-text-meta inline-flex items-center gap-1 ${tone.text}`}>
              {provider.isCloud ? <Cloud className="w-3 h-3" /> : <Server className="w-3 h-3" />}
              {provider.label}
            </div>
          )}
        </Field>

        <Field label="Organização / Collection (opcional)">
          <input
            type="text"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="ex: Trigenius  ou  tfs/DefaultCollection"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono"
          />
          <p className="ds-text-micro text-slate-500 mt-1">Permite o botão "Testar" e auto-match no wizard.</p>
        </Field>

        <Field label="Scopes (informativo)">
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: 'code', label: 'Code', required: true },
              { key: 'project', label: 'Project & Team', required: true },
              { key: 'workItems', label: 'Work Items' },
              { key: 'wiki', label: 'Wiki' },
            ].map((s) => (
              <label
                key={s.key}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border cursor-pointer transition-colors
                  ${scopes[s.key]
                    ? (s.required ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                  : 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700')
                    : 'border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-white dark:hover:bg-slate-800'}`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={scopes[s.key]}
                  onChange={(e) => setScopes((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                />
                <span className={`w-1.5 h-1.5 rounded-full ${scopes[s.key] ? (s.required ? 'bg-emerald-500' : 'bg-indigo-500') : 'bg-slate-300'}`} />
                {s.label}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <Field label="Personal Access Token">
        <div className="relative">
          <input
            type={showPat ? 'text' : 'password'}
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="Cola aqui o PAT gerado no servidor"
            className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono"
            required
          />
          <button
            type="button"
            onClick={() => setShowPat((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
          >
            {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {patUrl && (
          <a
            href={patUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 ds-text-meta text-indigo-500 hover:text-indigo-400"
          >
            Criar PAT em {host} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </Field>

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg bg-[color:var(--ds-accent-brand)] text-white hover:bg-[color:var(--ds-accent-brand-hover)] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
        >
          {submitting
            ? <><SpinnerIcon className="w-3.5 h-3.5" /> A guardar…</>
            : <><CheckCircle2 className="w-3.5 h-3.5" /> Guardar token encriptado</>}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</label>
      {children}
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

function formatRelative(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (days < 1) return 'usado hoje'
    if (days < 30) return `usado há ${days}d`
    if (days < 365) return `usado há ${Math.floor(days / 30)} meses`
    return `usado há ${Math.floor(days / 365)}+ anos`
  } catch { return iso }
}
