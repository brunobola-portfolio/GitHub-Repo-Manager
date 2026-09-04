import { CodeReviewSurface } from '../diff/CodeReviewSurface'
import { AISummaryPanel } from '../PRReview/AIInsights/AISummaryPanel'
import { useReviewAI, sortFilesByRisk } from '../PRReview/hooks/useReviewAI'
import { MOCK_MODE } from '../../config'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'

/**
 * PRFilesTab — thin adapter over CodeReviewSurface for the PR review surface.
 *
 * Responsibilities specific to PRs (vs. commits):
 *  - Sort files by risk (heuristic from useReviewAI)
 *  - Provide AI insights panel as the surface's right slot
 *  - Storage key scoped per-PR
 */
export function PRFilesTab({ files = [], owner, repo, pr }) {
    const prNumber = pr?.number ?? 0
    const headSha = MOCK_MODE ? '' : (pr?.head?.sha ?? '')

    const { summary: aiSummary, loading: aiLoading, error: aiError, retry: retryAI } =
        useReviewAI(owner, repo, prNumber, headSha, files)

    const rightSlot = MOCK_MODE && !aiSummary && !aiLoading ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-400">
            <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">AI insights</p>
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
            onFileClick={(filename) => {
                // The surface listens for this event globally and jumps to the file.
                emitAppEvent(APP_EVENTS.CODE_REVIEW_SELECT_FILE, { filename })
            }}
        />
    )

    return (
        <CodeReviewSurface
            files={files}
            sortFiles={(f) => sortFilesByRisk(f, {})}
            storageKey={`pr-reviewed:${owner}/${repo}#${prNumber}`}
            headerSlot={null}
            rightSlot={rightSlot}
            fileMeta={{ aiFileRisks: aiSummary?.fileRisks ?? [] }}
        />
    )
}
