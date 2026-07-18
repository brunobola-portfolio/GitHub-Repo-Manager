// SPDX-License-Identifier: AGPL-3.0-only
/**
 * README Studio — consolidated grounded prompt builder + signal fetcher for
 * the score/improve flow (Feature 1, Wave 6).
 *
 * Split, like `community-health-fix.js` / `readme-enhance.js`, into:
 *   - `fetchReadmeStudioSignals` — impure (GitHub API calls), shared by both
 *     the free `readme-studio/score` route and the metered
 *     `readme-studio/improve` route so the tolerant-404 fetch pattern lives
 *     in exactly one place.
 *   - `deriveMissingSections` / `generateReadmeBadges` / `buildImprovePrompt`
 *     — pure, unit-testable without a provider or network mock.
 *
 * Honesty contract: `buildImprovePrompt` never asks the model to state a
 * license it hasn't verified, never lets it invent a badge URL, and always
 * carries the house "never invent" rule (mirrors `community-health-fix.js`).
 *
 * Spec: docs/specs/2026-07-18-community-wow-wave6.md (Feature 1, Slice 2).
 */
import { githubApi } from '../github-api.js';
import logger from '../logger.js';
import { sanitizeForPrompt } from './sanitize.js';
import { SUPPORTED_LICENSES } from './license-detect.js';

// ---------------------------------------------------------------------------
// Signal fetching (impure)
// ---------------------------------------------------------------------------

/**
 * Fetch the raw signals README Studio needs beyond what
 * `repo-context-builder.buildContext()` provides: the full (untruncated,
 * unredacted) README + top-level file listing for deterministic pattern
 * detection, the raw LICENSE content for fingerprinting, and the list of
 * workflow filenames for the badge/reality check. Every fetch is
 * tolerant-404 (a missing file degrades the signal, it never fails the
 * request) — mirrors the pattern already used by `/ai/quality-report` and
 * `/ai/readme/enhance`.
 *
 * @param {{ owner: string, repo: string, accessToken: string }} args
 * @returns {Promise<{ readmeContent: string, readmeTruncated: boolean, fileStructure: Array, licenseContent: string|null, workflowFiles: string[] }>}
 */
export async function fetchReadmeStudioSignals({ owner, repo, accessToken }) {
    let readmeContent = '';
    // GitHub's Contents/README API returns `encoding: 'none'` with empty
    // `content` (instead of `encoding: 'base64'`) for files over ~1MB or that
    // can't be decoded as UTF-8 — a README that exists but couldn't be read,
    // distinct from no README at all. Flagged separately so callers never
    // fold "huge/binary README" into "no README found".
    let readmeTruncated = false;
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } else if (data) {
            readmeTruncated = true;
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'readme-studio: README fetch failed');
    }

    let fileStructure = [];
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents`, accessToken);
        fileStructure = Array.isArray(data) ? data.map((f) => ({ name: f.name, type: f.type })) : [];
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'readme-studio: contents fetch failed');
    }

    let licenseContent = null;
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/LICENSE`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            licenseContent = Buffer.from(data.content, 'base64').toString('utf-8');
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'readme-studio: LICENSE fetch failed');
    }

    let workflowFiles = [];
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/.github/workflows`, accessToken);
        workflowFiles = Array.isArray(data) ? data.filter((f) => f.type === 'file').map((f) => f.name) : [];
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'readme-studio: workflows listing failed');
    }

    return { readmeContent, readmeTruncated, fileStructure, licenseContent, workflowFiles };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * The sections `/ai/readme/enhance` has historically offered, extended with
 * the two new deterministic checks that also map to concrete missing content.
 * @param {object} patterns — output of `detectPatterns()`
 * @param {string} [language]
 * @returns {string[]}
 */
export function deriveMissingSections(patterns, language) {
    const missing = [];
    if (!patterns.hasInstallation) missing.push('Installation');
    if (!patterns.hasUsage) missing.push('Usage');
    if (!patterns.hasExamples) missing.push('Examples');
    if (!patterns.hasContributing) missing.push('Contributing');
    if (!patterns.hasLicense) missing.push('License');
    if (!patterns.hasAPI && language) missing.push('API Reference');
    if (!patterns.hasScreenshots) missing.push('Screenshots');
    return missing;
}

/**
 * Deterministic shields.io badge markdown — no AI call, so a badge can never
 * point at a license/workflow that wasn't actually verified. Only emits a
 * license badge when `licenseSpdxId` is one of the app's supported/verified
 * templates (an unrecognized license is never guessed into a badge).
 *
 * @param {{ owner: string, repo: string, licenseSpdxId?: string|null, workflowFile?: string|null }} args
 * @returns {string[]} markdown badge snippets
 */
export function generateReadmeBadges({ owner, repo, licenseSpdxId, workflowFile }) {
    const badges = [];
    if (licenseSpdxId && SUPPORTED_LICENSES.includes(licenseSpdxId)) {
        const label = encodeURIComponent(licenseSpdxId);
        badges.push(`[![License: ${licenseSpdxId}](https://img.shields.io/badge/license-${label}-blue.svg)](LICENSE)`);
    }
    if (owner && repo && workflowFile) {
        badges.push(
            `[![CI](https://img.shields.io/github/actions/workflow/status/${owner}/${repo}/${workflowFile})](https://github.com/${owner}/${repo}/actions/workflows/${workflowFile})`
        );
    }
    return badges;
}

