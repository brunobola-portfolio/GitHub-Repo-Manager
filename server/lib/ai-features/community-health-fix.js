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

/**
 * Registry of file generators consumed by the /community-health/generate
 * endpoint. Each entry declares the destination path and whether the
 * generator runs deterministically (no AI) or via the provider abstraction.
 *
 * Other generators (contributing, security, …) are added in Task 3 of the plan.
 */
export const FILE_GENERATORS = {
	license: { path: 'LICENSE', generator: generateLicense, deterministic: true },
	code_of_conduct: { path: 'CODE_OF_CONDUCT.md', generator: generateCodeOfConduct, deterministic: true },
}
