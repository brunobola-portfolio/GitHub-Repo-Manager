import { useEffect, useRef, useState, useId } from 'react';

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
    const containerRef = useRef(null);
    const itemRefs = useRef([]);
    const listboxId = useId();
    const active = (presets || []).find((p) => String(p.id) === String(activeKey)) ?? presets?.[0];

    // Click-outside + Escape dismiss
    useEffect(() => {
        if (!open) return undefined;
        const handlePointerDown = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        const handleKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open]);

    // When opening, focus the active option (or first)
    useEffect(() => {
        if (!open) return;
        const idx = (presets || []).findIndex((p) => String(p.id) === String(activeKey));
        const startIdx = idx >= 0 ? idx : 0;
        // Defer to next tick so the listbox is mounted
        setTimeout(() => itemRefs.current[startIdx]?.focus?.(), 0);
    }, [open, presets, activeKey]);

    function handleListKeyDown(e) {
        const lastIdx = (presets?.length ?? 0) - 1;
        const focusedIdx = itemRefs.current.findIndex((el) => el === document.activeElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = focusedIdx < lastIdx ? focusedIdx + 1 : 0;
            itemRefs.current[next]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = focusedIdx > 0 ? focusedIdx - 1 : lastIdx;
            itemRefs.current[prev]?.focus();
        } else if (e.key === 'Home') {
            e.preventDefault();
            itemRefs.current[0]?.focus();
        } else if (e.key === 'End') {
            e.preventDefault();
            itemRefs.current[lastIdx]?.focus();
        }
    }

    if (!presets || presets.length === 0) return null;

    return (
        <div ref={containerRef} className="relative inline-block text-xs">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                disabled={disabled}
                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
            >
                {active?.name ?? 'Pick preset'} ▾
            </button>
            {open ? (
                <ul
                    id={listboxId}
                    role="listbox"
                    onKeyDown={handleListKeyDown}
                    className="absolute right-0 mt-1 w-56 max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 shadow-lg z-30"
                >
                    {presets.map((p, idx) => (
                        <li
                            key={p.id}
                            ref={(el) => { itemRefs.current[idx] = el; }}
                            role="option"
                            tabIndex={0}
                            aria-selected={String(p.id) === String(activeKey)}
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
