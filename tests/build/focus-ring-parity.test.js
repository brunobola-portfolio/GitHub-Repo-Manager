/*
 * One focus indicator (2026-09-04 panel, finding F02 / U28).
 *
 * `.ds-focus-ring` (src/design-system.css) is the one focus treatment the
 * design system defines — brand-green 2px outline + a soft glow, correct in
 * both themes. Everything that does not opt in falls back to the browser's
 * default outline (Chrome's blue ring, `outline: 3px none` in some computed
 * states), so a keyboard user sees two different focus styles in one app, or
 * on the dashboard's stat cards, none at all.
 *
 * This gate treats any raw `<button>`/`<a>`/`role="button"` div or span that
 * carries its own padding (`px-`/`py-`/`p-`) as "styled" and requires it to
 * carry `ds-focus-ring`, `focus-visible:`, `focus:ring`, or `focus:outline`.
 * `<Button>` itself bakes `ds-focus-ring` into every variant, so anything
 * built on the shared primitive already passes; this only catches hand-rolled
 * controls that bypass it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (p.endsWith('.jsx')) out.push(p)
    }
    return out
}

// The mark is GENERATED (scripts/gen-brand.mjs) and not an interactive
// control — it has no place opting into an interaction focus style.
const SKIP_FILES = new Set(['src/components/ui/BrandMark.jsx'])

const FILES = walk('src/components').filter((f) => !SKIP_FILES.has(f))

// The boundary class also matches a leading quote/brace/backtick, not just
// whitespace — this scans the whole opening-tag text rather than an isolated
// className value, and the first class in a literal sits right after the
// opening `"`/`'`/`` ` `` (`className="p-1 rounded…`) with no space before it.
const FOCUS_RE = /(^|[\s"'`])(ds-focus-ring|focus-visible:|focus:ring|focus:outline)/
const PADDING_RE = /(^|[\s"'`])(px-|py-|p-)\S/
const TAG_NAMES = new Set(['button', 'a', 'div', 'span'])
const ROLE_BUTTON_RE = /\brole\s*=\s*(["'])button\1/

/**
 * Extracts each JSX opening tag's raw source (`<name ...>` / `<name .../>`),
 * tracking string/template-literal quoting and `{}` nesting so a `>` inside
 * a JSX expression (`{x > 0}`, an arrow function's `=>`) never ends the tag
 * early. This is a lexer for opening tags only — it never looks at children,
 * which is all this gate needs: the className that would carry the focus
 * class always lives on the opening tag itself.
 */
function extractOpeningTags(src) {
    const tags = []
    const startRe = /<([A-Za-z][\w.]*)(?=[\s/>])/g
    let m
    while ((m = startRe.exec(src))) {
        const name = m[1]
        if (!TAG_NAMES.has(name)) continue
        const start = m.index
        let i = m.index + m[0].length
        let braceDepth = 0
        let quote = null
        for (; i < src.length; i++) {
            const c = src[i]
            if (quote) {
                if (c === '\\') { i++; continue }
                if (c === quote) quote = null
                continue
            }
            if (c === '"' || c === "'" || c === '`') { quote = c; continue }
            if (c === '{') { braceDepth++; continue }
            if (c === '}') { braceDepth--; continue }
            if (braceDepth === 0 && c === '>') { i++; break }
        }
        tags.push({ name, text: src.slice(start, i), start })
    }
    return tags
}

function findViolations(files) {
    const offenders = []
    for (const file of files) {
        const src = readFileSync(file, 'utf8')
        for (const tag of extractOpeningTags(src)) {
            if (tag.name === 'div' || tag.name === 'span') {
                if (!ROLE_BUTTON_RE.test(tag.text)) continue
            }
            if (!PADDING_RE.test(tag.text)) continue // not "styled" per F02's definition
            if (FOCUS_RE.test(tag.text)) continue // already opts in
            const line = src.slice(0, tag.start).split('\n').length
            offenders.push({ file, line, tag: tag.name, snippet: tag.text.replace(/\s+/g, ' ').slice(0, 140) })
        }
    }
    return offenders
}

/**
 * Files not yet fixed in the 2026-09-05 remediation pass because they sit in
 * another agent's concurrent editing scope for that session (Settings/**,
 * Audit/**, RepoList/RepoFilterBar.jsx, WorkBoard/filters/**) — touching them risked
 * clobbering unrelated in-flight work. Allowlisted at file granularity
 * (rather than by line) because that concurrent work reflows line numbers
 * and, in a couple of cases, the class strings themselves inside these
 * exact files. Revisit once that work lands.
 */
const ALLOWLIST = [
    // Empty since the concurrent feature pass finished and the codemod ran
    // over the files it had reserved. Add an entry only with a reason.
]
const ALLOWLISTED_FILES = new Set(ALLOWLIST.map((a) => a.file))

describe('every styled control carries the one focus indicator', () => {
    it('finds source files at all (guards the walker itself)', () => {
        expect(FILES.length).toBeGreaterThan(200)
    })

    it('has no un-allowlisted button/link/role=button without a focus class', () => {
        const offenders = findViolations(FILES).filter((o) => !ALLOWLISTED_FILES.has(o.file))
        const msg = offenders
            .slice(0, 20)
            .map((o) => `${o.file}:${o.line} [${o.tag}] ${o.snippet}`)
            .join('\n')
        expect(offenders, `add ds-focus-ring (and rounded if unrounded):\n${msg}`).toEqual([])
    })

    it('keeps no stale allowlist entry', () => {
        const violations = findViolations(FILES)
        const violatingFiles = new Set(violations.map((v) => v.file))
        const stale = ALLOWLIST.filter((a) => !violatingFiles.has(a.file))
        expect(stale, `these files no longer need the allowlist — remove them:\n${stale.map((s) => s.file).join('\n')}`).toEqual([])
    })

    it('every allowlist entry names a file that actually exists', () => {
        for (const { file } of ALLOWLIST) {
            expect(() => statSync(file), `${file} does not exist`).not.toThrow()
        }
    })
})
