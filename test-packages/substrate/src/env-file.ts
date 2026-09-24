/**
 * `.env.local` — which substrate this machine drives, and the credentials that
 * lifecycle one — located from the repo root rather than from the working
 * directory.
 *
 * Bun auto-loads such a file relative to cwd, and the entry points that read
 * this one mostly do not run from the repo root: the `harness:*` scripts
 * delegate with `bun run --cwd test-packages/device-testing …`, and turbo
 * spawns every task with the package as cwd. Anchoring on {@link repoRoot}
 * makes the answer the same from all of them.
 *
 * Applied by mutating the environment, deliberately: the first resolver to ask
 * materialises the values for the rest of the process AND for every child it
 * spawns, which is what carries a selection into turbo's tasks.
 *
 * **A variable already in the environment always wins.** CI exports the
 * selection directly and has no dotfile to inherit, so a file that overrode an
 * explicit export would retarget the run away from what the operator asked for.
 *
 * Parsing is narrow on purpose: one hand-written file of `KEY=value` lines, no
 * interpolation, no escapes, no multi-line values, and no inline comment
 * stripping — a token secret is opaque, and truncating one at a `#` is worse
 * than not supporting a trailing comment. Anything richer also risks
 * disagreeing with Bun's own parse, which still runs whenever cwd *is* the
 * root.
 *
 * @module
 */

import * as fs from 'node:fs';

import { repoRoot } from './paths.js';

/** Name of the gitignored env file, as `.env.example` tells the reader to create it. */
export const ENV_FILE_NAME = '.env.local';

/** Reads a file, or returns `null` when it is not there. Injected for tests. */
export type ReadEnvFileFn = (file: string) => string | null;

/** `KEY=value`, optionally `export`-prefixed, with an optional quoted value. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Strip one layer of matching quotes, if the value carries them. */
function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse env-file text into a plain object. Pure; lines that are not
 * assignments — blanks, comments, anything else — are ignored rather than
 * rejected, because this file is edited by hand and a stray line must not stop
 * a machine from finding its substrate.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = ASSIGNMENT.exec(line);
    if (!match) continue;
    parsed[match[1]!] = unquote(match[2]!);
  }
  return parsed;
}

/** Options for {@link loadRepoEnvFile}. Everything is injectable for tests. */
export interface LoadRepoEnvFileOpts {
  /** The environment to fill in. Defaults to the real one. */
  readonly env?: Record<string, string | undefined>;
  /** How to read the file. Defaults to a `readFileSync` that maps ENOENT to `null`. */
  readonly readFile?: ReadEnvFileFn;
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Materialise `<repo>/.env.local` into `env`, filling in only the keys it does
 * not already carry.
 *
 * @returns the keys it set, in file order — nothing when the file is absent or
 * every key was already present.
 */
export function loadRepoEnvFile(opts: LoadRepoEnvFileOpts = {}): readonly string[] {
  const env = opts.env ?? process.env;
  const readFile = opts.readFile ?? readIfPresent;

  const text = readFile(`${repoRoot()}/${ENV_FILE_NAME}`);
  if (text === null) return [];

  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}

/**
 * The process environment, with `.env.local` materialised into it — the default
 * argument of every environment-reading resolver in this package.
 *
 * Named for the write it performs rather than for the value it returns: it is
 * not an accessor, and a caller that reads `process.env` directly afterwards
 * sees the same result.
 *
 * Uncached on purpose. The file is under a kilobyte, these resolvers run a
 * handful of times per process, and a cache would need a reset seam that only
 * tests use.
 */
export function envWithRepoDotfile(): NodeJS.ProcessEnv {
  loadRepoEnvFile();
  return process.env;
}
