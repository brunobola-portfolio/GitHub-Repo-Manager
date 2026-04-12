# Dev Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic CommitGeneratorModal with a unified, context-aware Dev Toolkit modal containing an enhanced Commit Generator, a PR Description Generator, and a Review quick-summary launcher.

**Architecture:** Tab-based modal (using existing `Modal` + `TabBar` components) with shared `useDevToolkit` hook for cross-tab state. Three new dedicated AI endpoints replace the generic `/ai/chat` usage. Existing compare/commits/contents/pulls endpoints are reused; three lightweight read-only endpoints are added (commit-style, pr-template, codeowners).

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Lucide icons, Express, Gemini AI (via existing `ai-service.js`)

**Spec:** `docs/specs/2026-04-12-dev-toolkit-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|----------------|
| `src/components/DevToolkit/DevToolkitModal.jsx` | Modal shell: tabs, context reading, shared state provider |
| `src/components/DevToolkit/shared/RepoSelector.jsx` | Searchable repo dropdown |
| `src/components/DevToolkit/shared/BranchSelector.jsx` | Branch dropdown with default-branch auto-detect |
| `src/components/DevToolkit/shared/DiffSummary.jsx` | Collapsible file-change summary panel |
| `src/components/DevToolkit/shared/OutputSection.jsx` | Terminal-style AI output with copy actions |
| `src/components/DevToolkit/shared/RefinementChips.jsx` | Refinement action pill group |
| `src/components/DevToolkit/shared/SectionCard.jsx` | Editable/copyable section wrapper for PR tab |
| `src/components/DevToolkit/CommitTab/CommitTab.jsx` | Commits tab — input modes, format selector, generation |
| `src/components/DevToolkit/CommitTab/FormatSelector.jsx` | Commit format pill group |
| `src/components/DevToolkit/CommitTab/MultiCommitSplit.jsx` | Multi-commit suggestion cards |
| `src/components/DevToolkit/CommitTab/SessionHistory.jsx` | Horizontal ribbon of recent generations |
| `src/components/DevToolkit/PRTab/PRTab.jsx` | Pull Request tab — sections, actions |
| `src/components/DevToolkit/PRTab/PRSections.jsx` | Generated PR sections (title, summary, test plan, etc.) |
| `src/components/DevToolkit/PRTab/LabelPills.jsx` | Label suggestion pills with add/remove |
| `src/components/DevToolkit/PRTab/ReviewerPills.jsx` | Reviewer suggestion pills with add/remove |
| `src/components/DevToolkit/PRTab/CreatePRConfirm.jsx` | Inline confirmation for Create/Update PR |
| `src/components/DevToolkit/ReviewTab/ReviewTab.jsx` | Review tab — PR selector, quick summary, actions |
| `src/components/DevToolkit/ReviewTab/PRSelector.jsx` | Open PR list for selection |
| `src/components/DevToolkit/ReviewTab/QuickSummary.jsx` | AI risk summary panel |
| `src/components/DevToolkit/ReviewTab/QuickActions.jsx` | Quick Approve/Comment actions |
| `src/hooks/useDevToolkit.js` | Shared state hook for Dev Toolkit |
| `server/lib/commit-style-detector.js` | Heuristic commit style analysis (pure function, no AI) |
| `server/__tests__/commit-style-detector.test.js` | Tests for commit style detection |
| `server/__tests__/ai-generate-commit.test.js` | Tests for generate-commit endpoint |
| `server/__tests__/ai-generate-pr.test.js` | Tests for generate-pr endpoint |
| `server/__tests__/ai-refine.test.js` | Tests for refine endpoint |
| `server/__tests__/repos-toolkit-endpoints.test.js` | Tests for commit-style, pr-template, codeowners endpoints |
| `tests/hooks/useDevToolkit.test.jsx` | Tests for useDevToolkit hook |

### Modified Files

| File | What Changes |
|------|-------------|
| `src/contexts/ModalContext.jsx:8` | Replace `'showCommitGen'` with `'showDevToolkit'` in `MODAL_NAMES` |
| `src/App.jsx:45,621,931-937` | Replace `CommitGeneratorModal` import/usage with `DevToolkitModal`; update modal key references |
| `src/components/Header.jsx:132` | Update `onOpenCommitGen` to `onOpenDevToolkit` |
| `src/components/RepoList.jsx:529-531` | Update `aiCommit` case to use `showDevToolkit` |
| `src/hooks/useKeyboardShortcuts.js:3-11` | Add `g` shortcut for Dev Toolkit |
| `src/components/RepoDetail/PRDetailPanel.jsx:221-230` | Add "Generate Description" button next to existing Review button |
| `server/routes/ai.js` | Add 3 new endpoints: `generate-commit`, `generate-pr`, `refine` |
| `server/routes/repos.js` | Add 3 new endpoints: `commits/style`, `pr-template`, `codeowners` |

### Deleted Files

| File | Reason |
|------|--------|
| `src/components/CommitGeneratorModal.jsx` | Replaced by `DevToolkitModal.jsx` |

---

## Task 1: Commit Style Detector (backend utility)

**Files:**
- Create: `server/lib/commit-style-detector.js`
- Test: `server/__tests__/commit-style-detector.test.js`

This is a pure function with no dependencies — ideal starting point.

- [ ] **Step 1: Write failing tests for style detection**

```javascript
// server/__tests__/commit-style-detector.test.js
import { describe, it, expect } from 'vitest'
import { detectCommitStyle } from '../lib/commit-style-detector.js'

describe('detectCommitStyle', () => {
    it('detects conventional commits', () => {
        const messages = [
            'feat(auth): add login endpoint',
            'fix(api): handle 404 errors',
            'chore: update dependencies',
            'refactor(db): extract query builder',
            'feat: add user registration',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('conventional')
        expect(result.pattern).toBe('type(scope): description')
        expect(result.confidence).toBeGreaterThan(0.6)
        expect(result.prefixes).toHaveProperty('feat')
    })

    it('detects gitmoji style', () => {
        const messages = [
            ':sparkles: add new feature',
            ':bug: fix login bug',
            ':recycle: refactor auth module',
            ':memo: update readme',
            ':art: improve code style',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('gitmoji')
        expect(result.confidence).toBeGreaterThan(0.6)
    })

    it('detects JIRA prefix style', () => {
        const messages = [
            'PROJ-123 fix login issue',
            'PROJ-456 add user registration',
            'PROJ-789 update dependencies',
            'PROJ-101 refactor auth',
            'PROJ-202 add tests',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('jira-prefix')
        expect(result.pattern).toContain('PROJ-')
    })

    it('returns descriptive for unrecognized patterns', () => {
        const messages = [
            'Added login functionality',
            'Fixed the bug in auth',
            'Updated the readme file',
            'Removed old code',
            'Changed the config',
        ]
        const result = detectCommitStyle(messages)
        expect(result.detected_style).toBe('descriptive')
        expect(result.confidence).toBeLessThan(0.5)
    })

    it('handles empty array', () => {
        const result = detectCommitStyle([])
        expect(result.detected_style).toBe('descriptive')
        expect(result.confidence).toBe(0)
        expect(result.examples).toEqual([])
    })

    it('returns top 3 examples', () => {
        const messages = Array.from({ length: 20 }, (_, i) => `feat: change ${i}`)
        const result = detectCommitStyle(messages)
        expect(result.examples).toHaveLength(3)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/commit-style-detector.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement commit style detector**

```javascript
// server/lib/commit-style-detector.js

const CONVENTIONAL_RE = /^(feat|fix|chore|refactor|docs|style|perf|test|build|ci|revert)(\(.+?\))?!?:\s/
const GITMOJI_RE = /^:[a-z_]+?:\s/
const JIRA_RE = /^[A-Z]{2,10}-\d+\s/

export function detectCommitStyle(messages) {
    if (!messages || messages.length === 0) {
        return { detected_style: 'descriptive', pattern: '', examples: [], confidence: 0, prefixes: {} }
    }

    let conventionalCount = 0
    let gitmojiCount = 0
    let jiraCount = 0
    const prefixes = {}
    let jiraProject = ''

    for (const msg of messages) {
        const line = msg.split('\n')[0].trim()

        if (CONVENTIONAL_RE.test(line)) {
            conventionalCount++
            const match = line.match(/^(\w+)/)
            if (match) prefixes[match[1]] = (prefixes[match[1]] || 0) + 1
        }

        if (GITMOJI_RE.test(line)) {
            gitmojiCount++
        }

        const jiraMatch = line.match(JIRA_RE)
        if (jiraMatch) {
            jiraCount++
            if (!jiraProject) {
                const projMatch = jiraMatch[0].match(/^([A-Z]{2,10})-/)
                if (projMatch) jiraProject = projMatch[1]
            }
        }
    }

    const total = messages.length
    const scores = [
        { style: 'conventional', count: conventionalCount },
        { style: 'gitmoji', count: gitmojiCount },
        { style: 'jira-prefix', count: jiraCount },
    ]

    scores.sort((a, b) => b.count - a.count)
    const best = scores[0]
    const confidence = best.count / total

    if (confidence < 0.4) {
        return {
            detected_style: 'descriptive',
            pattern: 'free-form',
            examples: messages.slice(0, 3),
            confidence: Math.round(confidence * 100) / 100,
            prefixes,
        }
    }

    const patterns = {
        conventional: 'type(scope): description',
        gitmoji: ':emoji: description',
        'jira-prefix': `${jiraProject || 'PROJ'}-NNN description`,
    }

    return {
        detected_style: best.style,
        pattern: patterns[best.style],
        examples: messages.filter(m => {
            const line = m.split('\n')[0].trim()
            if (best.style === 'conventional') return CONVENTIONAL_RE.test(line)
            if (best.style === 'gitmoji') return GITMOJI_RE.test(line)
            if (best.style === 'jira-prefix') return JIRA_RE.test(line)
            return true
        }).slice(0, 3),
        confidence: Math.round(confidence * 100) / 100,
        prefixes,
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/commit-style-detector.test.js`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/commit-style-detector.js server/__tests__/commit-style-detector.test.js
git commit -m "feat(toolkit): add heuristic commit style detector"
```

---

## Task 2: Backend — New Repo Endpoints (commit-style, pr-template, codeowners)

**Files:**
- Modify: `server/routes/repos.js:1135` (after compare endpoint)
- Test: `server/__tests__/repos-toolkit-endpoints.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
// server/__tests__/repos-toolkit-endpoints.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mockGithubApi = vi.fn()
vi.mock('../lib/github-api.js', () => ({
    githubApi: (...args) => mockGithubApi(...args),
}))

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    },
    isValidGitHubUsername: () => true,
    safeError: (err, fallback) => err?.message || fallback,
    errorResponse: vi.fn(),
    createRequireAI: () => (_req, _res, next) => next(),
}))
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

let app
beforeEach(async () => {
    vi.clearAllMocks()
    const { default: router } = await import('../routes/repos.js')
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/repos', router)
})

describe('GET /repos/:owner/:repo/commits/style', () => {
    it('returns detected style from commit messages', async () => {
        mockGithubApi.mockResolvedValueOnce({
            data: [
                { commit: { message: 'feat(auth): add login' } },
                { commit: { message: 'fix(api): handle 404' } },
                { commit: { message: 'chore: update deps' } },
            ],
        })
        const res = await request(app).get('/repos/owner/repo/commits/style')
        expect(res.status).toBe(200)
        expect(res.body.detected_style).toBe('conventional')
        expect(res.body).toHaveProperty('pattern')
        expect(res.body).toHaveProperty('confidence')
        expect(res.body).toHaveProperty('examples')
        expect(res.body).toHaveProperty('prefixes')
    })
})

describe('GET /repos/:owner/:repo/pr-template', () => {
    it('returns template when found', async () => {
        mockGithubApi.mockResolvedValueOnce({
            data: { content: btoa('## Summary\n\n## Test Plan\n'), path: '.github/PULL_REQUEST_TEMPLATE.md' },
        })
        const res = await request(app).get('/repos/owner/repo/pr-template')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(true)
        expect(res.body.template).toContain('## Summary')
    })

    it('returns found: false when not found', async () => {
        mockGithubApi.mockRejectedValueOnce({ status: 404, message: 'Not Found' })
        const res = await request(app).get('/repos/owner/repo/pr-template')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(false)
        expect(res.body.template).toBe(null)
    })
})

describe('GET /repos/:owner/:repo/codeowners', () => {
    it('returns parsed rules when found', async () => {
        const content = btoa('# Codeowners\nsrc/components/* @alice @bob\nserver/* @charlie\n')
        mockGithubApi.mockResolvedValueOnce({ data: { content } })
        const res = await request(app).get('/repos/owner/repo/codeowners')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(true)
        expect(res.body.rules).toHaveLength(2)
        expect(res.body.rules[0]).toEqual({ pattern: 'src/components/*', owners: ['@alice', '@bob'] })
    })

    it('returns found: false when not found', async () => {
        mockGithubApi.mockRejectedValueOnce({ status: 404, message: 'Not Found' })
        const res = await request(app).get('/repos/owner/repo/codeowners')
        expect(res.status).toBe(200)
        expect(res.body.found).toBe(false)
        expect(res.body.rules).toEqual([])
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/repos-toolkit-endpoints.test.js`
Expected: FAIL — 404 on all three routes (not yet defined)

- [ ] **Step 3: Add the three endpoints to repos.js**

Add after line 1135 in `server/routes/repos.js` (after the compare endpoint's closing `});`):

```javascript
// ------------------------------------------------------------------
// Dev Toolkit Endpoints
// ------------------------------------------------------------------

// Detect commit message style (heuristic, no AI)
router.get('/:owner/:repo/commits/style', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/commits?per_page=20`,
            req.session.accessToken
        );
        const messages = data.map(c => c.commit?.message).filter(Boolean);

        // Dynamic import to keep the pure function in its own module
        const { detectCommitStyle } = await import('../lib/commit-style-detector.js');
        const result = detectCommitStyle(messages);
        res.json(result);
    } catch (error) {
        req.log.error({ err: error }, 'Detect commit style failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Fetch PR template
router.get('/:owner/:repo/pr-template', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        // GitHub API: contents endpoint for .github/PULL_REQUEST_TEMPLATE.md
        const { data } = await githubApi(
            `/repos/${owner}/${repo}/contents/.github/PULL_REQUEST_TEMPLATE.md`,
            req.session.accessToken
        );
        const template = Buffer.from(data.content, 'base64').toString('utf-8');
        res.json({ found: true, template, path: data.path });
    } catch (error) {
        if (error.status === 404) {
            return res.json({ found: false, template: null, path: null });
        }
        req.log.error({ err: error }, 'Fetch PR template failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});

// Parse CODEOWNERS
router.get('/:owner/:repo/codeowners', requireAuth, async (req, res) => {
    try {
        const { owner, repo } = req.params;
        // Try .github/CODEOWNERS first, then root CODEOWNERS
        let data;
        try {
            ({ data } = await githubApi(
                `/repos/${owner}/${repo}/contents/.github/CODEOWNERS`,
                req.session.accessToken
            ));
        } catch (err) {
            if (err.status === 404) {
                ({ data } = await githubApi(
                    `/repos/${owner}/${repo}/contents/CODEOWNERS`,
                    req.session.accessToken
                ));
            } else {
                throw err;
            }
        }
        const raw = Buffer.from(data.content, 'base64').toString('utf-8');
        const rules = raw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
                const parts = line.split(/\s+/);
                return { pattern: parts[0], owners: parts.slice(1) };
            });
        res.json({ found: true, rules });
    } catch (error) {
        if (error.status === 404) {
            return res.json({ found: false, rules: [] });
        }
        req.log.error({ err: error }, 'Parse CODEOWNERS failed');
        res.status(error.status || 500).json({ error: safeError(error, 'Request failed') });
    }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/repos-toolkit-endpoints.test.js`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/repos.js server/__tests__/repos-toolkit-endpoints.test.js
git commit -m "feat(toolkit): add commit-style, pr-template, codeowners endpoints"
```

---

## Task 3: Backend — AI Generate Commit Endpoint

**Files:**
- Modify: `server/routes/ai.js` (add after line 575, before batch-index)
- Test: `server/__tests__/ai-generate-commit.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/__tests__/ai-generate-commit.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))

const mockCheckUsageLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 10 })
const mockIncrementUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...args) => mockCheckUsageLimit(...args),
    incrementUsage: (...args) => mockIncrementUsage(...args),
}))

vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: vi.fn(),
    getTierOrder: (tier) => ({ free: 0, pro: 1, enterprise: 2 }[tier] ?? 0),
    canAccess: vi.fn(() => true),
}))

vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

const mockSendMessage = vi.fn()
vi.mock('../ai-service.js', () => ({
    aiService: {
        model: {
            startChat: () => ({
                sendMessage: mockSendMessage,
            }),
        },
    },
    sanitizeForPrompt: (text, maxLen) => text?.substring(0, maxLen || 8000) ?? '',
}))

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    },
    createRequireAI: () => (_req, _res, next) => next(),
    safeError: (err, fallback) => err?.message || fallback,
}))

vi.mock('../db.js', () => ({ default: { prepare: () => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }) } }))
vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/utils.js', () => ({ safeJsonParse: (s) => JSON.parse(s) }))

let app
beforeEach(async () => {
    vi.clearAllMocks()
    const { default: router } = await import('../routes/ai.js')
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/', router)
})

describe('POST /ai/generate-commit', () => {
    it('returns structured commit message', async () => {
        mockSendMessage.mockResolvedValueOnce({
            response: {
                text: () => JSON.stringify({
                    subject: 'feat(auth): add JWT login',
                    body: '- Add login endpoint\n- Add bcrypt hashing',
                }),
            },
        })
        const res = await request(app)
            .post('/ai/generate-commit')
            .send({ diff: 'some diff content', format: 'conventional' })
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('subject')
        expect(res.body).toHaveProperty('body')
        expect(res.body).toHaveProperty('message')
        expect(res.body).toHaveProperty('format_used', 'conventional')
    })

    it('returns 400 when diff is missing', async () => {
        const res = await request(app)
            .post('/ai/generate-commit')
            .send({ format: 'conventional' })
        expect(res.status).toBe(400)
    })

    it('increments usage on success', async () => {
        mockSendMessage.mockResolvedValueOnce({
            response: {
                text: () => JSON.stringify({ subject: 'fix: thing', body: '' }),
            },
        })
        await request(app)
            .post('/ai/generate-commit')
            .send({ diff: 'diff', format: 'conventional' })
        expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries')
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/ai-generate-commit.test.js`
Expected: FAIL — 404 on `/ai/generate-commit`

- [ ] **Step 3: Add generate-commit endpoint to ai.js**

Add before the batch-index endpoint (before line 578 in `server/routes/ai.js`):

```javascript
// ------------------------------------------------------------------
// Dev Toolkit — Generate Commit Message
// ------------------------------------------------------------------

router.post('/ai/generate-commit', requireAuth, requireAI, async (req, res) => {
    try {
        const { diff, format = 'conventional', repo_style, repo_context } = req.body;

        if (!diff || typeof diff !== 'string' || diff.trim().length === 0) {
            return res.status(400).json({ error: 'diff is required' });
        }

        const userId = req.session.userId;
        const limit = await checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `AI query limit reached. Resets ${limit.resetDate || 'next month'}.`,
                remaining: 0,
            });
        }

        const formatInstructions = {
            conventional: 'Use Conventional Commits format: type(scope): description. Types: feat, fix, chore, refactor, docs, style, perf, test, build, ci, revert.',
            gitmoji: 'Use Gitmoji format: :emoji: description. Use standard gitmoji codes like :sparkles:, :bug:, :recycle:, :memo:, :art:, etc.',
            descriptive: 'Use a clear, descriptive sentence in imperative mood. Example: "Add user login functionality with JWT tokens".',
            'repo-convention': repo_style
                ? `Mimic this repository's commit style. Detected pattern: "${repo_style.pattern}". Examples from repo: ${(repo_style.examples || []).join('; ')}.`
                : 'Use Conventional Commits format as fallback.',
        };

        const safeDiff = sanitizeForPrompt(diff, 12000);
        const contextLine = repo_context?.name
            ? `Repository: ${repo_context.name}${repo_context.description ? ` — ${repo_context.description}` : ''}\n`
            : '';

        const systemPrompt = `You are a commit message generator. ${formatInstructions[format] || formatInstructions.conventional}

${contextLine}Respond with ONLY valid JSON in this exact shape:
{"subject": "the commit subject line", "body": "optional multi-line body or empty string"}

Rules:
- subject must be under 72 characters
- body uses bullet points with "- " prefix if present
- No markdown fences, no explanation, ONLY the JSON object`;

        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: '{"subject": "", "body": ""}' }] }] });
        const result = await chat.sendMessage(`Generate a commit message for this diff:\n\n${safeDiff}`);
        const raw = result.response.text().trim();

        let parsed;
        try {
            // Strip markdown fences if AI included them
            const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            parsed = JSON.parse(cleaned);
        } catch {
            // Fallback: treat entire response as subject
            parsed = { subject: raw.split('\n')[0], body: '' };
        }

        const message = parsed.body
            ? `${parsed.subject}\n\n${parsed.body}`
            : parsed.subject;

        await incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_generate_commit', 'ai', { format, diff_length: diff.length });

        res.json({
            message,
            subject: parsed.subject,
            body: parsed.body || '',
            format_used: format,
        });
    } catch (error) {
        req.log.error({ err: error }, 'Generate commit message failed');
        res.status(500).json({ error: safeError(error, 'Failed to generate commit message') });
    }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/ai-generate-commit.test.js`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/ai.js server/__tests__/ai-generate-commit.test.js
git commit -m "feat(toolkit): add /ai/generate-commit endpoint"
```

---

## Task 4: Backend — AI Generate PR & Refine Endpoints

**Files:**
- Modify: `server/routes/ai.js` (add after generate-commit endpoint)
- Test: `server/__tests__/ai-generate-pr.test.js`
- Test: `server/__tests__/ai-refine.test.js`

- [ ] **Step 1: Write failing tests for generate-pr**

```javascript
// server/__tests__/ai-generate-pr.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
const mockCheckUsageLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 10 })
const mockIncrementUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...args) => mockCheckUsageLimit(...args),
    incrementUsage: (...args) => mockIncrementUsage(...args),
}))
vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: vi.fn(),
    getTierOrder: (tier) => ({ free: 0, pro: 1, enterprise: 2 }[tier] ?? 0),
    canAccess: vi.fn(() => true),
}))
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))

const mockSendMessage = vi.fn()
vi.mock('../ai-service.js', () => ({
    aiService: {
        model: {
            startChat: () => ({ sendMessage: mockSendMessage }),
        },
    },
    sanitizeForPrompt: (text, maxLen) => text?.substring(0, maxLen || 8000) ?? '',
}))
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    },
    createRequireAI: () => (_req, _res, next) => next(),
    safeError: (err, fallback) => err?.message || fallback,
}))
vi.mock('../db.js', () => ({ default: { prepare: () => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }) } }))
vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/utils.js', () => ({ safeJsonParse: (s) => JSON.parse(s) }))

let app
beforeEach(async () => {
    vi.clearAllMocks()
    const { default: router } = await import('../routes/ai.js')
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/', router)
})

describe('POST /ai/generate-pr', () => {
    it('returns structured PR description', async () => {
        mockSendMessage.mockResolvedValueOnce({
            response: {
                text: () => JSON.stringify({
                    title: 'feat(auth): add JWT authentication',
                    summary: '## Summary\n- Add JWT login',
                    test_plan: '## Test plan\n- [ ] Login works',
                    breaking_changes: null,
                    related_issues: [{ number: 42, relation: 'closes' }],
                    suggested_labels: ['feature'],
                    suggested_reviewers: ['alice'],
                }),
            },
        })
        const res = await request(app)
            .post('/ai/generate-pr')
            .send({
                commits: [{ sha: 'abc', message: 'feat: add login' }],
                diff_summary: { files: [], additions: 100, deletions: 20 },
                top_patches: 'diff content',
            })
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('title')
        expect(res.body).toHaveProperty('summary')
        expect(res.body).toHaveProperty('test_plan')
        expect(res.body).toHaveProperty('related_issues')
        expect(res.body).toHaveProperty('suggested_labels')
    })

    it('returns 400 when commits are missing', async () => {
        const res = await request(app)
            .post('/ai/generate-pr')
            .send({ diff_summary: {} })
        expect(res.status).toBe(400)
    })
})
```

