# Spec — Assistant Paste-URL Dialog

**Date:** 2026-04-18
**Author:** Bruno Silva Marques
**Status:** Draft — awaiting implementation plan

---

## 1. Problem

When migrating a repository, the user must:

1. Open the Migration Wizard.
2. Choose the source type (Azure / GitHub / URL).
3. Navigate to the source step.
4. Paste a repository URL.
5. Click **Preencher** to populate the parsed `org` / `project` / `repo` fields.
6. Continue through Connect → Repos → Configure.

For a user who already has the URL on the clipboard, this is six clicks before any migration-relevant decision. The goal of this spec is to let the user paste the URL directly into the **AI Assistant chat** and have the assistant complete steps 1–5 automatically, plus gather the missing target information (GitHub destination org, optional repo rename) so the wizard opens on the **Configure** step.

The behaviour must mimic the existing **Preencher** button (same parser, same populated fields) while adding a short conversational dialog for the handful of pieces of information the URL alone does not carry.

## 2. Scope

### In scope

- Detect **Azure DevOps cloud URLs** (`dev.azure.com`, `visualstudio.com`, SSH, shorthand) using the existing `parseAzureUrl`.
- Detect **GitHub URLs** (`github.com/{owner}/{repo}` in HTTPS, SSH, and `.git` clone forms) via a new `parseGitHubUrl`.
- Guided dialog (client-side, templated) that asks only for fields still missing after parsing — at most **2 questions**: target GitHub org, optional repo rename.
- Final "Abrir wizard" action button that opens the Migration Wizard with `source` and `target` pre-filled, landing on the `repoConfig` step (or the earliest step whose inputs are not yet filled).
- Cancel / reset flow inside the chat.

### Out of scope (explicit)

- **Azure DevOps Server (on-premises)** — tracked as a separate sub-project. The parser will continue to return the existing "not supported" message for on-prem URLs.
- **GitLab, Bitbucket, or generic Git URLs** — the existing "use Git URL option" fallback message stands.
- **LLM-generated questions** — templated questions driven by missing fields cover the 2-question case with no latency or hallucination risk.
- **Persistence of the dialog across sessions** — state is local to the `AIAssistant` component and cleared on close.
- **Multiple URLs in one message** — only the first match is processed; subsequent URLs start a new dialog.
- **GitHub org existence validation inside the chat** — delegated to the wizard's existing validation step.
- **Context-aware suggestions** (e.g. "this repo is >10 GB, use LFS?") — deferred.

## 3. User flow

```text
1. User pastes  "https://dev.azure.com/bruno/AWIP/_git/Cacadores"  into the chat.
2. Chat intercepts input before sending to the AI backend.
3. Chat renders a PasteDialogCard:
     - preview:  Azure DevOps → bruno → AWIP → Cacadores
     - question: "Qual a GitHub org de destino?"
4. User answers "bolalabs".
5. Chat renders updated card:
     - confirmed:  Azure bruno/AWIP/Cacadores  |  Target org bolalabs
     - question:   "Nome final do repo? (escreve 'manter' para usar 'Cacadores')"
6. User answers "manter".
7. Chat renders final card:
     - summary of everything collected
     - [Abrir wizard com isto preenchido]   [Cancelar]
8. User clicks the primary button.
9. Migration Wizard opens on the  repoConfig  step with:
     - source.sourceType = 'azure'
     - source.org / project / repo pre-filled
     - target.targetOrg = 'bolalabs'
     - target.targetName = 'Cacadores'
10. PasteDialogCard is dismissed. Chat returns to normal.
```

The dialog is **dynamic** — if the pasted URL already includes every required field (rare, but possible for shorthand `bruno/AWIP/Cacadores` + default target known), the first render is the final summary. If only `org` is parsed (URL landed in a _boards page, for example), the dialog asks enough to reach the `azureConnect` step instead.

## 4. Architecture

### 4.1 Client-only

All new logic lives in the browser. The `/api/ai/chat` endpoint is unchanged. This keeps the feature:

- **Deterministic** — parsing is a pure function.
- **Fast** — no network round-trip for the dialog.
- **Cheap** — no LLM tokens consumed.
- **Reliable** — no dependency on AI configuration.

Free-form chat (non-URL messages) continues to flow through `/api/ai/chat` as today.

### 4.2 Module layout

**New files:**

| File | Purpose |
|---|---|
| `src/utils/githubUrlParser.js` | Parse GitHub URL variants → `{ owner, repo, error }` |
| `src/utils/repoUrlDetector.js` | Dispatcher: try Azure → GitHub → return `{ sourceType, parsed, error }` |
| `src/components/AIAssistant/PasteDialogCard.jsx` | In-chat card component for preview + question + final action |
| `tests/utils/githubUrlParser.test.js` | Unit tests for GitHub parser |
| `tests/utils/repoUrlDetector.test.js` | Unit tests for dispatcher |
| `tests/components/AIAssistant/PasteDialogCard.test.jsx` | Component tests |
| `e2e/assistant-paste-url.spec.js` | End-to-end happy path |

**Modified files:**

| File | Change |
|---|---|
| `src/components/AIAssistant.jsx` | Intercept URL before `askAI`; manage `pasteDialog` state; render `PasteDialogCard` when active |
| `src/hooks/useMigrationWizard.js` | Accept `{ initialSource, initialTarget, initialStep }` and seed `source` / `target` / `currentStep` |
| `src/components/MigrationWizard/MigrationWizard.jsx` | Read `initialSource` / `initialTarget` / `initialStep` props, pass to `useMigrationWizard` |
| `src/App.jsx` | Extend the existing `getModalData('showMigrationWizard')` consumption to forward `initialSource`, `initialTarget`, `initialStep` |

