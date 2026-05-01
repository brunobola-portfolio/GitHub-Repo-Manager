# Community Health AI Auto-Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-missing-file "Fix with AI" buttons to Community Health, plus the server-side generators + GitHub commit/PR helper that back them.

**Architecture:** 7 file generators (2 deterministic, 5 AI-backed) live in `server/lib/ai-features/community-health-fix.js`. Two new HTTP endpoints in `actions-community.js` separate generation (returns content) from commit (writes to repo). Client adds a 3-state modal that previews, lets the user edit, then commits. Branch protection auto-falls back to a PR.

**Tech Stack:** Express 5, better-sqlite3, GitHub Contents API, AI provider abstraction (`createProviderForUser`), React 19, Framer Motion, Vitest, Playwright.

**Spec:** [`docs/specs/2026-05-01-community-health-ai-autofix.md`](../specs/2026-05-01-community-health-ai-autofix.md)

**Prerequisites:** Slice 1 (Action Surface Unification) must be merged for the `fix_community_health` registry entry in Task 9. If slice 1 is unmerged, skip Task 9 and add a TODO note in the PR description.

---

## File Structure

**Created:**
- `server/lib/ai-features/community-health-fix.js`
- `server/lib/ai-features/license-templates/MIT.txt`
- `server/lib/ai-features/license-templates/Apache-2.0.txt`
- `server/lib/ai-features/license-templates/GPL-3.0.txt`
- `server/lib/ai-features/license-templates/BSD-3-Clause.txt`
- `server/lib/ai-features/license-templates/MPL-2.0.txt`
- `server/lib/ai-features/code-of-conduct-template.txt` (Contributor Covenant 2.1)
- `server/lib/ai-features/__tests__/community-health-fix.test.js`
- `server/__tests__/community-health-fix-route.test.js`
- `src/components/AI/CommunityHealthFixModal.jsx`
- `tests/components/AI/CommunityHealthFixModal.test.jsx`
- `e2e/community-health-fix.spec.js`

**Modified:**
- `server/routes/repos/actions-community.js` — adds 2 new endpoints
- `src/components/CommunityHealthDashboard.jsx` — `FileCheckItem` gains "Fix with AI" button when `!exists`
- `src/components/ui/ModalContext.jsx` (or wherever modal registry lives) — register `showCommunityHealthFix` modal
- `src/actions/repoActions.js` (if slice 1 is merged) — add `fix_community_health` entry
- `docs/architecture/overview.md` — new subsection

---

## Task 1: License templates + deterministic LICENSE generator

**Files:**
- Create: `server/lib/ai-features/license-templates/{MIT,Apache-2.0,GPL-3.0,BSD-3-Clause,MPL-2.0}.txt`
- Create: `server/lib/ai-features/community-health-fix.js`
- Create: `server/lib/ai-features/__tests__/community-health-fix.test.js`

- [ ] **Step 1.1: Add license template files**

Each file is the canonical text from `choosealicense.com` with placeholders `{{year}}` and `{{owner}}` (and `{{project}}` for some). Pull verbatim — DO NOT paraphrase. Sources:
- MIT: https://choosealicense.com/licenses/mit/
- Apache-2.0: https://choosealicense.com/licenses/apache-2.0/
- GPL-3.0: https://choosealicense.com/licenses/gpl-3.0/
- BSD-3-Clause: https://choosealicense.com/licenses/bsd-3-clause/
- MPL-2.0: https://choosealicense.com/licenses/mpl-2.0/

Where the canonical text has `[year]` / `[fullname]`, replace with `{{year}}` / `{{owner}}`.

- [ ] **Step 1.2: Write the failing test**

