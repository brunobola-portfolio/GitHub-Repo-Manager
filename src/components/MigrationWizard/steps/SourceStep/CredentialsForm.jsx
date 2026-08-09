import {
  KeyRound, CheckCircle2, XCircle,
  Server, Globe, ShieldCheck,
} from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import { Skeleton } from '../../../ui/Skeleton'
import CredCard from './CredCard'
import PatPasteGuide from './PatPasteGuide'
import { Button } from '../../../ui/Button'
import { classifyProvider, PROVIDERS } from '../../../../utils/azureProvider'

/**
 * Three credential strategies, with crystal-clear identity for each:
 *
 *   1. Server PAT     — token in server's .env, shared across users.
 *                       Use for: dedicated cloud automation accounts.
 *                       Setup:   admin edits .env, restarts server.
 *
 *   2. Personal PAT   — token pasted in this browser session.
 *                       Use for: most people, especially on-prem TFS.
 *                       Setup:   create PAT on the server, paste here.
 *                       (Includes a 3-step guided PatPasteGuide.)
 *
 *   3. OAuth          — browser sign-in via Azure AD.
 *                       Use for: Azure DevOps cloud only.
 *                       Setup:   admin registers app in Azure Portal.
 *
 * The previous implementation showed "Configured" on multiple cards
 * simultaneously, making it impossible to tell which one was actually
 * being used. Now exactly one card carries the green "EM USO" pill.
 */
