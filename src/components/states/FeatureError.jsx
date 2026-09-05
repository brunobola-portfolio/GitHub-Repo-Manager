import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, RefreshCw, Clock, Info, WifiOff } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import { DURATION } from '../ui/motion'

const TONES = {
    error: {
        icon: AlertTriangle,
        ring: 'border-rose-200 dark:border-rose-500/30',
        surface: 'bg-rose-50/70 dark:bg-rose-500/10',
        title: 'text-rose-900 dark:text-rose-200',
        body: 'text-rose-800/80 dark:text-rose-200/80',
        accent: 'text-rose-600 dark:text-rose-400',
        chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/20',
    },
    warn: {
        icon: Clock,
        ring: 'border-amber-200 dark:border-amber-500/25',
        surface: 'bg-amber-50/70 dark:bg-amber-500/10',
        title: 'text-amber-900 dark:text-amber-200',
        body: 'text-amber-800/80 dark:text-amber-200/80',
        accent: 'text-amber-700 dark:text-amber-400',
        chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20',
    },
    info: {
        icon: Info,
        ring: 'border-brand-200 dark:border-brand-500/25',
        surface: 'bg-brand-50/70 dark:bg-brand-500/10',
        title: 'text-brand-900 dark:text-brand-200',
        body: 'text-brand-800/80 dark:text-brand-200/80',
        accent: 'text-brand-600 dark:text-brand-400',
        chip: 'bg-brand-500/15 text-brand-700 dark:text-brand-300 border-brand-500/20',
    },
    offline: {
        icon: WifiOff,
        ring: 'border-slate-200 dark:border-slate-700/60',
        surface: 'bg-slate-50/70 dark:bg-slate-800/40',
        title: 'text-slate-900 dark:text-slate-100',
        body: 'text-slate-600 dark:text-slate-400',
        accent: 'text-slate-500 dark:text-slate-400',
        chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/20',
    },
}

/**
 * Generic recoverable-error surface.
 *
 *   <FeatureError tone="warn" title="Too many requests"
 *                 hint="Try again in a few seconds." retryAfterSec={45}
 *                 onRetry={refetch} />
 *
 * tone:
 *   - error    — irrecoverable from the user's POV (red)
 *   - warn     — temporary, retry-friendly (amber); used for 429 / timeouts
 *   - info     — informational (sky)
 *   - offline  — network unavailable (slate)
 *
 * variant: card (default) | inline
 */
export function FeatureError({
    tone = 'error',
    title,
    hint,
    onRetry,
    retryAfterSec,
    variant = 'card',
    className,
    children,
}) {
    const palette = TONES[tone] ?? TONES.error
    const Icon = palette.icon
    const remaining = useCountdown(retryAfterSec)

    const canRetry = typeof onRetry === 'function' && (!remaining || remaining <= 0)

    if (variant === 'inline') {
        return (
            <div
                role="alert"
                className={twMerge(
                    'flex items-start gap-2.5 px-3 py-2 rounded-lg border text-xs',
                    palette.surface, palette.ring,
                    className
                )}
            >
                <Icon className={twMerge('w-4 h-4 shrink-0 mt-0.5', palette.accent)} />
                <div className="min-w-0 flex-1">
                    {title && <p className={twMerge('font-semibold', palette.title)}>{title}</p>}
                    {hint && <p className={twMerge('mt-0.5', palette.body)}>{hint}</p>}
                    {children}
                </div>
                {onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        disabled={!canRetry}
                        className={twMerge(
                            'inline-flex items-center gap-1 px-2 py-1 rounded-md ds-text-meta font-semibold ds-focus-ring',
                            'border transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                            palette.chip
                        )}
                    >
                        <RefreshCw className="w-3 h-3" />
                        {remaining > 0 ? `${remaining}s` : 'Retry'}
                    </button>
                )}
            </div>
        )
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.slow }}
            role="alert"
            className={twMerge(
                'relative overflow-hidden rounded-2xl border',
                'px-5 py-5 sm:px-6',
                'flex items-start gap-4',
                palette.surface, palette.ring,
                className
            )}
        >
            <span className={twMerge(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                palette.chip
            )}>
                <Icon className={twMerge('w-5 h-5', palette.accent)} />
            </span>

            <div className="min-w-0 flex-1">
                {title && (
                    <p className={twMerge('text-sm font-semibold', palette.title)}>
                        {title}
                    </p>
                )}
                {hint && (
                    <p className={twMerge('text-xs mt-1 leading-relaxed', palette.body)}>
                        {hint}
                    </p>
                )}
                {children && <div className="mt-2">{children}</div>}

                {onRetry && (
                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onRetry}
                            disabled={!canRetry}
                            className={twMerge(
                                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold',
                                'border transition-colors ds-focus-ring',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                                palette.chip
                            )}
                        >
                            <RefreshCw className={twMerge('w-3.5 h-3.5', remaining > 0 ? 'animate-pulse' : '')} />
                            {remaining > 0 ? `Retry in ${formatSeconds(remaining)}` : 'Try again'}
                        </button>
                    </div>
                )}
            </div>
        </motion.div>
    )
}

function useCountdown(initial) {
    const deadline = Number.isFinite(initial) && initial > 0
        ? Math.ceil(initial)
        : 0

    const [remaining, setRemaining] = useState(deadline)
    // "Reset state when a prop changes" — the documented React idiom uses a
    // mirrored useState (not useRef) so the comparison happens during render
    // without violating the no-refs-during-render rule.
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const [lastDeadline, setLastDeadline] = useState(deadline)
    if (deadline !== lastDeadline) {
        setLastDeadline(deadline)
        setRemaining(deadline)
    }

    useEffect(() => {
        if (deadline <= 0) return undefined
        const id = setInterval(() => {
            setRemaining((s) => (s <= 1 ? 0 : s - 1))
        }, 1000)
        return () => clearInterval(id)
    }, [deadline])

    return remaining
}

function formatSeconds(s) {
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return rem ? `${m}m ${rem}s` : `${m}m`
}
