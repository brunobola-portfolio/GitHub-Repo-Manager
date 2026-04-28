# Suggest Name & Description — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Suggest Name & Description" repo-context-menu entry deliver a real name+description proposal (AI when configured, deterministic fallback otherwise), let the user accept/edit/reject per field, and apply the change via the existing `PATCH /api/v1/repos/:owner/:repo`.

**Architecture:** New dedicated modal `SuggestNameDescriptionModal` opened from two entry points (context menu + SettingsTab button). New backend endpoint `POST /api/ai/suggest-name-description` with AI primary path and pure deterministic fallback in `server/lib/suggest-name-description.js`. Apply uses the existing repos PATCH route (no new endpoint).

**Tech Stack:** React 19 + Vitest + Testing Library, Express + Zod + better-sqlite3, Gemini via `aiProvider`, Tailwind v4 + design-system `ds-*` classes, Framer Motion, Playwright (E2E). All `.jsx` (no TS).

**Spec:** [docs/specs/2026-04-28-suggest-name-description.md](../specs/2026-04-28-suggest-name-description.md)

---

## File map

### New files

| File | Responsibility |
|------|---------------|
| `server/lib/suggest-name-description.js` | Pure deterministic generator. No I/O, no Express. |
| `server/__tests__/suggest-name-description.test.js` | Unit tests for the pure generator. |
| `server/routes/ai/suggest-name-description.js` | Express route — auth + quota + AI/fallback dispatch. |
| `server/__tests__/suggest-name-description-route.test.js` | Route integration tests. |
| `src/components/AI/SuggestNameDescriptionModal.jsx` | Modal component. |
| `tests/components/AI/SuggestNameDescriptionModal.test.jsx` | Component tests. |
| `e2e/suggest-name-description.spec.js` | E2E (mock-mode) smoke. |

### Modified files

| File | Reason |
|------|--------|
| `src/api/ai.js` | Add `suggestNameDescription(repoId)` method. |
| `src/__mocks__/mockAI.js` | Add `mockSuggestNameDescription(repo)` factory. |
| `src/contexts/ModalContext.jsx` | Add `'suggestNameDescription'` to `MODAL_NAMES`. |
| `src/App.jsx` | Render new modal beside `RepoInsightsModal`. |
| `src/components/RepoList/index.jsx` | Reroute `case 'aiSuggest'` to the new modal. |
| `src/components/RepoDetail/SettingsTab.jsx` | Add "Suggest with AI" button in General card. |
| `server/routes/ai.js` | Mount the new sub-router. |
| `CHANGELOG.md` | "Unreleased" entry. |

---

## Task 1: Pure deterministic generator

