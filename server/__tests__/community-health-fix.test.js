import { describe, it, expect, vi } from 'vitest'
import {
	generateLicense, generateCodeOfConduct,
	generateContributing, generateSecurityMd, generateIssueTemplate, generatePRTemplate, generateReadmeStub,
	commitOrOpenPR,
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

	it('substitutes {{year}} and {{owner}} in Apache-2.0', () => {
		const out = generateLicense({ licenseId: 'Apache-2.0', owner: 'Acme', year: 2026 })
		expect(out.content).toContain('Apache License')
		expect(out.content).toContain('Version 2.0')
		expect(out.content).toContain('Copyright 2026 Acme')
		expect(out.content).not.toContain('{{')
	})

	it('substitutes {{year}} and {{owner}} in GPL-3.0', () => {
		const out = generateLicense({ licenseId: 'GPL-3.0', owner: 'Acme', year: 2026 })
		expect(out.content).toContain('GNU GENERAL PUBLIC LICENSE')
		expect(out.content).toContain('Version 3')
		expect(out.content).toContain('Copyright (C) 2026  Acme')
		expect(out.content).not.toContain('{{')
	})

	it('returns canonical MPL-2.0 text (no placeholders required)', () => {
		const out = generateLicense({ licenseId: 'MPL-2.0', owner: 'Acme', year: 2026 })
		expect(out.content).toContain('Mozilla Public License Version 2.0')
		// MPL-2.0 puts copyright in source file headers, not in LICENSE — no placeholders.
		expect(out.content).not.toContain('{{')
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

describe('commitOrOpenPR', () => {
	const mkGithubApi = ({ protectedBranch = false, defaultBranch = 'main', prNumber = 42 } = {}) => {
		return vi.fn(async (path, _token, options = {}) => {
			if (path === `/repos/a/b`) return { data: { default_branch: defaultBranch } }
			if (path.endsWith(`/branches/${defaultBranch}/protection`)) {
				if (protectedBranch) return { data: { required_pull_request_reviews: {} } }
				const err = new Error('Not Found'); err.status = 404; throw err
			}
			if (path.endsWith(`/git/refs/heads/${defaultBranch}`)) return { data: { object: { sha: 'baseSha123' } } }
			if (path.endsWith('/git/refs') && options.method === 'POST') return { data: { ref: 'refs/heads/chore/health' } }
			if (path.includes('/contents/') && options.method === 'PUT') {
				return { data: { content: { sha: 'fileSha456' }, commit: { sha: 'commitSha789' } } }
			}
			if (path === '/repos/a/b/pulls' && options.method === 'POST') {
				return { data: { number: prNumber, html_url: `https://github.com/a/b/pull/${prNumber}` } }
			}
			throw new Error(`unmocked githubApi call: ${path} (${options.method || 'GET'})`)
		})
	}

	it('direct commit when default branch is unprotected', async () => {
		const githubApi = mkGithubApi({ protectedBranch: false })
		const out = await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content: 'mit body',
			commitMessage: 'add license', mode: 'direct', githubApi,
		})
		expect(out.mode).toBe('direct')
		expect(out.branch).toBe('main')
		expect(out.sha).toBe('fileSha456')
	})

	it('falls back to PR when default branch is protected', async () => {
		const githubApi = mkGithubApi({ protectedBranch: true })
		const out = await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content: 'mit body',
			commitMessage: 'add license', mode: 'direct', githubApi,
		})
		expect(out.mode).toBe('pr-fallback')
		expect(out.prUrl).toMatch(/pull\/42$/)
		expect(out.branch).toMatch(/^chore\/community-health-fixes-/)
	})

	it('honours explicit mode=pr without checking protection', async () => {
		const githubApi = mkGithubApi({ protectedBranch: false })
		const out = await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content: 'mit body',
			commitMessage: 'add license', mode: 'pr', githubApi,
		})
		expect(out.mode).toBe('pr')
		expect(out.prUrl).toMatch(/pull\/42$/)
		// Protection endpoint NOT called when mode is forced to pr.
		const calls = githubApi.mock.calls.map(c => c[0])
		expect(calls).not.toContain('/repos/a/b/branches/main/protection')
	})

	it('encodes file path with subdirectory correctly', async () => {
		const githubApi = mkGithubApi({ protectedBranch: false })
		await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't',
			filePath: '.github/PULL_REQUEST_TEMPLATE.md', content: 'x',
			commitMessage: 'add pr template', mode: 'direct', githubApi,
		})
		const putCall = githubApi.mock.calls.find(c => c[2]?.method === 'PUT')
		expect(putCall[0]).toBe('/repos/a/b/contents/.github/PULL_REQUEST_TEMPLATE.md')
	})

	it('base64-encodes content for the GitHub Contents API', async () => {
		const githubApi = mkGithubApi({ protectedBranch: false })
		await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't',
			filePath: 'LICENSE', content: 'hello world', commitMessage: 'm', mode: 'direct', githubApi,
		})
		const putCall = githubApi.mock.calls.find(c => c[2]?.method === 'PUT')
		const body = JSON.parse(putCall[2].body)
		expect(body.content).toBe(Buffer.from('hello world', 'utf8').toString('base64'))
	})

	// --------------------------------------------------------------------
	// Binary-safe encoding (Wave 6c foundation for AI image generation).
	// TRAP: content: Buffer.from(content, 'utf8').toString('base64') on every
	// existing text write path is correct ONLY because content is always a
	// literal text string. Passing pre-encoded base64 image bytes straight
	// through the same line would re-encode the base64 *string* as if it
	// were UTF-8 text — a silent double-encode that "succeeds" (real commit
	// SHA) but corrupts the file. These tests prove: (1) existing text
	// callers get byte-identical output whether or not they pass `encoding`
	// explicitly, and (2) `encoding: 'base64'` round-trips real binary bytes
	// through the helper unchanged.
	// --------------------------------------------------------------------

	it('omitting encoding is byte-identical to explicitly passing encoding: "utf8"', async () => {
		const githubApiImplicit = mkGithubApi({ protectedBranch: false })
		const githubApiExplicit = mkGithubApi({ protectedBranch: false })
		const content = 'hello world — unicode too: café'

		await commitOrOpenPR({ owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content, commitMessage: 'm', mode: 'direct', githubApi: githubApiImplicit })
		await commitOrOpenPR({ owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content, commitMessage: 'm', mode: 'direct', encoding: 'utf8', githubApi: githubApiExplicit })

		const bodyImplicit = JSON.parse(githubApiImplicit.mock.calls.find(c => c[2]?.method === 'PUT')[2].body)
		const bodyExplicit = JSON.parse(githubApiExplicit.mock.calls.find(c => c[2]?.method === 'PUT')[2].body)

		expect(bodyImplicit.content).toBe(bodyExplicit.content)
		expect(bodyImplicit.content).toBe(Buffer.from(content, 'utf8').toString('base64'))
	})

	it('all 7 FILE_GENERATORS-style text callers remain byte-identical to the pre-encoding-param behaviour (direct mode)', async () => {
		const githubApi = mkGithubApi({ protectedBranch: false })
		const content = '# CONTRIBUTING\n\nSetup, build, test.\n'
		await commitOrOpenPR({ owner: 'a', repo: 'b', token: 't', filePath: 'CONTRIBUTING.md', content, commitMessage: 'chore: add CONTRIBUTING.md', mode: 'direct', githubApi })
		const body = JSON.parse(githubApi.mock.calls.find(c => c[2]?.method === 'PUT')[2].body)
		expect(body.content).toBe(Buffer.from(content, 'utf8').toString('base64'))
	})

	it('encoding: "base64" passes pre-encoded binary content through untouched (PNG byte-roundtrip, direct mode)', async () => {
		// Minimal fake "PNG" — real PNG signature bytes plus some non-UTF8-safe
		// bytes to make sure a text re-encode would visibly mangle them.
		const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x7f])
		const preEncoded = pngBytes.toString('base64')
		const githubApi = mkGithubApi({ protectedBranch: false })

		await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't',
			filePath: 'docs/images/social-preview.png', content: preEncoded,
			commitMessage: 'chore: add generated social preview image', mode: 'direct', encoding: 'base64', githubApi,
		})

		const putCall = githubApi.mock.calls.find(c => c[2]?.method === 'PUT')
		const body = JSON.parse(putCall[2].body)

		// Passed through untouched — NOT re-encoded (that would differ from preEncoded).
		expect(body.content).toBe(preEncoded)
		// And decoding it back to bytes reproduces the exact original PNG bytes.
		const decoded = Buffer.from(body.content, 'base64')
		expect(decoded.equals(pngBytes)).toBe(true)
	})

	it('encoding: "base64" also round-trips correctly on the PR-fallback (protected branch) path', async () => {
		const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x10, 0x20, 0x30, 0xaa, 0xbb, 0xcc])
		const preEncoded = pngBytes.toString('base64')
		const githubApi = mkGithubApi({ protectedBranch: true })

		const out = await commitOrOpenPR({
			owner: 'a', repo: 'b', token: 't',
			filePath: 'docs/images/social-preview.png', content: preEncoded,
			commitMessage: 'chore: add generated social preview image', mode: 'direct', encoding: 'base64', githubApi,
		})

		expect(out.mode).toBe('pr-fallback')
		const putCall = githubApi.mock.calls.find(c => c[2]?.method === 'PUT')
		const body = JSON.parse(putCall[2].body)
		expect(body.content).toBe(preEncoded)
		expect(Buffer.from(body.content, 'base64').equals(pngBytes)).toBe(true)
	})

	it('sanity check: naively re-encoding base64 content as utf8 (the bug this fixes) WOULD have corrupted the bytes', () => {
		// Documents why the fix is necessary — asserts the buggy path's output
		// differs from the real bytes for content containing non-ASCII-safe
		// base64 output, so a regression back to the old hardcoded line would
		// be caught by the roundtrip tests above rather than silently passing.
		const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x7f])
		const preEncoded = pngBytes.toString('base64')
		const buggyDoubleEncoded = Buffer.from(preEncoded, 'utf8').toString('base64')
		expect(buggyDoubleEncoded).not.toBe(preEncoded)
		expect(Buffer.from(buggyDoubleEncoded, 'base64').equals(pngBytes)).toBe(false)
	})
})
