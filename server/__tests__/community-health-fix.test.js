import { describe, it, expect } from 'vitest'
import { generateLicense, FILE_GENERATORS, SUPPORTED_LICENSES } from '../lib/ai-features/community-health-fix.js'

describe('generateLicense', () => {
	it('substitutes {{year}} and {{owner}} in MIT', () => {
		const out = generateLicense({ licenseId: 'MIT', owner: 'Acme Corp', year: 2026 })
		expect(out.filePath).toBe('LICENSE')
		expect(out.content).toContain('Copyright (c) 2026 Acme Corp')
		expect(out.content).toContain('MIT License')
		expect(out.content).not.toContain('{{')
	})

	it('substitutes {{year}} and {{owner}} in BSD-3-Clause', () => {
		const out = generateLicense({ licenseId: 'BSD-3-Clause', owner: 'Acme', year: 2026 })
		expect(out.content).toContain('BSD 3-Clause License')
		expect(out.content).toContain('Copyright (c) 2026, Acme')
		expect(out.content).not.toContain('{{')
	})

	it('throws on unsupported licenseId', () => {
		expect(() => generateLicense({ licenseId: 'WTFPL', owner: 'x', year: 2026 })).toThrow(/unsupported/i)
	})

	it('throws on Apache-2.0 (queued for follow-up)', () => {
		// Apache-2.0/GPL-3.0/MPL-2.0 have long canonical texts not yet shipped.
		// Test locks in the expected behaviour so the follow-up commit can flip it.
		expect(() => generateLicense({ licenseId: 'Apache-2.0', owner: 'x', year: 2026 })).toThrow(/unsupported/i)
	})

	it('FILE_GENERATORS.license is marked deterministic', () => {
		expect(FILE_GENERATORS.license.deterministic).toBe(true)
		expect(FILE_GENERATORS.license.path).toBe('LICENSE')
	})

	it('all SUPPORTED_LICENSES load and substitute without leaking placeholders', () => {
		for (const id of SUPPORTED_LICENSES) {
			const out = generateLicense({ licenseId: id, owner: 'Test', year: 2026 })
			expect(out.content).not.toContain('{{')
			expect(out.content.length).toBeGreaterThan(100)
		}
	})

	it('defaults year to current year and owner to placeholder', () => {
		const out = generateLicense({ licenseId: 'MIT' })
		expect(out.content).toContain(String(new Date().getFullYear()))
		expect(out.content).toContain('Repository owner')
	})

	it('suggestedCommitMessage names the license id', () => {
		expect(generateLicense({ licenseId: 'MIT', owner: 'a' }).suggestedCommitMessage).toBe('chore: add MIT license')
		expect(generateLicense({ licenseId: 'BSD-3-Clause', owner: 'a' }).suggestedCommitMessage).toBe('chore: add BSD-3-Clause license')
	})
})
