import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ToastContext } from './contexts'
import { trackBreadcrumb } from '../lib/observability'
import { formatUserError } from '../utils/errors'
import { emitAppEvent, onAppEvent, APP_EVENTS, navigateToPricing } from '../utils/appEvents'

function dispatchAction(action, ctx = {}) {
    if (!action) return
    switch (action.kind) {
        case 'retry':
            ctx.onRetry?.()
            break
        case 'reauth':
            window.location.href = '/api/auth/github'
            break
        case 'open-settings':
            emitAppEvent(APP_EVENTS.OPEN_SETTINGS, { tab: action.settingsTab })
            break
        case 'open-pricing':
            navigateToPricing()
            break
        case 'open-quota':
            emitAppEvent(APP_EVENTS.SHOW_QUOTA_EXCEEDED, ctx.detail || {})
            break
        default:
            ctx.onRetry?.()
    }
}

/**
 * Pull the structured quota fields off whatever error shape arrived.
 * AIQuotaExceededError carries them as own properties; a plain fetch failure
 * carries the server envelope under `body`/`data`. `quotaExceededResponse`
 * emits `current`, while the modal prop is named `used` — accept both.
 */
function quotaDetailFromError(err) {
    const body = err?.body || err?.data || {}
    const pick = (key, altKey) => err?.[key] ?? body[key] ?? (altKey ? body[altKey] : undefined)
    const detail = {
        feature: pick('feature'),
        limit: pick('limit'),
        used: pick('used', 'current'),
        resetAt: pick('resetAt'),
        upgradeTo: pick('upgradeTo'),
    }
    // Drop undefined so QuotaExceededState's own defaults still apply to
    // anything the server didn't send.
    return Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined && v !== null))
}

function ErrorToastContent({ formatted, ctx }) {
    return (
        <div className="space-y-1.5">
            <div className="font-semibold">{formatted.title}</div>
            <div className="text-sm opacity-90">{formatted.body}</div>
            {formatted.action && (
                <button
                    type="button"
                    onClick={() => dispatchAction(formatted.action, ctx)}
                    className="mt-1 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-white/30 dark:bg-white/10 hover:bg-white/40 dark:hover:bg-white/20 transition-colors"
                >
                    {formatted.action.label}
                </button>
            )}
        </div>
    )
}

const MAX_TOASTS = 5

