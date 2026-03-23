import React from 'react';
import { Cloud, ChevronRight } from 'lucide-react';

const VISIBLE_STEPS = ['repoSelect', 'repoConfig', 'workItems', 'wiki', 'aiReview', 'schedule'];

export default function BreadcrumbNav({ source, currentStep, selectedCount, onNavigate }) {
  if (source?.sourceType !== 'azure' || !VISIBLE_STEPS.includes(currentStep)) {
    return null;
  }

  return (
    <nav
      aria-label="Source navigation"
      className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2 px-3 mb-4"
    >
      {/* Org segment */}
      <button
        type="button"
        onClick={() => onNavigate('org')}
        className="flex items-center gap-1.5 text-sm font-medium text-indigo-500 hover:text-indigo-400 cursor-pointer"
      >
        <Cloud className="w-3.5 h-3.5" />
        <span>{source.org}</span>
      </button>

      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />

      {/* Project segment */}
      <button
        type="button"
        onClick={() => onNavigate('project')}
        className="text-sm font-medium text-indigo-500 hover:text-indigo-400 cursor-pointer"
      >
        {source.project}
      </button>

      <ChevronRight className="w-3.5 h-3.5 text-slate-400" />

      {/* Repos segment (current location, not clickable) */}
      <span className="flex items-center text-sm font-medium text-slate-700 dark:text-slate-300">
        Repos
        {selectedCount > 0 && (
          <span className="text-xs bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full ml-1">
            {selectedCount} selected
          </span>
        )}
      </span>
    </nav>
  );
}
