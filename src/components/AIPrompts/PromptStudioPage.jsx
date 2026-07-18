import { useState, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { usePromptStudio } from '../../hooks/usePromptStudio';
import { useDangerAction } from '../../hooks/useDangerAction';
import { useToast } from '../../hooks/useToast';
import { PageHeader } from '../ui/PageHeader';
import { Button } from '../ui/Button';
import { PromptLibrary } from './PromptLibrary';
import { PromptEditor } from './PromptEditor';

/**
 * Page shell for the Prompt Studio. Defaults to the Library view; switches
 * to the Editor when the user clicks New / Edit. Custom preset CRUD is free
 * on every tier (2026-07-18 rebalance) — the server caps creation at
 * `promptPresetsMax` owned presets (Free: 10, Pro/Enterprise: unlimited) and
 * returns a 403 once the cap is hit, surfaced below via toast.
 */
export function PromptStudioPage() {
    const studio = usePromptStudio();
    const { toast } = useToast();
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
                // Free tier is capped at promptPresetsMax owned presets — the
                // server 403s once the cap is hit; surface that (and any
                // other save failure) instead of letting it go unhandled.
                await studio.save(payload);
            }
            setView({ mode: 'library' });
        } catch (err) {
            toast.errorFromException(err, { fallbackTitle: 'Failed to save preset' });
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
