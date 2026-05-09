# Premium Context-Aware Name & Description Suggestions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the quality and trust of AI-suggested repo names and descriptions by feeding the AI a configurable, multi-signal view of the repo (manifest, entrypoints, folder structure, custom files), bounded by an 8 KB hard cap, with server-side secret redaction and a confidence score visible to the user.

**Architecture:** A shared backend pipeline (`repo-context-builder.js` + `secret-redactor.js`) produces a structured context block that both the single-repo route and the existing batch flow consume via the same `/ai/suggest-name-description` endpoint. The frontend gains a shared `<ContextPicker />` (single + batch modes), a `<FileTreePicker />` for power users, and a `<PremiumRationale />` block that surfaces signals used + redactions + confidence.

**Tech Stack:** Node 20 + Express 5 + better-sqlite3 + Zod (backend); React 19 + Vite + Tailwind v4 + Framer Motion (frontend); Vitest + Supertest + Playwright (tests).

**Spec:** [docs/specs/2026-05-09-premium-suggest-context.md](../specs/2026-05-09-premium-suggest-context.md)

---

## File Structure

### Backend

| File | Purpose |
| --- | --- |
| `server/lib/secret-redactor.js` (new) | Pure module — redact lines matching the secret regex set, return cleaned content + count. |
| `server/lib/repo-context-builder.js` (new) | Pure-ish module — orchestrates GitHub fetches per signal, applies byte cap, runs redactor, computes confidence, returns structured `sections`. |
| `server/lib/ai-prompt-registry.js` (modify) | Add `signals_block` variable to `suggest_name_description`; update default prompt to consume it. |
| `server/routes/ai/suggest-name-description.js` (modify) | Accept `context` body field, delegate fetches to `buildContext()`, enrich response with `confidence`, `signalsUsed`, `redactions`. |
| `server/routes/repos/tree.js` (new) | `GET /api/repos/:owner/:name/tree?branch=...` wrapping GitHub `/git/trees/:sha?recursive=1`. |
| `server/routes/repos/index.js` (modify, if it exists) | Mount the tree router. |

### Frontend

| File | Purpose |
| --- | --- |
| `src/hooks/useContextPrefs.js` (new) | `localStorage` wrapper for `ai-context-prefs-v1`. |
| `src/components/AI/ContextPicker.jsx` (new) | Toggles + byte meter; modes `single` and `batch`. |
| `src/components/AI/FileTreePicker.jsx` (new) | Tree browser with search; single-mode only. |
| `src/components/AI/PremiumRationale.jsx` (new) | Confidence pill + rationale + signal chips + redaction notice. |
| `src/api/repos.js` (modify) | New `reposApi.getTree(owner, name, branch)` wrapper. |
| `src/api/ai.js` (modify) | Thread optional `context` arg through `suggestNameDescription`. |
| `src/components/AI/SuggestNameDescriptionModal.jsx` (modify) | Embed `<ContextPicker mode="single">` + `<PremiumRationale />`. |
| `src/components/AIPolish/PolishReview.jsx` (modify) | Embed `<ContextPicker mode="batch">` + per-row confidence dot. |
| `src/hooks/useAIPolish.js` (modify) | Accept `context` arg, thread through per-repo calls, expose per-row confidence. |

### Tests

| File | Notes |
| --- | --- |
| `server/__tests__/secret-redactor.test.js` (new) | Pure unit tests. |
| `server/__tests__/repo-context-builder.test.js` (new) | Mocks `githubApi`. |
| `server/__tests__/suggest-name-description-context.test.js` (new) | Extends existing route tests with the new `context` shape. |
| `server/__tests__/repos-tree-route.test.js` (new) | Supertest, mocks `githubApi`. |
| `tests/hooks/useContextPrefs.test.js` (new) | RTL + jsdom localStorage. |
| `tests/components/AI/ContextPicker.test.jsx` (new) | Toggles + meter. |
| `tests/components/AI/FileTreePicker.test.jsx` (new) | Tree render + search + cap. |
| `tests/components/AI/PremiumRationale.test.jsx` (new) | Confidence + redaction notice. |
| `tests/components/AI/SuggestNameDescriptionModal.test.jsx` (modify) | Picker integrated, payload shape. |
| `tests/components/AIPolish/PolishReview.test.jsx` (modify) | Picker drives all rows; confidence dot. |
| `tests/hooks/useAIPolish.test.js` (modify) | Accepts and forwards `context`. |
| `e2e/suggest-name-description-premium.spec.js` (new) | Single-repo golden path + budget error. |

---

## Phase 1 — Backend Foundations

### Task 1: `secret-redactor.js`

**Files:**
- Create: `server/lib/secret-redactor.js`
- Test: `server/__tests__/secret-redactor.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/secret-redactor.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { redact, SECRET_REGEX } from '../lib/secret-redactor.js';

describe('redact', () => {
    it('returns content unchanged when no secrets present', () => {
        const out = redact('line one\nline two\n');
        expect(out.content).toBe('line one\nline two\n');
        expect(out.count).toBe(0);
    });

    it('redacts a line containing api_key', () => {
        const out = redact('foo\napi_key=abc123\nbar');
        expect(out.content).toBe('foo\n[REDACTED — possible secret]\nbar');
        expect(out.count).toBe(1);
    });

    it('redacts ghp_ classic tokens', () => {
        const long = 'a'.repeat(36);
        const out = redact(`x: ghp_${long}`);
        expect(out.content).toBe('[REDACTED — possible secret]');
        expect(out.count).toBe(1);
    });

    it('redacts sk- secret tokens', () => {
        const out = redact('OPENAI=sk-abcdefghijklmnopqrstuvwx');
        expect(out.count).toBe(1);
    });

    it('redacts Slack xoxb tokens', () => {
        const out = redact('SLACK=xoxb-1234567890');
        expect(out.count).toBe(1);
    });

    it('redacts bearer tokens', () => {
        const out = redact('Authorization: bearer abc.def.ghi');
        expect(out.count).toBe(1);
    });

    it('counts each redacted line once even with multiple matches on the same line', () => {
        const out = redact('api_key=1 secret=2 token=3');
        expect(out.count).toBe(1);
    });

    it('handles empty / non-string input', () => {
        expect(redact('')).toEqual({ content: '', count: 0 });
        expect(redact(null)).toEqual({ content: '', count: 0 });
    });

    it('preserves line endings (LF)', () => {
        const out = redact('a\nb\nc');
        expect(out.content).toBe('a\nb\nc');
    });

    it('exports SECRET_REGEX for inspection', () => {
        expect(SECRET_REGEX).toBeInstanceOf(RegExp);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/secret-redactor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `server/lib/secret-redactor.js`:

```js
/*
 * GitHub Repo Manager - Secret Redactor
 *
 * Line-by-line redaction of obviously-secret-looking content. Runs over
 * every fetched file before it leaves the server toward the AI provider.
 * Conservative on purpose: false-positive a few legitimate lines rather
 * than leak a real key.
 *
 * Returns { content, count } — count is the number of redacted lines (not
 * matches), so a single line with three "secret" hits counts as one.
 */

export const SECRET_REGEX = /(api[_-]?key|secret|token|password|aws_access|bearer\s+\w+|sk-[\w-]{20,}|ghp_\w{36}|github_pat_\w+|xox[baprs]-\w+)/i;

const REDACTED = '[REDACTED — possible secret]';

export function redact(content) {
    if (typeof content !== 'string' || content.length === 0) {
        return { content: '', count: 0 };
    }
    let count = 0;
    const lines = content.split(/\r?\n/);
    const out = lines.map((line) => {
        if (SECRET_REGEX.test(line)) {
            count += 1;
            return REDACTED;
        }
        return line;
    });
    return { content: out.join('\n'), count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/secret-redactor.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/secret-redactor.js server/__tests__/secret-redactor.test.js
git commit -m "feat(ai): add secret-redactor for repo-context pipeline"
```

---

### Task 2: `repo-context-builder.js` — manifest detection

**Files:**
- Create: `server/lib/repo-context-builder.js`
- Test: `server/__tests__/repo-context-builder.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/repo-context-builder.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockGithubApi = vi.hoisted(() => vi.fn());
vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));

const { buildContext } = await import('../lib/repo-context-builder.js');

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

function mockContents(map) {
    // map: path -> content (string) or null for 404
    mockGithubApi.mockImplementation(async (url) => {
        const m = url.match(/\/contents\/([^?]+)/);
        if (!m) throw Object.assign(new Error('unexpected url'), { status: 500 });
        const path = decodeURIComponent(m[1]);
        if (path in map) {
            const content = map[path];
            if (content === null) {
                const err = new Error('Not Found'); err.status = 404; throw err;
            }
            return { data: { encoding: 'base64', content: b64(content) } };
        }
        const err = new Error('Not Found'); err.status = 404; throw err;
    });
}

beforeEach(() => mockGithubApi.mockReset());

