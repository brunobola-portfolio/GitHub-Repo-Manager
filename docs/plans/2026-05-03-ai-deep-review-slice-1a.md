# AI Deep Review — Slice 1a Implementation Plan (Free Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the free-core AI Deep Review pipeline — engine, storage, 5 routes, premium 3-column UI extension, and one-click "Publish to GitHub" — turning the existing PR Review surface into a tool devs choose over GitHub.com.

**Architecture:** Reuse the just-shipped 3-column `PRReviewView`. Add a new engine `pr-deep-review.js` that resolves the user's BYOK provider via existing `createProviderForUser` and a customizable system prompt via existing `AI_PROMPT_REGISTRY`. Persist drafts in a new `ai_pr_reviews` SQLite table. Add 5 new routes under `/api/ai/deep-review/*`. UI replaces the right-side `AISummaryPanel` with a tabbed `AIReviewPanel` that overlays AI ghost annotations on the diff and exposes a `PublishReviewModal`.

**Tech Stack:** Express 5 + better-sqlite3, React 19 + Vite + Tailwind v4, Vitest + Playwright. Uses existing infrastructure: `createProviderForUser`, `AI_PROMPT_REGISTRY` / `getResolvedPrompt`, `gh-cache.readThrough`, `executeViaOutbox`, `sanitizeForPrompt`, `requireAuth`.

**Spec:** [docs/specs/2026-05-03-ai-deep-review.md](../specs/2026-05-03-ai-deep-review.md)

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| MODIFY | `server/db.js` | Add `ai_pr_reviews` table migration |
| MODIFY | `server/lib/ai-prompt-registry.js` | Register `pr_deep_review` key + default prompt |
| CREATE | `server/lib/ai-features/pr-deep-review.js` | Pure engine: build prompt, call provider, validate output |
| CREATE | `server/lib/ai-features/pr-deep-review-publish.js` | Pure builder: turn DeepReview JSON → GitHub `/reviews` payload |
| CREATE | `server/lib/ai-pr-review-store.js` | DB CRUD for `ai_pr_reviews` table |
| CREATE | `server/routes/ai/deep-review.js` | 5 HTTP endpoints |
| MODIFY | `server/index.js` | Mount the new router |
| CREATE | `server/__tests__/ai-features/pr-deep-review.test.js` | Engine unit tests |
| CREATE | `server/__tests__/ai-features/pr-deep-review-publish.test.js` | Payload builder unit tests |
| CREATE | `server/__tests__/ai/deep-review-routes.test.js` | Route integration tests |
| CREATE | `src/hooks/useAIDeepReview.js` | API client hook |
| CREATE | `src/components/PRReview/AIDeepReview/DeepReviewProvider.jsx` | Draft state context |
| CREATE | `src/components/PRReview/AIDeepReview/AIInlineComment.jsx` | Ghost overlay rendered inside DiffPanel |
| CREATE | `src/components/PRReview/AIDeepReview/WalkthroughTab.jsx` | Walkthrough body + lazy-Mermaid render |
| CREATE | `src/components/PRReview/AIDeepReview/CommentsListTab.jsx` | Filterable AI comment list |
| CREATE | `src/components/PRReview/AIDeepReview/AIReviewPanel.jsx` | Tabbed right-side panel (Walkthrough / Comments) |
| CREATE | `src/components/PRReview/AIDeepReview/PublishReviewModal.jsx` | Final publish preview + submit |
| MODIFY | `src/components/PRReview/PRReviewView.jsx` | Wire DeepReviewProvider + AIReviewPanel |
| MODIFY | `src/components/PRReview/DiffPanel/DiffPanel.jsx` | Accept `aiComments` prop, render overlays |
| MODIFY | `src/__mocks__/mockRepoDetail.js` | Add deep-review payload for MOCK_MODE |
| CREATE | `tests/components/PRReview/AIDeepReview/AIInlineComment.test.jsx` | Component test |
| CREATE | `tests/hooks/useAIDeepReview.test.js` | Hook test |
| CREATE | `e2e/ai-deep-review.spec.js` | E2E smoke (publish stubbed) |

---

## Task 1: Add `ai_pr_reviews` table migration

**Files:**
- Modify: `server/db.js` (after the `user_ai_prompts` block around line 428)
- Test: covered by route tests in Task 7

- [ ] **Step 1: Add the migration block**

After the existing `user_ai_prompts` table creation in `server/db.js`, add:

```js
        // AI Deep Review drafts — premium PR review surface.
        // One row per (user, repo, pr_number). The draft_json blob holds the
        // full structured review (walkthrough + line comments). last_reviewed_sha
        // is the head SHA the AI saw — used to skip re-review when nothing
        // changed and to compute incremental deltas via /compare.
        db.exec(`
            CREATE TABLE IF NOT EXISTS ai_pr_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                pr_number INTEGER NOT NULL,
                last_reviewed_sha TEXT NOT NULL,
                draft_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                github_review_id INTEGER,
                cost_usd REAL,
                model_used TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(user_id, repo_owner, repo_name, pr_number),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_pr_reviews_lookup ON ai_pr_reviews(repo_owner, repo_name, pr_number)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_pr_reviews_user ON ai_pr_reviews(user_id, status)`);
```

- [ ] **Step 2: Verify the server starts and creates the table**

Run: `node -e "import('./server/db.js').then(()=>console.log('ok'))"`
Expected: `ok` (no error)
Verify: `sqlite3 data/app.db ".schema ai_pr_reviews"` shows the new table

- [ ] **Step 3: Commit**

```bash
git add server/db.js
git commit -m "feat(ai-deep-review): add ai_pr_reviews table migration"
```

---

## Task 2: Add `pr_deep_review` to the prompt registry

**Files:**
- Modify: `server/lib/ai-prompt-registry.js`
- Test: `server/__tests__/ai-prompt-registry.test.js` (existing — extend)

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/ai-prompt-registry.test.js`:

```js
import { AI_PROMPT_REGISTRY, REGISTRY_KEYS, getResolvedPrompt } from '../lib/ai-prompt-registry.js';

describe('pr_deep_review prompt', () => {
    it('is registered with required fields', () => {
        const entry = AI_PROMPT_REGISTRY.pr_deep_review;
        expect(entry).toBeDefined();
        expect(entry.key).toBe('pr_deep_review');
        expect(typeof entry.defaultPrompt).toBe('string');
        expect(entry.defaultPrompt.length).toBeGreaterThan(200);
        expect(REGISTRY_KEYS).toContain('pr_deep_review');
    });

    it('renders {repo_full_name} and {pr_title} placeholders', () => {
        const out = getResolvedPrompt(0, 'pr_deep_review', {
            repo_full_name: 'acme/api',
            pr_title: 'Add billing',
        });
        expect(out).toContain('acme/api');
        expect(out).toContain('Add billing');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/ai-prompt-registry.test.js -t "pr_deep_review"`
Expected: FAIL — `entry` is `undefined`

- [ ] **Step 3: Add the registry entry**

In `server/lib/ai-prompt-registry.js`, after the `SUGGEST_NAME_DESC_DEFAULT` constant, add:

```js
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
```

Then in the `AI_PROMPT_REGISTRY` object (after `suggest_name_description`):

```js
    pr_deep_review: {
        key: 'pr_deep_review',
        title: 'PR Deep Review — system prompt',
        description: 'Drives the AI Deep Review feature on a pull request: walkthrough, per-file table, Mermaid diagram, and up to 25 line comments with optional code suggestions. Variables are sanitized PR metadata. The JSON output schema is enforced by the engine — your override only changes the persona, focus areas, and tone.',
        defaultPrompt: PR_DEEP_REVIEW_DEFAULT,
        variables: ['repo_full_name', 'pr_title', 'author'],
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/__tests__/ai-prompt-registry.test.js -t "pr_deep_review"`
Expected: PASS (both `it` blocks)

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-prompt-registry.js server/__tests__/ai-prompt-registry.test.js
git commit -m "feat(ai-deep-review): register pr_deep_review prompt"
```

---

## Task 3: Engine — pure function `runDeepReview()`

**Files:**
- Create: `server/lib/ai-features/pr-deep-review.js`
- Test: `server/__tests__/ai-features/pr-deep-review.test.js`

The engine is a pure function: takes a provider, fetched PR data, and a userId. Returns the structured DeepReview object. No DB access, no HTTP — the route layer wires those.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/ai-features/pr-deep-review.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDeepReview, DEEP_REVIEW_SCHEMA } from '../../lib/ai-features/pr-deep-review.js';

function buildProvider(generateImpl) {
    return {
        model: {},
        generate: vi.fn(generateImpl),
    };
}

const sampleParsed = {
    walkthrough: {
        summary: 'Adds X.',
        perFileTable: [{ path: 'src/a.js', change: 'modified', summary: 'tweak' }],
        mermaid: '',
        estimatedReviewTime: '5 min',
        riskLevel: 'low',
    },
    lineComments: [
        { path: 'src/a.js', side: 'RIGHT', line: 12, startLine: null, severity: 'warning', body: 'use ===', suggestion: 'a === b' },
    ],
};

const baseCtx = {
    userId: 1,
    repoFullName: 'acme/api',
    prMetadata: { title: 'Add X', author: 'alice', body: '', additions: 5, deletions: 0 },
    fileManifest: [{ filename: 'src/a.js', status: 'modified', additions: 5, deletions: 0, changes: 5 }],
    diffPatch: '@@ -10,1 +10,1 @@\n-a == b\n+a === b\n',
};

describe('runDeepReview', () => {
    const originalEnv = process.env.DISABLE_AI_REVIEW;
    beforeEach(() => { delete process.env.DISABLE_AI_REVIEW; });
    afterEach(() => {
        if (originalEnv === undefined) delete process.env.DISABLE_AI_REVIEW;
        else process.env.DISABLE_AI_REVIEW = originalEnv;
    });

    it('returns a parsed DeepReview from the provider (happy path)', async () => {
        const provider = buildProvider(async (args) => {
            expect(args.schema).toBe(DEEP_REVIEW_SCHEMA);
            expect(args.generationConfig.responseMimeType).toBe('application/json');
            expect(Array.isArray(args.parts)).toBe(true);
            return { parsed: sampleParsed };
        });
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.walkthrough.summary).toBe('Adds X.');
        expect(result.lineComments).toHaveLength(1);
        expect(result.modelUsed).toBeDefined();
    });

    it('caps lineComments at 25 and folds overflow into the walkthrough', async () => {
        const overflowed = {
            walkthrough: { ...sampleParsed.walkthrough, summary: 'Adds X.' },
            lineComments: Array.from({ length: 40 }, (_, i) => ({
                path: 'src/a.js', side: 'RIGHT', line: i + 1, startLine: null,
                severity: 'info', body: `c${i}`,
            })),
        };
        const provider = buildProvider(async () => ({ parsed: overflowed }));
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.lineComments).toHaveLength(25);
        expect(result.walkthrough.summary).toMatch(/15 additional/);
    });

    it('rejects suggestions with 7+ consecutive backticks (fence escape defence)', async () => {
        const malicious = {
            walkthrough: sampleParsed.walkthrough,
            lineComments: [
                { path: 'x', side: 'RIGHT', line: 1, startLine: null, severity: 'info', body: 'b', suggestion: '```````evil' },
            ],
        };
        const provider = buildProvider(async () => ({ parsed: malicious }));
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result.lineComments[0].suggestion).toBeUndefined();
    });

    it('returns null when DISABLE_AI_REVIEW=true', async () => {
        process.env.DISABLE_AI_REVIEW = 'true';
        const provider = buildProvider(async () => { throw new Error('should not be called'); });
        const result = await runDeepReview({ provider, ...baseCtx });
        expect(result).toBeNull();
        expect(provider.generate).not.toHaveBeenCalled();
    });

    it('throws when provider is missing', async () => {
        await expect(
            runDeepReview({ provider: null, ...baseCtx })
        ).rejects.toThrow(/provider/i);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/ai-features/pr-deep-review.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the engine**

Create `server/lib/ai-features/pr-deep-review.js`:

```js
import { sanitizeForPrompt } from './sanitize.js';
import { getResolvedPrompt } from '../ai-prompt-registry.js';

const MAX_LINE_COMMENTS = 25;
const MAX_DIFF_CHARS = 80000;
const MAX_SUGGESTION_CHARS = 4096;
const FENCE_ESCAPE_RE = /`{7,}/;

export const DEEP_REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        walkthrough: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                perFileTable: {
                    type: 'array',
                    maxItems: 50,
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            change: { type: 'string', enum: ['added', 'modified', 'deleted'] },
                            summary: { type: 'string' },
                        },
                        required: ['path', 'change', 'summary'],
                    },
                },
                mermaid: { type: 'string' },
                estimatedReviewTime: { type: 'string' },
                riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            },
            required: ['summary', 'perFileTable', 'estimatedReviewTime', 'riskLevel'],
        },
        lineComments: {
            type: 'array',
            maxItems: 50,
            items: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
                    line: { type: 'integer' },
                    startLine: { type: ['integer', 'null'] },
                    severity: { type: 'string', enum: ['info', 'suggestion', 'warning', 'critical'] },
                    body: { type: 'string' },
                    suggestion: { type: 'string' },
                },
                required: ['path', 'side', 'line', 'severity', 'body'],
            },
        },
    },
    required: ['walkthrough', 'lineComments'],
};

