/*
 * Deterministic name+description generator. Pure module — no I/O, no Express.
 * Used as the AI fallback path and as the AI-failure safety net in the
 * /api/ai/suggest-name-description route.
 *
 * Returned shape (subset; the caller adds `source` and `current`):
 *   { proposed: { name, description }, rationale, noChange: {name, description} }
 */

const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;
const IMPORTED_PREFIX = /^imported from\b/i;

function slugify(input) {
    return String(input || '')
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9-]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100);
}

function clamp(s, min, max) {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (t.length < min) return null;
    return t.length > max ? t.slice(0, max) : t;
}

function descriptionFromReadme(name, excerpt) {
    if (!excerpt) return null;
    // First H1 heading
    const h1Match = excerpt.match(/^#\s+(.+?)\s*$/m);
    const heading = h1Match ? h1Match[1].trim() : null;
    // First sentence after the heading (or anywhere if no heading)
    const after = h1Match ? excerpt.slice(h1Match.index + h1Match[0].length) : excerpt;
    const sentenceMatch = after.match(/[^\n.!?]{20,160}[.!?]/);
    if (!sentenceMatch) return null;
    const sentence = sentenceMatch[0].trim().replace(/\s+/g, ' ');
    if (heading) {
        return `${heading}: ${sentence}`;
    }
    return `${name}: ${sentence}`;
}

function descriptionFromTopics(language, topics) {
    if (!Array.isArray(topics) || topics.length === 0) return null;
    const top = topics.slice(0, 2).join(' and ');
    return `${language || 'Code'} project for ${top}`;
}

function descriptionFromLanguage(language) {
    if (!language) return null;
    return `${language} repository`;
}

/**
 * Deterministically suggest a name and description for a repository.
 * Returns an object with proposed values, rationale for the choices, and flags
 * indicating whether each field differs from the current values.
 *
 * @param {object} input
 * @param {string} input.name                 - Repository name (usually kebab-case).
 * @param {string} input.description          - Current description text.
 * @param {string} [input.language]           - Primary programming language.
 * @param {string[]} [input.topics]           - GitHub topics array.
 * @param {string} [input.readmeExcerpt]      - Raw README content (for extracting h1 and first sentence).
 * @param {object} [input.aiMetadata]         - AI metadata object with optional `summary` field.
 * @returns {{proposed: {name: string, description: string}, rationale: string, noChange: {name: boolean, description: boolean}}}
 *          Object describing the proposed values, the reasoning used, and whether they differ from current.
 */
export function generateDeterministic({
    name,
    description,
    language,
    topics,
    readmeExcerpt,
    aiMetadata,
}) {
    // ---- Name ----
    const nameOk = typeof name === 'string' && KEBAB_RE.test(name) && name.length >= 3;
    const proposedName = nameOk ? name : slugify(name);
    const noChangeName = proposedName === name;

    // ---- Description ----
    const currentDesc = typeof description === 'string' ? description : '';
    const currentDescIsImport = IMPORTED_PREFIX.test(currentDesc.trim());

    const usedSources = [];
    let proposedDesc = null;

    // Description cascade — first source that yields a non-empty trimmed string wins:
    //   1. aiMetadata.summary  (unless it starts with "Imported from")
    //   2. README h1 + first sentence (when excerpt is provided)
    //   3. Language + topics template ("<Language> project for <topic1> and <topic2>")
    //   4. Current description (only if non-empty and not an "Imported from" artefact)
    //   5. Language-only template ("<Language> repository")
    // If everything fails, returns currentDesc unchanged (or empty when it's an import artefact).
    const aiSummary = aiMetadata?.summary;
    if (aiSummary && !IMPORTED_PREFIX.test(aiSummary.trim())) {
        const c = clamp(aiSummary, 1, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push('indexed AI metadata');
        }
    }
    if (!proposedDesc) {
        const fromReadme = descriptionFromReadme(name, readmeExcerpt);
        const c = clamp(fromReadme, 1, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push('README');
        }
    }
    if (!proposedDesc) {
        const fromTopics = descriptionFromTopics(language, topics);
        const c = clamp(fromTopics, 1, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push(topics?.length ? 'detected topics' : 'primary language');
        }
    }
    // Current description (non-import) beats the weakest language-only fallback
    if (!proposedDesc && !currentDescIsImport && currentDesc) {
        proposedDesc = currentDesc;
    }
    if (!proposedDesc) {
        const fromLang = descriptionFromLanguage(language);
        const c = clamp(fromLang, 1, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push('primary language');
        }
    }

    // Determine whether the final proposal differs from what is stored
    let noChangeDesc = false;
    if (!proposedDesc) {
        proposedDesc = currentDescIsImport ? '' : currentDesc;
        noChangeDesc = !currentDescIsImport;
    } else if (!currentDescIsImport && proposedDesc === currentDesc) {
        noChangeDesc = true;
    }

    const rationale = usedSources.length
        ? `Generated from ${usedSources.join(', ')}.`
        : `Heuristic suggestion — limited signals available.`;

    return {
        proposed: { name: proposedName, description: proposedDesc },
        rationale,
        noChange: { name: noChangeName, description: noChangeDesc },
    };
}
