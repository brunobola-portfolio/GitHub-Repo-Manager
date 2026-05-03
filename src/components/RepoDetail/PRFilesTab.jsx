import { useState, useMemo } from 'react'
import { Columns2, AlignLeft, PanelRightClose, PanelRightOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { FileTree } from '../PRReview/FileTree/FileTree'
import { DiffRenderer } from '../PRReview/DiffPanel/DiffRenderer'
import { AISummaryPanel } from '../PRReview/AIInsights/AISummaryPanel'
import { useReviewAI, sortFilesByRisk } from '../PRReview/hooks/useReviewAI'
import { Spinner } from '../ui/Spinner'
import { MOCK_MODE } from '../../config'

/**
 * PRFilesTab — premium 3-column code review surface.
 *
 * Left:   FileTree (navigation, progress tracking)
 * Centre: DiffRenderer (syntax-highlighted diff of active file)
 * Right:  AISummaryPanel (PR-level AI analysis, collapsible)
 */
export function PRFilesTab({ files = [], owner, repo, pr }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [reviewed, setReviewed] = useState(() => new Set())
  const [diffMode, setDiffMode] = useState('unified')
  const [aiCollapsed, setAiCollapsed] = useState(false)
  const [treeCollapsed, setTreeCollapsed] = useState(false)

  // Suppress AI fetch in mock mode — useReviewAI skips when headSha is empty
  const headSha = MOCK_MODE ? '' : (pr?.head?.sha ?? '')
  const prNumber = pr?.number ?? 0

  const sortedFiles = useMemo(() => sortFilesByRisk(files, {}), [files])

  const {
    summary: aiSummary,
    loading: aiLoading,
    error: aiError,
    retry: retryAI,
  } = useReviewAI(owner, repo, prNumber, headSha, files)

  const activeFile = sortedFiles[activeIndex] ?? null

  function toggleReviewed(filename) {
    setReviewed(prev => {
      const next = new Set(prev)
      next.has(filename) ? next.delete(filename) : next.add(filename)
      return next
    })
  }

  function handleFileSelect(filename) {
    const idx = sortedFiles.findIndex(f => f.filename === filename)
    if (idx !== -1) setActiveIndex(idx)
  }

  function handlePrev() {
    setActiveIndex(i => Math.max(0, i - 1))
  }
  function handleNext() {
    setActiveIndex(i => Math.min(sortedFiles.length - 1, i + 1))
  }

  if (!files.length) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-slate-500 dark:text-slate-400">
        No files changed in this PR.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <button
            onClick={() => setTreeCollapsed(c => !c)}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
          >
            {treeCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
          <span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{files.length}</span> files changed
            {' · '}
            <span className="text-green-600 dark:text-green-400">
              +{files.reduce((s, f) => s + (f.additions || 0), 0)}
            </span>
            {' '}
            <span className="text-red-600 dark:text-red-400">
              −{files.reduce((s, f) => s + (f.deletions || 0), 0)}
            </span>
          </span>
          <span className="text-slate-400">·</span>
          <span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">{reviewed.size}</span>/{files.length} reviewed
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Prev / Next file */}
          <button
            onClick={handlePrev}
            disabled={activeIndex === 0}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            aria-label="Previous file"
          >
            <ChevronLeft className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400 w-14 text-center tabular-nums">
            {activeIndex + 1} / {sortedFiles.length}
          </span>
          <button
            onClick={handleNext}
            disabled={activeIndex === sortedFiles.length - 1}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            aria-label="Next file"
          >
            <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

          {/* Diff mode toggle */}
          <button
            onClick={() => setDiffMode(m => m === 'unified' ? 'split' : 'unified')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
          >
            {diffMode === 'unified'
              ? <><Columns2 className="w-3.5 h-3.5" /> Split</>
              : <><AlignLeft className="w-3.5 h-3.5" /> Unified</>
            }
          </button>

          {/* AI sidebar toggle */}
          <button
            onClick={() => setAiCollapsed(c => !c)}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            aria-label={aiCollapsed ? 'Show AI insights' : 'Hide AI insights'}
          >
            {aiCollapsed
              ? <PanelRightOpen className="w-3.5 h-3.5" />
              : <PanelRightClose className="w-3.5 h-3.5" />
            }
          </button>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: File Tree */}
        {!treeCollapsed && (
          <div className="w-[220px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20">
            <FileTree
              files={sortedFiles}
              activeFile={activeFile?.filename ?? ''}
              reviewedFiles={[...reviewed]}
              aiFileRisks={aiSummary?.fileRisks ?? []}
              onFileSelect={handleFileSelect}
            />
            {activeFile && (
              <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reviewed.has(activeFile.filename)}
                    onChange={() => toggleReviewed(activeFile.filename)}
                    className="rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                  />
                  Mark as reviewed
                </label>
              </div>
            )}
          </div>
        )}

        {/* Centre: Diff */}
        <div className="flex-1 min-w-0 overflow-auto">
          {activeFile ? (
            <div className="min-w-0">
              {/* Sticky file header */}
              <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-100 dark:border-slate-800 text-xs">
                <span className="font-mono text-slate-700 dark:text-slate-200 font-medium truncate">
                  {activeFile.filename}
                </span>
                <span className="flex-shrink-0 text-green-600 dark:text-green-400">+{activeFile.additions}</span>
                <span className="flex-shrink-0 text-red-600 dark:text-red-400">−{activeFile.deletions}</span>
              </div>
              {activeFile.patch ? (
                <DiffRenderer
                  filename={activeFile.filename}
                  patch={activeFile.patch}
                  viewMode={diffMode}
                />
              ) : (
                <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                  No diff available for this file (binary or too large).
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <Spinner size="md" />
            </div>
          )}
        </div>

        {/* Right: AI Insights */}
        {!aiCollapsed && (
          <div className="w-[280px] flex-shrink-0 border-l border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50/40 dark:bg-slate-800/20 p-3">
            {MOCK_MODE && !aiSummary && !aiLoading ? (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
                <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">AI Insights</p>
                <p>AI analysis not available in demo mode. Configure a provider in Settings → AI Configuration.</p>
              </div>
            ) : (
              <AISummaryPanel
                summary={aiSummary}
                loading={aiLoading}
                error={aiError}
                collapsed={false}
                onToggle={() => {}}
                onRetry={retryAI}
                onFileClick={handleFileSelect}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
