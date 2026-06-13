// @vitest-environment node
//
// Unit tests for the two security-critical PURE functions in
// server/import-service.js:
//   - embedCredentials(url, credentials): injects auth into a clone URL.
//   - safeUrl(url): redacts userinfo so PATs never reach logs.
//
// These functions are the difference between "every clone works" and
// "every clone breaks", and between "logs are clean" and "logs leak the
// customer's PAT". They are pure (no I/O), so we import the real module.
//
// Importing import-service.js runs module-level code (it creates TMP_DIR
// under server/data/tmp) and pulls in simple-git. That is harmless in the
// node test env, but we mock the heaviest transitive deps minimally so the
// import is cheap and side-effect-free at the network level. We do NOT mock
// the functions under test.
import { describe, it, expect, vi } from 'vitest';

// simple-git would otherwise spawn a child `git` process on construction in
// some environments; stub it to an inert object. embedCredentials/safeUrl
// never call it, so this only keeps the import light.
vi.mock('simple-git', () => ({
    simpleGit: () => ({
        version: vi.fn(async () => ({ installed: true })),
        listRemote: vi.fn(async () => ''),
        clone: vi.fn(async () => {}),
        push: vi.fn(async () => {}),
    }),
}));

import { embedCredentials, safeUrl } from '../import-service.js';

describe('embedCredentials', () => {
    it('returns the original url unchanged when credentials is null', () => {
        const url = 'https://github.com/acme/widget.git';
        expect(embedCredentials(url, null)).toBe(url);
    });

    it('returns the original url unchanged when credentials is undefined', () => {
        const url = 'https://github.com/acme/widget.git';
        expect(embedCredentials(url, undefined)).toBe(url);
    });

    describe("type 'basic'", () => {
        it('embeds username:password into the authority', () => {
            const out = embedCredentials('https://github.com/acme/widget.git', {
                type: 'basic',
                username: 'alice',
                password: 's3cret',
            });
            expect(out).toBe('https://alice:s3cret@github.com/acme/widget.git');
        });

        it('URL-encodes a password containing @ and : so the authority is not corrupted', () => {
            const out = embedCredentials('https://github.com/acme/widget.git', {
                type: 'basic',
                username: 'alice',
                password: 'p@ss:w/ord',
            });
            // The literal '@' and ':' must be percent-encoded, otherwise they
            // would terminate the userinfo / introduce a bogus port.
            expect(out).toBe('https://alice:p%40ss%3Aw%2Ford@github.com/acme/widget.git');
            // The raw password must NOT survive verbatim in the authority.
            expect(out).not.toContain('p@ss:w/ord');
            // And the parsed URL must still resolve to the intended host.
            // (URL.password reports the percent-encoded form, not the decoded
            // one — what matters is the host is correct and the secret encoded.)
            expect(new URL(out).hostname).toBe('github.com');
            expect(new URL(out).password).toBe('p%40ss%3Aw%2Ford');
        });

        it('URL-encodes a username containing special characters', () => {
            const out = embedCredentials('https://example.com/r.git', {
                type: 'basic',
                username: 'a@b',
                password: 'pw',
            });
            expect(out).toBe('https://a%40b:pw@example.com/r.git');
            expect(new URL(out).username).toBe('a%40b');
        });

        it('preserves a path with existing %20 encoding (uses URL.pathname)', () => {
            const out = embedCredentials('https://example.com/My%20Repo.git', {
                type: 'basic',
                username: 'u',
                password: 'p',
            });
            expect(out).toBe('https://u:p@example.com/My%20Repo.git');
        });
    });

    describe("type 'token' / 'pat'", () => {
        it("embeds a non-Azure token as x-access-token:<token> userinfo", () => {
            const out = embedCredentials('https://github.com/acme/widget.git', {
                type: 'token',
                token: 'ghp_abc123',
            });
            expect(out).toBe('https://x-access-token:ghp_abc123@github.com/acme/widget.git');
        });

        it("treats 'pat' identically to 'token' for non-Azure hosts", () => {
            const out = embedCredentials('https://github.com/acme/widget.git', {
                type: 'pat',
                token: 'ghp_abc123',
            });
            expect(out).toBe('https://x-access-token:ghp_abc123@github.com/acme/widget.git');
        });

        it('URL-encodes a token containing reserved chars', () => {
            const out = embedCredentials('https://github.com/acme/widget.git', {
                type: 'token',
                token: 'tok@en:with/chars',
            });
            expect(out).toBe('https://x-access-token:tok%40en%3Awith%2Fchars@github.com/acme/widget.git');
            expect(out).not.toContain('tok@en:with/chars');
        });

        it('Azure special-case: dev.azure.com embeds the PAT as the username only (no x-access-token prefix)', () => {
            const out = embedCredentials('https://dev.azure.com/myorg/proj/_git/repo', {
                type: 'pat',
                token: 'azurePat123',
            });
            // Azure DevOps cloud expects the PAT as the userinfo username with
            // an empty password — NOT the GitHub x-access-token:<tok> form.
            expect(out).toBe('https://azurePat123@dev.azure.com/myorg/proj/_git/repo');
            expect(out).not.toContain('x-access-token');
        });

        it('Azure special-case strips any pre-existing userinfo (org@dev.azure.com) to avoid a double @', () => {
            // Azure sometimes hands back remoteUrl with userinfo already present.
            const out = embedCredentials('https://myorg@dev.azure.com/myorg/proj/_git/repo', {
                type: 'token',
                token: 'azurePat123',
            });
            expect(out).toBe('https://azurePat123@dev.azure.com/myorg/proj/_git/repo');
            // Exactly one '@' separating userinfo from host.
            expect(out.split('@').length - 1).toBe(1);
            expect(new URL(out).hostname).toBe('dev.azure.com');
        });

        it('an Azure DevOps Server (on-prem) host is NOT given the special-case and uses x-access-token', () => {
            // The code only special-cases the literal hostname 'dev.azure.com'.
            const out = embedCredentials('https://tfs.contoso.local/tfs/_git/repo', {
                type: 'pat',
                token: 'onpremPat',
            });
            expect(out).toBe('https://x-access-token:onpremPat@tfs.contoso.local/tfs/_git/repo');
        });

        it('URL-encodes an Azure PAT containing reserved chars', () => {
            const out = embedCredentials('https://dev.azure.com/org/p/_git/r', {
                type: 'token',
                token: 'pat with+special&',
            });
            expect(out).toBe(`https://${encodeURIComponent('pat with+special&')}@dev.azure.com/org/p/_git/r`);
            expect(out).not.toContain('pat with+special&');
        });
    });

    describe('unrecognized / edge inputs', () => {
        it('returns the original url unchanged for an unknown credential type', () => {
            const url = 'https://github.com/acme/widget.git';
            const out = embedCredentials(url, { type: 'oauth-magic', token: 'x' });
            expect(out).toBe(url);
        });

        it('throws on a malformed (non-parseable) url with a non-null credential, because new URL() rejects it', () => {
            // Contract observed: embedCredentials constructs `new URL(url)` for
            // any non-empty credential, so a malformed url throws synchronously.
            expect(() =>
                embedCredentials('not a url', { type: 'token', token: 'x' })
            ).toThrow();
        });

        it('does NOT throw on a malformed url when credentials is null (early return before parsing)', () => {
            expect(embedCredentials('not a url', null)).toBe('not a url');
        });
    });
});