const TONE_INSTRUCTIONS = {
    professional: 'Professional, clear, and precise.',
    concise: 'Concise — short sentences and terse bullet points over prose.',
    enthusiastic: 'Enthusiastic and welcoming, while staying strictly accurate — no hype about features that are not evidenced below.',
};

const NEVER_INVENT_RULE = 'Never invent commands, features, endpoints, or badges that are not evidenced in the signals below. '
    + 'If something cannot be determined from the signals, say so explicitly or leave a clearly-marked placeholder '
    + '(e.g. "<!-- TODO: describe X -->") instead of fabricating.';

/**
 * Build the README Studio improve prompt. Pure — no provider call. Carries
 * the house "never invent" rule and resolves the license section
 * deterministically (never lets the model guess a license it can't verify).
 *
 * @param {object} args
 * @param {object} args.repo — { full_name, language }
 * @param {object} args.context — `repo-context-builder.buildContext()` result
 * @param {object} args.patterns — `detectPatterns()` result (with license/CI extras)
 * @param {string[]} args.missingSections
 * @param {string[]} [args.workflowFiles]
 * @param {object} [args.config] — { mode, tone, sections, license, stackOverride, badges }
 * @returns {{ prompt: string, mode: 'missing-sections'|'full-rewrite', warnings: string[], missingSections: string[], badges: string[] }}
 */
export function buildImprovePrompt({ repo, context, patterns, missingSections, workflowFiles = [], config = {} }) {
    const mode = config.mode === 'full-rewrite' ? 'full-rewrite' : 'missing-sections';
    const tone = TONE_INSTRUCTIONS[config.tone] || TONE_INSTRUCTIONS.professional;
    const warnings = [];
    const licenseDetected = patterns?.licenseDetected ?? null;

    let licenseInstruction;
    if (config.license && licenseDetected?.matched && config.license !== licenseDetected.spdxId) {
        warnings.push(`Selected license (${config.license}) doesn't match the detected LICENSE file (${licenseDetected.spdxId}) — using the LICENSE file's actual license instead.`);
        licenseInstruction = `The repository's actual LICENSE file is ${licenseDetected.spdxId} (verified by fingerprint match) — state that license, not ${sanitizeForPrompt(config.license, 50)}.`;
    } else if (licenseDetected?.matched) {
        licenseInstruction = `Repository license (verified against the LICENSE file): ${licenseDetected.spdxId}.`;
    } else if (licenseDetected && !licenseDetected.matched) {
        warnings.push('LICENSE file present but not recognized as one of the supported templates — labeled as custom/unrecognized rather than guessed.');
        licenseInstruction = 'A LICENSE file exists but could not be identified — describe the license as "custom/unrecognized — verify manually," do not name a specific SPDX id.';
    } else {
        licenseInstruction = 'No LICENSE file was found in the repository — do not state a specific license; note it as unlicensed/unspecified or leave a placeholder.';
    }

    const sectionsInstruction = Array.isArray(config.sections) && config.sections.length > 0
        ? `Only include these optional sections if the user selected them: ${config.sections.map((s) => sanitizeForPrompt(s, 40)).join(', ')}.`
        : '';

    const stackLine = config.stackOverride
        ? `Stack override (user-provided — may differ from auto-detection, prefer it): ${sanitizeForPrompt(config.stackOverride, 100)}`
        : '';

    const [owner, repoName] = String(repo?.full_name || '').split('/');
    const workflowFile = workflowFiles[0] || null;
    const badges = config.badges ? generateReadmeBadges({ owner, repo: repoName, licenseSpdxId: licenseDetected?.matched ? licenseDetected.spdxId : null, workflowFile }) : [];
    const badgesInstruction = config.badges
        ? (badges.length > 0
            ? `Include ONLY these verified badge snippets, verbatim, near the top of the README:\n${badges.join('\n')}`
            : 'Badges were requested but none could be verified (no recognized license/workflow) — omit badges rather than inventing one.')
        : 'Do not include badges.';

    const contextText = (context?.sections || [])
        .map((s) => `--- ${s.label} (${s.kind}) ---\n${s.content}`)
        .join('\n\n');

    const confidence = context?.confidence || 'low';
    if (confidence !== 'high') {
        warnings.push(`Grounding confidence is ${confidence} — generated content is based on limited repository signals.`);
    }

    const taskInstruction = mode === 'full-rewrite'
        ? 'Task: Rewrite the ENTIRE README.md using only the signals below. Return the full markdown document.'
        : `Task: Generate ONLY the missing sections as markdown (${missingSections.join(', ') || 'none strictly missing — lightly tighten structure only'}). Return ONLY the markdown for those sections — no existing content, no JSON wrapper.`;

    const prompt = `
You are a technical writer improving a GitHub README, grounded strictly in the evidence below.

Project: ${sanitizeForPrompt(repo?.full_name || repo?.name || '', 200)}
${licenseInstruction}
${stackLine}

Tone: ${tone}
${sectionsInstruction}
${badgesInstruction}

${NEVER_INVENT_RULE}

Repository signals:
${contextText || '(no additional signals available)'}

${taskInstruction}
Each section should start with a ## heading.
`.trim();

    return { prompt, mode, warnings, missingSections, badges };
}

