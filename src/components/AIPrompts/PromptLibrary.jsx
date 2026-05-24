import { useState } from 'react';

/**
 * Read-only/editable list of prompt presets shown on the Prompt Studio page.
 *
 * Free users see built-ins only with an "Upgrade to Pro" hint; the "+ New
 * preset" CTA is disabled and the per-row Edit/Delete/Set-default actions
 * are hidden. Pro/Enterprise users get the full management surface.
 */
export function PromptLibrary({ presets, loading, onNew, onEdit, onDelete, onSetDefault, currentTier }) {
    const [filter, setFilter] = useState('all'); // all | builtin | custom | org
    const isPro = currentTier === 'pro' || currentTier === 'enterprise';

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
                        className={`px-2 py-1 text-xs rounded ${filter === f ? 'bg-blue-600 text-white' : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                    >
                        {f}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={onNew}
                    disabled={!isPro}
                    title={isPro ? 'Create a custom preset' : 'Upgrade to Pro to create custom presets'}
                    className="ml-2 px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                    + New preset
                </button>
            </div>

            {!isPro ? (
                <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200">
                    Free users can pick from built-in presets. <strong>Upgrade to Pro</strong> to author custom prompts, set per-repo defaults, and use path-scoped rules.
                </div>
            ) : null}

            <ul className="space-y-2">
                {visible.length === 0 ? (
                    <li className="text-sm text-slate-500 dark:text-slate-400">No presets match this filter.</li>
                ) : null}
                {visible.map((p) => {
                    // Edit/Delete/Set-default are author-only — for org-shared
                    // rows authored by someone else, hide the actions and show
                    // a read-only "shared" badge instead.
                    const isOrgShared = !p.builtin && p.scope === 'org';
                    const canManage = !p.builtin && isPro && p.ownedByUser !== false;
                    return (
                        <li key={p.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-3 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium">{p.name}</span>
                                    {p.builtin ? <span className="ds-text-micro uppercase tracking-wide opacity-50 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">built-in</span> : null}
                                    {isOrgShared ? (
                                        <span className="ds-text-micro uppercase tracking-wide text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950">
                                            shared · {p.scopeTarget}
                                        </span>
                                    ) : null}
                                    {p.isDefault ? <span className="ds-text-micro uppercase tracking-wide text-emerald-600">default</span> : null}
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
