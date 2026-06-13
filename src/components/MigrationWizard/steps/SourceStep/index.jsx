import { AnimatePresence, motion } from 'framer-motion'
import { useMemo } from 'react'
import { CheckCircle2, KeyRound, Server, ShieldCheck, FolderGit2 } from 'lucide-react'
import { Select } from '../../../ui/Select'
import { useSourceStepForm } from '../../hooks/useSourceStepForm'
import SourceUrlForm from './SourceUrlForm'
import OrgField from './OrgField'
import CredentialsForm from './CredentialsForm'
import ServerPicker from './ServerPicker'
import AllowlistFixPanel from '../../../ui/AllowlistFixPanel'
import RestartServerHint from './RestartServerHint'
import ProviderBadge from '../../ui/ProviderBadge'
import ConnectionStatusPanel from '../../ui/ConnectionStatusPanel'
import { classifyProvider, PROVIDERS } from '../../../../utils/azureProvider'

/**
 * Azure DevOps source configuration step.
 *
 * Thin shell that delegates state + effects to `useSourceStepForm` and
 * composes three presentational blocks:
 *  - `SourceUrlForm` (smart URL paste)
 *  - `OrgField`      (OAuth dropdown / manual input, status, hints)
 *  - `CredentialsForm` (Server PAT / Personal PAT / OAuth cards)
 *
 * Project picker and connection summary are kept inline — they're small and
 * tightly coupled to the shell.
 */
