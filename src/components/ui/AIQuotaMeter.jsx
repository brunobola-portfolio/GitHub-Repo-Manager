import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Sparkles, Check, ArrowRight, ExternalLink } from 'lucide-react'
import { navigateToPricing, openAppSettings } from '../../utils/appEvents'
import { formatTimeUntil } from '../../utils/format'

const TONE = {
    indigo: {
        ring: 'text-indigo-500',
        track: 'text-indigo-500/15 dark:text-indigo-500/20',
        label: 'text-slate-700 dark:text-slate-200',
        pulse: false,
    },
    amber: {
        ring: 'text-amber-500',
        track: 'text-amber-500/15 dark:text-amber-500/20',
        label: 'text-slate-700 dark:text-slate-200',
        pulse: false,
    },
    rose: {
        ring: 'text-rose-500',
        track: 'text-rose-500/15 dark:text-rose-500/20',
        label: 'text-rose-700 dark:text-rose-300',
        pulse: true,
    },
}

function pickTone(percent) {
    if (percent >= 0.9) return 'rose'
    if (percent >= 0.6) return 'amber'
    return 'indigo'
}


function ProgressRing({ percent, tone }) {
    const radius = 9
    const stroke = 2.5
    const c = 2 * Math.PI * radius
    const offset = c * (1 - Math.min(1, Math.max(0, percent)))
    const reduceMotion = useReducedMotion()
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className={tone.pulse ? 'motion-safe:animate-pulse' : ''}>
            <circle cx="12" cy="12" r={radius} fill="none" strokeWidth={stroke} className={tone.track} stroke="currentColor" />
            <motion.circle
                cx="12" cy="12" r={radius} fill="none" strokeWidth={stroke}
                strokeLinecap="round"
                className={tone.ring}
                stroke="currentColor"
                strokeDasharray={c}
                initial={{ strokeDashoffset: c }}
                animate={{ strokeDashoffset: offset }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
                transform="rotate(-90 12 12)"
            />
        </svg>
    )
}

/**
 * AIQuotaMeter — compact pill showing current/limit AI quota with a
 * thin SVG progress ring. Click opens a popover with reset countdown
 * and an Upgrade CTA (free tier only).
 */
export function AIQuotaMeter({ current = 0, limit = Infinity, tier = 'free', resetAt = null, className = '' }) {
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)
    const triggerRef = useRef(null)

    useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => {
            if (e.key === 'Escape') {
                setOpen(false)
                triggerRef.current?.focus()
            }
        }
        const onMouseDown = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false)
            }
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onMouseDown)
        return () => {
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('mousedown', onMouseDown)
        }
    }, [open])

    const unlimited = !Number.isFinite(limit)
    const percent = unlimited ? 0 : current / Math.max(1, limit)
    const toneKey = unlimited ? 'indigo' : pickTone(percent)
    const tone = TONE[toneKey]
    const reset = formatTimeUntil(resetAt)
    const ariaLabel = unlimited
        ? `AI quota: unlimited on ${tier}. Click for details.`
        : `AI quota: ${current} of ${limit} requests used${reset ? `. Resets ${reset}` : ''}. Click for details.`

    return (
        <div ref={containerRef} className={`relative inline-block ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-label={ariaLabel}
                aria-haspopup="dialog"
                aria-expanded={open}
                data-tone={toneKey}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full ring-1 ring-inset ring-slate-200/70 dark:ring-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm hover:ring-indigo-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition"
            >
                {unlimited ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                ) : (
                    <ProgressRing percent={percent} tone={tone} />
                )}
                <span className={`text-[11px] font-semibold tabular-nums ${tone.label}`}>
                    {unlimited ? 'Unlimited' : `${current} / ${limit}`}
                </span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        role="dialog"
                        aria-label="AI quota details"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 z-[var(--ds-z-overlay)] w-72 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 shadow-xl p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-slate-500 dark:text-slate-400">AI quota</span>
                            <span className="text-[10px] uppercase font-semibold text-slate-400 dark:text-slate-500">{tier}</span>
                        </div>
                        {unlimited ? (
                            <p className="text-sm text-slate-700 dark:text-slate-200">
                                <Check className="inline w-4 h-4 mr-1 text-emerald-500" aria-hidden="true" />
                                Unlimited requests on this plan.
                            </p>
                        ) : (
                            <>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                                    {current} / {limit} requests
                                </p>
                                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${toneKey === 'rose' ? 'bg-rose-500' : toneKey === 'amber' ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                        style={{ width: `${Math.min(100, percent * 100)}%` }}
                                    />
                                </div>
                                {reset && (
                                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Resets {reset}.</p>
                                )}
                            </>
                        )}

                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => { openAppSettings('usage'); setOpen(false) }}
                                className="inline-flex items-center gap-1 text-[12px] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300"
                            >
                                <Sparkles className="w-3 h-3" aria-hidden="true" />
                                Manage usage
                                <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </button>
                            {tier === 'free' && (
                                <button
                                    type="button"
                                    onClick={() => { navigateToPricing('pro'); setOpen(false) }}
                                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 px-2.5 py-1 rounded-md hover:shadow-md transition-shadow"
                                >
                                    Upgrade to Pro
                                    <ArrowRight className="w-3 h-3" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
