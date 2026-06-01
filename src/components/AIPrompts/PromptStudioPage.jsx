import { useState, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { usePromptStudio } from '../../hooks/usePromptStudio';
import { useDangerAction } from '../../hooks/useDangerAction';
import { PageHeader } from '../ui/PageHeader';
import { Button } from '../ui/Button';
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

    // Destructive confirm via the shared premium ConfirmModal (dark-mode aware)
    // instead of the native window.confirm dialog. The id varies per call, so
    // it's stashed in a ref the (always-fresh) onConfirm closure reads.
    const pendingDeleteId = useRef(null);
    const deletePreset = useDangerAction({
        title: 'Delete preset?',
        message: 'This permanently deletes this prompt preset and cannot be undone.',
        variant: 'danger',
        confirmText: 'Delete',
        onConfirm: () => studio.remove(pendingDeleteId.current),
    });

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
        pendingDeleteId.current = id;
        await deletePreset.run();
    }

    async function handleSetDefault(id) {
        await studio.setDefault(id);
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <PageHeader
                eyebrow="AI Prompts"
                icon={Sparkles}
                title="Prompt Studio"
                description="Manage reusable prompt presets for AI features across the app."
                actions={view.mode === 'editor' ? (
                    <Button variant="ghost" size="sm" onClick={() => setView({ mode: 'library' })}>
                        ← Back to library
                    </Button>
                ) : null}
            />
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
