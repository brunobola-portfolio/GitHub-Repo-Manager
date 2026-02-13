import { createContext, useContext, useState, useCallback, useMemo } from 'react'

/**
 * @typedef {Object} Organization
 * @property {string} login - Organization login/username
 * @property {string} name - Organization display name
 * @property {string} avatar_url - Organization avatar URL
 * @property {number} [repoCount] - Number of repositories
 */

/**
 * @typedef {Object} OrgStats
 * @property {number} totalRepos - Total repositories across all orgs
 * @property {number} totalStars - Total stars across all repos
 * @property {number} totalForks - Total forks across all repos
 */

/**
 * @typedef {Object} OrganizationContextValue
 * @property {Organization[]} orgs - Available organizations
 * @property {string|null} selectedOrg - Currently selected organization login
 * @property {OrgStats} stats - Aggregated statistics
 * @property {boolean} isSwitchingOrg - Whether org switch is in progress
 * @property {(orgLogin: string) => Promise<void>} handleOrgSelect - Select an organization
 * @property {() => Promise<void>} syncOrgs - Sync organizations from GitHub
 */

const OrganizationContext = createContext(null)

/**
 * OrganizationProvider - Manages organization selection and data
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function OrganizationProvider({ children }) {
  const [orgs, setOrgs] = useState([])
  const [selectedOrg, setSelectedOrg] = useState(null)
  const [stats, setStats] = useState({
    totalRepos: 0,
    totalStars: 0,
    totalForks: 0,
  })
  const [isSwitchingOrg, setIsSwitchingOrg] = useState(false)

  /**
   * Handle organization selection
   * @param {string} orgLogin - Organization login to select
   */
  const handleOrgSelect = useCallback(async (orgLogin) => {
    setIsSwitchingOrg(true)

    try {
      // Fetch org data and update stats
      const response = await fetch(`/api/orgs/${orgLogin}`)
      if (!response.ok) {
        throw new Error('Failed to fetch organization data')
      }

      const data = await response.json()
      setSelectedOrg(orgLogin)

      // Update stats if provided
      if (data.stats) {
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Error selecting organization:', error)
    } finally {
      setIsSwitchingOrg(false)
    }
  }, [])

  /**
   * Sync organizations from GitHub API
   */
  const syncOrgs = useCallback(async () => {
    try {
      const response = await fetch('/api/orgs/sync', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to sync organizations')
      }

      const data = await response.json()
      setOrgs(data.orgs || [])

      // Update stats if provided
      if (data.stats) {
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Error syncing organizations:', error)
    }
  }, [])

  const value = useMemo(
    () => ({
      orgs,
      selectedOrg,
      stats,
      isSwitchingOrg,
      handleOrgSelect,
      syncOrgs,
    }),
    [orgs, selectedOrg, stats, isSwitchingOrg, handleOrgSelect, syncOrgs]
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

/**
 * Hook to access organization context
 * @returns {OrganizationContextValue}
 * @throws {Error} If used outside OrganizationProvider
 */
export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (!context) {
    throw new Error('useOrganization must be used within OrganizationProvider')
  }
  return context
}
