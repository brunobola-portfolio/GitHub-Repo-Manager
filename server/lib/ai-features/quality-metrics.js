/**
 * Heuristic pattern detection + quality scoring for a repository.
 *
 * Pure, provider-less functions extracted from AIService. Exported individually
 * so each consumer (AIService itself, dev-toolkit route, tests) can pick what
 * it needs without instantiating the service.
 */

/**
 * Detect README sections and project characteristics.
 * @param {string} readmeContent
 * @param {Array<{ name?: string, type?: string }>} fileStructure
 * @returns {object} Detected patterns
 */
export function detectPatterns(readmeContent, fileStructure) {
    const readme = (readmeContent || '').toLowerCase();
    const files = (fileStructure || []).map(f => f.name?.toLowerCase() || '');
    const dirs = fileStructure?.filter(f => f.type === 'dir').map(f => f.name?.toLowerCase()) || [];

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
        isNodeProject: files.includes('package.json'),
        isPythonProject: files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml'),
        isRustProject: files.includes('cargo.toml'),
        isGoProject: files.includes('go.mod'),
        isJavaProject: files.includes('pom.xml') || files.includes('build.gradle'),
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
    const patterns = detectPatterns(readmeContent, fileStructure);
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
