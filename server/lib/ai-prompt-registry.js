/**
 * AI Prompt Registry
 *
 * Catalog of every system prompt the user is allowed to customize. Each
 * entry exposes:
 *
 *   - `key`            stable identifier persisted in the `user_ai_prompts`
 *                      table. Never rename; use a migration if you must.
 *   - `title`          short human label for the Settings UI.
 *   - `description`    one-paragraph explanation of when this prompt fires.
 *   - `defaultPrompt`  the canonical prompt text shipped with the app.
 *                      Routes that need dynamic context inline `{variable}`
 *                      placeholders rendered via `renderPrompt`.
 *   - `variables`      list of variable names the route expects, used by
 *                      both validation and the editor's documentation.
 *
 * Adding a new editable prompt:
 *   1. Add an entry below.
 *   2. In the route, replace the inline string with
 *      `await getResolvedPrompt(userId, 'your_key', { var1, var2 })`.
 *   3. Add a test in ai-prompt-registry.test.js if it has variables so we
 *      catch missing/typo'd placeholders early.
 */

import db from '../db.js';

// ============================================================================
// Default prompts. Kept here so routes have a single place to look and the
// Settings UI can preview the canonical version.
// ============================================================================

// NOTE: only the *persona / tone* portion of the chat prompt is user-editable.
// The capabilities catalog, action whitelist, and JSON output schema are
// appended programmatically in `server/lib/ai-chat-prompt.js`. This keeps
// hallucinated action types impossible regardless of how the user writes
// their override, and protects the app's behavioural guarantees.
const CHAT_DEFAULT = `You are the AI assistant embedded inside **GitHub Repo Manager**, the application the user is currently using. You are not a generic GitHub helper, and you are not github.com — you are this product's in-app assistant. Your purpose is to help the user accomplish things **without leaving the app whenever possible**.

Default tone: concise, professional, never patronizing. Match the user's language (PT-PT vs PT-BR, English, etc) and never switch unprompted.`;

const SUGGEST_NAME_DESC_DEFAULT = `You are renaming a GitHub repo. Given the metadata below, propose:
- name: kebab-case, 3-5 words, descriptive of WHAT it does (not generic).
  Keep current name if already good (don't rename for the sake of it).
- description: ONE sentence, max 120 chars, no marketing fluff,
  starts with a verb or noun (not "A repo that…").
- rationale: 1 sentence explaining what signals you used.

Return JSON only: { "name": "...", "description": "...", "rationale": "..." }

Repo: {name} ({language}, {visibility})
Current description: {description}
Topics: {topics}
README excerpt:
{readme}`;

const PR_DEEP_REVIEW_DEFAULT = `You are an expert code reviewer producing a structured pull request review for **{repo_full_name}**.

PR title: {pr_title}
Author: {author}

Your output MUST be valid JSON matching this exact shape:
{
  "walkthrough": {
    "summary": "1–3 short paragraphs in markdown explaining what the PR does and the architectural impact",
    "perFileTable": [{ "path": "string", "change": "added|modified|deleted", "summary": "one-line summary" }],
    "mermaid": "optional Mermaid sequence/flow diagram source, or empty string if not applicable",
    "estimatedReviewTime": "human-readable estimate, e.g. '15 min'",
    "riskLevel": "low|medium|high|critical"
  },
  "lineComments": [
    {
      "path": "string — repo-relative file path",
      "side": "RIGHT",
      "line": 42,
      "startLine": null,
      "severity": "info|suggestion|warning|critical",
      "body": "markdown explanation of the issue",
      "suggestion": "optional replacement code; omit when not safe to auto-suggest"
    }
  ]
}

Rules:
- Maximum **25** line comments. Fold lower-value findings into the walkthrough summary.
- Only comment on lines actually present in the diff (RIGHT side of additions).
- Each \`suggestion\` must be a complete replacement for the line range from \`startLine\` to \`line\` (inclusive). When \`startLine\` is null, suggest replaces the single \`line\`.
- Severity guide: \`critical\`=bug/security; \`warning\`=likely defect; \`suggestion\`=stylistic improvement; \`info\`=informational.
- Do not include backtick-fenced suggestion blocks in \`body\` — the engine wraps \`suggestion\` automatically.
- Be concise. Skip pure-rename and whitespace-only files in the walkthrough table.`;