**Files:**
- Create: `server/lib/suggest-name-description.js`
- Test: `server/__tests__/suggest-name-description.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/suggest-name-description.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { generateDeterministic } from '../lib/suggest-name-description.js';

describe('generateDeterministic', () => {
    it('keeps name when already kebab-case', () => {
        const out = generateDeterministic({
            name: 'my-cool-repo',
            description: '',
            language: 'JavaScript',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.name).toBe('my-cool-repo');
        expect(out.noChange.name).toBe(true);
    });

    it('slugifies a name with spaces, underscores and capitals', () => {
        const out = generateDeterministic({
            name: 'APOS POS_System',
            description: '',
            language: 'C#',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.name).toBe('apos-pos-system');
        expect(out.noChange.name).toBe(false);
    });

    it('strips non-alphanumeric and collapses dashes', () => {
        const out = generateDeterministic({
            name: '!!my  __weird---name??',
            description: '',
            language: null,
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.name).toBe('my-weird-name');
    });

    it('description prefers ai_metadata summary over README and templates', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Python',
            topics: ['ml'],
            readmeExcerpt: '# Foo\n\nA tool.',
            aiMetadata: { summary: 'High-throughput tokenizer for ML pipelines and batch jobs.' },
        });
        expect(out.proposed.description).toBe(
            'High-throughput tokenizer for ML pipelines and batch jobs.',
        );
    });

    it('description ignores ai_metadata summary that starts with "Imported from"', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Python',
            topics: ['ml'],
            readmeExcerpt: '',
            aiMetadata: { summary: 'Imported from https://dev.azure.com/...' },
        });
        expect(out.proposed.description).toBe('Python project for ml');
    });

    it('description falls back to README h1 + first sentence', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'JavaScript',
            topics: [],
            readmeExcerpt: '# Foo\n\nA dashboard for monitoring servers and alerts in real time.',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe(
            'Foo: A dashboard for monitoring servers and alerts in real time.',
        );
    });

    it('description falls back to language + topics template', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Go',
            topics: ['cli', 'logging'],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Go project for cli and logging');
    });

    it('description final fallback is "<Language> repository"', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Rust',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Rust repository');
    });

    it('treats current description starting with "Imported from " as empty', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: 'Imported from https://example.com/bar.git',
            language: 'Go',
            topics: ['cli'],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Go project for cli');
        expect(out.noChange.description).toBe(false);
    });

    it('keeps current description when good and no better candidate exists', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: 'Mature production-grade utility used by 50 teams.',
            language: 'Go',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Mature production-grade utility used by 50 teams.');
        expect(out.noChange.description).toBe(true);
    });

    it('rationale references the sources actually used', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Python',
            topics: ['ml'],
            readmeExcerpt: '# Foo\n\nA tool to do things efficiently and quickly.',
            aiMetadata: null,
        });
        expect(out.rationale).toMatch(/README/i);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/suggest-name-description.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the generator**

Create `server/lib/suggest-name-description.js`:

```javascript
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
    if (heading && heading.toLowerCase() !== name.toLowerCase()) {
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

    // Cascade — first that yields 20-120 chars wins
    const aiSummary = aiMetadata?.summary;
    if (aiSummary && !IMPORTED_PREFIX.test(aiSummary.trim())) {
        const c = clamp(aiSummary, 20, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push('indexed AI metadata');
        }
    }
    if (!proposedDesc) {
        const fromReadme = descriptionFromReadme(name, readmeExcerpt);
        const c = clamp(fromReadme, 20, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push('README');
        }
    }
    if (!proposedDesc) {
        const fromTopics = descriptionFromTopics(language, topics);
        const c = clamp(fromTopics, 20, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push(topics?.length ? 'detected topics' : 'primary language');
        }
    }
    if (!proposedDesc) {
        const fromLang = descriptionFromLanguage(language);
        const c = clamp(fromLang, 20, 120);
        if (c) {
            proposedDesc = c;
            usedSources.push('primary language');
        }
    }

    // If still nothing, keep current (unless it's an import artefact)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/suggest-name-description.test.js`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/lib/suggest-name-description.js server/__tests__/suggest-name-description.test.js
git commit -m "feat(ai): add deterministic name+description generator"
```

---

## Task 2: Server route — AI primary, deterministic fallback

**Files:**
- Create: `server/routes/ai/suggest-name-description.js`
- Test: `server/__tests__/suggest-name-description-route.test.js`
- Modify: `server/routes/ai.js` (mount router)

- [ ] **Step 1: Write the failing route tests**

Create `server/__tests__/suggest-name-description-route.test.js`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Hoisted mocks — must be declared before the route module is imported.
const mockGithubApi = vi.hoisted(() => vi.fn());
const mockProviderGenerate = vi.hoisted(() => vi.fn());
const mockCheckUsageLimit = vi.hoisted(() => vi.fn());
const mockIncrementUsage = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());

vi.mock('../lib/github-api.js', () => ({
    githubApi: mockGithubApi,
}));
vi.mock('../lib/usage-meter.js', () => ({
    checkUsageLimit: mockCheckUsageLimit,
    incrementUsage: mockIncrementUsage,
}));
vi.mock('../lib/audit.js', () => ({
    auditLog: mockAuditLog,
}));
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, accessToken: 'fake' };
            req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            next();
        },
    };
});
vi.mock('../routes/ai/shared.js', () => ({
    requireAI: (req, _res, next) => { req.aiProvider = { generate: mockProviderGenerate }; next(); },
    handleAIError: (res) => res.status(500).json({ error: 'ai-error' }),
}));

const { default: router } = await import('../routes/ai/suggest-name-description.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(router);
    return app;
}

const REPO_PAYLOAD = {
    id: 42,
    name: 'APOS POS',
    full_name: 'org/APOS POS',
    owner: { login: 'org' },
    description: 'Imported from https://example.com',
    language: 'C#',
    topics: ['pos'],
    private: false,
};

beforeEach(() => {
    mockGithubApi.mockReset();
    mockProviderGenerate.mockReset();
    mockCheckUsageLimit.mockReset();
    mockIncrementUsage.mockReset();
    mockAuditLog.mockReset();
    mockCheckUsageLimit.mockReturnValue({ allowed: true, current: 0, limit: 100 });
    // First call: GET repo by id; second: GET README contents
    mockGithubApi.mockImplementation((path) => {
        if (path === '/repositories/42') return { data: REPO_PAYLOAD };
        if (path.includes('/contents/README')) {
            return {
                data: {
                    content: Buffer.from('# Apos\n\nPoint of sale system for restaurant ordering.', 'utf8').toString('base64'),
                    encoding: 'base64',
                },
            };
        }
        return { data: null };
    });
});

describe('POST /ai/suggest-name-description', () => {
    it('returns AI suggestion when provider succeeds', async () => {
        mockProviderGenerate.mockResolvedValue({
            text: JSON.stringify({
                name: 'apos-pos',
                description: 'POS system for restaurant ordering.',
                rationale: 'README-based',
            }),
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('ai');
        expect(res.body.proposed.name).toBe('apos-pos');
        expect(res.body.proposed.description).toBe('POS system for restaurant ordering.');
        expect(res.body.current.description).toBe('Imported from https://example.com');
        expect(res.body.noChange).toEqual({ name: false, description: false });
        expect(mockIncrementUsage).toHaveBeenCalledWith(1, 'ai_queries');
        expect(mockAuditLog).toHaveBeenCalled();
    });

    it('falls back to deterministic when AI parse fails', async () => {
        mockProviderGenerate.mockResolvedValue({ text: 'NOT JSON' });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
        expect(res.body.proposed.name).toBe('apos-pos');
        expect(res.body.proposed.description).toMatch(/Apos.*Point of sale/i);
    });

    it('falls back to deterministic when AI throws', async () => {
        mockProviderGenerate.mockRejectedValue(new Error('boom'));

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('deterministic');
    });

    it('returns 429 when quota exceeded', async () => {
        mockCheckUsageLimit.mockReturnValue({ allowed: false, current: 100, limit: 100 });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(429);
        expect(res.body.upgradeUrl).toBeTruthy();
    });

    it('returns 400 when repoId missing', async () => {
        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({});

        expect(res.status).toBe(400);
    });

    it('returns 404 when repo lookup fails', async () => {
        mockGithubApi.mockImplementation(() => { const e = new Error('not found'); e.status = 404; throw e; });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 999 });

        expect(res.status).toBe(404);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/suggest-name-description-route.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `server/routes/ai/suggest-name-description.js`:

```javascript
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { checkUsageLimit, incrementUsage } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { githubApi } from '../../lib/github-api.js';
import { safeJsonParse } from '../../lib/utils.js';
import { requireAI } from './shared.js';
import { generateDeterministic } from '../../lib/suggest-name-description.js';

const router = express.Router();

const bodySchema = z.object({
    repoId: z.coerce.number().int().positive(),
});

const README_PATH_CANDIDATES = ['README.md', 'README', 'readme.md'];
const README_EXCERPT_BYTES = 1500;

async function fetchRepoMetadata(repoId, accessToken) {
    const { data } = await githubApi(`/repositories/${repoId}`, accessToken);
    return data;
}

async function fetchReadmeExcerpt(owner, name, accessToken) {
    for (const path of README_PATH_CANDIDATES) {
        try {
            const { data } = await githubApi(`/repos/${owner}/${name}/contents/${path}`, accessToken);
            if (data?.content && data?.encoding === 'base64') {
                const decoded = Buffer.from(data.content, 'base64').toString('utf8');
                return decoded.slice(0, README_EXCERPT_BYTES);
            }
        } catch {
            // try the next candidate path
        }
    }
    return '';
}

function buildAIPrompt({ name, description, language, isPrivate, topics, readmeExcerpt }) {
    return [
        'You are renaming a GitHub repo. Given the metadata below, propose:',
        '- name: kebab-case, 3-5 words, descriptive of WHAT it does (not generic).',
        "  Keep current name if already good (don't rename for the sake of it).",
        '- description: ONE sentence, max 120 chars, no marketing fluff,',
        '  starts with a verb or noun (not "A repo that…").',
        '- rationale: 1 sentence explaining what signals you used.',
        '',
        'Return JSON only: { "name": "...", "description": "...", "rationale": "..." }',
        '',
        `Repo: ${name} (${language || 'unknown'}, ${isPrivate ? 'private' : 'public'})`,
        `Current description: ${description || 'none'}`,
        `Topics: ${topics?.length ? topics.join(', ') : 'none'}`,
        `README excerpt: ${readmeExcerpt || 'none'}`,
    ].join('\n');
}

function clampString(s, max) {
    if (typeof s !== 'string') return '';
    const t = s.trim();
    return t.length > max ? t.slice(0, max) : t;
}

function shapeResponse({ source, current, generated }) {
    const proposedName = clampString(generated.proposed.name || current.name, 100);
    const proposedDesc = clampString(generated.proposed.description ?? '', 500);
    return {
        source,
        current: { name: current.name, description: current.description || '' },
        proposed: { name: proposedName, description: proposedDesc },
        rationale: clampString(generated.rationale || 'Suggestion generated.', 280),
        noChange: {
            name: proposedName === current.name,
            description: (proposedDesc || '') === (current.description || ''),
        },
    };
}

router.post(
    '/ai/suggest-name-description',
    requireAuth,
    requireAI,
    validateBody(bodySchema),
    async (req, res) => {
        const userId = req.session.userId;
        const quota = checkUsageLimit(userId, 'ai_queries');
        if (!quota.allowed) {
            return res.status(429).json({
                error: 'AI query limit exceeded',
                limit: quota.limit,
                current: quota.current,
                upgradeUrl: '/pricing',
            });
        }

        const { repoId } = req.validatedBody;
        let repo;
        try {
            repo = await fetchRepoMetadata(repoId, req.session.accessToken);
        } catch (error) {
            const status = error.status || 500;
            req.log.warn({ err: error, repoId }, 'suggest-name-description: repo lookup failed');
            return res.status(status === 404 ? 404 : 500).json({
                error: status === 404 ? 'Repository not found or no access.' : 'Failed to load repository.',
            });
        }

        const owner = repo.owner?.login;
        const name = repo.name;
        const readmeExcerpt = await fetchReadmeExcerpt(owner, name, req.session.accessToken).catch(() => '');

        const generatorInput = {
            name,
            description: repo.description || '',
            language: repo.language || null,
            topics: Array.isArray(repo.topics) ? repo.topics : [],
            readmeExcerpt,
            aiMetadata: null,
        };

        let source = 'deterministic';
        let generated = generateDeterministic(generatorInput);

        try {
            const prompt = buildAIPrompt({
                name,
                description: repo.description,
                language: repo.language,
                isPrivate: !!repo.private,
                topics: generatorInput.topics,
                readmeExcerpt,
            });
            const { text } = await req.aiProvider.generate({ prompt, maxTokens: 200 });
            const parsed = safeJsonParse(text);
            if (
                parsed &&
                typeof parsed.name === 'string' &&
                typeof parsed.description === 'string' &&
                typeof parsed.rationale === 'string'
            ) {
                source = 'ai';
                generated = {
                    proposed: { name: parsed.name, description: parsed.description },
                    rationale: parsed.rationale,
                    // noChange computed downstream in shapeResponse
                    noChange: { name: false, description: false },
                };
            } else {
                req.log.warn({ repoId }, 'suggest-name-description: AI response invalid, using deterministic');
            }
        } catch (error) {
            req.log.warn({ err: error, repoId }, 'suggest-name-description: AI failed, using deterministic');
        }

        incrementUsage(userId, 'ai_queries');
        const body = shapeResponse({
            source,
            current: { name, description: repo.description || '' },
            generated,
        });
        auditLog(req, 'ai.suggest_name_description', 'repo', `${owner}/${name}`, { source });
        return res.json(body);
    },
);

export default router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/suggest-name-description-route.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Mount the new router**

Edit `server/routes/ai.js`:

```javascript
import express from 'express';
import coreRouter from './ai/core.js';
import indexingRouter from './ai/indexing.js';
import devToolkitRouter from './ai/dev-toolkit.js';
import migrationRouter from './ai/migration.js';
import suggestNameDescriptionRouter from './ai/suggest-name-description.js';

const router = express.Router();
router.use(coreRouter);
router.use(indexingRouter);
router.use(devToolkitRouter);
router.use(migrationRouter);
router.use(suggestNameDescriptionRouter);

export default router;
```

Update the docstring at the top of `server/routes/ai.js` to add the new sub-router under "Sub-routers:".

- [ ] **Step 6: Run full backend test suite**

Run: `npx vitest run server/__tests__/`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add server/routes/ai/suggest-name-description.js server/__tests__/suggest-name-description-route.test.js server/routes/ai.js
git commit -m "feat(ai): add /ai/suggest-name-description endpoint"
```

---

## Task 3: Frontend API method + mock

**Files:**
- Modify: `src/__mocks__/mockAI.js`
- Modify: `src/api/ai.js`

- [ ] **Step 1: Add the mock factory**

Append to `src/__mocks__/mockAI.js`:

```javascript
export const mockSuggestNameDescription = (repo) => {
    const currentName = repo?.name || 'unnamed-repo';
    const slug = String(currentName).toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const language = repo?.language || 'Code';
    const topic = repo?.topics?.[0];
    const description = topic
        ? `${language} project for ${topic}`
        : `${language} repository`;
    return {
        source: 'deterministic',
        current: { name: currentName, description: repo?.description || '' },
        proposed: { name: slug || currentName, description },
        rationale: 'Mock-mode deterministic suggestion based on language and topics.',
        noChange: {
            name: (slug || currentName) === currentName,
            description: description === (repo?.description || ''),
        },
    };
};
```

- [ ] **Step 2: Add the API method**

Edit `src/api/ai.js`. Locate the `getSuggestions` method (around line 194) and add the new method directly **after** its closing brace (before `enhanceReadme`):

```javascript
    // Suggest a concrete name + description for the repo. The server returns a
    // unified shape (source: 'ai' | 'deterministic'); the modal renders the
    // same UI either way and decides what to display via `source`.
    suggestNameDescription: async (repoId) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockSuggestNameDescription } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 600));
            // In mock-mode the modal still passes the full repo object,
            // so we emulate the lookup here for the test fixture.
            const fakeRepo = { id: repoId, name: `repo-${repoId}`, language: 'JavaScript', topics: ['demo'] };
            return mockSuggestNameDescription(fakeRepo);
        }

        const res = await fetch(`${API_BASE}/ai/suggest-name-description`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repoId }),
        });
        return handleAIResponse(res, 'suggest-name-description');
    },
