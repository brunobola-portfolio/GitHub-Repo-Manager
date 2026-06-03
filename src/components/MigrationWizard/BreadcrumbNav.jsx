

import { Cloud, ChevronRight, AlertTriangle } from 'lucide-react';

const VISIBLE_STEPS = ['repoSelect', 'repoConfig', 'workItems', 'wiki', 'aiReview', 'schedule'];

export default function BreadcrumbNav({ source, currentStep, selectedCount, totalWarnings = 0, onNavigate }) {
  if (source?.sourceType !== 'azure' || !VISIBLE_STEPS.includes(currentStep)) {
    return null;
  }

  return (
    <nav
      aria-label="Source navigation"
      className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2 px-3 mb-4 overflow-x-auto whitespace-nowrap"
    >
      {/* Org segment */}
      <button
        type="button"
        onClick={() => onNavigate('org')}
        className="flex items-center gap-1.5 text-sm font-medium text-indigo-500 hover:text-indigo-400 cursor-pointer shrink-0"
      >
        <Cloud className="w-3.5 h-3.5" />
        <span>{source.org}</span>
      </button>

      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

      {/* Project segment */}
      <button
        type="button"
        onClick={() => onNavigate('project')}
        className="text-sm font-medium text-indigo-500 hover:text-indigo-400 cursor-pointer shrink-0"
      >
        {source.project}
      </button>

      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

      {/* Repos segment (current location, not clickable) */}
      <span className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">
        Repos
        {selectedCount > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ml-1 inline-flex items-center gap-1 ${
            totalWarnings > 0
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
              : 'bg-indigo-100 dark:bg-indigo-900/30 text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)]'
          }`}>
            {selectedCount} selected
            {totalWarnings > 0 && <AlertTriangle className="w-3 h-3" />}
          </span>
        )}
      </span>
    </nav>
  );
}
