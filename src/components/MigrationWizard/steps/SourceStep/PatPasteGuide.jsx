import { useState } from 'react'
import { ExternalLink, Copy, Check, Terminal, Eye, EyeOff, Lock, AlertTriangle, Bookmark } from 'lucide-react'
import { SpinnerIcon } from '../../../ui/Spinner'
import { buildPatSettingsUrl, buildAzCliCommand, classifyProvider } from '../../../../utils/azureProvider'
import { Input } from '../../../ui/form'
import { getCsrfToken } from '../../../../utils/api'
import SavedCredentialsPicker from './SavedCredentialsPicker'

/**
 * Step-by-step PAT setup, host-aware. Replaces the previous free-form
 * paste field + scattered links with a single guided flow that adapts
 * to the detected provider (cloud / on-prem TFS) and includes:
 *
 *   1. A primary CTA to open the right "Create PAT" page on the user's
 *      actual server (not always dev.azure.com).
 *   2. The exact scopes required, copy-friendly.
 *   3. The paste field, prominent and labelled.
 *   4. A collapsible CLI alternative for when the user prefers `az`.
 */
export default function PatPasteGuide({ source, onChange, showPat, setShowPat }) {
  // No silent fallback — if we don't know the host, the user must paste
  // a URL first. A wrong "Create PAT" link is worse than no link at all
  // because PATs created on host A do NOT work against host B.
  const host = source.host || ''
  const org = source.org || ''
  const provider = classifyProvider(host)
  const patUrl = buildPatSettingsUrl(host, org)
  const cliCmd = buildAzCliCommand(host, org)
  const hasContext = Boolean(host && org)
  const [openedAt, setOpenedAt] = useState(null)
  const [savingPat, setSavingPat] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [savedJustNow, setSavedJustNow] = useState(false)
  const [saveError, setSaveError] = useState('')

  const handleOpenPat = () => {
    if (patUrl) {
      window.open(patUrl, '_blank', 'noopener,noreferrer')
      setOpenedAt(Date.now())
    }
  }

  // "Use this token next time" — store the pasted PAT in the vault so the
  // user doesn't have to re-paste on future sessions. Fires only when the
  // user explicitly opts in via the checkbox below the input.
  const handleSaveForLater = async () => {
    if (!source.pat?.trim() || !host) return
    setSavingPat(true); setSaveError('')
    try {
      const csrf = await getCsrfToken().catch(() => null)
      const res = await fetch('/api/azure/credentials', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({
          label: saveLabel.trim() || `${host}${org ? ` · ${org}` : ''}`,
          host, org: org || null, pat: source.pat,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Falha ao guardar')
      setSavedJustNow(true)
      // After saving, transparently switch to using the saved credential so
      // subsequent calls don't carry the raw PAT around.
      onChange({ savedCredentialId: data.id })
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSavingPat(false)
    }
  }

  // When user picks a saved credential, clear any pasted PAT and store the id.
  const pickSaved = (id) => {
    if (id) {
      onChange({ savedCredentialId: id, pat: '', validated: false })
    } else {
      onChange({ savedCredentialId: null, validated: false })
    }
    setSavedJustNow(false)
  }

  const usingSaved = !!source.savedCredentialId

  return (
    <div className="space-y-3">
      {/* Saved credentials picker — only renders when user has tokens
          stored for this host. One-click reuse from the vault. */}
      <SavedCredentialsPicker
        host={host}
        org={org}
        value={source.savedCredentialId || null}
        onPick={pickSaved}
        onOpenSettings={() => {
          // App listens for this custom event and opens the Settings modal
          // at the requested tab — same plumbing used by CommandPalette
          // and other deep-link sites (see App.jsx:382).
          window.dispatchEvent(new CustomEvent('app:open-settings', {
            detail: { tab: 'azure-credentials' },
          }))
        }}
      />

      {/* Critical warning: PATs are server-specific. If the user has a token
          from a different server, it WILL fail authentication here. */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
        <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div>
          <strong>O PAT é específico do servidor.</strong> Um token criado em
          {' '}<code className="px-1 rounded bg-amber-100 dark:bg-amber-900/40">dev.azure.com</code> {' '}
          <em>não</em> funciona em
          {' '}<code className="px-1 rounded bg-amber-100 dark:bg-amber-900/40">tfs.empresa.com</code>{' '}
          (e vice-versa). Cria-o sempre {hasContext ? <>no servidor que te indicamos abaixo (<strong>{host}</strong>).</> : 'no servidor onde está o teu repo.'}
        </div>
      </div>

      {/* Steps 1-3 hidden when using a saved credential — the user is done. */}
      {!usingSaved && (
      <>
      {/* Step 1 — open the PAT generation page (provider-aware) */}
      <Step
        n={1}
        title="Abre a página de criação de PAT"
        subtitle={
          hasContext
            ? <>No teu servidor <code className="px-1 rounded bg-slate-100 dark:bg-slate-800 ds-text-meta">{host}</code> · org <code className="px-1 rounded bg-slate-100 dark:bg-slate-800 ds-text-meta">{org}</code></>
            : <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                Cola primeiro a URL Azure DevOps / TFS acima — sem isso não sabemos para que servidor criar o PAT
              </span>
        }
      >
        <button
          type="button"
          onClick={handleOpenPat}
          disabled={!hasContext}
          title={hasContext ? `Abre ${patUrl}` : 'Cola uma URL primeiro'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed disabled:hover:bg-slate-300 transition-colors shadow-sm"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {openedAt ? 'Reabrir página de PAT' : hasContext ? `Abrir PAT em ${provider.shortName}` : 'Cola URL primeiro'}
        </button>
        {hasContext && (
          <p className="ds-text-meta text-slate-500 dark:text-slate-400 mt-1.5 font-mono break-all">
            {patUrl}
          </p>
        )}
      </Step>

      {/* Step 2 — scopes (compact list, easy to scan) */}
      <Step
        n={2}
        title="Selecciona estes scopes"
        subtitle="Mínimo para listar projectos e clonar repos."
      >
        <ScopeChips
          required={['Code (Read)', 'Project & Team (Read)']}
          recommended={['Work Items (Read)', 'Wiki (Read)']}
          tfvc={!provider.isCloud ? ['Identity (Read)'] : []}
        />
      </Step>

      {/* Step 3 — paste (the main action; large input) */}
      <Step
        n={3}
        title="Cola o token aqui"
        subtitle="Fica apenas nesta sessão do browser — nunca é enviado para o servidor além do necessário para validar."
        highlight
      >
        <Input
          type={showPat ? 'text' : 'password'}
          value={source.pat || ''}
          onChange={(e) => {
            onChange({ pat: e.target.value, validated: false, savedCredentialId: null })
            setSavedJustNow(false)
          }}
          placeholder={openedAt ? 'Cola o PAT que acabaste de gerar…' : 'Cola aqui o Personal Access Token'}
          aria-label="Personal Access Token"
          autoFocus={!!openedAt}
          trailing={
            <button
              type="button"
              onClick={() => setShowPat((v) => !v)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              aria-label={showPat ? 'Esconder PAT' : 'Mostrar PAT'}
            >
              {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
        />
        {/* Inline "save for next time" CTA — appears once a PAT looks
            substantial enough to be a real token. Saving encrypts it in the
            DB vault so the user never has to re-paste this PAT. */}
        {source.pat?.trim().length >= 20 && hasContext && !savedJustNow && (
          <div className="mt-2 flex items-stretch gap-2 px-3 py-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800">
            <Bookmark className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
                Guardar para futuras sessões?
              </div>
              <div className="ds-text-meta text-emerald-700/80 dark:text-emerald-300/80">
                Encripta este PAT na base de dados — só tu o consegues usar e nunca volta para o browser.
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={saveLabel}
                  onChange={(e) => setSaveLabel(e.target.value)}
                  placeholder={`${host}${org ? ` · ${org}` : ''}`}
                  maxLength={60}
                  className="flex-1 px-2 py-1 text-xs rounded-md border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800"
                />
                <button
                  type="button"
                  onClick={handleSaveForLater}
                  disabled={savingPat}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors"
                >
                  {savingPat
                    ? <><SpinnerIcon className="w-3 h-3" /> A guardar</>
                    : <><Bookmark className="w-3 h-3" /> Guardar</>}
                </button>
              </div>
              {saveError && <div className="ds-text-meta text-red-600 dark:text-red-400 mt-1">✗ {saveError}</div>}
            </div>
          </div>
        )}
        {savedJustNow && (
          <div className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-100/60 dark:bg-emerald-900/30 text-xs text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            PAT guardado · podes geri-lo em Settings → Azure Credentials
          </div>
        )}
      </Step>

      {/* CLI alternative — collapsed by default, only shown when we have
          enough context to render a real command (host + org). */}
      {cliCmd && hasContext && (
        <CliAlternative cmd={cliCmd} />
      )}
      </>
      )}
    </div>
  )
}

function Step({ n, title, subtitle, children, highlight = false }) {
  return (
    <div
      className={`flex gap-3 ${highlight ? 'p-3 rounded-xl bg-indigo-50/40 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800' : ''}`}
    >
      <div
        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ds-text-meta font-bold mt-0.5
          ${highlight
            ? 'bg-indigo-500 text-white'
            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
      >
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</div>
        {subtitle && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</div>}
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}

function ScopeChips({ required = [], recommended = [], tfvc = [] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {required.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
          title="Obrigatório"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {s}
        </span>
      ))}
      {recommended.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
          title="Recomendado para migração completa"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          {s}
        </span>
      ))}
      {tfvc.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800"
          title="Útil em TFS on-prem"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          {s}
        </span>
      ))}
    </div>
  )
}

function CliAlternative({ cmd }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5">
        <Terminal className="w-3.5 h-3.5" />
        Alternativa por CLI (<code className="ds-text-meta">az devops</code>)
      </summary>
      <div className="mt-2 flex items-stretch gap-1">
        <code className="flex-1 ds-text-meta font-mono px-2 py-1.5 rounded-lg bg-slate-900 text-slate-200 overflow-x-auto whitespace-nowrap">
          {cmd}
        </code>
        <button
          type="button"
          onClick={copy}
          className="px-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          aria-label="Copiar comando"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="ds-text-micro text-slate-400 dark:text-slate-500 mt-1">
        Requer <code>az</code> + extensão <code>azure-devops</code>. Cola depois o token devolvido no campo acima.
      </p>
    </details>
  )
}