describe('safeUrl', () => {
    it('redacts userinfo so a PAT/secret does NOT appear in the output', () => {
        const secret = 'ghp_supersecrettoken';
        const url = `https://x-access-token:${secret}@github.com/acme/widget.git`;
        const out = safeUrl(url);
        // The whole point: the secret must be gone.
        expect(out).not.toContain(secret);
        expect(out).not.toContain('x-access-token');
        expect(out).toContain('***@github.com');
        expect(out).toBe('https://***@github.com/acme/widget.git');
    });

    it('redacts a bare-token Azure userinfo form', () => {
        const secret = 'azurePat123';
        const url = `https://${secret}@dev.azure.com/org/p/_git/r`;
        const out = safeUrl(url);
        expect(out).not.toContain(secret);
        expect(out).toBe('https://***@dev.azure.com/org/p/_git/r');
    });

    it('returns a URL with no userinfo essentially unchanged', () => {
        const url = 'https://github.com/acme/widget.git';
        expect(safeUrl(url)).toBe(url);
    });

    it('only redacts the userinfo segment, leaving host and path intact', () => {
        const out = safeUrl('https://user:tokensecret@host.example/path/to/repo.git');
        expect(out).not.toContain('tokensecret');
        expect(out).toBe('https://***@host.example/path/to/repo.git');
    });

    it('does not throw on malformed input and returns a safe string with no secret', () => {
        // Contract observed: safeUrl is a pure String.replace, so it never
        // throws on odd-but-string input; it just leaves non-matching text be.
        expect(() => safeUrl('not-even-a-url')).not.toThrow();
        expect(safeUrl('not-even-a-url')).toBe('not-even-a-url');

        // An '@' with no '//' prefix should not be treated as userinfo, but
        // must still not throw.
        expect(() => safeUrl('git@github.com:acme/widget.git')).not.toThrow();
    });
});