/**
 * Run the AI Deep Review.
 *
 * Honors DISABLE_AI_REVIEW=true as a kill switch (returns null).
 *
 * @param {object} ctx
 * @param {object} ctx.provider           — resolved via createProviderForUser
 * @param {number} ctx.userId             — for prompt registry override lookup
 * @param {string} ctx.repoFullName       — '<owner>/<repo>'
 * @param {object} ctx.prMetadata         — { title, author, body, additions, deletions }
 * @param {Array}  ctx.fileManifest       — GitHub /files API rows
 * @param {string} ctx.diffPatch          — concatenated patch text (already truncated by caller)
 * @returns {Promise<object|null>}        — DeepReview JSON, or null when disabled
 */
export async function runDeepReview({ provider, userId, repoFullName, prMetadata, fileManifest, diffPatch }) {
    if (process.env.DISABLE_AI_REVIEW === 'true') return null;
    if (!provider?.model || typeof provider.generate !== 'function') {
        throw new Error('AI provider not initialized for the calling user.');
    }

    const systemPrompt = getResolvedPrompt(userId, 'pr_deep_review', {
        repo_full_name: sanitizeForPrompt(repoFullName, 100),
        pr_title: sanitizeForPrompt(prMetadata.title, 200),
        author: sanitizeForPrompt(prMetadata.author, 100),
    });

    const prContext = `PR description:
${sanitizeForPrompt(prMetadata.body || 'No description provided.', 1500)}

File manifest:
${sanitizeForPrompt(JSON.stringify(
    (fileManifest || []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
    })),
    null, 2,
), 4000)}`;

    const parts = [
        { text: systemPrompt + '\n\n' + prContext },
        { text: 'Diff:\n```diff\n' + sanitizeForPrompt(diffPatch || '', MAX_DIFF_CHARS) + '\n```' },
    ];

    const { parsed } = await provider.generate({
        parts,
        schema: DEEP_REVIEW_SCHEMA,
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: DEEP_REVIEW_SCHEMA,
        },
    });

    return postProcess(parsed, provider);
}

/**
 * Cap, sanitise, and stamp metadata on the parsed response.
 * Pure function — easy to unit-test in isolation.
 */
function postProcess(parsed, provider) {
    const walkthrough = { ...parsed.walkthrough };
    let lineComments = Array.isArray(parsed.lineComments) ? parsed.lineComments : [];

    // Drop comments whose suggestion contains a fence-escape attack
    lineComments = lineComments.map((c) => {
        if (c.suggestion && (FENCE_ESCAPE_RE.test(c.suggestion) || c.suggestion.length > MAX_SUGGESTION_CHARS)) {
            const { suggestion, ...rest } = c;
            return rest;
        }
        return c;
    });

    // Cap at 25 — fold the rest into the walkthrough summary
    if (lineComments.length > MAX_LINE_COMMENTS) {
        const overflow = lineComments.length - MAX_LINE_COMMENTS;
        walkthrough.summary = (walkthrough.summary || '')
            + `\n\n_${overflow} additional minor findings were folded into this summary to keep the review focused. Increase the line-comment cap in the prompt if you want them inline._`;
        lineComments = lineComments.slice(0, MAX_LINE_COMMENTS);
    }

    return {
        walkthrough,
        lineComments,
        modelUsed: provider._modelName || provider.constructor?.name || 'unknown',
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/__tests__/ai-features/pr-deep-review.test.js`
Expected: PASS (5 of 5)

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-features/pr-deep-review.js server/__tests__/ai-features/pr-deep-review.test.js
git commit -m "feat(ai-deep-review): runDeepReview engine with overflow + fence escape defences"
```

---

## Task 4: Publish payload builder — pure function

**Files:**
- Create: `server/lib/ai-features/pr-deep-review-publish.js`
- Test: `server/__tests__/ai-features/pr-deep-review-publish.test.js`

Splits payload construction from HTTP I/O so the route stays thin and the conversion is easy to test.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/ai-features/pr-deep-review-publish.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildGitHubReviewPayload, FOOTER_REGEX } from '../../lib/ai-features/pr-deep-review-publish.js';

const draft = {
    walkthrough: {
        summary: 'Adds X.',
        perFileTable: [
            { path: 'a.js', change: 'modified', summary: 'tweak' },
            { path: 'b.js', change: 'added', summary: 'new helper' },
        ],
        mermaid: 'sequenceDiagram\n  A->>B: hi',
        estimatedReviewTime: '10 min',
        riskLevel: 'low',
    },
    lineComments: [
        { path: 'a.js', side: 'RIGHT', line: 12, severity: 'warning', body: 'use ===' },
        { path: 'a.js', side: 'RIGHT', line: 20, startLine: 18, severity: 'suggestion', body: 'extract helper', suggestion: 'function helper() {}\nreturn helper();' },
    ],
    modelUsed: 'gemini-2.5-flash',
};

const meta = { commitId: 'abc123def456', user: 'alice', costUSD: 0.04, lastReviewedSha: null };

describe('buildGitHubReviewPayload', () => {
    it('produces a single batched review payload', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        expect(out.commit_id).toBe('abc123def456');
        expect(out.event).toBe('COMMENT');
        expect(out.comments).toHaveLength(2);
    });

    it('renders walkthrough summary, table, mermaid, and footer in the body', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        expect(out.body).toContain('Adds X.');
        expect(out.body).toContain('| a.js |');
        expect(out.body).toContain('| b.js |');
        expect(out.body).toContain('```mermaid');
        expect(out.body).toContain('sequenceDiagram');
        expect(out.body).toMatch(FOOTER_REGEX);
        expect(out.body).toContain('@alice');
        expect(out.body).toContain('gemini-2.5-flash');
    });

    it('omits mermaid block when source is empty', () => {
        const noMermaid = { ...draft, walkthrough: { ...draft.walkthrough, mermaid: '' } };
        const out = buildGitHubReviewPayload({ draft: noMermaid, meta, event: 'COMMENT' });
        expect(out.body).not.toContain('```mermaid');
    });

    it('wraps suggestion text in a ```suggestion fence with original body', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        const withSuggestion = out.comments[1];
        expect(withSuggestion.body).toContain('extract helper');
        expect(withSuggestion.body).toContain('```suggestion');
        expect(withSuggestion.body).toContain('function helper()');
    });

    it('passes through start_line / start_side for multi-line comments', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        const multi = out.comments[1];
        expect(multi.start_line).toBe(18);
        expect(multi.start_side).toBe('RIGHT');
    });

    it('omits start_line on single-line comments', () => {
        const out = buildGitHubReviewPayload({ draft, meta, event: 'COMMENT' });
        const single = out.comments[0];
        expect(single.start_line).toBeUndefined();
        expect(single.start_side).toBeUndefined();
    });

    it('truncates body when over 50,000 chars and appends [truncated]', () => {
        const huge = {
            ...draft,
            walkthrough: { ...draft.walkthrough, summary: 'x'.repeat(60000) },
        };
        const out = buildGitHubReviewPayload({ draft: huge, meta, event: 'COMMENT' });
        expect(out.body.length).toBeLessThan(55000);
        expect(out.body).toContain('[truncated]');
    });

    it('shows "Incremental from <sha7>" when lastReviewedSha provided', () => {
        const out = buildGitHubReviewPayload({ draft, meta: { ...meta, lastReviewedSha: 'deadbeef1234' }, event: 'COMMENT' });
        expect(out.body).toContain('deadbee');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/ai-features/pr-deep-review-publish.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the builder**

Create `server/lib/ai-features/pr-deep-review-publish.js`:

```js
const MAX_BODY_CHARS = 50000;

export const FOOTER_REGEX = /Generated by GitHub Repo Manager/;

/**
 * Build the GitHub `POST /pulls/{n}/reviews` payload from a DeepReview draft.
 *
 * @param {object} args
 * @param {object} args.draft   — DeepReview JSON (output of runDeepReview + accept/dismiss filtering)
 * @param {object} args.meta    — { commitId, user, costUSD, lastReviewedSha }
 * @param {'COMMENT'|'APPROVE'|'REQUEST_CHANGES'} args.event
 * @returns {object}            — payload ready for the GitHub REST API
 */
export function buildGitHubReviewPayload({ draft, meta, event }) {
    const body = renderBody(draft, meta);
    const comments = (draft.lineComments || []).map(toGithubComment);
    return {
        commit_id: meta.commitId,
        event,
        body,
        comments,
    };
}

function renderBody(draft, meta) {
    const w = draft.walkthrough || {};
    const parts = [];

    if (w.summary) parts.push(w.summary);

    if (Array.isArray(w.perFileTable) && w.perFileTable.length > 0) {
        parts.push('### Files');
        parts.push('| File | Change | Summary |');
        parts.push('|---|---|---|');
        for (const row of w.perFileTable) {
            parts.push(`| ${escapeCell(row.path)} | ${row.change} | ${escapeCell(row.summary)} |`);
        }
    }

    if (w.estimatedReviewTime) parts.push(`**Estimated review time:** ${w.estimatedReviewTime} · **Risk:** ${w.riskLevel}`);

    if (w.mermaid && w.mermaid.trim().length > 0) {
        parts.push('```mermaid');
        parts.push(w.mermaid);
        parts.push('```');
    }

    parts.push(buildFooter(draft, meta));

    let body = parts.join('\n\n');
    if (body.length > MAX_BODY_CHARS) {
        body = body.slice(0, MAX_BODY_CHARS - 32) + '\n\n_…[truncated]_';
    }
    return body;
}

