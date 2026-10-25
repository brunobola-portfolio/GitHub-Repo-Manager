// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    resolveSender,
    supportContact,
    supportFooterParts,
    headerSafe,
    escapeHtml,
    parseMailbox,
    publicSupport,
    PUBLISHER_LICENCE_URL,
} from '../lib/email-identity.js'

const VARS = ['EMAIL_FROM', 'EMAIL_FROM_LICENCES', 'EMAIL_REPLY_TO', 'EMAIL_SUPPORT_URL']

describe('email identity', () => {
    let saved
    beforeEach(() => {
        saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))
        for (const k of VARS) delete process.env[k]
    })
    afterEach(() => {
        for (const k of VARS) {
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
        }
    })

    it('returns null without a usable EMAIL_FROM', () => {
        expect(resolveSender('system')).toBeNull()
        process.env.EMAIL_FROM = 'not an address'
        expect(resolveSender('system')).toBeNull()
    })

    it('on bolalabs.pt: system mail from the no-reply box, replies to the support desk', () => {
        process.env.EMAIL_FROM = 'no-reply@bolalabs.pt'
        expect(resolveSender('system')).toEqual({
            from: '"BolaLabs RepoManager" <no-reply@bolalabs.pt>',
            address: 'no-reply@bolalabs.pt',
            replyTo: 'suporte@bolalabs.pt',
        })
    })

    it('on bolalabs.pt: licence mail from licencas@, never the non-existent licenses@', () => {
        process.env.EMAIL_FROM = 'no-reply@bolalabs.pt'
        const sender = resolveSender('licences')
        expect(sender.from).toBe('"BolaLabs Licences" <licencas@bolalabs.pt>')
        expect(sender.replyTo).toBe('suporte@bolalabs.pt')
        expect(JSON.stringify(sender)).not.toContain('licenses@')
    })

    it('keeps the display name an operator put in EMAIL_FROM', () => {
        process.env.EMAIL_FROM = 'Acme Repos <robot@acme.example>'
        expect(resolveSender('system').from).toBe('"Acme Repos" <robot@acme.example>')
    })

    it('a self-hosted domain gets no vendor Reply-To and one sender for both streams', () => {
        process.env.EMAIL_FROM = 'robot@acme.example'
        const system = resolveSender('system')
        const licences = resolveSender('licences')
        expect(system.replyTo).toBeUndefined()
        expect(licences.address).toBe('robot@acme.example')
        expect(JSON.stringify([system, licences])).not.toContain('bolalabs')
    })

    it('EMAIL_REPLY_TO overrides the default and "none" removes it', () => {
        process.env.EMAIL_FROM = 'no-reply@bolalabs.pt'
        process.env.EMAIL_REPLY_TO = 'Help <help@bolalabs.pt>'
        expect(resolveSender('system').replyTo).toBe('help@bolalabs.pt')
        process.env.EMAIL_REPLY_TO = 'none'
        expect(resolveSender('system').replyTo).toBeUndefined()
    })

    it('ignores an EMAIL_FROM_LICENCES on another domain (DMARC) and says so', () => {
        process.env.EMAIL_FROM = 'robot@acme.example'
        process.env.EMAIL_FROM_LICENCES = 'keys@elsewhere.example'
        const sender = resolveSender('licences')
        expect(sender.address).toBe('robot@acme.example')
        expect(sender.warning).toMatch(/EMAIL_FROM_LICENCES ignored/)
    })

    it('accepts an EMAIL_FROM_LICENCES on the same domain', () => {
        process.env.EMAIL_FROM = 'robot@acme.example'
        process.env.EMAIL_FROM_LICENCES = 'Acme Keys <keys@acme.example>'
        expect(resolveSender('licences').from).toBe('"Acme Keys" <keys@acme.example>')
    })

    it('strips header-breaking characters from display names', () => {
        process.env.EMAIL_FROM = '"Evil\r\nBcc: x@y.z" <robot@acme.example>'
        const { from } = resolveSender('system')
        expect(from).not.toMatch(/[\r\n]/)
    })

    it('support contact: the BolaLabs desk on the house domain, nothing invented elsewhere', () => {
        process.env.EMAIL_FROM = 'no-reply@bolalabs.pt'
        expect(supportContact()).toEqual({
            url: 'https://bolalabs.pt/en/dashboard?view=support&new=1',
            email: 'suporte@bolalabs.pt',
        })
        process.env.EMAIL_FROM = 'robot@acme.example'
        expect(supportContact()).toEqual({})
        expect(supportFooterParts()).toEqual([])
    })

    it('support footer never says "reply" without a Reply-To behind it', () => {
        process.env.EMAIL_FROM = 'robot@acme.example'
        process.env.EMAIL_SUPPORT_URL = 'https://help.acme.example/new'
        const parts = supportFooterParts()
        expect(parts).toEqual(['Need help? ', 'Open a support request at ', { link: { url: 'https://help.acme.example/new', label: 'help.acme.example/new' } }, '.'])
        expect(JSON.stringify(parts)).not.toMatch(/reply/i)
    })

    it('headerSafe flattens CR/LF so a subject cannot start a new header', () => {
        expect(headerSafe('Team\r\nBcc: victim@example.com')).toBe('Team Bcc: victim@example.com')
    })

    it('escapeHtml neutralises markup', () => {
        expect(escapeHtml('<a href="x">t</a> & \'q\'')).toBe('&lt;a href=&quot;x&quot;&gt;t&lt;/a&gt; &amp; &#39;q&#39;')
    })

    it('publicSupport on the house domain: the BolaLabs desk tagged with the product, suporte@ and the sales form', () => {
        process.env.EMAIL_FROM = 'no-reply@bolalabs.pt'
        expect(publicSupport()).toEqual({
            url: 'https://bolalabs.pt/en/dashboard?view=support&new=1&product=repomanager',
            email: 'suporte@bolalabs.pt',
            salesUrl: 'https://bolalabs.pt/en/contact?topic=repomanager',
        })
    })

    it('publicSupport elsewhere: no BolaLabs desk or mailbox, only what the operator set, and the publisher licence page', () => {
        process.env.EMAIL_FROM = 'no-reply@acme.example'
        expect(publicSupport()).toEqual({ salesUrl: PUBLISHER_LICENCE_URL })
        process.env.EMAIL_SUPPORT_URL = 'https://desk.acme.example/new'
        process.env.EMAIL_REPLY_TO = 'help@acme.example'
        expect(publicSupport()).toEqual({ url: 'https://desk.acme.example/new', email: 'help@acme.example', salesUrl: PUBLISHER_LICENCE_URL })
        expect(JSON.stringify(publicSupport())).not.toMatch(/suporte@|dashboard?view=support/)
    })

    it('publicSupport without any sender configured shows no contact', () => {
        expect(publicSupport()).toEqual({ salesUrl: PUBLISHER_LICENCE_URL })
    })

    it('parseMailbox reads both forms', () => {
        expect(parseMailbox('a@b.co')).toEqual({ name: '', address: 'a@b.co' })
        expect(parseMailbox('"A B" <a@b.co>')).toEqual({ name: 'A B', address: 'a@b.co' })
    })
})
