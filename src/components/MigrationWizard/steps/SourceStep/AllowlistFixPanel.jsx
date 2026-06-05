import { useState } from 'react'
import { ShieldAlert, ShieldCheck, Terminal, Sparkles, Lock } from 'lucide-react'
import { AnimatedCopyIcon } from '../../../ui/AnimatedCopyIcon'
import { SpinnerIcon } from '../../../ui/Spinner'
import { getCsrfToken } from '../../../../utils/api'

/**
 * Self-fix panel for "host not in ALLOWED_AZURE_HOSTS".
 *
 * Two paths:
 *   1. **Admins** see a big primary button "Adicionar agora" that writes to
 *      the DB allowlist via POST /api/azure/host-allowlist. Takes effect
 *      immediately — no .env edit, no restart.
 *   2. **Non-admins** see clear text "Pede ao teu admin" + the exact
 *      hostname to share (or copy-paste .env fallback for hands-on teams).
 */
export default function AllowlistFixPanel({
  host,
  currentPatterns = [],
  usingDefault = true,
  canEdit = false,
  onAdded,
}) {
  const [copied, setCopied] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState('')

  // Build the .env line for the "infra-as-code" fallback path. Always
  // includes defaults so users don't accidentally drop dev.azure.com.
  const defaultLine = ['dev.azure.com', '*.visualstudio.com']
  const merged = Array.from(new Set([
    ...(usingDefault ? defaultLine : currentPatterns),
    host,
  ].filter(Boolean)))
  const envLine = `ALLOWED_AZURE_HOSTS=${merged.join(',')}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(envLine)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }

  const addNow = async () => {
    setAdding(true); setError('')
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch('/api/azure/host-allowlist', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ pattern: host, notes: 'Added from migration wizard' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setAdded(true)
      onAdded?.(host)
    } catch (e) {
      setError(e.message || 'Falhou')
    } finally {
      setAdding(false)
    }
  }

  // Success state after one-click add
  if (added) {
    return (
      <div className="rounded-2xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-900/15 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <ShieldCheck className="w-4 h-4" />
          {host} foi adicionado à allowlist
        </div>
        <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-1">
          A alteração já está activa — sem reinício. Vou tentar validar de novo automaticamente.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/15 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-amber-100/60 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Servidor não autorizado pelo backend
        </span>
        <span className="ml-auto ds-text-micro uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
          {canEdit ? 'pode resolver com 1 clique' : 'pede ao teu admin'}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          O backend tem uma <strong>allowlist de hosts Azure</strong> (para prevenir SSRF). O servidor
          {' '}<code className="px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-mono ds-text-meta">{host}</code>{' '}
          ainda não está autorizado.
        </p>

        {canEdit ? (
          <AdminQuickFix
            host={host}
            adding={adding}
            error={error}
            onAdd={addNow}
            envLine={envLine}
            envCopied={copied}
            onEnvCopy={copy}
          />
        ) : (
          <NonAdminGuidance host={host} envLine={envLine} envCopied={copied} onEnvCopy={copy} />
        )}

        <div className="pt-2 border-t border-amber-200 dark:border-amber-800 ds-text-meta text-slate-500 dark:text-slate-400">
          <strong>Porque isto existe?</strong> Sem allowlist, alguém poderia abusar do servidor para fazer requests a
          hosts internos (SSRF). A lista define que servidores externos o backend é autorizado a contactar.
          Para wildcards usa <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">*.empresa.com</code>.
        </div>
      </div>
    </div>
  )
}

function AdminQuickFix({ host, adding, error, onAdd, envLine, envCopied, onEnvCopy }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-white/70 dark:bg-slate-900/40 border border-amber-200 dark:border-amber-800">
        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Adicionar à allowlist agora</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Guardado na base de dados · sem reinício necessário · auditado
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {adding
            ? <><SpinnerIcon className="w-3.5 h-3.5" /> A adicionar…</>
            : <><ShieldCheck className="w-3.5 h-3.5" /> Adicionar {host}</>}
        </button>
      </div>
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 px-1">
          ✗ {error}
        </div>
      )}

      {/* Alternative: env-var path, collapsible for power users */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          Alternativa: adicionar via <code>.env</code> (config-as-code)
        </summary>
        <EnvSnippet envLine={envLine} envCopied={envCopied} onEnvCopy={onEnvCopy} />
      </details>
    </div>
  )
}

function NonAdminGuidance({ host, envLine, envCopied, onEnvCopy }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-white/70 dark:bg-slate-900/40 border border-amber-200 dark:border-amber-800">
        <Lock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Precisas de um admin</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Apenas administradores podem adicionar servidores à allowlist. Partilha esta informação com o teu admin:
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="px-2 py-1 text-xs font-mono rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
              {host}
            </code>
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(host)
                } catch { /* ignore */ }
              }}
              className="ds-text-meta text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
            >
              copiar host
            </button>
          </div>
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          Instruções para o admin (alternativa via <code>.env</code>)
        </summary>
        <EnvSnippet envLine={envLine} envCopied={envCopied} onEnvCopy={onEnvCopy} />
      </details>
    </div>
  )
}

function EnvSnippet({ envLine, envCopied, onEnvCopy }) {
  return (
    <div className="mt-2 space-y-2">
      <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        <li>1. Edita <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">server/.env</code></li>
        <li>2. Adiciona (ou substitui) esta linha:</li>
      </ol>
      <div className="flex items-stretch gap-1">
        <code className="flex-1 ds-text-meta font-mono px-2.5 py-2 rounded-lg bg-slate-900 text-emerald-300 overflow-x-auto whitespace-nowrap">
          {envLine}
        </code>
        <button
          type="button"
          onClick={onEnvCopy}
          className="px-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
          aria-label="Copiar linha"
        >
          <AnimatedCopyIcon copied={envCopied} size="w-3.5 h-3.5" checkClassName="text-emerald-500" />
        </button>
      </div>
      <p className="ds-text-meta text-slate-500 dark:text-slate-400">
        3. Reinicia o servidor (<code className="px-1 rounded bg-slate-200 dark:bg-slate-700">npm run dev</code>)
      </p>
    </div>
  )
}
