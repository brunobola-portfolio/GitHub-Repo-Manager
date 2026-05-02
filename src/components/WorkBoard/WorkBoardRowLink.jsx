// SPDX-License-Identifier: AGPL-3.0-only
import { ExternalLink } from 'lucide-react'

/**
 * Shared row-wrapper for every Work Board tab. Click the row → open the
 * in-app PR/Issue detail. Hover/focus reveals a small "Open on GitHub"
 * icon button so users who prefer github.com still have a clear escape
 * hatch — but the in-app surface is the default destination.
 *
 * Mirrors the "menu do repo" pattern in RepoCard:
 *   • Primary affordance opens internal navigation
 *   • GitHub-direct is secondary (icon, hover-revealed)
 *   • The kebab menu (rendered separately by callers) carries the rest.
 *
 * @param {object} props
 * @param {string} props.repoFullName       — owner/repo
 * @param {number} props.number             — PR or issue number
 * @param {'pr'|'issue'} props.itemType
 * @param {string} props.itemUrl            — github.com URL (for the secondary button + middle/ctrl-click)
 * @param {React.ReactNode} props.children  — row content
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel]
 */
export function WorkBoardRowLink({
    repoFullName,
    number,
    itemType,
    itemUrl,
    children,
    className = '',
    ariaLabel,
}) {
    const openInApp = (e) => {
        // Honour middle-click / cmd-click / ctrl-click as "open on GitHub" so
        // we don't break the existing muscle memory of users who use those
        // gestures to open links in a new tab. Plain click stays in-app.
        if (e.metaKey || e.ctrlKey || e.button === 1) {
            return // let the secondary GitHub link handle it (or the parent <a>)
        }
        e.preventDefault()
        const eventName = itemType === 'pr' ? 'app:open-repo-pr' : 'app:open-repo-issue'
        window.dispatchEvent(new CustomEvent(eventName, { detail: { repoFullName, number } }))
    }

    const onKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            const eventName = itemType === 'pr' ? 'app:open-repo-pr' : 'app:open-repo-issue'
            window.dispatchEvent(new CustomEvent(eventName, { detail: { repoFullName, number } }))
        }
    }

    return (
        <div className={`relative group ${className}`}>
            <button
                type="button"
                onClick={openInApp}
                onAuxClick={openInApp}
                onKeyDown={onKeyDown}
                aria-label={ariaLabel || `Open ${itemType === 'pr' ? 'pull request' : 'issue'} #${number} in app`}
                className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
            >
                {children}
            </button>
            <a
                href={itemUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Open on GitHub"
                title="Open on GitHub"
                className="absolute top-2 right-2 p-1.5 rounded-md text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
        </div>
    )
}