describe('buildContext — manifest detection', () => {
    it('detects package.json with first-match priority', async () => {
        mockContents({
            'package.json': '{"name":"x","scripts":{"build":"vite"}}',
            'pyproject.toml': '[project]\nname = "x"',
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        const manifest = ctx.sections.find((s) => s.kind === 'manifest');
        expect(manifest).toBeTruthy();
        expect(manifest.label).toBe('package.json');
        expect(manifest.content).toContain('"build":"vite"');
    });

    it('falls through to pyproject.toml when no package.json', async () => {
        mockContents({
            'package.json': null,
            'pyproject.toml': '[project]\nname = "thing"',
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        const manifest = ctx.sections.find((s) => s.kind === 'manifest');
        expect(manifest.label).toBe('pyproject.toml');
    });

    it('returns no manifest section when none found', async () => {
        mockContents({}); // every probe 404s
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        expect(ctx.sections.find((s) => s.kind === 'manifest')).toBeUndefined();
    });

    it('does NOT fetch manifest when signal is off', async () => {
        mockContents({ 'package.json': '{"name":"x"}' });
        await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: false, readme: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: [],
        });
        // No /contents/ call at all
        expect(mockGithubApi.mock.calls.find((c) => c[0].includes('/contents/'))).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `server/lib/repo-context-builder.js`:

```js
/*
 * GitHub Repo Manager - Repo Context Builder
 *
 * Orchestrates per-signal GitHub fetches for the AI suggest pipeline.
 * Returns a structured `sections` array bounded by an overall byte cap,
 * with line-level secret redaction applied to every fetched payload.
 *
 * Pure-ish: requires the GitHub access token + helper, but contains no
 * Express, no DB, no logger side-effects.
 */

import { githubApi } from './github-api.js';
import { redact } from './secret-redactor.js';
import logger from './logger.js';

const DEFAULT_BYTE_CAP = 8192;

const MANIFEST_CANDIDATES = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'Gemfile',
    'composer.json',
];

const SIGNAL_BUDGETS = {
    readme: 3072,
    manifest: 1536,
    entrypoints: 1536,
    folderStructure: 512,
    topicsLanguage: 256,
};

async function fetchTextFile(owner, repo, path, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
        return null;
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo, path }, 'repo-context-builder: file fetch failed');
        return null;
    }
}

async function fetchManifest(owner, repo, accessToken) {
    for (const candidate of MANIFEST_CANDIDATES) {
        const content = await fetchTextFile(owner, repo, candidate, accessToken);
        if (typeof content === 'string') return { label: candidate, content };
    }
    return null;
}

function pushSection(sections, { kind, label, content, byteCap }) {
    const truncated = content.slice(0, byteCap);
    const { content: cleaned, count } = redact(truncated);
    sections.push({
        kind,
        label,
        content: cleaned,
        bytes: cleaned.length,
        redactions: count,
    });
}

export async function buildContext({
    accessToken,
    owner,
    repo,
    signals = {},
    customFiles = [],
    byteCap = DEFAULT_BYTE_CAP,
}) {
    const sections = [];

    if (signals.manifest) {
        const manifest = await fetchManifest(owner, repo, accessToken);
        if (manifest) {
            pushSection(sections, {
                kind: 'manifest',
                label: manifest.label,
                content: manifest.content,
                byteCap: SIGNAL_BUDGETS.manifest,
            });
        }
    }

    return {
        sections,
        totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
        confidence: 'low',
        signalsUsed: sections.map((s) => ({ kind: s.kind, label: s.label, bytes: s.bytes })),
        redactions: sections.filter((s) => s.redactions > 0).map((s) => ({ file: s.label, count: s.redactions })),
        byteCap,
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/lib/repo-context-builder.js server/__tests__/repo-context-builder.test.js
git commit -m "feat(ai): add repo-context-builder with manifest detection"
```

---

### Task 3: `repo-context-builder.js` — README + topics/language + confidence

**Files:**
- Modify: `server/lib/repo-context-builder.js`
- Modify: `server/__tests__/repo-context-builder.test.js`

- [ ] **Step 1: Append failing tests**

Append to `server/__tests__/repo-context-builder.test.js`:

```js
describe('buildContext — README and metadata signals', () => {
    it('includes README via /readme endpoint when signal on', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.endsWith('/readme')) {
                return { data: { encoding: 'base64', content: b64('# Hello\nA tool for testing.') } };
            }
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { readme: true },
            customFiles: [],
            topicsLanguageInputs: { topics: [], language: null },
        });
        const readme = ctx.sections.find((s) => s.kind === 'readme');
        expect(readme.content).toContain('Hello');
    });

    it('truncates README to 3 KB cap', async () => {
        const big = 'x'.repeat(10_000);
        mockGithubApi.mockImplementation(async (url) => {
            if (url.endsWith('/readme')) return { data: { encoding: 'base64', content: b64(big) } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { readme: true },
            customFiles: [],
            topicsLanguageInputs: { topics: [], language: null },
        });
        expect(ctx.sections[0].bytes).toBe(3072);
    });

    it('emits topicsLanguage section from inputs (no fetch)', async () => {
        mockGithubApi.mockResolvedValue({ data: { content: '', encoding: 'base64' } });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { topics: true, language: true },
            customFiles: [],
            topicsLanguageInputs: { topics: ['cli', 'openapi'], language: 'TypeScript' },
        });
        const tl = ctx.sections.find((s) => s.kind === 'topicsLanguage');
        expect(tl.content).toMatch(/cli/);
        expect(tl.content).toMatch(/TypeScript/);
        // No GitHub call at all (topicsLanguage is pure data from caller)
        expect(mockGithubApi).not.toHaveBeenCalled();
    });

    it('confidence = high when README ≥ 500 B + manifest + topics', async () => {
        const longReadme = 'sentence. '.repeat(80); // ~720 chars
        mockGithubApi.mockImplementation(async (url) => {
            if (url.endsWith('/readme')) return { data: { encoding: 'base64', content: b64(longReadme) } };
            if (url.includes('/contents/package.json')) return { data: { encoding: 'base64', content: b64('{"name":"x"}') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { readme: true, manifest: true, topics: true, language: true },
            customFiles: [],
            topicsLanguageInputs: { topics: ['cli'], language: 'JavaScript' },
        });
        expect(ctx.confidence).toBe('high');
    });

    it('confidence = medium when only README short OR manifest', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/contents/package.json')) return { data: { encoding: 'base64', content: b64('{"name":"x"}') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { manifest: true },
            customFiles: [],
            topicsLanguageInputs: { topics: [], language: null },
        });
        expect(ctx.confidence).toBe('medium');
    });

    it('confidence = low when only metadata, no README, no manifest', async () => {
        mockGithubApi.mockResolvedValue({ data: { content: '', encoding: 'base64' } });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { topics: true, language: true },
            customFiles: [],
            topicsLanguageInputs: { topics: ['x'], language: 'Go' },
        });
        expect(ctx.confidence).toBe('low');
    });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: 4 PASS (from Task 2), 6 FAIL (new).

- [ ] **Step 3: Extend the implementation**

Edit `server/lib/repo-context-builder.js`. Add the README fetcher and the topicsLanguage formatter, then wire confidence:

Replace the existing exported `buildContext` body and add helpers above. Final file shape:

```js
import { githubApi } from './github-api.js';
import { redact } from './secret-redactor.js';
import logger from './logger.js';

const DEFAULT_BYTE_CAP = 8192;

const MANIFEST_CANDIDATES = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'Gemfile',
    'composer.json',
];

const SIGNAL_BUDGETS = {
    readme: 3072,
    manifest: 1536,
    entrypoints: 1536,
    folderStructure: 512,
    topicsLanguage: 256,
};

async function fetchTextFile(owner, repo, path, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
        return null;
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo, path }, 'repo-context-builder: file fetch failed');
        return null;
    }
}

async function fetchReadme(owner, repo, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'repo-context-builder: README fetch failed');
    }
    return null;
}

async function fetchManifest(owner, repo, accessToken) {
    for (const candidate of MANIFEST_CANDIDATES) {
        const content = await fetchTextFile(owner, repo, candidate, accessToken);
        if (typeof content === 'string') return { label: candidate, content };
    }
    return null;
}

function pushSection(sections, { kind, label, content, byteCap }) {
    const truncated = content.slice(0, byteCap);
    const { content: cleaned, count } = redact(truncated);
    sections.push({
        kind,
        label,
        content: cleaned,
        bytes: cleaned.length,
        redactions: count,
    });
}

function topicsLanguageContent({ topics, language }) {
    const parts = [];
    if (language) parts.push(`language: ${language}`);
    if (Array.isArray(topics) && topics.length) parts.push(`topics: ${topics.slice(0, 10).join(', ')}`);
    return parts.join('\n');
}

function computeConfidence({ readmeBytes, manifestPresent, topicsPresent, languagePresent }) {
    if (readmeBytes >= 500 && manifestPresent && (topicsPresent || languagePresent)) return 'high';
    if (readmeBytes >= 100 || manifestPresent) return 'medium';
    return 'low';
}

export async function buildContext({
    accessToken,
    owner,
    repo,
    signals = {},
    customFiles = [],
    byteCap = DEFAULT_BYTE_CAP,
    topicsLanguageInputs = { topics: [], language: null },
}) {
    const sections = [];
    let readmeBytes = 0;

    if (signals.readme) {
        const readme = await fetchReadme(owner, repo, accessToken);
        if (typeof readme === 'string') {
            pushSection(sections, {
                kind: 'readme',
                label: 'README',
                content: readme,
                byteCap: SIGNAL_BUDGETS.readme,
            });
            readmeBytes = sections.at(-1).bytes;
        }
    }

    let manifestPresent = false;
    if (signals.manifest) {
        const manifest = await fetchManifest(owner, repo, accessToken);
        if (manifest) {
            manifestPresent = true;
            pushSection(sections, {
                kind: 'manifest',
                label: manifest.label,
                content: manifest.content,
                byteCap: SIGNAL_BUDGETS.manifest,
            });
        }
    }

    const topicsPresent = Array.isArray(topicsLanguageInputs.topics) && topicsLanguageInputs.topics.length > 0;
    const languagePresent = !!topicsLanguageInputs.language;
    if ((signals.topics && topicsPresent) || (signals.language && languagePresent)) {
        const content = topicsLanguageContent({
            topics: signals.topics ? topicsLanguageInputs.topics : [],
            language: signals.language ? topicsLanguageInputs.language : null,
        });
        if (content) {
            pushSection(sections, {
                kind: 'topicsLanguage',
                label: 'topics + language',
                content,
                byteCap: SIGNAL_BUDGETS.topicsLanguage,
            });
        }
    }

    return {
        sections,
        totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
        confidence: computeConfidence({
            readmeBytes,
            manifestPresent,
            topicsPresent: signals.topics && topicsPresent,
            languagePresent: signals.language && languagePresent,
        }),
        signalsUsed: sections.map((s) => ({ kind: s.kind, label: s.label, bytes: s.bytes })),
        redactions: sections.filter((s) => s.redactions > 0).map((s) => ({ file: s.label, count: s.redactions })),
        byteCap,
    };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/repo-context-builder.js server/__tests__/repo-context-builder.test.js
git commit -m "feat(ai): repo-context-builder README + topics/language + confidence"
```

---

### Task 4: `repo-context-builder.js` — entrypoints + folder structure

**Files:**
- Modify: `server/lib/repo-context-builder.js`
- Modify: `server/__tests__/repo-context-builder.test.js`

- [ ] **Step 1: Append failing tests**

Append to `server/__tests__/repo-context-builder.test.js`:

```js
describe('buildContext — entrypoints and folder structure', () => {
    it('fetches up to 3 entrypoint candidates (head only)', async () => {
        mockContents({
            'src/index.js': '// large file '.repeat(200),
            'src/main.js': null,
            'src/app.js': null,
            'app/__init__.py': null,
            'cmd/main.go': null,
            'main.py': null,
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { entrypoints: true },
            customFiles: [],
            topicsLanguageInputs: { topics: [], language: null },
        });
        const ep = ctx.sections.find((s) => s.kind === 'entrypoints');
        expect(ep).toBeTruthy();
        expect(ep.bytes).toBeLessThanOrEqual(1536);
        expect(ep.label).toBe('src/index.js'); // single match in this case
    });

    it('skips entrypoint signal entirely when off (no GitHub calls)', async () => {
        mockContents({ 'src/index.js': 'x' });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { entrypoints: false },
            customFiles: [],
            topicsLanguageInputs: { topics: [], language: null },
        });
        expect(ctx.sections.find((s) => s.kind === 'entrypoints')).toBeUndefined();
        expect(mockGithubApi.mock.calls.find((c) => c[0].includes('src/index.js'))).toBeUndefined();
    });

    it('emits folderStructure section listing top-level directories', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            // Top-level listing — `path` portion empty.
            if (url.match(/\/contents\/?$/) || url.match(/\/contents\/\?/)) {
                return { data: [
                    { name: 'src', type: 'dir' },
                    { name: 'tests', type: 'dir' },
                    { name: 'README.md', type: 'file' },
                ] };
            }
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { folderStructure: true },
            customFiles: [],
            topicsLanguageInputs: { topics: [], language: null },
        });
        const folder = ctx.sections.find((s) => s.kind === 'folderStructure');
        expect(folder.content).toContain('src');
        expect(folder.content).toContain('tests');
        expect(folder.content).not.toContain('README.md');
    });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: 10 PASS, 3 FAIL.