### 4.3 State machine inside `AIAssistant`

```text
           ┌─────────────────┐
  idle ───►│  URL detected?  │
           └───────┬─────────┘
                   │ yes
                   ▼
           ┌─────────────────┐
           │  collecting     │◄──── new user answer
           │  next question? │─ yes ──► render question, stay
           └───────┬─────────┘
                   │ no (all fields filled)
                   ▼
           ┌─────────────────┐
           │  ready          │──── user clicks "Abrir wizard"
           └───────┬─────────┘             │
                   │ user clicks Cancel     ▼
                   │                     dispatch → wizard opens
                   │                     clear dialog → idle
                   ▼
                 idle
```

State shape:

```js
pasteDialog = {
  status: 'collecting' | 'ready',
  sourceType: 'azure' | 'github',
  parsed: { org, project, repo },           // or { owner, repo } for GitHub
  answers: { targetOrg?: string, targetName?: string },
  nextField: 'targetOrg' | 'targetName' | null,
}
```

### 4.4 Data flow

1. `AIAssistant.handleSubmit(input)` runs `detectRepoUrl(input)` **before** `askAI`.
2. If `detectRepoUrl` returns a valid parse, enter `pasteDialog` state, **do not** send the message to `/api/ai/chat`.
3. `PasteDialogCard` reads `pasteDialog` and displays the right view. Each answer updates `answers` and recomputes `nextField`.
4. When `nextField === null`, status transitions to `ready` and the primary button is rendered.
5. Button click: build `initialSource` + `initialTarget` + `initialStep`, call `openModalWithData('showMigrationWizard', …)`, clear `pasteDialog`.
6. `MigrationWizard` reads the data on mount via `getModalData('showMigrationWizard')` and passes it to `useMigrationWizard`.

### 4.5 Initial step resolver

```text
source filled + target filled  → repoConfig (Azure also auto-selects the
                                 single parsed repo so selectedRepos is non-empty)
source filled + target missing → targetConfig  (URL/GitHub flows)
                                  repoSelect    (Azure flow)
source partially filled        → azureConnect / githubSource
nothing filled                 → sourceType
```

The resolver lives in `useMigrationWizard` alongside `getStepsForSourceType`.

**Azure single-repo auto-select**: when the pasted URL resolves to an exact `org/project/repo` triple, the wizard must seed `repos` with that one repo (selected) so the `repoConfig` step can render. If the URL only resolves to `org/project`, we land on `repoSelect` and the user picks repos as normal — no auto-select is attempted because the repo list comes from the Azure API and hasn't been fetched yet.

## 5. Error handling

| Case | Behaviour |
|---|---|
| Non-repo URL (GitLab, Bitbucket, random site) | Fall through to `askAI` — pasted text is sent to the LLM as a normal message |
| Azure URL without project (`/bruno/_boards`) | Dialog asks extra question: "Project a migrar?" or offers "Abrir wizard só com a organização" |
| On-prem Azure URL | Card shows the existing not-supported message; no dialog started |
| User answers with empty string | Treat as skip: if field is optional, proceed; if required, repeat question with hint |
| User pastes second URL during dialog | Replace current dialog with new parse; show inline hint "A começar com este novo URL" |
| Target org fails regex validation | Stay in `collecting`, show hint with allowed pattern, repeat question |
| AI service unrelated to this flow, but chat below | Unaffected — paste dialog bypasses AI entirely |
| Wizard modal already open when user clicks "Abrir" | `openModalWithData` replaces the data payload; wizard reacts via `useEffect` on the payload |

## 6. Testing

### Unit

- `githubUrlParser.test.js` — HTTPS, SSH, `.git`, branch paths, invalid inputs, trailing slashes, case sensitivity on host
- `repoUrlDetector.test.js` — Azure wins when ambiguous, GitHub fallback, non-repo returns null, propagation of parser errors
- `PasteDialogCard.test.jsx` — Renders correct question per missing field, submits answer, shows final button when ready, cancel clears state, invalid answer re-renders question
- `AIAssistant.test.jsx` — Intercepts URL input, skips `askAI` when URL detected, resumes normal flow when dialog cancelled or completed

### Integration (Vitest + supertest)

Not needed — no backend change. Existing `ai-chat` tests cover the unchanged endpoint.

### E2E (Playwright)

- `assistant-paste-url.spec.js`
  - Given the chat is open, when the user pastes an Azure DevOps URL and answers both questions, then the Migration Wizard opens on the `repoConfig` step with `source` and `target` pre-filled.
  - Given an invalid URL, the chat falls back to normal AI behaviour.
  - Given the user cancels, the dialog clears and the input is ready for a new message.

## 7. YAGNI / deferred

- **LLM-generated questions** — templates are enough for 2 fields. If we later expand to 5+ fields, revisit.
- **On-prem Azure DevOps** — separate sub-project; reuses this dialog mechanism as an extension.
- **Context-aware risk suggestions** (size, branches, LFS) — deferred; the existing Fix Issues drawer handles this post-selection.
- **Cross-session dialog persistence** — not required; the assistant is a transient helper.
- **Voice / multi-modal input** — deferred.

## 8. Success criteria

1. Pasting a valid Azure DevOps URL opens the wizard on `repoConfig` with correct `source` + `target` pre-filled after at most 2 chat answers.
2. Pasting a valid GitHub URL opens the wizard via the `github` source type with equivalent pre-fill.
3. Pasting an invalid or unsupported URL falls back to the existing AI chat without breaking the conversation.
4. All new unit tests pass; the existing suite stays green (341 backend + 550 frontend baseline).
5. No server-side changes are required; the feature is shippable as a frontend-only PR.
