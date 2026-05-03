import { useState } from 'react';

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
            scopeTarget: scope === 'repo' ? scopeTarget : null,
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
                <div>
                    <label className="block text-xs font-medium mb-1" htmlFor="prompt-editor-name">Name</label>
                    <input
                        id="prompt-editor-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        maxLength={100}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1" htmlFor="prompt-editor-key">Preset key (alphanum + dash/underscore)</label>
                    <input
                        id="prompt-editor-key"
                        type="text"
                        value={presetKey}
                        onChange={(e) => setPresetKey(e.target.value)}
                        required
                        pattern="^[a-z0-9_-]{1,40}$"
                        disabled={isEdit}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm font-mono disabled:opacity-60"
                    />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-xs font-medium mb-1" htmlFor="prompt-editor-scope">Scope</label>
                        <select
                            id="prompt-editor-scope"
                            value={scope}
                            onChange={(e) => setScope(e.target.value)}
                            disabled={isEdit}
                            className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm disabled:opacity-60"
                        >
                            <option value="user">User (all repos)</option>
                            <option value="repo">Repo</option>
                        </select>
                    </div>
                    {scope === 'repo' ? (
                        <div>
                            <label className="block text-xs font-medium mb-1" htmlFor="prompt-editor-scope-target">Repo (owner/name)</label>
                            <input
                                id="prompt-editor-scope-target"
                                type="text"
                                value={scopeTarget}
                                onChange={(e) => setScopeTarget(e.target.value)}
                                placeholder="acme/api"
                                required
                                className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm font-mono"
                            />
                        </div>
                    ) : null}
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1" htmlFor="prompt-editor-body">System prompt</label>
                    <textarea
                        id="prompt-editor-body"
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        required
                        maxLength={8000}
                        rows={10}
                        placeholder='Use ${REPO_STYLE_GUIDE} to inject .repomanager/review-rules.md content.'
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm font-mono"
                    />
                    <div className="text-[10px] opacity-60 mt-1">{systemPrompt.length} / 8000</div>
                </div>
                <div>
                    <label className="block text-xs font-medium mb-1" htmlFor="prompt-editor-severity">Severity floor (drops below-floor comments)</label>
                    <select
                        id="prompt-editor-severity"
                        value={severityFloor}
                        onChange={(e) => setSeverityFloor(e.target.value)}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
                    >
                        <option value="">No floor</option>
                        <option value="info">Info+</option>
                        <option value="suggestion">Suggestion+</option>
                        <option value="warning">Warning+</option>
                        <option value="critical">Critical only</option>
                    </select>
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
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-2">Maximum {MAX_PATH_RULES} rules</span>
                        ) : null}
                    </div>
                    {pathRules.length === 0 ? (
                        <div className="text-xs opacity-60">No path rules.</div>
                    ) : (
                        <ul className="space-y-2">
                            {pathRules.map((r, i) => (
                                <li key={i} className="rounded border border-slate-200 dark:border-slate-700 p-2 space-y-1">
                                    <input
                                        type="text"
                                        value={r.glob}
                                        onChange={(e) => updateRule(i, { glob: e.target.value })}
                                        placeholder="src/components/**"
                                        aria-label={`Path glob ${i + 1}`}
                                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs font-mono"
                                    />
                                    <textarea
                                        value={r.extraPrompt}
                                        onChange={(e) => updateRule(i, { extraPrompt: e.target.value })}
                                        placeholder="Extra guidance for files matching this glob"
                                        rows={2}
                                        aria-label={`Path rule prompt ${i + 1}`}
                                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
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
