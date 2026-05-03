import { useState } from 'react';
import { usePromptStudio } from '../../hooks/usePromptStudio';
import { PromptLibrary } from './PromptLibrary';
import { PromptEditor } from './PromptEditor';

/**
 * Page shell for the Prompt Studio. Defaults to the Library view; switches
 * to the Editor when the user clicks New / Edit. Tier gating happens in the
 * Library (CTA disabled / upgrade hint) and on the server (POST/PATCH/DELETE
 * are requireTier('pro')).
 */
export function PromptStudioPage({ currentTier = 'free' }) {
    const studio = usePromptStudio();
    const [view, setView] = useState({ mode: 'library' }); // {mode:'library'} | {mode:'editor', initial?}
    const [saving, setSaving] = useState(false);

    async function handleEdit(id) {
        const full = await studio.getPreset(id);
        setView({ mode: 'editor', initial: full });
    }

    function handleNew() {
        setView({ mode: 'editor', initial: null });
    }

    async function handleSave(payload, id) {
        setSaving(true);
        try {
            if (id) {
                // Scope/key are locked on edit (server rejects changes anyway).
                const { scope, scopeTarget, presetKey, ...patch } = payload;
                void scope; void scopeTarget; void presetKey;
                await studio.update(id, patch);
            } else {
                await studio.save(payload);
            }
            setView({ mode: 'library' });
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id) {
        // Project-wide pattern for ad-hoc confirms; switch to ConfirmModal if
        // we expand the surface beyond this page.
         
        if (!window.confirm('Delete this preset?')) return;
        await studio.remove(id);
    }

    async function handleSetDefault(id) {
        await studio.setDefault(id);
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <div className="mb-4 flex items-center">
                <h1 className="text-2xl font-bold flex-1">Prompt Studio</h1>
                {view.mode === 'editor' ? (
                    <button type="button" onClick={() => setView({ mode: 'library' })} className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
                        ← Back to library
                    </button>
                ) : null}
            </div>
            {studio.error ? (
                <div className="mb-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-900 dark:text-red-200">
                    {studio.error}
                </div>
            ) : null}
            {view.mode === 'library' ? (
                <PromptLibrary
                    presets={studio.presets}
                    loading={studio.loading}
                    onNew={handleNew}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onSetDefault={handleSetDefault}
                    currentTier={currentTier}
                />
            ) : (
                <PromptEditor
                    initial={view.initial}
                    onSave={handleSave}
                    onCancel={() => setView({ mode: 'library' })}
                    onTest={studio.test}
                    saving={saving}
                />
            )}
        </div>
    );
}
