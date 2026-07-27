import { InsightCard } from '../../ui/InsightCard'
import { Zap, ExternalLink } from 'lucide-react'
import { AnimatedCopyIcon } from '../../ui/AnimatedCopyIcon'
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard'

const WEBHOOK_PATH = '/api/v1/webhooks/github'
// Canonical, browser-reachable GitHub webhook docs. Exported so other
// onboarding surfaces (e.g. the Work Board empty state) link to the same
// place instead of a non-served in-repo markdown path.
export const DOCS_URL = 'https://docs.github.com/en/developers/webhooks-and-events/webhooks/creating-webhooks'

// No tier prop by design: POST /api/v1/webhooks/github is mounted with
// signature verification and no tier gate, so live updates work on every tier.
// This panel previously showed a Pro badge and hid the setup link from Free
// users — a paywall over shipped functionality.
export function WebhookConnectPanel() {
    const { copied, copy } = useCopyToClipboard()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const fullUrl = `${origin}${WEBHOOK_PATH}`

    const handleCopy = () => { copy(fullUrl) }

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Live updates via webhook</p>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Configure a webhook in your GitHub org/repo to get real-time updates. Unknown repos auto-track.
                </p>

                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800/60 font-mono text-xs">
                    <code className="flex-1 truncate text-slate-700 dark:text-slate-300">{fullUrl}</code>
                    <button
                        type="button"
                        onClick={handleCopy}
                        aria-label="Copy webhook URL"
                        className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                        <AnimatedCopyIcon copied={copied} size="w-3.5 h-3.5" copyClassName="text-slate-500" checkClassName="text-emerald-500" />
                    </button>
                </div>

                <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline"
                >
                    Setup instructions <ExternalLink className="w-3 h-3" />
                </a>
            </div>
        </InsightCard>
    )
}
