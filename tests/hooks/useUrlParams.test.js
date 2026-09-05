import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
const { useUrlParams } = await import('@/hooks/useUrlParams');

beforeEach(() => {
    // Reset URL before each test
    window.history.replaceState(null, '', '/');
});

describe('useUrlParams', () => {
    it('reads initial values from window.location.search', () => {
        window.history.replaceState(null, '', '/?tab=stale&repos=a,b');
        const { result } = renderHook(() => useUrlParams(['tab', 'repos', 'other']));
        const [state] = result.current;
        expect(state.tab).toBe('stale');
        expect(state.repos).toBe('a,b');
        expect(state.other).toBe('');
    });

    it('set() updates history and local state', () => {
        const { result } = renderHook(() => useUrlParams(['tab']));
        const [, set] = result.current;
        act(() => { set({ tab: 'issues' }); });
        expect(window.location.search).toBe('?tab=issues');
        expect(result.current[0].tab).toBe('issues');
    });

    it('set() with empty string removes the param', () => {
        window.history.replaceState(null, '', '/?tab=stale');
        const { result } = renderHook(() => useUrlParams(['tab']));
        const [, set] = result.current;
        act(() => { set({ tab: '' }); });
        expect(window.location.search).toBe('');
    });

    it('set() with null removes the param', () => {
        window.history.replaceState(null, '', '/?tab=stale');
        const { result } = renderHook(() => useUrlParams(['tab']));
        const [, set] = result.current;
        act(() => { set({ tab: null }); });
        expect(window.location.search).toBe('');
    });

    it('set() preserves params not in the keys list', () => {
        window.history.replaceState(null, '', '/?tab=stale&unrelated=keep');
        const { result } = renderHook(() => useUrlParams(['tab']));
        const [, set] = result.current;
        act(() => { set({ tab: 'issues' }); });
        expect(window.location.search).toContain('tab=issues');
        expect(window.location.search).toContain('unrelated=keep');
    });

    // G5 regression: set() used to drop window.location.hash entirely, which
    // strips the VIEW route itself (useAppRouter routes an empty/absent hash
    // to the dashboard) — a bookmarked/reloaded filtered-view URL silently
    // lost both the intended view and the filters this hook exists to make
    // bookmarkable (caught live-testing the Repositories filter bar: typing
    // in the search box turned `#/repos?q=x` into `?q=x`, and reloading
    // landed on Dashboard instead of a filtered Repositories view).
    it('set() preserves the hash (view route) alongside the query string', () => {
        window.history.replaceState(null, '', '/#/repos');
        const { result } = renderHook(() => useUrlParams(['q']));
        const [, set] = result.current;
        act(() => { set({ q: 'api' }); });
        expect(window.location.hash).toBe('#/repos');
        expect(window.location.search).toBe('?q=api');
    });

    it('set() clearing the last param still preserves the hash', () => {
        window.history.replaceState(null, '', '/?q=api#/repos');
        const { result } = renderHook(() => useUrlParams(['q']));
        const [, set] = result.current;
        act(() => { set({ q: '' }); });
        expect(window.location.hash).toBe('#/repos');
        expect(window.location.search).toBe('');
    });
});
