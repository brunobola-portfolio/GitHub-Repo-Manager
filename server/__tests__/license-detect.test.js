import { describe, it, expect } from 'vitest'
import { detectLicense } from '../lib/ai-features/license-detect.js'
import { generateLicense, SUPPORTED_LICENSES } from '../lib/ai-features/community-health-fix.js'

describe('detectLicense — fingerprint match against SUPPORTED_LICENSES templates', () => {
	it('SUPPORTED_LICENSES is the 5-license list this app ships templates for', () => {
		expect(SUPPORTED_LICENSES).toEqual(['MIT', 'BSD-3-Clause', 'Apache-2.0', 'GPL-3.0', 'MPL-2.0'])
	})

	for (const id of SUPPORTED_LICENSES) {
		it(`detects a freshly generated ${id} LICENSE with high confidence`, () => {
			const { content } = generateLicense({ licenseId: id, owner: 'Acme Corp', year: 2026 })
			const result = detectLicense(content)
			expect(result.matched).toBe(true)
			expect(result.spdxId).toBe(id)
			expect(result.confidence).toBe('high')
		})
	}

	it('still detects a license with a different owner/year (per-project variables ignored)', () => {
		const { content } = generateLicense({ licenseId: 'MIT', owner: 'Some Other Person', year: 2019 })
		const result = detectLicense(content)
		expect(result).toEqual({ spdxId: 'MIT', confidence: 'high', matched: true })
	})

	it('is resilient to reformatted whitespace (extra blank lines, trailing spaces)', () => {
		const { content } = generateLicense({ licenseId: 'BSD-3-Clause', owner: 'Acme', year: 2026 })
		const reformatted = content
			.split('\n')
			.map((line) => `${line}   `) // trailing whitespace per line
			.join('\n\n') // extra blank line between every line
		const result = detectLicense(reformatted)
		expect(result.matched).toBe(true)
		expect(result.spdxId).toBe('BSD-3-Clause')
		expect(result.confidence).toBe('high')
	})

	it('is case-insensitive for the license body text', () => {
		const { content } = generateLicense({ licenseId: 'MIT', owner: 'Acme', year: 2026 })
		const result = detectLicense(content.toUpperCase())
		expect(result.matched).toBe(true)
		expect(result.spdxId).toBe('MIT')
	})
})

describe('detectLicense — SPDX-License-Identifier header fallback', () => {
	it('falls back to an SPDX header when the body text does not fingerprint-match any template', () => {
		const custom = [
			'Acme Proprietary License Wrapper v1',
			'SPDX-License-Identifier: Apache-2.0',
			'',
			'This repository is distributed under the terms referenced above.',
			'See https://example.com/license for the full legal text maintained externally.',
		].join('\n')
		const result = detectLicense(custom)
		expect(result).toEqual({ spdxId: 'Apache-2.0', confidence: 'high', matched: true })
	})

	it('only reads the header from the first ~10 lines', () => {
		const filler = Array.from({ length: 15 }, (_, i) => `Filler line ${i} with unrelated prose.`)
		const withLateHeader = [...filler, 'SPDX-License-Identifier: MIT'].join('\n')
		const result = detectLicense(withLateHeader)
		expect(result.matched).toBe(false)
	})

	it('ignores an SPDX id that is not one of SUPPORTED_LICENSES', () => {
		const custom = 'SPDX-License-Identifier: WTFPL\n\nSome custom permissive text nobody templates.'
		const result = detectLicense(custom)
		expect(result).toEqual({ spdxId: null, matched: false })
	})
})

describe('detectLicense — unrecognized / custom license', () => {
	it('returns unmatched for a fully custom license with no template overlap and no SPDX header', () => {
		const custom = [
			'Acme Internal Use Only License',
			'This software may only be used by employees of Acme Corporation',
			'for internal business purposes. Redistribution is strictly prohibited',
			'without prior written consent from the legal department.',
		].join('\n')
		const result = detectLicense(custom)
		expect(result).toEqual({ spdxId: null, matched: false })
	})

	it('returns unmatched for empty/whitespace-only content', () => {
		expect(detectLicense('')).toEqual({ spdxId: null, matched: false })
		expect(detectLicense('   \n\n  ')).toEqual({ spdxId: null, matched: false })
	})

	it('returns unmatched for null/undefined input', () => {
		expect(detectLicense(null)).toEqual({ spdxId: null, matched: false })
		expect(detectLicense(undefined)).toEqual({ spdxId: null, matched: false })
	})
})
