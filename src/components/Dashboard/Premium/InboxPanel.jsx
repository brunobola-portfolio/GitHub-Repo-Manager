import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useInbox } from '../../../hooks/useInbox';
import { InboxRow } from './InboxRow';
import { InboxSection } from './InboxSection';
import { SnoozeModal } from './SnoozeModal';
import { Spinner } from '../../ui/Spinner';

export function InboxPanel({ onSelectItem }) {
    const { sections, loading, error, archive, snooze } = useInbox();
    const [activeKey, setActiveKey] = useState(null);
    const [snoozingItem, setSnoozingItem] = useState(null);

    // Default to the first non-empty section once data lands
    useEffect(() => {
        if (activeKey) return;
        const first = sections.find(s => s.items.length > 0) ?? sections[0];
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot default selection when sections load; no cascading render concern
        if (first) setActiveKey(first.key);
    }, [sections, activeKey]);

    const active = useMemo(
        () => sections.find(s => s.key === activeKey) ?? sections[0],
        [sections, activeKey],
    );

    // Keyboard: 'e' archives the first item of the active section
    // 's' opens snooze modal for the first item of the active section
    useEffect(() => {
        function onKey(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (!active?.items?.length) return;
            if (e.key === 'e') archive(active.items[0].id).catch(() => {});
            else if (e.key === 's') setSnoozingItem(active.items[0]);
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active, archive]);

    return (
        <section
            aria-labelledby="inbox-panel-title"
            className="rounded-2xl bg-white/85 dark:bg-zinc-900/85 backdrop-blur-xl border border-zinc-200/60 dark:border-zinc-800/60"
        >
            <header className="px-5 pt-5 pb-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-300">
                    <Inbox className="w-3 h-3" /> Live inbox
                </div>
                <h3 id="inbox-panel-title" className="mt-1 text-base font-bold text-zinc-900 dark:text-zinc-100 ds-font-display">
                    What needs your eyes
                </h3>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr]">
                <nav aria-label="Inbox sections" className="px-3 py-3 space-y-1 border-r border-zinc-200/60 dark:border-zinc-800/60">
                    {sections.map(s => (
                        <InboxSection
                            key={s.key}
                            label={s.label}
                            count={s.items.length}
                            active={s.key === activeKey}
                            onClick={() => setActiveKey(s.key)}
                        />
                    ))}
                </nav>

                <div className="min-h-[200px]">
                    {loading && <div className="p-6 flex justify-center"><Spinner size="md" /></div>}
                    {error && <p className="p-6 text-sm text-red-600">{String(error.message || error)}</p>}
                    {!loading && !error && active && active.items.length === 0 && (
                        <p className="p-6 text-sm text-zinc-500">No items in this section.</p>
                    )}
                    {!loading && !error && active && active.items.length > 0 && (
                        <ul>
                            {active.items.map(item => (
                                <InboxRow
                                    key={item.id}
                                    item={item}
                                    onArchive={(id) => archive(id).catch(() => {})}
                                    onSnooze={setSnoozingItem}
                                    onSelect={onSelectItem}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <SnoozeModal
                open={!!snoozingItem}
                onConfirm={(iso) => snoozingItem && snooze(snoozingItem.id, iso).catch(() => {})}
                onClose={() => setSnoozingItem(null)}
            />
        </section>
    );
}
