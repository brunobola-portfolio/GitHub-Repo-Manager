import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TermsPage from '../../../src/components/PublicLegal/TermsPage.jsx'

/*
 * Until now the only terms were docs/LICENSE-COMMERCIAL.md on GitHub, which
 * describes what a subscription adds and admits in its own last paragraph that
 * it is standing in for a page that does not exist. These assertions pin the
 * clauses that make this a consumer-facing contract rather than a licence
 * summary — anyone rewording the page has to keep them true.
 */
describe('TermsPage — what a buyer must be told before paying', () => {
    it('names the counterparty and a working contact', () => {
        render(<TermsPage />)
        expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeInTheDocument()
        expect(screen.getByText(/BolaLabs \(Bruno Silva Marques\)/)).toBeInTheDocument()
        expect(screen.getAllByRole('link', { name: /bruno@bolalabs\.pt/i })[0])
            .toHaveAttribute('href', 'mailto:bruno@bolalabs.pt')
    })

    it('states the price in the currency the checkout actually charges', () => {
        render(<TermsPage />)
        expect(screen.getByText(/€19 per month/i)).toBeInTheDocument()
        expect(screen.getByText(/charged in euros/i)).toBeInTheDocument()
    })

    it('grants the 14-day withdrawal right outright, and says why it is not waived', () => {
        // It can be waived for a digital service, but only by asking the buyer
        // to consent to immediate performance at checkout — which this
        // checkout does not do. A page that claimed the waiver would be
        // claiming a consent nobody collected.
        render(<TermsPage />)
        expect(screen.getByText(/14 days from the day you subscribe to change your mind/i)).toBeInTheDocument()
        expect(screen.getByText(/not waived here/i)).toBeInTheDocument()
    })

    it('says how to cancel, and that cancelling does not cut the paid period short', () => {
        render(<TermsPage />)
        expect(screen.getByText(/Settings → Billing/)).toBeInTheDocument()
        expect(screen.getByText(/does not cut\s+off the period you already paid for/i)).toBeInTheDocument()
    })

    it('makes no claim about how VAT is calculated, because nothing calculates it yet', () => {
        // The checkout collects no country, address or VAT id and no tax
        // registration is configured. Any sentence about tax mechanics would
        // describe something that does not happen.
        render(<TermsPage />)
        expect(screen.queryByText(/VAT/i)).not.toBeInTheDocument()
    })

    it('carries no uptime promise it cannot keep, and points at the status page', () => {
        render(<TermsPage />)
        expect(screen.getByText(/no uptime guarantee/i)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: '/status' })).toHaveAttribute('href', '/status')
    })

    it('keeps the liability and governing-law wording already published on bolalabs.pt', () => {
        render(<TermsPage />)
        expect(screen.getByText(/limited to the amount you actually paid/i)).toBeInTheDocument()
        expect(screen.getByText(/cannot be excluded or limited by law/i)).toBeInTheDocument()
        expect(screen.getByText(/courts of the district of Lisbon/i)).toBeInTheDocument()
    })

    it('links the privacy policy rather than restating it', () => {
        render(<TermsPage />)
        expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy')
    })

    it('titles the document as itself, not as the application', () => {
        render(<TermsPage />)
        expect(document.title).toBe('Terms of service — GitHub Repo Manager')
    })
})
