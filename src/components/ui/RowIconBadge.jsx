/**
 * RowIconBadge — small tinted-square icon container used on the left
 * edge of list rows (PR rows, issue rows, activity events, sidebar
 * notification rows). Before this primitive, the same
 * `p-1.5 rounded-lg bg-{tone}-100 dark:bg-{tone}-900/30 text-{tone}-600
 * dark:text-{tone}-400` snippet was repeated across 8+ files with
 * subtle drift (some used `mt-0.5`, some `rounded-md` instead of
 * `rounded-lg`, some forgot `flex-shrink-0`).
 *
 * Pass the lucide icon component as `icon` and pick a tone. The size
 * defaults to `sm` (32px tile, 14px icon) which matches the current
 * row designs; bump to `md` (36px tile, 18px icon) when the row has
 * larger primary content.
 *
 *   <RowIconBadge icon={GitPullRequest} tone="purple" />
 *   <RowIconBadge icon={CircleDot} tone="amber" size="md" />
 */

const TONE_CLASSES = {
    purple:  'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    blue:    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    indigo:  'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    sky:     'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
    rose:    'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
    red:     'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    slate:   'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
}

const SIZE_CLASSES = {
    sm: { wrap: 'p-1.5 rounded-lg', icon: 'w-3.5 h-3.5' },
    md: { wrap: 'p-2 rounded-xl',   icon: 'w-4 h-4' },
    lg: { wrap: 'p-2.5 rounded-xl', icon: 'w-5 h-5' },
}

export function RowIconBadge({
    icon: Icon,
    tone = 'indigo',
    size = 'sm',
    className = '',
    iconClassName = '',
    ariaLabel,
}) {
    const toneClass = TONE_CLASSES[tone] || TONE_CLASSES.indigo
    const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm
    return (
        <span
            aria-hidden={ariaLabel ? undefined : 'true'}
            aria-label={ariaLabel}
            role={ariaLabel ? 'img' : undefined}
            className={`shrink-0 inline-flex items-center justify-center ${sizeClass.wrap} ${toneClass} ${className}`.trim()}
        >
            {Icon && <Icon className={`${sizeClass.icon} ${iconClassName}`.trim()} />}
        </span>
    )
}
