import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderEmail, EMAIL_PALETTE } from '../lib/email-layout.js'

const ENV_KEYS = ['EMAIL_FROM', 'EMAIL_REPLY_TO', 'EMAIL_SUPPORT_URL']
let saved

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

const spec = (over = {}) => ({
    subject: 'Subject',
    preheader: 'Preview line',
    heading: 'Heading',
    blocks: [{ p: 'Body.' }],
    why: 'Why you got this.',
    ...over,
})

describe('renderEmail', () => {
    it('escapes every segment: user input never becomes markup in a DKIM-signed mail', () => {
        const evil = '<a href="https://evil.example">x</a>'
        const { html, text } = renderEmail(spec({
            subject: evil,
            preheader: evil,
            heading: evil,
            blocks: [
                { p: [evil, { strong: evil }, { code: evil }] },
                { h: evil },
                { secret: evil },
                { facts: [{ label: evil, value: evil }] },
                { items: [{ title: evil, meta: evil }] },
                { note: evil },
                { button: { label: evil, url: 'https://ok.example/"onmouseover="x' } },
            ],
            why: evil,
        }))
        expect(html).not.toContain('<a href="https://evil.example">')
        expect(html).not.toContain('"onmouseover="')
        expect(html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;')
        // The text part is not HTML: the raw string is correct there.
        expect(text).toContain(evil)
    })

    it('says the same things in both parts', () => {
        const { html, text } = renderEmail(spec({
            blocks: [
                { p: ['Plain ', { strong: 'bold' }, ' and ', { link: { url: 'https://example.test/doc', label: 'the doc' } }] },
                { secret: 'grm_lic_abc.def' },
                { facts: [{ label: 'Valid until', value: '2031-01-17' }] },
                { items: [{ title: 'acme/api #5', meta: 'Fix it' }] },
                { button: { label: 'Open', url: 'https://app.example.test' } },
            ],
        }))
        for (const s of ['bold', 'grm_lic_abc.def', 'Valid until', '2031-01-17', 'acme/api #5', 'Fix it', 'Why you got this.']) {
            expect(html).toContain(s)
            expect(text).toContain(s)
        }
        expect(text).toContain('the doc (https://example.test/doc)')
        expect(text).toContain('Open: https://app.example.test')
        expect(text).not.toMatch(/<[a-z]/i)
    })

    it('never uses the brand lime as a text colour (2.2:1 on white)', () => {
        const { html } = renderEmail(spec({ eyebrow: 'Pro plan', blocks: [{ p: [{ link: { url: 'https://x.test' } }] }, { button: { label: 'Go', url: 'https://x.test' } }] }))
        expect(html).toContain(EMAIL_PALETTE.LIME)
        expect(html).not.toMatch(new RegExp(`(?<![-\\w])color:\\s*${EMAIL_PALETTE.LIME}`, 'i'))
    })

    it('loads nothing remote: no images, no tracking pixel', () => {
        const { html } = renderEmail(spec())
        expect(html).not.toMatch(/<img|url\(|<link/i)
    })

    it('carries the preheader hidden, the subject as the title, and a dark-mode block', () => {
        const { html } = renderEmail(spec())
        expect(html).toMatch(/<div style="display:none;[^"]*">Preview line/)
        expect(html).toContain('<title>Subject</title>')
        expect(html).toContain('prefers-color-scheme:dark')
        expect(html).toContain('[data-ogsc]')
    })

    it('adds the support line only when the operator configured somewhere to send people', () => {
        process.env.EMAIL_FROM = 'robot@acme.example'
        expect(renderEmail(spec()).text).not.toMatch(/support|reply/i)

        process.env.EMAIL_SUPPORT_URL = 'https://help.acme.example/new'
        const { html, text } = renderEmail(spec({ help: 'Questions?' }))
        expect(text).toContain('Questions? Open a support request at https://help.acme.example/new.')
        expect(html).toContain('href="https://help.acme.example/new"')

        expect(renderEmail(spec({ help: false })).text).not.toContain('support request')
    })

    it('shows a list block with nothing in it as one line, not an empty panel', () => {
        const { html, text } = renderEmail(spec({ blocks: [{ items: [], empty: 'All clear.' }] }))
        expect(html).toContain('All clear.')
        expect(text).toContain('All clear.')
    })
})
