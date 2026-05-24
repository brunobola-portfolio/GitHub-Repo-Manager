/**
 * Shared visual contract for page-level headers.
 *
 * The audit found six different H1 sizes for the same role:
 *   text-2xl / text-3xl / text-4xl / responsive 2xl→3xl→4xl / md:4xl
 * mixed across Admin, Teams, Setup, Dashboard, WorkBoard, RepoDetail. This
 * primitive consolidates them so every "page-level title" looks the same.
 *
 * Pattern:
 *   - Optional eyebrow (uppercase tracking-wide indigo) above the title for
 *     editorial framing — already used by AIConfigSection / WorkBoard.
 *   - H1 with display font + responsive size (2xl on mobile, 4xl on lg).
 *   - Optional description paragraph below.
 *   - Optional `actions` slot (e.g. Refresh / New buttons) on the right.
 */
export function PageHeader({
    eyebrow,
    title,
    description,
    icon: Icon,
    actions,
    align = 'left',
    gradient: _gradient,
    titleAccessory,
    className = '',
}) {
    const titleClass = `mt-1 text-xl font-semibold tracking-tight ds-font-display text-slate-900 dark:text-slate-100 ${titleAccessory ? 'truncate' : ''}`.trim()

    return (
        <header className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6 ${className}`.trim()}>
            <div className={`min-w-0 ${align === 'center' ? 'text-center mx-auto' : ''}`}>
                {(eyebrow || Icon) && (
                    <div className={`flex items-center gap-2 ds-text-micro font-semibold uppercase tracking-[0.22em] text-indigo-600 dark:text-indigo-300 ${align === 'center' ? 'justify-center' : ''}`}>
                        {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
                        {eyebrow && <span>{eyebrow}</span>}
                    </div>
                )}
                {titleAccessory ? (
                    <div className="mt-1 flex items-center gap-3 flex-wrap min-w-0">
                        <h1 className={titleClass}>{title}</h1>
                        {titleAccessory}
                    </div>
                ) : (
                    <h1 className={titleClass}>{title}</h1>
                )}
                {description && (
                    <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                        {description}
                    </p>
                )}
            </div>
            {actions && (
                <div className="flex items-center gap-2 shrink-0">
                    {actions}
                </div>
            )}
        </header>
    )
}
