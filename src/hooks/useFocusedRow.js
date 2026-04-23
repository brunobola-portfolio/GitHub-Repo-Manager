import { useState, useEffect, useCallback } from 'react'

export function useFocusedRow(items = []) {
    const [focusedIndex, setFocusedIndex] = useState(-1);

    const handleKey = useCallback((e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        if (e.key === 'j') {
            setFocusedIndex(prev => Math.min(prev + 1, items.length - 1));
        } else if (e.key === 'k') {
            setFocusedIndex(prev => Math.max(prev - 1, -1));
        } else if (e.key === 'Escape') {
            setFocusedIndex(-1);
        }
    }, [items.length]);

    useEffect(() => {
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [handleKey]);

    return {
        focusedIndex,
        setFocusedIndex,
        focusedItem: focusedIndex >= 0 ? (items[focusedIndex] ?? null) : null,
    };
}
