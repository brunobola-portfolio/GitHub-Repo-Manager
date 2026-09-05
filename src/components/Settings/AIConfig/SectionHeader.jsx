/**
 * SectionHeader — editorial "eyebrow + title" used at the top of each card
 * in the AI Configuration layout. The numbered step gives the page a
 * deliberate, structured rhythm instead of a flat list of cards.
 */
export function SectionHeader({ step, title, description, meta }) {
    return (
        <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
                <div className="flex items-center gap-2 ds-text-micro font-semibold uppercase tracking-[0.18em] text-[color:var(--ds-accent-brand)] dark:text-brand-300">
                    {step && (
                        <span className="font-mono ds-text-micro text-[color:var(--ds-accent-brand)] dark:text-brand-300">
                            {String(step).padStart(2, '0')}
                        </span>
                    )}
                    <span>{title}</span>
                </div>
                {description && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {description}
                    </p>
                )}
            </div>
            {meta && <div className="shrink-0">{meta}</div>}
        </div>
    )
}
