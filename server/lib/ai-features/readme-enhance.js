import logger from '../logger.js';
import { AIError, AI_ERROR_CODE } from '../ai-provider.js';
import { sanitizeForPrompt } from './sanitize.js';
import { detectPatterns } from './quality-metrics.js';

/**
 * Build the README-enhance prompt (no LLM call). Pure: detects missing
 * sections + patterns and renders the prompt. Exposed so route handlers can
 * run the generation through `guardedGenerate` (spend cap / output cap / spend
 * record / cost audit) instead of the server-provider-only `enhanceReadme`.
 *
 * @param {string} currentReadme
 * @param {object} repoData - Repository metadata
 * @param {object} fileStructure - File tree
 * @returns {{ prompt: string, missingSections: string[], patterns: object }}
 */
export function buildReadmeEnhancePrompt(currentReadme, repoData, fileStructure) {
    const patterns = detectPatterns(currentReadme, fileStructure);
    const missingSections = [];
    if (!patterns.hasInstallation) missingSections.push('Installation');
    if (!patterns.hasUsage) missingSections.push('Usage');
    if (!patterns.hasExamples) missingSections.push('Examples');
    if (!patterns.hasContributing) missingSections.push('Contributing');
    if (!patterns.hasLicense) missingSections.push('License');
    if (!patterns.hasAPI && repoData.language) missingSections.push('API Reference');

    const prompt = `
            You are a technical writer improving a GitHub README.

            Project: ${sanitizeForPrompt(repoData.name, 200)}
            Language: ${sanitizeForPrompt(repoData.language, 100) || 'Not specified'}
            Description: ${sanitizeForPrompt(repoData.description, 500) || 'None provided'}

            Current README:
            ${sanitizeForPrompt(currentReadme, 3000) || 'Empty README'}

            Missing Sections: ${missingSections.join(', ') || 'None detected'}

            Task: Generate ONLY the missing sections as markdown.
            - Use professional, clear language
            - Include placeholder examples where appropriate
            - Make installation instructions specific to ${sanitizeForPrompt(repoData.language, 100) || 'the project'}
            - Each section should start with ## heading

            Return ONLY the markdown for missing sections (no existing content, no JSON wrapper).
        `;

    return { prompt, missingSections, patterns };
}

/**
 * Generate missing README sections as markdown.
 *
 * @param {object} ctx
 * @param {object} ctx.provider - AI provider with .generate() + .model
 * @param {string} currentReadme
 * @param {object} repoData - Repository metadata
 * @param {object} fileStructure - File tree
 * @returns {Promise<{ enhancement: string, missingSections: string[], patterns: object }>}
 */
export async function enhanceReadme(ctx, currentReadme, repoData, fileStructure) {
    const provider = ctx?.provider;
    if (!provider?.model) {
        throw new Error('AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.');
    }

    const { prompt, missingSections, patterns } = buildReadmeEnhancePrompt(currentReadme, repoData, fileStructure);

    try {
        // Note: enhanceReadme returns raw markdown, so we use the raw text (not fence-stripped)
        // from the provider. The provider strips fences from JSON-looking output but markdown
        // is returned verbatim — for pure markdown we want the original text() anyway.
        const { text } = await provider.generate({ prompt });
        return {
            enhancement: text,
            missingSections,
            patterns
        };
    } catch (error) {
        logger.error({ err: error }, 'README enhancement failed');
        if (error instanceof AIError && error.code === AI_ERROR_CODE.NOT_FOUND) {
            throw new Error(`AI model not available. Please verify GEMINI_MODEL configuration in .env file.`);
        }
        throw error;
    }
}