- [ ] **Step 3: Extend the implementation**

Edit `server/lib/repo-context-builder.js`. Add the helpers and wire two more signal blocks before the `return` statement.

Add near the top of the file, after `MANIFEST_CANDIDATES`:

```js
const ENTRYPOINT_CANDIDATES = [
    'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
    'src/app.js', 'src/app.ts',
    'index.js', 'index.ts',
    'main.py', 'app.py', 'app/__init__.py',
    'cmd/main.go', 'main.go',
    'src/main/java/Main.java',
    'src/main.rs',
];

const ENTRYPOINT_PER_FILE_CAP = 512;
const ENTRYPOINT_MAX_FILES = 3;
```

Add helper functions before `pushSection`:

```js
async function fetchEntrypoints(owner, repo, accessToken) {
    const found = [];
    for (const path of ENTRYPOINT_CANDIDATES) {
        if (found.length >= ENTRYPOINT_MAX_FILES) break;
        const content = await fetchTextFile(owner, repo, path, accessToken);
        if (typeof content === 'string') found.push({ path, content });
    }
    return found;
}

async function fetchTopLevelDirs(owner, repo, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/`, accessToken);
        if (Array.isArray(data)) {
            return data.filter((e) => e?.type === 'dir').map((e) => e.name);
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'repo-context-builder: top-level listing failed');
    }
    return [];
}
```

Insert into `buildContext`, after the manifest block and before topicsLanguage:

```js
    if (signals.entrypoints) {
        const entries = await fetchEntrypoints(owner, repo, accessToken);
        if (entries.length > 0) {
            const combined = entries
                .map((e) => `--- ${e.path} ---\n${e.content.slice(0, ENTRYPOINT_PER_FILE_CAP)}`)
                .join('\n\n');
            pushSection(sections, {
                kind: 'entrypoints',
                label: entries.length === 1 ? entries[0].path : `${entries.length} entrypoints`,
                content: combined,
                byteCap: SIGNAL_BUDGETS.entrypoints,
            });
        }
    }

    if (signals.folderStructure) {
        const dirs = await fetchTopLevelDirs(owner, repo, accessToken);
        if (dirs.length > 0) {
            pushSection(sections, {
                kind: 'folderStructure',
                label: 'top-level dirs',
                content: dirs.slice(0, 50).join('\n'),
                byteCap: SIGNAL_BUDGETS.folderStructure,
            });
        }
    }
```

Note: when there's exactly one entrypoint match, the label uses the file path so the test assertion `expect(ep.label).toBe('src/index.js')` is satisfied.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: 13 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/repo-context-builder.js server/__tests__/repo-context-builder.test.js
git commit -m "feat(ai): repo-context-builder entrypoints + folder structure"
```

---

### Task 5: `repo-context-builder.js` — custom files + over-budget rejection

**Files:**
- Modify: `server/lib/repo-context-builder.js`
- Modify: `server/__tests__/repo-context-builder.test.js`

- [ ] **Step 1: Append failing tests**

Append to `server/__tests__/repo-context-builder.test.js`:

```js
describe('buildContext — custom files', () => {
    it('fetches each custom file and divides remaining budget equally', async () => {
        mockContents({
            'docs/architecture.md': 'A'.repeat(2000),
            'examples/main.py': 'B'.repeat(2000),
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: { readme: false, manifest: false, topics: false, language: false, entrypoints: false, folderStructure: false },
            customFiles: ['docs/architecture.md', 'examples/main.py'],
            topicsLanguageInputs: { topics: [], language: null },
            byteCap: 8192,
        });
        const customs = ctx.sections.filter((s) => s.kind === 'customFile');
        expect(customs).toHaveLength(2);
        // Full 8 KB available for two files = 4 KB each cap; content is 2 KB so untruncated
        expect(customs[0].bytes).toBe(2000);
        expect(customs[1].bytes).toBe(2000);
    });

    it('drops custom files that 404 and reports them via skippedCustomFiles', async () => {
        mockContents({
            'present.md': 'hello',
            'missing.md': null,
        });
        const ctx = await buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: {},
            customFiles: ['present.md', 'missing.md'],
            topicsLanguageInputs: { topics: [], language: null },
        });
        expect(ctx.sections.filter((s) => s.kind === 'customFile')).toHaveLength(1);
        expect(ctx.skippedCustomFiles).toEqual(['missing.md']);
    });

    it('throws when custom files alone exceed byteCap', async () => {
        mockContents({
            'a.txt': 'X'.repeat(5000),
            'b.txt': 'Y'.repeat(5000),
        });
        await expect(buildContext({
            accessToken: 't', owner: 'o', repo: 'r',
            signals: {},
            customFiles: ['a.txt', 'b.txt'],
            byteCap: 4000, // smaller than 2× 5000 truncated halves
            topicsLanguageInputs: { topics: [], language: null },
        })).rejects.toThrow(/exceed/i);
    });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: 13 PASS, 3 FAIL.

- [ ] **Step 3: Extend the implementation**

In `server/lib/repo-context-builder.js`, modify the `buildContext` function:

1. Track skipped custom files: at the top of the function add `const skippedCustomFiles = [];`.
2. After the folder-structure block (before `return`), add the custom-files block:

```js
    if (Array.isArray(customFiles) && customFiles.length > 0) {
        const usedSoFar = sections.reduce((n, s) => n + s.bytes, 0);
        const remaining = byteCap - usedSoFar;
        if (remaining <= 0) {
            throw new Error(`Custom files cannot fit: ${usedSoFar} bytes already used of ${byteCap} cap.`);
        }
        // Fetch all first so we know how many are present before splitting budget.
        const fetched = [];
        for (const path of customFiles) {
            const content = await fetchTextFile(owner, repo, path, accessToken);
            if (typeof content === 'string') {
                fetched.push({ path, content });
            } else {
                skippedCustomFiles.push(path);
            }
        }
        if (fetched.length > 0) {
            const perFile = Math.floor(remaining / fetched.length);
            // Reject when even one file would be left with nothing useful.
            const totalNeeded = fetched.reduce((n, f) => n + Math.min(f.content.length, perFile), 0);
            if (totalNeeded === 0 || perFile < 200) {
                throw new Error(`Selected custom files exceed remaining budget (${remaining} B for ${fetched.length} files).`);
            }
            for (const f of fetched) {
                pushSection(sections, {
                    kind: 'customFile',
                    label: f.path,
                    content: f.content,
                    byteCap: perFile,
                });
            }
        }
    }
```

3. Update the `return` statement at the bottom of `buildContext` to include `skippedCustomFiles`:

```js
    return {
        sections,
        totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
        confidence: computeConfidence({
            readmeBytes,
            manifestPresent,
            topicsPresent: signals.topics && topicsPresent,
            languagePresent: signals.language && languagePresent,
        }),
        signalsUsed: sections.map((s) => ({ kind: s.kind, label: s.label, bytes: s.bytes })),
        redactions: sections.filter((s) => s.redactions > 0).map((s) => ({ file: s.label, count: s.redactions })),
        skippedCustomFiles,
        byteCap,
    };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run server/__tests__/repo-context-builder.test.js`
Expected: 16 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/repo-context-builder.js server/__tests__/repo-context-builder.test.js
git commit -m "feat(ai): repo-context-builder custom files with budget guard"
```

---

## Phase 2 — API Surface

### Task 6: Update `suggest-name-description` route to accept `context`

**Files:**
- Modify: `server/routes/ai/suggest-name-description.js`
- Modify: `server/lib/ai-prompt-registry.js`
- Create: `server/__tests__/suggest-name-description-context.test.js`

- [ ] **Step 1: Update prompt registry — add `signals_block` variable**

Edit `server/lib/ai-prompt-registry.js`. The current `SUGGEST_NAME_DESC_DEFAULT` template uses `{readme}`, `{language}`, etc. We need to:

1. Add a new section to the default prompt that consumes a structured `{signals_block}` placeholder.
2. Add `signals_block` to the `variables` array of `suggest_name_description`.

