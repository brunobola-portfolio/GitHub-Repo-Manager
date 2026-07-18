import { detectLicense } from './license-detect.js';

/**
 * Heuristic pattern detection + quality scoring for a repository.
 *
 * Pure, provider-less functions extracted from AIService. Exported individually
 * so each consumer (AIService itself, dev-toolkit route, tests) can pick what
 * it needs without instantiating the service.
 */

// SPDX ids this app recognises (mirrors license-detect.js's SUPPORTED_LICENSES)
// mapped to the loose tokens a human might actually type in a README's
// License section or badge alt text. Used only to *extract a claim*, never to
// generate one — the claim is then cross-checked against `detectLicense()`'s
// result on the real LICENSE file content.
const LICENSE_CLAIM_TOKENS = [
    { spdxId: 'MIT', tokens: ['mit license', 'mit'] },
    { spdxId: 'Apache-2.0', tokens: ['apache-2.0', 'apache 2.0', 'apache license'] },
    { spdxId: 'GPL-3.0', tokens: ['gpl-3.0', 'gplv3', 'gnu general public license v3'] },
    { spdxId: 'BSD-3-Clause', tokens: ['bsd-3-clause', '3-clause bsd'] },
    { spdxId: 'MPL-2.0', tokens: ['mpl-2.0', 'mozilla public license'] },
];

/**
 * Best-effort extraction of the license the README *claims* (License section
 * prose or badge alt text) — a simple token scan, not a parser. Returns a
 * SUPPORTED_LICENSES spdxId or null when no recognizable claim is found.
 */
function extractClaimedLicenseFromReadme(readme) {
    const lower = (readme || '').toLowerCase();
    if (!lower) return null;
    for (const { spdxId, tokens } of LICENSE_CLAIM_TOKENS) {
        if (tokens.some((t) => lower.includes(t))) return spdxId;
    }
    return null;
}

/**
 * True when the README references a CI badge for a workflow file that isn't
 * actually present in `.github/workflows/` — a stale/renamed-workflow badge.
 * Returns false (not "broken") when the README references no workflow badge
 * at all — this check only flags a *provable* mismatch.
 *
 * Handles both common badge URL shapes:
 *   .../actions/workflows/ci.yml/badge.svg
 *   img.shields.io/github/actions/workflow/status/{owner}/{repo}/ci.yml
 * by pulling every parenthesized URL that mentions an actions/workflow(s)
 * path and taking its trailing `*.yml`/`*.yaml` path segment, whatever comes
 * between the two.
 */