```

- [ ] **Step 3: Sanity-check the change compiles**

Run: `npx vitest run --run --reporter=basic src/api 2>/dev/null || true; node -e "import('./src/api/ai.js').then(() => console.log('ok'))"` — actually skip the node import (Vite-only modules). Instead run lint:

Run: `npx eslint src/api/ai.js src/__mocks__/mockAI.js`
Expected: PASS — no errors.

- [ ] **Step 4: Commit**

```bash
git add src/api/ai.js src/__mocks__/mockAI.js
git commit -m "feat(ai): add suggestNameDescription client API and mock"
```

---

## Task 4: Modal component

**Files:**
- Create: `src/components/AI/SuggestNameDescriptionModal.jsx`
- Test: `tests/components/AI/SuggestNameDescriptionModal.test.jsx`

- [ ] **Step 1: Write the failing component tests**

Create `tests/components/AI/SuggestNameDescriptionModal.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SuggestNameDescriptionModal from '../../../src/components/AI/SuggestNameDescriptionModal.jsx';

vi.mock('../../../src/api/ai', () => ({
    aiApi: {
        suggestNameDescription: vi.fn(),
    },
}));
vi.mock('../../../src/api/repos', () => ({
    reposApi: {
        updateRepo: vi.fn(),
    },
}));
vi.mock('../../../src/hooks/useAIStatus', () => ({
    useAIStatus: () => ({ configured: true, keyHealth: 'ok', loading: false }),
}));
vi.mock('../../../src/hooks/useToast', () => ({
    useToast: () => ({ toast: { success: vi.fn(), errorFromException: vi.fn() } }),
}));

