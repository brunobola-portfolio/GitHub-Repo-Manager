import { useEffect, useRef, useState } from 'react';

export function WalkthroughTab({ walkthrough }) {
    const mermaidRef = useRef(null);
    const [mermaidError, setMermaidError] = useState(null);
    const [theme, setTheme] = useState(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'default'
    );

    // Observe <html class="dark"> changes so the diagram updates on theme toggle
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return undefined;
        const root = document.documentElement;
        const observer = new MutationObserver(() => {
            const next = root.classList.contains('dark') ? 'dark' : 'default';
            setTheme((current) => (current === next ? current : next));
        });
        observer.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    // Render the diagram. Re-runs whenever the source OR theme changes.
    useEffect(() => {
        let cancelled = false;
        const src = walkthrough?.mermaid?.trim();
        if (!src || !mermaidRef.current) return undefined;

        // Lazy-load to keep mermaid (~200kB) out of the initial bundle
        import('mermaid').then((mod) => {
            if (cancelled) return;
            const mermaid = mod.default || mod;
            // Re-initialise per render so theme changes propagate. Mermaid's
            // initialize is idempotent — this is cheap (~microseconds).
            mermaid.initialize({ startOnLoad: false, theme });
            const id = `mermaid-${Math.random().toString(36).slice(2)}`;
            mermaid.render(id, src).then(({ svg }) => {
                if (!cancelled && mermaidRef.current) mermaidRef.current.innerHTML = svg;
            }).catch((err) => {
                if (!cancelled) setMermaidError(err?.message || 'Failed to render diagram');
            });
        }).catch((err) => setMermaidError(err?.message || 'Failed to load mermaid'));

        return () => { cancelled = true; };
    }, [walkthrough?.mermaid, theme]);

    if (!walkthrough) {
        return (
            <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
                No walkthrough yet. Click "Generate AI Review" to start.
            </div>
        );
    }

    return (
        <div className="p-4 space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded font-medium ${riskTone(walkthrough.riskLevel)}`}>
                    Risk: {walkthrough.riskLevel}
                </span>
                <span className="text-slate-500 dark:text-slate-400">~{walkthrough.estimatedReviewTime}</span>
            </div>

            {walkthrough.summary ? (
                /* TODO(slice-1b): when this becomes a real markdown renderer, add rehype-sanitize — AI output is untrusted */
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{walkthrough.summary}</div>
            ) : null}

            {Array.isArray(walkthrough.perFileTable) && walkthrough.perFileTable.length > 0 ? (
                <div>
                    <h4 className="font-medium mb-2 text-slate-700 dark:text-slate-300">Files</h4>
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 dark:text-slate-400">
                            <tr>
                                <th className="text-left py-1 pr-2">File</th>
                                <th className="text-left py-1 pr-2">Change</th>
                                <th className="text-left py-1">Summary</th>
                            </tr>
                        </thead>
                        <tbody>
                            {walkthrough.perFileTable.map((row, i) => (
                                <tr key={i} className="border-t border-slate-200 dark:border-slate-800">
                                    <td className="py-1 pr-2 font-mono">{row.path}</td>
                                    <td className="py-1 pr-2">{row.change}</td>
                                    <td className="py-1">{row.summary}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}

            {walkthrough.mermaid?.trim() ? (
                <div>
                    <h4 className="font-medium mb-2 text-slate-700 dark:text-slate-300">Diagram</h4>
                    {mermaidError ? (
                        <p className="text-xs text-red-600 dark:text-red-400">Diagram failed to render: {mermaidError}</p>
                    ) : (
                        <div ref={mermaidRef} className="overflow-auto rounded border border-slate-200 dark:border-slate-800 p-2" />
                    )}
                </div>
            ) : null}
        </div>
    );
}

function riskTone(level) {
    switch (level) {
        case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
        case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
        case 'medium': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
        default: return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    }
}
