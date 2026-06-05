import { formatSize } from './formatSize'

/**
 * Compact metadata badges for a repo row — language, on-disk size, and either
 * a TFVC marker or the branch count. Purely presentational.
 */
export function RepoMetadataBadges({ language, size, isTfvc, branches }) {
  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      {language && (
        <span className="ds-text-micro bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 px-1.5 py-0.5 rounded">
          {language}
        </span>
      )}
      <span className="ds-text-micro bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 px-1.5 py-0.5 rounded">
        {formatSize(size)}
      </span>
      {isTfvc ? (
        <span className="ds-text-micro bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
          TFVC
        </span>
      ) : (
        branches > 0 && (
          <span className="ds-text-micro bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-500 px-1.5 py-0.5 rounded">
            {branches} {branches === 1 ? 'branch' : 'branches'}
          </span>
        )
      )}
    </div>
  )
}
