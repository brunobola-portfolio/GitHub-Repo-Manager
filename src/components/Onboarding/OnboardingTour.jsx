import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { ONBOARDING_STEPS } from './onboardingSteps'
import { Button } from '../ui/Button'
import { ProviderKeyForm } from '../Settings/AIConfig/ProviderKeyForm'
import { DURATION } from '../ui/motion'

// Form fields (text/password inputs, selects) where Left/Right arrow keys
// move the text cursor or a native picker, not the tour's steps. Without
// this the ai-config step's key field would fight the user every time they
// pressed an arrow key while typing or picking a provider.
function isEditableTarget(target) {
    if (!target) return false
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * OnboardingTour — modal carousel for first-run users (steps come from
 * ONBOARDING_STEPS; step count is not hardcoded here).
 *
 * Behaviour:
 *   - Skip / Got it: persist "don't show again" via onNeverShow
 *   - Esc / backdrop click: only onClose (allow re-open later)
 *   - Arrow keys navigate between steps
 *   - Step content announces via aria-live="polite" for screen readers
 */
export function OnboardingTour({ isOpen, onClose, onNeverShow }) {
    const [stepIndex, setStepIndex] = useState(0)
    const dialogRef = useFocusTrap(isOpen, onClose)

    // Reset to the first step whenever the tour (re)opens — computed during
    // render (comparing against the `isOpen` value this render already
    // accounted for) instead of a follow-up effect, so reopening doesn't
    // flash whichever step was active when it last closed before correcting
    // to step 1 on the next paint.
    const [committedIsOpen, setCommittedIsOpen] = useState(isOpen)
    if (isOpen !== committedIsOpen) {
        setCommittedIsOpen(isOpen)
        if (isOpen) setStepIndex(0)
    }

    useEffect(() => {
        if (!isOpen) return
        const onKey = (e) => {
            if (isEditableTarget(e.target)) return
            if (e.key === 'ArrowRight') {
                setStepIndex((i) => Math.min(ONBOARDING_STEPS.length - 1, i + 1))
            } else if (e.key === 'ArrowLeft') {
                setStepIndex((i) => Math.max(0, i - 1))
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [isOpen])

    if (!isOpen) return null

    const step = ONBOARDING_STEPS[stepIndex]
    const isFirst = stepIndex === 0
    const isLast = stepIndex === ONBOARDING_STEPS.length - 1
    const Icon = step.icon

    const handleSkip = () => {
        onNeverShow?.()
        onClose?.()
    }
    const handleComplete = () => {
        onNeverShow?.()
        onClose?.()
    }

    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Welcome tour"
            className="fixed inset-0 z-[var(--ds-z-ceiling)] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={onClose}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose?.() }}
        >
            <motion.div
                ref={dialogRef}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.standard }}
                onClick={(e) => e.stopPropagation()}
                className={`w-full p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-[var(--ds-shadow-overlay)] ${step.hasForm ? 'max-w-xl' : 'max-w-lg'}`}
            >
                <div className="flex justify-between items-start mb-6">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close tour"
                        className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 ds-focus-ring"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <AnimatePresence mode="wait">
                    <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: DURATION.standard }}
                        aria-live="polite"
                        className="text-center"
                    >
                        <div className="w-16 h-16 mb-5 mx-auto rounded-2xl bg-[color:var(--ds-accent-brand)] flex items-center justify-center">
                            <Icon className="w-8 h-8 text-white" strokeWidth={2.5} />
                        </div>
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">{step.title}</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{step.body}</p>
                        {step.hasForm && (
                            <div className="mt-5">
                                <ProviderKeyForm />
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>

                <div className="mt-8 flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={handleSkip}
                        className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 ds-focus-ring"
                    >
                        Skip tour
                    </button>
                    <div className="flex items-center gap-2">
                        {!isFirst && (
                            <Button
                                type="button"
                                variant="outline"
                                size="md"
                                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                            >
                                <ArrowLeft className="w-4 h-4" /> Back
                            </Button>
                        )}
                        {!isLast && (
                            <Button
                                type="button"
                                variant="primary"
                                size="md"
                                onClick={() => setStepIndex((i) => Math.min(ONBOARDING_STEPS.length - 1, i + 1))}
                            >
                                Next <ArrowRight className="w-4 h-4" />
                            </Button>
                        )}
                        {isLast && (
                            <Button
                                type="button"
                                variant="primary"
                                size="md"
                                onClick={handleComplete}
                            >
                                Got it
                            </Button>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    )
    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions */
}