// PR-context AI slash commands (slice 3 — Pro). Three discrete commands the
// user can fire from the PR Review surface. Each returns a structured JSON
// payload the route persists per (user, repo, PR#, command).

const PR_COMMAND_DESCRIBE_DEFAULT = `You are writing a high-quality pull request description for **{repo_full_name}**.

PR title: {pr_title}
Author: {author}

Output MUST be valid JSON matching this exact shape:
{
  "title": "optional improved PR title (omit if the existing title is already great)",
  "body": "markdown body — concise, scannable, no fluff"
}

The "body" field MUST follow this section structure when applicable:
  ## Overview
  One-paragraph summary of the change (the why first, the what second).
  ## What changed
  Bullet list of the concrete edits, grouped by area when there are many.
  ## Why
  The motivation — bug, feature, refactor, perf — with any relevant ticket / issue link.
  ## Risks
  Only when meaningful. Flag breaking changes, migration steps, perf regressions, or feature flags.
  ## Test plan
  Bullet list of how the change was validated. Reference the /test_plan output when available.

Rules:
- Markdown only inside "body". No HTML, no front-matter, no JSON inside.
- Keep the body under ~8000 chars. Prefer bullets over walls of text.
- Do NOT invent facts not present in the diff or existing description.
- If the existing description is already strong, refine it instead of rewriting.
- Match the author's tone (formal vs casual) when signals are present.`;

const PR_COMMAND_TEST_PLAN_DEFAULT = `You are generating a structured test plan for the pull request on **{repo_full_name}**.

PR title: {pr_title}
Author: {author}

Output MUST be valid JSON matching this exact shape:
{
  "summary": "1–2 sentence framing of the testing approach",
  "cases": [
    {
      "name": "short test case title",
      "type": "unit|integration|e2e",
      "steps": ["Given X", "When Y", "Then Z"],
      "priority": "high|medium|low"
    }
  ]
}

Rules:
- Maximum **15** cases. Surface the highest-priority cases first.
- Bias toward unit > integration > e2e. Only propose e2e when nothing smaller would suffice.
- Each step uses the "Given X / When Y / Then Z" Gherkin-flavoured shape — concrete, executable, no vague verbs.
- Map every priority to risk: \`high\` for paths that change observable behaviour or touch security/billing/data; \`medium\` for refactors that should preserve behaviour; \`low\` for cosmetic / non-blocking checks.
- Skip pure-rename and whitespace-only files.
- Do not include code fences in any string field.`;

const PR_COMMAND_IMPROVE_DEFAULT = `You are an experienced staff engineer surfacing concrete code improvements on the pull request for **{repo_full_name}**.

PR title: {pr_title}
Author: {author}

Output MUST be valid JSON matching this exact shape:
{
  "summary": "1–2 sentence overview of the improvements you found",
  "suggestions": [
    {
      "path": "repo-relative file path",
      "line": 42,
      "severity": "info|suggestion|warning",
      "body": "markdown explanation of the improvement",
      "suggestion": "optional replacement code — omit when not safe to auto-suggest"
    }
  ]
}

Rules:
- Maximum **20** suggestions. Quality over quantity — drop low-confidence findings.
- Each suggestion MUST cite a real path from the diff. The \`line\` is optional but should reference the RIGHT side (post-change) when given.
- Severity guide: \`warning\` = likely defect or risky pattern; \`suggestion\` = clear improvement; \`info\` = informational nit.
- Include the optional \`suggestion\` (replacement code) ONLY when the change is small, mechanical, and safe — never for architectural rewrites.
- Do not include backtick-fenced code blocks inside \`body\`. The engine renders \`suggestion\` separately.
- Skip findings already covered by the existing test plan / description.`;

