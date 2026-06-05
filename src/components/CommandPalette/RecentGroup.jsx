import { Command } from 'cmdk'
import { Clock, GitFork } from 'lucide-react'
import { GROUP_HEADING_CLASSES, ITEM_CLASSES } from './styles'

/**
 * "Recent" command-palette group — the last view/repo actions persisted in
 * localStorage. The parent owns the visibility gating (empty input, not ask
 * mode) and the selection side effects: selecting an entry calls
 * `onSelect(entry)`, which re-bumps it and routes to the view/repo.
 *
 * @param {object} props
 * @param {Array<{kind:'view'|'repo', id:string, label:string}>} props.recents
 * @param {Array<{view:string, icon:Function}>} props.navigateItems — view icon lookup
 * @param {(entry: object) => void} props.onSelect
 */
export function RecentGroup({ recents, navigateItems, onSelect }) {
  return (
    <Command.Group heading="Recent" className={GROUP_HEADING_CLASSES}>
      {recents.map((entry) => {
        const navItem = entry.kind === 'view'
          ? navigateItems.find(n => n.view === entry.id)
          : null
        const Icon = entry.kind === 'view' ? (navItem?.icon ?? Clock) : GitFork
        return (
          <Command.Item
            key={`recent-${entry.kind}-${entry.id}`}
            value={`recent ${entry.label}`}
            onSelect={() => onSelect(entry)}
            className={ITEM_CLASSES}
          >
            <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />
            {entry.label}
            <span className="ml-auto ds-text-micro uppercase tracking-wide text-slate-400">
              {entry.kind}
            </span>
          </Command.Item>
        )
      })}
    </Command.Group>
  )
}
