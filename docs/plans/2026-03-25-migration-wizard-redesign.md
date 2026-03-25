# Migration Wizard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Azure DevOps Migration Wizard with smart URL paste, a tri-option credential panel (Server PAT / Personal PAT / OAuth), automatic validation, and a visual refresh across all wizard steps.

**Architecture:** Server-first foundation (resolvePat + OAuth routes), then new `useAzureOAuth` hook, then full `SourceStep` rewrite, then MigrationWizard visual shell, then downstream step fixes, then visual cleanup.

**Tech Stack:** React 19, Framer Motion, Tailwind CSS v4, Express, express-session, Lucide icons, Vite.

**Spec:** `docs/superpowers/specs/2026-03-25-migration-wizard-redesign.md`

---

## Parallelism Map

Tasks 1, 2, 3 are fully independent — run in parallel.
Tasks 4, 5, 6, 7, 8 depend on tasks 1+2+3 completing first, but are independent of each other.

---

## Task 1: Wizard State — Add new INITIAL_SOURCE fields

**Files:**
- Modify: `src/hooks/useMigrationWizard.js`

- [ ] **Step 1.1: Read the file**

  Read `src/hooks/useMigrationWizard.js`. Confirm `INITIAL_SOURCE` exists (lines ~30–56).

- [ ] **Step 1.2: Add three new fields to INITIAL_SOURCE**

  In `INITIAL_SOURCE`, add after `envAuthAvailable: null,`:

  ```js
  // URL paste fields
  urlParsedRepo: '',        // repo name extracted from URL paste
  urlParsedProject: '',     // project name extracted from URL paste (pre-selects dropdown)
  // Credential mode
  credentialMode: '',       // 'serverPat' | 'personalPat' | 'oauth' | ''
  ```

- [ ] **Step 1.3: Commit**

  ```bash
  git add src/hooks/useMigrationWizard.js
  git commit -m "feat(wizard): add urlParsedRepo, urlParsedProject, credentialMode to INITIAL_SOURCE"
  ```

---

## Task 2: Server Foundation — resolvePat + OAuth routes

**Files:**
- Modify: `server/azure-service.js`
- Modify: `server/routes/azure.js`

### 2a — Update `resolvePat` to support session token

- [ ] **Step 2a.1: Read azure-service.js lines 1–20**

  Confirm `resolvePat(pat)` signature at line ~15.

- [ ] **Step 2a.2: Update resolvePat signature**

  Change:

  ```js
  function resolvePat(pat) {
      return pat || process.env.AZURE_PAT || null;
  }
  ```

  To:

  ```js
  function resolvePat(pat, session) {
      return pat || process.env.AZURE_PAT || session?.azureToken || null;
  }
  ```

### 2b — Update all 10 POST route handlers to pass req.session

- [ ] **Step 2b.1: Read server/routes/azure.js**

  Confirm all 10 POST routes call `azureService.resolvePat(bodyPat)` or `azureService.resolvePat(bodyPat)`.

- [ ] **Step 2b.2: Update all 10 POST handlers**

  In every POST route handler (`/azure/validate`, `/azure/projects`, `/azure/repos`, `/azure/wikis`, `/azure/work-items/counts`, `/azure/work-items/preview`, `/azure/project-info`, `/azure/branches`, `/azure/pat-permissions`, `/azure/tfvc/items`), change:

  ```js
  const pat = azureService.resolvePat(bodyPat);
  ```

  To:

  ```js
  const pat = azureService.resolvePat(bodyPat, req.session);
  ```

### 2c — Add 4 new OAuth routes

- [ ] **Step 2c.1: Check if oauth library is available**

  Run: `grep -r "msal\|passport\|azure-ad\|@azure/msal" package.json`

  If not present, the OAuth routes will use the raw Azure AD authorization code flow via redirect URLs (no library needed — just URL construction with env vars).