// More features (PR review, issue→plan, migration description) will be added
// to the registry as their routes are migrated. Each addition needs:
//   1. A default constant here.
//   2. An entry in AI_PROMPT_REGISTRY below.
//   3. The route updated to call `getResolvedPrompt(userId, key, vars)`
//      instead of an inline string.
// The DB table, endpoints, and Settings UI all derive from the registry, so
// adding a new key surfaces it everywhere automatically.

// ============================================================================
// Registry catalog
// ============================================================================

export const AI_PROMPT_REGISTRY = Object.freeze({
    chat: {
        key: 'chat',
        title: 'Assistant chat — persona',
        description: 'Persona and tone of the floating AI assistant. The app capabilities catalog, action whitelist, and JSON output schema are always appended automatically — your override only changes the persona.',
        defaultPrompt: CHAT_DEFAULT,
        variables: [],
    },
    suggest_name_description: {
        key: 'suggest_name_description',
        title: 'Suggest name & description',
        description: 'Drives the rename / re-describe modal. The variables below are sanitized repo metadata the model uses to ground its proposal. Keep the JSON return contract intact (`{ "name", "description", "rationale" }`) — the route parses the response.',
        defaultPrompt: SUGGEST_NAME_DESC_DEFAULT,
        variables: ['name', 'description', 'language', 'visibility', 'topics', 'readme'],
    },
    pr_deep_review: {
        key: 'pr_deep_review',
        title: 'PR Deep Review — system prompt',
        description: 'Drives the AI Deep Review feature on a pull request: walkthrough, per-file table, Mermaid diagram, and up to 25 line comments with optional code suggestions. Variables are sanitized PR metadata. The JSON output schema is enforced by the engine — your override only changes the persona, focus areas, and tone.',
        defaultPrompt: PR_DEEP_REVIEW_DEFAULT,
        variables: ['repo_full_name', 'pr_title', 'author'],
    },
    pr_command_describe: {
        key: 'pr_command_describe',
        title: 'PR command: /describe',
        description: 'Generates or improves a PR description. Returns `{ title?, body }` markdown sections (Overview, What changed, Why, Risks, Test plan). The schema is enforced by the engine — your override changes voice, structure preferences, and emphasis.',
        defaultPrompt: PR_COMMAND_DESCRIBE_DEFAULT,
        variables: ['repo_full_name', 'pr_title', 'author'],
    },
    pr_command_test_plan: {
        key: 'pr_command_test_plan',
        title: 'PR command: /test_plan',
        description: 'Generates a structured test plan for the PR. Returns `{ summary, cases[] }` with up to 15 prioritised test cases (unit > integration > e2e). The JSON shape is enforced by the engine.',
        defaultPrompt: PR_COMMAND_TEST_PLAN_DEFAULT,
        variables: ['repo_full_name', 'pr_title', 'author'],
    },
    pr_command_improve: {
        key: 'pr_command_improve',
        title: 'PR command: /improve',
        description: 'Surfaces high-confidence code-quality improvements with optional replacement snippets. Returns `{ summary, suggestions[] }` capped at 20 entries. Schema enforced by the engine — override the persona / focus areas only.',
        defaultPrompt: PR_COMMAND_IMPROVE_DEFAULT,
        variables: ['repo_full_name', 'pr_title', 'author'],
    },
});

export const REGISTRY_KEYS = Object.freeze(Object.keys(AI_PROMPT_REGISTRY));

export function isValidPromptKey(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(AI_PROMPT_REGISTRY, key);
}

// ============================================================================
// Persistence helpers (synchronous — better-sqlite3 prepared statements)
// ============================================================================

