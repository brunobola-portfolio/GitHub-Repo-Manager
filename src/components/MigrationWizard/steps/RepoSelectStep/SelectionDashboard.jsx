import { Rocket, Package, AlertOctagon, AlertTriangle, Clock } from 'lucide-react'
import { SectionHero } from '../../ui/repo/SectionHero'
import { StatCard } from '../../ui/repo/StatCard'
import { SmartSelectMenu } from './SmartSelectMenu'

export function SelectionDashboard({ repos, aggregate, staleCount, onSmartSelect, onReset }) {
  return (
    <SectionHero
      icon={Rocket}
      title="Choose what to migrate"
      subtitle={`${repos.length} repos found`}
      actions={
        <>
          <SmartSelectMenu repos={repos} onSelect={onSmartSelect} />
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
              bg-slate-500/15 text-slate-400 border border-slate-500/20 hover:bg-slate-500/25 transition-colors ds-focus-ring"
          >
            Reset
          </button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Package} label="Total" value={repos.length} tone="indigo" />
        <StatCard icon={AlertTriangle} label="At risk" value={aggregate.warnings} tone="amber" />
        <StatCard icon={AlertOctagon} label="Blockers" value={aggregate.blockers} tone="red" />
        <StatCard icon={Clock} label="Stale" value={staleCount} tone="slate" />
      </div>
    </SectionHero>
  )
}
