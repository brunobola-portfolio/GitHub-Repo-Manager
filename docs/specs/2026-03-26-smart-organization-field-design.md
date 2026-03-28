# Smart Organization Field — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Scope:** Migration Wizard Step 2 (Connect to Azure DevOps)

## Summary

Replace the manual text input for Azure DevOps Organization with an adaptive "Smart Field" that changes behavior based on the active authentication method:

- **OAuth** → Searchable dropdown populated via Azure DevOps API with org list
- **PAT (Personal/Server)** → Text input with real-time auto-validation + status badges

Includes contextual upgrade hints, graceful auth transitions, enriched project dropdown, and comprehensive edge case handling.

---

## 1. Smart Organization Field

### Anatomy

The Organization field becomes a polymorphic component with 3 zones:

```
┌─────────────────────────────────────────────────────────────┐
│  ☁  [Main field area]                   [Status badges] [▾] │
└─────────────────────────────────────────────────────────────┘
```

### Mode: OAuth (Searchable Dropdown)

When OAuth is the active credential, the field renders as a searchable dropdown:

- **Data source**: `GET /api/azure/organizations` (new endpoint, fetched automatically when OAuth status becomes `success`)
- **Items show**: Org name + project count badge
- **Search**: Client-side, case-insensitive, partial match
- **Keyboard**: ArrowUp/Down, Enter, Escape, type-to-filter
- **Fallback option**: "Digitar manualmente..." at bottom for orgs not listed (e.g., service accounts)
- **Loading state**: 3 skeleton items with shimmer animation
- **Error state**: Inline message + retry button inside dropdown
- **Empty state**: "Nenhuma organização encontrada para esta conta"

```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Filtrar organizações...                                 │
├─────────────────────────────────────────────────────────────┤
│  ☁ brunobola                                   12 proj   ✓ │
│  ☁ contoso-dev                                  4 proj     │
│  ☁ medicare-org                                 ░░         │
├─────────────────────────────────────────────────────────────┤
│  Ou digitar manualmente...                          ⌨       │
└─────────────────────────────────────────────────────────────┘
```

**Recents section** (sessionStorage, top 3):

```
├─────────────────────────────────────────────────────────────┤
│  Recentes                                                   │
│  ☁ brunobola                                   12 proj     │
├─────────────────────────────────────────────────────────────┤
│  Todas                                                      │
│  ...                                                        │
```

### Mode: PAT (Text Input with Auto-Validation)

When PAT (personal or server) is active:

- **Input**: Free-text, sanitized to `[a-zA-Z0-9-]`
- **Validation**: Debounced (400ms for personal PAT, immediate for server PAT)
- **API call**: `POST /api/azure/validate` → then `POST /api/azure/projects`

### Status Badges (Inline, Right-Aligned)

| State | Visual | Color |
|-------|--------|-------|
| Validating | `◌ A validar...` | slate-400 |
| Connected | `● Conectada · N proj` | emerald-400 |
| Not found | `● Org não encontrada` | red-400 |
| No permissions | `● Sem acesso a esta org` | amber-400 |
| Network error | `● Erro de ligação` + retry | red-400 |
| Zero orgs (OAuth) | `● Nenhuma org encontrada` | amber-400 |

Badges appear with fade-in (200ms). Color dot pulses once on state change (scale 1→1.3→1, 300ms). Text crossfades between states.

### Project Count in Dropdown

- Fetched lazily (only when dropdown opens) via parallel `POST /api/azure/projects` per org (max 5 concurrent)
- Skeleton `░░` with shimmer while loading
- `—` if fetch fails (does not block other orgs)
- Cached in memory for session duration

---

## 2. Auth Transition Behavior

### State Preservation Rules

| Transition | Org | Project | Validation |
|-----------|-----|---------|-----------|
| PAT → OAuth | Preserved (pre-selected in dropdown) | Preserved if org matches | Re-validates |
| OAuth → PAT | Preserved (fills input) | Preserved if validation passes | Re-validates |
| PAT → Server PAT | Preserved | Preserved if validation passes | Re-validates |
| Any → Invalid credential | Text preserved | **Cleared** | Fails gracefully |

