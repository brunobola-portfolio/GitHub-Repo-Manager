import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Loader2, AlertCircle, AlertTriangle, FolderGit2 } from 'lucide-react'
import { Spinner } from '../../ui/Spinner'
import { useEnrichedRepos } from './RepoSelectStep/useEnrichedRepos'
import { useRiskEngine } from './RepoSelectStep/useRiskEngine'
import { SelectionDashboard } from './RepoSelectStep/SelectionDashboard'
import { QuickFilters } from './RepoSelectStep/QuickFilters'
import { SearchAndSort } from './RepoSelectStep/SearchAndSort'
import { BulkActions } from './RepoSelectStep/BulkActions'
import { RepoList } from './RepoSelectStep/RepoList'
import { RepoDetailPanel } from './RepoSelectStep/RepoDetailPanel'
import { SelectionSummaryBar } from './RepoSelectStep/SelectionSummaryBar'
import { AutoFixDrawer } from './RepoSelectStep/AutoFixDrawer.jsx'
import { SkeletonRow } from '../ui/repo/SkeletonRow'
import { ShortcutsOverlay } from './RepoSelectStep/ShortcutsOverlay'

const FILTER_PREDICATES = {
  'recommended': (r) => r.risk?.level === 'ok' && !r.isDisabled,
  'at-risk':     (r) => r.risk?.level === 'warning',
  'blocked':     (r) => r.risk?.level === 'blocker',
  'stale':       (r) => (r.risk?.flags || []).some((f) => f.type === 'stale'),
  'archived':    (r) => r.isDisabled,
  'large':       (r) => r.size > 1024 * 1024 * 1024,
  'tfvc':        (r) => r.isTfvc,
  'conflicts':   (r) => r.risk?.flags?.some((f) => f.type === 'name-conflict'),
}

