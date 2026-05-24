import { InsightCard } from '../../ui/InsightCard'
import { Zap, Copy, ExternalLink, Check } from 'lucide-react'
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard'

const WEBHOOK_PATH = '/api/v1/webhooks/github'
const DOCS_URL = 'https://docs.github.com/en/developers/webhooks-and-events/webhooks/creating-webhooks'

export function WebhookConnectPanel({ tier }) {
    const { copied, copy } = useCopyToClipboard()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const fullUrl = `${origin}${WEBHOOK_PATH}`

    const handleCopy = () => { copy(fullUrl) }

    const isProPlus = tier === 'pro' || tier === 'enterprise'

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Live updates via webhook</p>
                    {!isProPlus && <span className="ml-auto px-2 py-0.5 ds-text-micro font-semibold uppercase tracking-wider rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Pro</span>}
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                    {isProPlus
                        ? 'Configure a webhook in your GitHub org/repo to get real-time updates. Unknown repos auto-track.'
                        : 'Enable live webhook-driven updates on Pro. API polling still works for free.'}
                </p>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 font-mono text-xs">
                    <code className="flex-1 truncate text-slate-700 dark:text-slate-300">{fullUrl}</code>
                    <button
                        type="button"
                        onClick={handleCopy}
                        aria-label="Copy webhook URL"
                        className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                    </button>
                </div>

                {isProPlus ? (
                    <a
                        href={DOCS_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        Setup instructions <ExternalLink className="w-3 h-3" />
                    </a>
                ) : (
                    <a
                        href="/pricing"
                        className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                    >
                        Upgrade to Pro →
                    </a>
                )}
            </div>
        </InsightCard>
    )
}