### Animation

- Field morphs between input and dropdown using `AnimatePresence` + `motion.div` with `key={isDropdownMode}`
- Fade-out (150ms) → Fade-in (150ms), total 300ms, ease-out
- Height remains constant — no layout shift
- Abort in-flight requests via `AbortController` when auth changes

### OAuth Upgrade Hint

Shown **only when**:
1. Auth mode is PAT (personal or server)
2. OAuth is configured on the server (env vars present)
3. User has not dismissed the hint this session

```
┌───────────────────────────────────────────────────────────┐
│  ℹ  OAuth permite listar todas as suas         [Trocar →]│
│     organizações automaticamente           [✕ Descartar] │
└───────────────────────────────────────────────────────────┘
```

- Background: `bg-indigo-500/10` + `border-indigo-500/20`
- Appears 500ms after PAT validation (slide-down + fade-in, 250ms)
- "Trocar" initiates OAuth flow
- "✕" dismisses for session (fade-out + slide-up, 200ms)

### PAT Failure → Contextual Actions

When PAT lacks access to the typed org:

- Field border changes to amber-400 (not red — not a user error)
- Error expands below with slide-down (200ms)
- Two action buttons:
  - **"Criar PAT para esta org"** → Opens `dev.azure.com/{org}/_usersSettings/tokens` in new tab (always shown)
  - **"Trocar p/ OAuth"** → Initiates auth switch (only if OAuth configured)
- Double-click protection: debounce on "Trocar" button

---

## 3. API Changes

### New Endpoint: List Organizations

```
GET /api/azure/organizations
  Auth: Session cookie (OAuth token)

  Flow:
  1. GET https://app.vssps.visualstudio.com/_apis/profile/profiles/me
     → Extract publicAlias (memberId)
  2. GET https://app.vssps.visualstudio.com/_apis/accounts?memberId={id}
     → List of organizations

  Response 200:
  {
    organizations: [
      { accountId: "...", accountName: "brunobola", accountUri: "..." },
      ...
    ]
  }

  Response 401: { error: "Token expirado ou inválido" }
  Response 500: { error: "Erro ao listar organizações" }
```

- Rate limited: max 10 requests/minute
- Uses only session token (never accepts token in body)

### State Changes

New fields added to `INITIAL_SOURCE`:

```javascript
{
  organizations: [],        // Org list (OAuth)
  orgsLoading: false,       // Loading state
  orgsError: null,          // Fetch error
  orgProjectCounts: {},     // { orgName: number | null }
  oauthHintDismissed: false // Upgrade hint dismissed
}
```

---

## 4. Enriched Project Dropdown

Replace native `<select>` with custom `Select.jsx` component:

```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Filtrar projectos...                                    │
├─────────────────────────────────────────────────────────────┤
│  📁 Web Service - Medicare                     Git · 14 repos│
│  📁 Mobile App                                 Git · 3 repos │
│  📁 Legacy Backend                            TFVC · 1 repo  │
│  📁 Archived Project                    ⚠ Inactivo · 0 repos │
├─────────────────────────────────────────────────────────────┤
│  3 projectos activos · 1 inactivo                           │
└─────────────────────────────────────────────────────────────┘
```

- Shows: version control type (Git/TFVC) + repo count per project
- Inactive projects: muted styling + `⚠ Inactivo` badge
- Searchable for orgs with many projects
- Footer with summary count
- Repo count fetched lazily per project when dropdown opens

---

## 5. Connection Summary Badge

After org + project + validation complete, show confirmation badge at top of step:

```
┌─────────────────────────────────────────────────────────────┐
│  ✓ brunobola / Web Service - Medicare    🔑 Server PAT      │
└─────────────────────────────────────────────────────────────┘
```

- Appears only when all three are valid
- Disappears if any field changes (returns after re-validation)
- Shows auth method icon + label

---

## 6. URL Paste Enhancement

Improve the existing smart URL paste with explicit confirmation:

```
  URL detectada:
  ☁ brunobola  →  📁 Web Service - Medicare  →  📦 api-service
  [Preencher automaticamente]    [Descartar]
```

