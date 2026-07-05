import { useEffect, useState } from 'react';
import { formatRelativeTime } from '../utils/format';

// Live-updating relative time. This is the ticking wrapper around the single
// canonical vocabulary (formatRelativeTime): it re-renders on an interval so a
// mounted "3m ago" advances to "4m ago" without a data refresh. All formatting
// — the '3m ago' / '2d ago' / '5mo ago' dialect and the naive-UTC parsing —
// lives in formatRelativeTime; do NOT re-implement the math here.
export function useRelativeTime(date) {
    const [, tick] = useState(0);
    useEffect(() => {
        if (!date) return undefined;
        const id = setInterval(() => tick(x => x + 1), 15_000);
        return () => clearInterval(id);
    }, [date]);
    return formatRelativeTime(date);
}
