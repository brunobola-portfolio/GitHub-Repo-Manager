import { useState, useEffect, useRef } from 'react'
import { ShieldAlert, ShieldCheck, Terminal, Sparkles, Lock } from 'lucide-react'
import { AnimatedCopyIcon } from './AnimatedCopyIcon'
import { SpinnerIcon } from './Spinner'
import { getCsrfToken } from '../../utils/api'

/**
 * Self-fix panel for "host not in ALLOWED_AZURE_HOSTS".
 *
 * Two paths:
 *   1. **Admins** see a big primary button "Add now" that writes to
 *      the DB allowlist via POST /api/azure/host-allowlist. Takes effect
 *      immediately — no .env edit, no restart.
 *   2. **Non-admins** see clear text "Ask your admin" + the exact
 *      hostname to share (or copy-paste .env fallback for hands-on teams).
 */
export default function AllowlistFixPanel({
  host,
  currentPatterns = [],
  usingDefault = true,
  canEdit = false,
  notes = 'Added from migration wizard',
  onAdded,
}) {
  const [copied, setCopied] = useState(false)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState('')

  // Build the .env line for the "infra-as-code" fallback path. We can only
  // print a complete `ALLOWED_AZURE_HOSTS=` replacement when we actually know
  // the full current set: either defaults are in effect, or we were handed
  // the patterns (admin). For non-admins the patterns list is intentionally
  // gated to [] server-side — printing a replacement line from an empty list
  // would silently DROP every other configured host when applied verbatim.
  // In that case we emit an append-style instruction instead.
  const defaultLine = ['dev.azure.com', '*.visualstudio.com']
  const patternsKnown = usingDefault || currentPatterns.length > 0
  const merged = Array.from(new Set([
    ...(usingDefault ? defaultLine : currentPatterns),
    host,
  ].filter(Boolean)))
  const envLine = patternsKnown
    ? `ALLOWED_AZURE_HOSTS=${merged.join(',')}`
    : host
  const copyValue = envLine

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue)
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
        body: JSON.stringify({ pattern: host, notes }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setAdded(true)
      onAdded?.(host)
    } catch (e) {
      setError(e.message || 'Failed')
    } finally {
      setAdding(false)
    }
  }

  // Success state after one-click add
  if (added) {
    return <SuccessState host={host} />
  }

  return (
    <div className="rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/15 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-amber-100/60 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          Server not authorized by the backend
        </span>
        <span className="ml-auto ds-text-micro uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
          {canEdit ? 'fixable in 1 click' : 'ask your admin'}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          The backend keeps an <strong>Azure host allowlist</strong> (to prevent SSRF). The server
          {' '}<code className="px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-mono ds-text-meta">{host}</code>{' '}
          isn't authorized yet.
        </p>

        {canEdit ? (
          <AdminQuickFix
            host={host}
            adding={adding}
            error={error}
            onAdd={addNow}
            envLine={envLine}
            patternsKnown={patternsKnown}
            envCopied={copied}
            onEnvCopy={copy}
          />
        ) : (
          <NonAdminGuidance host={host} envLine={envLine} patternsKnown={patternsKnown} envCopied={copied} onEnvCopy={copy} />
        )}

        <div className="pt-2 border-t border-amber-200 dark:border-amber-800 ds-text-meta text-slate-500 dark:text-slate-400">
          <strong>Why does this exist?</strong> Without an allowlist, someone could abuse the server to make requests to
          internal hosts (SSRF). The list defines which external servers the backend is allowed to contact.
          For wildcards use <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">*.company.com</code>.
        </div>
      </div>
    </div>
  )
}

/**
 * Replaces the whole panel after the 1-click add. The subtree the user was
 * focused in unmounts, so move focus here and announce via role="status" —
 * otherwise keyboard/SR users are dropped at <body> with no feedback.
 */
function SuccessState({ host }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className="rounded-2xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-900/15 px-4 py-3 outline-none"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="w-4 h-4" />
        {host} was added to the allowlist
      </div>
      <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-1">
        The change is already active — no restart. I'll try to validate again automatically.
      </p>
    </div>
  )
}