export default function CredentialsForm({
  source,
  onChange,
  credLoading,
  envAuthAvailable,
  oauthConfigured,
  oauthStatusValue,
  startOAuth,
  retryOAuth,
  showPat,
  setShowPat,
  handleModeSwitch,
  setValidationError,
}) {
  if (credLoading) {
    return (
      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Authentication</p>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} variant="card" className="h-16" />)}
        </div>
      </div>
    )
  }

  const provider = classifyProvider(source.host)
  const isCloud = provider.isCloud
  // Three distinct states — never collapse "nothing detected yet" (UNKNOWN)
  // into on-prem. `!isCloud` is true for BOTH unknown and on-prem, so any copy
  // that asserts "TFS on-premises" must gate on `isOnPrem`, not `!isCloud`,
  // otherwise it fires (with an empty host) before the user pastes a URL.
  const isOnPrem = provider.type === PROVIDERS.ON_PREM

  // "Ready" means: this credential alone is enough to make a successful
  // call. The card with state="active" is BOTH selected AND ready.
  // personalPat is ready when a PAT is pasted OR a saved credential picked.
  const serverReady = envAuthAvailable
  const personalReady = !!(source.pat?.trim() || source.savedCredentialId)
  const oauthReady = oauthStatusValue === 'success'

  const stateFor = (mode, ready, available) => {
    if (!available) return 'unavailable'
    if (source.credentialMode === mode) return ready ? 'active' : 'selected'
    return ready ? 'available' : 'available'  // both map to "available"
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Authentication</p>
        <span className="ds-text-meta text-slate-500 dark:text-slate-400">
          Choose a method — only one is used at a time
        </span>
      </div>
      <div className="space-y-2">

        {/* ── Card 1 — Server PAT (env-based) ─────────────────── */}
        <CredCard
          mode="serverPat"
          icon={Server}
          label="Server PAT (from the .env file)"
          subtitle="Token configured on the server running this app — shared by all users. Useful for a single automation token."
          state={stateFor('serverPat', serverReady, envAuthAvailable)}
          hint={
            envAuthAvailable
              ? (isOnPrem
                  ? 'AZURE_PAT detected in .env — heads up: likely a cloud token, may fail against on-prem TFS'
                  : 'AZURE_PAT detected in .env')
              : 'AZURE_PAT is not set in .env'
          }
          onSelect={handleModeSwitch}
        >
          {!envAuthAvailable && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                To enable this mode:
              </p>
              <pre className="ds-text-meta bg-slate-900 text-slate-200 rounded-lg p-2.5 overflow-x-auto">{`# Edit server/.env
AZURE_PAT=<token-with-Code+Project-scopes>

# Restart the server
npm run dev`}</pre>
              <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                Then reload this page. Recommended only for single-user environments.
              </p>
            </div>
          )}
          {envAuthAvailable && source.credentialMode === 'serverPat' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nothing to paste here — the server injects the token automatically when this card is active.
            </p>
          )}
        </CredCard>

        {/* ── Card 2 — Personal PAT (paste in browser) ────────── */}
        <CredCard
          mode="personalPat"
          icon={KeyRound}
          label="Personal Access Token (this session)"
          subtitle={source.savedCredentialId
            ? 'Using a saved token from your vault — managed in Settings → Azure Credentials.'
            : 'Paste your PAT here — it stays only in this browser session. Recommended for on-prem TFS or when you want to use your own identity.'}
          state={stateFor('personalPat', personalReady, true)}
          hint={
            source.savedCredentialId
              ? 'Saved token chosen · ready to validate'
              : source.pat?.trim()
                ? 'Token pasted · ready to validate'
                : (source.credentialMode === 'personalPat'
                    ? 'Waiting for a token — choose a saved one or paste a new one below'
                    : 'No token in this session')
          }
          onSelect={handleModeSwitch}
        >
          {source.credentialMode === 'personalPat' && (
            <PatPasteGuide
              source={source}
              onChange={onChange}
              showPat={showPat}
              setShowPat={setShowPat}
            />
          )}
        </CredCard>

        {/* ── Card 3 — OAuth (cloud-only) ─────────────────────── */}
        <CredCard
          mode="oauth"
          icon={ShieldCheck}
          label="OAuth / Browser Login"
          subtitle={isCloud
            ? 'Authentication via Azure AD — opens a browser window to sign in.'
            : isOnPrem
              ? 'OAuth via Azure AD is not available for on-premises TFS. Use a Personal PAT.'
              : 'OAuth via Azure AD only works with Azure DevOps cloud. Paste a URL to detect the server.'}
          state={
            !isCloud
              ? 'unavailable'
              : !oauthConfigured
                ? 'unavailable'
                : stateFor('oauth', oauthReady, true)
          }
          hint={
            !isCloud
              ? 'Cloud Azure DevOps only'
              : !oauthConfigured
                ? 'Not configured on the server'
                : oauthReady
                  ? 'Authenticated'
                  : 'Ready — click to open the login'
          }
          onSelect={handleModeSwitch}
        >
          {isOnPrem && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              To authenticate against <code>{source.host}</code>, use a <strong>Personal Access Token</strong> above.
            </p>
          )}
          {isCloud && !oauthConfigured && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">For the server admin to enable OAuth:</p>
              <pre className="ds-text-meta bg-slate-900 text-slate-200 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">{`1. Register an app in Azure Portal (AAD → App Registrations)
2. Redirect URI: http://localhost:3001/api/azure/oauth/callback
3. Add to server/.env:
     AZURE_CLIENT_ID=<app-client-id>
     AZURE_CLIENT_SECRET=<app-client-secret>
     AZURE_TENANT_ID=<tenant-id>   (or "common")
4. Restart the server.`}</pre>
            </div>
          )}
          {isCloud && oauthConfigured && source.credentialMode === 'oauth' && (
            <OAuthSection
              status={oauthStatusValue}
              startOAuth={startOAuth}
              retryOAuth={retryOAuth}
              setValidationError={setValidationError}
            />
          )}
        </CredCard>

      </div>
    </div>
  )
}

function OAuthSection({ status, startOAuth, retryOAuth, setValidationError }) {
  if (status === 'idle') {
    return (
      <Button
        variant="primary"
        type="button"
        onClick={() => {
          const popup = window.open('/api/azure/oauth/start', '_blank')
          if (!popup) {
            setValidationError('Popup blocked — allow popups and try again.')
            return
          }
          startOAuth()
        }}
      >
        <Globe className="w-4 h-4" />
        Open browser to authenticate
      </Button>
    )
  }
  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Spinner size="md" tone="muted" />
        Waiting for authentication in the browser…
      </div>
    )
  }
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-4 h-4" />
        Authenticated via Azure AD
      </span>
    )
  }
  if (status === 'error' || status === 'timeout') {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
        <XCircle className="w-4 h-4" />
        {status === 'timeout' ? 'Timed out — ' : 'Authentication error — '}
        <button type="button" onClick={retryOAuth} className="underline">try again</button>
      </div>
    )
  }
  return null
}
