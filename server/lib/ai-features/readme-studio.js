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
 * @returns {Promise<{ readmeContent: string, fileStructure: Array, licenseContent: string|null, workflowFiles: string[] }>}
 */
export async function fetchReadmeStudioSignals({ owner, repo, accessToken }) {
    let readmeContent = '';
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
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

    return { readmeContent, fileStructure, licenseContent, workflowFiles };
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