export function loadUserPrompt(userId, key) {
    if (!isValidPromptKey(key) || !Number.isInteger(userId)) return null;
    try {
        const row = db.prepare('SELECT prompt FROM user_ai_prompts WHERE user_id = ? AND feature_key = ?').get(userId, key);
        return row?.prompt ?? null;
    } catch {
        return null;
    }
}

export function loadAllUserPrompts(userId) {
    if (!Number.isInteger(userId)) return {};
    try {
        const rows = db.prepare('SELECT feature_key, prompt, updated_at FROM user_ai_prompts WHERE user_id = ?').all(userId);
        const out = {};
        for (const row of rows) {
            if (!isValidPromptKey(row.feature_key)) continue; // drop orphan rows
            out[row.feature_key] = { prompt: row.prompt, updatedAt: row.updated_at };
        }
        return out;
    } catch {
        return {};
    }
}

export function saveUserPrompt(userId, key, prompt) {
    if (!isValidPromptKey(key)) throw new Error(`Unknown AI prompt key: ${key}`);
    if (typeof prompt !== 'string') throw new Error('Prompt must be a string');
    const trimmed = prompt.trim();
    if (trimmed.length === 0) throw new Error('Prompt cannot be empty');
    if (trimmed.length > 8000) throw new Error('Prompt exceeds 8000 character limit');
    db.prepare(
        `INSERT INTO user_ai_prompts (user_id, feature_key, prompt, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, feature_key) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at`,
    ).run(userId, key, trimmed);
    return { key, prompt: trimmed };
}

export function deleteUserPrompt(userId, key) {
    if (!isValidPromptKey(key)) return { deleted: 0 };
    const result = db.prepare('DELETE FROM user_ai_prompts WHERE user_id = ? AND feature_key = ?').run(userId, key);
    return { deleted: result.changes || 0 };
}

// ============================================================================
// Resolution + rendering
// ============================================================================

/**
 * Resolves the prompt template for a given (user, feature). The user override
 * wins when present, otherwise the registry default is used.
 *
 * @param {number} userId
 * @param {string} key
 * @returns {string}
 */
export function resolvePromptTemplate(userId, key) {
    if (!isValidPromptKey(key)) throw new Error(`Unknown AI prompt key: ${key}`);
    const override = loadUserPrompt(userId, key);
    return override || AI_PROMPT_REGISTRY[key].defaultPrompt;
}

/**
 * Replaces `{variable}` placeholders with the values supplied. Missing values
 * are rendered as empty strings rather than throwing — partial context is
 * common (e.g. a repo with no README) and we never want a crash there. Uses
 * a literal-replacement loop so values that themselves contain `{...}` won't
 * be re-expanded.
 */
export function renderPrompt(template, vars = {}) {
    if (typeof template !== 'string') return '';
    let out = template;
    for (const [key, value] of Object.entries(vars || {})) {
        const token = `{${key}}`;
        const replacement = value === undefined || value === null ? '' : String(value);
        // String#replaceAll uses literal matching when given a string, so {key}
        // tokens nested inside replacement values are left intact.
        out = out.split(token).join(replacement);
    }
    return out;
}

/**
 * Convenience: resolve template + render variables in one call. The two-step
 * variant is exposed for callers that want to log/inspect the raw template.
 */
export function getResolvedPrompt(userId, key, vars = {}) {
    return renderPrompt(resolvePromptTemplate(userId, key), vars);
}

/**
 * Catalog payload for the Settings UI — never includes the user's override
 * directly; the route is responsible for joining that in (see
 * server/routes/ai/prompts.js).
 */
export function getCatalog() {
    return REGISTRY_KEYS.map((key) => ({
        key,
        title: AI_PROMPT_REGISTRY[key].title,
        description: AI_PROMPT_REGISTRY[key].description,
        defaultPrompt: AI_PROMPT_REGISTRY[key].defaultPrompt,
        variables: AI_PROMPT_REGISTRY[key].variables,
    }));
}
