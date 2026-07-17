import logger from '../logger.js';
import { AIError, AI_ERROR_CODE } from '../ai-provider.js';
import { sanitizeForPrompt } from './sanitize.js';
import { detectPatterns, calculateQualityMetrics } from './quality-metrics.js';

/**
 * Generate a summary + structured insights for a GitHub repository.
 *
 * Extracted from AIService so routes or workers can invoke with an
 * injected provider instead of reaching through the singleton.
 *
 * @param {object} ctx
 * @param {object} ctx.provider - AI provider with .generate() + .model
 * @param {object} repoData - GitHub repo object
 * @param {string} readmeContent - Raw README text
 * @param {object} fileStructure - Truncated file tree
 */
export async function analyzeRepo(ctx, repoData, readmeContent, fileStructure) {
    const provider = ctx?.provider;
    if (!provider?.model) {
        throw new Error('AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.');
    }

    const patterns = detectPatterns(readmeContent, fileStructure);
    const quality = calculateQualityMetrics(patterns, repoData);

    const prompt = `
            Analyze this GitHub repository and provide insights.

            Name: ${sanitizeForPrompt(repoData.name, 200)}
            Description: ${sanitizeForPrompt(repoData.description, 500) || 'None'}
            Language: ${sanitizeForPrompt(repoData.language, 100) || 'Not specified'}
            Topics: ${sanitizeForPrompt(repoData.topics?.join(', '), 500) || 'None'}
            Stars: ${repoData.stargazers_count || 0}
            Forks: ${repoData.forks_count || 0}
            Open Issues: ${repoData.open_issues_count || 0}

            README (Excerpt):
            ${sanitizeForPrompt(readmeContent, 2500) || 'No README found'}

            File Structure:
            ${sanitizeForPrompt(JSON.stringify(fileStructure || [], null, 2), 3000)}

            Detected Patterns:
            - Has installation docs: ${patterns.hasInstallation}
            - Has usage examples: ${patterns.hasUsage}
            - Has CI/CD: ${patterns.hasCI}
            - Has tests: ${patterns.hasTests}
            - Has contributing guide: ${patterns.hasContributing}
            - Has license: ${patterns.hasLicense}

            Provide a JSON response with:
            1. "summary": TL;DR (2 sentences max, focus on what it does and who it's for)
            2. "project_type": One of [library, framework, application, tool, template, documentation, other]
            3. "suggested_topics": Array of 3-5 relevant tags not already in topics
            4. "improvements": Array of 3-4 specific, actionable improvements based on what's missing
            5. "readme_suggestions": Array of specific README sections to add (if any are missing)
            6. "highlights": Array of 2-3 positive aspects of the project

            Return ONLY valid JSON (no markdown, no explanation):
        `;

    try {
        const { text, usage, costUSD } = await provider.generate({ prompt });
        const aiAnalysis = JSON.parse(text);

        const result = {
            ...aiAnalysis,
            health_score: quality.overall,
            quality_breakdown: quality.breakdown,
            patterns: quality.patterns
        };
        // Non-enumerable so JSON.stringify (route responses / DB writes that
        // spread this object) never leak internal cost bookkeeping — callers
        // that need it (spend-cap accounting) read the property directly.
        Object.defineProperty(result, '_costUSD', { value: costUSD ?? null, enumerable: false });
        Object.defineProperty(result, '_usage', { value: usage ?? null, enumerable: false });
        return result;
    } catch (error) {
        logger.error({ err: error }, 'Repository analysis failed');
        if (error instanceof AIError && error.code === AI_ERROR_CODE.NOT_FOUND) {
            throw new Error(`AI model not available. Please verify GEMINI_MODEL configuration in .env file.`);
        }
        throw error;
    }
}
