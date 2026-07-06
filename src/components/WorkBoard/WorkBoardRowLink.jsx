// SPDX-License-Identifier: AGPL-3.0-only
import { ExternalLink } from 'lucide-react'
import { Tooltip } from '../ui/Tooltip'
import { emitAppEvent, APP_EVENTS } from '../../utils/appEvents'

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
        const eventName = itemType === 'pr' ? APP_EVENTS.OPEN_REPO_PR : APP_EVENTS.OPEN_REPO_ISSUE
        emitAppEvent(eventName, { repoFullName, number })
    }

    return (
        <div className={`relative isolate group ${className}`}>
            {/* Stretched open-in-app control (background layer). A real,
                keyboard-reachable <button> layered BEHIND the row content
                (z-0) — NOT a role="button" wrapper AROUND it. The row's inner
                controls (InlineActions, the kebab menu, the GitHub link below)
                are lifted above it with `relative z-10`, so they are siblings
                of — not descendants of — this button. That is what removes the
                axe `nested-interactive` violation the old wrapper tripped.
                Non-interactive row content stays static, so clicking it falls
                through to this transparent overlay = open-in-app, exactly as
                the old wrapper behaved. Enter/Space fire it natively (button),
                so no manual keydown handling is needed. */}
            <button
                type="button"
                onClick={openInApp}
                onAuxClick={openInApp}
                aria-label={ariaLabel || `Open ${itemType === 'pr' ? 'pull request' : 'issue'} #${number} in app`}
                className="absolute inset-0 z-0 rounded-xl cursor-pointer ds-focus-ring"
            />
            {children}
            <Tooltip label="Open on GitHub">
                <a
                    href={itemUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Open on GitHub"
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity ds-focus-ring"
                >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
            </Tooltip>
        </div>
    )
}