Create `server/lib/ai-features/__tests__/community-health-fix.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { generateLicense, FILE_GENERATORS } from '../community-health-fix.js'

describe('generateLicense', () => {
  it('substitutes {{year}} and {{owner}} in MIT', () => {
    const out = generateLicense({ licenseId: 'MIT', owner: 'Acme Corp', year: 2026 })
    expect(out.filePath).toBe('LICENSE')
    expect(out.content).toContain('Copyright (c) 2026 Acme Corp')
    expect(out.content).not.toContain('{{')
  })

  it('throws on unsupported licenseId', () => {
    expect(() => generateLicense({ licenseId: 'WTFPL', owner: 'x', year: 2026 })).toThrow(/unsupported/i)
  })

  it('FILE_GENERATORS.license is marked deterministic', () => {
    expect(FILE_GENERATORS.license.deterministic).toBe(true)
  })

  it('all 5 supported licenses load and substitute', () => {
    for (const id of ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'MPL-2.0']) {
      const out = generateLicense({ licenseId: id, owner: 'Test', year: 2026 })
      expect(out.content).not.toContain('{{')
      expect(out.content.length).toBeGreaterThan(100)
    }
  })
})
```

- [ ] **Step 1.3: Run test → red**

```
npx vitest run server/lib/ai-features/__tests__/community-health-fix.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 1.4: Implement `generateLicense` + skeleton `FILE_GENERATORS`**

Create `server/lib/ai-features/community-health-fix.js`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, 'license-templates')

const SUPPORTED_LICENSES = ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'MPL-2.0']

function loadLicenseTemplate(id) {
  if (!SUPPORTED_LICENSES.includes(id)) {
    throw new Error(`unsupported license: ${id}`)
  }
  return fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.txt`), 'utf8')
}

export function generateLicense({ licenseId = 'MIT', owner, year } = {}) {
  const template = loadLicenseTemplate(licenseId)
  const content = template
    .replaceAll('{{year}}', String(year ?? new Date().getFullYear()))
    .replaceAll('{{owner}}', owner ?? 'Repository owner')
  return {
    filePath: 'LICENSE',
    content,
    suggestedCommitMessage: `chore: add ${licenseId} license`,
  }
}

export const FILE_GENERATORS = {
  license: { path: 'LICENSE', generator: generateLicense, deterministic: true },
  // others added in subsequent tasks
}
```

- [ ] **Step 1.5: Run test → green**

```
npx vitest run server/lib/ai-features/__tests__/community-health-fix.test.js
```

Expected: 4 passed.

- [ ] **Step 1.6: Commit**

```bash
git add server/lib/ai-features/community-health-fix.js server/lib/ai-features/license-templates/ server/lib/ai-features/__tests__/community-health-fix.test.js
git commit -m "feat(community-health): deterministic LICENSE generator with 5 templates"
```

---

## Task 2: CODE_OF_CONDUCT.md deterministic generator

**Files:**
- Create: `server/lib/ai-features/code-of-conduct-template.txt`
- Modify: `server/lib/ai-features/community-health-fix.js`
- Modify: `server/lib/ai-features/__tests__/community-health-fix.test.js`

- [ ] **Step 2.1: Add Contributor Covenant 2.1 template**

Source: https://www.contributor-covenant.org/version/2/1/code_of_conduct.txt

Save verbatim with placeholder `{{contact_email}}` substituted for the `[INSERT CONTACT METHOD]` slot in the canonical text.

- [ ] **Step 2.2: Failing test**

Append to `community-health-fix.test.js`:

```js
import { generateCodeOfConduct } from '../community-health-fix.js'

describe('generateCodeOfConduct', () => {
  it('substitutes {{contact_email}}', () => {
    const out = generateCodeOfConduct({ email: 'security@acme.test' })
    expect(out.filePath).toBe('CODE_OF_CONDUCT.md')
    expect(out.content).toContain('security@acme.test')
    expect(out.content).not.toContain('{{')
  })

  it('FILE_GENERATORS.code_of_conduct is marked deterministic', () => {
    expect(FILE_GENERATORS.code_of_conduct.deterministic).toBe(true)
  })
})
```

- [ ] **Step 2.3: Run → red**

- [ ] **Step 2.4: Implement**

Append to `community-health-fix.js`:

```js
const COC_TEMPLATE = fs.readFileSync(path.join(__dirname, 'code-of-conduct-template.txt'), 'utf8')

export function generateCodeOfConduct({ email = 'admin@example.com' } = {}) {
  return {
    filePath: 'CODE_OF_CONDUCT.md',
    content: COC_TEMPLATE.replaceAll('{{contact_email}}', email),
    suggestedCommitMessage: 'chore: add Code of Conduct',
  }
}

