import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
    PROVIDER_CAPABILITIES,
    PROVIDER_DEFAULTS,
} from '../../../utils/providerCapabilities'
import { PROVIDERS_NEEDING_EMBEDDING_OVERRIDE, INPUT_CLS, LABEL_CLS } from './constants'
import { PriceHint } from './PriceHint'

// ---------------------------------------------------------------------------
// Sub-component: EmbeddingSection
// ---------------------------------------------------------------------------

export function EmbeddingSection({ form, onChange }) {
    const [showOverride, setShowOverride] = useState(
        !!form.embeddingProvider
    )

    const needsEmbedding = PROVIDERS_NEEDING_EMBEDDING_OVERRIDE.includes(form.completionProvider)

    if (!needsEmbedding && !showOverride) {
        return (
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="emb-override"
                    checked={false}
                    onChange={(e) => setShowOverride(e.target.checked)}
                    className="accent-indigo-600"
                />
                <label
                    htmlFor="emb-override"
                    className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none"
                >
                    Override embedding provider
                </label>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {!needsEmbedding && (
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="emb-override"
                        checked={showOverride}
                        onChange={(e) => {
                            setShowOverride(e.target.checked)
                            if (!e.target.checked) {
                                onChange('embeddingProvider', null)
                                onChange('embeddingApiKey', null)
                                onChange('embeddingModel', null)
                            }
                        }}
                        className="accent-indigo-600"
                    />
                    <label
                        htmlFor="emb-override"
                        className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none"
                    >
                        Override embedding provider
                    </label>
                </div>
            )}

            <div>
                <label htmlFor="embedding-provider" className={LABEL_CLS}>Embedding Provider</label>
                <div className="relative">
                    <select
                        id="embedding-provider"
                        value={form.embeddingProvider ?? ''}
                        onChange={(e) => onChange('embeddingProvider', e.target.value || null)}
                        className={`${INPUT_CLS} pr-8 appearance-none cursor-pointer`}
                    >
                        <option value="">— Select embedding provider —</option>
                        {PROVIDER_IDS.filter((id) => PROVIDER_CAPABILITIES[id]?.semanticSearch === 'yes').map((id) => (
                            <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                </div>
            </div>

            {form.embeddingProvider && (
                <>
                    <div>
                        <label htmlFor="embedding-api-key" className={LABEL_CLS}>
                            {PROVIDER_DEFAULTS[form.embeddingProvider]?.apiKeyLabel ?? 'API Key'}
                        </label>
                        <input
                            id="embedding-api-key"
                            type="password"
                            value={form.embeddingApiKey ?? ''}
                            onChange={(e) => onChange('embeddingApiKey', e.target.value)}
                            placeholder={
                                form.hasEmbeddingKey && form.embeddingApiKey === ''
                                    ? '•••••••• (leave empty to keep current)'
                                    : (PROVIDER_DEFAULTS[form.embeddingProvider]?.apiKeyPlaceholder ?? '')
                            }
                            className={INPUT_CLS}
                            autoComplete="off"
                        />
                    </div>
                    <div>
                        <label htmlFor="embedding-model" className={LABEL_CLS}>Embedding Model</label>
                        <input
                            id="embedding-model"
                            type="text"
                            value={form.embeddingModel ?? ''}
                            onChange={(e) => onChange('embeddingModel', e.target.value)}
                            placeholder={
                                form.embeddingProvider === 'openai'
                                    ? 'text-embedding-3-small'
                                    : form.embeddingProvider === 'gemini'
                                    ? 'gemini-embedding-001'
                                    : 'embedding-model'
                            }
                            className={INPUT_CLS}
                        />
                        <PriceHint modelName={
                            form.embeddingModel ||
                            (form.embeddingProvider === 'openai' ? 'text-embedding-3-small'
                                : form.embeddingProvider === 'gemini' ? 'gemini-embedding-001'
                                : null)
                        } />
                    </div>
                </>
            )}
        </div>
    )
}
