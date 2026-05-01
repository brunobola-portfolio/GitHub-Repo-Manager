import { Info, AlertTriangle } from 'lucide-react'
import { useAIStatus } from '../../hooks/useAIStatus'
import { useModal } from '../../hooks/useModal'

/**
 * Inline banner shown above an AI surface when AI is not configured or the
 * configured key is failing. Renders nothing when AI is healthy, so callers
 * can drop it in unconditionally without flicker.
 *
 * Props:
 *   heuristicAvailable  whether the surface can still produce useful output
 *                       without AI (toned down to a soft "info" message).
 *   compact             single-line variant (used inside cards where space
 *                       is tight).
 */
export function AIUnavailableBanner({ heuristicAvailable = false, compact = false }) {
    const status = useAIStatus()
    const { openModalWithData } = useModal()
    if (status.loading) return null
    const aiOff = !status.configured
    const keyInvalid = status.keyInvalid
    if (!aiOff && !keyInvalid) return null

    const tone = keyInvalid
        ? 'border-red-200/70 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
        : heuristicAvailable
            ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300'
            : 'border-amber-200/70 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400'

    const Icon = keyInvalid ? AlertTriangle : Info

    const message = keyInvalid
        ? 'The configured AI provider key is failing authentication. Update it in Settings → AI Configuration.'
        : heuristicAvailable
            ? 'AI is not configured — running on the deterministic fallback. Configure AI for smarter output.'
            : 'AI is not configured. Configure a provider in Settings → AI Configuration to enable this feature.'

    return (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone} ${compact ? 'items-center' : ''}`}>
            <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div className="flex-1">
                {message}
            </div>
            <button
                type="button"
                onClick={() => openModalWithData('showSettings', { initialTab: 'ai' })}
                className="font-medium underline-offset-2 hover:underline shrink-0"
            >
                Configure
            </button>
        </div>
    )
}
