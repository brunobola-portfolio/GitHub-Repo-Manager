/*
 * The DevToolkit renders a ready-to-paste `git commit -m "…"`. The app never
 * runs it; a human does. That is precisely why the quoting has to hold — the
 * content is model-generated, and a message ending in a backslash used to
 * swallow the closing quote and spill the rest of the line into arguments.
 */
import { describe, it, expect } from 'vitest'
import { shellQuote } from '../../src/utils/shellQuote'

const BACKSLASH = String.fromCharCode(92)
const QUOTE = String.fromCharCode(34)

/** Count double quotes that are not themselves escaped. */
function unescapedQuotes(s) {
    let count = 0
    for (let i = 0; i < s.length; i += 1) {
        if (s[i] === BACKSLASH) { i += 1; continue }
        if (s[i] === QUOTE) count += 1
    }
    return count
}

describe('shellQuote', () => {
    it('leaves ordinary text alone', () => {
        expect(shellQuote('fix: tighten the guard')).toBe('fix: tighten the guard')
    })

    it('escapes the backslash before the quote, not after', () => {
        // 'a\' followed by our '"' becomes 'a\"' if only the quote is escaped:
        // the content's backslash escapes our escape and the quote goes live.
        expect(shellQuote(`a${BACKSLASH}`)).toBe(`a${BACKSLASH}${BACKSLASH}`)
        expect(shellQuote(`say ${QUOTE}hi${QUOTE}`)).toBe(`say ${BACKSLASH}${QUOTE}hi${BACKSLASH}${QUOTE}`)
    })

    it('never lets the closing delimiter escape', () => {
        const payloads = [
            `a${BACKSLASH}`,
            `a${BACKSLASH}${QUOTE}`,
            `${BACKSLASH}${BACKSLASH}`,
            `x${QUOTE}y`,
            `end${BACKSLASH}${BACKSLASH}${BACKSLASH}`,
        ]
        for (const payload of payloads) {
            const line = `${QUOTE}${shellQuote(payload)}${QUOTE}`
            expect(unescapedQuotes(line), JSON.stringify(payload)).toBe(2)
        }
    })

    it('defuses the two expansions that still run inside double quotes', () => {
        expect(shellQuote('$(rm -rf /)')).toBe(`${BACKSLASH}$(rm -rf /)`)
        expect(shellQuote('`id`')).toBe(`${BACKSLASH}\`id${BACKSLASH}\``)
        expect(shellQuote('$HOME')).toBe(`${BACKSLASH}$HOME`)
    })

    it('coerces nullish input rather than throwing', () => {
        expect(shellQuote(null)).toBe('')
        expect(shellQuote(undefined)).toBe('')
    })
})
