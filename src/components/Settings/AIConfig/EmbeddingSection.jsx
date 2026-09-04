import { useState } from 'react'
import {
    PROVIDER_IDS,
    PROVIDER_LABELS,
    PROVIDER_CAPABILITIES,
    PROVIDER_DEFAULTS,
} from '../../../utils/providerCapabilities'
import { useEmbeddingModels } from '../../../hooks/useProviderModels'
import { PROVIDERS_NEEDING_EMBEDDING_OVERRIDE, LABEL_CLS } from './constants'
import { PriceHint } from './PriceHint'
import { ModelCombobox } from './ModelCombobox'
import { Field, Input, Checkbox } from '../../ui/form'
import { Select } from '../../ui/Select'

// ---------------------------------------------------------------------------
// Sub-component: EmbeddingSection
// ---------------------------------------------------------------------------

export function EmbeddingSection({ form, onChange }) {
    const [showOverride, setShowOverride] = useState(
        !!form.embeddingProvider
    )
    const embeddingModels = useEmbeddingModels(form.embeddingProvider)

    const needsEmbedding = PROVIDERS_NEEDING_EMBEDDING_OVERRIDE.includes(form.completionProvider)

    if (!needsEmbedding && !showOverride) {
        return (
            <div className="flex items-center gap-2">
                <Checkbox
                    id="emb-override"
                    checked={false}
                    onChange={(e) => setShowOverride(e.target.checked)}
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
                    <Checkbox
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
                <Select
                    label="Embedding Provider"
                    value={form.embeddingProvider ?? ''}
                    onChange={(value) => onChange('embeddingProvider', value || null)}
                    placeholder="— Select embedding provider —"
                    options={[
                        { value: '', label: '— Select embedding provider —' },
                        ...PROVIDER_IDS
                            .filter((id) => PROVIDER_CAPABILITIES[id]?.semanticSearch === 'yes')
                            .map((id) => ({ value: id, label: PROVIDER_LABELS[id] })),
                    ]}
                />
            </div>

            {form.embeddingProvider && (
                <>
                    <Field
                        label={PROVIDER_DEFAULTS[form.embeddingProvider]?.apiKeyLabel ?? 'API Key'}
                        htmlFor="embedding-api-key"
                    >
                        <Input
                            id="embedding-api-key"
                            type="password"
                            value={form.embeddingApiKey ?? ''}
                            onChange={(e) => onChange('embeddingApiKey', e.target.value)}
                            placeholder={
                                form.hasEmbeddingKey && form.embeddingApiKey === ''
                                    ? '•••••••• (leave empty to keep current)'
                                    : (PROVIDER_DEFAULTS[form.embeddingProvider]?.apiKeyPlaceholder ?? '')
                            }
                            autoComplete="off"
                        />
                    </Field>
                    <div>
                        <label htmlFor="embedding-model" className={LABEL_CLS}>Embedding Model</label>
                        <ModelCombobox
                            id="embedding-model"
                            value={form.embeddingModel ?? ''}
                            onChange={(v) => onChange('embeddingModel', v)}
                            options={embeddingModels}
                            placeholder={
                                form.embeddingProvider === 'openai'
                                    ? 'text-embedding-3-small'
                                    : form.embeddingProvider === 'gemini'
                                    ? 'gemini-embedding-001'
                                    : 'embedding-model'
                            }
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
