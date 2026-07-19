# winget scaffolding

Reference manifests for `BolaLabs.GitHubRepoManager` on the community
[winget-pkgs](https://github.com/microsoft/winget-pkgs) repository, targeting
manifest schema **1.12.0** (the current version in winget-pkgs as of
2026-07-19 — verified against `doc/manifest/schema/` in that repo, which has
directories up to `1.12.0`).

## Files here

- `BolaLabs.GitHubRepoManager.yaml` — version manifest
- `BolaLabs.GitHubRepoManager.installer.yaml` — installer manifest (Inno
  Setup, per-user scope, matches `packaging/windows/installer.iss` exactly:
  `InstallerType: inno`, `Scope: user`, the same `/VERYSILENT /NORESTART
  /SUPPRESSMSGBOXES` silent switches)
- `BolaLabs.GitHubRepoManager.locale.en-US.yaml` — default locale manifest

These are **reference/fallback templates**, not what actually gets
submitted. `<VERSION>`, `<SHA256>`, `<URL>` are placeholders — if winget-pkgs
ever needs a hand-authored PR (e.g. wingetcreate itself is broken, or the
automated submission needs a manual fix), copy this trio into a
`manifests/b/BolaLabs/GitHubRepoManager/<version>/` layout in a winget-pkgs
fork, fill in the placeholders, and open a PR there — never in this repo.

## What actually publishes it

`.github/workflows/release.yml`'s `windows` job, after uploading the ZIP +
installer to the GitHub Release, runs:

```
wingetcreate update BolaLabs.GitHubRepoManager \
  --version <version> \
  --urls <the release's setup.exe download URL> \
  --token $WINGET_TOKEN \
  --submit
```

`wingetcreate update` downloads the new installer itself, computes its own
SHA256, diffs it against the last published manifest for this package ID,
and opens (or updates) a PR against `microsoft/winget-pkgs` directly — it
does not read the templates in this folder at all. That's why the fields
above must stay in sync by hand if the installer's shape ever changes
(scope, silent switches, architecture): wingetcreate infers most of it, but
a human should sanity-check the templates alongside `installer.iss`.

## `WINGET_TOKEN`

A **fine-grained GitHub PAT with `public_repo` scope**, belonging to an
account with a fork of `microsoft/winget-pkgs` (wingetcreate submits via a
fork + PR, the standard winget-pkgs contribution flow). Set it as the
`WINGET_TOKEN` repository secret.

Without it, the release workflow's winget step logs a clear notice and exits
0 — it never fails the release. A `wingetcreate` failure (rate limit, schema
drift, manifest validation rejection upstream) is also caught with
`continue-on-error: true` on that step for the same reason: the Windows
package release must never be hostage to a third-party repository's queue
or review process.

## First submission vs. updates

The very first time `BolaLabs.GitHubRepoManager` is published, `wingetcreate
update` will fail (no existing manifest to update). That one-time bootstrap
needs `wingetcreate new` run manually once, submitting the initial manifest
set — after that, every subsequent release's `update` call works as
scaffolded above.
