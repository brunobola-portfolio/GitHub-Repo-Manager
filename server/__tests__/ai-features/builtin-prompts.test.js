import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS, BUILTIN_KEYS, isBuiltinKey, getBuiltin } from '../../lib/ai-features/builtin-prompts.js';

describe('builtin-prompts', () => {
    it('exports exactly the 5 documented presets', () => {
        expect(BUILTIN_KEYS).toEqual(['general', 'security', 'performance', 'accessibility', 'refactor']);
    });

    it('each preset has key/name/body/severityFloor', () => {
        for (const k of BUILTIN_KEYS) {
            const p = BUILTIN_PRESETS[k];
            expect(p.key).toBe(k);
            expect(typeof p.name).toBe('string');
            expect(p.name.length).toBeGreaterThan(0);
            expect(typeof p.body).toBe('string');
            expect(p.body.length).toBeGreaterThan(100);
            // severityFloor is null OR a valid enum
            if (p.severityFloor !== null) {
                expect(['info','suggestion','warning','critical']).toContain(p.severityFloor);
            }
        }
    });

    it('security and refactor presets carry severity floors', () => {
        expect(BUILTIN_PRESETS.security.severityFloor).toBe('warning');
        expect(BUILTIN_PRESETS.refactor.severityFloor).toBe('info');
    });

    it('isBuiltinKey returns true only for registered keys', () => {
        expect(isBuiltinKey('general')).toBe(true);
        expect(isBuiltinKey('security')).toBe(true);
        expect(isBuiltinKey('nope')).toBe(false);
        expect(isBuiltinKey('')).toBe(false);
        expect(isBuiltinKey(null)).toBe(false);
        expect(isBuiltinKey(undefined)).toBe(false);
    });

    it('getBuiltin returns the preset or null', () => {
        expect(getBuiltin('general')).toEqual(BUILTIN_PRESETS.general);
        expect(getBuiltin('nope')).toBeNull();
    });
});
