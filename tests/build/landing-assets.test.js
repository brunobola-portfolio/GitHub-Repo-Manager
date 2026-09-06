import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// 4.24.5 shipped a hero that referenced two captures a blanket `*.jpg` ignore
// rule had kept out of the commit; production answered them with the app
// shell. Every static asset the landing references must exist AND be tracked
// by git, or the CI build cannot ship it.
const SOURCES = [
    'src/components/Landing/HeroSection.jsx',
    'src/components/Landing/FeaturesSection.jsx',
    'src/components/Landing/CTASection.jsx',
    'src/components/Landing/LandingPage.jsx',
]

describe('landing page static assets', () => {
    const refs = new Set()
    for (const file of SOURCES) {
        const src = readFileSync(file, 'utf8')
        for (const m of src.matchAll(/src=["'](\/[a-z0-9_\-/.]+\.(?:jpg|jpeg|png|webp|avif|svg))["']/gi)) refs.add(m[1])
    }
    const tracked = new Set(execFileSync('git', ['ls-files', 'public'], { encoding: 'utf8' }).split(/\r?\n/).map((p) => p.replace(/^public/, '')))

    it('references at least the hero captures', () => {
        expect([...refs]).toEqual(expect.arrayContaining(['/landing/dashboard-light.jpg', '/landing/dashboard-dark.jpg']))
    })

    for (const ref of refs) {
        it(`${ref} exists in public/ and is tracked by git`, () => {
            expect(existsSync(`public${ref}`), `${ref} missing from public/`).toBe(true)
            expect(tracked.has(ref), `${ref} is not tracked — check .gitignore`).toBe(true)
        })
    }
})
