/**
 * Prompt builders for the metadata-only AI routes (`/ai/suggest`, `/ai/readme`)
 * — the weakest-grounded prompts in the backend before this module existed.
 * Both routes only ever see repo metadata (name/description/language/topics),
 * never a README body or file tree, so a model asked for "features",
 * "installation instructions", or "badges" has nothing real to draw on and
 * reliably fabricates plausible-sounding specifics. Every prompt here degrades
 * to an explicit, clearly-marked placeholder instead.
 *
 * Pure — no LLM calls. Mirrors the extraction pattern already used for
 * README Studio (`readme-studio.js`) and README enhance (`readme-enhance.js`)
 * so route handlers stay thin and the prompt text is independently testable.
 */

/**
 * Shared anti-hallucination guardrail for prompts that generate content from
 * thin, single-source metadata. Wording mirrors repo-analysis.js's
 * NEVER_INVENT_RULE (the highest-traffic AI feature) so behaviour stays
 * consistent across prompts app-wide.
 */
export const NEVER_INVENT_RULE = 'Never invent facts, features, metrics, commands, or best-practice claims that are not evidenced by the data provided below. '
    + 'If something cannot be determined from that data, say so explicitly (or leave a clearly-marked TODO placeholder) instead of fabricating.';

/**
 * Build the /ai/suggest prompt (metadata-only improvement suggestions).
 * Requires every returned suggestion to cite the exact metadata field that
 * motivated it, closing the "generic best-practice advice unconnected to
 * this repo" hallucination path.
 *
 * @param {object} safeRepo - Already-sanitized repo metadata (see the /ai/suggest route)
 * @returns {string}
 */
export function buildSuggestPrompt(safeRepo) {
    return `Analyze this GitHub repository metadata and suggest up to 3 concrete improvements.
Focus on: Description clarity, Topics (SEO), and Community standards (License, Contributing).

Repository: ${JSON.stringify(safeRepo, null, 2)}

${NEVER_INVENT_RULE}

Return the response as a JSON object with this structure:
{
  "suggestions": [
    { "title": "...", "description": "...", "type": "improvement", "basedOn": "the exact metadata field/value above that motivated this suggestion (e.g. \\"topics is empty\\", \\"license is null\\")" }
  ],
  "analysis": "Brief summary of the repo's current state, grounded only in the metadata above"
}
Every suggestion's "basedOn" must name a real field from the Repository JSON above — never a generic best-practice claim unconnected to this specific data.
Do not include markdown formatting in the JSON output, just raw JSON.`;
}

/**
 * Build the /ai/readme prompt (metadata-only README skeleton). Unlike README
 * Studio, this route has no signal beyond name/description/language/topics —
 * no file tree, no dependency manifest, no detected commands — so every
 * section that would need concrete specifics (install/usage commands,
 * badges) is instructed to degrade to an honest, clearly-marked placeholder
 * instead of inventing one.
 *
 * @param {object} meta
 * @param {string} meta.name
 * @param {string} [meta.description]
 * @param {string} [meta.language]
 * @param {string} [meta.topics]
 * @returns {string}
 */
export function buildReadmePrompt({ name, description, language, topics }) {
    const languageLabel = language || 'the project';
    return `Generate a README.md skeleton for a GitHub repository. You only have the metadata below — no file listing, no dependency manifest, no actual build/run commands.

Project Name: ${name}
Description: ${description || 'No description provided.'}
Primary Language: ${language || 'Not specified'}
Topics: ${topics || 'None'}

Structure:
1. Title
2. Project Description — based only on the description above; do not expand it with invented capabilities
3. Installation — a ${languageLabel}-appropriate placeholder command clearly marked TODO (e.g. "# TODO: add the real install command"), never a concrete invented command
4. Usage — a placeholder marked TODO, never an invented code example
5. Contributing — standard boilerplate only
6. License — reference it only if evident from the topics/description above, otherwise a TODO placeholder

${NEVER_INVENT_RULE} Never invent badges (build status, coverage, version, etc.) — omit them entirely or leave a TODO placeholder.

Write in a clear, factual tone — no hype ("blazing fast", "revolutionary", "cutting-edge", etc).`;
}