Find the closing of `SUGGEST_NAME_DESC_DEFAULT` (the backtick before `;`) and append a new section before it:

```js
// Inside the SUGGEST_NAME_DESC_DEFAULT template literal, append AFTER the existing
// "# Examples" block (or wherever it currently ends) and BEFORE the closing backtick:

# Repo context (use these signals — do not invent details)
{signals_block}
```

Then update the registry entry's `variables` array (around line 277):

```js
    suggest_name_description: {
        key: 'suggest_name_description',
        title: 'Suggest name & description',
        category: 'Repository',
        description: 'Drives the rename / re-describe modal. The variables below are sanitized repo metadata the model uses to ground its proposal. Keep the JSON return contract intact (`{ "name", "description", "rationale" }`) — the route parses the response.',
        defaultPrompt: SUGGEST_NAME_DESC_DEFAULT,
        variables: ['name', 'description', 'language', 'visibility', 'topics', 'readme', 'signals_block'],
        sampleVars: SAMPLE_REPO_VARS,
    },
```

Also extend `SAMPLE_REPO_VARS` (search for it in the same file) to include a sample `signals_block` value:

```js
    signals_block: 'language: TypeScript\ntopics: cli, openapi\nmanifest (package.json):\n{ "scripts": { "build": "tsup" } }',
```

- [ ] **Step 2: Write failing route tests**

Create `server/__tests__/suggest-name-description-context.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGithubApi = vi.hoisted(() => vi.fn());
const mockProviderGenerate = vi.hoisted(() => vi.fn());
const mockCheckUsageLimit = vi.hoisted(() => vi.fn());
const mockIncrementUsage = vi.hoisted(() => vi.fn());
const mockAuditLog = vi.hoisted(() => vi.fn());
const mockDbGet = vi.hoisted(() => vi.fn());

vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));
vi.mock('../lib/usage-meter.js', () => ({ checkUsageLimit: mockCheckUsageLimit, incrementUsage: mockIncrementUsage }));
vi.mock('../lib/audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('../db.js', () => ({ default: { prepare: () => ({ get: mockDbGet }) } }));

const provideAIProviderInTest = vi.hoisted(() => ({ enabled: false }));
vi.mock('../middleware/auth.js', async () => {
    const actual = await vi.importActual('../middleware/auth.js');
    return {
        ...actual,
        requireAuth: (req, _res, next) => {
            req.session = { userId: 1, accessToken: 'fake' };
            req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
            if (provideAIProviderInTest.enabled) req.aiProvider = { generate: mockProviderGenerate };
            next();
        },
    };
});

const { default: router } = await import('../routes/ai/suggest-name-description.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(router);
    return app;
}

const REPO = { id: 42, name: 'demo', owner: { login: 'o' }, language: 'TS', topics: ['cli'], description: '' };

beforeEach(() => {
    mockGithubApi.mockReset();
    mockProviderGenerate.mockReset();
    mockCheckUsageLimit.mockReset().mockReturnValue({ allowed: true, limit: 100, current: 0 });
    mockIncrementUsage.mockReset();
    mockAuditLog.mockReset();
    mockDbGet.mockReset().mockReturnValue(null);
    provideAIProviderInTest.enabled = false;
});

describe('POST /ai/suggest-name-description with context', () => {
    it('accepts the new context body shape and returns enriched response', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.endsWith('/readme')) return { data: { encoding: 'base64', content: Buffer.from('# Demo\nA tool.', 'utf8').toString('base64') } };
            if (url.includes('/contents/package.json')) return { data: { encoding: 'base64', content: Buffer.from('{"name":"demo"}', 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42, context: { signals: { readme: true, manifest: true, topics: true, language: true } } });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            source: expect.any(String),
            confidence: expect.stringMatching(/^(high|medium|low)$/),
            signalsUsed: expect.any(Array),
            redactions: expect.any(Array),
        });
        expect(res.body.signalsUsed.find((s) => s.kind === 'readme')).toBeTruthy();
        expect(res.body.signalsUsed.find((s) => s.kind === 'manifest')).toBeTruthy();
    });

    it('defaults context.signals when omitted (backwards-compatible body)', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.endsWith('/readme')) return { data: { encoding: 'base64', content: Buffer.from('# Demo', 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({ repoId: 42 });

        expect(res.status).toBe(200);
        expect(res.body.confidence).toBeDefined();
    });

    it('rejects more than 5 customFiles', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({
                repoId: 42,
                context: { customFiles: ['a', 'b', 'c', 'd', 'e', 'f'] },
            });

        expect(res.status).toBe(400);
    });

    it('returns 400 when custom files exceed byte cap', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.includes('/contents/big.txt')) return { data: { encoding: 'base64', content: Buffer.from('X'.repeat(20_000), 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({
                repoId: 42,
                // Disable every other signal so only customFiles compete for budget,
                // and ask for a single large file under a small cap.
                context: { signals: { readme: false, manifest: false, topics: false, language: false }, customFiles: ['big.txt'] },
            });

        // The route must surface the builder's "exceed" error as 400, not 500.
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/budget|exceed/i);
    });

    it('forwards skippedCustomFiles in response', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url === '/repositories/42') return { data: REPO };
            if (url.includes('/contents/present.md')) return { data: { encoding: 'base64', content: Buffer.from('hi', 'utf8').toString('base64') } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp())
            .post('/ai/suggest-name-description')
            .send({
                repoId: 42,
                context: { signals: { readme: false, manifest: false, topics: false, language: false }, customFiles: ['present.md', 'missing.md'] },
            });

        expect(res.status).toBe(200);
        expect(res.body.skippedCustomFiles).toEqual(['missing.md']);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/suggest-name-description-context.test.js`
Expected: FAIL — route doesn't accept `context` yet, response missing `confidence`/`signalsUsed`/`redactions`.

- [ ] **Step 4: Update the route**

Edit `server/routes/ai/suggest-name-description.js`:

1. Update imports at the top:

```js
import { buildContext } from '../../lib/repo-context-builder.js';
```

2. Replace the `bodySchema` constant:

```js
const bodySchema = z.object({
    repoId: z.coerce.number().int().positive(),
    context: z.object({
        signals: z.object({
            readme: z.boolean().default(true),
            manifest: z.boolean().default(true),
            entrypoints: z.boolean().default(false),
            folderStructure: z.boolean().default(false),
            topics: z.boolean().default(true),
            language: z.boolean().default(true),
        }).default({}),
        customFiles: z.array(z.string().min(1).max(255)).max(5).default([]),
    }).default({}),
});
```

3. Replace the existing `fetchReadmeExcerpt` callsite + AI prompt build with builder-driven flow. Inside the route handler, after `repo` is fetched and before any provider call, add:

```js
        let ctx;
        try {
            ctx = await buildContext({
                accessToken: req.session.accessToken,
                owner: repo.owner?.login,
                repo: repo.name,
                signals: req.validatedBody.context.signals,
                customFiles: req.validatedBody.context.customFiles,
                topicsLanguageInputs: {
                    topics: Array.isArray(repo.topics) ? repo.topics : [],
                    language: repo.language || null,
                },
            });
        } catch (err) {
            // Builder throws on budget violations — surface as 400.
            return res.status(400).json({ error: err.message });
        }

        // Build a concatenated signals block for the prompt template.
        const signalsBlock = ctx.sections.length === 0
            ? '(no signals selected)'
            : ctx.sections.map((s) => `--- ${s.label} (${s.kind}, ${s.bytes}B) ---\n${s.content}`).join('\n\n');
```

4. Replace the existing `buildAIPrompt` call inside the `if (provider) { try { ... } }` block. Find:

```js
                const prompt = buildAIPrompt(userId, {
                    name,
                    description: repo.description,
                    language: repo.language,
                    isPrivate: !!repo.private,
                    topics: generatorInput.topics,
                    readmeExcerpt,
                });
```

Replace with:

```js
                const prompt = buildAIPrompt(userId, {
                    name,
                    description: repo.description,
                    language: repo.language,
                    isPrivate: !!repo.private,
                    topics: ctx.sections.find((s) => s.kind === 'topicsLanguage') ? Array.isArray(repo.topics) ? repo.topics : [] : [],
                    readmeExcerpt: (ctx.sections.find((s) => s.kind === 'readme')?.content) || '',
                    signalsBlock,
                });
```

5. Update `buildAIPrompt` to accept and forward the new `signalsBlock` variable:

```js
function buildAIPrompt(userId, { name, description, language, isPrivate, topics, readmeExcerpt, signalsBlock }) {
    return getResolvedPrompt(userId, 'suggest_name_description', {
        name: sanitizeForPrompt(name, 100),
        description: sanitizeForPrompt(description || 'none', 500),
        language: sanitizeForPrompt(language || 'unknown', 50),
        visibility: isPrivate ? 'private' : 'public',
        topics: sanitizeForPrompt(topics?.length ? topics.join(', ') : 'none', 200),
        readme: sanitizeForPrompt(readmeExcerpt || 'none', 1500),
        signals_block: sanitizeForPrompt(signalsBlock || 'none', 8192),
    });
}
```

6. The deterministic fallback uses the existing `generateDeterministic`. Keep its `generatorInput` mostly unchanged but source the README excerpt from the builder's section (so deterministic and AI see identical content):

```js
        const generatorInput = {
            name,
            description: repo.description || '',
            language: repo.language || null,
            topics: Array.isArray(repo.topics) ? repo.topics : [],
            readmeExcerpt: (ctx.sections.find((s) => s.kind === 'readme')?.content) || '',
            aiMetadata,
        };
```

7. Replace the `shapeResponse` invocation at the bottom — pass through builder fields. Find and replace the route's tail block (the final `incrementUsage` / `shapeResponse` / `auditLog` / `res.json`):

```js
        incrementUsage(userId, 'ai_queries');
        const body = shapeResponse({
            source,
            current: { name, description: repo.description || '' },
            generated,
        });
        body.confidence = ctx.confidence;
        body.signalsUsed = ctx.signalsUsed;
        body.redactions = ctx.redactions;
        if (ctx.skippedCustomFiles.length > 0) body.skippedCustomFiles = ctx.skippedCustomFiles;
        auditLog(req, 'ai.suggest_name_description', 'repo', `${owner}/${name}`, { source, confidence: ctx.confidence });
        return res.json(body);
```