FILE_GENERATORS.code_of_conduct = { path: 'CODE_OF_CONDUCT.md', generator: generateCodeOfConduct, deterministic: true }
```

- [ ] **Step 2.5: Test → green + commit**

```bash
git add -A && git commit -m "feat(community-health): deterministic Code of Conduct generator (Contributor Covenant 2.1)"
```

---

## Task 3: AI generators for the 5 non-deterministic types

**Files:**
- Modify: `server/lib/ai-features/community-health-fix.js`
- Modify: `server/lib/ai-features/__tests__/community-health-fix.test.js`

- [ ] **Step 3.1: Failing tests**

Append to test file:

```js
import { vi } from 'vitest'
import { generateContributing, generateSecurityMd, generateIssueTemplate, generatePRTemplate, generateReadmeStub } from '../community-health-fix.js'

describe('AI-backed generators', () => {
  const mkProvider = (text) => ({ generate: vi.fn(async () => ({ text, parsed: null })) })

  it('generateContributing sends the documented prompt shape', async () => {
    const provider = mkProvider('# Contributing\n\nbody')
    const out = await generateContributing({ repo: { full_name: 'acme/x', description: 'Tool', language: 'TS' }, provider })
    expect(provider.generate).toHaveBeenCalledOnce()
    const call = provider.generate.mock.calls[0][0]
    expect(call.prompt).toMatch(/CONTRIBUTING/)
    expect(call.prompt).toMatch(/acme\/x/)
    expect(out.filePath).toBe('CONTRIBUTING.md')
    expect(out.content).toContain('Contributing')
  })

  it('generateSecurityMd returns SECURITY.md filePath', async () => {
    const out = await generateSecurityMd({ repo: { full_name: 'a/b' }, email: 'sec@a.test', provider: mkProvider('## Reporting…') })
    expect(out.filePath).toBe('SECURITY.md')
  })

  it('generateIssueTemplate returns the bug_report path', async () => {
    const out = await generateIssueTemplate({ repo: { full_name: 'a/b', language: 'JS' }, provider: mkProvider('---\nname: Bug\n---') })
    expect(out.filePath).toBe('.github/ISSUE_TEMPLATE/bug_report.md')
  })

  it('generatePRTemplate returns the PR template path', async () => {
    const out = await generatePRTemplate({ repo: { full_name: 'a/b' }, provider: mkProvider('## Summary') })
    expect(out.filePath).toBe('.github/PULL_REQUEST_TEMPLATE.md')
  })

  it('generateReadmeStub returns README.md path', async () => {
    const out = await generateReadmeStub({ repo: { full_name: 'a/b', description: 'x', language: 'Go' }, provider: mkProvider('# a/b') })
    expect(out.filePath).toBe('README.md')
  })

  it('sanitizes repo.description before substitution', async () => {
    const provider = mkProvider('out')
    await generateContributing({ repo: { full_name: 'a/b', description: 'Tool {{evil}} prompt-inject' }, provider })
    const prompt = provider.generate.mock.calls[0][0].prompt
    // Sanitizer strips the {{ ... }} substitutions or escapes them
    expect(prompt).not.toContain('{{evil}}')
  })
})
```

- [ ] **Step 3.2: Run → red**

- [ ] **Step 3.3: Implement**

Append to `community-health-fix.js`:

```js
import { sanitizeForPrompt } from './sanitize.js'

function clean(s) { return sanitizeForPrompt(s ?? '').slice(0, 500) }

export async function generateContributing({ repo, provider }) {
  const prompt = `Write a CONTRIBUTING.md for ${clean(repo.full_name)}, a ${clean(repo.description)}. Cover: setup, build, test, PR guidelines, commit message format. Tone: friendly, professional. ≤ 800 words. No headings deeper than H3. Output Markdown.`
  const result = await provider.generate({ prompt })
  return {
    filePath: 'CONTRIBUTING.md',
    content: result.text || '',
    suggestedCommitMessage: 'chore: add CONTRIBUTING.md',
  }
}

export async function generateSecurityMd({ repo, email, provider }) {
  const prompt = `Write a SECURITY.md for ${clean(repo.full_name)}. Cover supported versions, how to report a vulnerability, expected response time. Use the email ${email}. ≤ 400 words. Output Markdown.`
  const result = await provider.generate({ prompt })
  return {
    filePath: 'SECURITY.md',
    content: result.text || '',
    suggestedCommitMessage: 'chore: add SECURITY.md',
  }
}

