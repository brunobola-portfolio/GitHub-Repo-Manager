import { Command } from 'cmdk'
import { GROUP_HEADING_CLASSES, ITEM_CLASSES } from './styles'

/**
 * Generic command-palette group for the "context command" registries
 * (work-board / tracked / AI / repo-detail / PR-review / teams / repos /
 * repo-actions). Each command is `{ id, label, searchValue, icon? }`; the icon
 * name resolves through `iconMap` (absent/missing → no icon). Renders nothing
 * when `commands` is empty so cmdk never shows a stray heading.
 *
 * @param {object} props
 * @param {string} props.heading
 * @param {Array<{id:string,label:string,searchValue:string,icon?:string}>} props.commands
 * @param {Record<string, Function>} props.iconMap — icon name -> lucide component
 * @param {(item: object) => void} props.onRun — runs the command's side effect
 * @param {() => void} props.onClose — closes the palette after a run
 */
export function CommandGroup({ heading, commands, iconMap, onRun, onClose }) {
  if (!commands || commands.length === 0) return null
  return (
    <Command.Group heading={heading} className={`mt-1 ${GROUP_HEADING_CLASSES}`}>
      {commands.map((item) => {
        const Icon = item.icon ? iconMap[item.icon] : null
        return (
          <Command.Item
            key={item.id}
            value={item.searchValue}
            onSelect={() => { onRun(item); onClose() }}
            className={ITEM_CLASSES}
          >
            {Icon && <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />}
            {item.label}
          </Command.Item>
        )
      })}
    </Command.Group>
  )
}
