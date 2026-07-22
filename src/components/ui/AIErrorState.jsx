import { useMemo } from 'react'
import { AlertCircle, Settings, Crown, RotateCcw, X } from 'lucide-react'
import { formatUserError } from '../../utils/errors'
import { openAppSettings, openBilling } from '../../utils/appEvents'

/**
 * Reusable error display for any AI surface. Drives the action button from
 * the error code's mapped action `type` so every AI failure ends up on the
 * same UX pattern: icon + title + body + 1 primary CTA.
 *
 * The error vocabulary is owned by `formatUserError` in `utils/errors.js` —
 * keep all known server codes in that table so this component stays a thin
 * presentational wrapper.
 *
 * @param {object}   props
 * @param {Error|object|null} props.error    Raw fetch/exception error (with `.code`/`.status`)
 * @param {Function} [props.onRetry]         When set, shows a Retry button
 * @param {Function} [props.onDismiss]       When set, shows an X dismiss button
 * @param {string}   [props.context]         Short context label (e.g. 'PR review')
 * @param {'banner'|'card'|'inline'} [props.variant]  Visual density (default 'card')
 * @param {string}   [props.className]       Extra classes appended to the container
 */
export function AIErrorState({ error, onRetry, onDismiss, context, variant = 'card', className = '' }) {
    // Memoize by error identity. Parent re-renders are frequent on AI surfaces
    // (toast bus, polling hooks); formatting on every render would re-trigger
    // the deduped warning and waste work.
    const formatted = useMemo(() => (error ? formatUserError(error) : null), [error])
    if (!formatted) return null
    const action = formatted.action

    const handleAction = () => {
        switch (action?.type) {
            case 'retry':
                onRetry?.()
                break
            case 'configure':
                openAppSettings(action.settingsTab || 'ai')
                break
            case 'upgrade':
                openBilling()
                break
            case 'dismiss':
                onDismiss?.()
                break
            default:
                onRetry?.()
        }
    }

    const ActionIcon =
        action?.type === 'configure' ? Settings :
        action?.type === 'upgrade' ? Crown :
        RotateCcw

    // When the primary action is Retry on an AI-flavoured error, also expose
    // an "Open AI Settings" secondary CTA — most retry loops fail because the
    // underlying provider is misconfigured (rate-limited free tier, invalid
    // key) and the operator can't know that without inspecting Settings.
    const isAIError = typeof formatted.code === 'string' && (
        formatted.code.startsWith('AI_')
            || formatted.code === 'INVALID_API_KEY'
            || formatted.code === 'NO_AI_PROVIDER'
            || formatted.code === 'MODEL_NOT_FOUND'
            || formatted.code === 'PROVIDER_LOOKUP_FAILED'
            || formatted.code === 'QUOTA_EXCEEDED'
            || formatted.code === 'RATE_LIMITED'
    )
    const showSettingsHelper = action?.type === 'retry' && isAIError

    const containerClass = (
        variant === 'banner'
            ? 'flex items-start gap-3 px-4 py-3 border-b border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/40'
            : variant === 'inline'
                ? 'flex items-start gap-2 px-3 py-2 text-xs rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                : 'flex items-start gap-3 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/40'
    ) + (className ? ` ${className}` : '')

    return (
        <div role="alert" aria-live="polite" className={containerClass}>
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden />
            <div className="flex-1 min-w-0 text-sm">
                <div className="font-medium text-amber-900 dark:text-amber-100">
                    {formatted.title}
                    {context ? <span className="opacity-60"> · {context}</span> : null}
                </div>
                {formatted.body ? (
                    <div className="text-xs text-amber-800 dark:text-amber-200/80 mt-0.5">
                        {formatted.body}
                    </div>
                ) : null}
                {(action || onRetry) ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handleAction}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 ds-focus-ring"
                        >
                            <ActionIcon className="w-3.5 h-3.5" aria-hidden />
                            {action?.label ?? 'Retry'}
                        </button>
                        {onRetry && action?.type !== 'retry' ? (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 ds-focus-ring"
                            >
                                <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Retry
                            </button>
                        ) : null}
                        {showSettingsHelper ? (
                            <button
                                type="button"
                                onClick={() => openAppSettings('ai')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-900 dark:text-amber-100 ds-focus-ring"
                            >
                                <Settings className="w-3.5 h-3.5" aria-hidden /> AI settings
                            </button>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {onDismiss ? (
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    className="opacity-60 hover:opacity-100 ds-focus-ring"
                >
                    <X className="w-4 h-4" aria-hidden />
                </button>
            ) : null}
        </div>
    )
}
