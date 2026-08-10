import { RefreshCw, Terminal } from 'lucide-react'
import { AnimatedCopyIcon } from '../../../ui/AnimatedCopyIcon'
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
    <div className="rounded-2xl border border-brand-300 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-900/15 overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-brand-100/60 dark:bg-brand-900/30 border-b border-brand-200 dark:border-brand-800">
        <RefreshCw className="w-4 h-4 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]" />
        <span className="text-sm font-semibold text-brand-800 dark:text-brand-200">
          Backend needs a restart
        </span>
      </div>
      <div className="p-4 space-y-2.5">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          The server is rejecting <code className="px-1 rounded bg-brand-100 dark:bg-brand-900/40 ds-text-meta">{host}</code>{' '}
          because it resolves to a private IP — behavior fixed in newer code.
          This is the <strong>normal</strong> way an internal TFS works (corporate LAN), and your host
          is already on the allowlist.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            <strong>Fix:</strong> restart the backend to apply the change:
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
              aria-label="Copy command"
            >
              <AnimatedCopyIcon copied={copied} size="w-3.5 h-3.5" checkClassName="text-emerald-500" />
            </button>
          </div>
          <p className="ds-text-meta text-slate-500 dark:text-slate-400">
            Stop the server (<code>Ctrl+C</code>) and start it again. Then click
            {' '}<strong>Try again</strong> below.
          </p>
        </div>
      </div>
    </div>
  )
}
