

import { Cloud, ChevronRight, AlertTriangle } from 'lucide-react';
import { Badge } from '../ui/Badge';

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
        className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:text-brand-400 cursor-pointer shrink-0"
      >
        <Cloud className="w-3.5 h-3.5" />
        <span>{source.org}</span>
      </button>

      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

      {/* Project segment */}
      <button
        type="button"
        onClick={() => onNavigate('project')}
        className="text-sm font-medium text-brand-500 hover:text-brand-400 cursor-pointer shrink-0"
      >
        {source.project}
      </button>

      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

      {/* Repos segment (current location, not clickable) */}
      <span className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300 shrink-0">
        Repos
        {selectedCount > 0 && (
          <Badge tone={totalWarnings > 0 ? 'warning' : 'brand'} size="xs" className="ml-1 gap-1">
            {selectedCount} selected
            {totalWarnings > 0 && <AlertTriangle className="w-3 h-3" />}
          </Badge>
        )}
      </span>
    </nav>
  );
}
