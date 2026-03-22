/**
 * Utility functions for aggregating statistics across repositories, organizations, and teams
 */

/**
 * Calculate if a category should be shown based on data availability
 */
export function shouldShowCategory(categoryKey, data) {
  const checks = {
    pullRequests: () => data.repos?.some(r => r.has_issues) || data.stats?.totalPRs > 0,
    issues: () => data.repos?.some(r => r.has_issues) || data.stats?.totalIssues > 0,
    actions: () => data.stats?.hasActions || data.repos?.some(r => r.has_workflows),
    health: () => data.stats?.healthAnalyzed > 0,
    teams: () => data.teams?.length > 0,
    organizations: () => data.orgs?.length > 1
  }

  return checks[categoryKey] ? checks[categoryKey]() : false
}

/**
 * Aggregate repository statistics
 */
export function aggregateRepoStats(repos = []) {
  if (!Array.isArray(repos) || repos.length === 0) {
    return {
      total: 0,
      public: 0,
      private: 0,
      forks: 0,
      sources: 0,
      archived: 0,
      totalStars: 0,
      totalForks: 0,
      totalWatchers: 0
    }
  }

  return repos.reduce((acc, repo) => {
    acc.total++
    if (repo.private) acc.private++
    else acc.public++
    if (repo.fork) acc.forks++
    else acc.sources++
    if (repo.archived) acc.archived++
    acc.totalStars += repo.stargazers_count || 0
    acc.totalForks += repo.forks_count || 0
    acc.totalWatchers += repo.watchers_count || 0
    return acc
  }, {
    total: 0,
    public: 0,
    private: 0,
    forks: 0,
    sources: 0,
    archived: 0,
    totalStars: 0,
    totalForks: 0,
    totalWatchers: 0
  })
}

/**
 * Aggregate language distribution
 */
export function aggregateLanguages(repos = []) {
  if (!Array.isArray(repos) || repos.length === 0) return []

  const langCount = {}
  repos.forEach(repo => {
    if (repo.language) {
      langCount[repo.language] = (langCount[repo.language] || 0) + 1
    }
  })

  return Object.entries(langCount)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Calculate trend indicator (up, down, stable)
 */
export function calculateTrend(current, previous) {
  if (current == null || !previous || previous === 0) return { direction: 'stable', percentage: 0 }

  const percentage = ((current - previous) / previous) * 100

  if (percentage > 5) return { direction: 'up', percentage: Math.round(percentage) }
  if (percentage < -5) return { direction: 'down', percentage: Math.round(Math.abs(percentage)) }
  return { direction: 'stable', percentage: 0 }
}

/**
 * Group repositories by update time buckets
 */
export function groupByUpdateTime(repos = []) {
  const now = new Date()
  const buckets = {
    today: [],
    thisWeek: [],
    thisMonth: [],
    older: []
  }

  repos.forEach(repo => {
    if (!repo.updated_at) {
      buckets.older.push(repo)
      return
    }

    const updated = new Date(repo.updated_at)
    const daysDiff = Math.floor((now - updated) / (1000 * 60 * 60 * 24))

    if (daysDiff === 0) buckets.today.push(repo)
    else if (daysDiff <= 7) buckets.thisWeek.push(repo)
    else if (daysDiff <= 30) buckets.thisMonth.push(repo)
    else buckets.older.push(repo)
  })

  return buckets
}

/**
 * Get top repositories by criteria
 */
export function getTopRepos(repos = [], criteria = 'stars', limit = 5) {
  if (!Array.isArray(repos) || repos.length === 0) return []

  const sortFunctions = {
    stars: (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
    forks: (a, b) => (b.forks_count || 0) - (a.forks_count || 0),
    updated: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
    watchers: (a, b) => (b.watchers_count || 0) - (a.watchers_count || 0)
  }

  return [...repos]
    .sort(sortFunctions[criteria] || sortFunctions.stars)
    .slice(0, limit)
}

/**
 * Calculate activity metrics from activity events
 */
export function calculateActivityMetrics(activity = [], days = 7) {
  if (!Array.isArray(activity) || activity.length === 0) {
    return {
      commits: 0,
      prs: 0,
      issues: 0,
      totalEvents: 0
    }
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)

  return activity
    .filter(event => new Date(event.created_at) >= cutoff)
    .reduce((acc, event) => {
      acc.totalEvents++
      if (event.type === 'PushEvent') {
        acc.commits += event.payload?.commits?.length || 1
      } else if (event.type === 'PullRequestEvent') {
        acc.prs++
      } else if (event.type === 'IssuesEvent') {
        acc.issues++
      }
      return acc
    }, { commits: 0, prs: 0, issues: 0, totalEvents: 0 })
}
