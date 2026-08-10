/*
 * The product mark, as the app renders it.
 *
 * This file used to draw its own logo — four gradients, three blurs, a
 * different silhouette from every file in brand/. It is now a thin composition
 * over the GENERATED mark (src/components/ui/BrandMark.jsx, emitted by
 * scripts/gen-brand.mjs) so the app and the media kit cannot disagree about
 * what the product looks like.
 *
 * Never draw the mark here. Change the geometry in scripts/gen-brand.mjs and
 * run `npm run gen:brand`. Full rules: docs/BRAND.md.
 */
import { BrandMark } from './ui/BrandMark'

/**
 * The mark on the brand ground — the app-icon shape, for headers and anywhere
 * the surrounding surface is not guaranteed.
 *
 * The ground is fixed, never themed: the tile IS the icon, and an icon that
 * changes colour with the page is not an icon. Structure is paper, node is the
 * lime — the same pairing as brand/tile-windows.svg, which is what a user sees
 * pinned to a taskbar.
 *
 * `size` is the tile edge in pixels. The mark occupies ~72% of it, matching
 * `markScale` in the generator, so a 34 px tile carries a 24 px mark — and the
 * mark component picks its own optical cut from that number.
 */
export function AppLogo({ size = 34, className = '', title = 'RepoManager' }) {
    const mark = Math.round(size * 0.72)
    return (
        <span
            className={`inline-flex items-center justify-center shrink-0 bg-[color:var(--ds-brand-ground)] ${className}`}
            style={{
                width: size,
                height: size,
                // 21.9% — the favicon tile's 14-on-64, not the Windows tile's
                // 11.7%. Both are in the kit; the favicon is the one drawn at
                // this size, and a corner tuned for a 256 px icon reads as a
                // hard square in a 34 px header.
                borderRadius: Math.round(size * 0.219),
                // Paper structure on the fixed dark ground, in both themes.
                '--brand-structure': 'var(--ds-brand-paper)',
                '--brand-node': 'var(--ds-brand-lime)',
            }}
        >
            <BrandMark size={mark} title={title} />
        </span>
    )
}

/**
 * The bare mark, inheriting its structure colour from the text around it.
 *
 * For places that already own their ground — a coloured button, a list row, a
 * monochrome print. The node keeps the lime unless the caller overrides
 * --brand-node, because the node is the only carrier of brand recognition.
 */
export function AppLogoIcon({ size = 24, className = '', title = 'RepoManager' }) {
    return <BrandMark size={size} className={className} title={title} />
}
