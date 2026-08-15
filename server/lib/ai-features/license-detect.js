// SPDX-License-Identifier: Apache-2.0
/**
 * License detection — pure, deterministic fingerprinting of an existing
 * `LICENSE` file's content against the templates this app already ships
 * (`SUPPORTED_LICENSES` / `license-templates/*.txt` in `community-health-fix.js`).
 *
 * No AI call, zero cost. Used by README Studio (Feature 1) to cross-check a
 * README's stated license against the repo's actual LICENSE file, and to
 * seed the license dropdown's "detected" default.
 *
 * Matching strategy: normalize both the candidate text and each canonical
 * template (strip copyright-notice lines — the only per-project variable
 * content in these templates — lowercase, strip punctuation, collapse
 * whitespace), then score word-multiset containment of the template inside
 * the candidate. Real-world LICENSE files are near-verbatim reproductions of
 * these canonical texts, so a high containment ratio is a reliable
 * fingerprint without needing a model call.
 *
 * Falls back to scanning the first ~10 lines for an explicit
 * `SPDX-License-Identifier:` header when the fingerprint match is
 * inconclusive (e.g. a heavily reformatted or partial LICENSE file that
 * still declares its id unambiguously).
 *
 * Spec: docs/specs/2026-07-18-community-wow-wave6.md (Feature 1 backend,
 * Slice 1 — Foundation).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_LICENSES } from './community-health-fix.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'license-templates')

// Ratio thresholds for the word-containment fingerprint score (see
// `containmentRatio` below). Chosen so a verbatim (or whitespace/punctuation-
// only-diverged) copy scores 'high', a reformatted-but-recognizable copy
// scores 'medium', and anything looser falls through to the SPDX-header
// fallback (or is reported unmatched).
const HIGH_CONFIDENCE_THRESHOLD = 0.97
const MEDIUM_CONFIDENCE_THRESHOLD = 0.75

/**
 * Strip copyright-notice lines (the only per-project variable content in
 * these templates — `{{year}}`/`{{owner}}` in our canonical copies, a real
 * year + owner name in an actual LICENSE file), lowercase, strip
 * punctuation, and collapse whitespace so two otherwise-identical license
 * bodies compare equal regardless of formatting/copyright-holder details.
 */
function normalizeLicenseText(text) {
	return String(text ?? '')
		.split(/\r?\n/)
		.filter((line) => !/copyright/i.test(line))
		.join(' ')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function tokenize(normalized) {
	return normalized.length ? normalized.split(' ') : []
}

/**
 * Fraction of `templateWords` (as a multiset) found within `candidateWords`.
 * 1.0 means every word in the template appears (with at least the same
 * multiplicity) somewhere in the candidate — the expected result for a
 * verbatim copy, order-independent so minor paragraph reflow doesn't matter.
 */
function containmentRatio(candidateWords, templateWords) {
	if (templateWords.length === 0) return 0
	const candidateFreq = new Map()
	for (const w of candidateWords) candidateFreq.set(w, (candidateFreq.get(w) || 0) + 1)

	const templateFreq = new Map()
	for (const w of templateWords) templateFreq.set(w, (templateFreq.get(w) || 0) + 1)

	let matched = 0
	for (const [word, count] of templateFreq) {
		matched += Math.min(count, candidateFreq.get(word) || 0)
	}
	return matched / templateWords.length
}

let templateCache = null
function loadNormalizedTemplates() {
	if (templateCache) return templateCache
	templateCache = SUPPORTED_LICENSES.map((id) => {
		const raw = fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.txt`), 'utf8')
		const normalized = normalizeLicenseText(raw)
		return { id, words: tokenize(normalized) }
	})
	return templateCache
}

/**
 * Scan the first `maxLines` lines of `text` for an
 * `SPDX-License-Identifier: <id>` header and return `<id>` if it matches one
 * of `SUPPORTED_LICENSES` exactly.
 */
function detectSpdxHeader(text, maxLines = 10) {
	const lines = String(text ?? '').split(/\r?\n/).slice(0, maxLines)
	for (const line of lines) {
		const m = line.match(/SPDX-License-Identifier:\s*([^\s]+)/i)
		if (m && SUPPORTED_LICENSES.includes(m[1])) {
			return m[1]
		}
	}
	return null
}

/**
 * Fingerprint `licenseText` (typically a repo's `LICENSE` file content)
 * against the 5 canonical templates this app ships, falling back to an
 * explicit `SPDX-License-Identifier:` header scan when no template scores
 * confidently.
 *
 * @param {string} licenseText
 * @returns {{ spdxId: string, confidence: 'high'|'medium', matched: true } | { spdxId: null, matched: false }}
 */
export function detectLicense(licenseText) {
	const trimmed = String(licenseText ?? '').trim()
	if (!trimmed) return { spdxId: null, matched: false }

	const candidateWords = tokenize(normalizeLicenseText(trimmed))

	let best = null // { id, ratio }
	for (const template of loadNormalizedTemplates()) {
		const ratio = containmentRatio(candidateWords, template.words)
		if (!best || ratio > best.ratio) best = { id: template.id, ratio }
	}

	if (best && best.ratio >= HIGH_CONFIDENCE_THRESHOLD) {
		return { spdxId: best.id, confidence: 'high', matched: true }
	}
	if (best && best.ratio >= MEDIUM_CONFIDENCE_THRESHOLD) {
		return { spdxId: best.id, confidence: 'medium', matched: true }
	}

	const spdxId = detectSpdxHeader(trimmed)
	if (spdxId) {
		return { spdxId, confidence: 'high', matched: true }
	}

	return { spdxId: null, matched: false }
}

export { SUPPORTED_LICENSES }
