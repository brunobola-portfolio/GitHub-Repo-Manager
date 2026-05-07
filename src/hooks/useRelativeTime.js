import { useEffect, useState } from 'react';

// Accept Date | string | number — API responses arrive as ISO strings, not
// Date instances, so calling date.getTime() on a string throws.
function toDate(input) {
    if (input == null) return null;
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
}

function format(input) {
    const date = toDate(input);
    if (!date) return '';
    const diffMs = Date.now() - date.getTime();
    const secs = Math.max(0, Math.round(diffMs / 1000));
    if (secs < 15) return 'just now';
    if (secs < 60) return `${secs} s ago`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

export function useRelativeTime(date) {
    const [, tick] = useState(0);
    useEffect(() => {
        if (!date) return undefined;
        const id = setInterval(() => tick(x => x + 1), 15_000);
        return () => clearInterval(id);
    }, [date]);
    return format(date);
}
