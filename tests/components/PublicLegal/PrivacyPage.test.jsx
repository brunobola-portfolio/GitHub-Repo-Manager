import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PrivacyPage from '../../../src/components/PublicLegal/PrivacyPage.jsx'

/*
 * The hosted instance had no privacy notice at all: /privacy answered 404 and
 * the footer pointed at docs/privacy-and-data.md, a document that explicitly
 * refuses the role ("If you are running a hosted instance for other people,
 * you are the data controller"). Meanwhile the sign-in flow asks for access to
 * a stranger's repositories. These assertions pin the four things that make
 * this page a notice rather than decoration — anyone rewording it has to keep
 * them true.
 */
describe('PrivacyPage — the hosted instance names a controller and real rights', () => {
    it('identifies the controller with a working contact', () => {
        render(<PrivacyPage />)
        expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument()
        expect(screen.getByText(/data controller for this/i)).toBeInTheDocument()
        const contact = screen.getByRole('link', { name: /bruno@bolalabs\.pt/i })
        expect(contact).toHaveAttribute('href', 'mailto:bruno@bolalabs.pt')
    })

    it('says what is stored, including the audit log that records IP and user-agent', () => {
        render(<PrivacyPage />)
        expect(screen.getByText(/IP address and user-agent/i)).toBeInTheDocument()
        expect(screen.getByText(/encrypted at rest with/i)).toBeInTheDocument()
    })

    it('names every processor that receives data', () => {
        render(<PrivacyPage />)
        for (const processor of [/GitHub/, /Resend/, /Sentry/, /Stripe/]) {
            expect(screen.getAllByText(processor).length).toBeGreaterThan(0)
        }
    })

    it('states the two honest limits on erasure instead of promising everything', () => {
        render(<PrivacyPage />)
        // An active subscription blocks erasure, and the hash-chained audit log
        // survives it — both are real behaviours of the erasure endpoint, and a
        // policy that claimed otherwise would be the lie.
        expect(screen.getByText(/subscription must be cancelled first/i)).toBeInTheDocument()
        expect(screen.getByText(/audit log[\s\S]*survives/i)).toBeInTheDocument()
    })

    it('offers the export and erasure paths a user can actually reach', () => {
        render(<PrivacyPage />)
        expect(screen.getByText(/Export my data/i)).toBeInTheDocument()
        expect(screen.getByText(/Erase my data/i)).toBeInTheDocument()
        expect(screen.getByText(/Danger Zone/i)).toBeInTheDocument()
    })
})
