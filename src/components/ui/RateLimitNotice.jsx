/*
 * GitHub Repo Manager
 * RateLimitNotice — friendly countdown treatment for 429 responses.
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
 */

import { motion } from 'framer-motion'
import { EASE } from './motion'
import { Hourglass, RotateCcw, X } from 'lucide-react'
import { useCountdown } from '@/hooks/useCountdown'

/**
 * RateLimitNotice
 *
 * @param {object} props
 * @param {number} props.retryAt       Unix ms when the user can retry.
 * @param {'toast'|'banner'} [props.variant='toast']
 * @param {() => void} [props.onRetry] Called when Retry button is clicked (after ready).
 * @param {() => void} [props.onDismiss] Optional dismiss; shows an X button when provided.
 */
export function RateLimitNotice({ retryAt, variant = 'toast', onRetry, onDismiss }) {
    const { secondsLeft, progress01, isReady } = useCountdown(retryAt)

    // Circular progress — 40x40 SVG, 16 radius
    const radius = 16
    const circumference = 2 * Math.PI * radius
    const dashOffset = circumference * (1 - progress01)

    const message = isReady
        ? "You're good to go"
        : `Take a quick breath — we'll be ready again in ${secondsLeft}s`

    const handleRetry = () => {
        if (!isReady) return
        onRetry?.()
    }

    const Ring = (
        <div className="relative w-10 h-10 shrink-0" aria-hidden="true">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                <circle
                    cx="20" cy="20" r={radius}
                    fill="none"
                    strokeWidth="3"
                    className="stroke-amber-200/60 dark:stroke-amber-500/20"
                />
                <circle
                    cx="20" cy="20" r={radius}
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="stroke-amber-500 dark:stroke-amber-400 transition-[stroke-dashoffset] duration-700 ease-linear"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                />
            </svg>
            <motion.div
                className="absolute inset-0 flex items-center justify-center"
                animate={{ rotate: isReady ? 0 : [0, 180] }}
                transition={{ repeat: isReady ? 0 : Infinity, duration: 2, ease: 'easeInOut' }}
            >
                <Hourglass className="w-4 h-4 text-amber-600 dark:text-amber-300" />
            </motion.div>
            {!isReady && (
                <span className="sr-only">{secondsLeft} seconds remaining</span>
            )}
        </div>
    )

    const SecondsText = !isReady && (
        <motion.span
            key={secondsLeft}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.35 }}
            className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-300"
        >
            {secondsLeft}
        </motion.span>
    )

    const RetryButton = (
        <button
            type="button"
            onClick={handleRetry}
            disabled={!isReady}
            className={`
                group flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold
                transition-all duration-200
                focus-visible:ring-2 focus-visible:ring-amber-500 focus:outline-none
                ${isReady
                    ? 'bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400 text-white dark:text-slate-900 shadow-sm hover:shadow-md'
                    : 'bg-amber-500/10 dark:bg-amber-400/10 text-amber-700/60 dark:text-amber-300/50 cursor-not-allowed'}
            `}
        >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry now
        </button>
    )

    if (variant === 'banner') {
        return (
            <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: EASE.emphasized }}
                role="status"
                aria-live="polite"
                className="relative z-[var(--ds-z-floating)]"
            >
                <div className="bg-amber-50/90 dark:bg-amber-900/60 border-b border-amber-300 dark:border-amber-500 backdrop-blur-md">
                    <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3 sm:gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                            {Ring}
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-200/90 truncate">
                                {message}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {SecondsText}
                            {RetryButton}
                            {onDismiss && (
                                <button
                                    onClick={onDismiss}
                                    className="p-1.5 rounded-md text-amber-500/60 dark:text-amber-400/40 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-amber-500/10 dark:hover:bg-amber-400/10 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-amber-500 focus:outline-none"
                                    aria-label="Dismiss notice"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        )
    }

    // toast variant
    return (
        <div className="flex items-center gap-3 min-w-0">
            {Ring}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200/90 truncate">
                    {message}
                </p>
            </div>
            {SecondsText}
            {RetryButton}
        </div>
    )
}
