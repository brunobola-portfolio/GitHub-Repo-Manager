import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { useRepoDetail } from '../../hooks/useRepoDetail'
import { useReviewState } from './hooks/useReviewState'
import { useReviewData } from './hooks/useReviewData'
import { useReviewAI, heuristicRisk, sortFilesByRisk } from './hooks/useReviewAI'
import { useReviewKeyboard } from './hooks/useReviewKeyboard'
import { useToast } from '../../hooks/useToast'
import { Spinner } from '../ui/Spinner'
import { usePRData } from '../../hooks/usePRData'

import { Sparkles } from 'lucide-react'
import { FileTree } from './FileTree/FileTree'
import { DiffPanel } from './DiffPanel/DiffPanel'
import { ReviewToolbar } from './ReviewToolbar/ReviewToolbar'
import { ReviewStatusBar } from './ReviewToolbar/ReviewStatusBar'
import { AISummaryPanel } from './AIInsights/AISummaryPanel'
import { AIReviewPanel } from './AIDeepReview/AIReviewPanel'
import { MobileAIPanelDrawer } from './MobileAIPanelDrawer'
import { KeyboardHelpOverlay } from './KeyboardHelpOverlay'
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

  // Deep AI Review is the richer surface; we only spend the heuristic
  // useReviewAI tokens when deep doesn't already cover the screen
  // (cleanup of #3 from the 2026-05-09 follow-ups review). The hook
  // still runs when deep is loading / hasn't been generated, so the
  // user gets the lightweight summary as a placeholder.
  const deep = useAIDeepReview(owner, repo, pullNumber)
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
    state.files,
    { enabled: !deep.draft && !deep.loading }
  )

  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [sortMode, setSortMode] = useState('risk')

  // AI Deep Review (declared earlier alongside useReviewAI so the latter
  // can be gated on deep.draft / deep.loading). Generates a structured
  // walkthrough + line-comment draft that the user can edit and publish
  // to GitHub as a single review.
  const [publishing, setPublishing] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  // Mobile/tablet drawer state for the AI Deep Review panel — replaces
  // the previous `hidden lg:flex` behaviour that hid AI affordances
  // entirely below lg.
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const aiFabRef = useRef(null)  // restore focus to FAB when drawer closes
  // Keyboard help overlay — toggled by `?`.
  const [helpOpen, setHelpOpen] = useState(false)
  // True while the floating composer in DiffPanel is open. We hide the
  // FAB during composing to avoid the documented overlap collision
  // (FAB rounded corner pokes through composer's rounded corner) — see
  // mobile-UX review 2026-05-09. DiffPanel emits these events on the
  // composer's mount/unmount lifecycle.
  const [composerOpen, setComposerOpen] = useState(false)
  useEffect(() => {
    const onOpen = () => setComposerOpen(true)
    const onClose = () => setComposerOpen(false)
    window.addEventListener('pr-review:composer-open', onOpen)
    window.addEventListener('pr-review:composer-close', onClose)
    return () => {
      window.removeEventListener('pr-review:composer-open', onOpen)
      window.removeEventListener('pr-review:composer-close', onClose)
    }
  }, [])

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

  // Announce the surface to the global CommandPalette so PR-scoped
  // commands (Approve, Request changes, Mark viewed, ...) appear in
  // cmd+k while the user is here. Loose coupling via window events.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pr-review:focused'))
    return () => window.dispatchEvent(new CustomEvent('pr-review:blurred'))
  }, [])

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
    onShowHelp: () => setHelpOpen(true),
    enabled: true,
  })

  // Listen for CommandPalette events and route them to the surface's
  // handlers. Lives below handleSubmitReview to avoid a TDZ on the
  // useCallback. PR-scoped command items are emitted by the palette.
  useEffect(() => {
    const onToggleReviewed = () => {
      if (state.activeFile) dispatch({ type: 'TOGGLE_REVIEWED', filename: state.activeFile })
    }
    const onApprove = () => handleSubmitReview({ event: 'APPROVE' })
    const onRequestChanges = () => handleSubmitReview({ event: 'REQUEST_CHANGES' })
    const onComment = () => handleSubmitReview({ event: 'COMMENT' })
    const onToggleTree = () => dispatch({ type: 'TOGGLE_FILE_TREE' })
    const onShowHelp = () => setHelpOpen(true)

    window.addEventListener('pr-review:toggle-reviewed', onToggleReviewed)
    window.addEventListener('pr-review:approve', onApprove)
    window.addEventListener('pr-review:request-changes', onRequestChanges)
    window.addEventListener('pr-review:comment', onComment)
    window.addEventListener('pr-review:toggle-tree', onToggleTree)
    window.addEventListener('pr-review:show-help', onShowHelp)
    return () => {
      window.removeEventListener('pr-review:toggle-reviewed', onToggleReviewed)
      window.removeEventListener('pr-review:approve', onApprove)
      window.removeEventListener('pr-review:request-changes', onRequestChanges)
      window.removeEventListener('pr-review:comment', onComment)
      window.removeEventListener('pr-review:toggle-tree', onToggleTree)
      window.removeEventListener('pr-review:show-help', onShowHelp)
    }
  }, [state.activeFile, handleSubmitReview, dispatch])

  // Loading state
  if (loading && !state.pr) {
    return (
      <div className="flex items-center justify-center h-full min-h-0 flex-1 bg-white dark:bg-slate-950">
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
      <div className="flex items-center justify-center h-full min-h-0 flex-1 bg-white dark:bg-slate-950">
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
    <div className="flex flex-col h-[100dvh] bg-white dark:bg-slate-950">
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
          <div className="w-64 shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto">
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
          {/* AISummaryPanel is the lightweight heuristic summary. Once the
              user has generated an AI Deep Review draft (richer walkthrough
              + per-line comments), the deep panel supersedes this one and
              we hide it to avoid duplicate AI affordances on the same
              surface. Cleanup of #1 from the 2026-05-09 follow-ups review. */}
          {!deep.draft && (
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
          )}

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
            owner={owner}
            repo={repo}
            prNumber={pullNumber}
          />
        </div>
      </div>

      <ReviewStatusBar
        totalFiles={state.files?.length ?? 0}
        reviewedCount={state.reviewedFiles.length}
        pendingCommentCount={state.pendingComments.length}
        onSubmitReview={handleSubmitReview}
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

      {/* Mobile/tablet AI panel: floating action button + right-edge drawer.
          Visible below lg, where the third-column AIReviewPanel is hidden.
          Both mounts share the same useAIDeepReview hook instance, so
          dismissing/editing in one updates the other. */}
      {/* AI insights FAB on PR Review.
          Peeks out 55 % from the right edge (matching MobileQuickActionsFab)
          so PR diff content uses the full viewport width. Hover / focus /
          touch reveal the full button. Sits 152 px above the bottom to
          stack above MobileQuickActionsFab (which is at 72 px from bottom)
          with a 24 px breathing gap. */}
      {!composerOpen && (
        <button
          ref={aiFabRef}
          type="button"
          onClick={() => setAiDrawerOpen(true)}
          className="group lg:hidden fixed z-[var(--ds-z-floating)] bottom-[calc(152px+env(safe-area-inset-bottom,0px))] right-0 mr-4 w-14 h-14 rounded-full bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 dark:hover:bg-indigo-600 text-white shadow-lg flex items-center justify-center transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] translate-x-[55%] opacity-90 hover:translate-x-0 hover:opacity-100 focus:translate-x-0 focus:opacity-100 active:translate-x-0"
          aria-label={
            deep.draft?.lineComments?.length
              ? `Open AI insights (${deep.draft.lineComments.length} draft comments)`
              : 'Open AI insights'
          }
          title="AI insights"
        >
          <Sparkles className="w-6 h-6" strokeWidth={2.25} />
          {deep.draft?.lineComments?.length > 0 && (
            <span
              data-testid="fab-comment-badge"
              className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-950"
            >
              {deep.draft.lineComments.length > 99 ? '99+' : deep.draft.lineComments.length}
            </span>
          )}
        </button>
      )}

      <KeyboardHelpOverlay isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      <MobileAIPanelDrawer isOpen={aiDrawerOpen} onClose={() => setAiDrawerOpen(false)} restoreFocusRef={aiFabRef}>
        <AIReviewPanel
          draft={deep.draft}
          loading={deep.loading}
          error={deep.error}
          onGenerate={deep.generate}
          onPublish={() => setPublishOpen(true)}
          onJumpToFile={(filename) => {
            dispatch({ type: 'SET_ACTIVE_FILE', filename })
            setAiDrawerOpen(false)
          }}
          onDismissComment={(idx) => deep.dismiss(idx)}
          onEditComment={(idx, payload) => deep.edit(idx, payload)}
          publishing={publishing}
          owner={owner}
          repo={repo}
          prNumber={pullNumber}
        />
      </MobileAIPanelDrawer>
    </div>
  )
}
