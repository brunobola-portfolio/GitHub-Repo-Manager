import { useState } from 'react';
import { SafeMarkdown } from '../../AIPrompts/SafeMarkdown';
import { AIErrorState } from '../../ui/AIErrorState';
import { Button } from '../../ui/Button';
import { usePRCommand } from '../../../hooks/usePRCommand';

const COMMANDS = [
    {
        key: 'describe',
        label: '/describe',
        title: 'Generate or improve PR description',
        description: 'Drafts a structured description (Overview, What changed, Why, Risks, Test plan). You can publish it back to the PR with one click.',
    },
    {
        key: 'test_plan',
        label: '/test_plan',
        title: 'Generate a test plan',
        description: 'Up to 15 prioritised test cases (unit > integration > e2e) with Given/When/Then steps.',
    },
    {
        key: 'improve',
        label: '/improve',
        title: 'Surface code improvements',
        description: 'High-confidence improvements with optional inline replacement snippets. Capped at 20.',
    },
];

export function PRCommandsTab({ owner, repo, prNumber }) {
    return (
        <div className="flex flex-col gap-3 p-3">
            {COMMANDS.map((cmd) => (
                <PRCommandCard
                    key={cmd.key}
                    owner={owner}
                    repo={repo}
                    prNumber={prNumber}
                    command={cmd}
                />
            ))}
        </div>
    );
}

function PRCommandCard({ owner, repo, prNumber, command }) {
    const { result, loading, error, generate, publish, discard } = usePRCommand(owner, repo, prNumber, command.key);
    const [publishing, setPublishing] = useState(false);
    const [publishStatus, setPublishStatus] = useState(null);

    const onRun = async () => {
        try { await generate(); } catch { /* surfaced via error state */ }
    };

    const onPublish = async () => {
        setPublishing(true);
        setPublishStatus(null);
        try {
            const out = await publish();
            if (out?.demoOnly) {
                setPublishStatus({ kind: 'info', message: out.message || 'Demo mode — PR not modified.' });
            } else if (out?.queued) {
                setPublishStatus({ kind: 'info', message: 'Publish queued — will sync when GitHub is reachable.' });
            } else {
                setPublishStatus({ kind: 'success', message: 'PR description applied.' });
            }
        } catch (err) {
            setPublishStatus({ kind: 'error', message: err?.message || 'Failed to publish description.' });
        } finally {
            setPublishing(false);
        }
    };

    const onDiscard = async () => {
        try { await discard(); } catch { /* swallow — UI reflects state */ }
        setPublishStatus(null);
    };

    return (
        <section className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <header className="flex items-start justify-between gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{command.label}</code>
                        <h3 className="text-sm font-semibold truncate">{command.title}</h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{command.description}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                    {result ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={onDiscard}
                            disabled={loading}
                            title="Discard cached result"
                        >
                            Discard
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="primary"
                        size="xs"
                        onClick={onRun}
                        disabled={loading}
                    >
                        {loading ? 'Running…' : (result ? 'Re-run' : 'Run')}
                    </Button>
                </div>
            </header>

            <div className="px-3 py-3 text-sm">
                {error ? (
                    <AIErrorState
                        error={error}
                        onRetry={onRun}
                        context={`PR command ${command.label}`}
                        variant="inline"
                    />
                ) : null}

                {!result && !loading && !error ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No result yet. Click Run to generate.</p>
                ) : null}

                {result ? <PRCommandResult command={command.key} result={result} /> : null}

                {result && command.key === 'describe' ? (
                    <div className="mt-3 flex items-center gap-2">
                        <Button
                            type="button"
                            variant="success"
                            size="xs"
                            onClick={onPublish}
                            disabled={publishing}
                        >
                            {publishing ? 'Applying…' : 'Apply to PR'}
                        </Button>
                        {publishStatus ? (
                            <span className={`text-xs ${
                                publishStatus.kind === 'success'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : publishStatus.kind === 'error'
                                        ? 'text-red-600 dark:text-red-400'
                                        : 'text-slate-500 dark:text-slate-400'
                            }`}>
                                {publishStatus.message}
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </section>
    );
}

function PRCommandResult({ command, result }) {
    if (command === 'describe') return <DescribeResult result={result} />;
    if (command === 'test_plan') return <TestPlanResult result={result} />;
    if (command === 'improve') return <ImproveResult result={result} />;
    return null;
}

function DescribeResult({ result }) {
    return (
        <div className="space-y-2">
            {result?.title ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Suggested title: <span className="font-medium text-slate-700 dark:text-slate-200">{result.title}</span>
                </p>
            ) : null}
            <SafeMarkdown>{result?.body || ''}</SafeMarkdown>
        </div>
    );
}

function TestPlanResult({ result }) {
    const cases = Array.isArray(result?.cases) ? result.cases : [];
    return (
        <div className="space-y-3">
            {result?.summary ? <p className="text-xs text-slate-600 dark:text-slate-300">{result.summary}</p> : null}
            <ul className="space-y-2">
                {cases.map((c, i) => (
                    <li key={i} className="rounded border border-slate-200 dark:border-slate-700 p-2 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded ds-text-micro font-semibold uppercase ${priorityTone(c.priority)}`}>
                                {c.priority}
                            </span>
                            <span className="px-1.5 py-0.5 rounded ds-text-micro font-mono bg-slate-100 dark:bg-slate-800">{c.type}</span>
                            <span className="font-medium truncate">{c.name}</span>
                        </div>
                        {Array.isArray(c.steps) && c.steps.length > 0 ? (
                            <ol className="list-decimal list-inside space-y-0.5 text-slate-600 dark:text-slate-300">
                                {c.steps.map((step, j) => <li key={j}>{step}</li>)}
                            </ol>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ImproveResult({ result }) {
    const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
    return (
        <div className="space-y-3">
            {result?.summary ? <p className="text-xs text-slate-600 dark:text-slate-300">{result.summary}</p> : null}
            <ul className="space-y-2">
                {suggestions.map((s, i) => (
                    <li key={i} className="rounded border border-slate-200 dark:border-slate-700 p-2 text-xs">
                        <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded ds-text-micro font-semibold uppercase ${severityTone(s.severity)}`}>
                                {s.severity}
                            </span>
                            <span className="font-mono text-slate-700 dark:text-slate-300 truncate" title={s.path}>
                                {s.path}{typeof s.line === 'number' ? `:${s.line}` : ''}
                            </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200 whitespace-pre-line">{s.body}</p>
                        {s.suggestion ? (
                            <pre className="mt-2 overflow-x-auto rounded bg-slate-100 dark:bg-slate-800 p-2 ds-text-meta"><code>{s.suggestion}</code></pre>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function priorityTone(priority) {
    switch (priority) {
        case 'high': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
        case 'medium': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
        default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }
}

function severityTone(severity) {
    switch (severity) {
        case 'warning': return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
        case 'suggestion': return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
        default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    }
}