8. Delete the now-unused `fetchReadmeExcerpt` function and its import-time `README_EXCERPT_BYTES` constant.

- [ ] **Step 5: Run all relevant tests**

Run: `npx vitest run server/__tests__/suggest-name-description-context.test.js server/__tests__/repo-context-builder.test.js`
Expected: all PASS.

Run the existing route tests too to confirm no regression:

Run: `npx vitest run server/__tests__/suggest-name-description.test.js` (the original file alongside the new one)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/ai-prompt-registry.js server/routes/ai/suggest-name-description.js server/__tests__/suggest-name-description-context.test.js
git commit -m "feat(ai): wire repo-context-builder into suggest-name-description"
```

---

### Task 7: Tree endpoint for `FileTreePicker`

**Files:**
- Create: `server/routes/repos/tree.js`
- Modify: `server/routes/repos/index.js` (or wherever `/api/repos` routes are mounted — check during step 1)
- Create: `server/__tests__/repos-tree-route.test.js`

- [ ] **Step 1: Locate the `/api/repos` mount point**

Run: `grep -n "routes/repos" server/server.js server/index.js 2>/dev/null | head` to find how `/api/repos` is currently mounted. Pick the right file to add the new sub-route. The plan assumes `server/routes/repos/index.js` exists; if a different file is used, update step 4 accordingly.

- [ ] **Step 2: Write failing route tests**

Create `server/__tests__/repos-tree-route.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockGithubApi = vi.hoisted(() => vi.fn());
vi.mock('../lib/github-api.js', () => ({ githubApi: mockGithubApi }));

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

const { default: router } = await import('../routes/repos/tree.js');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use(router);
    return app;
}

beforeEach(() => mockGithubApi.mockReset());

