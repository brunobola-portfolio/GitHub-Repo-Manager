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
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Autenticação</p>
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
    return ready ? 'available' : 'available'  // both map to "disponível"
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Autenticação</p>
        <span className="ds-text-meta text-slate-400 dark:text-slate-500">
          Escolhe um método — só um é usado de cada vez
        </span>
      </div>
      <div className="space-y-2">

        {/* ── Card 1 — Server PAT (env-based) ─────────────────── */}
        <CredCard
          mode="serverPat"
          icon={Server}
          label="Server PAT (do ficheiro .env)"
          subtitle="Token configurado no servidor que corre esta app — partilhado por todos os utilizadores. Útil para um único token de automação."
          state={stateFor('serverPat', serverReady, envAuthAvailable)}
          hint={
            envAuthAvailable
              ? (isOnPrem
                  ? 'AZURE_PAT detectado em .env — atenção: provavelmente cloud, pode falhar contra TFS on-prem'
                  : 'AZURE_PAT detectado em .env')
              : 'AZURE_PAT não está definido em .env'
          }
          onSelect={handleModeSwitch}
        >
          {!envAuthAvailable && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Para activar este modo:
              </p>
              <pre className="ds-text-meta bg-slate-900 text-slate-200 rounded-lg p-2.5 overflow-x-auto">{`# Edita server/.env
AZURE_PAT=<token-com-scopes-Code+Project>

# Reinicia o servidor
npm run dev`}</pre>
              <p className="ds-text-meta text-slate-500 dark:text-slate-400">
                Depois recarrega esta página. Recomendado apenas para ambientes single-user.
              </p>
            </div>
          )}
          {envAuthAvailable && source.credentialMode === 'serverPat' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nada para colares aqui — o servidor injecta o token automaticamente quando este card está activo.
            </p>
          )}
        </CredCard>

        {/* ── Card 2 — Personal PAT (paste in browser) ────────── */}
        <CredCard
          mode="personalPat"
          icon={KeyRound}
          label="Personal Access Token (esta sessão)"
          subtitle={source.savedCredentialId
            ? 'A usar um token guardado da tua vault — gerido em Settings → Azure Credentials.'
            : 'Cola o teu PAT aqui — fica só nesta sessão do browser. Recomendado para TFS on-prem ou quando queres usar a tua identidade.'}
          state={stateFor('personalPat', personalReady, true)}
          hint={
            source.savedCredentialId
              ? 'Token guardado escolhido · pronto a validar'
              : source.pat?.trim()
                ? 'Token colado · pronto a validar'
                : (source.credentialMode === 'personalPat'
                    ? 'Aguarda token — escolhe um guardado ou cola um novo abaixo'
                    : 'Sem token nesta sessão')
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
            ? 'Autenticação via Azure AD — abre uma janela do browser para fazer login.'
            : isOnPrem
              ? 'OAuth via Azure AD não está disponível para TFS on-premises. Usa Personal PAT.'
              : 'OAuth via Azure AD só funciona com Azure DevOps cloud. Cola uma URL para detectar o servidor.'}
          state={
            !isCloud
              ? 'unavailable'
              : !oauthConfigured
                ? 'unavailable'
                : stateFor('oauth', oauthReady, true)
          }
          hint={
            !isCloud
              ? 'Apenas para Azure DevOps cloud'
              : !oauthConfigured
                ? 'Não configurado no servidor'
                : oauthReady
                  ? 'Autenticado'
                  : 'Pronto — clica para abrir o login'
          }
          onSelect={handleModeSwitch}
        >
          {isOnPrem && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Para autenticares em <code>{source.host}</code>, usa <strong>Personal Access Token</strong> acima.
            </p>
          )}
          {isCloud && !oauthConfigured && (
            <div className="space-y-2">
              <p className="text-xs text-slate-600 dark:text-slate-300">Para o admin do servidor activar OAuth:</p>
              <pre className="ds-text-meta bg-slate-900 text-slate-200 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap">{`1. Regista uma app em Azure Portal (AAD → App Registrations)
2. Redirect URI: http://localhost:3001/api/azure/oauth/callback
3. Adiciona ao server/.env:
     AZURE_CLIENT_ID=<app-client-id>
     AZURE_CLIENT_SECRET=<app-client-secret>
     AZURE_TENANT_ID=<tenant-id>   (ou "common")
4. Reinicia o servidor.`}</pre>
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
            setValidationError('Popup bloqueado — permite popups e tenta de novo.')
            return
          }
          startOAuth()
        }}
      >
        <Globe className="w-4 h-4" />
        Abrir browser para autenticar
      </Button>
    )
  }
  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Spinner size="md" tone="muted" />
        À espera da autenticação no browser…
      </div>
    )
  }
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-4 h-4" />
        Autenticado via Azure AD
      </span>
    )
  }
  if (status === 'error' || status === 'timeout') {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
        <XCircle className="w-4 h-4" />
        {status === 'timeout' ? 'Tempo esgotado — ' : 'Erro de autenticação — '}
        <button type="button" onClick={retryOAuth} className="underline">tentar de novo</button>
      </div>
    )
  }
  return null
}
