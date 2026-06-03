import { twMerge } from 'tailwind-merge'

/**
 * Heading — the single display-typography primitive.
 *
 * Applies the Mona Sans display face (`.ds-font-display`) + tracking + the
 * canonical slate foreground so every title reads consistently, instead of each
 * surface re-typing `ds-font-display font-semibold tracking-tight text-slate-900
 * dark:text-slate-100`. Defaults are overridable via `className` (tailwind-merge
 * resolves conflicts, so a caller can pass `font-bold` or a different size/colour).
 *
 * @param {object} props
 * @param {'h1'|'h2'|'h3'|'h4'|'p'|'span'} [props.as='h2'] - rendered element
 * @param {string} [props.className]
 */
export function Heading({ as: Tag = 'h2', className = '', children, ...props }) {
  return (
    <Tag
      className={twMerge(
        'ds-font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
}