describe('GET /api/repos/:owner/:name/tree', () => {
    it('returns blob entries with path/type/size', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/branches/main')) return { data: { commit: { sha: 'abc' } } };
            if (url.includes('/git/trees/abc')) return { data: { truncated: false, tree: [
                { path: 'README.md', type: 'blob', size: 100 },
                { path: 'src',       type: 'tree' },
                { path: 'src/index.js', type: 'blob', size: 200 },
            ] } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });

        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=main');
        expect(res.status).toBe(200);
        expect(res.body.entries).toEqual([
            { path: 'README.md', type: 'blob', size: 100 },
            { path: 'src/index.js', type: 'blob', size: 200 },
        ]);
        expect(res.body.truncated).toBe(false);
    });

    it('caps to 500 entries and reports truncated', async () => {
        const tree = Array.from({ length: 600 }, (_, i) => ({ path: `f${i}.js`, type: 'blob', size: 1 }));
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/branches/main')) return { data: { commit: { sha: 'sha' } } };
            if (url.includes('/git/trees/sha')) return { data: { truncated: false, tree } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=main');
        expect(res.body.entries).toHaveLength(500);
        expect(res.body.truncated).toBe(true);
    });

    it('reports truncated when GitHub itself truncated the tree', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.includes('/branches/main')) return { data: { commit: { sha: 'sha' } } };
            if (url.includes('/git/trees/sha')) return { data: { truncated: true, tree: [{ path: 'f.js', type: 'blob', size: 1 }] } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=main');
        expect(res.body.truncated).toBe(true);
    });

    it('returns 404 when branch not found', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree?branch=missing');
        expect(res.status).toBe(404);
    });

    it('uses default branch when none provided', async () => {
        mockGithubApi.mockImplementation(async (url) => {
            if (url.match(/\/repos\/o\/r$/)) return { data: { default_branch: 'develop' } };
            if (url.includes('/branches/develop')) return { data: { commit: { sha: 's' } } };
            if (url.includes('/git/trees/s')) return { data: { truncated: false, tree: [] } };
            const err = new Error('Not Found'); err.status = 404; throw err;
        });
        const res = await request(makeApp()).get('/api/repos/o/r/tree');
        expect(res.status).toBe(200);
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/__tests__/repos-tree-route.test.js`
Expected: FAIL — route doesn't exist.

- [ ] **Step 4: Implement the route**

Create `server/routes/repos/tree.js`:

```js
/*
 * GitHub Repo Manager - Repo Tree Route
 *
 * GET /api/repos/:owner/:name/tree?branch=...
 *
 * Wraps GitHub's recursive git-tree endpoint after resolving the branch
 * SHA. Returns a flat list of blob entries (no tree nodes — the file
 * picker has no use for them) capped at 500. The cap is independent of
 * GitHub's own `truncated` flag; both contribute to the response's
 * `truncated` field.
 */

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { githubApi } from '../../lib/github-api.js';
import logger from '../../lib/logger.js';

const router = express.Router();
const MAX_ENTRIES = 500;

router.get('/api/repos/:owner/:name/tree', requireAuth, async (req, res) => {
    const { owner, name } = req.params;
    let branch = typeof req.query.branch === 'string' && req.query.branch ? req.query.branch : null;

    try {
        if (!branch) {
            const { data: repoMeta } = await githubApi(`/repos/${owner}/${name}`, req.session.accessToken);
            branch = repoMeta?.default_branch || 'main';
        }
        const { data: branchData } = await githubApi(`/repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`, req.session.accessToken);
        const sha = branchData?.commit?.sha;
        if (!sha) return res.status(404).json({ error: 'Branch SHA not resolvable.' });

        const { data: treeData } = await githubApi(`/repos/${owner}/${name}/git/trees/${sha}?recursive=1`, req.session.accessToken);
        const blobs = Array.isArray(treeData?.tree)
            ? treeData.tree.filter((e) => e?.type === 'blob').map((e) => ({ path: e.path, type: 'blob', size: e.size ?? null }))
            : [];
        const truncated = !!treeData?.truncated || blobs.length > MAX_ENTRIES;
        return res.json({
            branch,
            sha,
            truncated,
            entries: blobs.slice(0, MAX_ENTRIES),
        });
    } catch (e) {
        const status = e?.status || 500;
        if (status === 404) return res.status(404).json({ error: 'Branch or repo not found.' });
        logger.warn({ err: e, owner, name, branch }, 'tree route failed');
        return res.status(500).json({ error: 'Failed to fetch tree.' });
    }
});

export default router;
```

- [ ] **Step 5: Mount the router**

Open whatever file mounts the `/api/repos` routes (commonly `server/server.js` near the other `app.use(reposRouter)` lines or `server/routes/repos/index.js` if a barrel exists). Add:

```js
import treeRouter from './routes/repos/tree.js';
// ...
app.use(treeRouter);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/repos-tree-route.test.js`
Expected: 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/repos/tree.js server/server.js server/__tests__/repos-tree-route.test.js
git commit -m "feat(repos): add tree endpoint for AI context file picker"
```

---

## Phase 3 — Frontend Foundation

### Task 8: `useContextPrefs` hook

**Files:**
- Create: `src/hooks/useContextPrefs.js`
- Test: `tests/hooks/useContextPrefs.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/hooks/useContextPrefs.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useContextPrefs, DEFAULT_SIGNALS } from '../../src/hooks/useContextPrefs.js';

beforeEach(() => localStorage.clear());

describe('useContextPrefs', () => {
    it('returns defaults when localStorage is empty', () => {
        const { result } = renderHook(() => useContextPrefs());
        expect(result.current.prefs.signals).toEqual(DEFAULT_SIGNALS);
    });

    it('persists toggle changes to localStorage', () => {
        const { result } = renderHook(() => useContextPrefs());
        act(() => result.current.setSignal('entrypoints', true));
        expect(JSON.parse(localStorage.getItem('ai-context-prefs-v1')).signals.entrypoints).toBe(true);
    });

    it('rehydrates from existing localStorage value', () => {
        localStorage.setItem('ai-context-prefs-v1', JSON.stringify({ signals: { ...DEFAULT_SIGNALS, entrypoints: true } }));
        const { result } = renderHook(() => useContextPrefs());
        expect(result.current.prefs.signals.entrypoints).toBe(true);
    });

    it('reset() restores defaults', () => {
        const { result } = renderHook(() => useContextPrefs());
        act(() => result.current.setSignal('entrypoints', true));
        act(() => result.current.reset());
        expect(result.current.prefs.signals).toEqual(DEFAULT_SIGNALS);
    });

    it('ignores corrupt JSON and falls back to defaults', () => {
        localStorage.setItem('ai-context-prefs-v1', 'not-json');
        const { result } = renderHook(() => useContextPrefs());
        expect(result.current.prefs.signals).toEqual(DEFAULT_SIGNALS);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useContextPrefs.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useContextPrefs.js`:

```js
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ai-context-prefs-v1'

export const DEFAULT_SIGNALS = Object.freeze({
    readme: true,
    manifest: true,
    entrypoints: false,
    folderStructure: false,
    topics: true,
    language: true,
})

const DEFAULT_PREFS = Object.freeze({ signals: DEFAULT_SIGNALS })

function readFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return DEFAULT_PREFS
        const parsed = JSON.parse(raw)
        const signals = { ...DEFAULT_SIGNALS, ...(parsed?.signals || {}) }
        return { signals }
    } catch {
        return DEFAULT_PREFS
    }
}

function writeToStorage(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
        // ignore quota / disabled-storage errors
    }
}

export function useContextPrefs() {
    const [prefs, setPrefs] = useState(() => readFromStorage())

    useEffect(() => {
        writeToStorage(prefs)
    }, [prefs])

    const setSignal = useCallback((kind, value) => {
        setPrefs((prev) => ({ ...prev, signals: { ...prev.signals, [kind]: !!value } }))
    }, [])

    const reset = useCallback(() => setPrefs({ signals: DEFAULT_SIGNALS }), [])

    return { prefs, setSignal, reset }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useContextPrefs.test.js`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useContextPrefs.js tests/hooks/useContextPrefs.test.js
git commit -m "feat(ai): useContextPrefs hook for AI context picker"
```

---

### Task 9: `<ContextPicker />` (single mode toggles + meter)

**Files:**
- Create: `src/components/AI/ContextPicker.jsx`
- Test: `tests/components/AI/ContextPicker.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/AI/ContextPicker.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextPicker } from '../../../src/components/AI/ContextPicker';

const NOOP = () => {};

function renderPicker(overrides = {}) {
    const props = {
        mode: 'single',
        signals: { readme: true, manifest: true, entrypoints: false, folderStructure: false, topics: true, language: true },
        onSignalChange: NOOP,
        customFiles: [],
        onAddCustomFile: NOOP,
        onRemoveCustomFile: NOOP,
        onReset: NOOP,
        treeOpenable: true,
        owner: 'o',
        repoName: 'r',
        ...overrides,
    };
    return render(<ContextPicker {...props} />);
}

describe('<ContextPicker />', () => {
    it('renders all six signal toggles in single mode', () => {
        renderPicker();
        ['README', 'Manifest', 'Topics', 'Language', 'Entrypoints', 'Folder structure'].forEach((label) => {
            expect(screen.getByText(new RegExp(label, 'i'))).toBeInTheDocument();
        });
    });

    it('hides "Add specific file" in batch mode', () => {
        renderPicker({ mode: 'batch' });
        expect(screen.queryByText(/add specific file/i)).toBeNull();
    });

    it('emits onSignalChange when a checkbox toggles', () => {
        const onSignalChange = vi.fn();
        renderPicker({ onSignalChange });
        const ep = screen.getByLabelText(/entrypoints/i);
        fireEvent.click(ep);
        expect(onSignalChange).toHaveBeenCalledWith('entrypoints', true);
    });

    it('shows the byte meter total scaled by enabled signals', () => {
        renderPicker(); // README+manifest+topics+language ON
        // Bytes are static-ish per signal; we only check the meter exists and includes "/ 8 KB"
        expect(screen.getByText(/\/\s*8\s*KB/i)).toBeInTheDocument();
    });

    it('reset button calls onReset', () => {
        const onReset = vi.fn();
        renderPicker({ onReset });
        fireEvent.click(screen.getByRole('button', { name: /reset/i }));
        expect(onReset).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AI/ContextPicker.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/AI/ContextPicker.jsx`:

```jsx
import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Sparkles } from 'lucide-react'

const SIGNAL_LABELS = {
    readme: 'README',
    manifest: 'Manifest (package.json / pyproject.toml / …)',
    entrypoints: 'Entrypoints (up to 3)',
    folderStructure: 'Folder structure (top-level dirs)',
    topics: 'Topics',
    language: 'Language',
}

// Static "expected size" used for the byte meter — close enough to the
// real per-signal cap that the user gets a useful sense of cost without
// the picker round-tripping a fetch on every toggle change.
const EXPECTED_BYTES = {
    readme: 1500,
    manifest: 600,
    entrypoints: 1200,
    folderStructure: 200,
    topics: 100,
    language: 30,
}

const TOTAL_CAP = 8192

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`
}

export function ContextPicker({
    mode = 'single',
    signals,
    onSignalChange,
    customFiles = [],
    onAddCustomFile,
    onRemoveCustomFile,
    onReset,
}) {
    const [open, setOpen] = useState(false)
    const enabledKeys = Object.keys(signals).filter((k) => signals[k])
    const totalBytes = enabledKeys.reduce((n, k) => n + (EXPECTED_BYTES[k] || 0), 0)
    const onCount = enabledKeys.length

    return (
        <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200"
                aria-expanded={open}
            >
                <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    Context ({onCount} signals on, {formatKb(totalBytes)})
                </span>
                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {open && (
                <div className="px-3 pb-3 pt-1 space-y-2">
                    {Object.keys(SIGNAL_LABELS).map((kind) => {
                        const checked = !!signals[kind]
                        const expected = EXPECTED_BYTES[kind] || 0
                        return (
                            <label key={kind} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => onSignalChange(kind, e.target.checked)}
                                    aria-label={SIGNAL_LABELS[kind]}
                                    className="accent-indigo-500"
                                />
                                <span className="flex-1 text-slate-700 dark:text-slate-200">{SIGNAL_LABELS[kind]}</span>
                                {checked && <span className="text-xs text-slate-500">{formatKb(expected)}</span>}
                            </label>
                        )
                    })}

                    {mode === 'single' && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => onAddCustomFile?.()}
                                disabled={customFiles.length >= 5}
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                            >
                                + Add specific file ({customFiles.length}/5)
                            </button>
                            {customFiles.length > 0 && (
                                <ul className="mt-1 flex flex-wrap gap-1">
                                    {customFiles.map((f) => (
                                        <li key={f.path} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-xs text-indigo-700 dark:text-indigo-300">
                                            {f.path}
                                            <button
                                                type="button"
                                                onClick={() => onRemoveCustomFile?.(f.path)}
                                                aria-label={`Remove ${f.path}`}
                                                className="text-indigo-500 hover:text-indigo-700"
                                            >
                                                ×
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-xs text-slate-500">
                            Total: {formatKb(totalBytes)} / {formatKb(TOTAL_CAP)}
                        </span>
                        <button
                            type="button"
                            onClick={onReset}
                            className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
                        >
                            <RotateCcw className="w-3 h-3" /> Reset
                        </button>
                    </div>
                </div>
            )}
        </section>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AI/ContextPicker.test.jsx`
Expected: 5 PASS.

The "all signals shown" test requires the panel to be expanded. Update the test in step 1 by adding `fireEvent.click(screen.getByRole('button', { name: /context/i }));` at the start of each test that asserts internal toggles. (The "renders all six signal toggles" test, the "hides add specific file" test, the "emits onSignalChange" test, and the "reset button calls onReset" test all need the panel open.) Apply this fix and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/components/AI/ContextPicker.jsx tests/components/AI/ContextPicker.test.jsx
git commit -m "feat(ai): ContextPicker component with byte meter"
```

---

### Task 10: `<FileTreePicker />`

**Files:**
- Modify: `src/api/repos.js` (add `getTree` wrapper)
- Create: `src/components/AI/FileTreePicker.jsx`
- Test: `tests/components/AI/FileTreePicker.test.jsx`

- [ ] **Step 1: Add `reposApi.getTree`**

Open `src/api/repos.js` and locate the `reposApi` export. Add a new method (next to other GET helpers — match the existing style):

```js
    getTree: async (owner, name, branch) => {
        const qs = branch ? `?branch=${encodeURIComponent(branch)}` : '';
        const res = await fetch(`/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree${qs}`, {
            credentials: 'include',
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const err = new Error(data?.error || 'Failed to load repo tree');
            err.status = res.status;
            throw err;
        }
        return res.json();
    },
```

- [ ] **Step 2: Write failing tests**

Create `tests/components/AI/FileTreePicker.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTreePicker } from '../../../src/components/AI/FileTreePicker';

vi.mock('../../../src/api/repos', () => ({
    reposApi: {
        getTree: vi.fn(),
    },
}));

import { reposApi } from '../../../src/api/repos';

beforeEach(() => reposApi.getTree.mockReset());

describe('<FileTreePicker />', () => {
    it('lists fetched blob entries', async () => {
        reposApi.getTree.mockResolvedValue({
            branch: 'main', truncated: false,
            entries: [
                { path: 'README.md', type: 'blob', size: 100 },
                { path: 'src/index.js', type: 'blob', size: 200 },
            ],
        });
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument());
        expect(screen.getByText('src/index.js')).toBeInTheDocument();
    });

    it('filters entries by search', async () => {
        reposApi.getTree.mockResolvedValue({
            branch: 'main', truncated: false,
            entries: [
                { path: 'README.md', type: 'blob', size: 100 },
                { path: 'src/index.js', type: 'blob', size: 200 },
            ],
        });
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => screen.getByText('README.md'));
        fireEvent.change(screen.getByPlaceholderText(/search files/i), { target: { value: 'index' } });
        expect(screen.queryByText('README.md')).toBeNull();
        expect(screen.getByText('src/index.js')).toBeInTheDocument();
    });

    it('calls onPick with the selected entry', async () => {
        reposApi.getTree.mockResolvedValue({
            branch: 'main', truncated: false,
            entries: [{ path: 'README.md', type: 'blob', size: 100 }],
        });
        const onPick = vi.fn();
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={onPick} onClose={() => {}} />);
        await waitFor(() => screen.getByText('README.md'));
        fireEvent.click(screen.getByText('README.md'));
        expect(onPick).toHaveBeenCalledWith({ path: 'README.md', size: 100 });
    });

    it('shows truncated banner when response is truncated', async () => {
        reposApi.getTree.mockResolvedValue({ branch: 'main', truncated: true, entries: [] });
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText(/use search/i)).toBeInTheDocument());
    });

    it('renders error state on fetch failure', async () => {
        reposApi.getTree.mockRejectedValue(new Error('boom'));
        render(<FileTreePicker isOpen owner="o" repoName="r" branch="main" onPick={() => {}} onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument());
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/AI/FileTreePicker.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/components/AI/FileTreePicker.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { Search, AlertTriangle, FileText } from 'lucide-react'
import { reposApi } from '../../api/repos'

function formatBytes(bytes) {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
}

export function FileTreePicker({ isOpen, owner, repoName, branch, onPick, onClose }) {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [query, setQuery] = useState('')

    useEffect(() => {
        if (!isOpen) return
        let cancelled = false
        setLoading(true)
        setError(null)
        reposApi.getTree(owner, repoName, branch)
            .then((res) => { if (!cancelled) setData(res) })
            .catch((err) => { if (!cancelled) setError(err) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [isOpen, owner, repoName, branch])

    const filtered = useMemo(() => {
        if (!data?.entries) return []
        const q = query.trim().toLowerCase()
        if (!q) return data.entries.slice(0, 100)
        return data.entries.filter((e) => e.path.toLowerCase().includes(q)).slice(0, 100)
    }, [data, query])

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Add specific file" size="lg" closeOnBackdrop>
            <div className="space-y-3">
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search files…"
                        autoFocus
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                    />
                </div>

                {loading && <div className="flex items-center justify-center py-8"><Spinner /></div>}

                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-sm">
                        <AlertTriangle className="w-4 h-4" /> Could not load repo tree.
                    </div>
                )}

                {data?.truncated && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        Repo is large — only the first 500 files are shown. Use search to find more.
                    </p>
                )}

                <ul className="max-h-72 overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((e) => (
                        <li key={e.path}>
                            <button
                                type="button"
                                onClick={() => onPick({ path: e.path, size: e.size })}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                            >
                                <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                                <span className="flex-1 truncate">{e.path}</span>
                                <span className="text-xs text-slate-400">{formatBytes(e.size)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </Modal>
    )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/AI/FileTreePicker.test.jsx`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/repos.js src/components/AI/FileTreePicker.jsx tests/components/AI/FileTreePicker.test.jsx
git commit -m "feat(ai): FileTreePicker for AI context custom files"
```

---

### Task 11: `<PremiumRationale />`

**Files:**
- Create: `src/components/AI/PremiumRationale.jsx`
- Test: `tests/components/AI/PremiumRationale.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/AI/PremiumRationale.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PremiumRationale } from '../../../src/components/AI/PremiumRationale';

describe('<PremiumRationale />', () => {
    it('shows confidence pill', () => {
        render(<PremiumRationale source="ai" rationale="Used README and topics." confidence="high" signalsUsed={[]} redactions={[]} />);
        expect(screen.getByText(/high/i)).toBeInTheDocument();
    });

    it('renders signal chips', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="medium" signalsUsed={[
            { kind: 'readme', label: 'README', bytes: 1500 },
            { kind: 'manifest', label: 'package.json', bytes: 600 },
        ]} redactions={[]} />);
        expect(screen.getByText(/README/)).toBeInTheDocument();
        expect(screen.getByText(/package\.json/)).toBeInTheDocument();
    });

    it('shows redaction notice when redactions > 0', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="medium" signalsUsed={[]} redactions={[{ file: 'package.json', count: 2 }]} />);
        expect(screen.getByText(/2 lines redacted/i)).toBeInTheDocument();
    });

    it('hides redaction notice when redactions array is empty', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="medium" signalsUsed={[]} redactions={[]} />);
        expect(screen.queryByText(/redacted/i)).toBeNull();
    });

    it('shows low-confidence amber notice', () => {
        render(<PremiumRationale source="ai" rationale="..." confidence="low" signalsUsed={[]} redactions={[]} />);
        expect(screen.getByText(/quality limited/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AI/PremiumRationale.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/AI/PremiumRationale.jsx`:

```jsx
import { Sparkles, Wand2, Info, AlertTriangle, ShieldCheck } from 'lucide-react'

const CONFIDENCE_STYLE = {
    high: { dot: 'bg-emerald-500', label: 'HIGH', color: 'text-emerald-700 dark:text-emerald-300' },
    medium: { dot: 'bg-amber-500', label: 'MEDIUM', color: 'text-amber-700 dark:text-amber-300' },
    low: { dot: 'bg-rose-500', label: 'LOW', color: 'text-rose-700 dark:text-rose-300' },
}

function formatBytes(bytes) {
    if (typeof bytes !== 'number') return ''
    if (bytes < 1024) return `${bytes}B`
    return `${(bytes / 1024).toFixed(1)}KB`
}

export function PremiumRationale({ source, rationale, confidence, signalsUsed = [], redactions = [] }) {
    const conf = CONFIDENCE_STYLE[confidence] || CONFIDENCE_STYLE.low
    const isAI = source === 'ai'
    const totalRedactedLines = redactions.reduce((n, r) => n + (r.count || 0), 0)

    return (
        <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-3 space-y-2">
            <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                    isAI
                        ? 'bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30'
                        : 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/20'
                }`}>
                    {isAI ? <Sparkles className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
                    {isAI ? 'AI' : 'Heuristic'}
                </span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider ${conf.color}`}>
                    <span className={`w-2 h-2 rounded-full ${conf.dot}`} aria-hidden="true" />
                    Confidence {conf.label}
                </span>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-200">{rationale}</p>

            {signalsUsed.length > 0 && (
                <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Signals used</p>
                    <ul className="flex flex-wrap gap-1">
                        {signalsUsed.map((s) => (
                            <li key={s.kind + ':' + s.label} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300">
                                {s.label}{s.bytes ? ` ${formatBytes(s.bytes)}` : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {totalRedactedLines > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    {totalRedactedLines} line{totalRedactedLines === 1 ? '' : 's'} redacted from {redactions.map((r) => r.file).join(', ')} (possible secrets)
                </p>
            )}

            {confidence === 'low' && (
                <p className="text-xs text-amber-700 dark:text-amber-300 inline-flex items-start gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Suggestion quality limited — README is empty or too short. Consider adding more signals or improving the README first.
                </p>
            )}

            {!isAI && (
                <p className="text-[11px] text-slate-400 inline-flex items-center gap-1">
                    <Info className="w-3 h-3" /> AI not available — used deterministic fallback.
                </p>
            )}
        </section>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AI/PremiumRationale.test.jsx`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AI/PremiumRationale.jsx tests/components/AI/PremiumRationale.test.jsx
git commit -m "feat(ai): PremiumRationale block with confidence + redactions"
```

---

## Phase 4 — Integration: Single-Repo Modal

### Task 12: Wire ContextPicker + FileTreePicker + PremiumRationale into `SuggestNameDescriptionModal`

**Files:**
- Modify: `src/api/ai.js` (thread `context` arg)
- Modify: `src/components/AI/SuggestNameDescriptionModal.jsx`
- Modify: `tests/components/AI/SuggestNameDescriptionModal.test.jsx`

- [ ] **Step 1: Thread `context` through `aiApi.suggestNameDescription`**

Open `src/api/ai.js` and update the function (around line 242):

```js
    suggestNameDescription: async (repoId, options = {}) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockSuggestNameDescription } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 600));
            const fakeRepo = { id: repoId, name: `repo-${repoId}`, language: 'JavaScript', topics: ['demo'] };
            return mockSuggestNameDescription(fakeRepo);
        }

        const body = { repoId };
        if (options.context) body.context = options.context;

        const res = await fetch(`${API_BASE}/ai/suggest-name-description`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify(body),
        });
        return handleAIResponse(res, 'suggest-name-description');
    },
