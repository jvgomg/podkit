#!/usr/bin/env bun
/**
 * Run shellcheck over the repo's shell scripts.
 *
 * Wired into `bun run lint` rather than lint-staged: the pre-commit hook runs
 * oxlint and prettier directly, so shell linting costs nothing at commit time
 * and still gates the full lint task.
 *
 * Several of these scripts are privileged or ship artefacts —
 * `apply-state.sh` runs as root inside the device substrate, and
 * `select-gpod-prebuild.sh` chooses the libc variant that gets embedded in the
 * released binary. A silent quoting bug there is expensive, which is why four
 * of them already carried `# shellcheck` directives before shellcheck was a
 * pinned tool.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories never worth walking, used only by the non-git fallback below.
 * The git path needs no such list — `.gitignore` already carries it.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'bin', 'graphify-out']);

/**
 * Files excluded from linting, with the reason.
 *
 * `.husky/_/` is vendored — husky regenerates it on install, so findings there
 * are neither ours to fix nor stable. It is tracked in some checkouts, so this
 * exclusion applies to both discovery paths.
 */
const EXCLUDED = [path.join('.husky', '_')];

/**
 * Shell scripts the repo is responsible for, as git sees them: tracked files
 * plus untracked ones that `.gitignore` does not cover.
 *
 * Discovery used to be a raw directory walk against a hand-maintained skip
 * list, which is a list that can only ever be behind. It did not know about
 * Rust's `target/`, so on any machine that had built the Tauri app locally the
 * walk descended into `packages/virtual-ipod-app/src-tauri/target/release/
 * bundle/dmg/bundle_dmg.sh` — a vendored artefact of the `create-dmg` project,
 * neither ours to fix nor reachable from a clean checkout — and failed the
 * lint gate with 7 findings nobody could act on.
 *
 * Asking git inverts the problem: every build directory is already ignored,
 * so none of them need naming here. `--others --exclude-standard` keeps a
 * brand-new, not-yet-staged script in scope, which a tracked-only listing
 * would silently skip.
 *
 * Returns null when git cannot answer (no repo, no git on PATH), leaving the
 * walk as the fallback.
 */
function collectShellScriptsViaGit() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*.sh'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  if (result.error || result.status !== 0) return null;
  return (
    (result.stdout ?? '')
      .split('\0')
      .filter(Boolean)
      .filter((relative) => !EXCLUDED.some((prefix) => relative.startsWith(prefix)))
      // `--cached` reports the index, not the working tree, so a tracked script
      // deleted or renamed without `git rm` is still listed. shellcheck treats an
      // unreadable path as fatal: it exits 2 having checked *nothing*, including
      // the files listed alongside it. The walk could not produce this, so filter
      // for what is actually on disk.
      .filter((relative) => existsSync(path.join(REPO_ROOT, relative)))
  );
}

/** Fallback discovery for a checkout git cannot describe (e.g. a source tarball). */
function collectShellScripts(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectShellScripts(full, found);
    } else if (entry.endsWith('.sh')) {
      const relative = path.relative(REPO_ROOT, full);
      if (!EXCLUDED.some((prefix) => relative.startsWith(prefix))) {
        found.push(relative);
      }
    }
  }
  return found;
}

const scripts = (collectShellScriptsViaGit() ?? collectShellScripts(REPO_ROOT)).sort();

if (scripts.length === 0) {
  console.log('No shell scripts found.');
  process.exit(0);
}

// Run at default severity so notes stay *visible*, but gate only on
// error/warning — a note is worth reading without being worth blocking.
//
// The tree is currently clean at every severity. Deliberate exceptions carry a
// per-line `# shellcheck disable=<code>` with a reason rather than a global
// rule in a .shellcheckrc: the recurring one is SC2016 (`$` inside single
// quotes), which is correct wherever a string must expand inside a guest —
// `limactl shell ... bash -c '...'`, or
// `VM_TURBO_CACHE='$HOME/.cache/podkit-turbo'`. Disabling SC2016 repo-wide
// would hide the real version of that bug: single quotes written by accident
// in host context.
const result = spawnSync('shellcheck', ['--format=gcc', ...scripts], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});

if (result.error) {
  const missing = result.error.code === 'ENOENT';
  console.error(
    missing
      ? "shellcheck is not on PATH. Run 'mise install' (pinned in mise.toml)."
      : `Could not run shellcheck: ${result.error.message}`
  );
  process.exit(1);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
if (output.length > 0) console.log(output);

// shellcheck exits 0 clean and 1 when it has findings; anything else means it
// gave up rather than reported. Those exits carry no `error:`/`warning:` text,
// so the finding-count gate below would read them as a clean run and pass —
// the one failure mode a lint gate must not have.
if (result.status !== 0 && result.status !== 1) {
  console.error(
    `\nshellcheck exited ${result.status} without reporting findings — it did not check the tree.`
  );
  process.exit(1);
}

const findings = output.split('\n').filter(Boolean);
const blocking = findings.filter((line) => /:\s*(error|warning):/.test(line));
const notes = findings.length - blocking.length;

if (blocking.length > 0) {
  console.error(
    `\nshellcheck: ${blocking.length} error/warning finding(s) across ${scripts.length} scripts.`
  );
  process.exit(1);
}

const noteSuffix = notes > 0 ? ` (${notes} non-blocking note(s))` : '';
console.log(`OK — ${scripts.length} shell scripts scanned, no errors or warnings${noteSuffix}.`);
