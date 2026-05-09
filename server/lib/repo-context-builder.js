import { githubApi } from './github-api.js';
import { redact } from './secret-redactor.js';
import logger from './logger.js';

const DEFAULT_BYTE_CAP = 8192;

const MANIFEST_CANDIDATES = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'Gemfile',
    'composer.json',
];

const ENTRYPOINT_CANDIDATES = [
    'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
    'src/app.js', 'src/app.ts',
    'index.js', 'index.ts',
    'main.py', 'app.py', 'app/__init__.py',
    'cmd/main.go', 'main.go',
    'src/main/java/Main.java',
    'src/main.rs',
];

const ENTRYPOINT_PER_FILE_CAP = 512;
const ENTRYPOINT_MAX_FILES = 3;

const SIGNAL_BUDGETS = {
    readme: 3072,
    manifest: 1536,
    entrypoints: 1536,
    folderStructure: 512,
    topicsLanguage: 256,
};

async function fetchTextFile(owner, repo, path, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
        return null;
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo, path }, 'repo-context-builder: file fetch failed');
        return null;
    }
}

async function fetchReadme(owner, repo, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/readme`, accessToken);
        if (data?.encoding === 'base64' && typeof data.content === 'string') {
            return Buffer.from(data.content, 'base64').toString('utf8');
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'repo-context-builder: README fetch failed');
    }
    return null;
}

async function fetchManifest(owner, repo, accessToken) {
    for (const candidate of MANIFEST_CANDIDATES) {
        const content = await fetchTextFile(owner, repo, candidate, accessToken);
        if (typeof content === 'string') return { label: candidate, content };
    }
    return null;
}

async function fetchEntrypoints(owner, repo, accessToken) {
    const found = [];
    for (const path of ENTRYPOINT_CANDIDATES) {
        if (found.length >= ENTRYPOINT_MAX_FILES) break;
        const content = await fetchTextFile(owner, repo, path, accessToken);
        if (typeof content === 'string') found.push({ path, content });
    }
    return found;
}

async function fetchTopLevelDirs(owner, repo, accessToken) {
    try {
        const { data } = await githubApi(`/repos/${owner}/${repo}/contents/`, accessToken);
        if (Array.isArray(data)) {
            return data.filter((e) => e?.type === 'dir').map((e) => e.name);
        }
    } catch (e) {
        if (e?.status !== 404) logger.warn({ err: e, owner, repo }, 'repo-context-builder: top-level listing failed');
    }
    return [];
}

function pushSection(sections, { kind, label, content, byteCap }) {
    const truncated = content.slice(0, byteCap);
    const { content: cleaned, count } = redact(truncated);
    sections.push({
        kind,
        label,
        content: cleaned,
        bytes: cleaned.length,
        redactions: count,
    });
}

function topicsLanguageContent({ topics, language }) {
    const parts = [];
    if (language) parts.push(`language: ${language}`);
    if (Array.isArray(topics) && topics.length) parts.push(`topics: ${topics.slice(0, 10).join(', ')}`);
    return parts.join('\n');
}

function computeConfidence({ readmeBytes, manifestPresent, topicsPresent, languagePresent }) {
    if (readmeBytes >= 500 && manifestPresent && (topicsPresent || languagePresent)) return 'high';
    if (readmeBytes >= 100 || manifestPresent) return 'medium';
    return 'low';
}

export async function buildContext({
    accessToken,
    owner,
    repo,
    signals = {},
    customFiles = [],
    byteCap = DEFAULT_BYTE_CAP,
    topicsLanguageInputs = { topics: [], language: null },
}) {
    const sections = [];
    const skippedCustomFiles = [];
    let readmeBytes = 0;

    if (signals.readme) {
        const readme = await fetchReadme(owner, repo, accessToken);
        if (typeof readme === 'string') {
            pushSection(sections, {
                kind: 'readme',
                label: 'README',
                content: readme,
                byteCap: SIGNAL_BUDGETS.readme,
            });
            readmeBytes = sections.at(-1).bytes;
        }
    }

    let manifestPresent = false;
    if (signals.manifest) {
        const manifest = await fetchManifest(owner, repo, accessToken);
        if (manifest) {
            manifestPresent = true;
            pushSection(sections, {
                kind: 'manifest',
                label: manifest.label,
                content: manifest.content,
                byteCap: SIGNAL_BUDGETS.manifest,
            });
        }
    }

    if (signals.entrypoints) {
        const entries = await fetchEntrypoints(owner, repo, accessToken);
        if (entries.length > 0) {
            const combined = entries
                .map((e) => `--- ${e.path} ---\n${e.content.slice(0, ENTRYPOINT_PER_FILE_CAP)}`)
                .join('\n\n');
            pushSection(sections, {
                kind: 'entrypoints',
                label: entries.length === 1 ? entries[0].path : `${entries.length} entrypoints`,
                content: combined,
                byteCap: SIGNAL_BUDGETS.entrypoints,
            });
        }
    }

    if (signals.folderStructure) {
        const dirs = await fetchTopLevelDirs(owner, repo, accessToken);
        if (dirs.length > 0) {
            pushSection(sections, {
                kind: 'folderStructure',
                label: 'top-level dirs',
                content: dirs.slice(0, 50).join('\n'),
                byteCap: SIGNAL_BUDGETS.folderStructure,
            });
        }
    }

    const topicsPresent = Array.isArray(topicsLanguageInputs.topics) && topicsLanguageInputs.topics.length > 0;
    const languagePresent = !!topicsLanguageInputs.language;
    if ((signals.topics && topicsPresent) || (signals.language && languagePresent)) {
        const content = topicsLanguageContent({
            topics: signals.topics ? topicsLanguageInputs.topics : [],
            language: signals.language ? topicsLanguageInputs.language : null,
        });
        if (content) {
            pushSection(sections, {
                kind: 'topicsLanguage',
                label: 'topics + language',
                content,
                byteCap: SIGNAL_BUDGETS.topicsLanguage,
            });
        }
    }

    if (Array.isArray(customFiles) && customFiles.length > 0) {
        const usedSoFar = sections.reduce((n, s) => n + s.bytes, 0);
        const remaining = byteCap - usedSoFar;
        if (remaining <= 0) {
            throw new Error(`Custom files cannot fit: ${usedSoFar} bytes already used of ${byteCap} cap.`);
        }
        // Fetch all first so we know how many are present before splitting budget.
        const fetched = [];
        for (const path of customFiles) {
            const content = await fetchTextFile(owner, repo, path, accessToken);
            if (typeof content === 'string') {
                fetched.push({ path, content });
            } else {
                skippedCustomFiles.push(path);
            }
        }
        if (fetched.length > 0) {
            const perFile = Math.floor(remaining / fetched.length);
            const totalUntruncated = fetched.reduce((n, f) => n + f.content.length, 0);
            // Reject when total content exceeds budget or per-file share is too small to be useful.
            const totalNeeded = fetched.reduce((n, f) => n + Math.min(f.content.length, perFile), 0);
            if (totalUntruncated > remaining || totalNeeded === 0 || perFile < 200) {
                throw new Error(`Selected custom files exceed remaining budget (${remaining} B for ${fetched.length} files).`);
            }
            for (const f of fetched) {
                pushSection(sections, {
                    kind: 'customFile',
                    label: f.path,
                    content: f.content,
                    byteCap: perFile,
                });
            }
        }
    }

    return {
        sections,
        totalBytes: sections.reduce((n, s) => n + s.bytes, 0),
        confidence: computeConfidence({
            readmeBytes,
            manifestPresent,
            topicsPresent: signals.topics && topicsPresent,
            languagePresent: signals.language && languagePresent,
        }),
        signalsUsed: sections.map((s) => ({ kind: s.kind, label: s.label, bytes: s.bytes })),
        redactions: sections.filter((s) => s.redactions > 0).map((s) => ({ file: s.label, count: s.redactions })),
        skippedCustomFiles,
        byteCap,
    };
}
