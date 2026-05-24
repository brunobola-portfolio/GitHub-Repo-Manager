import { RefreshCw, Terminal, Copy, Check } from 'lucide-react'
import { useCopyToClipboard } from '../../../../hooks/useCopyToClipboard'

/**
 * Self-help banner for "stale backend" errors. Some validation failures
 * (notably the SSRF "non-public address" reject for allowlisted on-prem
 * hosts) were fixed in newer server code but persist for users running
 * an older `npm run dev` instance until they restart.
 *
 * We surface this banner inline ABOVE the validation error so the user
 * sees the actionable fix first, not the raw technical message.
 */
export default function RestartServerHint({ host }) {
  const { copied, copy: copyToClipboard } = useCopyToClipboard(1500)
  const cmd = 'npm run dev'

  const copy = () => { copyToClipboard(cmd) }

  return (
    <div className="rounded-2xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-900/15 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-indigo-100/60 dark:bg-indigo-900/30 border-b border-indigo-200 dark:border-indigo-800">
        <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
          Backend precisa de reiniciar
        </span>
      </div>
      <div className="p-4 space-y-2.5">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          O servidor está a rejeitar <code className="px-1 rounded bg-indigo-100 dark:bg-indigo-900/40 text-[11px]">{host}</code>{' '}
          por resolver para um IP privado — comportamento corrigido em código mais recente.
          Esta é a forma <strong>normal</strong> de um TFS interno funcionar (LAN corporativa) e o teu host
          já está autorizado na allowlist.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <strong>Solução:</strong> reinicia o backend para aplicar o fix:
          </p>
          <div className="flex items-stretch gap-1">
            <code className="flex-1 text-[12px] font-mono px-2.5 py-2 rounded-lg bg-slate-900 text-emerald-300 overflow-x-auto inline-flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 opacity-60" />
              {cmd}
            </code>
            <button
              type="button"
              onClick={copy}
              className="px-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              aria-label="Copiar comando"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Pára o servidor (<code>Ctrl+C</code>) e arranca de novo. Depois clica em
            {' '}<strong>Tentar de novo</strong> abaixo.
          </p>
        </div>
      </div>
    </div>
  )
}
