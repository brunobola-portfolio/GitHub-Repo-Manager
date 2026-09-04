/*
 * One accent ramp, and the mark drawn once.
 *
 * The app shipped a violet-gradient logo it drew by hand while brand/ held a
 * lime mark, and used indigo, violet and purple interchangeably for the same
 * job — three accent hues next to a mark that matched none of them. Both are
 * the kind of drift that returns one component at a time, so both are gated.
 *
 * What is deliberately NOT gated: emerald / amber / rose / slate. Those are the
 * status vocabulary (passing, attention, failing, neutral) and colour there is
 * a signal, not decoration. Nor are the language colours in
 * src/utils/languageColors.js — a categorical chart needs a hue per category,
 * and folding those into one ramp makes the chart unreadable.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Accent families that no longer have a job in this product. */
const RETIRED = ['indigo', 'violet', 'purple', 'fuchsia', 'sky', 'cyan', 'pink', 'teal']
const UTILITY = new RegExp(`\\b(${RETIRED.join('|')})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`)

/** Literal hexes from the retired identity — the logo's gradient stops. */
const RETIRED_HEXES = ['#4f46e5', '#6366f1', '#818cf8', '#4338ca', '#a5b4fc', '#312e81', '#4c1d95', '#1e1b4b', '#a78bfa', '#c084fc']

/**
 * The same colours written as rgb()/rgba() triplets. The utility and hex
 * checks above never saw these, which is how violet-500 came back as the
 * pricing preview's radial wash and indigo-500 as the PR review progress
 * ring (2026-09-04 panel). 400/500/600 of every retired family.
 */
const RETIRED_RGB = [
    [129, 140, 248], [99, 102, 241], [79, 70, 229],      // indigo
    [167, 139, 250], [139, 92, 246], [124, 58, 237],     // violet
    [192, 132, 252], [168, 85, 247], [147, 51, 234],     // purple
    [232, 121, 249], [217, 70, 239], [192, 38, 211],     // fuchsia
    [56, 189, 248], [14, 165, 233], [2, 132, 199],       // sky
    [34, 211, 238], [6, 182, 212], [8, 145, 178],        // cyan
    [244, 114, 182], [236, 72, 153], [219, 39, 119],     // pink
    [45, 212, 191], [20, 184, 166], [13, 148, 136],      // teal
]
const RGB_TRIPLET = new RegExp(
    `rgba?\\(\\s*(?:${RETIRED_RGB.map(([r, g, b]) => `${r}\\s*[, ]\\s*${g}\\s*[, ]\\s*${b}`).join('|')})\\b`,
)

const ALLOWED = new Set([
    // Categorical data, not brand. Each language needs its own hue.
    'src/utils/languageColors.js',
])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(jsx?|css)$/.test(p)) out.push(p)
    }
    return out
}

const FILES = walk('src').filter((p) => !ALLOWED.has(p))

const NEWLINE = String.fromCharCode(10)
const DIMMED = new RegExp(String.raw`\btext-white/\d+\b`)

