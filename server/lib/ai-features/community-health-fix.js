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
import { NEVER_INVENT_RULE } from './grounded-prompts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'license-templates')

/**
 * Canonical templates fetched from choosealicense.com (the authoritative
 * GitHub-maintained mirror). Placeholders normalised to `{{year}}` / `{{owner}}`
 * so the same substitution path works for every entry. MPL-2.0 has no
 * per-project placeholders by design — its copyright notice belongs in source
 * file headers, not in LICENSE itself.
 */
export const SUPPORTED_LICENSES = ['MIT', 'BSD-3-Clause', 'Apache-2.0', 'GPL-3.0', 'MPL-2.0']

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

/**
 * Centralised prompt templates for the 5 AI-backed community-health
 * generators. Co-locating them here makes it trivial to audit, A/B-test, or
 * tweak tone in one place — previously each prompt was inline at its
 * generator, so a "make all prompts terser" pass meant 5 separate edits.
 *
 * Placeholders are filled by `renderPromptVars()` (literal substring
 * substitution; nested {tokens} in values are NOT re-expanded). Every value
 * passes through `clean()` first to strip Mustache-style smuggling and
 * clamp length.
 *
 * Future: lifting these into the user-editable AI_PROMPT_REGISTRY is the
 * next step but is gated on a Settings UI design — these are short and
 * fairly generic, so the override surface adds DB schema + UI for low ROI
 * until users actually ask for it.
 */
// Every template is published into the user's repository under their name, in
// `direct` mode by default — so an invented claim here becomes THEIR public
// statement. NEVER_INVENT_RULE is the same rule grounded-prompts.js applies to
// the README/suggest surfaces; these five had none.
//
// The SECURITY.md prompt was the sharpest case: it asked for "supported
// versions" and an "expected response time" from nothing but a repository name
// and an email, which guarantees a fabricated support policy and a fabricated
// SLA. Both are now explicit TODO placeholders for a human to fill in.
export const PROMPT_TEMPLATES = Object.freeze({
	contributing: `Write a CONTRIBUTING.md for {fullName}, a {description}. Cover: setup, build, test, PR guidelines, commit message format. Tone: friendly, professional. Use Markdown with H2/H3 only. Keep total length under 800 words. ${NEVER_INVENT_RULE}Any concrete command you were not given must be a TODO placeholder rather than a guess.`,
	security: `Write a SECURITY.md for {fullName}. Cover: how to report a vulnerability (use the contact email {email}), and a supported-versions section. Use Markdown. Keep total length under 400 words. ${NEVER_INVENT_RULE}You have not been told which versions are supported or how fast the maintainers respond, so write those as explicit TODO placeholders for a maintainer to fill in — never state a version range, a support window, or a response-time commitment of your own.`,
	issueTemplate: `Write a GitHub bug report issue template for {fullName}. Tech stack: {language}. Output Markdown with YAML front matter (name, about, title, labels). Sections: description, reproduction steps, expected behavior, actual behavior, environment. Keep total length under 1.5 KB. ${NEVER_INVENT_RULE}`,
	prTemplate: `Write a concise PR template for {fullName}. Sections: summary, related issues, testing notes, screenshots (if UI). Output Markdown. Keep total length under 300 words. ${NEVER_INVENT_RULE}`,
	readmeStub: `Write a README.md stub for {fullName}, a {description}. Tech stack: {language}. Include: title, badges placeholder, install, quick start, license. Use Markdown with H2 sections. Keep total length under 500 words. ${NEVER_INVENT_RULE}Install and quick-start commands you were not given must be TODO placeholders, never invented commands.`,
})

function renderPromptVars(template, vars) {
	let out = template
	for (const [k, v] of Object.entries(vars)) {
		out = out.split(`{${k}}`).join(v)
	}
	return out
}

