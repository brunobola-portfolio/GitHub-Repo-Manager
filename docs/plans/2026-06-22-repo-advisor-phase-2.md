# Repo Advisor — Phase 2 (Capability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Repo Advisor *answer-first* — able to explain product errors (starting with the Git LFS migration error that it couldn't help with) grounded in an authored knowledge base, with a citation.

**Architecture:** The chat endpoint (`server/routes/ai/core.js` `POST /ai/chat`) builds a bare prompt today (no retrieval). We add a small, deterministic, version-controlled **error knowledge base** (a data module — not a DB table — for the curated seed) and inject the matched entry as a grounded "Known issue" block into the chat prompt, with a rule to answer from it and cite the doc. Reliable exact `error_code` / message matching beats embeddings for short error strings like `unknown unit: "m"`.

**Tech Stack:** Node.js/Express backend; Vitest. Reuses `buildChatPrompt` (`server/lib/ai-chat-prompt.js`) and the existing chat flow.

**Spec:** `docs/specs/2026-06-21-repo-advisor-initiative.md` (Phase 2).

## Global Constraints

- `.jsx`/`.js` only, no TypeScript. Conventional Commits, no `Co-Authored-By`. Backend tests in `server/__tests__/`.
- The KB content is **authored/first-party** (trusted) — it injects no user/repo content, so it adds NO new prompt-injection surface (security guardrails are deferred to the tool-use slices, per spec).
- Keep the deterministic lookup pure (no I/O) so it is trivially unit-testable.

## Slice decomposition (each slice = its own PR)

- **Slice 1 (this plan): Error KB + grounded chat answers.** Authored KB module + deterministic lookup + inject grounded block into `buildChatPrompt`. Seeds the LFS migration error family. ← build now.
- **Slice 2: Context-awareness.** Auto-seed the chat `context` with the last error / active job / current screen (frontend), so opening Repo Advisor after a failed migration pre-fills "how do I fix this?".
- **Slice 3: Tool-use + security guardrails.** If/when adding tools that read untrusted repo content or act, add the OWASP LLM06 / lethal-trifecta / tenant-isolation guardrails from the spec. (Not needed for Slices 1-2, which only inject trusted authored content.)
- **Slice 4 (future): DB-backed KB + hybrid retrieval + embeddings** once the KB outgrows a curated module.

---

### Task 1: Error KB data module + deterministic lookup

**Files:**
- Create: `server/lib/ai-features/error-kb.js`
- Test: `server/__tests__/error-kb.test.js`

**Interfaces:**
- Produces: `ERROR_KB` (array of entries) and `findErrorKbEntry({ message, code })` → the best-matching entry or `null`.
- Entry shape: `{ id: string, codes: string[], matchers: RegExp[], title: string, cause: string, fix: string[], docs: string }`.

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { findErrorKbEntry, ERROR_KB } from '../lib/ai-features/error-kb.js';

describe('findErrorKbEntry', () => {
  it('matches by explicit error code', () => {
    const e = findErrorKbEntry({ code: 'GIT_LFS_MISSING' });
    expect(e?.id).toBe('git-lfs-missing');
  });
  it('matches the git-lfs unit error by message substring', () => {
    const e = findErrorKbEntry({ message: 'Cannot parse --above=<n>: unknown unit: "m"' });
    expect(e?.id).toBe('lfs-migrate-failed');
  });
  it('matches oversized files by code', () => {
    expect(findErrorKbEntry({ code: 'OVERSIZED_FILES' })?.id).toBe('oversized-files');
  });
  it('returns null when nothing matches', () => {
    expect(findErrorKbEntry({ message: 'totally unrelated text' })).toBeNull();
  });
  it('every entry has the required shape', () => {
    for (const e of ERROR_KB) {
      expect(typeof e.id).toBe('string');
      expect(Array.isArray(e.codes)).toBe(true);
      expect(Array.isArray(e.fix) && e.fix.length).toBeTruthy();
      expect(typeof e.docs).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run server/__tests__/error-kb.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `error-kb.js`** with seed entries for `git-lfs-missing` (codes: GIT_LFS_MISSING), `lfs-migrate-failed` (codes: LFS_MIGRATE_FAILED; matchers: /unknown unit/i, /lfs migrate/i, /above=<n>/i), `oversized-files` (codes: OVERSIZED_FILES; matchers: /exceed.*100 ?MB/i). Each with title/cause/fix steps/docs link. `findErrorKbEntry` matches by code first (exact, case-insensitive), then by any matcher against `message`; returns first match or null. Pure, no I/O.

- [ ] **Step 4: Run test to verify it passes** — expect PASS.

- [ ] **Step 5: Commit** — `git add server/lib/ai-features/error-kb.js server/__tests__/error-kb.test.js && git commit -m "feat(ai): add authored error knowledge base + deterministic lookup"`

---

### Task 2: Inject grounded "Known issue" block into the chat prompt

**Files:**
- Modify: `server/lib/ai-chat-prompt.js` (`buildChatPrompt`)
- Test: `server/__tests__/ai-chat-prompt-grounding.test.js` (create)

**Interfaces:**
- Consumes: `findErrorKbEntry` from Task 1.
- `buildChatPrompt({ message, context, userId })` — when `findErrorKbEntry({ message, code: context?.errorCode })` matches, append a `## Known issue (authored)` block (title, cause, fix steps, docs link) + a response rule: "If a Known issue block is present and matches the user's problem, ground your answer in it and cite the docs link."

- [ ] **Step 1: Write the failing test**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildChatPrompt } from '../lib/ai-chat-prompt.js';

describe('buildChatPrompt error grounding', () => {
  it('injects a Known issue block when the message matches a KB entry', () => {
    const p = buildChatPrompt({ message: 'migration failed: unknown unit: "m"' });
    expect(p).toMatch(/Known issue/i);
    expect(p).toMatch(/git[- ]lfs/i);
  });
  it('injects nothing when no KB entry matches', () => {
    const p = buildChatPrompt({ message: 'how do I change my theme?' });
    expect(p).not.toMatch(/Known issue/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run server/__tests__/ai-chat-prompt-grounding.test.js` → FAIL.

- [ ] **Step 3: Implement** — in `buildChatPrompt`, after building `safeContext`, call `findErrorKbEntry({ message, code: safeContext.errorCode })`; if found, build a `## Known issue (authored)` markdown block and insert it before the Conversation context; add the grounding rule to `RESPONSE_RULES` (or as an appended line). Import `findErrorKbEntry`.

- [ ] **Step 4: Run to verify it passes** — expect PASS. Also rerun `server/__tests__/ai-chat-prompt*.test.js` for no regression.

- [ ] **Step 5: Commit** — `git commit -m "feat(ai): ground chat answers in the error KB with a Known issue block"`

---

## Self-Review

- Spec coverage (Phase 2 "answer-first" / error KB): Tasks 1-2 deliver the curated KB + grounded answers. Context-awareness (Slice 2), tool security (Slice 3), DB/hybrid retrieval (Slice 4) are explicitly deferred with rationale. ✓
- No placeholders: test code + concrete entry list provided. ✓
- Security: Slice 1 injects only authored/trusted content — no new injection surface; guardrails correctly deferred to tool-use slices. ✓
- Type consistency: `findErrorKbEntry({ message, code })` signature reused in Task 2. ✓