/**
 * ToastProvider — owns the single shared toasts array.
 * Wrap the entire app so every component can fire toasts that reach
 * the one <ToastContainer> rendered in App.jsx.
 */
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])
    const timersRef = useRef(new Map())
    const idCounter = useRef(0)
    // Mirror toasts in a ref so dedupe can check synchronously without
    // waiting for React to flush the setToasts updater. Without this the
    // updater can run on a later tick, the dedupe check sees stale state,
    // and a duplicate slips through.
    const toastsRef = useRef([])
    useEffect(() => { toastsRef.current = toasts }, [toasts])

    // Clean up all timers on unmount
    useEffect(() => {
        const timers = timersRef.current
        return () => {
            timers.forEach(timer => clearTimeout(timer))
            timers.clear()
        }
    }, [])

    const dismissToast = useCallback((id) => {
        toastsRef.current = toastsRef.current.filter(t => t.id !== id)
        setToasts(toastsRef.current)
        const timer = timersRef.current.get(id)
        if (timer) {
            clearTimeout(timer)
            timersRef.current.delete(id)
        }
    }, [])

    const addToastRecord = useCallback((record) => {
        // Dedupe key: same type + same string message (or same dedupeKey for
        // ReactNode toasts). Repeated 401s used to stack three identical
        // "Session expired" cards on top of each other; ignore duplicates
        // already on screen. Use the ref so the check is synchronous.
        const key = record.dedupeKey || (typeof record.message === 'string' ? `${record.type}:${record.message}` : null)
        if (key && toastsRef.current.some(t => t.dedupeKey === key)) {
            return null
        }

        const id = ++idCounter.current
        const next = [...toastsRef.current, { id, ...record, dedupeKey: key }]
        if (next.length > MAX_TOASTS) {
            const removed = next.splice(0, next.length - MAX_TOASTS)
            removed.forEach(t => {
                const timer = timersRef.current.get(t.id)
                if (timer) {
                    clearTimeout(timer)
                    timersRef.current.delete(t.id)
                }
            })
        }
        toastsRef.current = next
        setToasts(next)

        if (record.duration > 0) {
            const timer = setTimeout(() => dismissToast(id), record.duration)
            timersRef.current.set(id, timer)
        }
        return id
    }, [dismissToast])

    // Backwards-compatible string-message adder.
    const addToast = useCallback((type, message, duration = 5000) => {
        return addToastRecord({ type, message, duration })
    }, [addToastRecord])

    const toast = useMemo(() => ({
        success: (msg, dur) => {
            // Every successful mutation fires a success toast — use that
            // as the boundary to drop a Sentry breadcrumb. When Sentry
            // isn't initialised this is a silent no-op.
            if (typeof msg === 'string' && msg.length > 0) {
                trackBreadcrumb('mutation', msg)
            }
            return addToast('success', msg, dur)
        },
        error:   (msg, dur) => addToast('error', msg, dur),
        info:    (msg, dur) => addToast('info', msg, dur),
        warning: (msg, dur) => addToast('warning', msg, dur),
        // Custom content adder — stores a ReactNode instead of a string message.
        custom:  ({ type = 'info', content, duration = 5000 }) =>
            addToastRecord({ type, content, duration }),
        // Uniform exception-to-toast helper. Routes the error through
        // formatUserError (no raw stack/message reaches the UI) and renders
        // a structured toast with an optional CTA. ctx.onRetry is invoked
        // when the action kind is 'retry'.
        errorFromException: (err, ctx = {}) => {
            const formatted = formatUserError(err, ctx)
            // Derive the quota detail from the error itself. Requiring every
            // callsite to thread `detail` through meant none of the ~98 of them
            // did, so the "See options" modal always opened with no numbers,
            // no reset date and — because QuotaUpgradeButton returns null
            // without `upgradeTo` — no upgrade button at the one moment the
            // product has to sell.
            const resolvedCtx = ctx.detail ? ctx : { ...ctx, detail: quotaDetailFromError(err) }
            return addToastRecord({
                type: 'error',
                content: <ErrorToastContent formatted={formatted} ctx={resolvedCtx} />,
                duration: ctx.duration ?? 7000,
                dedupeKey: `error:${formatted.title}|${formatted.body}`,
            })
        },
    }), [addToast, addToastRecord])

    // Bridge global unhandled errors (dispatched from main.jsx) to a friendly
    // toast. main.jsx already filters extension noise + benign browser noise,
    // so anything that lands here is a real app failure that escaped every
    // boundary. The toast offers a Reload button because by definition we're
    // in a state we don't know how to recover automatically.
    useEffect(() => {
        const handler = (event) => {
            const error = event.detail?.error
            const message = (error?.message || String(error || '')).slice(0, 240)
            // Dedupe key collapses storms (a runaway interval throwing every
            // tick) into one visible toast instead of MAX_TOASTS of the same.
            const dedupeKey = `unhandled:${message}`
            addToastRecord({
                type: 'error',
                duration: 0, // sticky — unhandled errors deserve user attention
                dedupeKey,
                content: (
                    <div className="space-y-1.5">
                        <div className="font-semibold">Something went wrong</div>
                        <div className="text-sm opacity-90">
                            {message || 'An unexpected error occurred outside the page boundary.'}
                        </div>
                        <div className="mt-2 flex gap-2">
                            <button
                                type="button"
                                onClick={() => window.location.reload()}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-white/30 dark:bg-white/10 hover:bg-white/40 dark:hover:bg-white/20 transition-colors"
                            >
                                Reload
                            </button>
                        </div>
                    </div>
                ),
            })
        }
        return onAppEvent(APP_EVENTS.UNHANDLED_ERROR, handler)
    }, [addToastRecord])

    const value = useMemo(
        () => ({ toasts, toast, dismissToast }),
        [toasts, toast, dismissToast]
    )

    return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

