import { Check, Image, Wrench, Braces, Brain } from 'lucide-react'
import {
    TIER_LABELS,
    TIER_STYLES,
    CAPABILITY_ICONS,
    isNewModel,
} from '../../../utils/providerModels'
import { pricingTier, PRICING_TIER_CLS } from '../../../utils/providerPricing'
import { Badge } from '../../ui/Badge'

const ICON_BY_NAME = { Image, Wrench, Braces, Brain }

function formatDollars(n) {
    if (typeof n !== 'number') return ''
    if (n >= 100) return `$${n.toFixed(0)}`
    return `$${n.toFixed(2)}`
}

/**
 * Three-line row card used inside the model picker dropdown.
 *
 * Left column: name + tier/context/recommended/NEW pills, description, id + capability icons.
 * Right column: two-line pricing block, colour-coded by output-price tier.
 *
 * Props:
 *   hideTierBadge - When true, the tier badge is omitted. Used inside ModelDropdown
 *                   because the surrounding ModelSectionHeader already labels the tier,
 *                   making a per-row badge visually redundant.
 */
export function ModelRow({ option, optionId, selected, highlighted, onPick, dataIdx, hideTierBadge = false }) {
    const tierStyle = TIER_STYLES[option.tier] || TIER_STYLES.balanced
    const isNew = isNewModel(option.releasedAt)
    const priceTier = pricingTier(option.pricing)
    const priceCls = priceTier ? PRICING_TIER_CLS[priceTier] : ''

    return (
        <button
            type="button"
            id={optionId}
            role="option"
            aria-selected={selected}
            data-idx={dataIdx}
            onMouseEnter={onPick.hover}
            onClick={onPick.select}
            className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                highlighted
                    ? 'bg-brand-50 dark:bg-brand-900/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
            } ${selected ? 'ring-1 ring-inset ring-brand-300 dark:ring-brand-700' : ''}`}
        >
            <div className="flex-1 min-w-0">
                {/* Line 1: name + badges */}
                <div className="flex items-center gap-2 flex-wrap">
                    {option.recommended && (
                        <span aria-hidden="true" className="text-brand-500" title="Recommended">★</span>
                    )}
                    <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{option.label}</span>
                    {!hideTierBadge && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 ds-text-micro font-semibold uppercase tracking-wide rounded-full ring-1 ring-inset ${tierStyle}`}>
                            {TIER_LABELS[option.tier] || option.tier}
                        </span>
                    )}
                    {option.context && (
                        <Badge tone="neutral" size="xs" ring>
                            {option.context}
                        </Badge>
                    )}
                    {option.recommended && (
                        <Badge tone="brand" size="xs" ring className="uppercase tracking-wide font-semibold">
                            Recommended
                        </Badge>
                    )}
                    {isNew && (
                        <Badge tone="warning" size="xs" ring className="uppercase tracking-wide font-semibold">
                            NEW
                        </Badge>
                    )}
                </div>

                {/* Line 2: description */}
                {option.description && (
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                        {option.description}
                    </div>
                )}

                {/* Line 3: id + capability icons */}
                <div className="mt-1 flex items-center gap-2 ds-text-meta font-mono text-slate-500 dark:text-slate-400">
                    <span className="truncate">{option.id}</span>
                    {Array.isArray(option.capabilities) && option.capabilities.length > 0 && (
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                    )}
                    <div className="flex items-center gap-1">
                        {(option.capabilities || []).map((cap) => {
                            const meta = CAPABILITY_ICONS[cap]
                            if (!meta) return null
                            const Icon = ICON_BY_NAME[meta.iconName]
                            if (!Icon) return null
                            return (
                                <Icon
                                    key={cap}
                                    className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400"
                                    aria-label={meta.label}
                                />
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Right column: pricing */}
            {option.pricing && typeof option.pricing.input === 'number' && typeof option.pricing.output === 'number' && (
                <div className={`shrink-0 w-24 text-right text-xs font-medium tabular-nums leading-tight ${priceCls}`}>
                    <div>{formatDollars(option.pricing.input)} in</div>
                    <div>{formatDollars(option.pricing.output)} out</div>
                </div>
            )}

            {selected && <Check className="w-4 h-4 text-brand-500 mt-1 shrink-0" aria-hidden="true" />}
        </button>
    )
}
