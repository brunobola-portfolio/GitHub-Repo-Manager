import { TIER_LABELS } from '../../../utils/providerModels'

/**
 * Non-interactive section divider for the model dropdown.
 * `role="presentation"` so screen readers don't announce it as an option.
 */
export function ModelSectionHeader({ tier, isFirst }) {
    const label = TIER_LABELS[tier] || tier
    return (
        <div
            role="presentation"
            data-testid="model-section-header"
            data-tier={tier}
            className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 ${
                isFirst ? '' : 'border-t border-slate-100 dark:border-slate-800'
            }`}
        >
            {label}
        </div>
    )
}