function buildFooter(draft, meta) {
    const sha = meta.lastReviewedSha ? `Incremental from \`${meta.lastReviewedSha.slice(0, 7)}\`` : 'Full review';
    const cost = typeof meta.costUSD === 'number' ? `$${meta.costUSD.toFixed(2)}` : 'n/a';
    return [
        '---',
        `> 🤖 _Generated by GitHub Repo Manager · reviewed and published by @${meta.user}_`,
        `> _Model: \`${draft.modelUsed || 'unknown'}\` · Cost: ${cost} · ${sha}_`,
    ].join('\n');
}

function toGithubComment(c) {
    const out = {
        path: c.path,
        side: c.side || 'RIGHT',
        line: c.line,
    };
    if (c.startLine != null && c.startLine !== c.line) {
        out.start_line = c.startLine;
        out.start_side = out.side;
    }
    let body = c.body || '';
    if (c.suggestion) {
        body = body + '\n\n```suggestion\n' + c.suggestion + '\n```';
    }
    out.body = body;
    return out;
}

function escapeCell(s) {
    return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/__tests__/ai-features/pr-deep-review-publish.test.js`
Expected: PASS (8 of 8)

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-features/pr-deep-review-publish.js server/__tests__/ai-features/pr-deep-review-publish.test.js
git commit -m "feat(ai-deep-review): GitHub review payload builder + footer + suggestion fences"
```

---

## Task 5: Storage layer — `ai-pr-review-store.js`

**Files:**
- Create: `server/lib/ai-pr-review-store.js`
- Test: `server/__tests__/ai-pr-review-store.test.js`

Thin DB wrapper. All SQL via prepared statements. Returns / accepts plain JS objects.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/ai-pr-review-store.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db.js';
import {
    saveDraft,
    getDraft,
    getDraftById,
    markPublished,
    deleteDraft,
} from '../lib/ai-pr-review-store.js';

const userId = 999;

beforeEach(() => {
    db.prepare('DELETE FROM ai_pr_reviews WHERE user_id = ?').run(userId);
    db.prepare('INSERT OR IGNORE INTO users (id, github_id, login) VALUES (?, ?, ?)').run(userId, userId, 'test-user');
});

describe('ai-pr-review-store', () => {
    it('saves and retrieves a draft by composite key', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: { summary: 'x' }, lineComments: [] }, 0.05, 'gemini-2.5-flash');
        expect(id).toBeGreaterThan(0);
        const got = getDraft(userId, 'acme', 'api', 42);
        expect(got.draft.walkthrough.summary).toBe('x');
        expect(got.lastReviewedSha).toBe('sha1');
        expect(got.status).toBe('draft');
        expect(got.modelUsed).toBe('gemini-2.5-flash');
    });

    it('upserts on (user, owner, repo, pr) — keeps id stable', () => {
        const id1 = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0.01, 'm');
        const id2 = saveDraft(userId, 'acme', 'api', 42, 'sha2', { walkthrough: {}, lineComments: [] }, 0.02, 'm');
        expect(id2).toBe(id1);
        const got = getDraft(userId, 'acme', 'api', 42);
        expect(got.lastReviewedSha).toBe('sha2');
    });

    it('getDraftById enforces user ownership', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        expect(getDraftById(userId, id)).toBeTruthy();
        expect(getDraftById(userId + 1, id)).toBeNull();
    });

    it('markPublished sets status + github_review_id', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        markPublished(userId, id, 12345);
        const got = getDraftById(userId, id);
        expect(got.status).toBe('published');
        expect(got.githubReviewId).toBe(12345);
    });

    it('deleteDraft removes only the owner row', () => {
        const id = saveDraft(userId, 'acme', 'api', 42, 'sha1', { walkthrough: {}, lineComments: [] }, 0, 'm');
        const deleted = deleteDraft(userId, id);
        expect(deleted).toBe(1);
        expect(getDraftById(userId, id)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/ai-pr-review-store.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the store**

Create `server/lib/ai-pr-review-store.js`:

```js
import db from '../db.js';

function rowToDraft(row) {
    if (!row) return null;
    let draft = {};
    try { draft = JSON.parse(row.draft_json); } catch { /* keep empty */ }
    return {
        id: row.id,
        userId: row.user_id,
        repoOwner: row.repo_owner,
        repoName: row.repo_name,
        prNumber: row.pr_number,
        lastReviewedSha: row.last_reviewed_sha,
        draft,
        status: row.status,
        githubReviewId: row.github_review_id,
        costUsd: row.cost_usd,
        modelUsed: row.model_used,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function saveDraft(userId, owner, repo, prNumber, sha, draftObj, costUsd, modelUsed) {
    const json = JSON.stringify(draftObj);
    const result = db.prepare(`
        INSERT INTO ai_pr_reviews (user_id, repo_owner, repo_name, pr_number, last_reviewed_sha, draft_json, status, cost_usd, model_used, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, repo_owner, repo_name, pr_number) DO UPDATE SET
            last_reviewed_sha = excluded.last_reviewed_sha,
            draft_json = excluded.draft_json,
            status = 'draft',
            github_review_id = NULL,
            cost_usd = excluded.cost_usd,
            model_used = excluded.model_used,
            updated_at = datetime('now')
    `).run(userId, owner, repo, prNumber, sha, json, costUsd ?? null, modelUsed ?? null);

    if (result.lastInsertRowid && result.changes === 1) return Number(result.lastInsertRowid);
    // ON CONFLICT path — re-read the existing id
    const row = db.prepare('SELECT id FROM ai_pr_reviews WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?')
        .get(userId, owner, repo, prNumber);
    return row?.id ?? null;
}

export function getDraft(userId, owner, repo, prNumber) {
    const row = db.prepare('SELECT * FROM ai_pr_reviews WHERE user_id = ? AND repo_owner = ? AND repo_name = ? AND pr_number = ?')
        .get(userId, owner, repo, prNumber);
    return rowToDraft(row);
}

export function getDraftById(userId, id) {
    const row = db.prepare('SELECT * FROM ai_pr_reviews WHERE id = ? AND user_id = ?').get(id, userId);
    return rowToDraft(row);
}

export function updateDraftJson(userId, id, draftObj) {
    const json = JSON.stringify(draftObj);
    const result = db.prepare(`
        UPDATE ai_pr_reviews SET draft_json = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ? AND status = 'draft'
    `).run(json, id, userId);
    return result.changes;
}

export function markPublished(userId, id, githubReviewId) {
    const result = db.prepare(`
        UPDATE ai_pr_reviews SET status = 'published', github_review_id = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?
    `).run(githubReviewId, id, userId);
    return result.changes;
}

export function deleteDraft(userId, id) {
    const result = db.prepare('DELETE FROM ai_pr_reviews WHERE id = ? AND user_id = ?').run(id, userId);
    return result.changes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/__tests__/ai-pr-review-store.test.js`
Expected: PASS (5 of 5)

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-pr-review-store.js server/__tests__/ai-pr-review-store.test.js
git commit -m "feat(ai-deep-review): SQLite store with upsert + ownership enforcement"
```

---

## Task 6: HTTP routes — generate, get, update, publish, delete

**Files:**
- Create: `server/routes/ai/deep-review.js`
- Modify: `server/index.js` (mount the router)
- Test: `server/__tests__/ai/deep-review-routes.test.js`

Five endpoints. Generation is the heavy one — fetches PR + files + diff from GitHub via `readThrough`, calls the engine, saves the draft. Publish wraps the GitHub call in `executeViaOutbox` for retry.

- [ ] **Step 1: Write the failing route test**

Create `server/__tests__/ai/deep-review-routes.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import db from '../../db.js';

vi.mock('../../lib/ai-provider.js', async () => {
    return {
        createProviderForUser: vi.fn(async () => ({
            model: {},
            _modelName: 'gemini-2.5-flash',
            generate: vi.fn(async () => ({
                parsed: {
                    walkthrough: { summary: 'AI summary', perFileTable: [], mermaid: '', estimatedReviewTime: '5 min', riskLevel: 'low' },
                    lineComments: [{ path: 'a.js', side: 'RIGHT', line: 1, severity: 'info', body: 'hi' }],
                },
            })),
        })),
    };
});

vi.mock('../../lib/github-api.js', () => ({
    githubApi: {
        request: vi.fn(async ({ url }) => {
            if (url.includes('/pulls/42/files')) {
                return { data: [{ filename: 'a.js', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ ... @@' }] };
            }
            if (url.match(/\/pulls\/42$/)) {
                return { data: { number: 42, title: 'Add X', user: { login: 'alice' }, body: 'desc', additions: 1, deletions: 0, head: { sha: 'sha-head' }, base: { sha: 'sha-base' } } };
            }
            if (url.includes('/reviews') && url.endsWith('/reviews')) {
                return { data: { id: 9999 } };
            }
            return { data: {} };
        }),
    },
}));

import deepReviewRouter from '../../routes/ai/deep-review.js';

function makeApp(userId = 1) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { userId, accessToken: 'fake' };
        next();
    });
    app.use('/api/ai/deep-review', deepReviewRouter);
    return app;
}

beforeEach(() => {
    db.prepare('DELETE FROM ai_pr_reviews WHERE user_id = ?').run(1);
    db.prepare('INSERT OR IGNORE INTO users (id, github_id, login) VALUES (?, ?, ?)').run(1, 1, 'alice');
});

describe('POST /api/ai/deep-review/:owner/:repo/:pr', () => {
    it('generates a draft and persists it', async () => {
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(200);
        expect(res.body.draftId).toBeGreaterThan(0);
        expect(res.body.draft.walkthrough.summary).toBe('AI summary');
        expect(res.body.draft.lineComments).toHaveLength(1);
    });

    it('returns 404 when no provider is configured', async () => {
        const { createProviderForUser } = await import('../../lib/ai-provider.js');
        createProviderForUser.mockResolvedValueOnce(null);
        const app = makeApp();
        const res = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NO_AI_PROVIDER');
    });
});

describe('GET /api/ai/deep-review/:owner/:repo/:pr', () => {
    it('returns the cached draft when present, no LLM call', async () => {
        const app = makeApp();
        await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const res = await request(app).get('/api/ai/deep-review/acme/api/42');
        expect(res.status).toBe(200);
        expect(res.body.draft.walkthrough.summary).toBe('AI summary');
    });

    it('returns 404 when no draft exists', async () => {
        const app = makeApp();
        const res = await request(app).get('/api/ai/deep-review/acme/api/999');
        expect(res.status).toBe(404);
    });
});

describe('PATCH /api/ai/deep-review/:draftId/comments/:commentIdx', () => {
    it('removes a comment by index', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const draftId = created.body.draftId;
        const res = await request(app).patch(`/api/ai/deep-review/${draftId}/comments/0`).send({ action: 'dismiss' });
        expect(res.status).toBe(200);
        expect(res.body.draft.lineComments).toHaveLength(0);
    });

    it('edits a comment body and suggestion in-place', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const draftId = created.body.draftId;
        const res = await request(app)
            .patch(`/api/ai/deep-review/${draftId}/comments/0`)
            .send({ action: 'edit', body: 'edited body', suggestion: 'foo()' });
        expect(res.status).toBe(200);
        expect(res.body.draft.lineComments[0].body).toBe('edited body');
        expect(res.body.draft.lineComments[0].suggestion).toBe('foo()');
    });
});

describe('POST /api/ai/deep-review/:draftId/publish', () => {
    it('posts to GitHub and marks the draft published', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const draftId = created.body.draftId;
        const res = await request(app).post(`/api/ai/deep-review/${draftId}/publish`).send({ event: 'COMMENT' });
        expect(res.status).toBe(200);
        expect(res.body.githubReviewId).toBe(9999);
    });
});