```

Also update `polish.getDescription` (around line 410) to forward `context`:

```js
    polish: {
        getDescription: async (repoId, options = {}) => aiApi.suggestNameDescription(repoId, options),
        // ...
    },
```

- [ ] **Step 2: Update the modal**

Open `src/components/AI/SuggestNameDescriptionModal.jsx`. Add imports near the top:

```jsx
import { ContextPicker } from './ContextPicker'
import { PremiumRationale } from './PremiumRationale'
import { FileTreePicker } from './FileTreePicker'
import { useContextPrefs } from '../../hooks/useContextPrefs'
```

Inside the `SuggestNameDescriptionModal` component, after `const aiStatus = useAIStatus()`:

```jsx
    const { prefs, setSignal, reset: resetPrefs } = useContextPrefs()
    const [customFiles, setCustomFiles] = useState([])
    const [pickerOpen, setPickerOpen] = useState(false)
```

Modify `fetchSuggestion` to pass the context:

```jsx
    const fetchSuggestion = async () => {
        if (!repo) return
        abortRef.current?.abort()
        const ctrl = new AbortController()
        abortRef.current = ctrl
        setLoading(true)
        setError(null)
        try {
            const result = await aiApi.suggestNameDescription(repo.id, {
                context: {
                    signals: prefs.signals,
                    customFiles: customFiles.map((f) => f.path),
                },
            })
            if (ctrl.signal.aborted) return
            setSuggestion(result)
            setNameValue(result.proposed.name)
            setDescValue(result.proposed.description)
            setUseName(!result.noChange.name)
            setUseDesc(!result.noChange.description)
            setAckRename(false)
            setConfirmingRegenerate(false)
        } catch (e) {
            if (ctrl.signal.aborted) return
            setError(e)
        } finally {
            if (!ctrl.signal.aborted) setLoading(false)
        }
    }
```

Insert the `<ContextPicker />` before the existing field cards. Find the line `<div className="grid gap-4 mt-3">` (around line 348) and add ABOVE it:

```jsx
            <ContextPicker
                mode="single"
                signals={prefs.signals}
                onSignalChange={setSignal}
                customFiles={customFiles}
                onAddCustomFile={() => setPickerOpen(true)}
                onRemoveCustomFile={(p) => setCustomFiles((prev) => prev.filter((f) => f.path !== p))}
                onReset={() => { resetPrefs(); setCustomFiles([]) }}
            />

            <FileTreePicker
                isOpen={pickerOpen}
                owner={repo?.owner?.login}
                repoName={repo?.name}
                branch={repo?.default_branch}
                onPick={(entry) => {
                    if (customFiles.length >= 5) { setPickerOpen(false); return }
                    if (customFiles.find((f) => f.path === entry.path)) { setPickerOpen(false); return }
                    setCustomFiles((prev) => [...prev, entry])
                    setPickerOpen(false)
                }}
                onClose={() => setPickerOpen(false)}
            />
```

Replace the existing rationale `InsightCard` block at the bottom of the modal (the `{suggestion?.rationale && (...)}` block) with:

```jsx
                {suggestion && (
                    <PremiumRationale
                        source={suggestion.source}
                        rationale={suggestion.rationale}
                        confidence={suggestion.confidence}
                        signalsUsed={suggestion.signalsUsed}
                        redactions={suggestion.redactions}
                    />
                )}
