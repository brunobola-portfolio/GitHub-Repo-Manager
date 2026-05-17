import { GitBranch, CheckCircle2, AlertCircle } from 'lucide-react'
import { Field, Input } from '../../ui/form'

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

  const trailing = hasInput ? (
    isValidGitHub ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
    ) : (
      <AlertCircle className="w-4 h-4 text-amber-500" />
    )
  ) : null

  return (
    <div className="space-y-5">
      {/* URL Input */}
      <Field
        label="Repository URL"
        htmlFor="github-source-url"
        error={hasInput && !isValidGitHub ? "This doesn't look like a valid GitHub URL" : undefined}
      >
        <Input
          id="github-source-url"
          type="url"
          value={url}
          onChange={handleUrlChange}
          placeholder="https://github.com/owner/repo"
          leadingIcon={GitBranch}
          trailing={trailing}
        />
      </Field>

      {/* Info text */}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        The repository will be cloned and pushed to your GitHub account or organization.
      </p>
    </div>
  )
}