function AdminQuickFix({ host, adding, error, onAdd, envLine, patternsKnown, envCopied, onEnvCopy }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-white/70 dark:bg-slate-900/40 border border-amber-200 dark:border-amber-800">
        <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Add to allowlist now</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Saved to the database · no restart needed · audited
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {adding
            ? <><SpinnerIcon className="w-3.5 h-3.5" /> Adding…</>
            : <><ShieldCheck className="w-3.5 h-3.5" /> Add {host}</>}
        </button>
      </div>
      {error && (
        <div role="alert" className="text-xs text-red-600 dark:text-red-400 px-1">
          ✗ {error}
        </div>
      )}

      {/* Alternative: env-var path, collapsible for power users */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          Alternative: add via <code>.env</code> (config-as-code)
        </summary>
        <EnvSnippet envLine={envLine} host={host} patternsKnown={patternsKnown} envCopied={envCopied} onEnvCopy={onEnvCopy} />
      </details>
    </div>
  )
}

function NonAdminGuidance({ host, envLine, patternsKnown, envCopied, onEnvCopy }) {
  const [hostCopied, setHostCopied] = useState(false)
  const copyHost = async () => {
    try {
      await navigator.clipboard.writeText(host)
      setHostCopied(true)
      setTimeout(() => setHostCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 px-3.5 py-3 rounded-xl bg-white/70 dark:bg-slate-900/40 border border-amber-200 dark:border-amber-800">
        <Lock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">You need an admin</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Only admins can add servers to the allowlist. Share this information with your admin:
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="px-2 py-1 text-xs font-mono rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
              {host}
            </code>
            <button
              type="button"
              onClick={copyHost}
              className="inline-flex items-center gap-1 ds-text-meta text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
            >
              <AnimatedCopyIcon copied={hostCopied} size="w-3 h-3" checkClassName="text-emerald-500" />
              {hostCopied ? 'copied' : 'copy host'}
            </button>
            <span className="sr-only" role="status">{hostCopied ? 'Host copied to clipboard' : ''}</span>
          </div>
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          Instructions for the admin (alternative via <code>.env</code>)
        </summary>
        <EnvSnippet envLine={envLine} host={host} patternsKnown={patternsKnown} envCopied={envCopied} onEnvCopy={onEnvCopy} />
      </details>
    </div>
  )
}

function EnvSnippet({ envLine, host, patternsKnown, envCopied, onEnvCopy }) {
  // When we don't know the full current allowlist (non-admin: the patterns
  // are gated server-side), DON'T present a complete replacement line — it
  // would wipe every other configured host. Tell the admin to append instead.
  return (
    <div className="mt-2 space-y-2">
      <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
        <li>1. Edit <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">server/.env</code></li>
        <li>
          {patternsKnown
            ? '2. Add (or replace) this line:'
            : <>2. Add <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">{host}</code> to the existing <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">ALLOWED_AZURE_HOSTS</code> (comma-separated) — don't drop the current entries:</>}
        </li>
      </ol>
      <div className="flex items-stretch gap-1">
        <code className="flex-1 ds-text-meta font-mono px-2.5 py-2 rounded-lg bg-slate-900 text-emerald-300 overflow-x-auto whitespace-nowrap">
          {patternsKnown ? envLine : host}
        </code>
        <button
          type="button"
          onClick={onEnvCopy}
          className="px-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
          aria-label={patternsKnown ? 'Copy line' : 'Copy host'}
        >
          <AnimatedCopyIcon copied={envCopied} size="w-3.5 h-3.5" checkClassName="text-emerald-500" />
        </button>
      </div>
      <p className="ds-text-meta text-slate-500 dark:text-slate-400">
        3. Restart the server (<code className="px-1 rounded bg-slate-200 dark:bg-slate-700">npm run dev</code>)
      </p>
    </div>
  )
}