describe('DELETE /api/ai/deep-review/:draftId', () => {
    it('discards the draft', async () => {
        const app = makeApp();
        const created = await request(app).post('/api/ai/deep-review/acme/api/42').send({});
        const res = await request(app).delete(`/api/ai/deep-review/${created.body.draftId}`);
        expect(res.status).toBe(204);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/ai/deep-review-routes.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

Create `server/routes/ai/deep-review.js`:

```js
/*
 * AI Deep Review routes
 *
 *   POST   /:owner/:repo/:pr           — generate (or refresh) draft
 *   GET    /:owner/:repo/:pr           — fetch cached draft
 *   PATCH  /:draftId/comments/:idx     — { action: 'dismiss'|'edit', body?, suggestion? }
 *   POST   /:draftId/publish           — { event: 'COMMENT'|'APPROVE'|'REQUEST_CHANGES' }
 *   DELETE /:draftId                   — discard
 */

import express from 'express';
import { requireAuth, errorResponse } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import { readThrough } from '../../lib/gh-cache.js';
import { executeViaOutbox } from '../../lib/outbox-helper.js';
import { createProviderForUser } from '../../lib/ai-provider.js';
import { runDeepReview } from '../../lib/ai-features/pr-deep-review.js';
import { buildGitHubReviewPayload } from '../../lib/ai-features/pr-deep-review-publish.js';
import {
    saveDraft, getDraft, getDraftById, updateDraftJson, markPublished, deleteDraft,
} from '../../lib/ai-pr-review-store.js';
import logger from '../../lib/logger.js';

const router = express.Router();

const GITHUB_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
router.param('owner', (req, res, next, val) => {
    if (!GITHUB_NAME_RE.test(val) || val.length > 39) return errorResponse(res, 400, 'Invalid owner', 'INVALID_PARAM');
    next();
});
router.param('repo', (req, res, next, val) => {
    if (!GITHUB_NAME_RE.test(val) || val.length > 100) return errorResponse(res, 400, 'Invalid repo', 'INVALID_PARAM');
    next();
});
router.param('pr', (req, res, next, val) => {
    if (!/^\d+$/.test(val) || val.length > 10) return errorResponse(res, 400, 'Invalid PR number', 'INVALID_PARAM');
    next();
});
router.param('draftId', (req, res, next, val) => {
    if (!/^\d+$/.test(val)) return errorResponse(res, 400, 'Invalid draft id', 'INVALID_PARAM');
    next();
});

// --- POST generate ---------------------------------------------------------

router.post('/:owner/:repo/:pr', requireAuth, async (req, res) => {
    const { owner, repo, pr } = req.params;
    const userId = req.session.userId;

    const provider = await createProviderForUser(userId, 'completion', { featureKey: 'PR_DEEP_REVIEW' });
    if (!provider) {
        return errorResponse(res, 404, 'No AI provider configured. Set up your API key in Settings → AI.', 'NO_AI_PROVIDER');
    }

    let prData, files;
    try {
        const prRes = await readThrough({
            session: req.session,
            cacheKey: `pr:${owner}/${repo}/${pr}`,
            ttlMs: 60_000,
            fetcher: () => githubApi.request({ session: req.session, url: `/repos/${owner}/${repo}/pulls/${pr}`, method: 'GET' }),
        });
        prData = prRes.data;
        const filesRes = await readThrough({
            session: req.session,
            cacheKey: `pr-files:${owner}/${repo}/${pr}`,
            ttlMs: 60_000,
            fetcher: () => githubApi.request({ session: req.session, url: `/repos/${owner}/${repo}/pulls/${pr}/files?per_page=100`, method: 'GET' }),
        });
        files = filesRes.data;
    } catch (err) {
        logger.warn({ err, owner, repo, pr }, 'Failed to fetch PR data for deep review');
        return errorResponse(res, 502, 'Failed to fetch PR data from GitHub', 'GITHUB_FETCH_FAILED');
    }

    const diffPatch = (files || []).map((f) => `--- ${f.filename}\n${f.patch || ''}`).join('\n\n');
    const result = await runDeepReview({
        provider,
        userId,
        repoFullName: `${owner}/${repo}`,
        prMetadata: { title: prData.title, author: prData.user?.login, body: prData.body, additions: prData.additions, deletions: prData.deletions },
        fileManifest: files,
        diffPatch,
    });

    if (!result) {
        return errorResponse(res, 503, 'AI Deep Review is disabled on this server.', 'AI_DISABLED');
    }

    const draftId = saveDraft(userId, owner, repo, Number(pr), prData.head.sha, result, /* costUsd */ null, result.modelUsed);
    res.json({ draftId, draft: result, lastReviewedSha: prData.head.sha });
});

// --- GET cached draft ------------------------------------------------------

router.get('/:owner/:repo/:pr', requireAuth, (req, res) => {
    const { owner, repo, pr } = req.params;
    const got = getDraft(req.session.userId, owner, repo, Number(pr));
    if (!got) return errorResponse(res, 404, 'No draft found.', 'NOT_FOUND');
    res.json({ draftId: got.id, draft: got.draft, lastReviewedSha: got.lastReviewedSha, status: got.status });
});

// --- PATCH edit / dismiss a single comment --------------------------------

router.patch('/:draftId/comments/:idx', requireAuth, express.json(), (req, res) => {
    const draftId = Number(req.params.draftId);
    const idx = Number(req.params.idx);
    const { action, body, suggestion } = req.body || {};
    const got = getDraftById(req.session.userId, draftId);
    if (!got) return errorResponse(res, 404, 'Draft not found.', 'NOT_FOUND');

    const comments = Array.isArray(got.draft.lineComments) ? [...got.draft.lineComments] : [];
    if (idx < 0 || idx >= comments.length) return errorResponse(res, 400, 'Comment index out of range.', 'INVALID_INDEX');

    if (action === 'dismiss') {
        comments.splice(idx, 1);
    } else if (action === 'edit') {
        comments[idx] = {
            ...comments[idx],
            ...(typeof body === 'string' ? { body } : {}),
            ...(typeof suggestion === 'string' ? { suggestion } : {}),
        };
    } else {
        return errorResponse(res, 400, 'Unknown action.', 'INVALID_ACTION');
    }

    const updated = { ...got.draft, lineComments: comments };
    updateDraftJson(req.session.userId, draftId, updated);
    res.json({ draftId, draft: updated });
});

// --- POST publish ----------------------------------------------------------

router.post('/:draftId/publish', requireAuth, express.json(), async (req, res) => {
    const draftId = Number(req.params.draftId);
    const event = (req.body?.event || 'COMMENT').toUpperCase();
    if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) {
        return errorResponse(res, 400, 'Invalid event.', 'INVALID_EVENT');
    }
    const got = getDraftById(req.session.userId, draftId);
    if (!got) return errorResponse(res, 404, 'Draft not found.', 'NOT_FOUND');
    if (got.status === 'published') return errorResponse(res, 409, 'Draft already published.', 'ALREADY_PUBLISHED');

    const payload = buildGitHubReviewPayload({
        draft: got.draft,
        meta: {
            commitId: got.lastReviewedSha,
            user: req.session.login || 'user',
            costUSD: got.costUsd,
            lastReviewedSha: got.lastReviewedSha,
        },
        event,
    });

    let reviewId;
    try {
        const result = await executeViaOutbox(req.session, async () =>
            githubApi.request({
                session: req.session,
                url: `/repos/${got.repoOwner}/${got.repoName}/pulls/${got.prNumber}/reviews`,
                method: 'POST',
                data: payload,
            }),
        );
        reviewId = result.data.id;
    } catch (err) {
        logger.warn({ err, draftId }, 'GitHub publish failed for AI deep review');
        return errorResponse(res, 502, err?.message || 'Failed to publish review to GitHub.', 'PUBLISH_FAILED');
    }

    markPublished(req.session.userId, draftId, reviewId);
    res.json({ draftId, githubReviewId: reviewId });
});

// --- DELETE ---------------------------------------------------------------

router.delete('/:draftId', requireAuth, (req, res) => {
    const n = deleteDraft(req.session.userId, Number(req.params.draftId));
    if (n === 0) return errorResponse(res, 404, 'Draft not found.', 'NOT_FOUND');
    res.status(204).end();
});

export default router;
```

- [ ] **Step 4: Mount the router**

In `server/index.js`, find the existing `app.use('/api/...')` block and add:

```js
import deepReviewRouter from './routes/ai/deep-review.js';
// ...
app.use('/api/ai/deep-review', deepReviewRouter);
```

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `npx vitest run server/__tests__/ai/deep-review-routes.test.js`
Expected: PASS (8 of 8). If `executeViaOutbox` is async-only and your test stubs `githubApi.request` — verify the publish test still passes; if not, mock `executeViaOutbox` to call its callback directly.

- [ ] **Step 6: Commit**

```bash
git add server/routes/ai/deep-review.js server/index.js server/__tests__/ai/deep-review-routes.test.js
git commit -m "feat(ai-deep-review): 5 routes — generate, get, patch, publish, delete"
```

---

## Task 7: Frontend hook — `useAIDeepReview`

**Files:**
- Create: `src/hooks/useAIDeepReview.js`
- Test: `tests/hooks/useAIDeepReview.test.js`

Wraps the 5 endpoints. Uses the project's existing `fetch` pattern (cookie session, JSON). Returns draft + actions.

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/useAIDeepReview.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAIDeepReview } from '../../src/hooks/useAIDeepReview';

const sampleDraft = { walkthrough: { summary: 'ok' }, lineComments: [] };

beforeEach(() => {
    global.fetch = vi.fn();
});

function jsonResponse(status, body) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe('useAIDeepReview', () => {
    it('loads cached draft on mount', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: sampleDraft }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toEqual(sampleDraft));
        expect(result.current.draftId).toBe(1);
    });

    it('treats 404 as no-draft (loading=false, draft=null)', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, { code: 'NOT_FOUND' }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.draft).toBeNull();
    });

    it('generate() calls POST and updates state', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(404, {}));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.loading).toBe(false));

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 7, draft: sampleDraft }));
        await act(async () => { await result.current.generate(); });
        expect(result.current.draftId).toBe(7);
        expect(result.current.draft).toEqual(sampleDraft);
    });

    it('dismiss(idx) PATCHes with action=dismiss', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: { walkthrough: {}, lineComments: [{ body: 'x' }] } }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: { walkthrough: {}, lineComments: [] } }));
        await act(async () => { await result.current.dismiss(0); });
        expect(global.fetch).toHaveBeenLastCalledWith(
            '/api/ai/deep-review/1/comments/0',
            expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"dismiss"') })
        );
        expect(result.current.draft.lineComments).toHaveLength(0);
    });

    it('publish() POSTs and reports the github review id', async () => {
        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, draft: sampleDraft }));
        const { result } = renderHook(() => useAIDeepReview('acme', 'api', 42));
        await waitFor(() => expect(result.current.draft).toBeTruthy());

        global.fetch.mockReturnValueOnce(jsonResponse(200, { draftId: 1, githubReviewId: 9999 }));
        let pubResult;
        await act(async () => { pubResult = await result.current.publish('COMMENT'); });
        expect(pubResult.githubReviewId).toBe(9999);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hooks/useAIDeepReview.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useAIDeepReview.js`:

```js
import { useState, useCallback, useEffect, useRef } from 'react';

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        },
    });
    if (res.status === 204) return null;
    let body = null;
    try { body = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
        const err = new Error(body?.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = body?.code;
        throw err;
    }
    return body;
}