- Show mini-preview of parsed segments before auto-filling
- Explicit button instead of silent auto-fill — gives user control
- Parsed repo saved to `urlParsedRepo` for pre-selection in Step 3 (existing behavior)

---

## 7. Edge Cases

| Scenario | Detection | Behavior | UI |
|----------|-----------|----------|-----|
| OAuth token expired during org listing | 401 from API | Auto-retry OAuth flow (1x) | Spinner + "A renovar autenticação..." |
| OAuth token expired on retry | 401 after retry | Stop, request re-auth | "Sessão expirada" + button |
| Zero orgs in OAuth account | Empty array | Show empty state in dropdown | "Nenhuma org encontrada..." |
| Org listed but no project permission | 403 on project fetch | Badge shows `Sem acesso` | Item with `⚠ Sem acesso` in amber |
| PAT with invalid format | Client-side validation | No request sent | "Formato de token inválido" |
| Org with spaces/special chars | Client-side sanitization | Strip spaces, reject invalid chars | Input blocks invalid chars `[a-zA-Z0-9-]` |
| Org renamed between fetches | 404 on project fetch | Remove from list, show warning | Toast: "Organização já não está disponível" |
| Network timeout on org fetch | 10s timeout | Auto-retry 1x, then manual | "Erro de ligação" + retry button |
| Partial project count failure | Some orgs 200, others error | Show counts where available | Mix of numbers and `—` |
| URL pasted while dropdown open | Paste event detected | Close dropdown, parse, fill org | Smooth transition to validated state |
| Auth change with validation in-flight | AbortController flag | Cancel previous request | Spinner stops, new validation starts |
| Both Server PAT and OAuth configured | Read env vars | Both available as options | Two selectable credential cards |
| OAuth app without AD consent | OAuth flow error | Specific message | "A aplicação precisa de consentimento do admin" |
| More than 100 orgs | API response size | Fetch all (API doesn't paginate accounts) | Search filter becomes essential |
| Dropdown open + click outside | onClickOutside handler | Close dropdown, keep selection | Normal close animation |
| Double-click on "Trocar p/ OAuth" | Debounce on handler | Ignore second click | Button disabled during transition |

### PAT Resolution Priority

```
1. Personal PAT (explicit from user) — highest priority
2. OAuth token (active session)
3. Server PAT (env var)

The credential selected in the UI is always the one used.
Priority above applies only for auto-detection of initial card selection.
```

---

## 8. Accessibility

- Org dropdown: `role="listbox"`, items with `role="option"`
- Status badge: `aria-live="polite"` to announce state changes
- Upgrade hint: `role="status"`, dismiss button with `aria-label="Descartar sugestão"`
- Error states: `aria-live="assertive"`, `aria-describedby` linking field to error
- "Type manually" option: `aria-label="Introduzir organização manualmente"`
- Skeleton loading: `aria-busy="true"` on dropdown while loading

---

## 9. Security

- PATs never logged on server (even in debug mode)
- OAuth tokens kept only in `req.session` (httpOnly, sameSite, secure in prod)
- Org fetch uses only session token, never accepts token in request body
- Org input sanitized server-side before URL interpolation
- Rate limiting: max 10 req/min for `/api/azure/organizations`

---

## 10. Out of Scope (YAGNI)

- ❌ Favorite organizations — wizard is used sporadically
- ❌ Persistent org cache between sessions — tokens expire, data goes stale
- ❌ Multi-select orgs — wizard is single-org by design
- ❌ Repo preview in project dropdown — Step 3 exists for that

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/MigrationWizard/steps/SourceStep.jsx` | Smart Field, badges, hints, enriched project dropdown |
| `src/hooks/useMigrationWizard.js` | New state fields, validation updates |
| `src/hooks/useAzureOAuth.js` | Org fetch integration after OAuth success |
| `server/routes/azure.js` | New `/api/azure/organizations` endpoint |
| `server/azure-service.js` | `listOrganizations()` function |
| `src/components/ui/Select.jsx` | Possible extensions (sections, badges, footer) |

## New Files

| File | Purpose |
|------|---------|
| `src/hooks/useAzureOrganizations.js` | Hook for fetching/caching org list + project counts |
