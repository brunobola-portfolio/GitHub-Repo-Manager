/**
 * How a price on the pricing surfaces relates to VAT, decided from what the
 * instance's checkout will actually do (GET /api/v1/billing/config) rather
 * than from a string written once for the hosted app.
 *
 * - No answer, or an instance that cannot sell: the plans shown are the
 *   publisher's, quoted excluding VAT as in its Terms.
 * - An instance that sells without Stripe Tax charges no VAT, so it shows none.
 * - With Stripe Tax, the price's own tax behaviour says whether VAT is added
 *   on top or already included.
 *
 * @param {object|null} billing the /billing/config response
 * @returns {'+ VAT'|'incl. VAT'|''}
 */
export function taxSuffix(billing) {
    if (!billing || billing.stripeEnabled !== true) return '+ VAT'
    // Older servers do not send the field; only an explicit false means "no tax".
    if (billing.automaticTax === false) return ''
    return billing.prices?.pro?.monthly?.taxBehavior === 'inclusive' ? 'incl. VAT' : '+ VAT'
}

/** The sentence under the plans that explains the suffix, or '' when there is none. */
export function taxNote(billing) {
    const suffix = taxSuffix(billing)
    if (suffix === '+ VAT') {
        return 'Prices exclude VAT. It is worked out at checkout from your billing address: your own country’s rate in the EU, none outside it, and none for an EU business with a valid VAT number (reverse charge).'
    }
    if (suffix === 'incl. VAT') return 'Prices include VAT.'
    return ''
}
