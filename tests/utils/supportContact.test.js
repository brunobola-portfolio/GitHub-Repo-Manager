/*
 * The contacts the web app shows come from the shell the server rendered
 * (<meta name="grm-support">). A self-hosted build with nothing configured
 * used to send every "contact support" click to the maintainer's inbox.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSupport, supportHref, supportLabel, salesHref, resetSupportCache } from '../../src/utils/supportContact.js'

function setMeta(content) {
    document.head.querySelectorAll('meta[name="grm-support"]').forEach((m) => m.remove())
    if (content !== undefined) {
        const meta = document.createElement('meta')
        meta.setAttribute('name', 'grm-support')
        meta.setAttribute('content', typeof content === 'string' ? content : JSON.stringify(content))
        document.head.appendChild(meta)
    }
    resetSupportCache()
}

const HOUSE = {
    url: 'https://bolalabs.pt/en/dashboard?view=support&new=1&product=repomanager',
    email: 'suporte@bolalabs.pt',
    salesUrl: 'https://bolalabs.pt/en/contact?topic=repomanager',
}

describe('supportContact', () => {
    beforeEach(() => setMeta(undefined))
    afterEach(() => {
        vi.unstubAllGlobals()
        setMeta(undefined)
    })

    it('with nothing configured there is no contact, only the publisher licence page', () => {
        expect(getSupport()).toEqual({ salesUrl: 'https://bolalabs.pt/en/repomanager' })
        expect(supportHref()).toBeNull()
        expect(supportLabel()).toBeNull()
        expect(salesHref()).toBe('https://bolalabs.pt/en/repomanager')
    })

    it('reads the desk, mailbox and sales page from the shell', () => {
        setMeta(HOUSE)
        expect(getSupport()).toEqual(HOUSE)
        expect(salesHref()).toBe(HOUSE.salesUrl)
        expect(supportLabel()).toBe('suporte@bolalabs.pt')
    })

    it('ignores malformed meta and values that are not https or an address', () => {
        setMeta('{not json')
        expect(supportHref()).toBeNull()
        setMeta({ url: 'http://insecure.example', email: 'not-an-address', salesUrl: 'javascript:alert(1)' })
        expect(getSupport()).toEqual({ salesUrl: 'https://bolalabs.pt/en/repomanager' })
    })

    it('the BolaLabs desk follows the browser language and takes a category', () => {
        setMeta(HOUSE)
        vi.stubGlobal('navigator', { language: 'pt-PT' })
        const href = new URL(supportHref({ category: 'incident' }))
        expect(href.pathname).toBe('/pt/dashboard')
        expect(href.searchParams.get('category')).toBe('incident')
        expect(href.searchParams.get('product')).toBe('repomanager')
    })

    it('an unsupported language keeps /en/, and another desk URL is never rewritten', () => {
        setMeta(HOUSE)
        vi.stubGlobal('navigator', { language: 'de-DE' })
        expect(new URL(supportHref()).pathname).toBe('/en/dashboard')
        setMeta({ url: 'https://desk.acme.example/en/new' })
        vi.stubGlobal('navigator', { language: 'pt-PT' })
        expect(supportHref({ category: 'incident' })).toBe('https://desk.acme.example/en/new')
    })

    it('an install with only a mailbox gets a mailto with the subject', () => {
        setMeta({ email: 'help@acme.example' })
        expect(supportHref({ subject: 'Stripe down' })).toBe('mailto:help@acme.example?subject=Stripe%20down')
    })
})