export async function generateIssueTemplate({ repo, provider }) {
  const prompt = `Write a GitHub bug report issue template for ${clean(repo.full_name)}. Standard sections: description, reproduction steps, expected behavior, actual behavior, environment. Project tech stack: ${clean(repo.language)}. Output Markdown with YAML front matter (name, about, title, labels). Keep total length under 1.5KB.`
  const result = await provider.generate({ prompt })
  return {
    filePath: '.github/ISSUE_TEMPLATE/bug_report.md',
    content: result.text || '',
    suggestedCommitMessage: 'chore: add bug report issue template',
  }
}

export async function generatePRTemplate({ repo, provider }) {
  const prompt = `Write a concise PR template for ${clean(repo.full_name)}. Sections: summary, related issues, testing notes, screenshots (if UI). ≤ 300 words. Output Markdown.`
  const result = await provider.generate({ prompt })
  return {
    filePath: '.github/PULL_REQUEST_TEMPLATE.md',
    content: result.text || '',
    suggestedCommitMessage: 'chore: add pull request template',
  }
}

export async function generateReadmeStub({ repo, provider }) {
  const prompt = `Write a README.md for ${clean(repo.full_name)}, a ${clean(repo.description)}. Include: title, badges placeholder, install, quick start, license. Tech stack: ${clean(repo.language)}. ≤ 500 words. Use H2 for sections. Output Markdown.`
  const result = await provider.generate({ prompt })
  return {
    filePath: 'README.md',
    content: result.text || '',
    suggestedCommitMessage: 'chore: add README stub',
  }
}

Object.assign(FILE_GENERATORS, {
  contributing: { path: 'CONTRIBUTING.md', generator: generateContributing, deterministic: false },
  security: { path: 'SECURITY.md', generator: generateSecurityMd, deterministic: false },
  issue_template: { path: '.github/ISSUE_TEMPLATE/bug_report.md', generator: generateIssueTemplate, deterministic: false },
  pr_template: { path: '.github/PULL_REQUEST_TEMPLATE.md', generator: generatePRTemplate, deterministic: false },
  readme_stub: { path: 'README.md', generator: generateReadmeStub, deterministic: false },
})
```

> **Note:** `sanitize.js` already exists at `server/lib/ai-features/sanitize.js`. If `sanitizeForPrompt` is not exported, add it as a thin wrapper around the existing sanitizer that strips `{{...}}` Mustache-style braces and trims length.

- [ ] **Step 3.4: Run → green + commit**

```bash
git add -A && git commit -m "feat(community-health): AI generators for CONTRIBUTING/SECURITY/templates/README"
```

---

## Task 4: GitHub commit helper with branch-protection fallback

**Files:**
- Modify: `server/lib/ai-features/community-health-fix.js`
- Modify: `server/lib/ai-features/__tests__/community-health-fix.test.js`

- [ ] **Step 4.1: Failing tests**

Append:

```js
import { commitOrOpenPR } from '../community-health-fix.js'

