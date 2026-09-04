import { useState } from 'react';
import { Button } from '../ui/Button';

/**
 * Read-only/editable list of prompt presets shown on the Prompt Studio page.
 *
 * Custom preset creation/management is free on every tier (2026-07-18
 * rebalance), capped server-side at `promptPresetsMax` owned presets (Free:
 * 10, Pro/Enterprise: unlimited) — the cap is enforced on save, not by
 * hiding the CTA here.
 */
export function PromptLibrary({ presets, loading, onNew, onEdit, onDelete, onSetDefault }) {
    const [filter, setFilter] = useState('all'); // all | builtin | custom | org

    const visible = (presets || []).filter((p) => {
        if (filter === 'builtin') return p.builtin;
        if (filter === 'org') return !p.builtin && p.scope === 'org';
        // 'custom' = user-authored non-org presets (org-shared rows live in
        // the 'org' tab regardless of authorship, to make sharing explicit).
        if (filter === 'custom') return !p.builtin && p.scope !== 'org';
        return true;
    });

    if (loading) {
        return <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading presets…</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold flex-1">Prompt presets</h2>
                {['all', 'builtin', 'custom', 'org'].map((f) => (
                    <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        aria-pressed={filter === f}
                        className={`px-3 h-8 text-xs rounded-lg ds-focus-ring ${filter === f ? 'ds-brand-solid font-semibold' : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                    >
                        {f}
                    </button>
                ))}
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={onNew}
                    title="Create a custom preset"
                    className="ml-2"
                >
                    + New preset
                </Button>
            </div>

            <ul className="space-y-2">
                {visible.length === 0 ? (
                    <li className="text-sm text-slate-500 dark:text-slate-400">No presets match this filter.</li>
                ) : null}
                {visible.map((p) => {
                    // Edit/Delete/Set-default are author-only — for org-shared
                    // rows authored by someone else, hide the actions and show
                    // a read-only "shared" badge instead.
                    const isOrgShared = !p.builtin && p.scope === 'org';
                    const canManage = !p.builtin && p.ownedByUser !== false;
                    return (
                        <li key={p.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-3 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{p.name}</span>
                                    {p.builtin ? <span className="ds-text-micro uppercase tracking-wide text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">built-in</span> : null}
                                    {isOrgShared ? (
                                        <span className="ds-text-micro uppercase tracking-wide text-[color:var(--ds-accent-brand)] dark:text-[color:var(--ds-accent-brand-dark)] px-1.5 py-0.5 rounded bg-brand-50 dark:bg-brand-950">
                                            shared · {p.scopeTarget}
                                        </span>
                                    ) : null}
                                    {p.isDefault ? <span className="ds-text-micro uppercase tracking-wide text-emerald-700">default</span> : null}
                                    {isOrgShared && p.ownedByUser === false ? (
                                        <span className="ds-text-micro uppercase tracking-wide opacity-60">read-only</span>
                                    ) : null}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Scope: {p.scope}{p.scopeTarget && !isOrgShared ? ` (${p.scopeTarget})` : ''}
                                    {p.severityFloor ? ` · ≥ ${p.severityFloor}` : ''}
                                </div>
                            </div>
                            {canManage ? (
                                <div className="flex gap-1 text-xs">
                                    <button type="button" onClick={() => onSetDefault(p.id)} className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                                        Set default
                                    </button>
                                    <button type="button" onClick={() => onEdit(p.id)} className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                                        Edit
                                    </button>
                                    <button type="button" onClick={() => onDelete(p.id)} className="px-2 py-1 rounded hover:bg-red-50 text-red-700 dark:hover:bg-red-950 dark:text-red-300">
                                        Delete
                                    </button>
                                </div>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
