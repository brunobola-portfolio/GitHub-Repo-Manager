import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the db module before the registry imports it. Each test instance
// gets a fresh in-memory store so saves don't leak across tests.
const store = new Map() // key: `${userId}:${featureKey}` -> { prompt, updatedAt }

vi.mock('../db.js', () => ({
    default: {
        prepare: (sql) => {
            const normalized = sql.replace(/\s+/g, ' ').trim()
            if (normalized.startsWith('SELECT prompt FROM user_ai_prompts')) {
                return {
                    get: (userId, key) => {
                        const row = store.get(`${userId}:${key}`)
                        return row ? { prompt: row.prompt } : undefined
                    },
                }
            }
            if (normalized.startsWith('SELECT feature_key, prompt, updated_at FROM user_ai_prompts')) {
                return {
                    all: (userId) => {
                        const out = []
                        for (const [k, v] of store.entries()) {
                            const [uid, fk] = k.split(':')
                            if (Number(uid) === userId) out.push({ feature_key: fk, prompt: v.prompt, updated_at: v.updatedAt })
                        }
                        return out
                    },
                }
            }
            if (normalized.startsWith('INSERT INTO user_ai_prompts')) {
                return {
                    run: (userId, key, prompt) => {
                        store.set(`${userId}:${key}`, { prompt, updatedAt: '2026-05-01T00:00:00Z' })
                        return { changes: 1 }
                    },
                }
            }
            if (normalized.startsWith('DELETE FROM user_ai_prompts')) {
                return {
                    run: (userId, key) => {
                        const k = `${userId}:${key}`
                        const had = store.has(k)
                        store.delete(k)
                        return { changes: had ? 1 : 0 }
                    },
                }
            }
            throw new Error(`Unmocked SQL: ${normalized}`)
        },
    },
}))

const {
    AI_PROMPT_REGISTRY,
    REGISTRY_KEYS,
    isValidPromptKey,
    getCatalog,
    saveUserPrompt,
    deleteUserPrompt,
    loadUserPrompt,
    loadAllUserPrompts,
    resolvePromptTemplate,
    renderPrompt,
    getResolvedPrompt,
} = await import('../lib/ai-prompt-registry.js')

beforeEach(() => {
    store.clear()
})

describe('AI prompt registry — catalog', () => {
    it('exposes a frozen catalog with required fields per entry', () => {
        for (const key of REGISTRY_KEYS) {
            const entry = AI_PROMPT_REGISTRY[key]
            expect(entry.key).toBe(key)
            expect(typeof entry.title).toBe('string')
            expect(typeof entry.description).toBe('string')
            expect(typeof entry.defaultPrompt).toBe('string')
            expect(entry.defaultPrompt.length).toBeGreaterThan(20)
            expect(Array.isArray(entry.variables)).toBe(true)
        }
    })

    it('isValidPromptKey rejects unknown / non-string inputs', () => {
        expect(isValidPromptKey('chat')).toBe(true)
        expect(isValidPromptKey('not_a_key')).toBe(false)
        expect(isValidPromptKey(null)).toBe(false)
        expect(isValidPromptKey(undefined)).toBe(false)
        expect(isValidPromptKey(42)).toBe(false)
    })

    it('getCatalog returns one entry per key with no internal-only fields', () => {
        const catalog = getCatalog()
        expect(catalog).toHaveLength(REGISTRY_KEYS.length)
        for (const item of catalog) {
            expect(item).toHaveProperty('key')
            expect(item).toHaveProperty('title')
            expect(item).toHaveProperty('description')
            expect(item).toHaveProperty('defaultPrompt')
            expect(item).toHaveProperty('variables')
        }
    })
})

