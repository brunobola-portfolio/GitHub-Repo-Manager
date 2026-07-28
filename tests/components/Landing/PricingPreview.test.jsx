import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { PricingPreview } from '@/components/Landing/PricingPreview'

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