- [ ] **Step 2c.2: Add OAuth routes at the end of server/routes/azure.js, before `export default router`**

  ```js
  // GET /api/azure/oauth-status
  router.get('/azure/oauth-status', requireAuth, (req, res) => {
      const configured = !!(
          process.env.AZURE_CLIENT_ID &&
          process.env.AZURE_CLIENT_SECRET &&
          process.env.AZURE_TENANT_ID
      );
      res.json({ configured });
  });

  // GET /api/azure/oauth/start — redirect to Azure AD
  router.get('/azure/oauth/start', requireAuth, (req, res) => {
      const { AZURE_CLIENT_ID, AZURE_TENANT_ID } = process.env;
      if (!AZURE_CLIENT_ID || !AZURE_TENANT_ID) {
          return res.status(503).json({ error: 'OAuth not configured' });
      }
      const redirectUri = encodeURIComponent(`${req.protocol}://${req.get('host')}/api/azure/oauth/callback`);
      const scope = encodeURIComponent('https://app.vssps.visualstudio.com/.default offline_access');
      const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64');
      req.session.oauthState = state;
      const authUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize` +
          `?client_id=${AZURE_CLIENT_ID}` +
          `&response_type=code` +
          `&redirect_uri=${redirectUri}` +
          `&scope=${scope}` +
          `&state=${state}`;
      res.redirect(authUrl);
  });

  // GET /api/azure/oauth/callback — exchange code for token
  router.get('/azure/oauth/callback', requireAuth, async (req, res) => {
      const { code, state } = req.query;
      const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID } = process.env;

      if (!code) {
          return res.status(400).send('<html><body><p>OAuth error: no code received.</p></body></html>');
      }

      try {
          const redirectUri = `${req.protocol}://${req.get('host')}/api/azure/oauth/callback`;
          const body = new URLSearchParams({
              client_id: AZURE_CLIENT_ID,
              client_secret: AZURE_CLIENT_SECRET,
              code,
              redirect_uri: redirectUri,
              grant_type: 'authorization_code',
              scope: 'https://app.vssps.visualstudio.com/.default offline_access',
          });
          const tokenRes = await fetch(
              `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
              { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
          );
          const tokenData = await tokenRes.json();
          if (tokenData.access_token) {
              req.session.azureToken = tokenData.access_token;
              req.session.azureTokenReady = true;
          }
      } catch {
          // Token exchange failed — azureTokenReady stays falsy
      }

      res.send(`<!DOCTYPE html>
  <html><head><title>Authentication Complete</title></head>
  <body style="font-family:sans-serif;text-align:center;padding:40px">
    <h2>Authentication complete</h2>
    <p>You can close this tab.</p>
    <script>window.close();</script>
  </body></html>`);
  });

  // GET /api/azure/oauth/token — polling endpoint (never sends token to client)
  router.get('/azure/oauth/token', requireAuth, (req, res) => {
      res.json({ ready: !!req.session.azureTokenReady });
  });
  ```

- [ ] **Step 2c.3: Commit**

  ```bash
  git add server/azure-service.js server/routes/azure.js
  git commit -m "feat(server): add OAuth routes and extend resolvePat to support session token"
  ```

---

## Task 3: New Hook — useAzureOAuth

**Files:**
- Create: `src/hooks/useAzureOAuth.js`

- [ ] **Step 3.1: Create the hook**

  ```js
  // src/hooks/useAzureOAuth.js
  import { useState, useRef, useCallback } from 'react'

  const POLL_INTERVAL_MS = 1000
  const POLL_TIMEOUT_MS = 120_000

  /**
   * Manages Azure AD OAuth flow from the client side.
   * The token never leaves the server — this hook only polls for readiness.
   *
   * Instantiate in MigrationWizard.jsx and pass as `oauthHook` prop to SourceStep.
   *
   * oauthStatus: 'idle' | 'pending' | 'success' | 'error' | 'timeout'
   */
  export function useAzureOAuth() {
    const [oauthStatus, setOauthStatus] = useState('idle')
    const intervalRef = useRef(null)
    const timeoutRef = useRef(null)

    const stopPolling = useCallback(() => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    }, [])

    const startPolling = useCallback(() => {
      stopPolling()
      intervalRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/azure/oauth/token', { credentials: 'include' })
          const data = await res.json()
          if (data.ready) {
            stopPolling()
            setOauthStatus('success')
          }
        } catch {
          stopPolling()
          setOauthStatus('error')
        }
      }, POLL_INTERVAL_MS)

      timeoutRef.current = setTimeout(() => {
        stopPolling()
        setOauthStatus((prev) => prev === 'pending' ? 'timeout' : prev)
      }, POLL_TIMEOUT_MS)
    }, [stopPolling])

    const startOAuth = useCallback(() => {
      setOauthStatus('pending')
      window.open('/api/azure/oauth/start', '_blank')
      startPolling()
    }, [startPolling])

    const retryOAuth = useCallback(() => {
      stopPolling()
      setOauthStatus('idle')
    }, [stopPolling])

    const pausePolling = useCallback(() => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      // Note: timeout is NOT cleared — it continues so overall cap is respected
    }, [])

    const resumePolling = useCallback(() => {
      // Only resume if currently pending (not success/error/timeout)
      setOauthStatus((prev) => {
        if (prev === 'pending') {
          if (!intervalRef.current) {
            intervalRef.current = setInterval(async () => {
              try {
                const res = await fetch('/api/azure/oauth/token', { credentials: 'include' })
                const data = await res.json()
                if (data.ready) {
                  stopPolling()
                  setOauthStatus('success')
                }
              } catch {
                stopPolling()
                setOauthStatus('error')
              }
            }, POLL_INTERVAL_MS)
          }
        }
        return prev
      })
    }, [stopPolling])

    return { oauthStatus, startOAuth, retryOAuth, pausePolling, resumePolling }
  }
  ```

- [ ] **Step 3.2: Commit**

  ```bash
  git add src/hooks/useAzureOAuth.js
  git commit -m "feat(wizard): add useAzureOAuth hook with state machine and polling"
  ```

---

## Task 4: SourceStep — Full Rewrite

**Files:**
- Modify: `src/components/MigrationWizard/steps/SourceStep.jsx`

**Depends on:** Tasks 1 (wizard state fields), 2 (server), 3 (hook).

- [ ] **Step 4.1: Read existing SourceStep.jsx in full**

  Read `src/components/MigrationWizard/steps/SourceStep.jsx` to understand all local state and existing behaviour.

- [ ] **Step 4.2: Write the new SourceStep.jsx**

  The new file has 5 sections: smart URL paste, credential cards (Server PAT / Personal PAT / OAuth), auto-validate effect, project dropdown, and (removed) validate button.

  ```jsx
  import { useState, useEffect, useRef, useCallback } from 'react'
  import {
    Cloud, KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
    ExternalLink, ChevronDown, Link2, Server, Globe, ShieldCheck,
  } from 'lucide-react'
  import { parseAzureUrl } from '../../../utils/azureUrlParser'

  const DEBOUNCE_MS = 400

  export default function SourceStep({ source, onChange, oauthHook }) {
    // ── local UI state ─────────────────────────────────────────────────────
    const [envAuthAvailable, setEnvAuthAvailable] = useState(null)
    const [oauthConfigured, setOauthConfigured] = useState(null)
    const [credLoading, setCredLoading] = useState(true)
    const [showPat, setShowPat] = useState(false)
    const [projects, setProjects] = useState([])
    const [validating, setValidating] = useState(false)
    const [validationError, setValidationError] = useState('')
    const debounceRef = useRef(null)

    // ── initialise credential panel ────────────────────────────────────────
    useEffect(() => {
      Promise.all([
        fetch('/api/azure/env-auth', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/azure/oauth-status', { credentials: 'include' }).then((r) => r.json()),
      ])
        .then(([envAuth, oauthStatus]) => {
          setEnvAuthAvailable(envAuth.available)
          setOauthConfigured(oauthStatus.configured)
          if (!source.credentialMode) {
            onChange({ credentialMode: envAuth.available ? 'serverPat' : 'personalPat' })
          }
        })
        .catch(() => {
          setEnvAuthAvailable(false)
          setOauthConfigured(false)
          if (!source.credentialMode) onChange({ credentialMode: 'personalPat' })
        })
        .finally(() => setCredLoading(false))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── smart URL paste ────────────────────────────────────────────────────
    const handleUrlPaste = (e) => {
      const raw = e.target.value
      const parsed = parseAzureUrl(raw)
      const updates = {}
      if (parsed.org) updates.org = parsed.org
      if (parsed.project) updates.urlParsedProject = parsed.project
      if (parsed.repo) updates.urlParsedRepo = parsed.repo
      if (Object.keys(updates).length) {
        onChange({ ...updates, validated: false })
        setProjects([])
        setValidationError('')
      }
    }

    // ── credential mode switch ─────────────────────────────────────────────
    const handleModeSwitch = (newMode) => {
      if (newMode === source.credentialMode) return
      if (source.credentialMode === 'oauth' && newMode !== 'oauth') {
        oauthHook.pausePolling()
      }
      if (newMode === 'oauth' && source.credentialMode !== 'oauth') {
        if (oauthHook.oauthStatus === 'pending') oauthHook.resumePolling()
      }
      onChange({ credentialMode: newMode, validated: false })
      setProjects([])
      setValidationError('')
    }

    // ── auto-validate ──────────────────────────────────────────────────────
    const credentialReady = (
      (source.credentialMode === 'serverPat' && envAuthAvailable) ||
      (source.credentialMode === 'personalPat' && source.pat?.trim()) ||
      (source.credentialMode === 'oauth' && oauthHook.oauthStatus === 'success')
    )

    const runValidation = useCallback(async () => {
      if (!source.org?.trim() || !credentialReady) return
      setValidating(true)
      setValidationError('')
      try {
        const body = {
          org: source.org,
          pat: source.credentialMode === 'personalPat' ? source.pat : undefined,
        }
        const [validateRes, projectsRes] = await Promise.all([
          fetch('/api/azure/validate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
          fetch('/api/azure/projects', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        ])
        const validateData = await validateRes.json()
        if (!validateData.valid) {
          onChange({ validated: false })
          setValidationError(validateData.error || 'Invalid credentials')
          return
        }
        onChange({ validated: true })
        const projectsData = await projectsRes.json()
        const list = projectsData.projects || []
        setProjects(list)
        // auto-select project from URL paste
        const match = source.urlParsedProject && list.find((p) => p.name === source.urlParsedProject)
        if (match) onChange({ project: match.name })
      } catch (e) {
        onChange({ validated: false })
        setValidationError(e.message || 'Connection error')
      } finally {
        setValidating(false)
      }
    }, [source.org, source.pat, source.credentialMode, source.urlParsedProject, credentialReady, onChange])

    // debounced trigger for org / pat changes
    useEffect(() => {
      if (!source.org?.trim() || !credentialReady) return
      if (source.credentialMode === 'serverPat' || oauthHook.oauthStatus === 'success') {
        // immediate — no debounce
        runValidation()
        return
      }
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(runValidation, DEBOUNCE_MS)
      return () => clearTimeout(debounceRef.current)
    }, [source.org, source.pat, source.credentialMode, oauthHook.oauthStatus]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── project dropdown change ────────────────────────────────────────────
    const handleProjectChange = (e) => onChange({ project: e.target.value })

    // ── badge helpers ──────────────────────────────────────────────────────
    function SmartPasteBadges({ parsed }) {
      const parts = []
      if (parsed.org) parts.push(`org: ${parsed.org}`)
      if (parsed.project) parts.push(`project: ${parsed.project}`)
      if (parsed.repo) parts.push(`repo: ${parsed.repo}`)
      if (!parts.length && parsed.error) return <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{parsed.error}</p>
      if (!parts.length) return null
      return (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {parts.map((p) => (
            <span key={p} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
              {p}
            </span>
          ))}
        </div>
      )
    }

    // ── credential card ────────────────────────────────────────────────────
    function CredCard({ mode, icon: Icon, label, subtitle, available, children }) {
      const active = source.credentialMode === mode
      const selectable = available !== false
      return (
        <div
          onClick={() => selectable && handleModeSwitch(mode)}
          className={`rounded-xl border p-4 transition-all
            ${selectable ? 'cursor-pointer' : 'cursor-default opacity-60'}
            ${active && selectable ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}
          `}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
              <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
                {available === true && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">Configured</span>
                )}
                {available === false && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">Not configured</span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
            </div>
            {active && selectable && <CheckCircle2 className="w-4 h-4 text-indigo-500 shrink-0" />}
          </div>
          {(!selectable || (active && children)) && (
            <div className="mt-3">{children}</div>
          )}
        </div>
      )
    }

    // ── smart paste state for badges ───────────────────────────────────────
    const [smartPasteValue, setSmartPasteValue] = useState('')
    const parsedBadge = smartPasteValue ? parseAzureUrl(smartPasteValue) : null

    // ── render ─────────────────────────────────────────────────────────────
    return (
      <div className="space-y-5">

        {/* Smart URL paste */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Paste Azure DevOps URL <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <div className="relative">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={smartPasteValue}
              onChange={(e) => {
                setSmartPasteValue(e.target.value)
                handleUrlPaste(e)
              }}
              placeholder="https://dev.azure.com/org/project or org/project/repo"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
            />
          </div>
          {parsedBadge && <SmartPasteBadges parsed={parsedBadge} />}
        </div>

        {/* Manual Org */}
        <div>
          <label htmlFor="azure-org" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Organization
          </label>
          <div className="relative">
            <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              id="azure-org"
              type="text"
              value={source.org}
              onChange={(e) => {
                onChange({ org: e.target.value, validated: false, project: '' })
                setProjects([])
                setValidationError('')
              }}
              placeholder="my-organization"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
            />
            {validating && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-500 animate-spin" />
            )}
          </div>
        </div>

        {/* Credential Cards */}
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Authentication</p>
          {credLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">

              {/* Card 1 — Server PAT */}
              <CredCard
                mode="serverPat"
                icon={Server}
                label="Server PAT"
                subtitle="Configured in the server .env file — no credentials entered here."
                available={envAuthAvailable}
              >
                {!envAuthAvailable && (
                  <pre className="text-xs bg-slate-800 text-slate-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{`Add to your server .env file:\n  AZURE_PAT=<your-personal-access-token>\nThen restart the server.`}</pre>
                )}
              </CredCard>

              {/* Card 2 — Personal PAT */}
              <CredCard
                mode="personalPat"
                icon={KeyRound}
                label="Personal Access Token"
                subtitle="Paste your own PAT — used only for this session, never persisted."
                available={true}
              >
                {source.credentialMode === 'personalPat' && (
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type={showPat ? 'text' : 'password'}
                        value={source.pat}
                        onChange={(e) => onChange({ pat: e.target.value, validated: false })}
                        placeholder="Paste your Personal Access Token"
                        className="w-full pr-10 pl-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 text-sm transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPat((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        aria-label={showPat ? 'Hide PAT' : 'Show PAT'}
                      >
                        {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Minimum scope: Code (Read). Add Work Items (Read) + Wiki (Read) for full migration.</span>
                      {source.org && (
                        <a
                          href={`https://dev.azure.com/${encodeURIComponent(source.org)}/_usersSettings/tokens`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-500 hover:text-indigo-400 inline-flex items-center gap-1 shrink-0 ml-2"
                        >
                          Create PAT <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </CredCard>

              {/* Card 3 — OAuth */}
              <CredCard
                mode="oauth"
                icon={ShieldCheck}
                label="OAuth / Browser Login"
                subtitle="Authenticate via Azure AD — token stored in server session only."
                available={oauthConfigured}
              >
                {!oauthConfigured ? (
                  <pre className="text-xs bg-slate-800 text-slate-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{`1. Register an app in Azure Portal (Azure Active Directory → App Registrations).\n2. Set Redirect URI to: http://localhost:3001/api/azure/oauth/callback\n3. Add to your server .env file:\n     AZURE_CLIENT_ID=<app-client-id>\n     AZURE_CLIENT_SECRET=<app-client-secret>\n     AZURE_TENANT_ID=<tenant-id>  (or "common" for multi-tenant)\n4. Restart the server.`}</pre>
                ) : source.credentialMode === 'oauth' ? (
                  <div className="space-y-2">
                    {oauthHook.oauthStatus === 'idle' && (
                      <button
                        type="button"
                        onClick={() => {
                          const popup = window.open('/api/azure/oauth/start', '_blank')
                          if (!popup) {
                            setValidationError('Popup blocked — allow popups for this page and try again.')
                            return
                          }
                          oauthHook.startOAuth()
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
                      >
                        <Globe className="w-4 h-4" />
                        Open browser to authenticate
                      </button>
                    )}
                    {oauthHook.oauthStatus === 'pending' && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Waiting for browser authentication...
                      </div>
                    )}
                    {oauthHook.oauthStatus === 'success' && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Authenticated
                      </span>
                    )}
                    {(oauthHook.oauthStatus === 'error' || oauthHook.oauthStatus === 'timeout') && (
                      <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                        <XCircle className="w-4 h-4" />
                        {oauthHook.oauthStatus === 'timeout' ? 'Authentication timed out — ' : 'Authentication error — '}
                        <button type="button" onClick={oauthHook.retryOAuth} className="underline">try again</button>
                      </div>
                    )}
                  </div>
                ) : null}
              </CredCard>

            </div>
          )}
        </div>

        {/* Validation status */}
        {source.validated && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Connected
          </span>
        )}
        {validationError && !validating && (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <XCircle className="w-4 h-4 shrink-0" />
            {validationError}
            <button type="button" onClick={runValidation} className="underline ml-1">Retry</button>
          </div>
        )}

        {/* Project Dropdown */}
        {source.validated && (
          <div>
            <label htmlFor="azure-project" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Project
            </label>
            <div className="relative">
              <select
                id="azure-project"
                value={source.project}
                onChange={handleProjectChange}
                className="w-full appearance-none pl-3 pr-9 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
              >
                <option value="">Select a project...</option>
                {projects.map((p) => (
                  <option key={p.id || p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
        )}

      </div>
    )
  }
  ```

- [ ] **Step 4.3: Commit**

  ```bash
  git add src/components/MigrationWizard/steps/SourceStep.jsx
  git commit -m "feat(wizard): rewrite SourceStep with smart URL paste, credential cards, auto-validate"
  ```

---

## Task 5: MigrationWizard.jsx — Step indicator, STEP_META, oauthHook

**Files:**
- Modify: `src/components/MigrationWizard/MigrationWizard.jsx`

**Depends on:** Task 3 (useAzureOAuth hook).

- [ ] **Step 5.1: Read MigrationWizard.jsx in full**

- [ ] **Step 5.2: Add imports**

  At the top of the file add:

  ```js
  import { useAzureOAuth } from '../../hooks/useAzureOAuth'
  ```

- [ ] **Step 5.3: Add STEP_META constant** (after STEP_LABELS)

  ```js
  const STEP_META = {
    sourceType:  { title: 'Choose Source',            subtitle: 'Select where to import your repositories from.' },
    azureConnect:{ title: 'Connect to Azure DevOps',  subtitle: 'Enter your organization and credentials.' },
    urlInput:    { title: 'Repository URL',            subtitle: 'Enter the clone URL of the Git repository.' },
    githubSource:{ title: 'GitHub Repository',         subtitle: 'Enter the GitHub repository to import.' },
    targetConfig:{ title: 'Target Configuration',      subtitle: 'Configure where to import the repository.' },
    repoSelect:  { title: 'Select Repositories',       subtitle: 'Choose which repositories to migrate.' },
    repoConfig:  { title: 'Configure Repositories',    subtitle: 'Set target names and options for each repo.' },
    workItems:   { title: 'Work Items',                subtitle: 'Configure work item migration settings.' },
    wiki:        { title: 'Wiki',                      subtitle: 'Configure wiki migration settings.' },
    aiReview:    { title: 'AI Review',                 subtitle: 'Review the migration plan with AI assistance.' },
    schedule:    { title: 'Schedule',                  subtitle: 'Choose when to run the migration.' },
    progress:    { title: 'Migration in Progress',     subtitle: 'Your migration is running.' },
    summary:     { title: 'Migration Complete',        subtitle: 'Review the results of your migration.' },
  }
  ```

- [ ] **Step 5.4: Instantiate useAzureOAuth inside the MigrationWizard component**

  After `const wizard = useMigrationWizard()` add:

  ```js
  const oauthHook = useAzureOAuth()
  ```

- [ ] **Step 5.5: Pass oauthHook to SourceStep**

  In `renderStep()`, change the `azureConnect` case from:

  ```js
  case 'azureConnect':
    return <SourceStep source={source} onChange={updateSource} />
  ```

  To:

  ```js
  case 'azureConnect':
    return <SourceStep source={source} onChange={updateSource} oauthHook={oauthHook} />
  ```

- [ ] **Step 5.6: Replace step indicator with connected version + render step title/subtitle**

  Replace the entire `<nav>` block (the existing step indicator) with:

  ```jsx
  {source.sourceType && (
    <nav aria-label="Wizard steps" className="mb-4">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const isActive = index === currentStepIndex
          const isCompleted = index < currentStepIndex
          const label = STEP_LABELS[step] || step
          return (
            <li key={step} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => goToStep(step)}
                  disabled={!isCompleted}
                  aria-label={`${label}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  className={`
                    flex items-center justify-center rounded-full text-xs font-bold transition-all
                    ${isActive
                      ? 'w-8 h-8 bg-indigo-500 text-white ring-4 ring-indigo-500/20 scale-110'
                      : isCompleted
                        ? 'w-6 h-6 bg-emerald-500 text-white cursor-pointer hover:bg-emerald-600'
                        : 'w-6 h-6 bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
                    }
                  `}
                >
                  {isCompleted ? '✓' : index + 1}
                </button>
                <span className={`mt-1.5 text-[10px] font-medium truncate max-w-[52px] text-center
                  ${isActive ? 'text-indigo-600 dark:text-indigo-400' : isCompleted ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 mb-5 transition-colors ${isCompleted ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )}
  ```

  Then, after the `<nav>` block (before `<BreadcrumbNav>`), add the step title/subtitle:

  ```jsx
  {STEP_META[currentStep] && (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        {STEP_META[currentStep].title}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
        {STEP_META[currentStep].subtitle}
      </p>
    </div>
  )}
  ```

- [ ] **Step 5.7: Commit**

  ```bash
  git add src/components/MigrationWizard/MigrationWizard.jsx
  git commit -m "feat(wizard): add step indicator lines, STEP_META titles, instantiate useAzureOAuth"
  ```

---

## Task 6: SourceTypeStep — Card layout with pendingType flash

**Files:**
- Modify: `src/components/MigrationWizard/steps/SourceTypeStep.jsx`

- [ ] **Step 6.1: Read existing SourceTypeStep.jsx**

- [ ] **Step 6.2: Rewrite SourceTypeStep.jsx**

  The 300ms visual flash uses local `pendingType` state. `onChange` is called after the flash. The existing MigrationWizard `useEffect` auto-advance fires when `source.sourceType` is set — no extra setTimeout needed in the wizard.

  ```jsx
  import { useState, useEffect, useRef } from 'react'
  import { motion } from 'framer-motion'
  import { Cloud, Globe, GitBranch, AlertTriangle, Loader2, Star } from 'lucide-react'

  const SOURCE_TYPES = [
    {
      value: 'azure',
      label: 'Azure DevOps',
      desc: 'Import repos, work items, and wikis from Azure DevOps',
      icon: Cloud,
      recommended: true,
    },
    {
      value: 'url',
      label: 'Git URL',
      desc: 'Any public or private Git repository URL',
      icon: Globe,
      recommended: false,
    },
    {
      value: 'github',
      label: 'GitHub',
      desc: 'Clone or mirror between GitHub organizations',
      icon: GitBranch,
      recommended: false,
    },
  ]

  export default function SourceTypeStep({ source, onChange }) {
    const [gitAvailable, setGitAvailable] = useState(null)
    const [pendingType, setPendingType] = useState(null)
    const timerRef = useRef(null)

    useEffect(() => {
      fetch('/api/import/git-status', { credentials: 'include' })
        .then((r) => r.json())
        .then((data) => setGitAvailable(data.available !== false))
        .catch(() => setGitAvailable(false))
    }, [])

    const handleSelect = (value) => {
      if (pendingType) return // debounce double-clicks
      setPendingType(value)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        onChange({ sourceType: value })
        setPendingType(null)
      }, 300)
    }

    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        {gitAvailable === null && (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking git availability...
          </div>
        )}
        {gitAvailable === false && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Git is not installed on the server. Imports may not work correctly.</span>
          </div>
        )}
        <div className="space-y-3">
          {SOURCE_TYPES.map((st) => {
            const Icon = st.icon
            const selected = source.sourceType === st.value || pendingType === st.value
            return (
              <button
                key={st.value}
                onClick={() => handleSelect(st.value)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left
                  ${selected
                    ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 scale-[1.01]'
                    : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
              >
                <div className={`p-3 rounded-xl transition-colors ${selected ? 'bg-indigo-100 dark:bg-indigo-900/40' : 'bg-slate-100 dark:bg-slate-800'}`}>
                  <Icon className={`w-6 h-6 ${selected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{st.label}</span>
                    {st.recommended && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                        <Star className="w-3 h-3" />
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{st.desc}</p>
                </div>
              </button>
            )
          })}
        </div>
      </motion.div>
    )
  }
  ```

- [ ] **Step 6.3: Commit**

  ```bash
  git add src/components/MigrationWizard/steps/SourceTypeStep.jsx
  git commit -m "feat(wizard): redesign SourceTypeStep with cards and pendingType flash"
  ```

---

## Task 7: RepoSelectStep — PAT propagation + auto-select + visual improvements

**Files:**
- Modify: `src/components/MigrationWizard/steps/RepoSelectStep.jsx`

**Depends on:** Task 1 (urlParsedRepo in wizard state).

- [ ] **Step 7.1: Read RepoSelectStep.jsx in full**

- [ ] **Step 7.2: Fix PAT propagation in EmptyRepoState**

  Find `EmptyRepoState`'s fetch call (around line 30–40). Change:

  ```js
  body: JSON.stringify({ org: source.org, project: source.project, pat: source.pat || undefined }),
  ```

  To:

  ```js
  body: JSON.stringify({ org: source.org, project: source.project, pat: source.credentialMode === 'personalPat' ? source.pat : undefined }),
  ```

  Also update the `useEffect` dependency array to include `source.credentialMode`.

- [ ] **Step 7.3: Fix PAT propagation in main repo fetch**

  Find where `/api/azure/repos` is called. Change any `pat: source.pat || undefined` to:

  ```js
  pat: source.credentialMode === 'personalPat' ? source.pat : undefined
  ```

- [ ] **Step 7.4: Add auto-select useEffect for urlParsedRepo**

  After the existing `useEffect` that fetches repos, add:

  ```js
  // Auto-select repo matching urlParsedRepo from URL paste
  useEffect(() => {
    if (!source.urlParsedRepo || !repos.length) return
    const match = repos.find((r) => r.name === source.urlParsedRepo)
    if (match && !match.selected) {
      onSetRepos(repos.map((r) => r.name === source.urlParsedRepo ? { ...r, selected: true } : r))
    }
  }, [repos, source.urlParsedRepo]) // eslint-disable-line react-hooks/exhaustive-deps
  ```

- [ ] **Step 7.5: Remove internal `<h3>` / `<p>` header block if present**

  Search for a heading like `<h3` inside the return JSX and remove it (content now rendered by STEP_META in MigrationWizard).

- [ ] **Step 7.6: Commit**

  ```bash
  git add src/components/MigrationWizard/steps/RepoSelectStep.jsx
  git commit -m "feat(wizard): fix PAT propagation, add urlParsedRepo auto-select in RepoSelectStep"
  ```

---

## Task 8: WorkItemsStep + WikiStep — PAT propagation

**Files:**
- Modify: `src/components/MigrationWizard/steps/WorkItemsStep.jsx`
- Modify: `src/components/MigrationWizard/steps/WikiStep.jsx`

- [ ] **Step 8.1: Fix WorkItemsStep.jsx**

  Read the file. Find `pat: source.pat || undefined` (around line 52). Change to:

  ```js
  pat: source.credentialMode === 'personalPat' ? source.pat : undefined
  ```

  Update the `useEffect` dependency array to include `source.credentialMode`.

- [ ] **Step 8.2: Fix WikiStep.jsx**

  Read the file. Find `pat: source.pat || undefined` (around line 34). Change to:

  ```js
  pat: source.credentialMode === 'personalPat' ? source.pat : undefined
  ```

  Update the `useEffect` dependency array to include `source.credentialMode`.

- [ ] **Step 8.3: Commit**

  ```bash
  git add src/components/MigrationWizard/steps/WorkItemsStep.jsx src/components/MigrationWizard/steps/WikiStep.jsx
  git commit -m "feat(wizard): fix PAT propagation for credentialMode in WorkItemsStep and WikiStep"
  ```

---

## Task 9: Visual cleanup — remove internal headers from all other step files

**Files:**
- Modify (as needed): `src/components/MigrationWizard/steps/RepoConfigStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/AIReviewStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/ScheduleStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/SummaryStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/ProgressStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/SimpleProgressStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/UrlInputStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/GitHubSourceStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/TargetConfigStep.jsx`
- Modify (as needed): `src/components/MigrationWizard/steps/WikiStep.jsx`

- [ ] **Step 9.1: Read each file and identify the internal `<h3>` / `<p>` header block**

  Each step currently has a pattern like:

  ```jsx
  <div>
    <h3 className="text-lg font-semibold ...">Title</h3>
    <p className="text-sm text-slate-500 ...">Description</p>
  </div>
  ```

  This is now rendered by `STEP_META` in `MigrationWizard.jsx`. Remove the `<div><h3>...</h3><p>...</p></div>` block from each step. If the block is the first element of a `space-y-*` wrapper, removing it will leave the remaining children correctly spaced.

- [ ] **Step 9.2: Remove headers from each file that has them**

  Process each file: read → find header block → remove → save. Only modify files that have this pattern. Do not touch files that don't.

- [ ] **Step 9.3: Commit**

  ```bash
  git add src/components/MigrationWizard/steps/
  git commit -m "style(wizard): remove internal step headers, now rendered by STEP_META"
  ```

---

## Task 10: Smoke test

- [ ] **Step 10.1: Start the dev server**

  ```bash
  npm run dev
  ```

  Expected: server and client start without errors.

- [ ] **Step 10.2: Verify SourceTypeStep**

  Open the Migration Wizard. Confirm:
  - Three source cards render with icons, titles, descriptions.
  - Azure DevOps card shows "Recommended" badge.
  - Clicking a card shows a 300ms visual flash, then advances to the next step.

- [ ] **Step 10.3: Verify smart URL paste + credential cards**

  On the Connect step:
  - Paste `https://dev.azure.com/myorg/myproject` → org and project badges appear → org field fills.
  - Credential panel shows loading skeleton briefly, then resolves to 3 cards.
  - Server PAT card shows "Configured" (green) or "Not configured" (grey) depending on whether `AZURE_PAT` is set in `.env`.
  - Personal PAT card is selectable; PAT input + Create PAT link visible when selected.
  - OAuth card shows "Not configured" with setup instructions if env vars not set.

- [ ] **Step 10.4: Verify auto-validation**

  With server PAT configured (or personal PAT entered):
  - Spinner appears inline next to org field.
  - On success: project dropdown slides in; "Connected" badge appears.
  - No "Validate" button visible.

- [ ] **Step 10.5: Verify step indicator**

  Confirm connecting lines appear between step circles. Completed steps show emerald + checkmark, active step is larger with indigo ring.

- [ ] **Step 10.6: Verify step titles**

  Each step shows its title and subtitle from `STEP_META` in the modal content area.

- [ ] **Step 10.7: Final commit**

  ```bash
  git add -A
  git commit -m "chore: migration wizard redesign complete — smoke test passed"
  ```
