import { Command } from 'cmdk'
import { GitFork, LayoutDashboard, Users, Tag, Map, Wand2, History, Plus, ArrowRightLeft, Settings } from 'lucide-react'

const NAVIGATE_ITEMS = [
  { id: 'nav-dashboard', label: 'Dashboard', view: 'dashboard', icon: LayoutDashboard },
  { id: 'nav-repos', label: 'Repositories', view: 'repos', icon: GitFork },
  { id: 'nav-teams', label: 'Teams', view: 'teams', icon: Users },
  { id: 'nav-pricing', label: 'Pricing', view: 'pricing', icon: Tag },
  { id: 'nav-roadmap', label: 'Roadmap', view: 'roadmap', icon: Map },
]

const ACTION_ITEMS = [
  { id: 'action-migration-wizard', label: 'Open Migration Wizard', modal: 'showMigrationWizard', icon: Wand2 },
  { id: 'action-migration-history', label: 'View Migration History', modal: 'showMigrationHistory', icon: History },
  { id: 'action-create-repo', label: 'Create Repository', modal: 'showCreateRepo', icon: Plus },
  { id: 'action-transfer', label: 'Transfer Repository', modal: 'showTransfer', icon: ArrowRightLeft },
  { id: 'action-settings', label: 'Open Settings', modal: 'showSettings', icon: Settings },
]

const GROUP_HEADING_CLASSES = '[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-xs [&>[cmdk-group-heading]]:font-semibold [&>[cmdk-group-heading]]:text-slate-500 [&>[cmdk-group-heading]]:dark:text-slate-400 [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider'

export function CommandPalette({ isOpen, onClose, repos, onViewChange, onOpenModal, onSelectRepo }) {
  const displayRepos = repos.slice(0, 10)

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open) onClose() }}
      label="Command Palette"
      overlayClassName="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[20%] z-[9999] -translate-x-1/2 w-full max-w-[640px] px-4"
    >
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <Command.Input
          placeholder="Type a command or search..."
          autoFocus
          className="w-full px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-transparent border-b border-slate-200 dark:border-slate-700 outline-none"
        />
        <Command.List className="max-h-[400px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No results.
          </Command.Empty>

          <Command.Group
            heading="Navigate"
            className={GROUP_HEADING_CLASSES}
          >
            {NAVIGATE_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => {
                    onViewChange(item.view)
                    onClose()
                  }}
                  className="group flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 cursor-pointer aria-selected:bg-indigo-50 aria-selected:dark:bg-indigo-950/50 aria-selected:text-indigo-600 aria-selected:dark:text-indigo-400 outline-none transition-colors"
                >
                  <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-aria-selected:text-indigo-500" />
                  {item.label}
                </Command.Item>
              )
            })}
          </Command.Group>

          <Command.Group
            heading="Actions"
            className={`mt-1 ${GROUP_HEADING_CLASSES}`}
          >
            {ACTION_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <Command.Item
                  key={item.id}
                  value={item.label}
                  onSelect={() => {
                    onOpenModal(item.modal)
                    onClose()
                  }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 cursor-pointer aria-selected:bg-indigo-50 aria-selected:dark:bg-indigo-950/50 aria-selected:text-indigo-600 aria-selected:dark:text-indigo-400 outline-none transition-colors"
                >
                  <Icon className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  {item.label}
                </Command.Item>
              )
            })}
          </Command.Group>

          {displayRepos.length > 0 && (
            <Command.Group
              heading="Repositories"
              className={`mt-1 ${GROUP_HEADING_CLASSES}`}
            >
              {displayRepos.map((repo) => (
                <Command.Item
                  key={repo.id}
                  value={repo.full_name}
                  onSelect={() => {
                    onSelectRepo(repo)
                    onClose()
                  }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 cursor-pointer aria-selected:bg-indigo-50 aria-selected:dark:bg-indigo-950/50 aria-selected:text-indigo-600 aria-selected:dark:text-indigo-400 outline-none transition-colors"
                >
                  <GitFork className="w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500" />
                  {repo.full_name}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