describe('the product has one accent ramp', () => {
    it('finds source files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(200)
    })

    it('uses no retired accent utility', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split('\n').forEach((line, i) => {
                // index.css explains the replacement and names what it replaced.
                if (file === 'src/index.css') return
                const hit = line.match(UTILITY)
                if (hit) offenders.push(`${file}:${i + 1} ${hit[0]}`)
            })
        }
        expect(offenders, `use brand-* instead:\n${offenders.slice(0, 20).join('\n')}`).toEqual([])
    })

    it('carries no literal from the retired violet identity', () => {
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8').toLowerCase()
            for (const hex of RETIRED_HEXES) {
                if (src.includes(hex)) offenders.push(`${file} ${hex}`)
            }
        }
        expect(offenders).toEqual([])
    })

    it('carries no retired colour as an rgb()/rgba() triple either', () => {
        // The hex check above let eight survive for four releases: the repo
        // card's selection ring was `rgba(129, 140, 248, …)` with a comment
        // reading "brand-400 ring" — indigo-400, by its channels. Same colour,
        // different spelling, and a screenshot is the only thing that notices.
        // Then a second pair got past THIS check: violet-500 was not in the
        // list, and indigo-500 was written with the CSS4 space syntax
        // `rgb(99 102 241)` that the comma-only pattern skipped. RETIRED_RGB
        // now covers 400/500/600 of every retired family, in either syntax.
        const pattern = RGB_TRIPLET
        const offenders = []
        for (const file of FILES) {
            const src = readFileSync(file, 'utf8')
            src.split(/\r?\n/).forEach((line, i) => {
                if (pattern.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`)
            })
        }
        expect(offenders).toEqual([])
    })

    it('defines the brand ramp it tells everyone to use', () => {
        const css = readFileSync('src/index.css', 'utf8')
        for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
            expect(css, `--color-brand-${step} is missing`).toMatch(new RegExp(`--color-brand-${step}\\s*:`))
        }
    })

    it('keeps the two steps docs/BRAND.md names by value', () => {
        // #8fd23f on dark and #3f7d12 on light are the spec's coloured-word
        // tokens. If the ramp drifts off them the spec and the product disagree
        // about what the brand green is.
        const css = readFileSync('src/index.css', 'utf8')
        expect(css).toMatch(/--color-brand-300\s*:\s*#8fd23f/)
        expect(css).toMatch(/--color-brand-600\s*:\s*#3f7d12/)
    })

    it('never puts the lime in the UI ramp', () => {
        // The lime is 2.12:1 under white. It is the mark and the badge fill;
        // a filled button reaching for it would fail AA on contact.
        const css = readFileSync('src/index.css', 'utf8')
        expect(css).not.toMatch(/--color-brand-\d+\s*:\s*#7fc528/i)
    })
})

describe('text on a brand fill is never dimmed', () => {
    it('has no partial-opacity white left in the app', () => {
        // Every one of these sat on a brand fill. Under indigo the base was
        // 6.29:1 and a 10% knock-down still cleared AA; the brand green's base
        // is 5.06:1, so `text-white/90` measures 4.43 and axe fails the view.
        const offenders = []
        // Markup only: the class can only appear in JSX. design-system.css
        // names it in the comment that explains why it is banned.
        for (const file of FILES.filter((f) => /\.jsx?$/.test(f))) {
            readFileSync(file, 'utf8').split(NEWLINE).forEach((line, i) => {
                const hit = line.match(DIMMED)
                if (hit) offenders.push(`${file}:${i + 1} ${hit[0]}`)
            })
        }
        expect(offenders, `use text-white, or a --ds-badge-* pair: ${offenders.join(', ')}`).toEqual([])
    })
})

describe('the mark is the generated one', () => {
    it('AppLogo composes BrandMark rather than drawing anything', () => {
        const src = readFileSync('src/components/AppLogo.jsx', 'utf8')
        expect(src).toContain("from './ui/BrandMark'")
        // No paths, no gradients, no blurs — the previous logo had four
        // gradients and three blurs, which is why it died at 16 px.
        expect(src).not.toMatch(/<path|<linearGradient|<radialGradient|feGaussianBlur|<circle|<line\b/)
    })

    it('BrandMark is generated, not hand-written', () => {
        const src = readFileSync('src/components/ui/BrandMark.jsx', 'utf8')
        expect(src.startsWith('// GENERATED by scripts/gen-brand.mjs')).toBe(true)
    })

    it('BrandMark carries both optical cuts and picks between them by size', () => {
        const src = readFileSync('src/components/ui/BrandMark.jsx', 'utf8')
        expect(src).toContain('DISPLAY_CUT')
        expect(src).toContain('SMALL_CUT')
        expect(src).toMatch(/size < CUT_BOUNDARY \? SMALL_CUT : DISPLAY_CUT/)
        // The small cut is a redraw, not the display cut scaled: no ring.
        const small = src.slice(src.indexOf('const SMALL_CUT'))
        expect(small).not.toContain('opacity="0.45"')
    })

    it('nothing in the app renders GitHub\'s mark as the product icon', () => {
        // RepoManager manages GitHub and is not affiliated with it. The nav
        // shipped an Octocat in a brand-coloured tile, which reads as a
        // GitHub product.
        for (const file of ['src/components/Landing/LandingPage.jsx', 'src/components/Header.jsx']) {
            const src = readFileSync(file, 'utf8')
            const brandTile = src.indexOf('<AppLogo')
            expect(brandTile, `${file} does not render the product mark`).toBeGreaterThan(-1)
        }
        const landing = readFileSync('src/components/Landing/LandingPage.jsx', 'utf8')
        // A Github glyph is fine as a link affordance ("View on GitHub"); it is
        // not fine inside the identity block next to the wordmark.
        const navBlock = landing.slice(landing.indexOf('<AppLogo'), landing.indexOf('Repo Manager'))
        expect(navBlock).not.toContain('<Github')
    })
})
