import { TIER_LABELS, TIER_ORDER } from '../../../utils/providerModels'

function chipCls(active) {
    return [
        'px-2.5 py-1 rounded-full text-[11px] font-medium ring-1 ring-inset transition-colors',
        active
            ? 'bg-indigo-500 text-white ring-indigo-500 hover:bg-indigo-600'
            : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700',
    ].join(' ')
}

/**
 * Sticky chip bar above the dropdown listbox. Single-select; clicking the
 * active chip again does nothing (use All to clear).
 *
 * Chip buttons use `aria-label` for their accessible name so that the visible
 * label text is rendered inside a child <span> (keeping `getNodeText(button)`
 * empty). This avoids false positives when tests use `getByText` to target
 * section headers — only the header element has the tier label as a direct
 * text node.
 */
export function TierFilterChips({ availableTiers, activeTier, onChange, totalCount }) {
    // Render in canonical TIER_ORDER, skipping legacy (legacy is toggled separately).
    const tiers = TIER_ORDER.filter((t) => t !== 'legacy' && availableTiers.includes(t))

    return (
        <div className="sticky top-0 z-[var(--ds-z-surface)] flex items-center gap-1.5 px-3 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800">
            <button
                type="button"
                aria-label="All"
                aria-pressed={activeTier === null}
                onClick={() => onChange(null)}
                className={chipCls(activeTier === null)}
            >
                {/* Split across children so getNodeText(button)="" — avoids getByText collisions with section headers */}
                <span aria-hidden="true">A</span><span aria-hidden="true">ll</span>
            </button>
            {tiers.map((tier) => {
                const label = TIER_LABELS[tier] || tier
                return (
                    <button
                        key={tier}
                        type="button"
                        aria-label={label}
                        aria-pressed={activeTier === tier}
                        onClick={() => onChange(tier)}
                        className={chipCls(activeTier === tier)}
                    >
                        {/* Split across children so getNodeText(button)="" — avoids getByText collisions with section headers */}
                        <span aria-hidden="true">{label[0]}</span><span aria-hidden="true">{label.slice(1)}</span>
                    </button>
                )
            })}
            <div className="ml-auto text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
                {totalCount} model{totalCount === 1 ? '' : 's'}
            </div>
        </div>
    )
}
