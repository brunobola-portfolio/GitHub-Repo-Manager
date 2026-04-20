import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Settings2 } from 'lucide-react'
import { InsightCard } from '../../ui/InsightCard'
import {
    FEATURE_KEYS,
    FEATURE_KEY_LABELS,
} from '../../../utils/providerCapabilities'
import { INPUT_CLS, LABEL_CLS } from './constants'
import { PriceHint } from './PriceHint'

// ---------------------------------------------------------------------------
// Sub-component: PerFeatureOverrideSection
// ---------------------------------------------------------------------------

/**
 * Collapsed section for per-feature model overrides.
 * @param {{ featureOverrides: object, completionModel: string, onChange: function }} props
 */
export function PerFeatureOverrideSection({ featureOverrides, completionModel, onChange }) {
    const [open, setOpen] = useState(false)

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center justify-between w-full text-left"
                    aria-expanded={open}
                >
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Per-feature model overrides
                        </span>
                        <span className="text-xs font-normal text-slate-400">(optional)</span>
                    </div>
                    <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    />
                </button>

                <AnimatePresence initial={false}>
                    {open && (
                        <motion.div
                            key="feature-overrides"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                Override the model for specific features. Leave empty to use the completion model above.
                            </p>
                            <div className="space-y-3">
                                {FEATURE_KEYS.map((key) => (
                                    <div key={key}>
                                        <div className="flex items-center justify-between mb-1">
                                            <label
                                                htmlFor={`feature-override-${key}`}
                                                className={LABEL_CLS}
                                            >
                                                {FEATURE_KEY_LABELS[key]}
                                            </label>
                                            {featureOverrides[key] && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const next = { ...featureOverrides }
                                                        delete next[key]
                                                        onChange('featureOverrides', next)
                                                    }}
                                                    className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                                    aria-label={`Reset ${FEATURE_KEY_LABELS[key]} to default`}
                                                >
                                                    Reset
                                                </button>
                                            )}
                                        </div>
                                        <input
                                            id={`feature-override-${key}`}
                                            type="text"
                                            value={featureOverrides[key] ?? ''}
                                            onChange={(e) => {
                                                const val = e.target.value
                                                const next = { ...featureOverrides }
                                                if (val) {
                                                    next[key] = val
                                                } else {
                                                    delete next[key]
                                                }
                                                onChange('featureOverrides', next)
                                            }}
                                            placeholder={completionModel || 'default model'}
                                            className={INPUT_CLS}
                                        />
                                        <PriceHint modelName={featureOverrides[key] || null} />
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </InsightCard>
    )
}
