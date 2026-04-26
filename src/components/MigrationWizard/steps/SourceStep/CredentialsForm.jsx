import {
  KeyRound, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  ExternalLink, Server, Globe, ShieldCheck,
} from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import CredCard from './CredCard'
import { Button } from '../../../ui/Button'

/**
 * Credential selection cards (Server PAT / Personal PAT / OAuth) with per-mode
 * inline forms. Matches the original SourceStep.jsx markup verbatim — extracted
 * purely to shrink the top-level component.
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
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Authentication</p>
      <div className="space-y-2">

        {/* Card 1 — Server PAT */}
        <CredCard
          mode="serverPat"
          icon={Server}
          label="Server PAT"
          subtitle="Configured in the server .env file — no credentials entered here."
          available={envAuthAvailable}
          active={source.credentialMode === 'serverPat'}
          onSelect={handleModeSwitch}
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
          active={source.credentialMode === 'personalPat'}
          onSelect={handleModeSwitch}
        >
          {source.credentialMode === 'personalPat' && (
            <div className="space-y-2">
              <div className="relative">
                <input
                  type={showPat ? 'text' : 'password'}
                  value={source.pat}
                  onChange={(e) => onChange({ pat: e.target.value, validated: false })}
                  placeholder="Paste your Personal Access Token"
                  aria-label="Personal Access Token"
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
          active={source.credentialMode === 'oauth'}
          onSelect={handleModeSwitch}
          extra={oauthConfigured && source.credentialMode !== 'oauth' ? (
            <span className="text-[10px] text-indigo-400">Lista orgs automaticamente</span>
          ) : null}
        >
          {!oauthConfigured ? (
            <pre className="text-xs bg-slate-800 text-slate-300 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{`1. Register an app in Azure Portal (Azure Active Directory → App Registrations).\n2. Set Redirect URI to: http://localhost:3001/api/azure/oauth/callback\n3. Add to your server .env file:\n     AZURE_CLIENT_ID=<app-client-id>\n     AZURE_CLIENT_SECRET=<app-client-secret>\n     AZURE_TENANT_ID=<tenant-id>  (or "common" for multi-tenant)\n4. Restart the server.`}</pre>
          ) : source.credentialMode === 'oauth' ? (
            <div className="space-y-2">
              {oauthStatusValue === 'idle' && (
                <Button
                  variant="primary"
                  type="button"
                  onClick={() => {
                    const popup = window.open('/api/azure/oauth/start', '_blank')
                    if (!popup) {
                      setValidationError('Popup blocked — allow popups for this page and try again.')
                      return
                    }
                    startOAuth()
                  }}
                >
                  <Globe className="w-4 h-4" />
                  Open browser to authenticate
                </Button>
              )}
              {oauthStatusValue === 'pending' && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Spinner size="md" tone="muted" />
                  Waiting for browser authentication...
                </div>
              )}
              {oauthStatusValue === 'success' && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Authenticated
                </span>
              )}
              {(oauthStatusValue === 'error' || oauthStatusValue === 'timeout') && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <XCircle className="w-4 h-4" />
                  {oauthStatusValue === 'timeout' ? 'Authentication timed out — ' : 'Authentication error — '}
                  <button type="button" onClick={retryOAuth} className="underline">try again</button>
                </div>
              )}
            </div>
          ) : null}
        </CredCard>

      </div>
    </div>
  )
}
