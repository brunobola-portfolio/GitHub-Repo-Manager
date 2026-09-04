import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Cloud, KeyRound, Loader2, Globe, Info, X, Keyboard, AlertTriangle,
} from 'lucide-react'
import { Spinner } from '../../../ui/Spinner'
import { Select } from '../../../ui/Select'
import { Field, Input } from '../../../ui/form'
import { buildPatSettingsUrl } from '../../../../utils/azureProvider'

/**
 * Org selector with two modes:
 *  - OAuth dropdown (sections: Recent + All, with project-count badges)
 *  - Manual input (PAT mode or fallback from dropdown)
 *
 * Also renders: inline validation status pill, OAuth upgrade hint,
 * and PAT access-error banner.
 */
export default function OrgField({
  source,
  isDropdownMode,
  isOAuthMode,
  manualOrgMode,
  setManualOrgMode,
  organizations,
  orgProjectCounts,
  orgsLoading,
  orgsError,
  fetchOrganizations,
  handleOrgDropdownOpen,
  handleOrgDropdownChange,
  handleOrgInputChange,
  validating,
  validationError,
  projects,
  oauthConfigured,
  oauthStatusValue,
  oauthHintDismissed,
  dismissOauthHint,
  handleModeSwitch,
}) {
  const orgDropdownSections = useMemo(() => {
    if (!organizations || organizations.length === 0) return []

    let recents = []
    try {
      recents = JSON.parse(sessionStorage.getItem('azure-recent-orgs') || '[]').slice(0, 3)
    } catch { /* ignore */ }

    const allOrgOptions = organizations.map(o => {
      const count = orgProjectCounts?.[o.accountName]
      return {
        value: o.accountName,
        label: o.accountName,
        icon: Cloud,
        badge: count === null ? '...' : count === undefined ? null : count === -1 ? '—' : `${count} proj`,
        badgeColor: count === -1 ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400',
      }
    })

    const sections = []
    const recentOrgs = allOrgOptions.filter(o => recents.includes(o.value))
    if (recentOrgs.length > 0) {
      sections.push({ title: 'Recent', options: recentOrgs })
      const remainingOrgs = allOrgOptions.filter(o => !recents.includes(o.value))
      if (remainingOrgs.length > 0) {
        sections.push({ title: 'All', options: remainingOrgs })
      }
    } else {
      sections.push({ title: undefined, options: allOrgOptions })
    }

    return sections
  }, [organizations, orgProjectCounts])

  const orgStatusBadge = useMemo(() => {
    if (validating) {
      return { text: 'Validating...', color: 'text-slate-500 dark:text-slate-400', dot: 'bg-slate-400', spin: true }
    }
    if (source.validated) {
      const count = projects.length
      return { text: `Connected · ${count} proj`, color: 'text-emerald-500 dark:text-emerald-400', dot: 'bg-emerald-500' }
    }
    if (validationError) {
      if (validationError.includes('401') || validationError.includes('403') || validationError.includes('insufficient')) {
        return { text: 'No access to this org', color: 'text-amber-500 dark:text-amber-400', dot: 'bg-amber-500' }
      }
      if (validationError.includes('not found') || validationError.includes('404')) {
        return { text: 'Org not found', color: 'text-rose-400 dark:text-rose-400', dot: 'bg-rose-400' }
      }
      return { text: 'Connection error', color: 'text-rose-400 dark:text-rose-400', dot: 'bg-rose-400' }
    }
    return null
  }, [validating, source.validated, validationError, projects.length])

  const isAccessError = validationError && (
    validationError.includes('401') || validationError.includes('403') ||
    validationError.includes('insufficient') || validationError.includes('Invalid')
  )

  return (
    <div>
      <label htmlFor="azure-org" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
        Organization
      </label>

      <AnimatePresence mode="wait">
        {isDropdownMode ? (
          <motion.div
            key="org-dropdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Select
              value={source.org}
              onChange={handleOrgDropdownChange}
              placeholder="Select an organization..."
              sections={orgDropdownSections}
              searchable
              loading={orgsLoading}
              label="Organization"
              onOpen={handleOrgDropdownOpen}
              emptyState={
                orgsError ? (
                  <div className="px-3 py-4 text-center">
                    <p className="text-sm text-rose-600 dark:text-rose-400 mb-2">
                      {orgsError === 'TOKEN_EXPIRED' ? 'Session expired — authenticate again' : orgsError}
                    </p>
                    <button
                      type="button"
                      onClick={fetchOrganizations}
                      className="text-xs text-brand-500 hover:text-brand-400 underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                    No organizations found for this account
                  </div>
                )
              }
              extraOption={
                <button
                  type="button"
                  onClick={() => setManualOrgMode(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-t border-slate-200 dark:border-slate-700"
                  aria-label="Enter organization manually"
                >
                  <Keyboard className="w-4 h-4" />
                  Or type manually...
                </button>
              }
              footer={organizations?.length > 0 ? `${organizations.length} orgs available` : undefined}
            />
          </motion.div>
        ) : (
          <motion.div
            key="org-input"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Input
              id="azure-org"
              type="text"
              value={source.org}
              onChange={handleOrgInputChange}
              placeholder="my-organization"
              aria-label="Azure DevOps organization"
              leadingIcon={Cloud}
              status={isAccessError ? 'error' : 'idle'}
              className="pr-44"
              trailing={
                <AnimatePresence mode="wait">
                  {source.org && orgStatusBadge && (
                    <motion.div
                      key={orgStatusBadge.text}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-1.5"
                      aria-live="polite"
                    >
                      {orgStatusBadge.spin ? (
                        <Spinner size="xs" className={orgStatusBadge.color} />
                      ) : (
                        <motion.span
                          initial={{ scale: 1 }}
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ duration: 0.3 }}
                          className={`w-2 h-2 rounded-full ${orgStatusBadge.dot}`}
                        />
                      )}
                      <span className={`text-xs font-medium ${orgStatusBadge.color}`}>
                        {orgStatusBadge.text}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              }
            />

            {manualOrgMode && isOAuthMode && oauthStatusValue === 'success' && (
              <button
                type="button"
                onClick={() => setManualOrgMode(false)}
                className="mt-1 text-xs text-brand-500 hover:text-brand-400 underline"
              >
                ← Back to organization list
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* OAuth upgrade hint */}
      <AnimatePresence>
        {!isOAuthMode && oauthConfigured && !oauthHintDismissed && source.org && source.validated && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, delay: 0.5 }}
            className="overflow-hidden"
            role="status"
          >
            <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-brand-500/10 border border-brand-500/20">
              <Info className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
              <p className="text-xs text-brand-300 dark:text-brand-300 flex-1">
                OAuth lets you list all your organizations automatically
              </p>
              <button
                type="button"
                onClick={() => handleModeSwitch('oauth')}
                className="text-xs font-medium text-brand-400 hover:text-brand-300 shrink-0"
              >
                Switch →
              </button>
              <button
                type="button"
                onClick={dismissOauthHint}
                className="text-slate-400 hover:text-slate-300 shrink-0"
                aria-label="Dismiss suggestion"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PAT access error — contextual actions */}
      <AnimatePresence>
        {isAccessError && !validating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    This PAT doesn't have permissions for "{source.org}"
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <a
                      // Host-aware: points at the actual server's PAT page
                      // (cloud, VSTS, or on-prem), not a hardcoded dev.azure.com.
                      href={buildPatSettingsUrl(source.host, source.org) || `https://dev.azure.com/${encodeURIComponent(source.org)}/_usersSettings/tokens`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:text-amber-500 underline"
                    >
                      <KeyRound className="w-3 h-3" />
                      Create a PAT for this org
                    </a>
                    {oauthConfigured && (
                      <button
                        type="button"
                        onClick={() => handleModeSwitch('oauth')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:text-brand-400 underline"
                      >
                        <Globe className="w-3 h-3" />
                        Switch to OAuth
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
