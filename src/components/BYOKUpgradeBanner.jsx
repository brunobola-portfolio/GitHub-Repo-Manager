import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X, ArrowRight } from 'lucide-react'
import { API_BASE_URL } from '../config'

const DISMISS_KEY = 'byok-banner-dismissed'

/**
 * BYOKUpgradeBanner
 *
 * Shows a dismissible info banner for authenticated users who have no AI
 * provider configured yet. Guides them to Settings → AI Configuration.
 *
 * Conditions to render:
 * - User is authenticated (prop `isAuthenticated`)
 * - localStorage byok-banner-dismissed !== '1'
 * - GET /api/user/ai-config returns { completionProvider: null, hasCompletionKey: false }
 */
export function BYOKUpgradeBanner({ isAuthenticated, onOpenAISettings }) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (!isAuthenticated) return
        if (localStorage.getItem(DISMISS_KEY) === '1') return

        let cancelled = false
        fetch(`${API_BASE_URL}/api/user/ai-config`, { credentials: 'include' })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                if (data && data.completionProvider === null && data.hasCompletionKey === false) {
                    setVisible(true)
                }
            })
            .catch(() => {
                // Soft-fail — don't show the banner if the request fails
            })

        return () => { cancelled = true }
    }, [isAuthenticated])

    const handleDismiss = () => {
        localStorage.setItem(DISMISS_KEY, '1')
        setVisible(false)
    }

    const handleConfigure = () => {
        handleDismiss()
        onOpenAISettings?.()
    }

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="relative z-30"
                >
                    <div className="bg-indigo-600 dark:bg-indigo-700">
                        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-2.5 flex items-center justify-between gap-3 sm:gap-4">
                            {/* Left: icon + message */}
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="shrink-0 w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
                                    <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
                                </div>
                                <p className="text-sm font-medium text-white/95 truncate">
                                    As funcionalidades de IA agora usam a tua própria chave de provider (BYOK).{' '}
                                    <span className="text-white/75 hidden sm:inline">
                                        Configura em Settings → AI Configuration. Se a aplicação tem uma chave
                                        partilhada do servidor, continua a funcionar normalmente.
                                    </span>
                                </p>
                            </div>

                            {/* Right: CTA + dismiss */}
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={handleConfigure}
                                    className="group flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold
                                        bg-white text-indigo-700
                                        hover:bg-indigo-50
                                        shadow-sm shadow-black/10
                                        active:scale-[0.97] transition-all duration-200
                                        focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-indigo-600 focus:outline-none"
                                >
                                    Configurar agora
                                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                                </button>
                                <button
                                    onClick={handleDismiss}
                                    className="p-1.5 rounded-md text-white/60
                                        hover:text-white
                                        hover:bg-white/15
                                        transition-colors duration-200
                                        focus-visible:ring-2 focus-visible:ring-white focus:outline-none"
                                    aria-label="Dispensar notificação"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