export default function SourceStep({ source, onChange, oauthHook, orgsHook }) {
  const form = useSourceStepForm({ source, onChange, oauthHook, orgsHook })

  const {
    envAuthAvailable, oauthConfigured, credLoading, showPat, setShowPat,
    projects, projectMeta, validating, validationError, setValidationError,
    smartPasteValue, urlPreview, oauthHintDismissed, manualOrgMode, setManualOrgMode,
    hostAllowlist, refreshAllowlist,
    isOAuthMode, isDropdownMode,
    handleUrlInput, applyUrlPreview, dismissUrlPreview,
    handleModeSwitch, runValidation,
    handleOrgInputChange, handleOrgDropdownChange, handleProjectChange,
    handleOrgDropdownOpen, dismissOauthHint,
    oauthStatusValue, startOAuth, retryOAuth,
    organizations, orgsLoading, orgsError, orgProjectCounts, fetchOrganizations,
  } = form

  // ── project dropdown options (inline — tightly coupled to connection state)
  const projectOptions = useMemo(() => projects.map(p => {
    const meta = projectMeta[p.name]
    const isInactive = p.state && p.state !== 'wellFormed'
    const repoCount = meta?.repoCount
    const vcType = meta?.vcType || 'Git'

    let badge = null
    if (repoCount === -1) badge = '—'
    else if (repoCount === undefined || repoCount === null) badge = '...'
    else if (vcType === 'Tfvc' && repoCount > 0) badge = `Tfvc + Git · ${repoCount} ${repoCount === 1 ? 'repo' : 'repos'}`
    else if (vcType === 'Tfvc') badge = 'Tfvc'
    else badge = `Git · ${repoCount} ${repoCount === 1 ? 'repo' : 'repos'}`

    if (isInactive) badge = `Inactive · ${badge || '0 repos'}`

    return {
      value: p.name,
      label: p.name,
      icon: FolderGit2,
      badge,
      badgeColor: isInactive ? 'text-amber-500 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400',
      muted: isInactive,
    }
  }), [projects, projectMeta])

  const projectFooter = useMemo(() => {
    if (projects.length === 0) return null
    const active = projects.filter(p => !p.state || p.state === 'wellFormed').length
    const inactive = projects.length - active
    if (inactive > 0) return `${active} active · ${inactive} inactive`
    return `${active} projects`
  }, [projects])

  const connectionSummary = source.validated && source.project && source.org
  const authLabel = source.credentialMode === 'serverPat' ? 'Server PAT'
    : source.credentialMode === 'personalPat' ? 'Personal PAT'
    : source.credentialMode === 'oauth' ? 'OAuth'
    : ''
  const AuthIcon = source.credentialMode === 'serverPat' ? Server
    : source.credentialMode === 'personalPat' ? KeyRound
    : ShieldCheck

  const isAccessError = validationError && (
    validationError.includes('401') || validationError.includes('403') ||
    validationError.includes('insufficient') || validationError.includes('Invalid')
  )

  const provider = classifyProvider(source.host)
  // Heuristic: a server-side AZURE_PAT is almost always for cloud. When the
  // user pasted an on-prem URL, warn that Server PAT mode probably won't
  // authenticate against their TFS instance and suggest Personal PAT.
  // Gate on the ON_PREM classification specifically — NOT `!isCloud`, which is
  // also true for the UNKNOWN (nothing-pasted-yet) provider and would fire the
  // warning with an empty {source.host}. ON_PREM only ever resolves from a
  // real, non-empty host, so the message always has a host to show.
  const serverPatLikelyWrong = (
    provider.type === PROVIDERS.ON_PREM
    && source.credentialMode === 'serverPat'
    && envAuthAvailable
  )
  // Compute credential readiness here (mirrors the hook's internal logic)
  // so ConnectionStatusPanel can show the right "Credentials ready" state.
  // Must include savedCredentialId — picking a stored token from the vault
  // counts as "ready" since the backend decrypts it server-side.
  const credentialReady = (
    (source.credentialMode === 'serverPat' && envAuthAvailable) ||
    (source.credentialMode === 'personalPat' && (source.pat?.trim() || source.savedCredentialId)) ||
    (source.credentialMode === 'oauth' && oauthStatusValue === 'success')
  )

  return (
    <div className="space-y-5">

      {/* Premium connection summary — appears once everything is wired up.
          Replaces the old plain green bar with a denser card that shows
          provider, org, project, and active auth mode at a glance. */}
      <AnimatePresence>
        {connectionSummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800">
              <div className="shrink-0 w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                  <span className="truncate">{source.org} / {source.project}</span>
                  <ProviderBadge host={source.host} variant="inline" />
                </div>
                <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                  Ready to pick repositories
                </div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-900/30">
                <AuthIcon className="w-3 h-3" />
                {authLabel}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SourceUrlForm
        smartPasteValue={smartPasteValue}
        urlPreview={urlPreview}
        onInput={handleUrlInput}
        onApply={applyUrlPreview}
        onDismiss={dismissUrlPreview}
      />

      {/* Always-visible server picker. Auto-fills from pasted URL but the
          user can override anytime (cloud preset, on-prem free-form).
          Hidden when already validated to keep the success state clean.
          The allowlistStatus chip warns users BEFORE they try to validate
          that the host needs to be added to ALLOWED_AZURE_HOSTS. */}
      {!connectionSummary && (
        <ServerPicker
          host={source.host}
          onHostChange={(newHost) => {
            // Saved credentials and pasted PATs are host-scoped — wipe them
            // when the user switches servers so a stale cloud token doesn't
            // get sent against an on-prem host (or vice-versa).
            const prev = (source.host || '').toLowerCase().split(':')[0]
            const next = (newHost || '').toLowerCase().split(':')[0]
            const patch = { host: newHost, validated: false }
            if (prev && next && prev !== next) {
              patch.savedCredentialId = null
              patch.pat = ''
            }
            onChange(patch)
            setValidationError('')
          }}
          allowlistStatus={hostAllowlist.allowed}
        />
      )}

      {/* Pre-emptive self-fix: when ServerPicker shows the host is not
          allowlisted and the user hasn't even tried to validate yet,
          show the fix panel proactively so they don't waste time. */}
      {source.host && hostAllowlist.allowed === false && !validating && !source.validated && !validationError && (
        <AllowlistFixPanel
          host={source.host}
          currentPatterns={hostAllowlist.patterns}
          usingDefault={hostAllowlist.usingDefault}
          canEdit={hostAllowlist.canEdit}
          onAdded={() => {
            // Refresh allowlist state (pill turns green) and auto-retry
            // validation so the user doesn't have to click "Try again".
            refreshAllowlist()
            setValidationError('')
            // Give the cache a moment to invalidate, then re-trigger.
            setTimeout(() => { runValidation() }, 400)
          }}
        />
      )}

      <OrgField
        source={source}
        isDropdownMode={isDropdownMode}
        isOAuthMode={isOAuthMode}
        manualOrgMode={manualOrgMode}
        setManualOrgMode={setManualOrgMode}
        organizations={organizations}
        orgProjectCounts={orgProjectCounts}
        orgsLoading={orgsLoading}
        orgsError={orgsError}
        fetchOrganizations={fetchOrganizations}
        handleOrgDropdownOpen={handleOrgDropdownOpen}
        handleOrgDropdownChange={handleOrgDropdownChange}
        handleOrgInputChange={handleOrgInputChange}
        validating={validating}
        validationError={validationError}
        projects={projects}
        oauthConfigured={oauthConfigured}
        oauthStatusValue={oauthStatusValue}
        oauthHintDismissed={oauthHintDismissed}
        dismissOauthHint={dismissOauthHint}
        handleModeSwitch={handleModeSwitch}
      />

      <CredentialsForm
        source={source}
        onChange={onChange}
        credLoading={credLoading}
        envAuthAvailable={envAuthAvailable}
        oauthConfigured={oauthConfigured}
        oauthStatusValue={oauthStatusValue}
        startOAuth={startOAuth}
        retryOAuth={retryOAuth}
        showPat={showPat}
        setShowPat={setShowPat}
        handleModeSwitch={handleModeSwitch}
        setValidationError={setValidationError}
      />

      {/* Single canonical connection status — shows once the user has
          started providing input (host or credentials). Hidden while the
          form is fully empty to avoid noise on the initial state. */}
      {(source.host || credentialReady || validating || source.validated || validationError) && (
        <ConnectionStatusPanel
          host={source.host}
          org={source.org}
          credentialReady={credentialReady}
          validating={validating}
          validated={source.validated}
          validationError={validationError}
          projectsCount={source.validated ? projects.length : null}
        />
      )}

      {/* Allowlist-specific self-fix: when the backend rejects the host
          because of ALLOWED_AZURE_HOSTS, render the dedicated panel with
          a copy-paste .env snippet — far more useful than a generic retry. */}
      {!validating && validationError && /ALLOWED_AZURE_HOSTS|not in ALLOWED|not in allowlist/i.test(validationError) && source.host && (
        <AllowlistFixPanel
          host={source.host}
          currentPatterns={hostAllowlist.patterns}
          usingDefault={hostAllowlist.usingDefault}
          canEdit={hostAllowlist.canEdit}
          onAdded={() => {
            // Refresh allowlist state (pill turns green) and auto-retry
            // validation so the user doesn't have to click "Try again".
            refreshAllowlist()
            setValidationError('')
            // Give the cache a moment to invalidate, then re-trigger.
            setTimeout(() => { runValidation() }, 400)
          }}
        />
      )}

      {/* Stale-backend self-fix: the "resolves to a non-public address"
          message is the SSRF DNS check rejecting an on-prem TFS that
          resolves to RFC1918. Newer server code bypasses this for
          allowlisted on-prem hosts; if the user still sees the message,
          their backend hasn't been restarted to pick up the fix. */}
      {!validating && validationError && /non-public address|private(?:\s+|-)?(?:ip|address)|rebinding/i.test(validationError) && source.host && hostAllowlist.allowed && (
        <RestartServerHint host={source.host} />
      )}

      {/* Inline action for all other validation failures — keep retry
          within thumb's reach. Skip when the error is the "missing server"
          guidance (no retry possible) or the allowlist error (handled above). */}
      {!validating && validationError
        && !validationError.includes('Set the server')
        && !/ALLOWED_AZURE_HOSTS|not in ALLOWED|not in allowlist/i.test(validationError) && (
        <div className="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
          <div className="text-xs text-slate-600 dark:text-slate-400 min-w-0">
            {isAccessError && !provider.isCloud
              ? <>The PAT must be created <strong>directly on {source.host}</strong> with the scopes <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">Code (Read)</code> + <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">Project &amp; Team (Read)</code>.</>
              : isAccessError
                ? <>Check the PAT scopes — minimum <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">Code (Read)</code> + <code className="px-1 rounded bg-slate-200 dark:bg-slate-700">Project &amp; Team (Read)</code>.</>
                : <>Check the URL and try again. If it persists, check the server logs.</>}
          </div>
          <button
            type="button"
            onClick={runValidation}
            className="shrink-0 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Smart hint — Server PAT (from .env) is almost always cloud-only.
          When on-prem source is detected with Server PAT mode active, nudge
          the user toward Personal PAT before they hit a 401. */}
      {serverPatLikelyWrong && !source.validated && !validating && (
        <div className="px-3.5 py-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/15 text-xs text-amber-800 dark:text-amber-200">
          <strong>Server PAT</strong> is configured in <code>.env</code>, but you've detected an on-premises TFS server ({source.host}).
          Server PAT is typically for Azure DevOps cloud — it probably <em>won't</em> authenticate against this server.
          Recommended: switch to <strong>Personal Access Token</strong> and paste a PAT created on <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">{source.host}</code>.
        </div>
      )}

      {/* Project picker — always renders after validation, even with 0 results.
          Empty state explains the most common cause (PAT scope). */}
      {source.validated && (
        <div>
          <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Project
          </p>
          {projects.length === 0 ? (
            <div className="px-3.5 py-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
              <div className="flex items-center gap-2 mb-1 text-slate-700 dark:text-slate-300">
                <FolderGit2 className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">No visible projects</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                The organization <strong>{source.org}</strong> responded but returned no projects.
                Common cause: the PAT is missing the <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">Project &amp; Team (Read)</code> scope,
                or the targeted collection is empty.
              </p>
            </div>
          ) : (
            <Select
              value={source.project}
              onChange={handleProjectChange}
              placeholder="Select a project..."
              options={projectOptions}
              searchable={projects.length > 5}
              label="Project"
              footer={projectFooter}
            />
          )}
        </div>
      )}

    </div>
  )
}
