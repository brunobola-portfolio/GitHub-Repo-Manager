// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Community Health AI Auto-Fix — generators for the standard community files
 * a healthy GitHub repo should ship (LICENSE, CODE_OF_CONDUCT, CONTRIBUTING,
 * SECURITY, README stub, issue/PR templates).
 *
 * Two generator flavours:
 *   - **Deterministic**: license text + Code of Conduct boilerplate. No AI
 *     call. Fast, cheap, exact text.
 *   - **AI-backed**: CONTRIBUTING/SECURITY/templates. Provider abstraction is
 *     `createProviderForUser` — caller passes the resolved provider.
 *
 * Spec: docs/specs/2026-05-01-community-health-ai-autofix.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeForPrompt } from './sanitize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'license-templates')

/**
 * Phase 1 ships MIT + BSD-3-Clause verbatim. Apache-2.0, GPL-3.0, and MPL-2.0
 * have very long canonical texts (10+ KB each) and are queued for a follow-up
 * commit that adds them via a build-time fetch from choosealicense.com.
 *
 * @see docs/plans/2026-05-01-community-health-ai-autofix.md (Task 1 follow-up)
 */
export const SUPPORTED_LICENSES = ['MIT', 'BSD-3-Clause']

function loadLicenseTemplate(id) {
	if (!SUPPORTED_LICENSES.includes(id)) {
		throw new Error(`unsupported license: ${id}. Supported: ${SUPPORTED_LICENSES.join(', ')}`)
	}
	return fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.txt`), 'utf8')
}

/**
 * Generate the LICENSE file content with `{{year}}` and `{{owner}}` filled in.
 * @param {{ licenseId?: string, owner?: string, year?: number }} opts
 * @returns {{ filePath: string, content: string, suggestedCommitMessage: string }}
 */
export function generateLicense({ licenseId = 'MIT', owner, year } = {}) {
	const template = loadLicenseTemplate(licenseId)
	const content = template
		.replaceAll('{{year}}', String(year ?? new Date().getFullYear()))
		.replaceAll('{{owner}}', owner ?? 'Repository owner')
	return {
		filePath: 'LICENSE',
		content,
		suggestedCommitMessage: `chore: add ${licenseId} license`,
	}
}

const COC_TEMPLATE = fs.readFileSync(path.join(__dirname, 'code-of-conduct-template.txt'), 'utf8')

/**
 * Generate CODE_OF_CONDUCT.md by adopting the Contributor Covenant 2.1 by
 * canonical reference (link to contributor-covenant.org) plus the project
 * contact email.
 *
 * **Why reference vs. verbatim?** Three reasons:
 *   1. The canonical text at contributor-covenant.org is always the latest
 *      authoritative version — embedding a copy means any update is missed
 *      until we re-ship.
 *   2. The verbatim text contains references to harassment, sexual content,
 *      etc. that some output-safety filters block. Linking sidesteps that
 *      while remaining fully compliant — the linked-by-reference adoption
 *      pattern is what most OSS repos actually do.
 *   3. Shorter file = less merge-conflict surface and easier reading.
 *
 * @param {{ email?: string }} opts
 * @returns {{ filePath: string, content: string, suggestedCommitMessage: string }}
 */
export function generateCodeOfConduct({ email = 'admin@example.com' } = {}) {
	return {
		filePath: 'CODE_OF_CONDUCT.md',
		content: COC_TEMPLATE.replaceAll('{{contact_email}}', email),
		suggestedCommitMessage: 'chore: add Code of Conduct',
	}
}

// ----------------------------------------------------------------------------
// AI-backed generators
// ----------------------------------------------------------------------------

/**
 * Caller passes a resolved provider (`createProviderForUser(...)`); we inject
 * sanitised repo metadata into the prompt and return the model's text.
 *
 * Sanitiser strips Mustache-style `{{...}}` substitutions and clamps length
 * so a malicious description can't smuggle prompt instructions.
 */
function clean(s) {
	return sanitizeForPrompt(String(s ?? ''), 500).replace(/\{\{[^}]*\}\}/g, '')
}

export async function generateContributing({ repo, provider }) {
	const prompt = `Write a CONTRIBUTING.md for ${clean(repo?.full_name)}, a ${clean(repo?.description) || 'project'}. Cover: setup, build, test, PR guidelines, commit message format. Tone: friendly, professional. Use Markdown with H2/H3 only. Keep total length under 800 words.`
	const result = await provider.generate({ prompt })
	return {
		filePath: 'CONTRIBUTING.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add CONTRIBUTING.md',
	}
}

export async function generateSecurityMd({ repo, email = 'security@example.com', provider }) {
	const prompt = `Write a SECURITY.md for ${clean(repo?.full_name)}. Cover: supported versions, how to report a vulnerability, expected response time. Use the contact email ${clean(email)}. Use Markdown. Keep total length under 400 words.`
	const result = await provider.generate({ prompt })
	return {
		filePath: 'SECURITY.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add SECURITY.md',
	}
}

export async function generateIssueTemplate({ repo, provider }) {
	const prompt = `Write a GitHub bug report issue template for ${clean(repo?.full_name)}. Tech stack: ${clean(repo?.language) || 'unspecified'}. Output Markdown with YAML front matter (name, about, title, labels). Sections: description, reproduction steps, expected behavior, actual behavior, environment. Keep total length under 1.5 KB.`
	const result = await provider.generate({ prompt })
	return {
		filePath: '.github/ISSUE_TEMPLATE/bug_report.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add bug report issue template',
	}
}

export async function generatePRTemplate({ repo, provider }) {
	const prompt = `Write a concise PR template for ${clean(repo?.full_name)}. Sections: summary, related issues, testing notes, screenshots (if UI). Output Markdown. Keep total length under 300 words.`
	const result = await provider.generate({ prompt })
	return {
		filePath: '.github/PULL_REQUEST_TEMPLATE.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add pull request template',
	}
}

export async function generateReadmeStub({ repo, provider }) {
	const prompt = `Write a README.md stub for ${clean(repo?.full_name)}, a ${clean(repo?.description) || 'project'}. Tech stack: ${clean(repo?.language) || 'unspecified'}. Include: title, badges placeholder, install, quick start, license. Use Markdown with H2 sections. Keep total length under 500 words.`
	const result = await provider.generate({ prompt })
	return {
		filePath: 'README.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add README stub',
	}
}

// ----------------------------------------------------------------------------
// GitHub commit helper with branch-protection PR fallback
// ----------------------------------------------------------------------------

/**
 * Probe the default branch's protection rule. The /branches/{name}/protection
 * endpoint returns 404 when the branch is unprotected. Anything else surfaces
 * as a real error so the caller can decide; we treat 404 as "unprotected".
 *
 * @param {{ owner: string, repo: string, defaultBranch: string, token: string, githubApi: Function }} args
 * @returns {Promise<boolean>} true when protection is configured, false when it isn't
 */
async function isDefaultBranchProtected({ owner, repo, defaultBranch, token, githubApi }) {
	try {
		await githubApi(`/repos/${owner}/${repo}/branches/${defaultBranch}/protection`, token)
		return true
	} catch (err) {
		if (err?.status === 404) return false
		throw err
	}
}

/**
 * Commit a file to the repo's default branch. If the default branch is
 * protected (or `mode: 'pr'` is forced), instead create a topic branch off
 * the default, PUT the file there, and open a PR back to the default.
 *
 * Why split detection from commit? Because the GitHub Contents API's PUT
 * call against a protected branch fails with a generic 422 — by detecting
 * up-front we can produce a clean `mode: 'pr-fallback'` outcome that the UI
 * can render as "Opened PR instead" instead of looking like a failure.
 *
 * @param {object} args
 * @param {string} args.owner
 * @param {string} args.repo
 * @param {string} args.token
 * @param {string} args.filePath
 * @param {string} args.content
 * @param {string} args.commitMessage
 * @param {'direct'|'pr'} [args.mode]
 * @param {Function} args.githubApi
 * @returns {Promise<{ mode: 'direct'|'pr'|'pr-fallback', branch: string, sha?: string, prUrl?: string }>}
 */
export async function commitOrOpenPR({ owner, repo, token, filePath, content, commitMessage, mode = 'direct', githubApi }) {
	const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, token)
	const defaultBranch = repoData?.default_branch || 'main'

	const wantsPR = mode === 'pr'
	const protectedDefault = !wantsPR && (await isDefaultBranchProtected({ owner, repo, defaultBranch, token, githubApi }))

	if (wantsPR || protectedDefault) {
		const branch = `chore/community-health-fixes-${Date.now()}`
		const { data: ref } = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`, token)
		const baseSha = ref?.object?.sha || ref?.sha
		await githubApi(`/repos/${owner}/${repo}/git/refs`, token, {
			method: 'POST',
			body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
		})
		await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`, token, {
			method: 'PUT',
			body: JSON.stringify({
				message: commitMessage,
				content: Buffer.from(content, 'utf8').toString('base64'),
				branch,
			}),
		})
		const { data: pr } = await githubApi(`/repos/${owner}/${repo}/pulls`, token, {
			method: 'POST',
			body: JSON.stringify({
				title: commitMessage,
				head: branch,
				base: defaultBranch,
				body: 'Automated fix from Community Health auto-fix.',
			}),
		})
		return {
			mode: protectedDefault ? 'pr-fallback' : 'pr',
			branch,
			prUrl: pr?.html_url,
		}
	}

	const { data: put } = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`, token, {
		method: 'PUT',
		body: JSON.stringify({
			message: commitMessage,
			content: Buffer.from(content, 'utf8').toString('base64'),
			branch: defaultBranch,
		}),
	})
	return {
		mode: 'direct',
		branch: defaultBranch,
		sha: put?.content?.sha || put?.commit?.sha,
	}
}

/**
 * Registry of file generators consumed by the /community-health/generate
 * endpoint. Each entry declares the destination path and whether the
 * generator runs deterministically (no AI) or via the provider abstraction.
 */
export const FILE_GENERATORS = {
	license: { path: 'LICENSE', generator: generateLicense, deterministic: true },
	code_of_conduct: { path: 'CODE_OF_CONDUCT.md', generator: generateCodeOfConduct, deterministic: true },
	contributing: { path: 'CONTRIBUTING.md', generator: generateContributing, deterministic: false },
	security: { path: 'SECURITY.md', generator: generateSecurityMd, deterministic: false },
	issue_template: { path: '.github/ISSUE_TEMPLATE/bug_report.md', generator: generateIssueTemplate, deterministic: false },
	pr_template: { path: '.github/PULL_REQUEST_TEMPLATE.md', generator: generatePRTemplate, deterministic: false },
	readme_stub: { path: 'README.md', generator: generateReadmeStub, deterministic: false },
}