import { aiApi } from '../../../src/api/ai';
import { reposApi } from '../../../src/api/repos';

const REPO = {
    id: 42,
    name: 'APOS POS',
    full_name: 'org/APOS POS',
    owner: { login: 'org' },
    description: 'Imported from https://example.com',
};

const SUGGESTION = {
    source: 'ai',
    current: { name: 'APOS POS', description: 'Imported from https://example.com' },
    proposed: { name: 'apos-pos', description: 'POS system for restaurant ordering.' },
    rationale: 'Inferred from README and primary language.',
    noChange: { name: false, description: false },
};

beforeEach(() => {
    aiApi.suggestNameDescription.mockReset();
    reposApi.updateRepo.mockReset();
});

describe('SuggestNameDescriptionModal', () => {
    it('shows skeleton while loading then renders both cards', async () => {
        let resolve;
        aiApi.suggestNameDescription.mockReturnValue(new Promise((r) => { resolve = r; }));

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        expect(screen.getAllByTestId('suggest-skeleton').length).toBeGreaterThan(0);

        resolve(SUGGESTION);
        await waitFor(() => expect(screen.getByDisplayValue('apos-pos')).toBeInTheDocument());
        expect(screen.getByDisplayValue('POS system for restaurant ordering.')).toBeInTheDocument();
        expect(screen.getByText(/Inferred from README/i)).toBeInTheDocument();
    });

    it('disables Apply until rename checkbox is ticked when name changes', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue(SUGGESTION);

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        const applyBtn = await screen.findByRole('button', { name: /Apply changes/i });
        expect(applyBtn).toBeDisabled();

        await user.click(screen.getByLabelText(/I understand renaming changes/i));
        expect(applyBtn).toBeEnabled();
    });

    it('omits a field from the PATCH payload when its toggle is off', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription.mockResolvedValue(SUGGESTION);
        reposApi.updateRepo.mockResolvedValue({});

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);

        await screen.findByDisplayValue('apos-pos');
        // Turn off the name toggle
        await user.click(screen.getByLabelText(/Use this name/i));
        // (No checkbox check needed because name is not changing now)
        await user.click(screen.getByRole('button', { name: /Apply changes/i }));

        await waitFor(() => expect(reposApi.updateRepo).toHaveBeenCalled());
        const [owner, repo, payload] = reposApi.updateRepo.mock.calls[0];
        expect(owner).toBe('org');
        expect(repo).toBe('APOS POS');
        expect(payload).toEqual({ description: 'POS system for restaurant ordering.' });
        expect(payload).not.toHaveProperty('name');
    });

    it('regenerates a new suggestion on click', async () => {
        const user = userEvent.setup();
        aiApi.suggestNameDescription
            .mockResolvedValueOnce(SUGGESTION)
            .mockResolvedValueOnce({ ...SUGGESTION, proposed: { name: 'apos-v2', description: 'New desc' } });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await screen.findByDisplayValue('apos-pos');
        await user.click(screen.getByRole('button', { name: /Regenerate/i }));
        await waitFor(() => expect(screen.getByDisplayValue('apos-v2')).toBeInTheDocument());
    });

    it('collapses to "Already great" when noChange is true for a field', async () => {
        aiApi.suggestNameDescription.mockResolvedValue({
            ...SUGGESTION,
            proposed: { name: 'APOS POS', description: 'POS system for restaurant ordering.' },
            noChange: { name: true, description: false },
        });

        render(<SuggestNameDescriptionModal isOpen repo={REPO} onClose={() => {}} />);
        await screen.findByText(/Name already great/i);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/AI/SuggestNameDescriptionModal.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal**

Create `src/components/AI/SuggestNameDescriptionModal.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { Sparkles, Wand2, Loader2, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react'
import { Modal, ModalFooter } from '../ui/Modal'
import { InsightCard } from '../ui/InsightCard'
import { Button } from '../ui/Button'
import { aiApi } from '../../api/ai'
import { reposApi } from '../../api/repos'
import { useToast } from '../../hooks/useToast'

function SkeletonCard({ height = 120 }) {
    return <div data-testid="suggest-skeleton" className="ds-skeleton rounded-xl" style={{ height }} />
}

function SourceBadge({ source }) {
    const isAI = source === 'ai'
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
            isAI
                ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30'
                : 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/20'
        }`}>
            {isAI ? <Sparkles className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
            {isAI ? 'AI' : 'Heuristic'}
        </span>
    )
}