// ---------------------------------------------------------------------------
// buildDeterministicReadmePatch — zero-AI-cost fallback (Addendum 6b.2)
// ---------------------------------------------------------------------------

// Manifest → install command mapping, refined by the lockfile actually
// present in the top-level listing when the stack is Node (mirrors
// agent-rules.js's `buildSetupSection` in spirit, at the coarser signal
// granularity README Studio's `fileStructure` already fetches — no extra
// GitHub call is made just for this fallback).
const NODE_LOCKFILE_INSTALL_CMDS = [
    ['pnpm-lock.yaml', 'pnpm install'],
    ['yarn.lock', 'yarn install'],
    ['package-lock.json', 'npm ci'],
];

function detectDeterministicInstallCommand(patterns, fileStructure) {
    const names = (fileStructure || []).map((f) => f.name);
    if (patterns.isNodeProject) {
        const lock = NODE_LOCKFILE_INSTALL_CMDS.find(([file]) => names.includes(file));
        return lock ? lock[1] : 'npm install';
    }
    if (patterns.isPythonProject) {
        return names.includes('pyproject.toml') && !names.includes('requirements.txt')
            ? 'pip install -e .  # or: poetry install, if this project uses Poetry'
            : 'pip install -r requirements.txt';
    }
    if (patterns.isRustProject) return 'cargo build';
    if (patterns.isGoProject) return 'go build ./...';
    if (patterns.isJavaProject) return names.includes('pom.xml') ? 'mvn install' : './gradlew build';
    return null;
}

/**
 * Deterministic License section — built directly from `detectLicense()`'s
 * verified fingerprint match against the actual LICENSE file content. Never
 * states a license the fingerprint didn't match (same honesty contract as
 * `buildImprovePrompt`'s AI path, applied without a model in the loop).
 */
function buildDeterministicLicenseSection(licenseDetected) {
    if (licenseDetected?.matched) {
        return `## License\n\nThis project is licensed under the ${licenseDetected.spdxId} License — see the [LICENSE](LICENSE) file for details.`;
    }
    if (licenseDetected && !licenseDetected.matched) {
        return '## License\n\n<!-- TODO: a LICENSE file is present but its license could not be automatically verified — describe it here (custom/unrecognized license, verify manually). -->';
    }
    return '## License\n\n<!-- TODO: no LICENSE file was found in this repository. Add one and describe it here. -->';
}

/**
 * Deterministic Installation section — from the manifest/lockfile the
 * top-level file listing evidences. Leaves a TODO rather than guessing when
 * no recognizable manifest is present.
 */
