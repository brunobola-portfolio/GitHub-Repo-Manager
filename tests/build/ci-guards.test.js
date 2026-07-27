/*
 * CI guard meta-tests.
 *
 * The three repo hygiene guards (debug statements, static __mocks__ imports,
 * raw z-index) had no test coverage of their own, which let two silent
 * failure modes accumulate:
 *
 *   1. A regex that no longer matches what it claims to. The z-index guard
 *      once enumerated only the exact contract values (30|40|...|90), so
 *      off-contract values like `z-[45]` and `z-[99]` passed untouched.
 *   2. A file list that resolves to nothing. Every guard exits 0 when handed
 *      zero paths (correct for lint-staged, which may stage no matching
 *      file), so a broken `--all` enumeration would turn the CI gate into a
 *      permanent no-op that still reports green — the same decay that made
 *      the deleted check-bundle-size.mjs useless.
 *
 * These tests assert behaviour, not implementation: each guard is executed as
 * a subprocess exactly the way lint-staged and `npm run guards` invoke it.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const GUARDS = [
    // `minFiles` floors sit well under the real counts at the time of writing
    // (599 src js/jsx, 601 src js/jsx/css, 1141 src+server js/jsx). They are
    // not a coverage target — they exist solely to fail loudly if `--all`
    // stops enumerating, so ordinary file churn must never trip them.
    { script: 'check-debug-statements.mjs', minFiles: 500 },
    { script: 'check-no-static-mock-imports.mjs', minFiles: 250 },
    { script: 'check-no-raw-z-index.mjs', minFiles: 250 },
]

function runGuard(script, args) {
    try {
        const stdout = execFileSync('node', [join('scripts', script), ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { status: 0, stdout, stderr: '' }
    } catch (err) {
        return {
            status: err.status ?? 1,
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? '',
        }
    }
}

describe('CI hygiene guards', () => {
    describe.each(GUARDS)('$script', ({ script, minFiles }) => {
        it('passes over every tracked file (--all)', () => {
            const { status, stdout, stderr } = runGuard(script, ['--all'])
            expect(status, `guard failed:\n${stderr}${stdout}`).toBe(0)
        })

        it(`actually enumerates files in --all mode (>= ${minFiles})`, () => {
            const { stdout } = runGuard(script, ['--all'])
            const match = stdout.match(/(\d+) tracked file\(s\) checked/)
            expect(match, `no file-count line in output:\n${stdout}`).not.toBeNull()
            expect(Number(match[1])).toBeGreaterThanOrEqual(minFiles)
        })

        it('exits 0 when handed no paths (lint-staged with no matching file)', () => {
            expect(runGuard(script, []).status).toBe(0)
        })
    })
})

describe('check-no-raw-z-index detection', () => {
    let dir

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'z-guard-'))
    })

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    function checkSnippet(name, source) {
        const file = join(dir, name)
        writeFileSync(file, source, 'utf8')
        return runGuard('check-no-raw-z-index.mjs', [file])
    }

    // The values that slipped through the old enumerated regex. z-[45] is
    // off-contract entirely; z-[99] shipped in ContextMenu.jsx and silently
    // stacked above --ds-z-ceiling (80).
    it.each(['z-[45]', 'z-[99]', 'z-[100]', 'z-30', 'z-50', 'z-[60]', 'z-999'])(
        'rejects %s',
        (token) => {
            const { status, stderr } = checkSnippet('bad.jsx', `<div className="${token}" />\n`)
            expect(status).toBe(1)
            expect(stderr).toContain(token)
        },
    )

    it('names the specific token to use instead of printing the whole table', () => {
        const { stderr } = checkSnippet('suggest.jsx', '<div className="z-[45]" />\n')
        // 45 falls between --ds-z-composer (40) and --ds-z-overlay (50), so the
        // lowest token at-or-above it is the overlay layer.
        expect(stderr).toContain('z-[var(--ds-z-overlay)]')
        expect(stderr).not.toContain('z-[var(--ds-z-floating)]')
    })

    it('flags a value above the ceiling as unfixable by picking a higher layer', () => {
        const { stderr } = checkSnippet('ceiling.jsx', '<div className="z-[99]" />\n')
        expect(stderr).toContain('z-[var(--ds-z-ceiling)]')
        expect(stderr).toContain('nothing may sit above the ceiling')
    })

    // Low in-flow values coordinate nothing across surfaces and are in active
    // use; flagging them would make the guard unusable.
    it.each(['z-0', 'z-10', 'z-20', 'z-[1]', 'z-[3]'])('allows %s', (token) => {
        expect(checkSnippet('ok.jsx', `<div className="${token}" />\n`).status).toBe(0)
    })

    it('allows the tokenised form', () => {
        const source = '<div className="z-[var(--ds-z-modal)]" />\n'
        expect(checkSnippet('token.jsx', source).status).toBe(0)
    })

    it('ignores variant-prefixed values (focus:/hover: are conditional layers)', () => {
        const source = '<a className="focus:z-50 hover:z-40" />\n'
        expect(checkSnippet('variant.jsx', source).status).toBe(0)
    })

    it('ignores raw values quoted inside comments', () => {
        const source = ['// the previous z-[99] was removed', '/* z-[45] used to live here */', 'export const x = 1'].join('\n')
        expect(checkSnippet('comment.jsx', `${source}\n`).status).toBe(0)
    })

    it('reports every raw value on a line, not just the first', () => {
        const { stderr } = checkSnippet('multi.jsx', '<div className="z-30 z-[45]" />\n')
        expect(stderr).toContain('z-30')
        expect(stderr).toContain('z-[45]')
        expect(stderr).toMatch(/2 raw numeric z-index value\(s\)/)
    })
})

describe('check-debug-statements detection', () => {
    let dir

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'debug-guard-'))
    })

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    function checkSnippet(name, source) {
        const file = join(dir, name)
        writeFileSync(file, source, 'utf8')
        return runGuard('check-debug-statements.mjs', [file])
    }

    it.each(['console.log("x")', 'debugger'])('rejects %s', (stmt) => {
        expect(checkSnippet('bad.js', `${stmt}\n`).status).toBe(1)
    })

    it.each(['console.error("x")', 'console.warn("x")', '// console.log("x")'])(
        'allows %s',
        (stmt) => {
            expect(checkSnippet('ok.js', `${stmt}\n`).status).toBe(0)
        },
    )
})

describe('check-no-static-mock-imports detection', () => {
    let dir

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'mock-guard-'))
    })

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true })
    })

    function checkSnippet(name, source) {
        const file = join(dir, name)
        writeFileSync(file, source, 'utf8')
        return runGuard('check-no-static-mock-imports.mjs', [file])
    }

    it('rejects a static __mocks__ import', () => {
        const source = "import { mockRepos } from '../__mocks__/repos.js'\n"
        expect(checkSnippet('bad.js', source).status).toBe(1)
    })

    it('allows the dynamic import inside an inlined env guard', () => {
        const source = [
            "if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {",
            "    const { mockRepos } = await import('../__mocks__/repos.js')",
            '}',
        ].join('\n')
        expect(checkSnippet('ok.js', `${source}\n`).status).toBe(0)
    })
})