/**
 * Drives the AI Deep Review surface for one PR.
 *
 * On mount, attempts to load the cached draft (no LLM call). When absent,
 * `loading` returns false with `draft=null` so the UI can show a "Generate"
 * empty state.
 *
 * Returns:
 *   draftId, draft, loading, error,
 *   generate(),                       — POST: build a fresh draft
 *   dismiss(idx), edit(idx, {body, suggestion}),
 *   publish(event),                   — POST GitHub review, mark published
 *   discard(),                        — DELETE the draft
 */
export function useAIDeepReview(owner, repo, prNumber) {
    const [draftId, setDraftId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const aliveRef = useRef(true);

    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; };
    }, []);

    const loadCached = useCallback(async () => {
        if (!owner || !repo || !prNumber) return;
        setLoading(true);
        setError(null);
        try {
            const body = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`);
            if (!aliveRef.current) return;
            setDraftId(body.draftId);
            setDraft(body.draft);
        } catch (err) {
            if (!aliveRef.current) return;
            if (err.status === 404) {
                setDraftId(null);
                setDraft(null);
            } else {
                setError(err.message);
            }
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber]);

    useEffect(() => { loadCached(); }, [loadCached]);

    const generate = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const body = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (!aliveRef.current) return;
            setDraftId(body.draftId);
            setDraft(body.draft);
            return body;
        } catch (err) {
            if (aliveRef.current) setError(err.message);
            throw err;
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [owner, repo, prNumber]);

    const dismiss = useCallback(async (idx) => {
        if (draftId == null) return;
        const body = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'dismiss' }),
        });
        if (aliveRef.current) setDraft(body.draft);
    }, [draftId]);

    const edit = useCallback(async (idx, { body: newBody, suggestion }) => {
        if (draftId == null) return;
        const body = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
            method: 'PATCH',
            body: JSON.stringify({ action: 'edit', body: newBody, suggestion }),
        });
        if (aliveRef.current) setDraft(body.draft);
    }, [draftId]);

    const publish = useCallback(async (event = 'COMMENT') => {
        if (draftId == null) throw new Error('No draft to publish.');
        return fetchJSON(`/api/ai/deep-review/${draftId}/publish`, {
            method: 'POST',
            body: JSON.stringify({ event }),
        });
    }, [draftId]);

    const discard = useCallback(async () => {
        if (draftId == null) return;
        await fetchJSON(`/api/ai/deep-review/${draftId}`, { method: 'DELETE' });
        if (aliveRef.current) {
            setDraftId(null);
            setDraft(null);
        }
    }, [draftId]);

    return { draftId, draft, loading, error, generate, dismiss, edit, publish, discard };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hooks/useAIDeepReview.test.js`
Expected: PASS (5 of 5)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAIDeepReview.js tests/hooks/useAIDeepReview.test.js
git commit -m "feat(ai-deep-review): useAIDeepReview hook (load + generate + edit + publish + discard)"
```

---

## Task 8: `<AIInlineComment>` — diff overlay

**Files:**
- Create: `src/components/PRReview/AIDeepReview/AIInlineComment.jsx`
- Test: `tests/components/PRReview/AIDeepReview/AIInlineComment.test.jsx`

Tiny presentational component. Three actions, severity badge, 🤖 icon, distinct visual from user pending comments.

- [ ] **Step 1: Write the failing test**

Create `tests/components/PRReview/AIDeepReview/AIInlineComment.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIInlineComment } from '../../../../src/components/PRReview/AIDeepReview/AIInlineComment';

const baseComment = { line: 12, severity: 'warning', body: 'Use strict equality.', suggestion: 'a === b' };

describe('AIInlineComment', () => {
    it('renders severity, body, and the bot icon', () => {
        render(<AIInlineComment comment={baseComment} idx={0} onDismiss={() => {}} onEdit={() => {}} />);
        expect(screen.getByText(/use strict equality/i)).toBeInTheDocument();
        expect(screen.getByText(/warning/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/ai-generated comment/i)).toBeInTheDocument();
    });

    it('shows a suggestion preview when present', () => {
        render(<AIInlineComment comment={baseComment} idx={0} onDismiss={() => {}} onEdit={() => {}} />);
        expect(screen.getByText(/a === b/)).toBeInTheDocument();
    });

    it('Dismiss calls onDismiss(idx)', () => {
        const onDismiss = vi.fn();
        render(<AIInlineComment comment={baseComment} idx={3} onDismiss={onDismiss} onEdit={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(onDismiss).toHaveBeenCalledWith(3);
    });

    it('Edit toggles to an edit form and saves on submit', () => {
        const onEdit = vi.fn();
        render(<AIInlineComment comment={baseComment} idx={1} onDismiss={() => {}} onEdit={onEdit} />);
        fireEvent.click(screen.getByRole('button', { name: /edit/i }));
        const textarea = screen.getByLabelText(/comment body/i);
        fireEvent.change(textarea, { target: { value: 'new body' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(onEdit).toHaveBeenCalledWith(1, expect.objectContaining({ body: 'new body' }));
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/PRReview/AIDeepReview/AIInlineComment.test.jsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the component**

Create `src/components/PRReview/AIDeepReview/AIInlineComment.jsx`:

```jsx
import { useState } from 'react';

const SEVERITY_TONE = {
    info: 'bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-200',
    suggestion: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200',
    warning: 'bg-orange-50 border-orange-300 text-orange-900 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-200',
    critical: 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200',
};

export function AIInlineComment({ comment, idx, onDismiss, onEdit }) {
    const [editing, setEditing] = useState(false);
    const [body, setBody] = useState(comment.body || '');
    const [suggestion, setSuggestion] = useState(comment.suggestion || '');

    const tone = SEVERITY_TONE[comment.severity] || SEVERITY_TONE.info;

    if (editing) {
        return (
            <div
                aria-label="AI-generated comment"
                className={`my-2 rounded-md border-l-4 p-3 text-sm ${tone}`}
            >
                <label className="block text-xs font-medium mb-1">
                    Comment body
                    <textarea
                        aria-label="Comment body"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        className="mt-1 w-full rounded border bg-white px-2 py-1 dark:bg-gray-900 dark:border-gray-700"
                        rows={3}
                    />
                </label>
                <label className="block text-xs font-medium mt-2 mb-1">
                    Suggestion (optional)
                    <textarea
                        aria-label="Suggestion code"
                        value={suggestion}
                        onChange={(e) => setSuggestion(e.target.value)}
                        className="mt-1 w-full rounded border bg-white px-2 py-1 font-mono text-xs dark:bg-gray-900 dark:border-gray-700"
                        rows={3}
                    />
                </label>
                <div className="flex gap-2 mt-2 justify-end">
                    <button onClick={() => setEditing(false)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/5">Cancel</button>
                    <button
                        onClick={() => { onEdit(idx, { body, suggestion }); setEditing(false); }}
                        className="px-2 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Save
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            aria-label="AI-generated comment"
            className={`my-2 rounded-md border-l-4 p-3 text-sm ${tone}`}
        >
            <div className="flex items-start gap-2">
                <span aria-hidden="true" className="text-base leading-none">🤖</span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{comment.severity}</span>
                        <span className="text-xs opacity-60">line {comment.line}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{comment.body}</p>
                    {comment.suggestion ? (
                        <pre className="mt-2 rounded bg-black/5 dark:bg-white/5 p-2 text-xs font-mono whitespace-pre-wrap break-words">{comment.suggestion}</pre>
                    ) : null}
                </div>
            </div>
            <div className="flex gap-2 mt-2 justify-end">
                <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/5">Edit</button>
                <button onClick={() => onDismiss(idx)} className="px-2 py-1 text-xs rounded hover:bg-black/5 dark:hover:bg-white/5">Dismiss</button>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/PRReview/AIDeepReview/AIInlineComment.test.jsx`
Expected: PASS (4 of 4)

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/AIDeepReview/AIInlineComment.jsx tests/components/PRReview/AIDeepReview/AIInlineComment.test.jsx
git commit -m "feat(ai-deep-review): AIInlineComment overlay (severity tones + edit + dismiss)"
```

---

## Task 9: `<WalkthroughTab>` — body + lazy Mermaid

**Files:**
- Create: `src/components/PRReview/AIDeepReview/WalkthroughTab.jsx`
- Manual smoke (no unit test for the lazy-load mechanism — covered by E2E)

- [ ] **Step 1: Add `mermaid` to package.json**

Run: `npm install mermaid@^11`
Expected: package added without conflict

- [ ] **Step 2: Implement the component**

Create `src/components/PRReview/AIDeepReview/WalkthroughTab.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';

export function WalkthroughTab({ walkthrough }) {
    const mermaidRef = useRef(null);
    const [mermaidError, setMermaidError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const src = walkthrough?.mermaid?.trim();
        if (!src || !mermaidRef.current) return undefined;

        // Lazy-load to keep mermaid (~200kB) out of the initial bundle
        import('mermaid').then((mod) => {
            if (cancelled) return;
            const mermaid = mod.default || mod;
            mermaid.initialize({ startOnLoad: false, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default' });
            const id = `mermaid-${Math.random().toString(36).slice(2)}`;
            mermaid.render(id, src).then(({ svg }) => {
                if (!cancelled && mermaidRef.current) mermaidRef.current.innerHTML = svg;
            }).catch((err) => {
                if (!cancelled) setMermaidError(err?.message || 'Failed to render diagram');
            });
        }).catch((err) => setMermaidError(err?.message || 'Failed to load mermaid'));

        return () => { cancelled = true; };
    }, [walkthrough?.mermaid]);

    if (!walkthrough) {
        return (
            <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
                No walkthrough yet. Click "Generate AI Review" to start.
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded font-medium ${riskTone(walkthrough.riskLevel)}`}>
                    Risk: {walkthrough.riskLevel}
                </span>
                <span className="text-slate-500 dark:text-slate-400">~{walkthrough.estimatedReviewTime}</span>
            </div>

            {walkthrough.summary ? (
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{walkthrough.summary}</div>
            ) : null}

            {Array.isArray(walkthrough.perFileTable) && walkthrough.perFileTable.length > 0 ? (
                <div>
                    <h4 className="font-medium mb-2 text-slate-700 dark:text-slate-300">Files</h4>
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 dark:text-slate-400">
                            <tr>
                                <th className="text-left py-1 pr-2">File</th>
                                <th className="text-left py-1 pr-2">Change</th>
                                <th className="text-left py-1">Summary</th>
                            </tr>
                        </thead>
                        <tbody>
                            {walkthrough.perFileTable.map((row, i) => (
                                <tr key={i} className="border-t border-slate-200 dark:border-slate-800">
                                    <td className="py-1 pr-2 font-mono">{row.path}</td>
                                    <td className="py-1 pr-2">{row.change}</td>
                                    <td className="py-1">{row.summary}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}

            {walkthrough.mermaid?.trim() ? (
                <div>
                    <h4 className="font-medium mb-2 text-slate-700 dark:text-slate-300">Diagram</h4>
                    {mermaidError ? (
                        <p className="text-xs text-red-600 dark:text-red-400">Diagram failed to render: {mermaidError}</p>
                    ) : (
                        <div ref={mermaidRef} className="overflow-auto rounded border border-slate-200 dark:border-slate-800 p-2" />
                    )}
                </div>
            ) : null}
        </div>
    );
}

function riskTone(level) {
    switch (level) {
        case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
        case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
        case 'medium': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
        default: return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    }
}
```

- [ ] **Step 3: Verify it renders without throwing in a quick smoke test**

Run: `npm run dev` (in another shell), then in the browser at a PR with MOCK_MODE on, check the console — no errors when the WalkthroughTab loads. (Wired up properly only after Task 11; for now, just verify the file compiles.)

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/components/PRReview/AIDeepReview/WalkthroughTab.jsx
git commit -m "feat(ai-deep-review): WalkthroughTab with lazy-loaded Mermaid render"
```

---

## Task 10: `<CommentsListTab>` — filterable list

**Files:**
- Create: `src/components/PRReview/AIDeepReview/CommentsListTab.jsx`

Simple list view with severity filter and "jump to file" callback.

- [ ] **Step 1: Implement the component**

Create `src/components/PRReview/AIDeepReview/CommentsListTab.jsx`:

```jsx
import { useState, useMemo } from 'react';

const SEVERITY_OPTIONS = ['all', 'critical', 'warning', 'suggestion', 'info'];

export function CommentsListTab({ comments, onJumpToFile, onDismiss, onEdit }) {
    const [filter, setFilter] = useState('all');
    const visible = useMemo(() => {
        const list = comments || [];
        if (filter === 'all') return list;
        return list.filter((c) => c.severity === filter);
    }, [comments, filter]);

    if (!comments || comments.length === 0) {
        return <div className="p-4 text-sm text-slate-500 dark:text-slate-400">No AI comments yet.</div>;
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="px-3 pt-3 pb-2 flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">{visible.length} / {comments.length}</span>
                <select
                    aria-label="Severity filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="ml-auto rounded border bg-white px-2 py-1 dark:bg-gray-900 dark:border-gray-700"
                >
                    {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>
            <ul className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
                {visible.map((c, idx) => {
                    const realIdx = comments.indexOf(c);
                    return (
                        <li key={`${c.path}-${c.line}-${idx}`} className="rounded border border-slate-200 dark:border-slate-700 p-2 text-xs">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold uppercase opacity-80">{c.severity}</span>
                                <button
                                    onClick={() => onJumpToFile?.(c.path)}
                                    className="font-mono text-slate-700 dark:text-slate-300 hover:underline truncate"
                                    title={c.path}
                                >
                                    {c.path}:{c.line}
                                </button>
                                <button onClick={() => onDismiss?.(realIdx)} className="ml-auto opacity-60 hover:opacity-100">×</button>
                            </div>
                            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">{c.body}</p>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
```

- [ ] **Step 2: Quick smoke build**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/PRReview/AIDeepReview/CommentsListTab.jsx
git commit -m "feat(ai-deep-review): CommentsListTab with severity filter + jump-to-file"
```

---

## Task 11: `<AIReviewPanel>` + wiring into `PRReviewView`

**Files:**
- Create: `src/components/PRReview/AIDeepReview/AIReviewPanel.jsx`
- Modify: `src/components/PRReview/PRReviewView.jsx` (replace `AISummaryPanel` slot)
- Modify: `src/components/PRReview/DiffPanel/DiffPanel.jsx` (accept `aiComments`, render overlays)

The AIReviewPanel hosts the tabs. PRReviewView holds the `useAIDeepReview()` state and passes the AI comments down to DiffPanel.

- [ ] **Step 1: Create the panel**

Create `src/components/PRReview/AIDeepReview/AIReviewPanel.jsx`:

```jsx
import { useState } from 'react';
import { WalkthroughTab } from './WalkthroughTab';
import { CommentsListTab } from './CommentsListTab';

export function AIReviewPanel({
    draft,
    loading,
    error,
    onGenerate,
    onPublish,
    onJumpToFile,
    onDismissComment,
    onEditComment,
    publishing,
}) {
    const [tab, setTab] = useState('walkthrough');

    if (!draft && !loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Generate an AI review to get a structured walkthrough, line comments, and one-click code suggestions you can publish to GitHub.</p>
                <button
                    onClick={onGenerate}
                    className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                    Generate AI Review
                </button>
                {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
            </div>
        );
    }

    if (loading && !draft) {
        return <div className="p-4 text-sm text-slate-500 dark:text-slate-400">Generating AI review…</div>;
    }

    const lineComments = draft?.lineComments ?? [];

    return (
        <div className="flex flex-col h-full min-h-0 border-l border-slate-200 dark:border-slate-800">
            <div className="flex items-center border-b border-slate-200 dark:border-slate-800 text-xs">
                <button
                    onClick={() => setTab('walkthrough')}
                    aria-pressed={tab === 'walkthrough'}
                    className={`px-3 py-2 ${tab === 'walkthrough' ? 'font-semibold border-b-2 border-blue-600' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    Walkthrough
                </button>
                <button
                    onClick={() => setTab('comments')}
                    aria-pressed={tab === 'comments'}
                    className={`px-3 py-2 ${tab === 'comments' ? 'font-semibold border-b-2 border-blue-600' : 'text-slate-500 dark:text-slate-400'}`}
                >
                    Comments ({lineComments.length})
                </button>
                <button
                    onClick={onGenerate}
                    title="Re-run review"
                    className="ml-auto mr-1 p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                >
                    ↻
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'walkthrough'
                    ? <WalkthroughTab walkthrough={draft.walkthrough} />
                    : <CommentsListTab comments={lineComments} onJumpToFile={onJumpToFile} onDismiss={onDismissComment} onEdit={onEditComment} />}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 p-3">
                <button
                    onClick={onPublish}
                    disabled={publishing || lineComments.length === 0 && !draft?.walkthrough?.summary}
                    className="w-full px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                    {publishing ? 'Publishing…' : 'Publish to GitHub →'}
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2a: Read `DiffPanel.jsx` to find the line-comment rendering site**

Run: `cat src/components/PRReview/DiffPanel/DiffPanel.jsx` (or open in IDE)
Look for: where `pendingComments` is rendered per line (likely a `.filter((c) => c.line === currentLine)` followed by a JSX block). Note the surrounding component structure — you'll mirror it for `aiComments` in the next step.

If `DiffPanel.jsx` doesn't render `pendingComments` per-line currently (it only renders the diff text), the safest minimal integration is to render all matched AI comments in a vertical stack directly below the diff body for the active file (still useful, just less precisely positioned). Pick the approach that matches the file's actual structure.

- [ ] **Step 2b: Add the `aiComments` prop and render the overlays**

In `src/components/PRReview/DiffPanel/DiffPanel.jsx`:

1. Add the import at the top:

```jsx
import { AIInlineComment } from '../AIDeepReview/AIInlineComment';
```

2. Extend the props destructure with three new optional props (place at the end of the existing list):

```jsx
export function DiffPanel({
    file,
    viewMode,
    comments,
    pendingComments,
    resolvedComments,
    onAddComment,
    onReply,
    onResolve,
    aiComments = [],
    onDismissAIComment,
    onEditAIComment,
}) {
```

3. **If you found per-line rendering in step 2a:** in the same map block where `pendingComments.filter((c) => c.line === currentLine)` is rendered, add an analogous block for AI comments:

```jsx
{aiComments
    .filter((c) => c.line === currentLine)
    .map((c) => (
        <AIInlineComment
            key={`ai-${c._idx}`}
            comment={c}
            idx={c._idx}
            onDismiss={onDismissAIComment}
            onEdit={onEditAIComment}
        />
    ))}
```

4. **Otherwise (per-file fallback):** render all AI comments in a stack at the bottom of the diff:

```jsx
{aiComments.length > 0 ? (
    <div className="border-t border-slate-200 dark:border-slate-800 px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">AI comments for this file</div>
        {aiComments.map((c) => (
            <AIInlineComment
                key={`ai-${c._idx}`}
                comment={c}
                idx={c._idx}
                onDismiss={onDismissAIComment}
                onEdit={onEditAIComment}
            />
        ))}
    </div>
) : null}
```

The PRReviewView wiring in Step 3 below stamps `_idx` on each AI comment before passing them down, so dismiss/edit callbacks map back to the canonical position in the draft.

- [ ] **Step 3: Wire `useAIDeepReview` into `PRReviewView.jsx`**

In `src/components/PRReview/PRReviewView.jsx`, near the existing `useReviewAI` import, add:

```jsx
import { useAIDeepReview } from '../../hooks/useAIDeepReview'
import { AIReviewPanel } from './AIDeepReview/AIReviewPanel'
import { PublishReviewModal } from './AIDeepReview/PublishReviewModal'
```

Inside `PRReviewView`, after the existing `useReviewAI` block, add:

```jsx
const deep = useAIDeepReview(owner, repo, pullNumber);
const [publishOpen, setPublishOpen] = useState(false);
const [publishing, setPublishing] = useState(false);

// Stamp original indices on the AI comments we hand to DiffPanel so child
// callbacks can map back to the canonical position before dismissing.
const stampedAIComments = useMemo(
    () => (deep.draft?.lineComments || []).map((c, _idx) => ({ ...c, _idx })),
    [deep.draft]
);
```

Replace the right-side `<AISummaryPanel>` block with:

```jsx
<AIReviewPanel
    draft={deep.draft}
    loading={deep.loading}
    error={deep.error}
    onGenerate={deep.generate}
    onPublish={() => setPublishOpen(true)}
    onJumpToFile={(filename) => dispatch({ type: 'SET_ACTIVE_FILE', filename })}
    onDismissComment={(idx) => deep.dismiss(idx)}
    onEditComment={(idx, payload) => deep.edit(idx, payload)}
    publishing={publishing}
/>
```

Pass the AI comments down to `<DiffPanel>`:

```jsx
<DiffPanel
    file={activeFileObj}
    viewMode={state.viewMode}
    comments={state.comments[state.activeFile] ?? []}
    pendingComments={state.pendingComments.filter((c) => c.path === state.activeFile)}
    resolvedComments={state.resolvedComments}
    onAddComment={(comment) => dispatch({ type: 'ADD_PENDING_COMMENT', comment })}
    onReply={replyToComment}
    onResolve={(commentId) => dispatch({ type: 'TOGGLE_RESOLVED', commentId })}
    aiComments={stampedAIComments.filter((c) => c.path === state.activeFile)}
    onDismissAIComment={(idx) => deep.dismiss(idx)}
    onEditAIComment={(idx, payload) => deep.edit(idx, payload)}
/>
```

Add the modal at the bottom of the JSX (next to the existing `<ConfirmModal>`):

```jsx
<PublishReviewModal
    isOpen={publishOpen}
    onClose={() => setPublishOpen(false)}
    draft={deep.draft}
    onPublish={async (event) => {
        setPublishing(true);
        try {
            const out = await deep.publish(event);
            toast.success?.({ title: 'Review published to GitHub', message: `Review #${out.githubReviewId}` });
            setPublishOpen(false);
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to publish review' });
        } finally {
            setPublishing(false);
        }
    }}
    publishing={publishing}
/>
```

- [ ] **Step 4: Verify the build still passes**

Run: `npx vite build --mode development 2>&1 | tail -10`
Expected: build succeeds, no missing imports

- [ ] **Step 5: Commit**

```bash
git add src/components/PRReview/AIDeepReview/AIReviewPanel.jsx src/components/PRReview/PRReviewView.jsx src/components/PRReview/DiffPanel/DiffPanel.jsx
git commit -m "feat(ai-deep-review): AIReviewPanel wired into PRReviewView with diff overlays"
```

---

## Task 12: `<PublishReviewModal>` — preview + submit

**Files:**
- Create: `src/components/PRReview/AIDeepReview/PublishReviewModal.jsx`

Modal that previews the rendered Markdown, shows counts, lets the user pick the event (Comment / Approve / Request changes), and triggers `onPublish`.

- [ ] **Step 1: Implement the modal**

Create `src/components/PRReview/AIDeepReview/PublishReviewModal.jsx`:

```jsx
import { useState } from 'react';

const EVENTS = [
    { key: 'COMMENT', label: 'Comment', tone: 'bg-blue-600 hover:bg-blue-700' },
    { key: 'APPROVE', label: 'Approve', tone: 'bg-emerald-600 hover:bg-emerald-700' },
    { key: 'REQUEST_CHANGES', label: 'Request changes', tone: 'bg-amber-600 hover:bg-amber-700' },
];

export function PublishReviewModal({ isOpen, onClose, draft, onPublish, publishing }) {
    const [event, setEvent] = useState('COMMENT');

    if (!isOpen || !draft) return null;

    const lineCount = (draft.lineComments || []).length;
    const suggestionCount = (draft.lineComments || []).filter((c) => c.suggestion).length;
    const hasMermaid = !!draft.walkthrough?.mermaid?.trim();

    return (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-xl flex flex-col max-h-[90vh]">
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center">
                    <h3 className="font-semibold">Publish AI review to GitHub</h3>
                    <button onClick={onClose} aria-label="Close" className="ml-auto opacity-60 hover:opacity-100">×</button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
                    <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                            <div className="text-2xl font-bold">{lineCount}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Line comments</div>
                        </div>
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                            <div className="text-2xl font-bold">{suggestionCount}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Code suggestions</div>
                        </div>
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3">
                            <div className="text-2xl font-bold">{hasMermaid ? '1' : '0'}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Diagram</div>
                        </div>
                    </div>

                    <div>
                        <h4 className="font-medium mb-2">Walkthrough preview</h4>
                        <div className="rounded border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs">
                            {draft.walkthrough?.summary || '(no summary)'}
                        </div>
                    </div>

                    <div>
                        <h4 className="font-medium mb-2">Review type</h4>
                        <div className="flex gap-2">
                            {EVENTS.map((e) => (
                                <label key={e.key} className={`flex-1 cursor-pointer rounded border p-2 text-center text-xs ${event === e.key ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900' : 'border-slate-200 dark:border-slate-800'}`}>
                                    <input
                                        type="radio"
                                        name="event"
                                        value={e.key}
                                        checked={event === e.key}
                                        onChange={() => setEvent(e.key)}
                                        className="sr-only"
                                    />
                                    {e.label}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5">Cancel</button>
                    <button
                        onClick={() => onPublish(event)}
                        disabled={publishing}
                        className={`px-3 py-1.5 text-sm font-medium rounded text-white disabled:opacity-60 ${EVENTS.find((e) => e.key === event)?.tone}`}
                    >
                        {publishing ? 'Publishing…' : `Publish as ${EVENTS.find((e) => e.key === event)?.label}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify build**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/PRReview/AIDeepReview/PublishReviewModal.jsx
git commit -m "feat(ai-deep-review): PublishReviewModal with event picker + counts preview"
```

---

## Task 13: MOCK_MODE fixture + E2E smoke

**Files:**
- Modify: `src/__mocks__/mockRepoDetail.js`
- Create: `e2e/ai-deep-review.spec.js`

In MOCK_MODE the new `/api/ai/deep-review/...` endpoints don't exist on the (absent) server — we add a fetch interceptor or a local fallback. Easiest: have the hook detect MOCK_MODE and return a built-in fixture.

- [ ] **Step 1: Add MOCK_MODE fallback to the hook**

Modify `src/hooks/useAIDeepReview.js`. At the top of the file, after the existing `fetchJSON` helper, add:

```js
import { mockDeepReviewDraft } from '../__mocks__/mockRepoDetail';

// Per the project's vite-inline-DCE-guard rule (memory: feedback_vite_inline_dce_guards),
// inline both checks at every callsite — do NOT extract to a const.
function isMockMode() {
    return import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true';
}
```

Then inside the hook, replace each callback body with the MOCK_MODE-aware version:

```js
const loadCached = useCallback(async () => {
    if (!owner || !repo || !prNumber) return;
    if (isMockMode()) {
        setDraftId(1);
        setDraft(mockDeepReviewDraft);
        setLoading(false);
        return;
    }
    setLoading(true);
    setError(null);
    try {
        const body = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`);
        if (!aliveRef.current) return;
        setDraftId(body.draftId);
        setDraft(body.draft);
    } catch (err) {
        if (!aliveRef.current) return;
        if (err.status === 404) { setDraftId(null); setDraft(null); }
        else setError(err.message);
    } finally {
        if (aliveRef.current) setLoading(false);
    }
}, [owner, repo, prNumber]);

const generate = useCallback(async () => {
    if (isMockMode()) {
        setDraftId(1);
        setDraft(mockDeepReviewDraft);
        return { draftId: 1, draft: mockDeepReviewDraft };
    }
    setLoading(true);
    setError(null);
    try {
        const body = await fetchJSON(`/api/ai/deep-review/${owner}/${repo}/${prNumber}`, { method: 'POST', body: JSON.stringify({}) });
        if (!aliveRef.current) return;
        setDraftId(body.draftId);
        setDraft(body.draft);
        return body;
    } catch (err) {
        if (aliveRef.current) setError(err.message);
        throw err;
    } finally {
        if (aliveRef.current) setLoading(false);
    }
}, [owner, repo, prNumber]);

const dismiss = useCallback(async (idx) => {
    if (isMockMode()) {
        setDraft((d) => d ? { ...d, lineComments: d.lineComments.filter((_, i) => i !== idx) } : d);
        return;
    }
    if (draftId == null) return;
    const body = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
        method: 'PATCH', body: JSON.stringify({ action: 'dismiss' }),
    });
    if (aliveRef.current) setDraft(body.draft);
}, [draftId]);

const edit = useCallback(async (idx, { body: newBody, suggestion }) => {
    if (isMockMode()) {
        setDraft((d) => {
            if (!d) return d;
            const next = [...d.lineComments];
            next[idx] = { ...next[idx], ...(typeof newBody === 'string' ? { body: newBody } : {}), ...(typeof suggestion === 'string' ? { suggestion } : {}) };
            return { ...d, lineComments: next };
        });
        return;
    }
    if (draftId == null) return;
    const body = await fetchJSON(`/api/ai/deep-review/${draftId}/comments/${idx}`, {
        method: 'PATCH', body: JSON.stringify({ action: 'edit', body: newBody, suggestion }),
    });
    if (aliveRef.current) setDraft(body.draft);
}, [draftId]);

const publish = useCallback(async (event = 'COMMENT') => {
    if (isMockMode()) return { draftId: 1, githubReviewId: 12345 };
    if (draftId == null) throw new Error('No draft to publish.');
    return fetchJSON(`/api/ai/deep-review/${draftId}/publish`, { method: 'POST', body: JSON.stringify({ event }) });
}, [draftId]);

const discard = useCallback(async () => {
    if (isMockMode()) { setDraftId(null); setDraft(null); return; }
    if (draftId == null) return;
    await fetchJSON(`/api/ai/deep-review/${draftId}`, { method: 'DELETE' });
    if (aliveRef.current) { setDraftId(null); setDraft(null); }
}, [draftId]);
```

- [ ] **Step 2: Add the fixture to `mockRepoDetail.js`**

In `src/__mocks__/mockRepoDetail.js`, append:

```js
export const mockDeepReviewDraft = {
    walkthrough: {
        summary: 'This PR adds OAuth token refresh logic to the auth module and updates the user session middleware to consume it.',
        perFileTable: [
            { path: 'server/auth/refresh.js', change: 'added', summary: 'New token refresh helper' },
            { path: 'server/middleware/session.js', change: 'modified', summary: 'Wires refresh into session validation' },
            { path: 'tests/auth/refresh.test.js', change: 'added', summary: 'Unit tests for the refresh helper' },
        ],
        mermaid: 'sequenceDiagram\n  Client->>Session: request\n  Session->>Refresh: maybe refresh\n  Refresh-->>Session: new token\n  Session-->>Client: ok',
        estimatedReviewTime: '12 min',
        riskLevel: 'medium',
    },
    lineComments: [
        { path: 'server/auth/refresh.js', side: 'RIGHT', line: 14, severity: 'warning', body: 'Refresh response is not validated — a malformed JSON body would crash here.', suggestion: 'const body = await res.json().catch(() => null);\nif (!body?.access_token) throw new Error("Invalid refresh response");' },
        { path: 'server/middleware/session.js', side: 'RIGHT', line: 27, severity: 'suggestion', body: 'Consider extracting the refresh check into a named function for readability.' },
        { path: 'tests/auth/refresh.test.js', side: 'RIGHT', line: 8, severity: 'info', body: 'Nice — covers both success and 401 paths.' },
    ],
    modelUsed: 'gemini-2.5-flash (mock)',
};
```

- [ ] **Step 3: Write the E2E smoke test**

Create `e2e/ai-deep-review.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.describe('AI Deep Review (mock mode)', () => {
    test('user can generate, dismiss a comment, and open the publish modal', async ({ page }) => {
        await page.goto('/?mock=1#/repo/acme/api/pulls/42');
        // Click into PR detail → Files tab → Deep Review entry point
        await page.getByRole('button', { name: /generate ai review/i }).click();
        // Walkthrough loads
        await expect(page.getByText(/oauth token refresh/i)).toBeVisible();
        // Switch to Comments tab
        await page.getByRole('button', { name: /comments \(\d+\)/i }).click();
        await expect(page.getByText(/refresh response is not validated/i)).toBeVisible();
        // Dismiss the first comment
        await page.locator('li button').filter({ hasText: '×' }).first().click();
        // Open publish modal
        await page.getByRole('button', { name: /publish to github/i }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByText(/walkthrough preview/i)).toBeVisible();
    });
});
```

- [ ] **Step 4: Run the E2E**

Run: `npx playwright test e2e/ai-deep-review.spec.js --reporter=list`
Expected: PASS. (You may need to adjust selectors to match the exact entry point in your nav — the goal is a smoke test, not pixel-perfect coverage.)

- [ ] **Step 5: Commit**

```bash
git add src/__mocks__/mockRepoDetail.js src/hooks/useAIDeepReview.js e2e/ai-deep-review.spec.js
git commit -m "feat(ai-deep-review): MOCK_MODE fixture + Playwright E2E smoke"
```

---

## Final Checks

- [ ] **Run the full unit suite**

Run: `npx vitest run --coverage`
Expected: All new tests pass; no existing test regressed; coverage on new files ≥ 80%.

- [ ] **Run the full E2E suite**

Run: `npx playwright test --reporter=list`
Expected: All tests pass.

- [ ] **Sanity-check bundle size**

Run: `npm run build`
Expected: build succeeds, bundle-budget gate (per [feedback_vite_inline_dce_guards.md](../../C:/Users/bruno/.claude/projects/s--Git-Hub-Repo-Manager/memory/feedback_vite_inline_dce_guards.md)) does not fail. The `mermaid` chunk should be lazy and not in the main bundle.

Run: `ls -lah dist/assets/*.js | sort -k5 -h | tail -10`
Expected: a separate `mermaid-*.js` chunk (~200kB), not bundled into `index-*.js`.

- [ ] **Manually exercise a real PR with BYOK**

With a real `GEMINI_API_KEY` configured in `user_ai_config` (or as `GEMINI_API_KEY` env var), open a real PR in the app, click Generate. Verify:
1. Walkthrough renders with real content
2. Mermaid diagram renders if the AI emitted one
3. Comments tab shows ≤ 25 items
4. Publishing posts a real review to GitHub.com under your account with the footer disclosure

- [ ] **Push branch and open a PR for review**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(ai-deep-review): slice 1a — free core" --body "Implements docs/specs/2026-05-03-ai-deep-review.md slice 1a. See spec for design rationale, success criteria, and out-of-scope items."
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Engine `pr-deep-review.js` with provider abstraction | 3 |
| `ai_pr_reviews` SQLite migration | 1 |
| BYOK via `createProviderForUser` | 6 (route layer) |
| `featureKey: 'PR_DEEP_REVIEW'` registered | 2 + 6 |
| Customizable system prompt via `AI_PROMPT_REGISTRY` | 2 |
| Walkthrough + per-file table + Mermaid + lineComments[] schema | 3 |
| Cap line comments at 25 with overflow into walkthrough | 3 |
| Suggestion fence-escape defence | 3 |
| Single batched GitHub `POST /reviews` payload | 4 |
| Suggestion blocks (` ```suggestion `) | 4 |
| "Generated by GitHub Repo Manager" footer | 4 |
| 5 routes — generate / get / patch / publish / delete | 6 |
| Free tier (no requireTier on publish path) | 6 |
| 3-column UI extension with tabbed AI panel | 11 |
| Mermaid lazy-loaded (~200kB out of main bundle) | 9, final checks |
| AIInlineComment overlay in DiffPanel | 8 + 11 |
| PublishReviewModal preview + event picker | 12 |
| MOCK_MODE fixture | 13 |
| E2E smoke covering generate → dismiss → publish modal | 13 |
| Force-push handling | **Deferred to slice 1a-2** (see Out-of-scope below) |
| Incremental review via `/compare` | **Deferred to slice 1a-2** |

### Deferred from slice 1a (intentional, ship in 1a-2 follow-up)

The original spec called for incremental review and force-push fallback in slice 1a. To keep the slice shippable in 7 days, both are pushed to a follow-up:

- **Incremental review:** when `last_reviewed_sha === prData.head.sha`, return cached draft without re-calling the LLM. (~1 day)
- **Force-push fallback:** wrap the `compare` call in try/catch, fall back to full review on 422. (~½ day)
- **Stale-head publish detection:** publish endpoint compares `state.headSha` to current PR head, returns 409 if different. (~½ day)

These are well-bounded follow-ups and a separate plan (`docs/plans/2026-05-XX-ai-deep-review-slice-1a-2.md`) will cover them after slice 1a ships and we have real-PR feedback on the engine.

### Slice 1b (premium Prompt Studio) — separate plan

The premium "Prompt Studio" (multi-preset library, per-repo prompts, style-guide ingestion, severity floors) is a separate ~5-day slice with its own implementation plan, written after slice 1a ships. The infrastructure is already in place via the `AI_PROMPT_REGISTRY` extension in Task 2 — free users can already customize the single `pr_deep_review` prompt through the existing Settings UI without any new code.
