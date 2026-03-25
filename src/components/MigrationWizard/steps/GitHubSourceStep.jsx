import { GitBranch, CheckCircle2, AlertCircle } from 'lucide-react'

/**
 * GitHubSourceStep - Enter a GitHub repo URL for clone/mirror in the wizard.
 *
 * Props:
 *   source   – { githubSourceUrl, targetName, ... }
 *   onChange  – (updates) => void
 */
export default function GitHubSourceStep({ source, onChange }) {
  const url = source.githubSourceUrl || ''
  const isValidGitHub = /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/.test(url.trim())
  const hasInput = url.trim().length > 0

  const handleUrlChange = (e) => {
    const value = e.target.value
    const updates = { githubSourceUrl: value }

    // Auto-fill targetName from URL when it's currently empty
    if (!source.targetName) {
      const match = value.trim().match(/github\.com\/[^/]+\/([^/?.#]+)/)
      if (match) {
        updates.targetName = match[1].replace(/\.git$/, '')
      }
    }

    onChange(updates)
  }

  return (
    <div className="space-y-5">
      {/* URL Input */}
      <div>
        <label
          htmlFor="github-source-url"
          className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5"
        >
          Repository URL
        </label>
        <div className="relative">
          <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="github-source-url"
            type="url"
            value={url}
            onChange={handleUrlChange}
            placeholder="https://github.com/owner/repo"
            className="w-full pl-9 pr-9 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-colors"
          />
          {hasInput && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {isValidGitHub ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-500" />
              )}
            </div>
          )}
        </div>

        {/* Validation hint */}
        {hasInput && !isValidGitHub && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            This doesn't look like a valid GitHub URL
          </p>
        )}
      </div>

      {/* Info text */}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        The repository will be cloned and pushed to your GitHub account or organization.
      </p>
    </div>
  )
}