describe('commitOrOpenPR', () => {
  const mkGithub = ({ protection = false, defaultBranch = 'main', putOk = true, prNumber = 42 } = {}) => {
    return vi.fn(async (path, _token, options = {}) => {
      if (path.endsWith('/branches/main/protection')) {
        return protection
          ? { data: { required_pull_request_reviews: {} } }
          : (() => { const e = new Error('Not Found'); e.status = 404; throw e })()
      }
      if (path === '/repos/a/b') return { data: { default_branch: defaultBranch } }
      if (path.includes('/contents/') && options.method === 'PUT') {
        if (!putOk) { const e = new Error('protected'); e.status = 422; throw e }
        return { data: { content: { sha: 'abc123' }, commit: { sha: 'def456' } } }
      }
      if (path.endsWith('/git/refs') && options.method === 'POST') return { data: { ref: 'refs/heads/chore/health' } }
      if (path === '/repos/a/b/pulls' && options.method === 'POST') return { data: { number: prNumber, html_url: `https://github.com/a/b/pull/${prNumber}` } }
      throw new Error(`unmocked: ${path}`)
    })
  }

  it('direct commit when default branch is unprotected', async () => {
    const githubApi = mkGithub({ protection: false })
    const out = await commitOrOpenPR({
      owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content: 'x',
      commitMessage: 'add license', mode: 'direct', githubApi,
    })
    expect(out.mode).toBe('direct')
    expect(out.sha).toBe('abc123')
    expect(out.branch).toBe('main')
  })

  it('falls back to PR when default branch is protected', async () => {
    const githubApi = mkGithub({ protection: true })
    const out = await commitOrOpenPR({
      owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content: 'x',
      commitMessage: 'add license', mode: 'direct', githubApi,
    })
    expect(out.mode).toBe('pr-fallback')
    expect(out.prUrl).toMatch(/pull\/42$/)
    expect(out.branch).toMatch(/^chore\/community-health-fixes-/)
  })

  it('honors explicit mode=pr without checking protection', async () => {
    const githubApi = mkGithub({ protection: false })
    const out = await commitOrOpenPR({
      owner: 'a', repo: 'b', token: 't', filePath: 'LICENSE', content: 'x',
      commitMessage: 'add license', mode: 'pr', githubApi,
    })
    expect(out.mode).toBe('pr')
  })
})
```

- [ ] **Step 4.2: Run → red**

- [ ] **Step 4.3: Implement**

Append:

```js
async function isDefaultBranchProtected({ owner, repo, defaultBranch, token, githubApi }) {
  try {
    await githubApi(`/repos/${owner}/${repo}/branches/${defaultBranch}/protection`, token)
    return true
  } catch (err) {
    if (err.status === 404) return false
    throw err
  }
}

