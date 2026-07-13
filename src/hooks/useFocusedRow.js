import { useState, useEffect, useCallback, useRef } from 'react'
import { isBlockingDialogOpen } from '../utils/dialogState'

/**
 * Linear-style row navigation for list views.
 *
 *   j  → next row
 *   k  → previous row
 *   Enter → fire `onOpen(item)` for the focused row
 *   Escape → clear focus
 *
 * Disabled while the user is typing in INPUT/TEXTAREA/contenteditable so
 * j/k inside a search box don't hijack the keys.
 *
 * Also disabled while a blocking dialog is open (see `isBlockingDialogOpen`),
 * so the keys don't silently move the hidden background list's selection
 * while a ConfirmModal or similar sits on top of it. Explicitly non-modal
 * dialogs (`aria-modal="false"` popovers) don't suppress navigation.
 *
 * @param {Array} items
 * @param {object} [opts]
 * @param {(item:any) => void} [opts.onOpen] — invoked on Enter when focused
 */
export function useFocusedRow(items = [], opts = {}) {
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const onOpenRef = useRef(opts.onOpen);
    useEffect(() => { onOpenRef.current = opts.onOpen }, [opts.onOpen]);

    const handleKey = useCallback((e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (document.activeElement?.isContentEditable) return;
        if (isBlockingDialogOpen()) return;

        if (e.key === 'j') {
            e.preventDefault();
            setFocusedIndex(prev => Math.min(prev + 1, items.length - 1));
        } else if (e.key === 'k') {
            e.preventDefault();
            setFocusedIndex(prev => Math.max(prev - 1, -1));
        } else if (e.key === 'Escape') {
            setFocusedIndex(-1);
        } else if (e.key === 'Enter') {
            if (focusedIndex >= 0 && onOpenRef.current) {
                e.preventDefault();
                onOpenRef.current(items[focusedIndex]);
            }
        }
    }, [items, focusedIndex]);

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
