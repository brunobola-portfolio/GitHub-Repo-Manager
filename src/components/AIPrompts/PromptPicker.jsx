import { useState } from 'react';

/**
 * Small dropdown that lets the user pick a preset before generating an AI review.
 * Free users see built-ins only; Pro users also see custom presets.
 *
 * @param {object} props
 * @param {Array} props.presets        — from usePromptStudio
 * @param {string} props.activeKey     — currently selected preset id (string for builtins, numeric for custom)
 * @param {Function} props.onChange    — called with new key
 * @param {boolean} props.disabled     — when generation is in flight
 */
export function PromptPicker({ presets, activeKey, onChange, disabled }) {
    const [open, setOpen] = useState(false);
    const active = (presets || []).find((p) => String(p.id) === String(activeKey)) ?? presets?.[0];

    if (!presets || presets.length === 0) return null;

    return (
        <div className="relative inline-block text-xs">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                {active?.name ?? 'Pick preset'} ▾
            </button>
            {open ? (
                <ul role="listbox" className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 shadow-lg z-30">
                    {presets.map((p) => (
                        <li
                            key={p.id}
                            role="option"
                            aria-selected={String(p.id) === String(activeKey)}
                            tabIndex={0}
                            onClick={() => { onChange(p.id); setOpen(false); }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onChange(p.id);
                                    setOpen(false);
                                }
                            }}
                            className={`px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 outline-none ${String(p.id) === String(activeKey) ? 'font-semibold' : ''}`}
                        >
                            <div className="flex items-center gap-2">
                                <span className="flex-1 truncate">{p.name}</span>
                                {p.builtin ? <span className="text-[10px] uppercase tracking-wide opacity-50">built-in</span> : null}
                                {p.isDefault ? <span className="text-[10px] uppercase tracking-wide text-emerald-600">default</span> : null}
                            </div>
                            {p.severityFloor ? (
                                <div className="text-[10px] opacity-60 mt-0.5">≥ {p.severityFloor}</div>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