export async function commitOrOpenPR({ owner, repo, token, filePath, content, commitMessage, mode = 'direct', githubApi }) {
  const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, token)
  const defaultBranch = repoData.default_branch || 'main'

  const wantsPR = mode === 'pr'
  const protectedDefault = !wantsPR && (await isDefaultBranchProtected({ owner, repo, defaultBranch, token, githubApi }))

  if (wantsPR || protectedDefault) {
    const branch = `chore/community-health-fixes-${Date.now()}`
    // 1. get default branch ref SHA
    const { data: ref } = await githubApi(`/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`, token)
    // 2. create new branch
    await githubApi(`/repos/${owner}/${repo}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object?.sha || ref.sha }),
    })
    // 3. PUT the file on the new branch
    await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
      }),
    })
    // 4. open PR
    const { data: pr } = await githubApi(`/repos/${owner}/${repo}/pulls`, token, {
      method: 'POST',
      body: JSON.stringify({ title: commitMessage, head: branch, base: defaultBranch, body: 'Automated fix from Community Health auto-fix.' }),
    })
    return { mode: protectedDefault ? 'pr-fallback' : 'pr', branch, prUrl: pr.html_url }
  }

  const { data: put } = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: defaultBranch,
    }),
  })
  return { mode: 'direct', branch: defaultBranch, sha: put.content?.sha || put.commit?.sha }
}
```

- [ ] **Step 4.4: Run → green + commit**

```bash
git add -A && git commit -m "feat(community-health): GitHub commit helper with branch-protection PR fallback"
```

---

## Task 5: POST /community-health/generate endpoint

**Files:**
- Modify: `server/routes/repos/actions-community.js`
- Create: `server/__tests__/community-health-fix-route.test.js`

- [ ] **Step 5.1: Failing test (route shape)**

Create `server/__tests__/community-health-fix-route.test.js` with mocked AI provider + mocked githubApi. The test asserts:
- `POST /:owner/:repo/community-health/generate` body `{ fileType: 'license', overrides: { licenseId: 'MIT' } }` → 200 with `{ filePath: 'LICENSE', content: '...MIT...', suggestedCommitMessage: '...' }`.
- Same with `fileType: 'contributing'` → calls AI provider, returns content.
- Without provider configured → 403 `ai_not_configured`.
- AI quota error → 429 `ai_quota_exceeded` with friendly message (reuse helper from work-board-actions slice 3 fix).

(Use the existing test harness pattern from `server/__tests__/work-board-actions.test.js`.)

- [ ] **Step 5.2: Run → red**

- [ ] **Step 5.3: Implement**

In `server/routes/repos/actions-community.js`, add:

```js
import { FILE_GENERATORS, commitOrOpenPR } from '../../lib/ai-features/community-health-fix.js'
import { createProviderForUser } from '../../lib/ai-provider.js'
import { AI_ERROR_CODE } from '../../lib/ai-provider.js'
import { mapAIErrorToResponse } from '../../middleware/ai-error-mapper.js'  // extracted from work-board-actions slice 3 fix; see Task 5.4

router.post('/:owner/:repo/community-health/generate', requireAuth, async (req, res) => {
  const { owner, repo } = req.params
  const { fileType, overrides = {} } = req.body || {}

  const gen = FILE_GENERATORS[fileType]
  if (!gen) return res.status(400).json({ error: `unknown fileType: ${fileType}`, code: 'invalid_file_type' })

  try {
    const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken)

    // Deterministic branch — no AI provider needed.
    if (gen.deterministic) {
      const out = fileType === 'license'
        ? gen.generator({ licenseId: overrides.licenseId || 'MIT', owner: repoData.owner.login, year: new Date().getFullYear() })
        : gen.generator({ email: overrides.email || req.session.userEmail || 'admin@example.com' })
      return res.json(out)
    }

    // AI branch.
    const provider = await createProviderForUser(req.session.userId, 'completion', { featureKey: 'COMMUNITY_HEALTH_FIX' })
    if (!provider) return res.status(403).json({ error: 'AI is not configured for this user', code: 'ai_not_configured' })

    const out = await gen.generator({ repo: repoData, email: overrides.email, provider })
    res.json(out)
  } catch (e) {
    if (e?.name === 'AIError') return mapAIErrorToResponse(res, e)
    res.status(500).json({ error: safeError(e, 'community health fix generation failed') })
  }
})
```

- [ ] **Step 5.4: Extract `mapAIErrorToResponse` helper**

`server/middleware/ai-error-mapper.js` consolidates the AIError→HTTP mapping that lives inline in `work-board-actions.js` (slice 3 fix `b9e093a`). Move that block here and import from both call sites. Add unit test in `server/__tests__/ai-error-mapper.test.js`.

- [ ] **Step 5.5: Run → green + commit**

```bash
git add -A && git commit -m "feat(community-health): /generate endpoint + shared AIError mapper"
```

---

## Task 6: POST /community-health/commit-fix endpoint + cache invalidation

**Files:**
- Modify: `server/routes/repos/actions-community.js`
- Modify: `server/__tests__/community-health-fix-route.test.js`

- [ ] **Step 6.1: Failing tests**

Append:
- POST `/:owner/:repo/community-health/commit-fix` with valid body returns 200 with `{ committed: true, sha, branch }`.
- Returns `mode: 'pr-fallback'` when default branch is protected.
- Invalidates `community_health_cache` row for `(userId, repoId)` on success.

- [ ] **Step 6.2: Run → red**

- [ ] **Step 6.3: Implement**

```js
router.post('/:owner/:repo/community-health/commit-fix', requireAuth, async (req, res) => {
  const { owner, repo } = req.params
  const { filePath, content, commitMessage, mode = 'direct' } = req.body || {}

  if (!filePath || !content || !commitMessage) {
    return res.status(400).json({ error: 'missing required fields', code: 'invalid_body' })
  }

  try {
    const result = await commitOrOpenPR({
      owner, repo, token: req.session.accessToken,
      filePath, content, commitMessage, mode, githubApi,
    })

    // Invalidate cache for this repo so the next dashboard open re-fetches.
    const { data: repoData } = await githubApi(`/repos/${owner}/${repo}`, req.session.accessToken)
    db.prepare('DELETE FROM community_health_cache WHERE user_id = ? AND repo_id = ?')
      .run(req.session.userId, repoData.id)

    res.json({ committed: true, ...result })
  } catch (e) {
    res.status(500).json({ error: safeError(e, 'community health fix commit failed') })
  }
})
```

- [ ] **Step 6.4: Run → green + commit**

```bash
git add -A && git commit -m "feat(community-health): /commit-fix endpoint with cache invalidation"
```

---

## Task 7: CommunityHealthFixModal component (3 states)

**Files:**
- Create: `src/components/AI/CommunityHealthFixModal.jsx`
- Create: `tests/components/AI/CommunityHealthFixModal.test.jsx`

- [ ] **Step 7.1: Failing tests**

Cover:
- Generate state: shows skeleton while `/generate` is in flight.
- Preview state: renders file path, editable textarea pre-populated with content, "Commit" button.
- Edit modifies content, click Commit → POSTs `/commit-fix` with edited content.
- Committed state: shows commit SHA + link.
- AI not configured response → shows "Configure AI" CTA, modal stays open.
- Quota error → friendly headline (reuses `friendlyAiError` from `AISummaryCard.jsx` — extract into shared util `src/utils/aiErrorFriendly.js` if needed).

- [ ] **Step 7.2: Implement**

`<CommunityHealthFixModal>` props:
- `isOpen`, `onClose`
- `repo` (full object)
- `fileType` (one of the 7 keys)
- `onCommitted(commitInfo)` — called when commit succeeds; parent invalidates local health cache state.

State machine: `idle | generating | preview | committing | committed | error`.

Use `Modal` from `src/components/ui/Modal.jsx`. Editor is a plain `<textarea>` styled with `font-mono`. License-picker dropdown only appears when `fileType === 'license'`.

- [ ] **Step 7.3: Extract `friendlyAiError` into `src/utils/aiErrorFriendly.js`**

The function shipped inside `AISummaryCard.jsx` (commit `b9e093a`). Move it out to a util module and import from both `AISummaryCard.jsx` and `CommunityHealthFixModal.jsx`. No behavior change.

- [ ] **Step 7.4: Run tests + commit**

```bash
git add -A && git commit -m "feat(community-health): CommunityHealthFixModal with 3-state flow"
```

---

## Task 8: Wire "Fix with AI" button into FileCheckItem

**Files:**
- Modify: `src/components/CommunityHealthDashboard.jsx`
- Modify: `tests/components/CommunityHealthDashboard.test.jsx` (or create)

- [ ] **Step 8.1: Add button to FileCheckItem**

When `exists === false`, render a small "Fix with AI" button (Sparkles icon + label). Hidden when `aiConfigured === false`; replaced with a "Configure AI" link to Settings.

The component needs:
- A new prop `onFix(fileType)` passed down from the dashboard.
- Awareness of `aiConfigured` (bool) — fetched once via `useAIStatus()` hook (already exists per project memory) or a new `useAIConfigured()` hook that pings `/api/ai/status`.

- [ ] **Step 8.2: Map file label → fileType key**

The dashboard renders rows like `README.md`, `LICENSE`, `CONTRIBUTING.md`, etc. Add a mapping at the top of `CommunityHealthDashboard.jsx`:

```js
const FILE_TYPE_BY_LABEL = {
  'README.md': 'readme_stub',
  'LICENSE': 'license',
  'CONTRIBUTING.md': 'contributing',
  'CODE_OF_CONDUCT.md': 'code_of_conduct',
  'SECURITY.md': 'security',
  '.github/ISSUE_TEMPLATE': 'issue_template',
  '.github/PULL_REQUEST_TEMPLATE.md': 'pr_template',
}
```

- [ ] **Step 8.3: Wire modal**

Dashboard owns `[fixOpen, setFixOpen] = useState(null)` where `null | 'license' | …`. Clicking "Fix with AI" sets it; modal renders when truthy.

- [ ] **Step 8.4: Update health row state after commit**

When `<CommunityHealthFixModal>`'s `onCommitted` fires, the dashboard re-fetches `/community-health` (or optimistically marks the row as `exists: true`). The cache was already invalidated server-side in Task 6.

- [ ] **Step 8.5: Tests + commit**

```bash
git add -A && git commit -m "feat(community-health): per-file Fix with AI button + modal wiring"
```

---

## Task 9: Action registry entry (depends on slice 1)

**Files:**
- Modify: `src/actions/repoActions.js` (only if slice 1 is merged into main)

- [ ] **Step 9.1: Check if slice 1 has landed**

```bash
ls src/actions/repoActions.js 2>/dev/null
```

If absent → SKIP this task. Add a TODO note in the PR description: "Action registry entry deferred until slice 1 merges (`feat/action-surface-unification`)."

If present → continue.

- [ ] **Step 9.2: Add entry**

In `src/actions/repoActions.js`, append:

```js
fix_community_health: {
  id: 'fix_community_health',
  label: 'Fix Community Health',
  description: 'AI generates missing community files (LICENSE, CONTRIBUTING, etc.) for one-click commit.',
  icon: Heart,
  intent: 'mutation',
  surfaces: ['contextMenu', 'commandPalette'],
  triggersRefresh: true,
  /** @unconfirmed-by-design opens a dedicated modal where the user previews + edits + commits per-file */
  run: async (repo, ctx) => ctx.openModalWithData('showCommunityHealth', { repo, focus: 'fix' }),
},
```

Add `Heart` to the lucide-react imports at the top of the file.

- [ ] **Step 9.3: Add registry test entry**

In `tests/actions/repoActions.test.js`, in the appropriate describe block:

```js
it('fix_community_health is registered', () => {
  expect(repoActions.fix_community_health).toBeDefined()
  expect(repoActions.fix_community_health.intent).toBe('mutation')
})
```

- [ ] **Step 9.4: Run tests + commit**

```bash
git add -A && git commit -m "feat(actions): register fix_community_health entry"
```

---

## Task 10: E2E test

**Files:**
- Create: `e2e/community-health-fix.spec.js`

- [ ] **Step 10.1: Write the e2e test**

Mock-mode user opens a repo with no LICENSE. Steps:
1. Navigate to `?mock=1`.
2. Open Community Health for first repo.
3. Find the LICENSE row with X icon.
4. Click "Fix with AI".
5. License picker shows MIT default.
6. Preview state appears with `Copyright (c) 2026 ...`.
7. Click "Commit".
8. Wait for "Committed" state.
9. Close modal.
10. LICENSE row now has checkmark.

(Use existing e2e helpers in `e2e/`. The mock backend needs to handle the new endpoints — add fixtures.)

- [ ] **Step 10.2: Run + commit**

```bash
npx playwright test e2e/community-health-fix.spec.js
git add -A && git commit -m "test(e2e): community health AI fix flow happy path"
```

---

## Task 11: Documentation

**Files:**
- Modify: `docs/architecture/overview.md`

- [ ] **Step 11.1: Add subsection**

After the "Action Registry" section, add:

```markdown
## Community Health AI Auto-Fix

When a repo's Community Health dashboard reports missing standard files, users can trigger a per-file "Fix with AI" flow that generates content (deterministic for LICENSE / CoC, AI for others) and commits it via the GitHub Contents API. Branch-protected default branches automatically fall back to PR mode.

Two endpoints separate generation from commit so a quota burn doesn't block a retry:
- `POST /:owner/:repo/community-health/generate` — returns content, no commit
- `POST /:owner/:repo/community-health/commit-fix` — takes user-edited content, commits

Generators live in [`server/lib/ai-features/community-health-fix.js`](../../server/lib/ai-features/community-health-fix.js). Spec: [`docs/specs/2026-05-01-community-health-ai-autofix.md`](../specs/2026-05-01-community-health-ai-autofix.md).
```

- [ ] **Step 11.2: Commit + push**

```bash
git add -A && git commit -m "docs(architecture): document community health auto-fix"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- All 7 file types — Tasks 1, 2, 3 (4 generators in 3 because of code reuse).
- 2 endpoints — Tasks 5, 6.
- Modal — Task 7.
- Wiring + button — Task 8.
- Action registry — Task 9 (conditional on slice 1).
- E2E — Task 10.
- Docs — Task 11.

**Placeholder scan:** None. Each task has full code or specific implementation guidance.

**Risk-aware decisions:**
- Generation/commit split is deliberate so quota errors don't lose work.
- Branch protection detection runs before commit so the fallback is automatic.
- `friendlyAiError` extracted into a util so it's reused.

**Bundle delta budget:** ~12 KB compressed for license texts (verbatim, common subwords compress well). New modal ~3 KB. Total ~+18 KB gzipped — within the +20 KB success criterion.
