/**
 * Editorial eyebrow + title used at the top of each Work Board section card.
 * Mirrors the AIConfig SectionHeader but with its own tonal accent so the
 * two settings tabs are visually related without being identical.
 */
export function WorkBoardSectionHeader({ step, title, description, meta }) {
    return (
        <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
                <div className="flex items-center gap-2 ds-text-micro font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
                    {step && (
                        <span className="font-mono ds-text-micro text-indigo-500/70 dark:text-indigo-400/60">
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