```

- [ ] **Step 3: Update the modal's existing test file**

Open `tests/components/AI/SuggestNameDescriptionModal.test.jsx` and run it as-is to see what breaks:

Run: `npx vitest run tests/components/AI/SuggestNameDescriptionModal.test.jsx`

Update broken tests to:
1. Mock `useContextPrefs` (return defaults; `setSignal` and `reset` as `vi.fn()`).
2. Verify `aiApi.suggestNameDescription` is called with the new `(repoId, { context })` signature.
3. Add a test asserting `<PremiumRationale />` renders with `confidence="high"` when the mock response includes that field.

Add this new test case to that file (the rest of the file's mocks should already exist):

```jsx
    it('renders PremiumRationale and forwards context in the suggest call', async () => {
        // arrange existing mock to return the enriched shape
        aiApi.suggestNameDescription.mockResolvedValueOnce({
            source: 'ai',
            current: { name: 'demo', description: '' },
            proposed: { name: 'demo', description: 'Tool for testing.' },
            rationale: 'Used README + manifest.',
            noChange: { name: true, description: false },
            confidence: 'high',
            signalsUsed: [{ kind: 'readme', label: 'README', bytes: 1500 }],
            redactions: [],
        });

        render(<SuggestNameDescriptionModal isOpen repo={REPO_FIXTURE} onClose={() => {}} onApplied={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /suggest with ai/i }));
        await waitFor(() => screen.getByText(/Used README \+ manifest/));

        expect(aiApi.suggestNameDescription).toHaveBeenCalledWith(REPO_FIXTURE.id, expect.objectContaining({ context: expect.any(Object) }));
        expect(screen.getByText(/HIGH/i)).toBeInTheDocument();
    });
```

- [ ] **Step 4: Run all modal tests**

Run: `npx vitest run tests/components/AI/SuggestNameDescriptionModal.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/ai.js src/components/AI/SuggestNameDescriptionModal.jsx tests/components/AI/SuggestNameDescriptionModal.test.jsx
git commit -m "feat(ai): premium suggest UI in single-repo modal"
```

---

## Phase 5 — Integration: Batch Modal

### Task 13: ContextPicker (batch) + per-row confidence in `PolishReview`

**Files:**
- Modify: `src/hooks/useAIPolish.js`
- Modify: `src/components/AIPolish/PolishReview.jsx`
- Modify: `tests/hooks/useAIPolish.test.js`
- Modify: `tests/components/AIPolish/PolishReview.test.jsx` (create if missing)

- [ ] **Step 1: Thread `context` through `useAIPolish`**

Open `src/hooks/useAIPolish.js`. Add a new argument and forward it to the per-repo polish call. Find the function signature and the per-row fetcher; modify both:

```js
// Hook signature — add second arg
export function useAIPolish(repoFullNames, contextOptions = null) {
    // ...

    // Where it currently calls aiApi.polish.getDescription(repoId), replace with:
    const result = await aiApi.polish.getDescription(repoId, contextOptions ? { context: contextOptions } : {});
}
```

Also extend the per-row state to capture `confidence` from the response:

```js
// Wherever the row is updated after the suggest call succeeds, include:
return { ...row, status: 'ready', proposedDescription: result.proposed.description, confidence: result.confidence };
```

- [ ] **Step 2: Add ContextPicker into `PolishReview`**

Open `src/components/AIPolish/PolishReview.jsx`. Imports:

```jsx
import { ContextPicker } from '../AI/ContextPicker'
import { useContextPrefs } from '../../hooks/useContextPrefs'
```

Inside the component, replace the line:

```jsx
const { rows, phase, stats, quotaHit, setProposedDescription, toggleInclude, retryRow, apply } = useAIPolish(repoFullNames)
```

with:

```jsx
const { prefs, setSignal, reset: resetPrefs } = useContextPrefs()
const { rows, phase, stats, quotaHit, setProposedDescription, toggleInclude, retryRow, apply } = useAIPolish(
    repoFullNames,
    { signals: prefs.signals, customFiles: [] },
)
```

Insert the picker above the `<div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">` (the table container), as a new sibling under the header div:

```jsx
            <ContextPicker
                mode="batch"
                signals={prefs.signals}
                onSignalChange={setSignal}
                onReset={resetPrefs}
            />
```

In the table row JSX, add a confidence dot before the status pill. Find the `{row.status === 'ready' ? (` branch and add (just before that ternary, inside the same `<div className="flex justify-end">`):

```jsx
                                {row.confidence && (
                                    <span
                                        aria-label={`Confidence ${row.confidence}`}
                                        title={`Confidence: ${row.confidence}`}
                                        className={`inline-block w-2 h-2 rounded-full mr-2 ${
                                            row.confidence === 'high' ? 'bg-emerald-500'
                                            : row.confidence === 'medium' ? 'bg-amber-500'
                                            : 'bg-rose-500'
                                        }`}
                                    />
                                )}
```

- [ ] **Step 3: Update `useAIPolish` tests**

Open `tests/hooks/useAIPolish.test.js`. Update the mock for `aiApi.polish.getDescription` to receive `(repoId, options)` (currently single-arg):

```js
expect(aiApi.polish.getDescription).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ context: expect.objectContaining({ signals: expect.any(Object) }) }));
```

Also assert the row exposes `confidence` from the returned mock value.

- [ ] **Step 4: Update / create `PolishReview.test.jsx`**

In `tests/components/AIPolish/PolishReview.test.jsx`, add (or augment existing tests with) a render that asserts:
1. The `<ContextPicker />` panel renders.
2. Rows with `confidence: 'high'` render the green dot (query for the `aria-label="Confidence high"` element).

Skeleton if the file doesn't exist yet:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PolishReview } from '../../../src/components/AIPolish/PolishReview';

vi.mock('../../../src/hooks/useAIPolish', () => ({
    useAIPolish: () => ({
        rows: [
            { fullName: 'me/repo', status: 'ready', proposedDescription: 'A tool.', currentDescription: '', include: true, confidence: 'high' },
        ],
        phase: 'idle',
        stats: { total: 1, includedReady: 1, error: 0, done: 0 },
        quotaHit: false,
        setProposedDescription: vi.fn(),
        toggleInclude: vi.fn(),
        retryRow: vi.fn(),
        apply: vi.fn(),
    }),
}));

describe('<PolishReview />', () => {
    it('renders ContextPicker and confidence dot', () => {
        render(<PolishReview repoFullNames={['me/repo']} />);
        expect(screen.getByText(/context/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/confidence high/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 5: Run hook + component tests**

Run: `npx vitest run tests/hooks/useAIPolish.test.js tests/components/AIPolish/PolishReview.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAIPolish.js src/components/AIPolish/PolishReview.jsx tests/hooks/useAIPolish.test.js tests/components/AIPolish/PolishReview.test.jsx
git commit -m "feat(ai): ContextPicker + per-row confidence in batch polish"
```

---

## Phase 6 — End-to-End

### Task 14: Playwright e2e — premium suggest golden path

**Files:**
- Create: `e2e/suggest-name-description-premium.spec.js`

- [ ] **Step 1: Write the e2e**

Create `e2e/suggest-name-description-premium.spec.js`:

```js
import { test, expect } from '@playwright/test';

test.describe('Premium Suggest Name & Description', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/?demo=1'); // assumes the existing demo / mock-mode entry point
    });

    test('opens modal, expands ContextPicker, runs suggest, sees confidence pill', async ({ page }) => {
        // Navigate into a repo's settings (the existing entry point that opens the modal).
        await page.getByRole('button', { name: /settings/i }).first().click();
        await page.getByRole('button', { name: /suggest name & description/i }).click();

        const modal = page.getByRole('dialog');
        await expect(modal).toBeVisible();

        // Expand ContextPicker
        await modal.getByRole('button', { name: /context/i }).click();

        // Default signals visible
        await expect(modal.getByLabelText(/README/i)).toBeChecked();
        await expect(modal.getByLabelText(/Manifest/i)).toBeChecked();

        // Enable entrypoints
        await modal.getByLabelText(/entrypoints/i).check();

        // Click suggest
        await modal.getByRole('button', { name: /suggest with ai|suggest \(heuristic\)/i }).click();

        // Premium rationale renders with a confidence label
        await expect(modal.getByText(/Confidence (HIGH|MEDIUM|LOW)/i)).toBeVisible();

        // Apply path stays unchanged
        await modal.getByRole('button', { name: /apply changes/i }).click();
    });

    test('rejects when custom files exceed budget', async ({ page }) => {
        // This relies on the dev mock returning a rejected /ai/suggest-name-description
        // when customFiles is non-empty AND under 8 KB cap. With no mock support, the test
        // is .fixme until backend mock is wired.
        test.fixme(true, 'requires mock-mode wiring of customFiles → 400 path');
    });
});
```

- [ ] **Step 2: Run the e2e**

Run: `npx playwright test e2e/suggest-name-description-premium.spec.js`
Expected: 1 PASS, 1 fixme-skipped.

- [ ] **Step 3: Commit**

```bash
git add e2e/suggest-name-description-premium.spec.js
git commit -m "test(e2e): premium suggest name & description happy path"
```

---

## Self-Review

Run through this list before handing off:

1. **Spec coverage**
   - "Configurable, multi-signal view" → Tasks 2-5 ✓
   - "Hard byte cap" → Task 5 (over-budget rejection) + per-signal caps in Tasks 3-5 ✓
   - "Server-side secret redaction" → Task 1 ✓
   - "Confidence score visible" → Task 3 (compute) + Task 11 (render) ✓
   - "Shared pipeline both surfaces" → Tasks 6 + 13 ✓
   - "ContextPicker single + batch modes" → Tasks 9 + 12 + 13 ✓
   - "FileTreePicker (single only)" → Task 10 + Task 7 (server) ✓
   - "PremiumRationale with signals + redactions" → Task 11 + 12 ✓
   - "Tree endpoint with truncated cap" → Task 7 ✓
   - "Phase B exclusions" — none touched ✓

2. **No placeholders** — every code step has actual code; no "TBD" / "implement later".

3. **Type / API consistency**
   - `signalsUsed[].kind` strings match across builder (Task 3-5), route (Task 6), Premium UI (Task 11): `readme | manifest | topicsLanguage | entrypoints | folderStructure | customFile`.
   - `confidence` enum `'high' | 'medium' | 'low'` consistent across builder, route, frontend rendering.
   - `customFiles` is `string[]` of paths (server) and `{ path, size }[]` (client picker chips); the modal converts via `customFiles.map((f) => f.path)` in Task 12.
   - `prefs.signals` keys match the `signals` field on the route body schema in Task 6.

---

## Execution Handoff

Plan complete and saved to [docs/plans/2026-05-09-premium-suggest-context.md](./2026-05-09-premium-suggest-context.md). Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
