/**
 * RowIconBadge — small tinted icon container used on the left edge of
 * list rows, section headers, and the leading slot of cards. Before
 * this primitive, the same `p-X rounded-Y bg-{tone}-{shade} text-{tone}-{shade}`
 * snippet was inlined across 15+ files with subtle drift.
 *
 * Two surface treatments:
 *   - `solid` (default): bg-{tone}-100 / dark:bg-{tone}-900/30 — opaque
 *     pastel tile, the row-icon look used in WorkBoard tabs, Sidebar
 *     activity feed and release badges.
 *   - `soft`: bg-{tone}-500/10 — translucent tile, the section-header
 *     look used in DashboardPremium category icons, Settings headers,
 *     and stat-card icon slots.
 *
 *   <RowIconBadge icon={GitPullRequest} tone="purple" />            // solid sm
 *   <RowIconBadge icon={Heart} tone="emerald" size="lg" surface="soft" />
 */

const SOLID_TONES = {
    purple:  'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400',
    violet:  'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400',
    amber:   'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
    blue:    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    indigo:  'bg-brand-100 dark:bg-brand-900/30 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]',
    sky:     'bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400',
    rose:    'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
    red:     'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    slate:   'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
}

const SOFT_TONES = {
    purple:  'bg-brand-500/10  text-brand-600 dark:text-brand-400',
    violet:  'bg-brand-500/15  text-brand-600 dark:text-brand-400',
    amber:   'bg-amber-500/10   text-amber-600 dark:text-amber-400',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    blue:    'bg-blue-500/10    text-blue-600 dark:text-blue-400',
    indigo:  'bg-brand-500/10  text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]',
    sky:     'bg-brand-500/10     text-brand-600 dark:text-brand-400',
    rose:    'bg-rose-500/10    text-rose-600 dark:text-rose-400',
    red:     'bg-red-500/10     text-red-600 dark:text-red-400',
    slate:   'bg-slate-500/10   text-slate-600 dark:text-slate-300',
}

const SIZE_CLASSES = {
    sm: { wrap: 'p-1.5 rounded-lg',          icon: 'w-3.5 h-3.5' },
    md: { wrap: 'p-2 rounded-xl',            icon: 'w-4 h-4' },
    lg: { wrap: 'w-10 h-10 rounded-xl',      icon: 'w-5 h-5' },
    xl: { wrap: 'w-12 h-12 rounded-2xl',     icon: 'w-6 h-6' },
}

export function RowIconBadge({
    icon: Icon,
    tone = 'indigo',
    size = 'sm',
    surface = 'solid',
    className = '',
    iconClassName = '',
    ariaLabel,
}) {
    const palette = surface === 'soft' ? SOFT_TONES : SOLID_TONES
    const toneClass = palette[tone] || palette.indigo
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
