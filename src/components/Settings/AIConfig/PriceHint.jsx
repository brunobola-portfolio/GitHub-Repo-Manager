import {
    getPricingForModel,
    formatPricing,
} from '../../../utils/providerPricing'

// ---------------------------------------------------------------------------
// Sub-component: PriceHint
// ---------------------------------------------------------------------------

/**
 * Tiny inline pricing hint below a model name input.
 * @param {{ modelName: string|null }} props
 */
export function PriceHint({ modelName }) {
    const pricing = getPricingForModel(modelName)
    const text = formatPricing(pricing)
    return (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {text}
        </p>
    )
}
