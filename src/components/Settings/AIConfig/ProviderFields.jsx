import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { PROVIDER_DEFAULTS } from '../../../utils/providerCapabilities'
import { useCompletionModels } from '../../../hooks/useProviderModels'
import { INPUT_CLS, LABEL_CLS } from './constants'
import { PriceHint } from './PriceHint'
import { ModelCombobox } from './ModelCombobox'

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
                    <div className="flex items-center justify-between mb-1">
                        <label htmlFor="completion-api-key" className={`${LABEL_CLS} mb-0`}>{defaults.apiKeyLabel}</label>
                        {form.hasCompletionKey && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                                Stored
                            </span>
                        )}
                    </div>
                    <input
                        id="completion-api-key"
                        type="password"
                        value={form.completionApiKey ?? ''}
                        onChange={(e) => onChange('completionApiKey', e.target.value)}
                        placeholder={
                            form.hasCompletionKey && form.completionApiKey === ''
                                ? '•••••••• (leave empty to keep current)'
                                : defaults.apiKeyPlaceholder
                        }
                        className={`${INPUT_CLS} ${errors.completionApiKey ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : ''}`}
                        autoComplete="off"
                    />
                    {form.hasCompletionKey && !form.completionApiKey && !errors.completionApiKey && (
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            Your key is encrypted at rest. Leave empty to keep the current one; type a new one to replace it.
                        </p>
                    )}
                    {errors.completionApiKey && (
                        <p role="alert" aria-live="polite" className="mt-1 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {errors.completionApiKey}
                        </p>
                    )}
                </div>
            )}

            {/* Endpoint URL (Local only) */}
            {defaults.showEndpointUrl && (
                <div>
                    <label htmlFor="completion-endpoint-url" className={LABEL_CLS}>Endpoint URL</label>
                    <input
                        id="completion-endpoint-url"
                        type="url"
                        value={form.completionEndpointUrl ?? ''}
                        onChange={(e) => onChange('completionEndpointUrl', e.target.value)}
                        placeholder={defaults.endpointPlaceholder}
                        className={INPUT_CLS}
                    />
                </div>
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
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{defaults.modelHelp}</p>
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
