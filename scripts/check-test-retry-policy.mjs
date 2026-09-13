#!/usr/bin/env bun
/**
 * Retry-policy enforcement (docs/agents/testing.md §"Retries: there are none,
 * and that is the policy"):
 * every `bunfig.toml` sets `retry = 0`. A test that passes on the second
 * attempt is a bug report, not a pass.
 *
 * This exists because the arrangement it replaced — `retry = 2` in fourteen
 * packages, `retry = 1` in two, nothing at all in one — read as considered and
 * was not, and nothing in the repo recorded why. A spread like that reassembles
 * itself one copy-pasted bunfig at a time unless something objects.
 *
 * Exceptions are allowed and must say what they are for: put a
 * `# retry-exception: <reason>` comment directly above the setting. The reason
 * has to survive the two questions in the doc — whether the nondeterminism is
 * somewhere retry can even reach (a `beforeAll` failure is not retried), and
 * how a retried-then-passed run is surfaced (bun prints no attempt marker).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every `bunfig.toml` git knows about — tracked, plus untracked ones
 * `.gitignore` does not cover, so a new package is in scope before it is
 * staged. Mirrors the discovery in `lint-shell.mjs`; see its comment for why
 * this is asked of git rather than walked.
 */
function collectBunfigs() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*bunfig.toml'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  if (result.error || result.status !== 0) {
    console.error('Could not list bunfig.toml files via git.');
    process.exit(1);
  }
  return (
    (result.stdout ?? '')
      .split('\0')
      .filter(Boolean)
      // The pathspec `*bunfig.toml` is a suffix glob — it also matches
      // `not-a-bunfig.toml`. Only the real thing is subject to the policy.
      .filter((relative) => path.basename(relative) === 'bunfig.toml')
      // `--cached` reports the index, so a tracked bunfig deleted without
      // `git rm` is still listed and would be read off disk. Same fix as
      // `lint-shell.mjs`, for the same reason.
      .filter((relative) => existsSync(path.join(REPO_ROOT, relative)))
      .sort()
  );
}

/**
 * The `retry` setting in a bunfig, with the comment block immediately above it.
 *
 * Returns null when the file sets no retry at all. That is itself a finding:
 * the absent case is how `test-packages/lima` ended up as the only package
 * with no setting and nothing saying whether that was deliberate.
 */
function readRetry(lines) {
  const index = lines.findIndex((line) => /^\s*retry\s*=/.test(line));
  if (index === -1) return null;
  const value = Number.parseInt(lines[index].split('=')[1]?.trim() ?? '', 10);
  // Walk back over the contiguous comment block directly above the setting —
  // a justification separated from it by a blank line belongs to something
  // else and does not count.
  const preamble = [];
  for (let i = index - 1; i >= 0 && lines[i].trim().startsWith('#'); i -= 1) {
    preamble.unshift(lines[i]);
  }
  // Anchored: the comment must *be* the exemption, not merely mention the
  // word. Prose that discusses the policy — including a pointer to the doc
  // section — would otherwise grant one.
  const exempted = preamble.some((line) => /^\s*#\s*retry-exception:/.test(line));
  return { value, exempted };
}

const violations = [];
const exemptions = [];
const bunfigs = collectBunfigs();

for (const relative of bunfigs) {
  const lines = readFileSync(path.join(REPO_ROOT, relative), 'utf8').split('\n');
  const retry = readRetry(lines);
  if (retry === null) {
    violations.push(`${relative}: no retry setting — the policy is explicit, state 'retry = 0'`);
    continue;
  }
  if (Number.isNaN(retry.value)) {
    violations.push(`${relative}: retry is not a number`);
    continue;
  }
  if (retry.value === 0) continue;
  if (retry.exempted) {
    exemptions.push(`${relative}: retry = ${retry.value}`);
    continue;
  }
  violations.push(
    `${relative}: retry = ${retry.value} without a '# retry-exception: <reason>' comment above it`
  );
}

if (violations.length > 0) {
  console.error('Retry policy violations (docs/agents/testing.md §Retries):\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(`\n${violations.length} violation(s) across ${bunfigs.length} bunfig.toml files.`);
  process.exit(1);
}

const exemptionSuffix =
  exemptions.length > 0
    ? ` (${exemptions.length} documented exception(s): ${exemptions.join(', ')})`
    : '';
console.log(`OK — ${bunfigs.length} bunfig.toml files, retry = 0${exemptionSuffix}.`);
