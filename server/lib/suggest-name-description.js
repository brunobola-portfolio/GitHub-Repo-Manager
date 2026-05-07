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

/**
 * Strip noise from a README excerpt before sentence extraction:
 *   - HTML tags (<img …>, <p>, <a …>, …) — common in README-as-landing-page
 *   - Markdown image syntax `![alt](url)`
 *   - Markdown links — keep label, drop the URL
 *   - Fenced code blocks ``` … ```
 *   - Inline code spans `…`
 *   - HTML comments
 *   - Shields.io / badge URLs and bare URLs
 *   - YAML / TOML front-matter at the top
 *
 * Returns plain prose lines suitable for a "first sentence about the project".
 */
function stripReadmeNoise(text) {
    if (!text) return '';
    let s = String(text);

    // YAML front-matter at file start: --- ... ---
    s = s.replace(/^---\n[\s\S]*?\n---\s*/m, '');
    // HTML comments
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    // Fenced code blocks (```lang … ```)
    s = s.replace(/```[\s\S]*?```/g, '');
    // HTML tags including self-closing <img …>, <a href …>, <p>, <br/>, …
    s = s.replace(/<[^>]+>/g, '');
    // Markdown images ![alt](url) — drop entirely
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    // Markdown links [label](url) — keep label only
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // Inline code `…`
    s = s.replace(/`[^`\n]*`/g, '');
    // Reference-style link definitions: [name]: url
    s = s.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '');
    // Bare URLs
    s = s.replace(/https?:\/\/\S+/gi, '');
    // Collapse whitespace
    s = s.replace(/[ \t]+/g, ' ');
    return s;
}

/**
 * A line is "prose-like" when it has at least 4 alphabetic words and no
 * leftover markup characters (after stripReadmeNoise these should be rare,
 * but defensive: skip anything that still smells like HTML / markup).
 */
function isProseLine(line) {
    if (!line) return false;
    const t = line.trim();
    if (t.length < 20) return false;
    if (/[<>{}|]/.test(t)) return false;          // residual markup
    if (/^[#>*+\-=_]/.test(t)) return false;       // markdown structural lines
    if (/^[A-Za-z0-9_-]+:\s/.test(t)) return false; // YAML-ish / "Key: value"
    const words = t.match(/[A-Za-zÀ-ÿ]{2,}/g) || [];
    return words.length >= 4;
}

function descriptionFromReadme(name, excerpt) {
    if (!excerpt) return null;
    const cleaned = stripReadmeNoise(excerpt);
    if (!cleaned.trim()) return null;

    // Heading: first H1 from the cleaned text
    const h1Match = cleaned.match(/^#\s+(.+?)\s*$/m);
    const heading = h1Match ? h1Match[1].trim().replace(/\s+/g, ' ') : null;
    const after = h1Match ? cleaned.slice(h1Match.index + h1Match[0].length) : cleaned;

    // Walk paragraph by paragraph until we find a prose sentence. This avoids
    // the old behaviour of grabbing the first 20–160 char run regardless of
    // whether it was an attribute list, a sidebar caption, or HTML residue.
    const blocks = after.split(/\n\s*\n/);
    let sentence = null;
    for (const block of blocks) {
        const flat = block.replace(/\s+/g, ' ').trim();
        if (!isProseLine(flat)) continue;
        const m = flat.match(/[^.!?]{20,200}[.!?]/);
        if (m && isProseLine(m[0])) {
            sentence = m[0].trim();
            break;
        }
        // No sentence terminator? Fall back to a clamped 120-char clean phrase.
        if (flat.length >= 30) {
            sentence = flat.slice(0, 140).trim();
            // Avoid mid-word truncation for the fallback
            const cut = sentence.lastIndexOf(' ');
            if (cut > 60) sentence = sentence.slice(0, cut);
            break;
        }
    }

    if (!sentence) return null;
    sentence = sentence.replace(/\s+/g, ' ');
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
