import { useEffect, useMemo, useCallback, useState } from 'react'
import { useRepoDetail } from '../../hooks/useRepoDetail'
import { useReviewState } from './hooks/useReviewState'
import { useReviewData } from './hooks/useReviewData'
import { useReviewAI, heuristicRisk, sortFilesByRisk } from './hooks/useReviewAI'
import { useReviewKeyboard } from './hooks/useReviewKeyboard'
import { useToast } from '../../hooks/useToast'
import { Spinner } from '../ui/Spinner'
import { usePRData } from '../../hooks/usePRData'

import { FileTree } from './FileTree/FileTree'
import { DiffPanel } from './DiffPanel/DiffPanel'
import { ReviewToolbar } from './ReviewToolbar/ReviewToolbar'
import { ReviewStatusBar } from './ReviewToolbar/ReviewStatusBar'
import { AISummaryPanel } from './AIInsights/AISummaryPanel'
import { AIReviewPanel } from './AIDeepReview/AIReviewPanel'
import { useAIDeepReview } from '../../hooks/useAIDeepReview'
import { ConfirmModal } from '../ui/ConfirmModal'
import { PublishReviewModal } from './AIDeepReview/PublishReviewModal'

export function PRReviewView({ owner, repo, pullNumber, repoName, onBack }) {
  const api = useRepoDetail(owner, repo)
  const { state, dispatch } = useReviewState(owner, repo, pullNumber)

  const {
    loading,
    error,
    data,
    refetch,
    checkStaleness,
    submitReview,
    replyToComment,
  } = useReviewData(owner, repo, pullNumber, api)

  const {
    summary: aiSummary,
    loading: aiLoading,
    error: aiError,
    retry: retryAI,
  } = useReviewAI(
    owner,
    repo,
    pullNumber,
    state.headSha,
    state.files
  )

  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [sortMode, setSortMode] = useState('risk')

  // AI Deep Review (Slice 1a) — generates a structured walkthrough + line
  // comments draft that the user can edit and publish to GitHub as a single
  // review. Lives alongside the existing AISummaryPanel for now; the legacy
  // panel may be retired in a follow-up once the new flow is fully wired.
  const deep = useAIDeepReview(owner, repo, pullNumber)
  const [publishing, setPublishing] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)

  // Stamp original indices on the AI comments we hand to DiffPanel so child
  // callbacks can map back to the canonical position before dismissing/editing.
  const stampedAIComments = useMemo(
    () => (deep.draft?.lineComments || []).map((c, _idx) => ({ ...c, _idx })),
    [deep.draft]
  )
  // State-driven confirm flow (replaces blocking window.confirm) so the PR
  // review surface stays keyboard-accessible and the rest of the app can
  // remain interactive while the prompt is shown.
  const [pendingSubmit, setPendingSubmit] = useState(null)

  // Read from shared usePRData cache — if user came from PRFilesTab, data is
  // already loaded and we can skip the loading spinner entirely.
  const { detail: cachedPR, files: cachedFiles } = usePRData(api, {
    owner,
    repo,
    number: pullNumber,
    enabled: false,
  })

  // Pre-populate from cache for instant open (no spinner when cache is warm)
  useEffect(() => {
    if (cachedPR && cachedFiles?.length && !state.pr) {
      dispatch({
        type: 'LOAD_DATA',
        payload: {
          pr: cachedPR,
          headSha: cachedPR.head?.sha ?? null,
          files: cachedFiles,
          comments: {},
        },
      })
    }
  }, [cachedPR, cachedFiles, state.pr, dispatch])

  // Load PR data into state when real fetch arrives — always dispatch so that
  // inline comments and fresh state overwrite cached snapshot.
  useEffect(() => {
    if (data) {
      dispatch({
        type: 'LOAD_DATA',
        payload: {
          pr: data.pr,
          headSha: data.headSha,
          files: data.files,
          comments: data.comments,
        },
      })
    }
  }, [data, dispatch])

  // Trigger initial data fetch on mount
  useEffect(() => {
    refetch()
  }, [refetch])

  // Dispatch AI summary when it arrives
  useEffect(() => {
    if (aiSummary && !state.aiSummary) {
      dispatch({ type: 'SET_AI_SUMMARY', summary: aiSummary })
    }
  }, [aiSummary, state.aiSummary, dispatch])

  // Memoized sorted files (by risk, used as base for navigation)
  const sortedFiles = useMemo(() => {
    if (!state.files?.length) return []
    const RISK_SCORES = { critical: 10, high: 8, medium: 6, low: 4 }
    const aiFileRisks = state.aiSummary?.fileRisks
      ? Object.fromEntries(
          state.aiSummary.fileRisks.map((r) => [
            r.filename ?? r.file,
            r.score ?? r.riskScore ?? RISK_SCORES[r.risk] ?? 0,
          ])
        )
      : {}
    return sortFilesByRisk(state.files, aiFileRisks)
  }, [state.files, state.aiSummary])

  // Display files reflect the active sort mode
  const displayFiles = useMemo(() => {
    if (sortMode === 'alpha') {
      return [...(state.files ?? [])].sort((a, b) => a.filename.localeCompare(b.filename))
    }
    return sortedFiles
  }, [state.files, sortedFiles, sortMode])

  // Memoized heuristic scores map
  const heuristicScores = useMemo(() => {
    const map = {}
    for (const file of state.files ?? []) {
      map[file.filename] = heuristicRisk(file)
    }
    return map
  }, [state.files])

  // Active file object
  const activeFileObj = useMemo(
    () => state.files?.find((f) => f.filename === state.activeFile) ?? null,
    [state.files, state.activeFile]
  )

  // Navigation helpers (use displayFiles so j/k follow the visible order)
  const handleNextFile = useCallback(() => {
    if (!displayFiles.length) return
    const idx = displayFiles.findIndex((f) => f.filename === state.activeFile)
    const next = displayFiles[Math.min(idx + 1, displayFiles.length - 1)]
    if (next) dispatch({ type: 'SET_ACTIVE_FILE', filename: next.filename })
  }, [displayFiles, state.activeFile, dispatch])

  const handlePrevFile = useCallback(() => {
    if (!displayFiles.length) return
    const idx = displayFiles.findIndex((f) => f.filename === state.activeFile)
    const prev = displayFiles[Math.max(idx - 1, 0)]
    if (prev) dispatch({ type: 'SET_ACTIVE_FILE', filename: prev.filename })
  }, [displayFiles, state.activeFile, dispatch])

  // Actually submit — shared by the normal path and the post-confirm path.
  const doSubmit = useCallback(async ({ event, body }) => {
    setSubmitting(true)
    try {
      await submitReview({
        event,
        body: body || '',
        commitId: state.headSha,
        comments: state.pendingComments,
      })
      dispatch({ type: 'CLEAR_PENDING_COMMENTS' })
    } catch (e) {
      toast.errorFromException(e, { fallbackTitle: 'Failed to submit review' })
    } finally {
      setSubmitting(false)
    }
  }, [submitReview, state.pendingComments, state.headSha, dispatch, toast])

  // Submit review with staleness check
  const handleSubmitReview = useCallback(async (args) => {
    const { event = 'COMMENT', body = '' } = args ?? {}
    setSubmitting(true)
    try {
      const { isStale } = await checkStaleness()
      if (isStale) {
        // Queue a confirmation modal and unblock the submit handler — the
        // modal's onConfirm / onClose then decides whether to continue.
        setSubmitting(false)
        setPendingSubmit({ event, body })
        return
      }
    } catch (e) {
      setSubmitting(false)
      toast.errorFromException(e, { fallbackTitle: 'Failed to check PR staleness' })
      return
    }
    await doSubmit({ event, body })
  }, [checkStaleness, doSubmit, toast])

  // Keyboard shortcuts
  useReviewKeyboard({
    files: displayFiles,
    activeFile: state.activeFile,
    onNextFile: handleNextFile,
    onPrevFile: handlePrevFile,
    onToggleReviewed: (filename) =>
      filename && dispatch({ type: 'TOGGLE_REVIEWED', filename }),
    onEscape: () => onBack?.(),
    onSubmitReview: handleSubmitReview,
    enabled: true,
  })

  // Loading state
  if (loading && !state.pr) {
    return (
      <div className="flex items-center justify-center h-full min-h-0 flex-1 bg-white dark:bg-gray-950">
        <div className="text-center">
          <Spinner size="xl" tone="primary" label="Loading pull request" className="mx-auto mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm">Loading pull request...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !state.pr) {
    return (
      <div className="flex items-center justify-center h-full min-h-0 flex-1 bg-white dark:bg-gray-950">
        <div className="text-center space-y-3">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          <button
            onClick={() => onBack?.()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-950">
      <ReviewToolbar
        pr={state.pr}
        repoName={repoName}
        repoFullName={`${owner}/${repo}`}
        viewMode={state.viewMode}
        onToggleViewMode={() => dispatch({ type: 'TOGGLE_VIEW_MODE' })}
        onBack={onBack}
        onSubmitReview={handleSubmitReview}
        pendingCount={state.pendingComments.length}
        // Treat the staleness confirm as an in-flight submit too, otherwise
        // the user could re-open the event menu and re-submit while the modal
        // is open, overwriting pendingSubmit's event/body pair.
        submitting={submitting || pendingSubmit !== null}
      />

      <div className="flex flex-1 min-h-0">
        {!state.fileTreeCollapsed && (
          <div className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
            <FileTree
              files={displayFiles}
              activeFile={state.activeFile}
              reviewedFiles={state.reviewedFiles}
              aiFileRisks={state.aiSummary?.fileRisks}
              heuristicScores={heuristicScores}
              onFileSelect={(filename) =>
                dispatch({ type: 'SET_ACTIVE_FILE', filename })
              }
              sortMode={sortMode === 'alpha' ? 'az' : 'risk'}
              onSortChange={(mode) => setSortMode(mode === 'az' ? 'alpha' : 'risk')}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <AISummaryPanel
            summary={state.aiSummary}
            loading={aiLoading}
            error={aiError}
            collapsed={state.aiSummaryCollapsed}
            onToggle={() => dispatch({ type: 'TOGGLE_AI_SUMMARY' })}
            onRetry={retryAI}
            onFileClick={(filename) =>
              dispatch({ type: 'SET_ACTIVE_FILE', filename })
            }
          />

          <DiffPanel
            file={activeFileObj}
            viewMode={state.viewMode}
            comments={state.comments[state.activeFile] ?? []}
            pendingComments={state.pendingComments.filter(
              (c) => c.path === state.activeFile
            )}
            resolvedComments={state.resolvedComments}
            onAddComment={(comment) =>
              dispatch({ type: 'ADD_PENDING_COMMENT', comment })
            }
            onReply={replyToComment}
            onResolve={(commentId) =>
              dispatch({ type: 'TOGGLE_RESOLVED', commentId })
            }
            aiComments={stampedAIComments.filter((c) => c.path === state.activeFile)}
            onDismissAIComment={(idx) => deep.dismiss(idx)}
            onEditAIComment={(idx, payload) => deep.edit(idx, payload)}
          />
        </div>

        {/* Third column: AI Deep Review panel (walkthrough + comments draft +
            Publish to GitHub). Sits alongside the existing AISummaryPanel which
            stays in the centre column for now — duplication flagged for
            follow-up cleanup once Slice 1b lands. */}
        <div className="w-80 shrink-0 hidden lg:flex flex-col min-h-0">
          <AIReviewPanel
            draft={deep.draft}
            loading={deep.loading}
            error={deep.error}
            onGenerate={deep.generate}
            onPublish={() => setPublishOpen(true)}
            onJumpToFile={(filename) => dispatch({ type: 'SET_ACTIVE_FILE', filename })}
            onDismissComment={(idx) => deep.dismiss(idx)}
            onEditComment={(idx, payload) => deep.edit(idx, payload)}
            publishing={publishing}
          />
        </div>
      </div>

      <ReviewStatusBar
        totalFiles={state.files?.length ?? 0}
        reviewedCount={state.reviewedFiles.length}
        pendingCommentCount={state.pendingComments.length}
      />

      <PublishReviewModal
        isOpen={publishOpen}
        onClose={() => setPublishOpen(false)}
        draft={deep.draft}
        onPublish={async (event) => {
          setPublishing(true)
          try {
            const out = await deep.publish(event)
            if (out.demoOnly) {
              toast.success?.({
                title: 'Demo: review not published',
                message: out.message,
              })
            } else if (out.queued) {
              toast.success?.({
                title: 'Review queued for publishing',
                message: 'GitHub will receive the review momentarily.',
              })
            } else {
              toast.success?.({
                title: 'Review published to GitHub',
                message: out.githubReviewId ? `Review #${out.githubReviewId}` : undefined,
              })
            }
            setPublishOpen(false)
          } catch (err) {
            toast.errorFromException?.(err, { fallbackTitle: 'Failed to publish review' })
          } finally {
            setPublishing(false)
          }
        }}
        publishing={publishing}
      />

      <ConfirmModal
        isOpen={pendingSubmit !== null}
        onClose={() => setPendingSubmit(null)}
        onConfirm={async () => {
          const queued = pendingSubmit
          setPendingSubmit(null)
          if (queued) await doSubmit(queued)
        }}
        title="PR updated since you started"
        message="This PR has been updated since you opened it. Submitting now will post your review against the current head — earlier line-level comments may reference stale lines. Do you still want to submit?"
        confirmText="Submit review"
        cancelText="Cancel"
        variant="warning"
        isLoading={submitting}
      />
    </div>
  )
}
