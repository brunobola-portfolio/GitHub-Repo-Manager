// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const CURRENT_VERSION = 'v1';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cache = new Map();

export function loadPrompt(name, version = CURRENT_VERSION) {
    const key = `${version}/${name}`;
    if (cache.has(key)) return cache.get(key);
    const path = join(__dirname, version, `${name}.md`);
    const content = readFileSync(path, 'utf8');
    cache.set(key, content);
    return content;
}
