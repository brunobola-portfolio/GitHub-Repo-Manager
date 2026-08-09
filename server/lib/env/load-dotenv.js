/**
 * Loads the `.env` file into process.env, as a side effect of importing this
 * module. Import it FIRST in any entry point.
 *
 * Why this is a module of its own rather than a line in config.js:
 *
 * ESM evaluates the whole import graph depth-first, in source order, before
 * the importing module's own body runs. server/index.js imports several route
 * barrels ahead of config.js, and those reach server/db.js — whose top-level
 * `await createDatabaseAdapter()` resolves the SQLite file path from
 * process.env.DATA_DIR right there, during module evaluation. With the dotenv
 * call living inside config.js, that read happened BEFORE the file was loaded:
 * a DATA_DIR set in .env was silently ignored for the database (it still
 * applied to the later-evaluated tmp/scratch dirs, which made the split
 * invisible) and manager.db was created under server/data instead. On a
 * packaged or hosted install that puts the live database inside the install
 * tree, where the next upgrade overwrites it.
 *
 * Importing this first makes the file the earliest thing evaluated in the
 * graph, so every module-load-time process.env read sees it — not just the
 * ones that happen to be evaluated late.
 *
 * dotenv does not overwrite variables that are already set, so a real OS
 * environment variable still wins over the file, and calling config() again
 * (config.js imports this module) is a no-op.
 */
import dotenv from 'dotenv';

// GRM_ENV_FILE: explicit .env location, set by the Windows package launcher
// (packaging/windows/start.ps1) and the IIS service installer
// (deploy/iis/install-service.ps1) so the file can live in the DATA directory —
// surviving uninstall/reinstall (it holds CREDENTIAL_ENCRYPTION_KEY; losing it
// would strand every encrypted credential in the database) and keeping the
// install dir read-only-safe. It must be a real OS env var: it cannot live
// inside the file it locates. Unset → dotenv's default `<cwd>/.env`.
dotenv.config(process.env.GRM_ENV_FILE
    ? { path: process.env.GRM_ENV_FILE, quiet: true }
    : { quiet: true });
