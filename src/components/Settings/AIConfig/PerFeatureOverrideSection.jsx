import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Settings2, RotateCcw } from 'lucide-react'
import { InsightCard } from '../../ui/InsightCard'
import {
    FEATURE_KEYS,
    FEATURE_KEY_LABELS,
} from '../../../utils/providerCapabilities'
import { useCompletionModels, useEmbeddingModels } from '../../../hooks/useProviderModels'
import { LABEL_CLS } from './constants'
import { PriceHint } from './PriceHint'
import { ModelCombobox } from './ModelCombobox'

// ---------------------------------------------------------------------------
// Sub-component: PerFeatureOverrideSection
// ---------------------------------------------------------------------------

/**
 * Collapsible section for per-feature model overrides.
 *
 * Each feature gets a ModelCombobox populated with the completion-provider's
 * curated model catalogue (or the embedding catalogue when the feature is
 * EMBED), while still allowing free-form IDs for OpenRouter / Local.
 *
 * @param {{ featureOverrides: object, completionModel: string, completionProvider: string|null, embeddingProvider: string|null, onChange: function }} props
 */
export function PerFeatureOverrideSection({
    featureOverrides,
    completionModel,
    completionProvider,
    embeddingProvider,
    onChange,
}) {
    const [open, setOpen] = useState(false)
    const activeOverrides = Object.values(featureOverrides || {}).filter(Boolean).length
    const completionCatalogue = useCompletionModels(completionProvider)
    const embeddingCatalogue = useEmbeddingModels(embeddingProvider || completionProvider)

    return (
        <InsightCard tone="default" hover={false}>
            <div className="space-y-3">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center justify-between w-full text-left"
                    aria-expanded={open}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <Settings2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            Per-feature model overrides
                        </span>
                        <span className="text-xs font-normal text-slate-400">(optional)</span>
                        {activeOverrides > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
                                {activeOverrides} set
                            </span>
                        )}
                    </div>
                    <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                        aria-hidden="true"
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
                                Pick a different model for specific features. Leave empty to use the completion model above.
                            </p>

                            <ul className="space-y-3">
                                {FEATURE_KEYS.map((key) => {
                                    const isEmbedding = key === 'EMBED'
                                    const catalogue = isEmbedding ? embeddingCatalogue : completionCatalogue
                                    const value = featureOverrides[key] ?? ''
                                    const isOverridden = !!value

                                    return (
                                        <li
                                            key={key}
                                            className={`rounded-xl p-3 transition-colors ${
                                                isOverridden
                                                    ? 'bg-indigo-50/60 dark:bg-indigo-900/15 ring-1 ring-inset ring-indigo-500/20'
                                                    : 'bg-slate-50/60 dark:bg-slate-800/40 ring-1 ring-inset ring-slate-200/60 dark:ring-slate-700/60'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label
                                                    htmlFor={`feature-override-${key}`}
                                                    className={`${LABEL_CLS} mb-0 flex items-center gap-2`}
                                                >
                                                    <span>{FEATURE_KEY_LABELS[key]}</span>
                                                    {isOverridden ? (
                                                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-500 text-white">
                                                            override
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                                                            · default
                                                        </span>
                                                    )}
                                                </label>
                                                {isOverridden && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const next = { ...featureOverrides }
                                                            delete next[key]
                                                            onChange('featureOverrides', next)
                                                        }}
                                                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                                                        aria-label={`Reset ${FEATURE_KEY_LABELS[key]} to default`}
                                                    >
                                                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                                                        Reset
                                                    </button>
                                                )}
                                            </div>

                                            <ModelCombobox
                                                id={`feature-override-${key}`}
                                                value={value}
                                                onChange={(v) => {
                                                    const next = { ...featureOverrides }
                                                    if (v) {
                                                        next[key] = v
                                                    } else {
                                                        delete next[key]
                                                    }
                                                    onChange('featureOverrides', next)
                                                }}
                                                options={catalogue}
                                                placeholder={completionModel || 'default model'}
                                            />
                                            {value && <PriceHint modelName={value} />}
                                        </li>
                                    )
                                })}
                            </ul>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </InsightCard>
    )
}
