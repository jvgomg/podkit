/**
 * Reading a shell contract from TypeScript.
 *
 * The substrate and builder contracts are bash files because the boxes they
 * describe have no TypeScript on them — and, in the substrate's case, must not:
 * its own contract forbids a toolchain. Everything the repo wants to check
 * about those files therefore has to read bash from the outside.
 *
 * ## Why this sources the file instead of matching a regex
 *
 * The obvious implementation is `/^NAME="([^"]*)"$/m`, and it was the
 * implementation until a contract value was defined in terms of another:
 *
 * ```sh
 * BUILDER_MUSL_CONTAINERFILE_SUBPATH="../builder/musl/Containerfile"
 * BUILDER_MUSL_CONTAINERFILE_REL_PATH="test-packages/device-testing/scripts/$BUILDER_MUSL_CONTAINERFILE_SUBPATH"
 * ```
 *
 * A regex hands back the second value with `$BUILDER_…` still in it — a string
 * that is not any path, silently compared against a real one. Sourcing gets the
 * value bash would give the scripts that consume it, which is the only value
 * worth asserting about.
 *
 * It also *exercises* something the contracts promise rather than taking it on
 * trust: both headers say the file declares values only and is free of side
 * effects, because a doctor sources it and must not mutate the host it
 * inspects. A contract that grew a side effect would run it here.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { repoRoot } from './paths.js';

/**
 * Delimiter between the name and the value in the dump below. A byte that
 * cannot occur in a shell variable name and will not occur in a package list or
 * a path, so a value containing `=` still round-trips.
 */
const FIELD_SEPARATOR = '';

/** Cache keyed by absolute path — the same contract is read by several tests. */
const cache = new Map<string, Readonly<Record<string, string>>>();

/**
 * Every top-level `NAME=` assignment in a shell contract, with the values bash
 * resolves them to.
 *
 * Names are found by pattern (cheap, and a name cannot be computed); values
 * come from bash (correct, and a value can be). Reading them in that order is
 * what keeps this from re-implementing a shell.
 *
 * @throws when the file cannot be sourced. A contract that fails to source is a
 * broken contract, not a missing value, and the two should not look alike.
 */
export function readShellContract(relPath: string): Readonly<Record<string, string>> {
  const absPath = path.join(repoRoot(), relPath);
  const cached = cache.get(absPath);
  if (cached) return cached;

  const names = [...fs.readFileSync(absPath, 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
    (match) => match[1]!
  );

  // `set -u` so a name that matched the pattern but somehow resolves to nothing
  // fails loudly here rather than arriving as an empty string a test then
  // compares against another empty string.
  const script = [
    'set -eu',
    `. "$1"`,
    ...names.map((name) => `printf '%s${FIELD_SEPARATOR}%s\\n' ${name} "$${name}"`),
  ].join('\n');

  const result = spawnSync('bash', ['-c', script, '_', absPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `could not source ${relPath}: ${result.stderr?.trim() || `exit ${result.status}`}`
    );
  }

  const values: Record<string, string> = {};
  for (const line of result.stdout.split('\n')) {
    if (!line) continue;
    const separator = line.indexOf(FIELD_SEPARATOR);
    if (separator === -1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }

  const frozen = Object.freeze(values);
  cache.set(absPath, frozen);
  return frozen;
}

/**
 * One value from a shell contract.
 *
 * @throws when the contract declares no such name. A test asserting about a
 * variable that has been renamed should fail on the rename, not pass vacuously
 * against `undefined`.
 */
export function shellContractValue(relPath: string, name: string): string {
  const value = readShellContract(relPath)[name];
  if (value === undefined) throw new Error(`${relPath} declares no ${name}`);
  return value;
}

/**
 * One space-separated shell list from a contract, as a set. Order is not part
 * of any contract the repo has, so comparing as sets says what is meant.
 */
export function shellContractList(relPath: string, name: string): Set<string> {
  return new Set(shellContractValue(relPath, name).split(/\s+/).filter(Boolean));
}