export async function generateContributing({ repo, provider }) {
	const prompt = renderPromptVars(PROMPT_TEMPLATES.contributing, {
		fullName: clean(repo?.full_name),
		description: clean(repo?.description) || 'project',
	})
	const result = await provider.generate({ prompt })
	return {
		filePath: 'CONTRIBUTING.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add CONTRIBUTING.md',
		// Additive — the route strips this before responding; it exists so
		// the caller can record the monthly AI spend cap (OWASP LLM10)
		// without this module reaching the spend-cap ledger itself.
		costUSD: result?.costUSD ?? null,
	}
}

export async function generateSecurityMd({ repo, email = 'security@example.com', provider }) {
	const prompt = renderPromptVars(PROMPT_TEMPLATES.security, {
		fullName: clean(repo?.full_name),
		email: clean(email),
	})
	const result = await provider.generate({ prompt })
	return {
		filePath: 'SECURITY.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add SECURITY.md',
		costUSD: result?.costUSD ?? null,
	}
}

export async function generateIssueTemplate({ repo, provider }) {
	const prompt = renderPromptVars(PROMPT_TEMPLATES.issueTemplate, {
		fullName: clean(repo?.full_name),
		language: clean(repo?.language) || 'unspecified',
	})
	const result = await provider.generate({ prompt })
	return {
		filePath: '.github/ISSUE_TEMPLATE/bug_report.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add bug report issue template',
		costUSD: result?.costUSD ?? null,
	}
}

export async function generatePRTemplate({ repo, provider }) {
	const prompt = renderPromptVars(PROMPT_TEMPLATES.prTemplate, {
		fullName: clean(repo?.full_name),
	})
	const result = await provider.generate({ prompt })
	return {
		filePath: '.github/PULL_REQUEST_TEMPLATE.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add pull request template',
		costUSD: result?.costUSD ?? null,
	}
}

export async function generateReadmeStub({ repo, provider }) {
	const prompt = renderPromptVars(PROMPT_TEMPLATES.readmeStub, {
		fullName: clean(repo?.full_name),
		description: clean(repo?.description) || 'project',
		language: clean(repo?.language) || 'unspecified',
	})
	const result = await provider.generate({ prompt })
	return {
		filePath: 'README.md',
		content: result?.text || '',
		suggestedCommitMessage: 'chore: add README stub',
		costUSD: result?.costUSD ?? null,
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
 * Encode `content` into the base64 payload the GitHub Contents API expects.
 *
 * `'utf8'` (the default, and the only mode every existing caller used before
 * this option existed) treats `content` as a text string and base64-encodes
 * it fresh — unchanged behaviour for CONTRIBUTING.md/SECURITY.md/LICENSE/etc.
 *
 * `'base64'` treats `content` as **already base64-encoded binary** (e.g. a
 * PNG straight from an image-generation provider) and passes it through
 * untouched. This matters because `Buffer.from(content, 'utf8').toString('base64')`
 * re-encodes a base64 *string* as if it were literal UTF-8 text — that
 * double-encodes the bytes into garbage that "commits" successfully (real
 * SHA, 200 OK) but renders as a corrupted, unopenable file on GitHub. Binary
 * write paths MUST pass `encoding: 'base64'` explicitly; there is no way to
 * auto-detect base64-vs-text content reliably enough to default to it.
 *
 * @param {string} content
 * @param {'utf8'|'base64'} encoding
 * @returns {string} base64 payload suitable for the Contents API's `content` field
 */
function encodeCommitContent(content, encoding) {
	if (encoding === 'base64') return content;
	return Buffer.from(content, 'utf8').toString('base64');
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
 * @param {'utf8'|'base64'} [args.encoding] 'utf8' (default) encodes `content` as text; 'base64'
 *   passes pre-encoded binary content (e.g. a generated PNG) through untouched — see
 *   `encodeCommitContent`'s doc comment for why the distinction is load-bearing.
 * @param {Function} args.githubApi
 * @returns {Promise<{ mode: 'direct'|'pr'|'pr-fallback', branch: string, sha?: string, prUrl?: string }>}
 */
export async function commitOrOpenPR({ owner, repo, token, filePath, content, commitMessage, mode = 'direct', encoding = 'utf8', githubApi }) {
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
				content: encodeCommitContent(content, encoding),
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
			content: encodeCommitContent(content, encoding),
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
