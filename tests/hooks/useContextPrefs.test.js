import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useContextPrefs, DEFAULT_SIGNALS } from '../../src/hooks/useContextPrefs.js';

beforeEach(() => localStorage.clear());

describe('useContextPrefs', () => {
    it('returns defaults when localStorage is empty', () => {
        const { result } = renderHook(() => useContextPrefs());
        expect(result.current.prefs.signals).toEqual(DEFAULT_SIGNALS);
    });

    it('persists toggle changes to localStorage', () => {
        const { result } = renderHook(() => useContextPrefs());
        act(() => result.current.setSignal('entrypoints', true));
        expect(JSON.parse(localStorage.getItem('ai-context-prefs-v1')).signals.entrypoints).toBe(true);
    });

    it('rehydrates from existing localStorage value', () => {
        localStorage.setItem('ai-context-prefs-v1', JSON.stringify({ signals: { ...DEFAULT_SIGNALS, entrypoints: true } }));
        const { result } = renderHook(() => useContextPrefs());
        expect(result.current.prefs.signals.entrypoints).toBe(true);
    });

    it('reset() restores defaults', () => {
        const { result } = renderHook(() => useContextPrefs());
        act(() => result.current.setSignal('entrypoints', true));
        act(() => result.current.reset());
        expect(result.current.prefs.signals).toEqual(DEFAULT_SIGNALS);
    });

    it('ignores corrupt JSON and falls back to defaults', () => {
        localStorage.setItem('ai-context-prefs-v1', 'not-json');
        const { result } = renderHook(() => useContextPrefs());
        expect(result.current.prefs.signals).toEqual(DEFAULT_SIGNALS);
    });
});
