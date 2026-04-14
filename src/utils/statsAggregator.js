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
    health: () => data.stats?.healthAnalyzed > 0 || data.repos?.length > 0,
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