function buildDeterministicInstallSection(patterns, fileStructure) {
    const cmd = detectDeterministicInstallCommand(patterns, fileStructure);
    if (!cmd) {
        return '## Installation\n\n<!-- TODO: no recognizable manifest (package.json, requirements.txt/pyproject.toml, Cargo.toml, go.mod, pom.xml/build.gradle) was detected — add install instructions here. -->';
    }
    return `## Installation\n\n\`\`\`sh\n${cmd}\n\`\`\``;
}

function toHeadingAnchor(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

/**
 * Table of contents built from the README's own existing `##` headings
 * (refresh mode) plus whatever sections this same patch is about to add —
 * never a heading that isn't actually present in the resulting document.
 */
function buildDeterministicTOCSection(readmeContent, addedSectionTitles = []) {
    const existingHeadings = [...(readmeContent || '').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
    const allTitles = [...new Set([...existingHeadings, ...addedSectionTitles])];
    if (allTitles.length === 0) {
        return "## Table of Contents\n\n<!-- TODO: add links to this README's sections here. -->";
    }
    const links = allTitles.map((t) => `- [${t}](#${toHeadingAnchor(t)})`);
    return `## Table of Contents\n\n${links.join('\n')}`;
}

/**
 * Deterministic, zero-AI-cost README patch — builds the same kind of
 * "missing sections" content `buildImprovePrompt` would ask an AI to write,
 * directly from the deterministic signals the free score stage already
 * computes: License from `detectLicense()`'s verified fingerprint, Install
 * from the detected stack manifest/lockfile, and a Table of Contents from
 * the README's own headings — every section that can't be derived this way
 * gets an explicit TODO placeholder rather than a guess.
 *
 * Used whenever the AI path is unavailable — no provider configured, a
 * provider error, or the user is over their `readmeGenPerMonth` quota
 * (Addendum 6b.2, docs/specs/2026-07-18-community-wow-wave6.md §6b.2) — so
 * README Studio's improve stage never hard-blocks on AI availability; only
 * the AI-authored prose polish is lost, never the ability to fill in a
 * missing License/Install/TOC or stand up a minimal skeleton README.
 *
 * @param {object} args
 * @param {object} args.repo — { full_name }
 * @param {string} args.readmeContent — full current README ('' when absent)
 * @param {Array<{name:string,type:string}>} args.fileStructure
 * @param {object} args.patterns — `detectPatterns()` result
 * @param {string[]} [args.missingSections] — `deriveMissingSections()` result
 * @param {'missing-sections'|'full-rewrite'} [args.mode] — caller's requested
 *   mode; forced to 'full-rewrite' when there's no README to patch either way
 * @returns {{ markdown: string, sections: string[], mode: 'missing-sections'|'full-rewrite' }}
 */
export function buildDeterministicReadmePatch({ repo, readmeContent, fileStructure, patterns = {}, missingSections = [], mode }) {
    const hasReadme = !!(readmeContent || '').trim();
    const resolvedMode = (mode === 'full-rewrite' || !hasReadme) ? 'full-rewrite' : 'missing-sections';
    const parts = [];
    const sectionsAdded = [];

    if (resolvedMode === 'full-rewrite') {
        const repoName = String(repo?.full_name || '').split('/')[1] || repo?.full_name || 'Project';
        parts.push(
            `# ${repoName}\n\n`
            + '> Deterministic skeleton — generated directly from detected repo signals (no AI). '
            + 'Enable an AI provider in Settings for a richer, prose-polished README.\n\n'
            + '<!-- TODO: describe what this project does in one or two sentences. -->'
        );
        sectionsAdded.push('Installation', 'License');
        parts.push(buildDeterministicTOCSection('', sectionsAdded));
        parts.push(buildDeterministicInstallSection(patterns, fileStructure));
        parts.push(buildDeterministicLicenseSection(patterns.licenseDetected));
    } else {
        if (missingSections.includes('License')) {
            parts.push(buildDeterministicLicenseSection(patterns.licenseDetected));
            sectionsAdded.push('License');
        }
        if (missingSections.includes('Installation')) {
            parts.push(buildDeterministicInstallSection(patterns, fileStructure));
            sectionsAdded.push('Installation');
        }
        if (!patterns.hasTableOfContents) {
            parts.push(buildDeterministicTOCSection(readmeContent, sectionsAdded));
            sectionsAdded.push('Table of Contents');
        }
    }

    return { markdown: parts.join('\n\n'), sections: sectionsAdded, mode: resolvedMode };
}