function FieldCard({
    label,
    currentValue,
    proposedValue,
    onChange,
    useField,
    onToggleUse,
    onRestore,
    multiline = false,
    maxLength,
    noChange,
}) {
    if (noChange) {
        return (
            <InsightCard tone="success" hover={false}>
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    {label} already great — no change suggested.
                </div>
            </InsightCard>
        )
    }
    const Tag = multiline ? 'textarea' : 'input'
    const emptyCurrent = !currentValue
    return (
        <InsightCard hover={false}>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</h3>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={useField}
                        onChange={(e) => onToggleUse(e.target.checked)}
                        className="accent-indigo-500"
                        aria-label={`Use this ${label.toLowerCase()}`}
                    />
                    Use this {label.toLowerCase()}
                </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Current</p>
                    <p className={`text-sm break-words ${emptyCurrent ? 'italic text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {emptyCurrent ? '(no description set)' : currentValue}
                    </p>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <p className="text-[11px] uppercase tracking-wider text-indigo-500">Proposed</p>
                        <button
                            type="button"
                            onClick={onRestore}
                            className="text-[11px] text-slate-500 hover:text-indigo-500 inline-flex items-center gap-1"
                            title="Restore original suggestion"
                        >
                            <RotateCcw className="w-3 h-3" /> Restore
                        </button>
                    </div>
                    <Tag
                        value={proposedValue}
                        onChange={(e) => onChange(e.target.value)}
                        maxLength={maxLength}
                        rows={multiline ? 3 : undefined}
                        disabled={!useField}
                        aria-label={`Proposed ${label.toLowerCase()}`}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-indigo-500/30 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                    />
                </div>
            </div>
        </InsightCard>
    )
}

export default function SuggestNameDescriptionModal({ isOpen, repo, onClose, onApplied }) {
    const { toast } = useToast()
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [applying, setApplying] = useState(false)

    // Editable proposed values + per-field toggle + acknowledged-rename
    const [nameValue, setNameValue] = useState('')
    const [descValue, setDescValue] = useState('')
    const [useName, setUseName] = useState(true)
    const [useDesc, setUseDesc] = useState(true)
    const [ackRename, setAckRename] = useState(false)

    const abortRef = useRef(null)

    const startFetch = async () => {
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setLoading(true)
        setError(null)
        try {
            const result = await aiApi.suggestNameDescription(repo.id)
            if (ctrl.signal.aborted) return
            setData(result)
            setNameValue(result.proposed.name)
            setDescValue(result.proposed.description)
            setUseName(!result.noChange.name)
            setUseDesc(!result.noChange.description)
            setAckRename(false)
        } catch (e) {
            if (ctrl.signal.aborted) return
            setError(e)
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }

    /* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability -- mount-time fetch + reset on repo change */
    useEffect(() => {
        if (!isOpen || !repo) {
            setData(null); setError(null); setLoading(false)
            return
        }
        startFetch()
        return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, repo?.id])
    /* eslint-enable react-hooks/set-state-in-effect, react-hooks/immutability */

    const nameWillChange = useName && data && nameValue !== data.current.name
    const descWillChange = useDesc && data && descValue !== data.current.description
    const applyDisabled =
        applying ||
        loading ||
        !data ||
        (!nameWillChange && !descWillChange) ||
        (nameWillChange && !ackRename)

    const handleApply = async () => {
        if (!data || applyDisabled) return
        const payload = {}
        if (nameWillChange) payload.name = nameValue.trim()
        if (descWillChange) payload.description = descValue.trim()
        setApplying(true)
        try {
            const updated = await reposApi.updateRepo(repo.owner.login, repo.name, payload)
            toast.success('Repository updated')
            onApplied?.(updated)
            onClose?.()
        } catch (e) {
            toast.errorFromException(e, { fallbackTitle: 'Failed to apply changes' })
        } finally {
            setApplying(false)
        }
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Suggest Name & Description"
            subtitle={repo?.full_name}
            icon={Sparkles}
            iconGradient="primary"
            size="2xl"
            mobileVariant="sheet"
            isBusy={loading || applying}
            footer={
                <ModalFooter align="between">
                    <Button variant="ghost" onClick={startFetch} disabled={loading || applying}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                        Regenerate
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose}>Cancel</Button>
                        <button
                            type="button"
                            onClick={handleApply}
                            disabled={applyDisabled}
                            className="ds-btn-shimmer px-6 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-medium rounded-lg hover:from-indigo-400 hover:to-purple-500 transition-all shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {applying ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                            Apply changes
                        </button>
                    </div>
                </ModalFooter>
            }
        >
            <div aria-live="polite" className="sr-only">
                {loading ? 'Generating suggestion…' : data ? 'Suggestion ready.' : ''}
            </div>

            {data && (
                <div className="flex justify-end mb-3">
                    <SourceBadge source={data.source} />
                </div>
            )}

            {loading && (
                <div className="grid gap-4">
                    <SkeletonCard height={130} />
                    <SkeletonCard height={150} />
                    <SkeletonCard height={60} />
                </div>
            )}

            {error && !loading && (
                <InsightCard tone="danger" hover={false}>
                    <p className="text-red-600 dark:text-red-400 text-sm mb-2">Failed to generate a suggestion.</p>
                    <Button variant="ghost" onClick={startFetch}>Retry</Button>
                </InsightCard>
            )}

            {data && !loading && (
                <div className="grid gap-4">
                    <FieldCard
                        label="Name"
                        currentValue={data.current.name}
                        proposedValue={nameValue}
                        onChange={setNameValue}
                        useField={useName}
                        onToggleUse={setUseName}
                        onRestore={() => setNameValue(data.proposed.name)}
                        maxLength={100}
                        noChange={data.noChange.name}
                    />

                    {nameWillChange && (
                        <InsightCard tone="warning" hover={false}>
                            <label className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={ackRename}
                                    onChange={(e) => setAckRename(e.target.checked)}
                                    className="mt-0.5 accent-amber-500"
                                />
                                <span className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                    I understand renaming changes the repo URL and existing clone remotes.
                                </span>
                            </label>
                        </InsightCard>
                    )}

                    <FieldCard
                        label="Description"
                        currentValue={data.current.description}
                        proposedValue={descValue}
                        onChange={setDescValue}
                        useField={useDesc}
                        onToggleUse={setUseDesc}
                        onRestore={() => setDescValue(data.proposed.description)}
                        multiline
                        maxLength={500}
                        noChange={data.noChange.description}
                    />

                    <InsightCard tone="ai" hover={false}>
                        <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <Wand2 className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" />
                            {data.rationale}
                        </div>
                    </InsightCard>
                </div>
            )}
        </Modal>
    )
}
```

- [ ] **Step 4: Run component tests to verify they pass**

Run: `npx vitest run tests/components/AI/SuggestNameDescriptionModal.test.jsx`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/AI/SuggestNameDescriptionModal.jsx tests/components/AI/SuggestNameDescriptionModal.test.jsx
git commit -m "feat(ai): add SuggestNameDescriptionModal component"
```

---

## Task 5: Register the modal in context + App

**Files:**
- Modify: `src/contexts/ModalContext.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Register the modal name**

Edit `src/contexts/ModalContext.jsx`. Add `'suggestNameDescription'` to `MODAL_NAMES`:

```javascript
const MODAL_NAMES = [
  'showCreateRepo',
  'showTransfer',
  'showOrgManager',
  'showDevToolkit',
  'showRepoInsights',
  'showCommunityHealth',
  'showSettings',
  'showMigrationWizard',
  'showMigrationHistory',
  'showConfirm',
  'showBatchIndex',
  'showCompare',
  'showSecurityScan',
  'showLicenseActivation',
  'workBoardHelp',
  'suggestNameDescription',
]
```

- [ ] **Step 2: Add the lazy import in App.jsx**

Edit `src/App.jsx`. Locate the line `const RepoInsightsModal = lazy(...)` (around line 56). Add directly below it:

```javascript
const SuggestNameDescriptionModal = lazy(() => import('./components/AI/SuggestNameDescriptionModal'))
```

- [ ] **Step 3: Render the modal**

Edit `src/App.jsx`. Locate the `RepoInsightsModal` render block (around line 1158) and add the new modal block directly below it (still inside the same JSX parent):

```jsx
      {(() => {
        const sndPayload = getModalData('suggestNameDescription')
        const sndRepo = sndPayload?.repo ?? null
        const sndOnApplied = sndPayload?.onApplied
        return (
          <ErrorBoundary fallback={<ViewErrorFallback viewName="Suggest Name & Description" onGoHome={() => closeModal('suggestNameDescription')} />}>
            <Suspense fallback={null}>
              <SuggestNameDescriptionModal
                isOpen={modalStates.suggestNameDescription}
                onClose={() => closeModal('suggestNameDescription')}
                repo={sndRepo}
                onApplied={(updated) => {
                  sndOnApplied?.(updated)
                  closeModal('suggestNameDescription')
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )
      })()}
```

- [ ] **Step 4: Sanity check — boot the app**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/ModalContext.jsx src/App.jsx
git commit -m "feat(ai): register SuggestNameDescriptionModal in app shell"
```

---

## Task 6: Rewire the context menu

**Files:**
- Modify: `src/components/RepoList/index.jsx`

- [ ] **Step 1: Change the case branch**

Edit `src/components/RepoList/index.jsx`. Locate the `case 'aiSuggest':` branch (around line 219) and replace it:

```javascript
case 'aiSuggest':
    openModalWithData('suggestNameDescription', { repo: data })
    break
```

- [ ] **Step 2: Update the surrounding comment**

Two lines above the rewritten case there's a comment that says "AI context-menu actions route to the right tab in RepoInsightsModal so each menu item feels distinct." Update it to reflect that `aiSuggest` now opens its own dedicated modal:

```javascript
// AI context-menu actions: aiQuality routes to the Insights modal Quality tab,
// aiSuggest opens the dedicated SuggestNameDescription modal, and the rest
// open their own focused surfaces.
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev` (and visit the repos page; right-click a repo card → AI → Suggest Name & Description; the new modal opens.)

Skip if running headless — covered by Task 8 E2E.

- [ ] **Step 4: Commit**

```bash
git add src/components/RepoList/index.jsx
git commit -m "feat(ai): rewire context-menu Suggest Name & Description to dedicated modal"
```

---

## Task 7: SettingsTab entry point

**Files:**
- Modify: `src/components/RepoDetail/SettingsTab.jsx`

- [ ] **Step 1: Add modal hook + button**

Edit `src/components/RepoDetail/SettingsTab.jsx`.

At the top, add the modal hook import (next to the existing imports — around line 1-12). The file already imports `useState` and `Sparkles`, so only the modal hook is new:

```javascript
import { useModal } from '../../hooks/useModal'
```

Inside the `SettingsTab` function (right after `const aiStatus = useAIStatus()` around line 16) add:

```javascript
const { openModalWithData } = useModal()
```

In the `General` Card header (the JSX `<h3>` with `<Settings className="w-5 h-5 text-indigo-500" /> General` around line 182), wrap it with a flex container and add the button on the right. Replace the `<h3>...</h3>` block with:

```jsx
<div className="flex items-center justify-between">
    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
        <Settings className="w-5 h-5 text-indigo-500" /> General
    </h3>
    <button
        type="button"
        onClick={() => openModalWithData('suggestNameDescription', {
            repo: { ...repoData, owner: repoData.owner || { login: owner } },
            onApplied: (updated) => onUpdate?.((prev) => ({ ...prev, ...updated })),
        })}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-indigo-500/10 to-purple-500/10 hover:from-indigo-500/20 hover:to-purple-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 transition-colors"
    >
        <Sparkles className="w-3.5 h-3.5" /> Suggest with AI
    </button>
</div>
```

- [ ] **Step 2: Run existing SettingsTab tests**

Run: `npx vitest run tests/components/RepoDetail`
Expected: PASS — no regressions in existing tests.

- [ ] **Step 3: Commit**

```bash
git add src/components/RepoDetail/SettingsTab.jsx
git commit -m "feat(repo-detail): add 'Suggest with AI' button to Settings tab"
```

---

## Task 8: E2E smoke test (mock-mode)

**Files:**
- Create: `e2e/suggest-name-description.spec.js`

- [ ] **Step 1: Inspect existing E2E patterns**

Run: `ls e2e/` and read one existing spec (e.g. `e2e/context-menu-wave-1.spec.js`) to confirm the project's helpers (`page.goto('/')`, mock-mode toggling, login bypass).

- [ ] **Step 2: Write the spec**

Create `e2e/suggest-name-description.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

// Mock-mode is enabled via VITE_MOCK_MODE=true in the test env (see e2e config).
// In mock-mode the suggestion API returns a deterministic shape and the PATCH
// is intercepted by the mock router as a no-op success.

test.describe('Suggest Name & Description', () => {
    test('opens from context menu, applies, shows toast', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /Repositories/i }).click();

        // Right-click on the first repo card to open the context menu.
        const card = page.locator('[data-testid^="repo-card"]').first();
        await card.click({ button: 'right' });

        // Navigate AI → Suggest Name & Description
        await page.getByRole('menuitem', { name: /AI/i }).hover();
        await page.getByRole('menuitem', { name: /Suggest Name & Description/i }).click();

        // Modal renders with a proposed name input
        await expect(page.getByRole('heading', { name: /Suggest Name & Description/i })).toBeVisible();
        const proposedName = page.getByLabel(/Proposed name/i);
        await expect(proposedName).toBeVisible();
        await expect(proposedName).not.toHaveValue('');

        // Tick the rename acknowledgement (mock data renames the repo)
        await page.getByLabel(/I understand renaming/i).check();

        // Apply
        await page.getByRole('button', { name: /Apply changes/i }).click();
        await expect(page.getByText(/Repository updated/i)).toBeVisible();
    });
});
```

- [ ] **Step 3: Run E2E**

Run: `npx playwright test e2e/suggest-name-description.spec.js`
Expected: PASS.

> **Note:** if the smoke fails because the mock-mode `updateRepo` route isn't intercepted, add a stub there. Check `src/__mocks__/mockRepos.js` for an existing pattern; mirror it.

- [ ] **Step 4: Commit**

```bash
git add e2e/suggest-name-description.spec.js
git commit -m "test(e2e): smoke test Suggest Name & Description happy path"
```

---

## Task 9: CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add Unreleased entry**

Edit `CHANGELOG.md`. Under the "Unreleased" section (or create one if missing) add:

```markdown
### Added
- **Suggest Name & Description** now delivers on its label: a dedicated modal proposes a concrete name and description, lets you accept/edit/reject per field, and applies via the existing repos PATCH endpoint. Works with or without an AI key — falls back to a deterministic generator (README + topics + language + AI metadata if indexed). Available from the repo context menu and the Settings tab.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Suggest Name & Description rewrite"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — 0 failures.

