import { Keyboard } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Kbd } from './ui/Kbd'
import { useMediaQuery } from '../hooks/useMediaQuery'

// Display label for a scope when a shortcut doesn't set its own `section`.
const SCOPE_LABELS = {
    global: 'General',
    navigation: 'Navigation',
    repos: 'Repositories',
    inbox: 'Live Inbox',
    workBoard: 'Work Board',
    prReview: 'PR Review',
    wizard: 'Repo Select',
}

const SCOPE_ORDER = ['global', 'navigation', 'repos', 'inbox', 'workBoard', 'prReview', 'wizard']

/**
 * Groups a flat shortcut list into the headings the dialog renders.
 *
 * A shortcut's `group` field (e.g. "Navigate" / "Actions") sub-divides its
 * section. When the dialog is narrowed to exactly one scope (the three
 * per-surface wrappers — WorkBoard's KeyboardHelpModal, PRReview's
 * KeyboardHelpOverlay, the wizard's ShortcutsOverlay), the group name alone
 * is the heading — this reproduces what each of those used to show on its
 * own (KeyboardHelpModal's Navigate/Actions/Global rows, KeyboardHelpOverlay's
 * Navigate/Review/Diff). Across multiple scopes (the global `?` dialog),
 * the scope's own section label prefixes the group so two different
 * surfaces' "Navigate" groups don't collide under one ambiguous heading.
 */
function groupShortcuts(shortcuts, scopes) {
    const singleScope = scopes.length === 1
    const groups = new Map()
    for (const s of shortcuts) {
        if (!scopes.includes(s.scope)) continue
        const section = s.section || SCOPE_LABELS[s.scope] || s.scope
        const heading = s.group
            ? (singleScope ? s.group : `${section} — ${s.group}`)
            : section
        if (!groups.has(heading)) groups.set(heading, [])
        groups.get(heading).push(s)
    }
    return [...groups.entries()]
}

/**
 * The single keyboard-shortcuts dialog shell. Reads from the shared
 * catalog (`src/config/keyboardShortcuts.js`) and renders every key
 * through `<Kbd>` — no surface re-types its own `<kbd>` recipe.
 *
 * With no `scope`, every registered scope renders as its own section —
 * this is what the global `?` dialog (mounted by ModalSurfaces) shows, and
 * it now includes Work Board, PR Review and the wizard alongside the
 * always-on global/navigation/repos/inbox shortcuts. `WorkBoard/KeyboardHelpModal`,
 * `PRReview/KeyboardHelpOverlay` and the wizard's `ShortcutsOverlay` are
 * thin wrappers that pass a single `scope` here instead of keeping their
 * own modal shell.
 */
export function KeyboardShortcutsHelp({
    isOpen,
    onClose,
    shortcuts,
    scope,
    title = 'Keyboard Shortcuts',
    subtitle,
    size = 'sm',
    mobileVariant,
    closeOnBackdrop,
}) {
    // On touch devices these keys aren't reachable — say so instead of listing
    // them as if they work everywhere.
    const isCoarsePointer = useMediaQuery('(pointer: coarse)')
    const scopes = scope ? (Array.isArray(scope) ? scope : [scope]) : SCOPE_ORDER
    const groups = groupShortcuts(shortcuts ?? [], scopes)
    // A single filtered group reads better as a flat list than as one
    // heading that would just repeat the dialog's own title/subtitle.
    const showHeadings = groups.length > 1

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            icon={Keyboard}
            size={size}
            mobileVariant={mobileVariant}
            closeOnBackdrop={closeOnBackdrop}
        >
            {isCoarsePointer && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-3 text-center" role="note">
                    These shortcuts need a physical keyboard — connect one to use them on this device.
                </p>
            )}
            <div className="grid gap-5">
                {groups.map(([heading, items]) => (
                    <ShortcutGroup key={heading} title={showHeadings ? heading : null} items={items} />
                ))}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-4 text-center">
                Press <Kbd>Esc</Kbd> to close
            </p>
        </Modal>
    )
}

function ShortcutGroup({ title, items }) {
    if (!items.length) return null
    return (
        <div>
            {title && (
                <h3 className="ds-eyebrow text-slate-500 dark:text-slate-400 mb-2">
                    {title}
                </h3>
            )}
            <div className="space-y-1.5">
                {items.map((s, i) => (
                    <div key={`${s.scope}-${s.actionId ?? s.key ?? s.keys?.join('+')}-${i}`} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{s.description}</span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                            {(s.keys ?? [s.key]).map((k, ki) => <Kbd key={ki}>{k}</Kbd>)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
