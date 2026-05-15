import { useEffect, useState } from 'react'
import { Command } from 'cmdk'

export function CommandPalette({ commands = [] }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[15vh] z-[var(--ds-z-modal)]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <Command
        className="w-[480px] max-w-[calc(100vw-32px)] bg-[color:var(--ds-surface)] dark:bg-[color:var(--ds-surface-dark)] border border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)] rounded-[var(--ds-radius-lg)] shadow-[var(--ds-shadow-overlay)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command.Input
          placeholder="Search commands, repos, PRs…"
          className="w-full px-4 py-3 text-[14px] bg-transparent outline-none border-b border-[color:var(--ds-border)] dark:border-[color:var(--ds-border-dark)] text-[color:var(--ds-fg)] dark:text-[color:var(--ds-fg-dark)]"
        />
        <Command.List className="max-h-[320px] overflow-y-auto ds-scrollbar p-1">
          <Command.Empty className="px-4 py-6 text-center text-sm text-[color:var(--ds-fg-muted)]">
            No matches.
          </Command.Empty>
          {commands.map((cmd) => (
            <Command.Item
              key={cmd.id}
              onSelect={() => { cmd.run(); setOpen(false) }}
              className="px-3 py-2 rounded-[var(--ds-radius)] cursor-pointer text-[14px] text-[color:var(--ds-fg)] dark:text-[color:var(--ds-fg-dark)] data-[selected=true]:bg-[color:var(--ds-surface-muted)] dark:data-[selected=true]:bg-[color:var(--ds-surface-muted-dark)]"
            >
              {cmd.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