export default function RepoSelectStep({ repos, onSetRepos, onUpdateRepo, source, onChange }) {
  const targetOrg = source.targetOrg || ''
  const { loading, error, tfvcWarning, enriching, conflicts, conflictDetails, retry } = useEnrichedRepos({
    source, repos, onSetRepos, onChange, targetOrg,
  })

  const { repos: scored, aggregate, aggregateSelected } =
    useRiskEngine(repos, conflicts, targetOrg || source.org, conflictDetails)

  // Propagate risk back to wizard state only when changed. The JSON.stringify
  // deep comparison is the loop guard — when risk shapes match, no setState
  // fires, so including `repos` and `onSetRepos` in deps is safe.
  useEffect(() => {
    if (scored.length === 0) return
    const needsUpdate = scored.some((r, i) => JSON.stringify(r.risk) !== JSON.stringify(repos[i]?.risk))
    if (needsUpdate) onSetRepos(scored)
  }, [scored, repos, onSetRepos])

  // Local UI state
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('repoSelect:viewMode') || 'list')
  const [activeFilters, setActiveFilters] = useState(() => {
    try {
      const raw = sessionStorage.getItem('repoSelect:filters')
      return raw ? new Set(JSON.parse(raw)) : new Set()
    } catch { return new Set() }
  })
  const [activeDetailId, setActiveDetailId] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [aiAvailable, setAiAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/config/ai-status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { configured: false }))
      .then((d) => { if (!cancelled) setAiAvailable(!!d?.configured) })
      .catch(() => { if (!cancelled) setAiAvailable(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { localStorage.setItem('repoSelect:viewMode', viewMode) }, [viewMode])
  useEffect(() => { sessionStorage.setItem('repoSelect:filters', JSON.stringify([...activeFilters])) }, [activeFilters])

  const toggleFilter = useCallback((id) => {
    if (id === null) { setActiveFilters(new Set()); return }
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const filtered = useMemo(() => {
    let out = scored
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      out = out.filter((r) => r.name.toLowerCase().includes(q) || (r.language || '').toLowerCase().includes(q))
    }
    if (activeFilters.size > 0) {
      out = out.filter((r) => [...activeFilters].some((id) => FILTER_PREDICATES[id]?.(r)))
    }
    return out
  }, [scored, searchQuery, activeFilters])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    const sev = { blocker: 0, warning: 1, info: 2, ok: 3 }
    switch (sortBy) {
      case 'name':     copy.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'size':     copy.sort((a, b) => b.size - a.size); break
      case 'activity': copy.sort((a, b) => (new Date(b.lastCommitDate || 0)) - (new Date(a.lastCommitDate || 0))); break
      case 'risk':     copy.sort((a, b) => (sev[a.risk?.level] ?? 3) - (sev[b.risk?.level] ?? 3)); break
    }
    return copy
  }, [filtered, sortBy])

  const selectedIds = useMemo(() => new Set(scored.filter((r) => r.selected).map((r) => r.id)), [scored])
  const staleCount = useMemo(() => scored.filter(FILTER_PREDICATES.stale).length, [scored])

  const selectedWithBlockers = scored.filter((r) => r.selected && r.risk?.level === 'blocker')
  const manualFixCount = selectedWithBlockers.filter((r) =>
    (r.risk?.flags || []).some((f) => f.type === 'size-critical')
  ).length
  const autoFixCount = Math.max(0, selectedWithBlockers.length - manualFixCount)

  const toggleRepo = useCallback((id) => {
    onSetRepos(repos.map((r) => r.id === id ? { ...r, selected: !r.selected } : r))
  }, [repos, onSetRepos])

  const handleSmartSelect = useCallback((idSet, mode) => {
    onSetRepos(repos.map((r) => ({
      ...r,
      selected: mode === 'exclude' ? (r.selected && idSet.has(r.id)) : idSet.has(r.id),
    })))
  }, [repos, onSetRepos])

  const selectAll = useCallback(() => {
    const visible = new Set(sorted.map((r) => r.id))
    onSetRepos(repos.map((r) => r.isDisabled || !visible.has(r.id) ? r : { ...r, selected: true }))
  }, [repos, sorted, onSetRepos])

  const deselectAll = useCallback(() => {
    onSetRepos(repos.map((r) => ({ ...r, selected: false })))
  }, [repos, onSetRepos])

  const invertSelection = useCallback(() => {
    onSetRepos(repos.map((r) => r.isDisabled ? r : { ...r, selected: !r.selected }))
  }, [repos, onSetRepos])

  const handleFixIssues = useCallback(() => {
    setDrawerOpen(true)
  }, [])

  const handleApplyFixes = useCallback((changes) => {
    changes.forEach(({ repoIndex, patch }) => {
      onUpdateRepo(repoIndex, patch)
    })
    setDrawerOpen(false)
  }, [onUpdateRepo])

  // Keyboard shortcuts — scoped to the step's container to avoid
  // stealing browser-native Ctrl+A from other parts of the page.
  const containerRef = useRef(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === '/') { e.preventDefault(); el.querySelector('input[aria-label="Search repositories"]')?.focus(); return }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); invertSelection(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (e.shiftKey) deselectAll(); else selectAll()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [invertSelection, selectAll, deselectAll])

  const activeRepo = scored.find((r) => r.id === activeDetailId) || null

  // Render
  if (loading) {
    return (
      <div className="space-y-3">
        <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
          <AlertCircle className="w-6 h-6 text-red-500" />
        </div>
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
        <button onClick={retry} className="text-sm text-indigo-500 hover:text-indigo-400 underline">Try again</button>
      </div>
    )
  }
  if (!loading && scored.length === 0) {
    return (
      <div className="text-center py-12">
        <FolderGit2 className="w-10 h-10 text-slate-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No repositories found in this project.</p>
      </div>
    )
  }

  const isTfvc = source.versionControlType === 'Tfvc' || scored.some((r) => r.isTfvc)

  return (
    <div ref={containerRef} className="space-y-4" tabIndex={-1}>
      <SelectionDashboard
        repos={scored}
        aggregate={aggregate}
        staleCount={staleCount}
        onSmartSelect={handleSmartSelect}
        onReset={deselectAll}
      />

      {isTfvc && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded-xl text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          This project uses TFVC. Each folder will be converted to a Git repository and pushed to GitHub.
        </div>
      )}
      {tfvcWarning && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/30 rounded-xl text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" />
          {tfvcWarning}
        </div>
      )}

      <QuickFilters repos={scored} active={activeFilters} onToggle={toggleFilter} />

      <SearchAndSort
        query={searchQuery} onQuery={setSearchQuery}
        sortBy={sortBy} onSort={setSortBy}
        viewMode={viewMode} onViewMode={setViewMode}
      />

      <BulkActions
        selectedCount={selectedIds.size}
        filteredCount={sorted.length}
        totalCount={scored.length}
        hasActiveFilter={activeFilters.size > 0 || searchQuery.length > 0}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
        onInvert={invertSelection}
      />

      {enriching && (
        <p className="text-[11px] text-slate-500">
          <Spinner size="xs" className="inline mr-1" /> Loading activity & LFS signals…
        </p>
      )}

      <RepoList
        repos={sorted}
        selectedIds={selectedIds}
        activeId={activeDetailId}
        density={viewMode === 'compact' ? 'compact' : 'full'}
        onToggle={toggleRepo}
        onOpenDetail={(id) => setActiveDetailId(id)}
      />

      <SelectionSummaryBar
        selected={scored.filter((r) => r.selected)}
        warnings={aggregateSelected.warnings}
        blockers={aggregateSelected.blockers}
        autoFixCount={autoFixCount}
        manualFixCount={manualFixCount}
        onFixIssues={handleFixIssues}
      />

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <AutoFixDrawer
        open={drawerOpen}
        repos={scored}
        allRepos={repos}
        targetOrg={targetOrg}
        azureProject={source?.project}
        conflicts={conflicts}
        aiAvailable={aiAvailable}
        onClose={() => setDrawerOpen(false)}
        onApply={handleApplyFixes}
      />

      {activeRepo && (
        <RepoDetailPanel
          repo={activeRepo}
          source={source}
          onClose={() => setActiveDetailId(null)}
          onPrev={() => {
            const idx = scored.findIndex((r) => r.id === activeDetailId)
            if (idx > 0) setActiveDetailId(scored[idx - 1].id)
          }}
          onNext={() => {
            const idx = scored.findIndex((r) => r.id === activeDetailId)
            if (idx < scored.length - 1) setActiveDetailId(scored[idx + 1].id)
          }}
          onRiskAction={() => { /* Configure step owns rename */ }}
        />
      )}
    </div>
  )
}
