import { describe, it, expect, vi } from 'vitest'
import {
	generateLicense, generateCodeOfConduct,
	generateContributing, generateSecurityMd, generateIssueTemplate, generatePRTemplate, generateReadmeStub,
	FILE_GENERATORS, SUPPORTED_LICENSES,
} from '../lib/ai-features/community-health-fix.js'

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

describe('generateCodeOfConduct', () => {
	it('returns CODE_OF_CONDUCT.md path', () => {
		const out = generateCodeOfConduct({ email: 'security@acme.test' })
		expect(out.filePath).toBe('CODE_OF_CONDUCT.md')
	})

	it('substitutes {{contact_email}} with the supplied email', () => {
		const out = generateCodeOfConduct({ email: 'security@acme.test' })
		expect(out.content).toContain('security@acme.test')
		expect(out.content).not.toContain('{{')
	})

	it('adopts the Contributor Covenant 2.1 by canonical reference', () => {
		const out = generateCodeOfConduct({ email: 'a@b.c' })
		expect(out.content).toContain('Contributor Covenant')
		expect(out.content).toContain('contributor-covenant.org')
		expect(out.content).toContain('2.1')
	})

	it('defaults email to a placeholder when omitted', () => {
		const out = generateCodeOfConduct()
		expect(out.content).toContain('admin@example.com')
		expect(out.content).not.toContain('{{')
	})

	it('FILE_GENERATORS.code_of_conduct is marked deterministic', () => {
		expect(FILE_GENERATORS.code_of_conduct.deterministic).toBe(true)
		expect(FILE_GENERATORS.code_of_conduct.path).toBe('CODE_OF_CONDUCT.md')
	})

	it('suggestedCommitMessage is consistent', () => {
		expect(generateCodeOfConduct({ email: 'a@b.c' }).suggestedCommitMessage).toBe('chore: add Code of Conduct')
	})
})

describe('AI-backed generators', () => {
	const mkProvider = (text) => ({ generate: vi.fn(async () => ({ text, parsed: null })) })

	it('generateContributing sends a prompt naming the repo and returns CONTRIBUTING.md path', async () => {
		const provider = mkProvider('# Contributing\n\nbody')
		const out = await generateContributing({ repo: { full_name: 'acme/x', description: 'CLI tool', language: 'TS' }, provider })
		expect(provider.generate).toHaveBeenCalledOnce()
		const prompt = provider.generate.mock.calls[0][0].prompt
		expect(prompt).toMatch(/CONTRIBUTING/)
		expect(prompt).toContain('acme/x')
		expect(out.filePath).toBe('CONTRIBUTING.md')
		expect(out.content).toContain('Contributing')
		expect(out.suggestedCommitMessage).toBe('chore: add CONTRIBUTING.md')
	})

	it('generateSecurityMd injects the contact email and returns SECURITY.md path', async () => {
		const provider = mkProvider('## Reporting a vulnerability')
		const out = await generateSecurityMd({ repo: { full_name: 'a/b' }, email: 'sec@a.test', provider })
		const prompt = provider.generate.mock.calls[0][0].prompt
		expect(prompt).toContain('sec@a.test')
		expect(out.filePath).toBe('SECURITY.md')
	})

	it('generateIssueTemplate returns the bug_report path under .github/ISSUE_TEMPLATE', async () => {
		const out = await generateIssueTemplate({ repo: { full_name: 'a/b', language: 'JS' }, provider: mkProvider('---\nname: Bug\n---') })
		expect(out.filePath).toBe('.github/ISSUE_TEMPLATE/bug_report.md')
	})

	it('generatePRTemplate returns .github/PULL_REQUEST_TEMPLATE.md path', async () => {
		const out = await generatePRTemplate({ repo: { full_name: 'a/b' }, provider: mkProvider('## Summary') })
		expect(out.filePath).toBe('.github/PULL_REQUEST_TEMPLATE.md')
	})

	it('generateReadmeStub returns README.md path', async () => {
		const out = await generateReadmeStub({ repo: { full_name: 'a/b', description: 'x', language: 'Go' }, provider: mkProvider('# a/b') })
		expect(out.filePath).toBe('README.md')
	})

	it('sanitises Mustache-style placeholders in repo metadata before injection', async () => {
		const provider = mkProvider('out')
		await generateContributing({
			repo: { full_name: 'a/b', description: 'Tool {{evil}} prompt-inject', language: 'TS' },
			provider,
		})
		const prompt = provider.generate.mock.calls[0][0].prompt
		expect(prompt).not.toContain('{{evil}}')
	})

	it('FILE_GENERATORS includes all 7 entries with correct deterministic flags', () => {
		expect(FILE_GENERATORS.license.deterministic).toBe(true)
		expect(FILE_GENERATORS.code_of_conduct.deterministic).toBe(true)
		expect(FILE_GENERATORS.contributing.deterministic).toBe(false)
		expect(FILE_GENERATORS.security.deterministic).toBe(false)
		expect(FILE_GENERATORS.issue_template.deterministic).toBe(false)
		expect(FILE_GENERATORS.pr_template.deterministic).toBe(false)
		expect(FILE_GENERATORS.readme_stub.deterministic).toBe(false)
	})

	it('AI generators tolerate missing description/language without crashing', async () => {
		const provider = mkProvider('out')
		await expect(generateContributing({ repo: { full_name: 'a/b' }, provider })).resolves.toBeDefined()
		await expect(generateReadmeStub({ repo: { full_name: 'a/b' }, provider })).resolves.toBeDefined()
	})
})
