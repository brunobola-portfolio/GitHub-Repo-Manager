import { Code2, HardDrive, GitBranch, Clock, Database } from 'lucide-react'
import { formatFileSize } from '../../../../utils/format'

function formatRelativeTime(iso) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(mo / 12)}y`
}

function Badge({ icon: Icon, children, tone = 'slate' }) {
  const toneCls = {
    slate:  'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    sky:    'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400',
    amber:  'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    violet: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
  }[tone]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${toneCls}`}>
      {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function RepoMetaBadges({ repo, density = 'full' }) {
  const relative = formatRelativeTime(repo.lastCommitDate)
  const showBranches = !repo.isTfvc && repo.branches > 0
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {repo.language && <Badge icon={Code2} tone="purple">{repo.language}</Badge>}
      <Badge icon={HardDrive}>{formatFileSize(repo.size || 0, 1)}</Badge>
      {showBranches && <Badge icon={GitBranch} tone="sky">{repo.branches}</Badge>}
      {repo.isTfvc && <Badge tone="violet">TFVC</Badge>}
      {repo.hasLfsMarker && <Badge icon={Database} tone="amber">LFS</Badge>}
      {density === 'full' && relative && <Badge icon={Clock}>{relative}</Badge>}
    </div>
  )
}