- [ ] **Step 2: Write failing tests for refine**

```javascript
// server/__tests__/ai-refine.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../lib/audit.js', () => ({ auditLog: vi.fn() }))
const mockCheckUsageLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 10 })
const mockIncrementUsage = vi.fn()
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: (...args) => mockCheckUsageLimit(...args),
    incrementUsage: (...args) => mockIncrementUsage(...args),
}))
vi.mock('../lib/feature-flags.js', () => ({
    getFeatures: vi.fn(),
    getTierOrder: (tier) => ({ free: 0, pro: 1, enterprise: 2 }[tier] ?? 0),
    canAccess: vi.fn(() => true),
}))
vi.mock('../middleware/require-tier.js', () => ({
    requireTier: () => (_req, _res, next) => next(),
    getUserTier: vi.fn(() => 'free'),
    attachTier: (_req, _res, next) => next(),
}))
const mockSendMessage = vi.fn()
vi.mock('../ai-service.js', () => ({
    aiService: {
        model: {
            startChat: () => ({ sendMessage: mockSendMessage }),
        },
    },
    sanitizeForPrompt: (text, maxLen) => text?.substring(0, maxLen || 8000) ?? '',
}))
vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    },
    createRequireAI: () => (_req, _res, next) => next(),
    safeError: (err, fallback) => err?.message || fallback,
}))
vi.mock('../db.js', () => ({ default: { prepare: () => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }) } }))
vi.mock('../lib/github-api.js', () => ({ githubApi: vi.fn() }))
vi.mock('../lib/utils.js', () => ({ safeJsonParse: (s) => JSON.parse(s) }))

let app
beforeEach(async () => {
    vi.clearAllMocks()
    const { default: router } = await import('../routes/ai.js')
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
        req.session = { accessToken: 'test-token', userId: 1 }
        req.log = { error: vi.fn(), info: vi.fn() }
        next()
    })
    app.use('/', router)
})

describe('POST /ai/refine', () => {
    it('returns refined content', async () => {
        mockSendMessage.mockResolvedValueOnce({
            response: { text: () => 'feat(auth): add login' },
        })
        const res = await request(app)
            .post('/ai/refine')
            .send({
                original_content: 'feat(auth): add JWT login with bcrypt hashing and email validation',
                instruction: 'shorter',
                content_type: 'commit',
            })
        expect(res.status).toBe(200)
        expect(res.body).toHaveProperty('refined_content')
    })

    it('returns 400 when content is missing', async () => {
        const res = await request(app)
            .post('/ai/refine')
            .send({ instruction: 'shorter' })
        expect(res.status).toBe(400)
    })
})
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run server/__tests__/ai-generate-pr.test.js server/__tests__/ai-refine.test.js`
Expected: FAIL — 404 on both endpoints

- [ ] **Step 4: Add generate-pr endpoint to ai.js**

Add after the generate-commit endpoint:

```javascript
// ------------------------------------------------------------------
// Dev Toolkit — Generate PR Description
// ------------------------------------------------------------------

router.post('/ai/generate-pr', requireAuth, requireAI, async (req, res) => {
    try {
        const { commits, diff_summary, top_patches, template, repo_context } = req.body;

        if (!commits || !Array.isArray(commits) || commits.length === 0) {
            return res.status(400).json({ error: 'commits array is required' });
        }

        const userId = req.session.userId;
        const limit = await checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `AI query limit reached. Resets ${limit.resetDate || 'next month'}.`,
                remaining: 0,
            });
        }

        const commitList = commits.map(c => `- ${c.message}`).join('\n');
        const filesInfo = diff_summary?.files
            ? diff_summary.files.map(f => `${f.filename} (+${f.additions} -${f.deletions})`).join('\n')
            : '';
        const safePatches = sanitizeForPrompt(top_patches || '', 15000);
        const templateInstruction = template
            ? `\nUse this PR template as the structure for the summary:\n${template}\n`
            : '';
        const repoLine = repo_context?.name ? `Repository: ${repo_context.name}\n` : '';

        const systemPrompt = `You are a PR description generator. ${repoLine}${templateInstruction}

Respond with ONLY valid JSON in this exact shape:
{
  "title": "short PR title under 70 chars",
  "summary": "## Summary\\nmarkdown bullet points",
  "test_plan": "## Test plan\\n- [ ] checklist items",
  "breaking_changes": null or "## Breaking Changes\\n...",
  "related_issues": [{"number": 123, "relation": "closes|fixes|relates"}],
  "suggested_labels": ["label1", "label2"],
  "suggested_reviewers": ["username1"]
}

Rules:
- Extract issue references from commit messages (#NNN, fixes #NNN, closes #NNN)
- Suggest labels based on file paths and commit types
- Suggest reviewers is best-effort, return empty array if unsure
- breaking_changes should be null if none detected
- No markdown fences in the response, ONLY the JSON object`;

        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: '{}' }] }] });
        const result = await chat.sendMessage(
            `Generate a PR description.\n\nCommits:\n${commitList}\n\nFiles changed:\n${filesInfo}\n\nPatches:\n${safePatches}`
        );
        const raw = result.response.text().trim();

        let parsed;
        try {
            const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            parsed = JSON.parse(cleaned);
        } catch {
            parsed = {
                title: commits[0]?.message?.split('\n')[0] || 'Update',
                summary: raw,
                test_plan: '',
                breaking_changes: null,
                related_issues: [],
                suggested_labels: [],
                suggested_reviewers: [],
            };
        }

        await incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_generate_pr', 'ai', { commit_count: commits.length });

        res.json({
            title: parsed.title || '',
            summary: parsed.summary || '',
            test_plan: parsed.test_plan || '',
            breaking_changes: parsed.breaking_changes || null,
            related_issues: parsed.related_issues || [],
            suggested_labels: parsed.suggested_labels || [],
            suggested_reviewers: parsed.suggested_reviewers || [],
        });
    } catch (error) {
        req.log.error({ err: error }, 'Generate PR description failed');
        res.status(500).json({ error: safeError(error, 'Failed to generate PR description') });
    }
});
```

- [ ] **Step 5: Add refine endpoint to ai.js**

Add after the generate-pr endpoint:

```javascript
// ------------------------------------------------------------------
// Dev Toolkit — Refine Content
// ------------------------------------------------------------------

router.post('/ai/refine', requireAuth, requireAI, async (req, res) => {
    try {
        const { original_content, original_diff, instruction, content_type } = req.body;

        if (!original_content || typeof original_content !== 'string') {
            return res.status(400).json({ error: 'original_content is required' });
        }
        if (!instruction || typeof instruction !== 'string') {
            return res.status(400).json({ error: 'instruction is required' });
        }

        const userId = req.session.userId;
        const limit = await checkUsageLimit(userId, 'ai_queries');
        if (!limit.allowed) {
            return res.status(429).json({
                error: 'usage_limit_exceeded',
                message: `AI query limit reached. Resets ${limit.resetDate || 'next month'}.`,
                remaining: 0,
            });
        }

        const refinementInstructions = {
            shorter: 'Make this shorter and more concise. Remove the body if present, keep only the subject line.',
            more_detail: 'Add more detail. Include a multi-line body with bullet points explaining the changes.',
            add_body: 'Keep the subject line as-is but add an explanatory body paragraph below it.',
            breaking_change: 'Add a BREAKING CHANGE: footer explaining what breaks and how to migrate.',
            more_cases: 'Add more test cases to cover additional scenarios.',
            edge_cases: 'Add edge case test scenarios (empty inputs, boundary values, error conditions).',
            e2e_focus: 'Rewrite the test plan focusing on end-to-end user workflows.',
            architecture_notes: 'Add a section about the architectural decisions and technical approach.',
        };

        const instructionText = refinementInstructions[instruction] || instruction;
        const safeDiff = original_diff ? sanitizeForPrompt(original_diff, 8000) : '';
        const diffContext = safeDiff ? `\n\nOriginal diff for context:\n${safeDiff}` : '';

        const systemPrompt = `You are refining ${content_type || 'content'}. Apply the requested change to the content below.
Return ONLY the refined content, no explanation, no markdown fences.`;

        const model = aiService.model;
        const chat = model.startChat({ history: [{ role: 'user', parts: [{ text: systemPrompt }] }, { role: 'model', parts: [{ text: 'Ready.' }] }] });
        const result = await chat.sendMessage(
            `Refinement instruction: ${instructionText}\n\nOriginal content:\n${original_content}${diffContext}`
        );
        const refined = result.response.text().trim();

        await incrementUsage(userId, 'ai_queries');
        auditLog(req, 'ai_refine', 'ai', { instruction, content_type });

        res.json({ refined_content: refined });
    } catch (error) {
        req.log.error({ err: error }, 'Refine content failed');
        res.status(500).json({ error: safeError(error, 'Failed to refine content') });
    }
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/ai-generate-pr.test.js server/__tests__/ai-refine.test.js`
Expected: all 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/routes/ai.js server/__tests__/ai-generate-pr.test.js server/__tests__/ai-refine.test.js
git commit -m "feat(toolkit): add /ai/generate-pr and /ai/refine endpoints"
```

---

## Task 5: ModalContext Update + useDevToolkit Hook

**Files:**
- Modify: `src/contexts/ModalContext.jsx:8`
- Create: `src/hooks/useDevToolkit.js`
- Test: `tests/hooks/useDevToolkit.test.jsx`

- [ ] **Step 1: Update ModalContext — replace showCommitGen with showDevToolkit**

In `src/contexts/ModalContext.jsx`, change line 8:

```javascript
// Before:
  'showCommitGen',
// After:
  'showDevToolkit',
```

- [ ] **Step 2: Write failing test for useDevToolkit**

```jsx
// tests/hooks/useDevToolkit.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDevToolkit } from '../../src/hooks/useDevToolkit'

// Mock fetch globally
global.fetch = vi.fn()

beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
})

