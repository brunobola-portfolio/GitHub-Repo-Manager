/*
 * The VAT wording on the pricing surfaces follows what this instance's
 * checkout will charge, not a string written for the hosted app.
 */
import { describe, it, expect } from 'vitest'
import { taxSuffix, taxNote } from '../../src/utils/priceTax.js'

const price = (taxBehavior) => ({ pro: { monthly: { amount: 1900, currency: 'eur', interval: 'month', taxBehavior } } })

describe('taxSuffix / taxNote', () => {
    it('before the probe answers, and on an instance that cannot sell, quotes the publisher plans excluding VAT', () => {
        expect(taxSuffix(null)).toBe('+ VAT')
        expect(taxSuffix({ stripeEnabled: false, automaticTax: false })).toBe('+ VAT')
        expect(taxNote(null)).toMatch(/exclude VAT/)
    })

    it('an instance that sells without Stripe Tax charges no VAT, so it says nothing', () => {
        const billing = { stripeEnabled: true, automaticTax: false, prices: price('exclusive') }
        expect(taxSuffix(billing)).toBe('')
        expect(taxNote(billing)).toBe('')
    })

    it('with Stripe Tax: VAT on top for exclusive or unspecified prices, included for inclusive ones', () => {
        expect(taxSuffix({ stripeEnabled: true, automaticTax: true, prices: price('exclusive') })).toBe('+ VAT')
        expect(taxSuffix({ stripeEnabled: true, automaticTax: true, prices: price('unspecified') })).toBe('+ VAT')
        const inclusive = { stripeEnabled: true, automaticTax: true, prices: price('inclusive') }
        expect(taxSuffix(inclusive)).toBe('incl. VAT')
        expect(taxNote(inclusive)).toBe('Prices include VAT.')
    })

    it('the note covers the edge cases the checkout applies: EU rate, outside the EU, reverse charge', () => {
        const note = taxNote({ stripeEnabled: true, automaticTax: true, prices: price('exclusive') })
        expect(note).toMatch(/billing address/)
        expect(note).toMatch(/none outside it/)
        expect(note).toMatch(/reverse charge/)
    })

    it('an older server without the field keeps the publisher wording', () => {
        expect(taxSuffix({ stripeEnabled: true, prices: price('exclusive') })).toBe('+ VAT')
    })
})
