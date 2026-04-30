import { motion } from 'framer-motion'
import { Plug, AlertTriangle, BookOpen, Mail, X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

/**
 * "This integration isn't configured on this deployment."
 *
 * Used when the server returns 503 because an optional dependency hasn't
 * been wired up — Stripe billing on a self-host, AI provider keys missing,
 * Sentry DSN unset, etc. The intent is to be informative, not alarming:
 * the *app* is healthy; an optional feature simply isn't connected.
 *
 *   <ServiceUnavailable
 *     service="Stripe billing"
 *     reason="Self-hosted deployments need STRIPE_SECRET_KEY set."
 *     docsHref="https://docs.example.com/billing"
 *     contactEmail="bruno@bolalabs.pt" />
 *
 * Variants: card (default) | banner | inline.
 */
export function ServiceUnavailable({
    service,
    reason,
    docsHref,
    contactEmail,
    contactSubject,
    variant = 'card',
    onDismiss,
    className,
}) {
    if (variant === 'banner') {
        return (
            <BannerService service={service} reason={reason} docsHref={docsHref}
                contactEmail={contactEmail} contactSubject={contactSubject}
                onDismiss={onDismiss} className={className} />
        )
    }
    if (variant === 'inline') {
        return (
            <InlineService service={service} reason={reason} className={className} />
        )
    }
    return (
        <CardService service={service} reason={reason} docsHref={docsHref}
            contactEmail={contactEmail} contactSubject={contactSubject}
            className={className} />
    )
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

function CardService({ service, reason, docsHref, contactEmail, contactSubject, className }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-label={`${service} unavailable`}
            className={twMerge(
                'relative isolate overflow-hidden',
                'rounded-3xl border border-amber-200/70 dark:border-amber-500/25',
                'bg-amber-50/70 dark:bg-amber-500/5 backdrop-blur-xl',
                'shadow-lg shadow-amber-100/40 dark:shadow-black/30',
                'px-6 py-10 sm:px-10 sm:py-12',
                className
            )}
        >
            <Halo />

            <div className="relative flex flex-col items-center text-center max-w-md mx-auto">
                <motion.div
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.08, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                    className="mb-5 inline-flex items-center justify-center w-14 h-14 rounded-2xl
                               bg-gradient-to-br from-amber-400 to-orange-500
                               shadow-lg shadow-amber-500/30 ring-1 ring-amber-500/20"
                >
                    <Plug className="w-6 h-6 text-white" strokeWidth={2.4} />
                </motion.div>

                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-3
                                 text-[10px] font-semibold uppercase tracking-[0.14em]
                                 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300
                                 border border-amber-500/20">
                    <AlertTriangle className="w-3 h-3" /> Not configured
                </span>

                <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white mb-2 ds-font-display">
                    {service} isn't available on this instance
                </h3>

                {reason && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
                        {reason}
                    </p>
                )}

                <div className="flex flex-wrap items-center justify-center gap-2">
                    {docsHref && (
                        <a
                            href={docsHref}
                            target={docsHref.startsWith('http') ? '_blank' : undefined}
                            rel={docsHref.startsWith('http') ? 'noopener noreferrer' : undefined}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                                       bg-amber-500 text-white shadow-md shadow-amber-500/30
                                       hover:bg-amber-600 transition-colors ds-focus-ring active:scale-[0.98]"
                        >
                            <BookOpen className="w-3.5 h-3.5" /> Setup guide
                        </a>
                    )}
                    {contactEmail && (
                        <a
                            href={`mailto:${contactEmail}${contactSubject ? `?subject=${encodeURIComponent(contactSubject)}` : ''}`}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                                       bg-white/90 dark:bg-slate-800/90 text-slate-700 dark:text-slate-200
                                       border border-slate-200 dark:border-slate-700
                                       hover:bg-white dark:hover:bg-slate-800 transition-colors ds-focus-ring active:scale-[0.98]"
                        >
                            <Mail className="w-3.5 h-3.5" /> Contact support
                        </a>
                    )}
                </div>
            </div>
        </motion.div>
    )
}

/* ------------------------------------------------------------------ */
/* Banner (used by PricingPage and similar)                            */
/* ------------------------------------------------------------------ */

function BannerService({ service, reason, docsHref, contactEmail, contactSubject, onDismiss, className }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            role="status"
            className={twMerge(
                'relative overflow-hidden',
                'rounded-2xl border border-amber-300/60 dark:border-amber-500/30',
                'bg-amber-50/90 dark:bg-amber-500/10 backdrop-blur-md',
                'px-5 py-4',
                'flex flex-col sm:flex-row sm:items-center gap-3',
                className
            )}
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
                             bg-gradient-to-br from-amber-400 to-orange-500
                             shadow-md shadow-amber-500/30">
                <Plug className="w-4 h-4 text-white" />
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    {service} isn't configured on this instance
                </p>
                {reason && (
                    <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                        {reason}
                    </p>
                )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {docsHref && (
                    <a
                        href={docsHref}
                        target={docsHref.startsWith('http') ? '_blank' : undefined}
                        rel={docsHref.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                                   bg-amber-500 text-white hover:bg-amber-600 transition-colors ds-focus-ring"
                    >
                        <BookOpen className="w-3 h-3" /> Setup
                    </a>
                )}
                {contactEmail && (
                    <a
                        href={`mailto:${contactEmail}${contactSubject ? `?subject=${encodeURIComponent(contactSubject)}` : ''}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                   text-amber-900 dark:text-amber-200
                                   underline underline-offset-2 hover:no-underline ds-focus-ring"
                    >
                        <Mail className="w-3 h-3" /> {contactEmail}
                    </a>
                )}
                {onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss"
                        className="p-1 rounded-md text-amber-700/70 dark:text-amber-200/70 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-500/10 ds-focus-ring"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        </motion.div>
    )
}

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

function InlineService({ service, reason, className }) {
    return (
        <div className={twMerge(
            'flex items-start gap-2.5 px-3 py-2 rounded-lg',
            'bg-amber-50/80 dark:bg-amber-500/10',
            'border border-amber-200/60 dark:border-amber-500/20',
            'text-xs',
            className
        )}>
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                    {service} unavailable
                </p>
                {reason && (
                    <p className="text-amber-800/80 dark:text-amber-200/80 mt-0.5">
                        {reason}
                    </p>
                )}
            </div>
        </div>
    )
}

function Halo() {
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2
                       w-[28rem] h-[28rem] rounded-full blur-3xl opacity-30 dark:opacity-20
                       bg-gradient-to-br from-amber-300 via-orange-400 to-rose-400"
        />
    )
}
