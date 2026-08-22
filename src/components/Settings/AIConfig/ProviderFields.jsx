import { CheckCircle2, ExternalLink } from 'lucide-react'
import { PROVIDER_DEFAULTS } from '../../../utils/providerCapabilities'
import { useCompletionModels } from '../../../hooks/useProviderModels'
import { LABEL_CLS } from './constants'
import { PriceHint } from './PriceHint'
import { ModelCombobox } from './ModelCombobox'
import { Field, Input } from '../../ui/form'

// ---------------------------------------------------------------------------
// Sub-component: ProviderFields
// ---------------------------------------------------------------------------

export function ProviderFields({ provider, form, onChange, errors }) {
    const completionModels = useCompletionModels(provider)
    if (!provider) return null
    const defaults = PROVIDER_DEFAULTS[provider]
    if (!defaults) return null

    return (
        <div className="space-y-3">
            {/* API Key */}
            {(defaults.apiKeyRequired || provider !== 'local') && (
                <div>
                    <Field
                        label={
                            <span className="flex items-center justify-between w-full">
                                <span>{defaults.apiKeyLabel}</span>
                                {form.hasCompletionKey && (
                                    <span className="inline-flex items-center gap-1 ds-text-micro font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                        Stored
                                    </span>
                                )}
                            </span>
                        }
                        htmlFor="completion-api-key"
                        hint={form.hasCompletionKey && !form.completionApiKey
                            ? 'Your key is encrypted at rest. Leave empty to keep the current one; type a new one to replace it.'
                            : undefined}
                        error={errors.completionApiKey}
                    >
                        <Input
                            id="completion-api-key"
                            type="password"
                            value={form.completionApiKey ?? ''}
                            onChange={(e) => onChange('completionApiKey', e.target.value)}
                            placeholder={
                                form.hasCompletionKey && form.completionApiKey === ''
                                    ? '•••••••• (leave empty to keep current)'
                                    : defaults.apiKeyPlaceholder
                            }
                            autoComplete="off"
                        />
                    </Field>
                    {/* Only shown before a key is stored — once configured, the
                        provider's own console is where a user manages/rotates
                        it, not somewhere this form needs to keep linking. */}
                    {!form.hasCompletionKey && defaults.apiKeyHelpUrl && (
                        <a
                            href={defaults.apiKeyHelpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] hover:underline ds-focus-ring rounded"
                        >
                            {defaults.apiKeyHelpLabel || 'Get an API key'}
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                    )}
                </div>
            )}

            {/* Endpoint URL (Local only) */}
            {defaults.showEndpointUrl && (
                <Field label="Endpoint URL" htmlFor="completion-endpoint-url">
                    <Input
                        id="completion-endpoint-url"
                        type="url"
                        value={form.completionEndpointUrl ?? ''}
                        onChange={(e) => onChange('completionEndpointUrl', e.target.value)}
                        placeholder={defaults.endpointPlaceholder}
                    />
                </Field>
            )}

            {/* Model override */}
            <div>
                <label htmlFor="completion-model" className={LABEL_CLS}>Model</label>
                <ModelCombobox
                    id="completion-model"
                    value={form.completionModel ?? ''}
                    onChange={(v) => onChange('completionModel', v)}
                    options={completionModels}
                    placeholder={defaults.modelPlaceholder}
                    catalogueHref={defaults.modelHelpUrl}
                    catalogueLabel={defaults.modelHelp}
                />
                {defaults.modelHelp && !defaults.modelHelpUrl && (
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{defaults.modelHelp}</p>
                )}
                <PriceHint modelName={form.completionModel || defaults.modelPlaceholder} />
            </div>

            {/* Help text */}
            {defaults.helpText && (
                <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg px-3 py-2">
                    {defaults.helpText}
                </p>
            )}
        </div>
    )
}