- [ ] **Run lint**

Run: `npx eslint .`
Expected: 0 errors.

- [ ] **Build**

Run: `npm run build`
Expected: succeeds with no errors and no new warnings.

- [ ] **Push** (only if user explicitly asks — per `feedback_avoid_long_local_tests` and `feedback_push_on_request` memories, prefer pushing once and letting CI run the long suites).

---

## Self-review checklist (already done by plan author)

- ✅ **Spec coverage:** All seven goals (concrete name+desc, AI+deterministic, per-field accept, real PATCH, two entry points) map to tasks.
- ✅ **Files match spec:** new files match the "Files" table in the spec exactly. Modified files match.
- ✅ **No placeholders:** every step has either an exact code block or an exact command + expected output.
- ✅ **Type/name consistency:** `suggestNameDescription` (camelCase) used in API/method, `'suggestNameDescription'` (string) used as modal name across context + App + RepoList. No drift.
- ✅ **Endpoint contract matches spec:** `{source, current, proposed, rationale, noChange}`. `source` is `'ai' | 'deterministic'`. 429 includes `upgradeUrl`.
- ✅ **Rate-limit consistency:** route uses `checkUsageLimit` + `incrementUsage` against `'ai_queries'`, exactly as the spec note states.
- ✅ **TDD ordering:** every task that adds code writes the failing test first, runs it, then implements, then re-runs.
