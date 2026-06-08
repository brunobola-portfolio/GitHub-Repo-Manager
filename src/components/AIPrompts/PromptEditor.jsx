import { useState } from 'react';
import { Field, Input, Textarea } from '../ui/form';
import { Select } from '../ui/Select';

const MAX_PATH_RULES = 20;

/**
 * Split-pane editor for a custom prompt preset.
 *
 * Left: form (name, key, scope, body, severity floor, path rules).
 * Right: "Run test" button + last sample-diff result. Test is only available
 * once the preset is saved (the server endpoint takes an :id).
 *
 * On edit, the preset key + scope are locked because they are part of the
 * unique index and changing them would shadow built-ins or collide with
 * other rows. Users can delete + recreate if they need a different scope.
 */
export function PromptEditor({ initial, onSave, onCancel, onTest, saving }) {
    const [scope, setScope] = useState(initial?.scope ?? 'user');
    const [scopeTarget, setScopeTarget] = useState(initial?.scopeTarget ?? '');
    const [presetKey, setPresetKey] = useState(initial?.presetKey ?? '');
    const [name, setName] = useState(initial?.name ?? '');
    const [systemPrompt, setSystemPrompt] = useState(initial?.body ?? initial?.systemPrompt ?? '');
    const [severityFloor, setSeverityFloor] = useState(initial?.severityFloor ?? '');
    const [pathRules, setPathRules] = useState(initial?.pathRules ?? []);
    const [testResult, setTestResult] = useState(null);
    const [testing, setTesting] = useState(false);
    const [testError, setTestError] = useState(null);

    const isEdit = !!initial?.id;

    function addRule() {
        setPathRules((r) => r.length >= MAX_PATH_RULES ? r : [...r, { glob: '', extraPrompt: '' }]);
    }
    function updateRule(idx, patch) {
        setPathRules((r) => r.map((rule, i) => i === idx ? { ...rule, ...patch } : rule));
    }
    function removeRule(idx) {
        setPathRules((r) => r.filter((_, i) => i !== idx));
    }

    async function handleSave() {
        const payload = {
            scope,
            scopeTarget: (scope === 'repo' || scope === 'org') ? scopeTarget : null,
            presetKey,
            name,
            systemPrompt,
            severityFloor: severityFloor || null,
            pathRules: pathRules.filter((r) => r.glob && r.extraPrompt),
        };
        await onSave(payload, isEdit ? initial.id : null);
    }

    async function handleTest() {
        if (!isEdit) {
            setTestError('Save the preset first to test it.');
            return;
        }
        setTesting(true);
        setTestError(null);
        try {
            const result = await onTest(initial.id);
            setTestResult(result);
        } catch (err) {
            setTestError(err.message || 'Test failed');
        } finally {
            setTesting(false);
        }
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
                <Field label="Name" htmlFor="prompt-editor-name" required>
                    <Input
                        id="prompt-editor-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={100}
                        size="sm"
                    />
                </Field>
                <Field label="Preset key (alphanum + dash/underscore)" htmlFor="prompt-editor-key" required>
                    <Input
                        id="prompt-editor-key"
                        type="text"
                        value={presetKey}
                        onChange={(e) => setPresetKey(e.target.value)}
                        required
                        pattern="^[a-z0-9_-]{1,40}$"
                        disabled={isEdit}
                        size="sm"
                        className="font-mono"
                    />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <span className="block text-xs font-medium mb-1">Scope</span>
                        <Select
                            label="Scope"
                            value={scope}
                            onChange={(v) => setScope(v)}
                            disabled={isEdit}
                            size="sm"
                            options={[
                                { value: 'user', label: 'User (all repos)' },
                                { value: 'repo', label: 'Repo' },
                                { value: 'org', label: 'Organization (all members)' },
                            ]}
                        />
                    </div>
                    {scope === 'repo' ? (
                        <Field label="Repo (owner/name)" htmlFor="prompt-editor-scope-target" required>
                            <Input
                                id="prompt-editor-scope-target"
                                type="text"
                                value={scopeTarget}
                                onChange={(e) => setScopeTarget(e.target.value)}
                                placeholder="acme/api"
                                required
                                size="sm"
                                className="font-mono"
                            />
                        </Field>
                    ) : null}
                    {scope === 'org' ? (
                        <Field label="Organization (login)" htmlFor="prompt-editor-scope-target" required>
                            <Input
                                id="prompt-editor-scope-target"
                                type="text"
                                value={scopeTarget}
                                onChange={(e) => setScopeTarget(e.target.value)}
                                placeholder="acme"
                                required
                                pattern="^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$"
                                maxLength={39}
                                title="GitHub org login (alphanumeric + . _ -, max 39 chars)"
                                size="sm"
                                className="font-mono"
                            />
                        </Field>
                    ) : null}
                </div>
                {scope === 'org' ? (
                    <p className="ds-text-meta opacity-70 -mt-1">
                        Org-shared presets are visible to every active member of the organization. Only you (the author) can edit or delete this preset.
                    </p>
                ) : null}
                <div>
                    <Field label="System prompt" htmlFor="prompt-editor-body" required>
                        <Textarea
                            id="prompt-editor-body"
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            required
                            maxLength={8000}
                            rows={10}
                            placeholder='Use ${REPO_STYLE_GUIDE} to inject .repomanager/review-rules.md content.'
                            className="font-mono"
                        />
                    </Field>
                    <div className="ds-text-micro opacity-60 mt-1">{systemPrompt.length} / 8000</div>
                </div>
                <div>
                    <span className="block text-xs font-medium mb-1">Severity floor (drops below-floor comments)</span>
                    <Select
                        label="Severity floor"
                        value={severityFloor}
                        onChange={(v) => setSeverityFloor(v)}
                        placeholder="No floor"
                        size="sm"
                        options={[
                            { value: '', label: 'No floor' },
                            { value: 'info', label: 'Info+' },
                            { value: 'suggestion', label: 'Suggestion+' },
                            { value: 'warning', label: 'Warning+' },
                            { value: 'critical', label: 'Critical only' },
                        ]}
                    />
                </div>
                <div>
                    <div className="flex items-center mb-1">
                        <span className="block text-xs font-medium flex-1">Path-scoped rules</span>
                        <button
                            type="button"
                            onClick={addRule}
                            disabled={pathRules.length >= MAX_PATH_RULES}
                            className="text-xs px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                            + Add
                        </button>
                        {pathRules.length >= MAX_PATH_RULES ? (
                            <span className="ds-text-micro text-amber-600 dark:text-amber-400 ml-2">Maximum {MAX_PATH_RULES} rules</span>
                        ) : null}
                    </div>
                    {pathRules.length === 0 ? (
                        <div className="text-xs opacity-60">No path rules.</div>
                    ) : (
                        <ul className="space-y-2">
                            {pathRules.map((r, i) => (
                                <li key={i} className="rounded border border-slate-200 dark:border-slate-700 p-2 space-y-1">
                                    <Input
                                        type="text"
                                        value={r.glob}
                                        onChange={(e) => updateRule(i, { glob: e.target.value })}
                                        placeholder="src/components/**"
                                        aria-label={`Path glob ${i + 1}`}
                                        size="sm"
                                        className="font-mono text-xs"
                                    />
                                    <Textarea
                                        value={r.extraPrompt}
                                        onChange={(e) => updateRule(i, { extraPrompt: e.target.value })}
                                        placeholder="Extra guidance for files matching this glob"
                                        rows={2}
                                        aria-label={`Path rule prompt ${i + 1}`}
                                        className="text-xs"
                                    />
                                    <button type="button" onClick={() => removeRule(i)} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm rounded hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
                    <button type="submit" disabled={saving} className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                        {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create preset')}
                    </button>
                </div>
            </form>

            <div className="space-y-3">
                <div className="flex items-center">
                    <h3 className="text-sm font-medium flex-1">Test on a sample diff</h3>
                    <button
                        type="button"
                        onClick={handleTest}
                        disabled={!isEdit || testing}
                        className="px-3 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                    >
                        {testing ? 'Running…' : 'Run test'}
                    </button>
                </div>
                {!isEdit ? (
                    <p className="text-xs opacity-60">Save the preset first, then run a test against a fixed sample diff.</p>
                ) : null}
                {testError ? (
                    <p className="text-xs text-red-600 dark:text-red-400">{testError}</p>
                ) : null}
                {testResult ? (
                    <div className="rounded border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-2">
                        <div><strong>Used:</strong> {testResult.presetName} <span className="opacity-60">({testResult.source})</span></div>
                        <div><strong>Walkthrough:</strong>
                            <p className="mt-1 whitespace-pre-wrap">{testResult.sample?.walkthrough?.summary}</p>
                        </div>
                        <div><strong>Comments ({testResult.sample?.lineComments?.length ?? 0}):</strong>
                            <ul className="mt-1 space-y-1">
                                {(testResult.sample?.lineComments ?? []).map((c, i) => (
                                    <li key={i} className="border-l-2 border-slate-300 dark:border-slate-700 pl-2">
                                        <span className="font-medium">{c.severity}</span> · {c.path}:{c.line} — {c.body}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
