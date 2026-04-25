const MAX_WIDTH = {
    md: 'max-w-3xl',
    lg: 'max-w-4xl',
    xl: 'max-w-5xl',
    '2xl': 'max-w-6xl',
    '3xl': 'max-w-7xl',
    full: 'max-w-none',
}

const VERTICAL = {
    none: 'py-0',
    tight: 'py-4',
    default: 'py-6 sm:py-8',
    spacious: 'py-10 sm:py-14',
    landing: 'py-16 sm:py-24',
}

const HORIZONTAL = {
    tight: 'px-3',
    default: 'px-4 sm:px-6',
    spacious: 'px-4 sm:px-6 lg:px-8',
}

/**
 * PageShell — single source of truth for page-level wrapper styles.
 *
 * Standardises max-width, horizontal padding, and vertical padding so every
 * page of the app aligns the same way regardless of which engineer or which
 * iteration shipped it. The audit found `max-w-6xl mx-auto p-6`,
 * `max-w-7xl ... p-6`, `max-w-6xl px-4 sm:px-6 py-16` and several more
 * variants used for the same role.
 *
 * Defaults: `max-w-6xl` content column, responsive horizontal padding,
 * `py-6 sm:py-8` vertical rhythm — the most common combination in the
 * codebase as of the audit.
 *
 * @param {object} props
 * @param {'md'|'lg'|'xl'|'2xl'|'3xl'|'full'} [props.maxWidth]
 * @param {'tight'|'default'|'spacious'} [props.padding]
 * @param {'none'|'tight'|'default'|'spacious'|'landing'} [props.verticalPadding]
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export function PageShell({
    maxWidth = '2xl',
    padding = 'spacious',
    verticalPadding = 'default',
    as: Tag = 'div',
    className = '',
    children,
    ...rest
}) {
    const widthClass = MAX_WIDTH[maxWidth] ?? MAX_WIDTH['2xl']
    const horizontalClass = HORIZONTAL[padding] ?? HORIZONTAL.spacious
    const verticalClass = VERTICAL[verticalPadding] ?? VERTICAL.default
    return (
        <Tag {...rest} className={`mx-auto ${widthClass} ${horizontalClass} ${verticalClass} ${className}`.trim()}>
            {children}
        </Tag>
    )
}
