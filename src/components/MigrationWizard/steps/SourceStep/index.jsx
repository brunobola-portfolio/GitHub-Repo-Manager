import { AnimatePresence, motion } from 'framer-motion'
import { useMemo } from 'react'
import { CheckCircle2, XCircle, KeyRound, Server, ShieldCheck, FolderGit2 } from 'lucide-react'
import { Select } from '../../../ui/Select'
import { useSourceStepForm } from '../../hooks/useSourceStepForm'
import SourceUrlForm from './SourceUrlForm'
import OrgField from './OrgField'
import CredentialsForm from './CredentialsForm'

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

    if (isInactive) badge = `Inactivo · ${badge || '0 repos'}`

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
    if (inactive > 0) return `${active} activos · ${inactive} inactivos`
    return `${active} projectos`
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

  return (
    <div className="space-y-5">

      {/* Connection summary badge */}
      <AnimatePresence>
        {connectionSummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {source.org} / {source.project}
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
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

      {/* Validation status (non-access errors only) */}
      {source.validated && !connectionSummary && (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          Connected
        </span>
      )}
      {validationError && !validating && !isAccessError && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <XCircle className="w-4 h-4 shrink-0" />
          {validationError}
          <button type="button" onClick={runValidation} className="underline ml-1">Retry</button>
        </div>
      )}

      {/* Project Dropdown — enriched */}
      {source.validated && (
        <div>
          <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Project
          </p>
          <Select
            value={source.project}
            onChange={handleProjectChange}
            placeholder="Selecionar projecto..."
            options={projectOptions}
            searchable={projects.length > 5}
            label="Project"
            footer={projectFooter}
          />
        </div>
      )}

    </div>
  )
}