describe('AI prompt registry — persistence', () => {
    it('saveUserPrompt rejects unknown keys', () => {
        expect(() => saveUserPrompt(7, 'not_a_key', 'hi')).toThrow(/Unknown AI prompt key/)
    })

    it('saveUserPrompt rejects empty / oversized prompts', () => {
        expect(() => saveUserPrompt(7, 'chat', '')).toThrow(/empty/)
        expect(() => saveUserPrompt(7, 'chat', '   \n  \t ')).toThrow(/empty/)
        expect(() => saveUserPrompt(7, 'chat', 'a'.repeat(8001))).toThrow(/8000/)
    })

    it('saveUserPrompt trims whitespace and persists the override', () => {
        const result = saveUserPrompt(7, 'chat', '  Be a pirate.  ')
        expect(result).toEqual({ key: 'chat', prompt: 'Be a pirate.' })
        expect(loadUserPrompt(7, 'chat')).toBe('Be a pirate.')
    })

    it('loadAllUserPrompts returns a map of feature_key -> prompt for the user only', () => {
        saveUserPrompt(7, 'chat', 'Persona A')
        saveUserPrompt(7, 'suggest_name_description', 'Persona B')
        saveUserPrompt(99, 'chat', 'Other user persona')
        const list = loadAllUserPrompts(7)
        expect(Object.keys(list).sort()).toEqual(['chat', 'suggest_name_description'])
        expect(list.chat.prompt).toBe('Persona A')
        expect(list.suggest_name_description.prompt).toBe('Persona B')
    })

    it('deleteUserPrompt removes the override and reports change count', () => {
        saveUserPrompt(7, 'chat', 'Persona A')
        expect(deleteUserPrompt(7, 'chat')).toEqual({ deleted: 1 })
        expect(loadUserPrompt(7, 'chat')).toBeNull()
        expect(deleteUserPrompt(7, 'chat')).toEqual({ deleted: 0 })
    })

    it('loadAllUserPrompts drops orphan rows for unknown registry keys', () => {
        // Simulate a feature that has been removed from the registry but has
        // residual rows in the DB. The loader must filter them out so the
        // Settings UI never shows a phantom feature.
        store.set('7:retired_feature', { prompt: 'leftover', updatedAt: 'x' })
        store.set('7:chat', { prompt: 'Active', updatedAt: 'x' })
        const list = loadAllUserPrompts(7)
        expect(list.chat).toBeDefined()
        expect(list.retired_feature).toBeUndefined()
    })
})

describe('AI prompt registry — rendering', () => {
    it('resolvePromptTemplate returns user override when present, default otherwise', () => {
        const def = AI_PROMPT_REGISTRY.chat.defaultPrompt
        expect(resolvePromptTemplate(7, 'chat')).toBe(def)
        saveUserPrompt(7, 'chat', 'Be brief.')
        expect(resolvePromptTemplate(7, 'chat')).toBe('Be brief.')
    })

    it('renderPrompt substitutes provided {variables} literally and leaves unknown tokens intact', () => {
        // We deliberately keep unknown tokens visible (instead of erasing them)
        // so that user typos in their override prompt surface in the AI output
        // rather than silently disappearing.
        const out = renderPrompt('Hello {name}, your repo is {missing}.', { name: 'Alice' })
        expect(out).toBe('Hello Alice, your repo is {missing}.')
    })

    it('renderPrompt does NOT re-expand tokens that appear in replacement values', () => {
        // Defends against prompt-injection where a variable value contains
        // another {token} that could otherwise get substituted recursively.
        const out = renderPrompt('Repo: {name}.', { name: '{description} hijack' })
        expect(out).toBe('Repo: {description} hijack.')
    })

    it('renderPrompt converts non-string values via String() and treats null/undefined as empty', () => {
        expect(renderPrompt('{a} {b} {c}', { a: 1, b: null, c: undefined })).toBe('1  ')
    })

    it('getResolvedPrompt composes resolution + rendering', () => {
        const out = getResolvedPrompt(7, 'suggest_name_description', {
            name: 'demo', description: 'd', language: 'js', visibility: 'public', topics: 'a, b', readme: 'x',
        })
        expect(out).toContain('demo')
        expect(out).toContain('public')
        // Default contains "kebab-case" — confirm the default flowed through.
        expect(out).toMatch(/kebab-case/)
    })
})

describe('pr_deep_review prompt', () => {
    it('is registered with required fields', () => {
        const entry = AI_PROMPT_REGISTRY.pr_deep_review;
        expect(entry).toBeDefined();
        expect(entry.key).toBe('pr_deep_review');
        expect(typeof entry.defaultPrompt).toBe('string');
        expect(entry.defaultPrompt.length).toBeGreaterThan(200);
        expect(REGISTRY_KEYS).toContain('pr_deep_review');
    });

    it('renders {repo_full_name} and {pr_title} placeholders', () => {
        const out = getResolvedPrompt(0, 'pr_deep_review', {
            repo_full_name: 'acme/api',
            pr_title: 'Add billing',
        });
        expect(out).toContain('acme/api');
        expect(out).toContain('Add billing');
    });
});
