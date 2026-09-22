import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PricingPreview } from '@/components/Landing/PricingPreview'

// The billing probe decides whether this deployment can take money, and the
// Pro button's behaviour follows it. Mocked so both states are testable.
const mockApiCall = vi.fn(async () => ({ stripeEnabled: true }))
vi.mock('@/utils/api', () => ({ apiCall: (...args) => mockApiCall(...args) }))

const __dirname = import.meta.dirname
const source = readFileSync(resolve(__dirname, '../../../src/components/Landing/PricingPreview.jsx'), 'utf8')

describe('PricingPreview — motion contract (no spring/translate hover)', () => {
  it('does not use whileHover — flat controls move via CSS bg/border only, per the motion contract', () => {
    expect(source).not.toContain('whileHover')
  })

  it('uses the same CSS-only hover treatment as the in-app PricingCard (border/shadow, no transform)', () => {
    const { container } = render(<PricingPreview />)
    const bodies = container.querySelectorAll('.rounded-2xl.p-7')
    expect(bodies).toHaveLength(3)
    // Free (default tier, index 0) — border hover, mirrors PricingCard's default tier.
    expect(bodies[0].className).toContain('hover:border-slate-300')
    expect(bodies[0].className).toContain('dark:hover:border-slate-600')
    // Pro/popular (index 1) — NO hover treatment at all, mirroring PricingCard's
    // highlighted tier which also has none.
    expect(bodies[1].className).not.toMatch(/hover:/)
    // Enterprise (index 2) — shadow hover, mirrors PricingCard's enterprise tier.
    expect(bodies[2].className).toContain('hover:shadow-amber-500/30')
  })
})

/*
 * The landing page is the first pricing surface a prospect sees, and it sold
 * Pro with "priority support" — an Enterprise-only deliverable per the README
 * matrix, PricingPage, FeatureComparison and the billing docs.
 * pricing-feature-parity.test.js bans that exact phrase, but only inside
 * LicensePlanSection's proUpsellArray(), so this surface escaped the gate
 * entirely.
 */
describe('PricingPreview — the Pro button does what its label says', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        mockApiCall.mockReset()
        mockApiCall.mockResolvedValue({ stripeEnabled: true })
    })

    it('asks for an e-mail, and never for GitHub access, when checkout is unavailable', async () => {
        // The button relabelled itself to "Contact us about Pro" and then still
        // called onSignIn(), so a visitor asking to be contacted was handed
        // GitHub's consent screen asking for their repositories — on an
        // instance that cannot charge them anyway. The label was fixed; the
        // handler was not.
        mockApiCall.mockResolvedValue({ stripeEnabled: false })
        const onSignIn = vi.fn()
        const open = vi.spyOn(window, 'open').mockImplementation(() => null)

        render(<PricingPreview onSignIn={onSignIn} />)

        const cta = await waitFor(() => screen.getByRole('button', { name: /contact us about pro/i }))
        cta.click()

        expect(onSignIn).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledOnce()
        expect(open.mock.calls[0][0]).toMatch(/^mailto:/)
        expect(open.mock.calls[0][0]).toMatch(/Pro%20inquiry/)
    })

    it('signs the visitor in when checkout IS available', async () => {
        mockApiCall.mockResolvedValue({ stripeEnabled: true })
        const onSignIn = vi.fn()

        render(<PricingPreview onSignIn={onSignIn} />)

        const cta = await waitFor(() => screen.getByRole('button', { name: /upgrade to pro/i }))
        cta.click()

        expect(onSignIn).toHaveBeenCalledOnce()
    })

    it('keeps the blocked state in the handler, not only in the label', () => {
        // A label-only guard is exactly the defect above. If `blocked` ever
        // stops being read inside onClick, this reddens.
        const handler = source.slice(source.indexOf('onClick={() => {'), source.indexOf('className={`w-full py-3'))
        expect(handler).toMatch(/blocked/)
    })
})

describe('PricingPreview — Pro claims match every other surface', () => {
  it('does not sell Pro with priority support', () => {
    // Comments are stripped first: the gate is about what the page claims,
    // and a comment explaining why a phrase is absent must not read as the
    // phrase being present.
    const proBlock = source
      .slice(source.indexOf("name: 'Pro'"), source.indexOf("name: 'Enterprise'"))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '')
    expect(proBlock).not.toMatch(/priority support/i)
  })

  it('reserves priority support for the Enterprise entry', () => {
    const entBlock = source.slice(source.indexOf("name: 'Enterprise'"))
    expect(entBlock).toMatch(/priority support/i)
  })
})

describe('PricingPreview — the Pro button carries its intent through sign-in', () => {
    it('asks for a return to the pricing checkout after login', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true, status: 200, headers: { get: () => 'application/json' },
            json: async () => ({ stripeEnabled: true }),
        })
        const onSignIn = vi.fn()
        render(<PricingPreview onSignIn={onSignIn} />)
        const cta = await screen.findByRole('button', { name: /^upgrade to pro$/i })
        fireEvent.click(cta)
        expect(onSignIn).toHaveBeenCalledWith({ next: '/pricing?checkout=pro' })
    })
})