describe('useDevToolkit', () => {
    it('initializes with default state', () => {
        const { result } = renderHook(() => useDevToolkit({ repos: [] }))
        expect(result.current.activeTab).toBe('commits')
        expect(result.current.selectedRepo).toBe(null)
        expect(result.current.headBranch).toBe(null)
        expect(result.current.baseBranch).toBe(null)
        expect(result.current.compareData).toBe(null)
        expect(result.current.history).toEqual([])
    })

    it('applies initial context', () => {
        const repo = { full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } }
        const { result } = renderHook(() => useDevToolkit({
            repos: [repo],
            initialTab: 'pr',
            initialRepo: repo,
        }))
        expect(result.current.activeTab).toBe('pr')
        expect(result.current.selectedRepo).toEqual(repo)
    })

    it('persists activeTab to sessionStorage', () => {
        const { result } = renderHook(() => useDevToolkit({ repos: [] }))
        act(() => result.current.setActiveTab('review'))
        expect(result.current.activeTab).toBe('review')
        expect(sessionStorage.getItem('devToolkit_activeTab')).toBe('review')
    })

    it('adds to history', () => {
        const { result } = renderHook(() => useDevToolkit({ repos: [] }))
        act(() => result.current.addToHistory('feat: add login'))
        act(() => result.current.addToHistory('fix: handle errors'))
        expect(result.current.history).toHaveLength(2)
        expect(result.current.history[0]).toBe('fix: handle errors')
    })

    it('limits history to 5 items', () => {
        const { result } = renderHook(() => useDevToolkit({ repos: [] }))
        for (let i = 0; i < 7; i++) {
            act(() => result.current.addToHistory(`commit ${i}`))
        }
        expect(result.current.history).toHaveLength(5)
    })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useDevToolkit.test.jsx`
Expected: FAIL — module not found

- [ ] **Step 4: Implement useDevToolkit hook**

```javascript
// src/hooks/useDevToolkit.js
import { useState, useCallback, useRef } from 'react'

const TAB_STORAGE_KEY = 'devToolkit_activeTab'
const MAX_HISTORY = 5

export function useDevToolkit({ repos = [], initialTab, initialRepo, initialBranch, initialPR } = {}) {
    const [activeTab, setActiveTabState] = useState(() => {
        if (initialTab) return initialTab
        try { return sessionStorage.getItem(TAB_STORAGE_KEY) || 'commits' } catch { return 'commits' }
    })
    const [selectedRepo, setSelectedRepo] = useState(initialRepo || null)
    const [headBranch, setHeadBranch] = useState(initialBranch || null)
    const [baseBranch, setBaseBranch] = useState(null)
    const [branches, setBranches] = useState([])
    const [compareData, setCompareData] = useState(null)
    const [compareLoading, setCompareLoading] = useState(false)
    const [prContext, setPrContext] = useState(initialPR || null)
    const [history, setHistory] = useState([])
    const abortRef = useRef(null)

    const setActiveTab = useCallback((tab) => {
        setActiveTabState(tab)
        try { sessionStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* noop */ }
    }, [])

    const fetchBranches = useCallback(async (owner, repo) => {
        try {
            const res = await fetch(`/api/repos/${owner}/${repo}/branches?per_page=100`)
            if (!res.ok) return
            const data = await res.json()
            setBranches(data)
            // Auto-detect default branch
            const defaultBranch = data.find(b => b.name === 'main') || data.find(b => b.name === 'master') || data[0]
            if (defaultBranch && !baseBranch) {
                setBaseBranch(defaultBranch.name)
            }
        } catch { /* noop */ }
    }, [baseBranch])

    const fetchCompare = useCallback(async (owner, repo, base, head) => {
        if (!base || !head || base === head) {
            setCompareData(null)
            return
        }
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setCompareLoading(true)
        try {
            const res = await fetch(`/api/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, { signal: ctrl.signal })
            if (!res.ok) throw new Error('Compare failed')
            const data = await res.json()
            setCompareData({
                ahead_by: data.ahead_by,
                behind_by: data.behind_by,
                total_commits: data.total_commits,
                commits: (data.commits || []).map(c => ({ sha: c.sha, message: c.commit?.message || '' })),
                files: (data.files || []).map(f => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch || '',
                })),
                diff_summary: {
                    files_changed: (data.files || []).length,
                    additions: (data.files || []).reduce((s, f) => s + (f.additions || 0), 0),
                    deletions: (data.files || []).reduce((s, f) => s + (f.deletions || 0), 0),
                },
            })
        } catch (err) {
            if (err.name !== 'AbortError') setCompareData(null)
        } finally {
            setCompareLoading(false)
        }
    }, [])

    const selectRepo = useCallback((repo) => {
        setSelectedRepo(repo)
        setHeadBranch(null)
        setBaseBranch(null)
        setBranches([])
        setCompareData(null)
        if (repo) {
            fetchBranches(repo.owner?.login || repo.full_name?.split('/')[0], repo.name)
        }
    }, [fetchBranches])

    const addToHistory = useCallback((message) => {
        setHistory(prev => [message, ...prev.filter(m => m !== message)].slice(0, MAX_HISTORY))
    }, [])

    return {
        // Tab state
        activeTab,
        setActiveTab,

        // Repo/branch state (shared across tabs)
        repos,
        selectedRepo,
        selectRepo,
        headBranch,
        setHeadBranch,
        baseBranch,
        setBaseBranch,
        branches,

        // Compare data
        compareData,
        compareLoading,
        fetchCompare,

        // PR context
        prContext,
        setPrContext,

        // Session history
        history,
        addToHistory,
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useDevToolkit.test.jsx`
Expected: all 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/contexts/ModalContext.jsx src/hooks/useDevToolkit.js tests/hooks/useDevToolkit.test.jsx
git commit -m "feat(toolkit): add useDevToolkit hook, register showDevToolkit modal"
```

---

## Task 6: Shared UI Components

**Files:**
- Create: `src/components/DevToolkit/shared/RepoSelector.jsx`
- Create: `src/components/DevToolkit/shared/BranchSelector.jsx`
- Create: `src/components/DevToolkit/shared/DiffSummary.jsx`
- Create: `src/components/DevToolkit/shared/OutputSection.jsx`
- Create: `src/components/DevToolkit/shared/RefinementChips.jsx`
- Create: `src/components/DevToolkit/shared/SectionCard.jsx`

These are presentational components. Testing will happen through the parent tab components and E2E tests.

- [ ] **Step 1: Create RepoSelector**

```jsx
// src/components/DevToolkit/shared/RepoSelector.jsx
import { useState, useMemo } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export function RepoSelector({ repos = [], selected, onSelect }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')

    const filtered = useMemo(() => {
        if (!query) return repos.slice(0, 30)
        const q = query.toLowerCase()
        return repos.filter(r => r.full_name?.toLowerCase().includes(q)).slice(0, 30)
    }, [repos, query])

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-sm hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
            >
                <span className={selected ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}>
                    {selected?.full_name || 'Select repository...'}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                    >
                        <div className="sticky top-0 bg-white dark:bg-slate-900 p-2 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                                <Search className="w-3.5 h-3.5 text-slate-400" />
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search repos..."
                                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                                    autoFocus
                                />
                            </div>
                        </div>
                        {filtered.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-slate-400">No repos found</div>
                        ) : (
                            filtered.map(repo => (
                                <button
                                    key={repo.id || repo.full_name}
                                    type="button"
                                    onClick={() => { onSelect(repo); setOpen(false); setQuery('') }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors ${
                                        selected?.id === repo.id ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
                                    }`}
                                >
                                    {repo.full_name}
                                </button>
                            ))
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
```

- [ ] **Step 2: Create BranchSelector**

```jsx
// src/components/DevToolkit/shared/BranchSelector.jsx
import { useState, useMemo } from 'react'
import { GitBranch, ChevronDown, Star } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export function BranchSelector({ branches = [], selected, onSelect, label, defaultBranch }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')

    const filtered = useMemo(() => {
        if (!query) return branches
        const q = query.toLowerCase()
        return branches.filter(b => (b.name || b).toLowerCase().includes(q))
    }, [branches, query])

    const displayName = selected || 'Select branch...'
    const isDefault = selected && (selected === defaultBranch || selected === 'main' || selected === 'master')

    return (
        <div className="relative flex-1">
            {label && <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</label>}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/80 text-sm hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
            >
                <span className="flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                    <span className={selected ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}>
                        {displayName}
                    </span>
                    {isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 mt-1 w-full max-h-48 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                    >
                        {branches.length > 5 && (
                            <div className="sticky top-0 bg-white dark:bg-slate-900 p-2 border-b border-slate-100 dark:border-slate-800">
                                <input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search branches..."
                                    className="w-full px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-sm outline-none placeholder:text-slate-400"
                                    autoFocus
                                />
                            </div>
                        )}
                        {filtered.map(branch => {
                            const name = branch.name || branch
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => { onSelect(name); setOpen(false); setQuery('') }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors flex items-center gap-1.5 ${
                                        selected === name ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-300'
                                    }`}
                                >
                                    {name}
                                    {(name === defaultBranch || name === 'main' || name === 'master') && (
                                        <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                                    )}
                                </button>
                            )
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
```

- [ ] **Step 3: Create DiffSummary**

```jsx
// src/components/DevToolkit/shared/DiffSummary.jsx
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, FileCode } from 'lucide-react'

export function DiffSummary({ files = [], summary, loading }) {
    const [expandedFile, setExpandedFile] = useState(null)

    if (loading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map(i => (
                    <div key={i} className="h-8 rounded-lg ds-skeleton" />
                ))}
            </div>
        )
    }

    if (!files.length) return null

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {summary?.files_changed || files.length} files changed
                </span>
                <span className="text-xs text-slate-500">
                    <span className="text-emerald-600 dark:text-emerald-400">+{summary?.additions || 0}</span>
                    {' '}
                    <span className="text-red-500 dark:text-red-400">−{summary?.deletions || 0}</span>
                </span>
            </div>
            <div className="max-h-48 overflow-auto">
                {files.map(file => (
                    <div key={file.filename}>
                        <button
                            type="button"
                            onClick={() => setExpandedFile(expandedFile === file.filename ? null : file.filename)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                        >
                            <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform ${expandedFile === file.filename ? 'rotate-90' : ''}`} />
                            <FileCode className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="flex-1 text-left text-slate-700 dark:text-slate-300 font-mono truncate">{file.filename}</span>
                            <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
                            <span className="text-red-500 dark:text-red-400">−{file.deletions}</span>
                        </button>
                        <AnimatePresence>
                            {expandedFile === file.filename && file.patch && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                >
                                    <pre className="px-4 py-2 text-[11px] font-mono bg-slate-900 dark:bg-slate-950 text-slate-300 overflow-x-auto max-h-40">{file.patch}</pre>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                ))}
            </div>
        </div>
    )
}
```

- [ ] **Step 4: Create OutputSection**

```jsx
// src/components/DevToolkit/shared/OutputSection.jsx
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, Terminal } from 'lucide-react'

export function OutputSection({ content, loading, label = 'Generated Output' }) {
    const [copiedId, setCopiedId] = useState(null)

    const handleCopy = useCallback((text, id) => {
        navigator.clipboard.writeText(text)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }, [])

    if (loading) {
        return (
            <div className="space-y-2">
                <div className="h-4 w-32 ds-skeleton rounded" />
                <div className="h-24 ds-skeleton rounded-xl" />
            </div>
        )
    }

    if (!content) return null

    const gitCommand = content.includes('\n')
        ? `git commit -m "$(cat <<'EOF'\n${content}\nEOF\n)"`
        : `git commit -m "${content.replace(/"/g, '\\"')}"`

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{label}</label>
                <div className="relative group">
                    <div className="w-full px-4 py-4 bg-slate-900 dark:bg-slate-900/80 text-emerald-300 rounded-xl font-mono text-sm leading-relaxed border border-slate-700/50 ring-1 ring-emerald-500/10 whitespace-pre-wrap">
                        {content}
                    </div>
                    <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <CopyButton text={content} id="msg" copiedId={copiedId} onCopy={handleCopy} label="Copy message" />
                        <CopyButton text={gitCommand} id="cmd" copiedId={copiedId} onCopy={handleCopy} label="Copy as git command" icon={Terminal} />
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

function CopyButton({ text, id, copiedId, onCopy, label, icon: Icon = Copy }) {
    const isCopied = copiedId === id
    return (
        <button
            type="button"
            onClick={() => onCopy(text, id)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-md transition-all"
            aria-label={label}
            title={label}
        >
            {isCopied
                ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                : <Icon className="w-3.5 h-3.5" />
            }
        </button>
    )
}
```

- [ ] **Step 5: Create RefinementChips**

```jsx
// src/components/DevToolkit/shared/RefinementChips.jsx
import { motion } from 'framer-motion'

export function RefinementChips({ chips = [], onSelect, disabled, loading }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => (
                <motion.button
                    key={chip.id}
                    type="button"
                    onClick={() => onSelect(chip.id)}
                    disabled={disabled || loading}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="px-3 py-1 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300 bg-white dark:bg-slate-800/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {chip.label}
                </motion.button>
            ))}
        </div>
    )
}
```

- [ ] **Step 6: Create SectionCard**

```jsx
// src/components/DevToolkit/shared/SectionCard.jsx
import { useState, useCallback } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'
import { motion } from 'framer-motion'
import { RefinementChips } from './RefinementChips'

export function SectionCard({ title, content, onContentChange, chips, onRefine, refining, loading }) {
    const [editing, setEditing] = useState(false)
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(content || '')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [content])

    if (loading) {
        return <div className="h-20 ds-skeleton rounded-xl" />
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        >
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">{title}</span>
                <div className="flex gap-1">
                    <button type="button" onClick={() => setEditing(!editing)} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" aria-label="Edit">
                        <Pencil className="w-3 h-3 text-slate-400" />
                    </button>
                    <button type="button" onClick={handleCopy} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" aria-label="Copy">
                        {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                    </button>
                </div>
            </div>
            <div className="px-3 py-2">
                {editing ? (
                    <textarea
                        value={content || ''}
                        onChange={(e) => onContentChange?.(e.target.value)}
                        className="w-full min-h-[60px] bg-transparent text-sm text-slate-700 dark:text-slate-300 resize-y outline-none font-mono"
                        autoFocus
                    />
                ) : (
                    <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {content || <span className="text-slate-400 italic">No content generated</span>}
                    </div>
                )}
            </div>
            {chips && chips.length > 0 && (
                <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                    <RefinementChips chips={chips} onSelect={onRefine} disabled={refining} loading={refining} />
                </div>
            )}
        </motion.div>
    )
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/DevToolkit/shared/
git commit -m "feat(toolkit): add shared UI components (selectors, diff, output, chips, section)"
```

---

## Task 7: CommitTab Component

**Files:**
- Create: `src/components/DevToolkit/CommitTab/CommitTab.jsx`
- Create: `src/components/DevToolkit/CommitTab/FormatSelector.jsx`
- Create: `src/components/DevToolkit/CommitTab/MultiCommitSplit.jsx`
- Create: `src/components/DevToolkit/CommitTab/SessionHistory.jsx`

- [ ] **Step 1: Create FormatSelector**

```jsx
// src/components/DevToolkit/CommitTab/FormatSelector.jsx
const FORMATS = [
    { id: 'conventional', label: 'Conventional' },
    { id: 'gitmoji', label: 'Gitmoji' },
    { id: 'descriptive', label: 'Descriptive' },
    { id: 'repo-convention', label: 'Repo Convention' },
]

export function FormatSelector({ selected, onSelect, repoStyleLoading }) {
    return (
        <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40">
            {FORMATS.map(f => (
                <button
                    key={f.id}
                    type="button"
                    onClick={() => onSelect(f.id)}
                    disabled={f.id === 'repo-convention' && repoStyleLoading}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                        selected === f.id
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    } disabled:opacity-40`}
                >
                    {f.label}
                </button>
            ))}
        </div>
    )
}
```

- [ ] **Step 2: Create SessionHistory**

```jsx
// src/components/DevToolkit/CommitTab/SessionHistory.jsx
export function SessionHistory({ items = [], onRestore }) {
    if (!items.length) return null

    return (
        <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-thin">
            <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide shrink-0 self-center">History:</span>
            {items.map((msg, i) => (
                <button
                    key={i}
                    type="button"
                    onClick={() => onRestore(msg)}
                    className="shrink-0 max-w-[200px] truncate px-2 py-0.5 text-[11px] font-mono rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-600 dark:hover:text-indigo-300 border border-slate-200 dark:border-slate-700 transition-colors"
                    title={msg}
                >
                    {msg.split('\n')[0]}
                </button>
            ))}
        </div>
    )
}
```

- [ ] **Step 3: Create MultiCommitSplit**

```jsx
// src/components/DevToolkit/CommitTab/MultiCommitSplit.jsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Check, Lightbulb, X } from 'lucide-react'

export function MultiCommitSplit({ commits = [], onDismiss, onUseAll }) {
    const [copiedIdx, setCopiedIdx] = useState(null)

    const handleCopy = (msg, idx) => {
        navigator.clipboard.writeText(msg)
        setCopiedIdx(idx)
        setTimeout(() => setCopiedIdx(null), 2000)
    }

    const handleUseAll = () => {
        const all = commits.map((c, i) => `${i + 1}. ${c.message}`).join('\n')
        navigator.clipboard.writeText(all)
        onUseAll?.()
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden"
        >
            <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200 dark:border-amber-800/50">
                <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <Lightbulb className="w-3.5 h-3.5" />
                    Suggested commit sequence
                </span>
                <button type="button" onClick={onDismiss} className="p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30" aria-label="Dismiss">
                    <X className="w-3 h-3 text-amber-500" />
                </button>
            </div>
            <div className="divide-y divide-amber-100 dark:divide-amber-900/30">
                {commits.map((commit, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-start gap-2 px-3 py-2"
                    >
                        <span className="shrink-0 w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-700 dark:text-amber-200 text-[10px] font-bold flex items-center justify-center mt-0.5">
                            {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-slate-800 dark:text-slate-200 break-words">{commit.message}</p>
                            {commit.files && (
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{commit.files.join(', ')}</p>
                            )}
                        </div>
                        <button type="button" onClick={() => handleCopy(commit.message, idx)} className="shrink-0 p-1 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/30" aria-label="Copy">
                            {copiedIdx === idx ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        </button>
                    </motion.div>
                ))}
            </div>
            <div className="flex justify-end gap-2 px-3 py-2 border-t border-amber-200 dark:border-amber-800/50">
                <button type="button" onClick={onDismiss} className="px-3 py-1 text-xs rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Dismiss</button>
                <button type="button" onClick={handleUseAll} className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500 hover:bg-amber-600 text-white">Use all</button>
            </div>
        </motion.div>
    )
}
```

- [ ] **Step 4: Create CommitTab (main component)**

```jsx
// src/components/DevToolkit/CommitTab/CommitTab.jsx
import { useState, useCallback } from 'react'
import { RefreshCw, Wand2 } from 'lucide-react'
import { RepoSelector } from '../shared/RepoSelector'
import { BranchSelector } from '../shared/BranchSelector'
import { DiffSummary } from '../shared/DiffSummary'
import { OutputSection } from '../shared/OutputSection'
import { RefinementChips } from '../shared/RefinementChips'
import { FormatSelector } from './FormatSelector'
import { SessionHistory } from './SessionHistory'
import { MultiCommitSplit } from './MultiCommitSplit'

const INPUT_MODES = [
    { id: 'auto', label: 'Auto-fetch' },
    { id: 'manual', label: 'Paste' },
]

const COMMIT_CHIPS = [
    { id: 'shorter', label: 'Shorter' },
    { id: 'more_detail', label: 'More detail' },
    { id: 'add_body', label: '+ Body' },
    { id: 'breaking_change', label: 'Breaking change' },
]

const MULTI_COMMIT_THRESHOLD = 300

export function CommitTab({ toolkit, askAI }) {
    const { repos, selectedRepo, selectRepo, headBranch, setHeadBranch, baseBranch, setBaseBranch, branches, compareData, compareLoading, fetchCompare, history, addToHistory } = toolkit

    const [inputMode, setInputMode] = useState(selectedRepo ? 'auto' : 'manual')
    const [manualDiff, setManualDiff] = useState('')
    const [format, setFormat] = useState('conventional')
    const [repoStyle, setRepoStyle] = useState(null)
    const [repoStyleLoading, setRepoStyleLoading] = useState(false)
    const [generated, setGenerated] = useState('')
    const [loading, setLoading] = useState(false)
    const [multiCommits, setMultiCommits] = useState(null)

    const totalChanges = compareData
        ? (compareData.diff_summary?.additions || 0) + (compareData.diff_summary?.deletions || 0)
        : 0

    const handleRepoSelect = useCallback((repo) => {
        selectRepo(repo)
        setInputMode('auto')
        setGenerated('')
        setMultiCommits(null)
    }, [selectRepo])

    const handleBranchChange = useCallback((branch, type) => {
        if (type === 'head') {
            setHeadBranch(branch)
            if (baseBranch && selectedRepo) {
                fetchCompare(selectedRepo.owner?.login, selectedRepo.name, baseBranch, branch)
            }
        } else {
            setBaseBranch(branch)
            if (headBranch && selectedRepo) {
                fetchCompare(selectedRepo.owner?.login, selectedRepo.name, branch, headBranch)
            }
        }
        setGenerated('')
        setMultiCommits(null)
    }, [baseBranch, headBranch, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare])

    const fetchRepoStyle = useCallback(async () => {
        if (!selectedRepo) return null
        setRepoStyleLoading(true)
        try {
            const res = await fetch(`/api/repos/${selectedRepo.owner?.login}/${selectedRepo.name}/commits/style`)
            if (!res.ok) return null
            const data = await res.json()
            setRepoStyle(data)
            return data
        } catch { return null } finally { setRepoStyleLoading(false) }
    }, [selectedRepo])

    const handleGenerate = useCallback(async () => {
        const diff = inputMode === 'auto'
            ? compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
            : manualDiff

        if (!diff?.trim()) return
        setLoading(true)
        setGenerated('')
        setMultiCommits(null)

        try {
            let style = repoStyle
            if (format === 'repo-convention' && !style) {
                style = await fetchRepoStyle()
            }

            const res = await fetch('/api/ai/generate-commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    diff,
                    format,
                    repo_style: format === 'repo-convention' ? style : undefined,
                    repo_context: selectedRepo ? { name: selectedRepo.full_name, description: selectedRepo.description } : undefined,
                }),
            })
            if (!res.ok) throw new Error('Generation failed')
            const data = await res.json()
            setGenerated(data.message)
            addToHistory(data.message)
        } catch {
            setGenerated('Error generating commit message. Please try again.')
        } finally {
            setLoading(false)
        }
    }, [inputMode, compareData, manualDiff, format, repoStyle, selectedRepo, fetchRepoStyle, addToHistory])

    const handleRefine = useCallback(async (instruction) => {
        if (!generated) return
        setLoading(true)
        try {
            const diff = inputMode === 'auto'
                ? compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
                : manualDiff

            const res = await fetch('/api/ai/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_content: generated,
                    original_diff: diff,
                    instruction,
                    content_type: 'commit',
                }),
            })
            if (!res.ok) throw new Error('Refine failed')
            const data = await res.json()
            setGenerated(data.refined_content)
            addToHistory(data.refined_content)
        } catch {
            // Keep current message on error
        } finally {
            setLoading(false)
        }
    }, [generated, inputMode, compareData, manualDiff, addToHistory])

    const handleSplit = useCallback(async () => {
        const diff = compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n')
        if (!diff) return
        setLoading(true)
        try {
            const res = await fetch('/api/ai/generate-commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    diff,
                    format,
                    repo_context: selectedRepo ? { name: selectedRepo.full_name } : undefined,
                    split: true,
                }),
            })
            // For now, parse multi-commit from a single response — backend can be enhanced later
            if (!res.ok) throw new Error('Split failed')
            const data = await res.json()
            // Simple split: one commit per file group
            const msgs = data.message.split('\n').filter(l => l.trim())
            setMultiCommits(msgs.map(m => ({ message: m.replace(/^\d+\.\s*/, ''), files: [] })))
        } catch { /* noop */ } finally { setLoading(false) }
    }, [compareData, format, selectedRepo])

    const canGenerate = inputMode === 'auto'
        ? (compareData && compareData.files?.length > 0)
        : manualDiff.trim().length > 0

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Input mode toggle */}
            <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200/40 dark:border-slate-700/40 w-fit">
                {INPUT_MODES.map(m => (
                    <button
                        key={m.id}
                        type="button"
                        onClick={() => setInputMode(m.id)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                            inputMode === m.id
                                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {/* Auto-fetch mode */}
            {inputMode === 'auto' && (
                <div className="space-y-3">
                    <RepoSelector repos={repos} selected={selectedRepo} onSelect={handleRepoSelect} />
                    {selectedRepo && (
                        <div className="flex gap-3">
                            <BranchSelector branches={branches} selected={headBranch} onSelect={b => handleBranchChange(b, 'head')} label="Branch" />
                            <BranchSelector branches={branches} selected={baseBranch} onSelect={b => handleBranchChange(b, 'base')} label="Compare against" defaultBranch={baseBranch} />
                        </div>
                    )}
                    <DiffSummary files={compareData?.files || []} summary={compareData?.diff_summary} loading={compareLoading} />
                </div>
            )}

            {/* Manual paste mode */}
            {inputMode === 'manual' && (
                <div>
                    <textarea
                        value={manualDiff}
                        onChange={(e) => setManualDiff(e.target.value)}
                        placeholder="Paste a git diff, file changes, or describe what you changed in plain text..."
                        className="w-full h-40 px-4 py-3 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 resize-none font-mono placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors leading-relaxed"
                    />
                </div>
            )}

            {/* Format selector */}
            <FormatSelector selected={format} onSelect={setFormat} repoStyleLoading={repoStyleLoading} />

            {/* Generate button */}
            <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || loading}
                className="ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {loading ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating...</>
                ) : (
                    <><Wand2 className="w-3.5 h-3.5" />Generate</>
                )}
            </button>

            {/* Multi-commit suggestion */}
            {inputMode === 'auto' && totalChanges > MULTI_COMMIT_THRESHOLD && !multiCommits && generated && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-300">
                    <span>Large diff detected ({totalChanges} lines). Split into logical commits?</span>
                    <button type="button" onClick={handleSplit} className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white font-medium">Split</button>
                </div>
            )}

            {multiCommits && (
                <MultiCommitSplit commits={multiCommits} onDismiss={() => setMultiCommits(null)} onUseAll={() => setMultiCommits(null)} />
            )}

            {/* Output */}
            {!multiCommits && (
                <OutputSection content={generated} loading={loading} label="Generated Commit Message" />
            )}

            {/* Refinement chips */}
            {generated && !loading && !multiCommits && (
                <RefinementChips chips={COMMIT_CHIPS} onSelect={handleRefine} disabled={loading} />
            )}

            {/* Session history */}
            <SessionHistory items={history} onRestore={setGenerated} />
        </div>
    )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/DevToolkit/CommitTab/
git commit -m "feat(toolkit): add CommitTab with auto-fetch, format selector, multi-commit split"
```

---

## Task 8: PRTab Component

**Files:**
- Create: `src/components/DevToolkit/PRTab/PRTab.jsx`
- Create: `src/components/DevToolkit/PRTab/PRSections.jsx`
- Create: `src/components/DevToolkit/PRTab/LabelPills.jsx`
- Create: `src/components/DevToolkit/PRTab/ReviewerPills.jsx`
- Create: `src/components/DevToolkit/PRTab/CreatePRConfirm.jsx`

- [ ] **Step 1: Create LabelPills**

```jsx
// src/components/DevToolkit/PRTab/LabelPills.jsx
import { useState } from 'react'
import { X, Plus } from 'lucide-react'

export function LabelPills({ labels = [], onRemove, onAdd }) {
    const [adding, setAdding] = useState(false)
    const [input, setInput] = useState('')

    const handleAdd = () => {
        if (input.trim() && !labels.includes(input.trim())) {
            onAdd(input.trim())
            setInput('')
            setAdding(false)
        }
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center">
            {labels.map(label => (
                <span key={label} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 text-xs border border-indigo-200 dark:border-indigo-800">
                    {label}
                    <button type="button" onClick={() => onRemove(label)} className="hover:text-red-500 transition-colors" aria-label={`Remove ${label}`}>
                        <X className="w-2.5 h-2.5" />
                    </button>
                </span>
            ))}
            {adding ? (
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
                    onBlur={() => { if (!input) setAdding(false) }}
                    placeholder="label..."
                    className="w-20 px-2 py-0.5 text-xs rounded-full border border-indigo-300 dark:border-indigo-700 bg-transparent outline-none"
                    autoFocus
                />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-slate-400 hover:text-indigo-500 border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 transition-colors">
                    <Plus className="w-2.5 h-2.5" /> Add
                </button>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Create ReviewerPills**

```jsx
// src/components/DevToolkit/PRTab/ReviewerPills.jsx
import { useState } from 'react'
import { X, Plus, User } from 'lucide-react'

export function ReviewerPills({ reviewers = [], onRemove, onAdd }) {
    const [adding, setAdding] = useState(false)
    const [input, setInput] = useState('')

    const handleAdd = () => {
        const name = input.trim().replace(/^@/, '')
        if (name && !reviewers.includes(name)) {
            onAdd(name)
            setInput('')
            setAdding(false)
        }
    }

    return (
        <div className="flex flex-wrap gap-1.5 items-center">
            {reviewers.map(r => (
                <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs border border-slate-200 dark:border-slate-700">
                    <User className="w-2.5 h-2.5" />
                    @{r}
                    <button type="button" onClick={() => onRemove(r)} className="hover:text-red-500 transition-colors" aria-label={`Remove ${r}`}>
                        <X className="w-2.5 h-2.5" />
                    </button>
                </span>
            ))}
            {adding ? (
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
                    onBlur={() => { if (!input) setAdding(false) }}
                    placeholder="@username..."
                    className="w-24 px-2 py-0.5 text-xs rounded-full border border-slate-300 dark:border-slate-700 bg-transparent outline-none"
                    autoFocus
                />
            ) : (
                <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-slate-400 hover:text-indigo-500 border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-400 transition-colors">
                    <Plus className="w-2.5 h-2.5" /> Add
                </button>
            )}
        </div>
    )
}
```

- [ ] **Step 3: Create CreatePRConfirm**

```jsx
// src/components/DevToolkit/PRTab/CreatePRConfirm.jsx
import { motion } from 'framer-motion'

export function CreatePRConfirm({ action = 'create', onConfirm, onCancel, loading }) {
    const labels = {
        create: { title: 'Create Pull Request?', btn: 'Create PR', color: 'bg-emerald-600 hover:bg-emerald-700' },
        update: { title: 'Update PR Description?', btn: 'Update PR', color: 'bg-blue-600 hover:bg-blue-700' },
    }
    const cfg = labels[action] || labels.create

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
        >
            <span className="text-xs text-slate-600 dark:text-slate-300">{cfg.title}</span>
            <button type="button" onClick={onCancel} disabled={loading} className="px-3 py-1 text-xs rounded-md text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Cancel</button>
            <button type="button" onClick={onConfirm} disabled={loading} className={`px-3 py-1 text-xs font-medium rounded-md text-white ${cfg.color} disabled:opacity-50`}>
                {loading ? 'Working...' : cfg.btn}
            </button>
        </motion.div>
    )
}
```

- [ ] **Step 4: Create PRSections**

```jsx
// src/components/DevToolkit/PRTab/PRSections.jsx
import { SectionCard } from '../shared/SectionCard'
import { LabelPills } from './LabelPills'
import { ReviewerPills } from './ReviewerPills'

const SUMMARY_CHIPS = [
    { id: 'shorter', label: 'Shorter' },
    { id: 'more_context', label: 'More context' },
    { id: 'architecture_notes', label: 'Architecture notes' },
]

const TEST_PLAN_CHIPS = [
    { id: 'more_cases', label: 'More cases' },
    { id: 'edge_cases', label: 'Edge cases' },
    { id: 'e2e_focus', label: 'E2E focus' },
]

export function PRSections({ sections, onSectionChange, onRefine, refiningSection, loading, labels, onLabelsChange, reviewers, onReviewersChange }) {
    if (loading) {
        return (
            <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-20 ds-skeleton rounded-xl" />)}
            </div>
        )
    }

    if (!sections) return null

    return (
        <div className="space-y-3">
            <SectionCard
                title="Title"
                content={sections.title}
                onContentChange={(v) => onSectionChange('title', v)}
            />
            <SectionCard
                title="Summary"
                content={sections.summary}
                onContentChange={(v) => onSectionChange('summary', v)}
                chips={SUMMARY_CHIPS}
                onRefine={(id) => onRefine('pr_summary', id)}
                refining={refiningSection === 'pr_summary'}
            />
            <SectionCard
                title="Test Plan"
                content={sections.test_plan}
                onContentChange={(v) => onSectionChange('test_plan', v)}
                chips={TEST_PLAN_CHIPS}
                onRefine={(id) => onRefine('pr_test_plan', id)}
                refining={refiningSection === 'pr_test_plan'}
            />
            <SectionCard
                title="Breaking Changes"
                content={sections.breaking_changes || 'None detected'}
                onContentChange={(v) => onSectionChange('breaking_changes', v)}
            />
            {sections.related_issues?.length > 0 && (
                <SectionCard
                    title="Related Issues"
                    content={sections.related_issues.map(i => `${i.relation} #${i.number}`).join('\n')}
                />
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Labels</span>
                <LabelPills
                    labels={labels}
                    onRemove={(l) => onLabelsChange(labels.filter(x => x !== l))}
                    onAdd={(l) => onLabelsChange([...labels, l])}
                />
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Reviewers</span>
                <ReviewerPills
                    reviewers={reviewers}
                    onRemove={(r) => onReviewersChange(reviewers.filter(x => x !== r))}
                    onAdd={(r) => onReviewersChange([...reviewers, r])}
                />
            </div>
        </div>
    )
}
```

- [ ] **Step 5: Create PRTab (main component)**

```jsx
// src/components/DevToolkit/PRTab/PRTab.jsx
import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, GitPullRequest, Copy, Check, Rocket } from 'lucide-react'
import { RepoSelector } from '../shared/RepoSelector'
import { BranchSelector } from '../shared/BranchSelector'
import { DiffSummary } from '../shared/DiffSummary'
import { PRSections } from './PRSections'
import { CreatePRConfirm } from './CreatePRConfirm'

export function PRTab({ toolkit }) {
    const { repos, selectedRepo, selectRepo, headBranch, setHeadBranch, baseBranch, setBaseBranch, branches, compareData, compareLoading, fetchCompare, prContext } = toolkit

    const [sections, setSections] = useState(null)
    const [labels, setLabels] = useState([])
    const [reviewers, setReviewers] = useState([])
    const [loading, setLoading] = useState(false)
    const [refiningSection, setRefiningSection] = useState(null)
    const [templateBadge, setTemplateBadge] = useState(null)
    const [confirmAction, setConfirmAction] = useState(null)
    const [actionLoading, setActionLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const [prUrl, setPrUrl] = useState(null)

    // Auto-load PR context
    useEffect(() => {
        if (prContext && selectedRepo) {
            if (prContext.base && prContext.head) {
                setHeadBranch(prContext.head)
                setBaseBranch(prContext.base)
                fetchCompare(selectedRepo.owner?.login, selectedRepo.name, prContext.base, prContext.head)
            }
        }
    }, [prContext, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare])

    const handleBranchChange = useCallback((branch, type) => {
        if (type === 'head') {
            setHeadBranch(branch)
            if (baseBranch && selectedRepo) fetchCompare(selectedRepo.owner?.login, selectedRepo.name, baseBranch, branch)
        } else {
            setBaseBranch(branch)
            if (headBranch && selectedRepo) fetchCompare(selectedRepo.owner?.login, selectedRepo.name, branch, headBranch)
        }
        setSections(null)
    }, [baseBranch, headBranch, selectedRepo, setHeadBranch, setBaseBranch, fetchCompare])

    const handleGenerate = useCallback(async () => {
        if (!compareData) return
        setLoading(true)
        setSections(null)

        try {
            // Fetch PR template in parallel
            let template = null
            if (selectedRepo) {
                try {
                    const tplRes = await fetch(`/api/repos/${selectedRepo.owner?.login}/${selectedRepo.name}/pr-template`)
                    if (tplRes.ok) {
                        const tplData = await tplRes.json()
                        if (tplData.found) {
                            template = tplData.template
                            setTemplateBadge('Using repo template')
                        } else {
                            setTemplateBadge('Using default template')
                        }
                    }
                } catch { /* noop */ }
            }

            const topPatches = compareData.files
                .slice(0, 30)
                .map(f => f.patch)
                .filter(Boolean)
                .join('\n---\n')

            const res = await fetch('/api/ai/generate-pr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    commits: compareData.commits,
                    diff_summary: { files: compareData.files, ...compareData.diff_summary },
                    top_patches: topPatches,
                    template,
                    repo_context: selectedRepo ? { name: selectedRepo.full_name, description: selectedRepo.description } : undefined,
                }),
            })
            if (!res.ok) throw new Error('Generation failed')
            const data = await res.json()
            setSections(data)
            setLabels(data.suggested_labels || [])
            setReviewers(data.suggested_reviewers || [])
        } catch {
            setSections({ title: '', summary: 'Error generating PR description. Please try again.', test_plan: '', breaking_changes: null, related_issues: [] })
        } finally {
            setLoading(false)
        }
    }, [compareData, selectedRepo])

    const handleRefine = useCallback(async (contentType, instruction) => {
        if (!sections) return
        setRefiningSection(contentType)
        const field = contentType === 'pr_summary' ? 'summary' : 'test_plan'
        try {
            const res = await fetch('/api/ai/refine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_content: sections[field],
                    original_diff: compareData?.files?.map(f => f.patch).filter(Boolean).join('\n---\n'),
                    instruction,
                    content_type: contentType,
                }),
            })
            if (!res.ok) throw new Error('Refine failed')
            const data = await res.json()
            setSections(prev => ({ ...prev, [field]: data.refined_content }))
        } catch { /* noop */ } finally { setRefiningSection(null) }
    }, [sections, compareData])

    const buildBody = useCallback(() => {
        if (!sections) return ''
        const parts = [sections.summary || '', sections.test_plan || '']
        if (sections.breaking_changes) parts.push(sections.breaking_changes)
        if (sections.related_issues?.length) {
            parts.push(sections.related_issues.map(i => `${i.relation} #${i.number}`).join('\n'))
        }
        return parts.filter(Boolean).join('\n\n')
    }, [sections])

    const handleCopyAll = useCallback(() => {
        const body = buildBody()
        const full = `${sections?.title || ''}\n\n${body}`
        navigator.clipboard.writeText(full)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [sections, buildBody])

    const handleCreateOrUpdate = useCallback(async () => {
        if (!sections || !selectedRepo) return
        setActionLoading(true)
        try {
            const owner = selectedRepo.owner?.login
            const repo = selectedRepo.name
            const body = buildBody()

            if (prContext?.number) {
                // Update existing PR
                await fetch(`/api/repos/${owner}/${repo}/pulls/${prContext.number}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: sections.title, body }),
                })
                setPrUrl(`https://github.com/${owner}/${repo}/pull/${prContext.number}`)
            } else {
                // Create new PR
                const res = await fetch(`/api/repos/${owner}/${repo}/pulls`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: sections.title,
                        body,
                        head: headBranch,
                        base: baseBranch,
                    }),
                })
                if (!res.ok) throw new Error('Create failed')
                const data = await res.json()
                setPrUrl(data.pull_request?.html_url || `https://github.com/${owner}/${repo}/pulls`)
            }
        } catch { /* noop */ } finally {
            setActionLoading(false)
            setConfirmAction(null)
        }
    }, [sections, selectedRepo, prContext, headBranch, baseBranch, buildBody])

    const canGenerate = compareData && compareData.files?.length > 0

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Repo & branch selectors (shared with CommitTab via toolkit) */}
            <RepoSelector repos={repos} selected={selectedRepo} onSelect={(r) => { selectRepo(r); setSections(null) }} />
            {selectedRepo && (
                <div className="flex gap-3">
                    <BranchSelector branches={branches} selected={headBranch} onSelect={b => handleBranchChange(b, 'head')} label="Head (your branch)" />
                    <BranchSelector branches={branches} selected={baseBranch} onSelect={b => handleBranchChange(b, 'base')} label="Base (merge into)" defaultBranch={baseBranch} />
                </div>
            )}

            <DiffSummary files={compareData?.files || []} summary={compareData?.diff_summary} loading={compareLoading} />

            {templateBadge && (
                <div className="text-xs text-slate-500 dark:text-slate-400 italic">{templateBadge}</div>
            )}

            {/* Generate button */}
            <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate || loading}
                className="ds-btn-shimmer inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-semibold rounded-lg text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
                {loading ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating...</> : <><GitPullRequest className="w-3.5 h-3.5" />Generate PR Description</>}
            </button>

            {/* Sections output */}
            <PRSections
                sections={sections}
                onSectionChange={(field, val) => setSections(prev => ({ ...prev, [field]: val }))}
                onRefine={handleRefine}
                refiningSection={refiningSection}
                loading={loading}
                labels={labels}
                onLabelsChange={setLabels}
                reviewers={reviewers}
                onReviewersChange={setReviewers}
            />

            {/* Actions */}
            {sections && !loading && (
                <div className="flex items-center gap-3 flex-wrap">
                    <button type="button" onClick={handleCopyAll} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied!' : 'Copy All'}
                    </button>

                    {!confirmAction && (
                        <button
                            type="button"
                            onClick={() => setConfirmAction(prContext?.number ? 'update' : 'create')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors"
                        >
                            <Rocket className="w-3.5 h-3.5" />
                            {prContext?.number ? 'Update PR' : 'Create PR'}
                        </button>
                    )}

                    {confirmAction && (
                        <CreatePRConfirm action={confirmAction} onConfirm={handleCreateOrUpdate} onCancel={() => setConfirmAction(null)} loading={actionLoading} />
                    )}

                    {prUrl && (
                        <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                            View PR on GitHub &rarr;
                        </a>
                    )}
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/DevToolkit/PRTab/
git commit -m "feat(toolkit): add PRTab with description generator, labels, reviewers, create/update PR"
```

---

## Task 9: ReviewTab Component

**Files:**
- Create: `src/components/DevToolkit/ReviewTab/ReviewTab.jsx`
- Create: `src/components/DevToolkit/ReviewTab/PRSelector.jsx`
- Create: `src/components/DevToolkit/ReviewTab/QuickSummary.jsx`
- Create: `src/components/DevToolkit/ReviewTab/QuickActions.jsx`

- [ ] **Step 1: Create PRSelector**

```jsx
// src/components/DevToolkit/ReviewTab/PRSelector.jsx
import { GitPullRequest, Clock, FileCode } from 'lucide-react'

export function PRSelector({ pulls = [], loading, onSelect }) {
    if (loading) {
        return <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 ds-skeleton rounded-xl" />)}</div>
    }

    if (!pulls.length) {
        return <div className="text-center text-sm text-slate-400 dark:text-slate-500 py-8">No open pull requests</div>
    }

    return (
        <div className="space-y-2 max-h-72 overflow-auto">
            {pulls.map(pr => (
                <button
                    key={pr.number}
                    type="button"
                    onClick={() => onSelect(pr)}
                    className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                    <div className="flex items-start gap-2">
                        <GitPullRequest className={`w-4 h-4 mt-0.5 shrink-0 ${pr.draft ? 'text-slate-400' : 'text-emerald-500'}`} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                                {pr.title} <span className="text-slate-400 font-normal">#{pr.number}</span>
                            </p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                                <span>{pr.user?.login}</span>
                                {pr.draft && <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">Draft</span>}
                                <span className="flex items-center gap-0.5"><FileCode className="w-3 h-3" />{pr.changed_files || '?'}</span>
                            </div>
                        </div>
                    </div>
                </button>
            ))}
        </div>
    )
}
```

- [ ] **Step 2: Create QuickSummary**

```jsx
// src/components/DevToolkit/ReviewTab/QuickSummary.jsx
import { Shield, Clock, AlertTriangle, FileCode } from 'lucide-react'

const RISK_COLORS = {
    low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

export function QuickSummary({ summary, loading, error, onRetry }) {
    if (loading) {
        return (
            <div className="space-y-3">
                <div className="h-8 w-32 ds-skeleton rounded" />
                <div className="h-24 ds-skeleton rounded-xl" />
                <div className="h-16 ds-skeleton rounded-xl" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="text-center py-6">
                <p className="text-sm text-red-500 dark:text-red-400 mb-2">{error}</p>
                <button type="button" onClick={onRetry} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Retry</button>
            </div>
        )
    }

    if (!summary) return null

    return (
        <div className="space-y-3">
            {/* Risk + Time */}
            <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${RISK_COLORS[summary.overallRisk] || RISK_COLORS.low}`}>
                    <Shield className="w-3 h-3" />
                    {summary.overallRisk?.charAt(0).toUpperCase() + summary.overallRisk?.slice(1)} risk
                </span>
                {summary.estimatedReviewTime && (
                    <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Clock className="w-3 h-3" />
                        {summary.estimatedReviewTime}
                    </span>
                )}
            </div>

            {/* Overview */}
            <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{summary.overview}</div>

            {/* Key changes */}
            {summary.keyChanges?.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">Key Changes</h4>
                    <ul className="space-y-1">
                        {summary.keyChanges.map((change, i) => (
                            <li key={i} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-1.5">
                                <span className="text-indigo-400 mt-0.5">•</span>
                                {change}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* High-risk files */}
            {summary.fileRisks?.length > 0 && (
                <div>
                    <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5 uppercase tracking-wide">High-Risk Files</h4>
                    <div className="space-y-1">
                        {summary.fileRisks.slice(0, 5).map((file, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                                <AlertTriangle className={`w-3 h-3 ${file.level === 'high' || file.level === 'critical' ? 'text-red-500' : 'text-amber-500'}`} />
                                <span className="font-mono text-slate-600 dark:text-slate-300 truncate flex-1">{file.filename}</span>
                                <span className="text-slate-400 shrink-0">{file.reason}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 3: Create QuickActions**

```jsx
// src/components/DevToolkit/ReviewTab/QuickActions.jsx
import { useState } from 'react'
import { ThumbsUp, MessageSquare } from 'lucide-react'

export function QuickActions({ owner, repo, pullNumber, onSubmitted }) {
    const [action, setAction] = useState(null)
    const [comment, setComment] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (event) => {
        setLoading(true)
        try {
            const res = await fetch(`/api/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event, body: comment || undefined, comments: [] }),
            })
            if (!res.ok) throw new Error('Submit failed')
            setAction(null)
            setComment('')
            onSubmitted?.()
        } catch { /* noop */ } finally { setLoading(false) }
    }

    if (action) {
        return (
            <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={action === 'APPROVE' ? 'Optional comment...' : 'Your comment...'}
                    className="w-full h-20 px-3 py-2 text-sm bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-lg resize-none outline-none"
                />
                <div className="flex gap-2">
                    <button type="button" onClick={() => setAction(null)} className="px-3 py-1 text-xs text-slate-500">Cancel</button>
                    <button
                        type="button"
                        onClick={() => handleSubmit(action)}
                        disabled={loading || (action === 'COMMENT' && !comment.trim())}
                        className={`px-3 py-1 text-xs font-medium rounded-md text-white disabled:opacity-50 ${
                            action === 'APPROVE' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                    >
                        {loading ? 'Submitting...' : action === 'APPROVE' ? 'Approve' : 'Comment'}
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex gap-2">
            <button
                type="button"
                onClick={() => setAction('APPROVE')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
            >
                <ThumbsUp className="w-3 h-3" /> Quick Approve
            </button>
            <button
                type="button"
                onClick={() => setAction('COMMENT')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
                <MessageSquare className="w-3 h-3" /> Quick Comment
            </button>
        </div>
    )
}
```

- [ ] **Step 4: Create ReviewTab (main component)**

```jsx
// src/components/DevToolkit/ReviewTab/ReviewTab.jsx
import { useState, useCallback, useEffect } from 'react'
import { Eye } from 'lucide-react'
import { RepoSelector } from '../shared/RepoSelector'
import { PRSelector } from './PRSelector'
import { QuickSummary } from './QuickSummary'
import { QuickActions } from './QuickActions'

export function ReviewTab({ toolkit, onStartReview, onClose }) {
    const { repos, selectedRepo, selectRepo, prContext } = toolkit
    const [pulls, setPulls] = useState([])
    const [pullsLoading, setPullsLoading] = useState(false)
    const [selectedPR, setSelectedPR] = useState(null)
    const [summary, setSummary] = useState(null)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState(null)

    // Load open PRs when repo selected
    useEffect(() => {
        if (!selectedRepo) return
        setPullsLoading(true)
        fetch(`/api/repos/${selectedRepo.owner?.login}/${selectedRepo.name}/pulls?state=open`)
            .then(r => r.ok ? r.json() : [])
            .then(setPulls)
            .catch(() => setPulls([]))
            .finally(() => setPullsLoading(false))
    }, [selectedRepo])

    // Auto-select PR from context
    useEffect(() => {
        if (prContext?.number && pulls.length) {
            const pr = pulls.find(p => p.number === prContext.number)
            if (pr) setSelectedPR(pr)
        }
    }, [prContext, pulls])

    const fetchSummary = useCallback(async (pr) => {
        if (!selectedRepo || !pr) return
        setSummaryLoading(true)
        setSummaryError(null)

        try {
            const owner = selectedRepo.owner?.login
            const repo = selectedRepo.name

            // Fetch PR files for AI analysis
            const filesRes = await fetch(`/api/repos/${owner}/${repo}/pulls/${pr.number}/files`)
            if (!filesRes.ok) throw new Error('Failed to fetch files')
            const files = await filesRes.json()

            const res = await fetch('/api/ai/review-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileManifest: files.map(f => ({ filename: f.filename, additions: f.additions, deletions: f.deletions, status: f.status })),
                    topFilePatches: files.slice(0, 30).map(f => ({ filename: f.filename, patch: f.patch })),
                    prMetadata: { title: pr.title, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0), fileCount: files.length },
                }),
            })
            if (!res.ok) throw new Error('AI summary failed')
            const data = await res.json()
            setSummary(data)
        } catch (err) {
            setSummaryError(err.message || 'Failed to generate summary')
        } finally {
            setSummaryLoading(false)
        }
    }, [selectedRepo])

    const handlePRSelect = useCallback((pr) => {
        setSelectedPR(pr)
        setSummary(null)
        fetchSummary(pr)
    }, [fetchSummary])

    const handleStartFullReview = useCallback(() => {
        if (selectedPR && onStartReview) {
            onClose?.()
            onStartReview(selectedPR)
        }
    }, [selectedPR, onStartReview, onClose])

    return (
        <div className="p-4 md:p-6 space-y-4">
            <RepoSelector repos={repos} selected={selectedRepo} onSelect={(r) => { selectRepo(r); setSelectedPR(null); setSummary(null) }} />

            {selectedRepo && !selectedPR && (
                <PRSelector pulls={pulls} loading={pullsLoading} onSelect={handlePRSelect} />
            )}

            {selectedPR && (
                <>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">{selectedPR.title}</h3>
                            <p className="text-xs text-slate-400">#{selectedPR.number} by {selectedPR.user?.login}</p>
                        </div>
                        <button type="button" onClick={() => { setSelectedPR(null); setSummary(null) }} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Change PR</button>
                    </div>

                    <QuickSummary summary={summary} loading={summaryLoading} error={summaryError} onRetry={() => fetchSummary(selectedPR)} />

                    {summary && (
                        <QuickActions owner={selectedRepo.owner?.login} repo={selectedRepo.name} pullNumber={selectedPR.number} onSubmitted={() => fetchSummary(selectedPR)} />
                    )}

                    <button
                        type="button"
                        onClick={handleStartFullReview}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium rounded-xl text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/20 transition-all"
                    >
                        <Eye className="w-4 h-4" />
                        Open Full Review
                    </button>
                </>
            )}
        </div>
    )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/DevToolkit/ReviewTab/
git commit -m "feat(toolkit): add ReviewTab with PR selector, AI quick summary, quick actions"
```

---

## Task 10: DevToolkitModal Shell

**Files:**
- Create: `src/components/DevToolkit/DevToolkitModal.jsx`

- [ ] **Step 1: Create DevToolkitModal**

```jsx
// src/components/DevToolkit/DevToolkitModal.jsx
import { useMemo } from 'react'
import { GitCommitHorizontal, GitPullRequest, Eye } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useDevToolkit } from '../../hooks/useDevToolkit'
import { CommitTab } from './CommitTab/CommitTab'
import { PRTab } from './PRTab/PRTab'
import { ReviewTab } from './ReviewTab/ReviewTab'

const TABS = [
    { id: 'commits', label: 'Commits', icon: GitCommitHorizontal },
    { id: 'pr', label: 'Pull Request', icon: GitPullRequest },
    { id: 'review', label: 'Review', icon: Eye },
]

export function DevToolkitModal({ isOpen, onClose, modalData, repos, askAI, onStartReview }) {
    const toolkit = useDevToolkit({
        repos,
        initialTab: modalData?.initialTab,
        initialRepo: modalData?.repo,
        initialBranch: modalData?.branch,
        initialPR: modalData?.pr,
    })

    const content = useMemo(() => {
        switch (toolkit.activeTab) {
            case 'commits':
                return <CommitTab toolkit={toolkit} askAI={askAI} />
            case 'pr':
                return <PRTab toolkit={toolkit} />
            case 'review':
                return <ReviewTab toolkit={toolkit} onStartReview={onStartReview} onClose={onClose} />
            default:
                return null
        }
    }, [toolkit, askAI, onStartReview, onClose])

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Dev Toolkit"
            subtitle="AI-powered developer tools"
            icon={GitCommitHorizontal}
            iconGradient="primary"
            size="3xl"
            tabs={TABS}
            activeTab={toolkit.activeTab}
            onTabChange={toolkit.setActiveTab}
            tabsLayoutId="dev-toolkit-tabs"
            mobileVariant="sheet"
        >
            {content}
        </Modal>
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DevToolkit/DevToolkitModal.jsx
git commit -m "feat(toolkit): add DevToolkitModal shell with tab routing"
```

---

## Task 11: Wire Everything Into App.jsx + Entry Points

**Files:**
- Modify: `src/App.jsx:45,621,931-937`
- Modify: `src/components/Header.jsx:27,132`
- Modify: `src/components/RepoList.jsx:529-531`
- Modify: `src/hooks/useKeyboardShortcuts.js:3-11`
- Modify: `src/components/RepoDetail/PRDetailPanel.jsx:221-230`
- Delete: `src/components/CommitGeneratorModal.jsx`

- [ ] **Step 1: Update App.jsx — replace CommitGeneratorModal with DevToolkitModal**

In `src/App.jsx`:

1. **Line 45** — Replace the lazy import:
```javascript
// Before:
const CommitGeneratorModal = lazy(() => import('./components/CommitGeneratorModal').then(m => ({ default: m.CommitGeneratorModal })))
// After:
const DevToolkitModal = lazy(() => import('./components/DevToolkit/DevToolkitModal').then(m => ({ default: m.DevToolkitModal })))
```

2. **Line 621** — Update Header prop:
```javascript
// Before:
onOpenCommitGen={() => openModal('showCommitGen')}
// After:
onOpenDevToolkit={() => openModal('showDevToolkit')}
```

3. **Lines 931-937** — Replace the modal render:
```jsx
// Before:
<CommitGeneratorModal
    isOpen={modalStates.showCommitGen}
    onClose={() => closeModal('showCommitGen')}
    askAI={askAI}
    repo={getModalData('showCommitGen')?.repo}
    branch={getModalData('showCommitGen')?.branch}
/>
// After:
<DevToolkitModal
    isOpen={modalStates.showDevToolkit}
    onClose={() => closeModal('showDevToolkit')}
    modalData={getModalData('showDevToolkit')}
    repos={repos}
    askAI={askAI}
    onStartReview={(pr) => {
        closeModal('showDevToolkit')
        setReviewingPR(pr)
        setActiveView('pr-review')
    }}
/>
```

- [ ] **Step 2: Update Header.jsx**

In `src/components/Header.jsx`:

1. **Line 27** — Replace prop name:
```javascript
// Before:
onOpenCommitGen,
// After:
onOpenDevToolkit,
```

2. **Line 132** — Update the button:
```jsx
// Before:
<HeaderIconButton onClick={onOpenCommitGen} label="AI Commit Generator" title="AI Commit">
// After:
<HeaderIconButton onClick={onOpenDevToolkit} label="Dev Toolkit" title="Dev Toolkit">
```

- [ ] **Step 3: Update RepoList.jsx context menu**

In `src/components/RepoList.jsx`, line 529-531:

```javascript
// Before:
case 'aiCommit':
    openModalWithData('showCommitGen', { repo: data, branch: null })
    break
// After:
case 'aiCommit':
    openModalWithData('showDevToolkit', { initialTab: 'commits', repo: data })
    break
```

Also add a new case for the PR generation context menu action (search for the context menu items list to add):

```javascript
case 'generatePR':
    openModalWithData('showDevToolkit', { initialTab: 'pr', repo: data })
    break
```

- [ ] **Step 4: Add keyboard shortcut**

In `src/hooks/useKeyboardShortcuts.js`, add to the SHORTCUTS array:

```javascript
{ key: 'g', description: 'Open Dev Toolkit', scope: 'global' },
```

And add the handler in the keydown function:

```javascript
if (key === 'g') {
    onOpenDevToolkit?.()
    return
}
```

Update the hook's parameter to accept `onOpenDevToolkit`.

- [ ] **Step 5: Add "Generate Description" button to PRDetailPanel**

In `src/components/RepoDetail/PRDetailPanel.jsx`, near line 221 (next to the Review button), add:

```jsx
<Button
    size="sm"
    onClick={() => {
        // This will be connected via a prop passed from App.jsx
        onGenerateDescription?.(pr)
    }}
    className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
>
    <Wand2 className="w-4 h-4 mr-1" />
    Generate Description
</Button>
```

Add `Wand2` to the lucide-react imports and `onGenerateDescription` to the props.

- [ ] **Step 6: Delete CommitGeneratorModal.jsx**

Run: `rm src/components/CommitGeneratorModal.jsx`

- [ ] **Step 7: Verify the app starts without errors**

Run: `npx vite build 2>&1 | head -20`
Expected: Build succeeds with no import errors

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/Header.jsx src/components/RepoList.jsx src/hooks/useKeyboardShortcuts.js src/components/RepoDetail/PRDetailPanel.jsx
git rm src/components/CommitGeneratorModal.jsx
git commit -m "feat(toolkit): wire DevToolkit into app, replace CommitGeneratorModal"
```

---

## Task 12: Validation & Cleanup

- [ ] **Step 1: Run all backend tests**

Run: `npx vitest run server/__tests__/ 2>&1 | tail -30`
Expected: All tests pass. If any fail due to the removed `showCommitGen` modal, fix the references.

- [ ] **Step 2: Run all frontend tests**

Run: `npx vitest run tests/ 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 3: Start dev server and test manually**

Run: `npm run dev`

Verify:
1. Click Wand2 icon in header → Dev Toolkit opens on Commits tab
2. Right-click a repo → "AI Commit" → opens Commits tab with repo pre-filled
3. Select a repo → branches load → select two branches → diff summary appears
4. Click Generate → commit message appears in output
5. Click refinement chips → message updates
6. Switch to PR tab → repo/branches persist
7. Generate PR Description → sections appear
8. Copy All works → clipboard has full markdown
9. Switch to Review tab → open PRs list appears
10. Select a PR → AI summary loads
11. Press `g` key → Dev Toolkit opens
12. Press `Escape` → closes
13. On mobile viewport (resize to 400px) → sheet variant appears

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(toolkit): address validation issues from manual testing"
```

---

## Spec Coverage Verification

| Spec Section | Task(s) |
|---|---|
| 1. Overview / Goals | All tasks collectively |
| 2. Architecture & Entry Points | Tasks 5, 10, 11 |
| 3. Tab: Commits | Tasks 1, 6, 7 |
| 4. Tab: Pull Request | Tasks 2, 4, 6, 8 |
| 5. Tab: Review | Task 9 |
| 6. Shared UX Patterns | Task 6 |
| 7. Mobile Experience | Task 10 (mobileVariant="sheet" on Modal) |
| 8. Backend Endpoints | Tasks 1, 2, 3, 4 |
| 9. Component Structure | Tasks 6-10 |
| 10. Migration Plan | Task 11 |
