/**
 * Shared cmdk presentation classes for the command-palette subcomponents.
 * Extracted so the group/item styling stays identical across the palette
 * root and the components split out of it (GitHubResults, RecentGroup, …).
 */
export const GROUP_HEADING_CLASSES = '[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-xs [&>[cmdk-group-heading]]:font-semibold [&>[cmdk-group-heading]]:text-slate-500 [&>[cmdk-group-heading]]:dark:text-slate-400 [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider'

export const ITEM_CLASSES = 'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-300 cursor-pointer aria-selected:bg-brand-50 aria-selected:dark:bg-brand-950/50 aria-selected:text-brand-600 aria-selected:dark:text-brand-400 outline-none transition-colors'