function badgeReferencesMissingWorkflow(readme, workflowFiles) {
    if (!readme) return false;
    const present = new Set((workflowFiles || []).map((f) => String(f).toLowerCase()));
    const urls = [...readme.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
    for (const url of urls) {
        if (!/actions\/workflows?\//i.test(url)) continue;
        const segments = url.split(/[/?]/).filter(Boolean);
        const fileSeg = [...segments].reverse().find((s) => /\.ya?ml$/i.test(s));
        if (fileSeg && !present.has(fileSeg.toLowerCase())) return true;
    }
    return false;
}

// Recognisable install-command shapes per detected stack. Used only to
// cross-check the README's own install block against the manifest-detected
// stack — never to invent a command.
const STACK_INSTALL_HINTS = {
    isNodeProject: /\b(npm|yarn|pnpm)\s+(install|add|ci)\b/i,
    isPythonProject: /\b(pip|pip3|poetry|pipenv)\s+install\b/i,
    isRustProject: /\bcargo\s+(build|install)\b/i,
    isGoProject: /\bgo\s+(get|install|build)\b/i,
    isJavaProject: /\b(mvn|gradle|\.\/gradlew)\b/i,
};

/**
 * Compares the README's install command shape against the manifest-detected
 * stack(s). Returns:
 *   - `true`  — the README's install command matches a detected stack
 *   - `false` — the README's install command matches ONLY an undetected stack
 *               (a likely mismatch, e.g. `pip install` in a Node repo)
 *   - `null`  — inconclusive (no README, no detected stack, or no
 *               recognizable install command at all) — never guess.
 */
function installMatchesDetectedStack(readme, patterns) {
    if (!readme) return null;
    const detectedStacks = Object.keys(STACK_INSTALL_HINTS).filter((k) => patterns[k]);
    if (detectedStacks.length === 0) return null;
    const matchedStacks = Object.entries(STACK_INSTALL_HINTS)
        .filter(([, re]) => re.test(readme))
        .map(([k]) => k);
    if (matchedStacks.length === 0) return null;
    return matchedStacks.some((k) => detectedStacks.includes(k));
}

/**
 * Non-badge image markdown (`![alt](url)`) or a docs/images-style directory
 * — a rough proxy for "does this README show the product."
 */
function hasScreenshotsOrVisuals(readme, fileStructure) {
    const dirs = (fileStructure || []).filter((f) => f.type === 'dir').map((f) => f.name?.toLowerCase());
    if (dirs?.some((d) => d === 'images' || d === 'screenshots')) return true;
    if (!readme) return false;
    const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
    return images.some((m) => !/shields\.io|badge/i.test(m[1]));
}

// Loose standard-readme ordering: Install → Usage → Contributing → License.
// Only the headings that are actually present are compared, so a README
// missing one of them isn't penalized twice (that's `hasX` patterns' job).
const SECTION_ORDER_HEADINGS = [
    { key: 'install', re: /^#{1,3}\s*.*(install|setup)/im },
    { key: 'usage', re: /^#{1,3}\s*.*(usage|getting started)/im },
    { key: 'contributing', re: /^#{1,3}\s*.*contribut/im },
    { key: 'license', re: /^#{1,3}\s*.*licen[sc]e/im },
];

/**
 * True when present standard-readme sections appear in a sane relative
 * order. True (not penalized) when there's nothing to compare.
 */
function detectSectionOrderSanity(readme) {
    if (!readme) return true;
    const positions = SECTION_ORDER_HEADINGS
        .map(({ re }) => readme.match(re)?.index)
        .filter((p) => p !== undefined);
    for (let i = 1; i < positions.length; i++) {
        if (positions[i] < positions[i - 1]) return false;
    }
    return true;
}

/**
 * Detect README sections and project characteristics.
 * @param {string} readmeContent
 * @param {Array<{ name?: string, type?: string }>} fileStructure
 * @param {object} [extra] — additional signals for the honesty-check
 *   dimensions (README Studio). All optional — omitting `extra` keeps this
 *   function's original 2-arg contract fully backward compatible.
 * @param {string|null} [extra.licenseFileContent] — raw LICENSE file content,
 *   fingerprinted via `detectLicense()` to cross-check the README's claim.
 * @param {string[]} [extra.workflowFiles] — filenames under `.github/workflows/`
 * @returns {object} Detected patterns
 */
export function detectPatterns(readmeContent, fileStructure, extra = {}) {
    const readmeRaw = readmeContent || '';
    const readme = readmeRaw.toLowerCase();
    const files = (fileStructure || []).map(f => f.name?.toLowerCase() || '');
    const dirs = fileStructure?.filter(f => f.type === 'dir').map(f => f.name?.toLowerCase()) || [];

    const isNodeProject = files.includes('package.json');
    const isPythonProject = files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml');
    const isRustProject = files.includes('cargo.toml');
    const isGoProject = files.includes('go.mod');
    const isJavaProject = files.includes('pom.xml') || files.includes('build.gradle');

    // README Studio dimensions (all zero-AI-cost — deterministic string/regex
    // matches only). `licenseFileContent` is only fingerprinted when supplied
    // (callers that don't pass `extra` get `licenseDetected: null`, never a
    // guessed value).
    const licenseFileContent = extra.licenseFileContent ?? null;
    const licenseDetected = licenseFileContent ? detectLicense(licenseFileContent) : null;
    const licenseClaimed = extractClaimedLicenseFromReadme(readmeRaw);
    const licenseMismatch = (licenseDetected?.matched && licenseClaimed)
        ? licenseDetected.spdxId !== licenseClaimed
        : null;

    const stackPatterns = { isNodeProject, isPythonProject, isRustProject, isGoProject, isJavaProject };

    return {
        // README sections
        hasInstallation: /## install|## setup|npm install|yarn add|pip install/.test(readme),
        hasUsage: /## usage|## getting started|## how to use/.test(readme),
        hasExamples: /## example|```/.test(readme),
        hasContributing: /## contribut|contributing\.md/.test(readme) || files.includes('contributing.md'),
        hasLicense: /## license|license\.md|mit license|apache/.test(readme) || files.includes('license') || files.includes('license.md'),
        hasAPI: /## api|## endpoints|## methods/.test(readme),
        hasBadges: /\[!\[|shields\.io|badge/.test(readme),
        hasTableOfContents: /## table of contents|\* \[/.test(readme),

        // Project characteristics
        hasCI: files.some(f => f.includes('workflow') || f === '.travis.yml' || f === '.circleci') || dirs.includes('.github'),
        hasTests: dirs.some(d => ['test', 'tests', '__tests__', 'spec'].includes(d)) || files.some(f => f.includes('.test.') || f.includes('.spec.')),
        hasDocs: dirs.includes('docs') || dirs.includes('documentation'),
        hasDocker: files.includes('dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml'),
        hasConfig: files.some(f => f.includes('config') || f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')),

        // Project type hints
        ...stackPatterns,

        // README Studio — deterministic honesty-check dimensions (NEW)
        hasScreenshots: hasScreenshotsOrVisuals(readmeRaw, fileStructure),
        sectionOrderOk: detectSectionOrderSanity(readmeRaw),
        licenseDetected,
        licenseClaimed,
        licenseMismatch,
        ciBadgeBroken: badgeReferencesMissingWorkflow(readmeRaw, extra.workflowFiles),
        installMatchesStack: installMatchesDetectedStack(readmeRaw, stackPatterns),
    };
}

/**
 * Calculate quality metrics from detected patterns.
 * @param {object} patterns - Output from detectPatterns
 * @param {object} repoData - GitHub repo metadata
 * @returns {object} { overall, breakdown, patterns }
 */
export function calculateQualityMetrics(patterns, repoData) {
    let score = 50; // Base score
    const breakdown = {};

    // Documentation (30 points max)
    let docScore = 0;
    if (patterns.hasInstallation) docScore += 8;
    if (patterns.hasUsage) docScore += 8;
    if (patterns.hasExamples) docScore += 7;
    if (patterns.hasAPI) docScore += 7;
    breakdown.documentation = Math.min(docScore, 30);
    score += breakdown.documentation;

    // Community Standards (20 points max)
    let communityScore = 0;
    if (patterns.hasContributing) communityScore += 7;
    if (patterns.hasLicense) communityScore += 7;
    if (repoData?.description) communityScore += 6;
    breakdown.community = Math.min(communityScore, 20);
    score += breakdown.community - 10; // Adjust base

    // Engineering (20 points max)
    let engScore = 0;
    if (patterns.hasCI) engScore += 10;
    if (patterns.hasTests) engScore += 10;
    breakdown.engineering = Math.min(engScore, 20);
    score += breakdown.engineering;

    // Polish (10 points max)
    let polishScore = 0;
    if (patterns.hasBadges) polishScore += 5;
    if (patterns.hasTableOfContents) polishScore += 5;
    breakdown.polish = Math.min(polishScore, 10);
    score += breakdown.polish;

    // Trust (10 points max) — README Studio's honesty-check dimensions.
    // Each check only awards points when it was actually able to verify
    // something (a `null` result — e.g. no LICENSE file to check against —
    // is neutral, not penalized).
    let trustScore = 0;
    if (patterns.licenseMismatch === false) trustScore += 3;
    if (!patterns.ciBadgeBroken) trustScore += 2;
    if (patterns.installMatchesStack !== false) trustScore += 3;
    if (patterns.sectionOrderOk) trustScore += 2;
    breakdown.trust = Math.min(trustScore, 10);
    score += breakdown.trust;

    return {
        overall: Math.max(0, Math.min(100, score)),
        breakdown,
        patterns
    };
}

export function getScoreSummary(score) {
    if (score >= 90) return 'Excellent! This repository follows best practices.';
    if (score >= 75) return 'Good quality. A few improvements would make it great.';
    if (score >= 50) return 'Decent foundation. Consider adding documentation and tests.';
    return 'Needs attention. Focus on documentation and community standards.';
}

/**
 * Build a quality report with prioritized recommendations.
 * Pure (no provider needed).
 */
export function generateQualityReport(repoData, readmeContent, fileStructure, _extraData = {}) {
    const patterns = detectPatterns(readmeContent, fileStructure, _extraData);
    const quality = calculateQualityMetrics(patterns, repoData);

    const recommendations = [];
    if (!patterns.hasInstallation) recommendations.push({ priority: 'high', action: 'Add installation instructions to README' });
    if (!patterns.hasUsage) recommendations.push({ priority: 'high', action: 'Add usage examples to README' });
    if (!patterns.hasTests) recommendations.push({ priority: 'high', action: 'Add unit tests to improve reliability' });
    if (!patterns.hasCI) recommendations.push({ priority: 'medium', action: 'Set up CI/CD with GitHub Actions' });
    if (!patterns.hasContributing) recommendations.push({ priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines' });
    if (!patterns.hasLicense) recommendations.push({ priority: 'high', action: 'Add a LICENSE file' });
    if (!patterns.hasBadges) recommendations.push({ priority: 'low', action: 'Add status badges to README' });
    if (!repoData.description) recommendations.push({ priority: 'high', action: 'Add a repository description' });
    if (!repoData.topics?.length) recommendations.push({ priority: 'medium', action: 'Add topics/tags for discoverability' });

    // README Studio — honesty-check recommendations. Only fire when the
    // underlying check was actually able to verify something (never guess).
    if (patterns.licenseMismatch === true) {
        recommendations.push({ priority: 'high', action: `README's stated license doesn't match the LICENSE file (detected: ${patterns.licenseDetected?.spdxId}) — verify and correct it` });
    } else if (patterns.licenseDetected && !patterns.licenseDetected.matched) {
        recommendations.push({ priority: 'medium', action: 'LICENSE file present but not a recognized template — verify it manually' });
    }
    if (patterns.ciBadgeBroken) {
        recommendations.push({ priority: 'medium', action: 'CI badge references a workflow file that no longer exists in .github/workflows' });
    }
    if (patterns.installMatchesStack === false) {
        recommendations.push({ priority: 'medium', action: "Install instructions don't match the detected project stack" });
    }
    if (!patterns.hasScreenshots) {
        recommendations.push({ priority: 'low', action: 'Add a screenshot or visual to showcase the project' });
    }
    if (!patterns.sectionOrderOk) {
        recommendations.push({ priority: 'low', action: 'Reorder README sections to follow standard conventions (Install → Usage → Contributing → License)' });
    }

    return {
        score: quality.overall,
        breakdown: quality.breakdown,
        patterns,
        recommendations: recommendations.sort((a, b) => {
            const order = { high: 0, medium: 1, low: 2 };
            return order[a.priority] - order[b.priority];
        }),
        summary: getScoreSummary(quality.overall)
    };
}
