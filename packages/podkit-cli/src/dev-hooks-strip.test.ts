/**
 * Production-cleanliness smoke test for compile-time-stripped dev hooks.
 *
 * The `devPause(key)` primitive in `@podkit/core` lives behind the
 * compile-time boolean `__PODKIT_DEV_HOOKS__`. Production builds (the
 * dev bundle in `dist/main.js` and the compiled `bin/podkit`) set it to
 * `false` via `--define` so the bundler tree-shakes the body away.
 *
 * This test guards against accidental leakage. If anyone:
 *
 * - forgets to pass `--define __PODKIT_DEV_HOOKS__=false` in a build step,
 * - introduces a hook that runs at module load (no ternary collapse), or
 * - imports a hook through a path the bundler can't tree-shake,
 *
 * the symbol survives the build and this test fails. See
 * `documents/architecture/dev-builds.md` for the full pattern.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BUNDLE = resolve(__dirname, '..', 'dist', 'main.js');
const CLI_BINARY = resolve(__dirname, '..', 'bin', 'podkit');

const FORBIDDEN_SUBSTRINGS = ['__PODKIT_DEV_HOOKS__', 'PODKIT_DEV_PAUSE_KEY'] as const;

function readArtifact(path: string): string {
  // Read as binary then look for the ASCII substrings — works for both the
  // text bundle and the compiled binary (string literals survive in-place).
  return readFileSync(path, 'binary');
}

describe('production build strips dev hooks', () => {
  it('exists at the bundled path', () => {
    expect(existsSync(CLI_BUNDLE)).toBe(true);
  });

  it('dist/main.js contains no dev-hook symbol or env-var name', () => {
    if (!existsSync(CLI_BUNDLE)) {
      throw new Error(
        `CLI bundle missing: ${CLI_BUNDLE}\n` +
          'Run `bun run build --filter podkit` from the repo root first.'
      );
    }
    const contents = readArtifact(CLI_BUNDLE);
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      expect(
        contents.includes(needle),
        `Expected '${needle}' to be absent from dist/main.js (was tree-shaken).`
      ).toBe(false);
    }
  });

  // The compiled binary is only built on demand (`bun run compile`). Skip
  // gracefully when it's missing so CI doesn't have to build it for every
  // unit-test run — the dist/main.js check above shares the same --define
  // pipeline shape, so a regression there flags both paths.
  it.skipIf(!existsSync(CLI_BINARY))(
    'bin/podkit (when present) contains no dev-hook symbol or env-var name',
    () => {
      // Sanity: only run on a non-empty file. A zero-byte placeholder would
      // pass vacuously, which would be worse than skipping.
      expect(statSync(CLI_BINARY).size).toBeGreaterThan(0);
      const contents = readArtifact(CLI_BINARY);
      for (const needle of FORBIDDEN_SUBSTRINGS) {
        expect(
          contents.includes(needle),
          `Expected '${needle}' to be absent from bin/podkit (was tree-shaken).`
        ).toBe(false);
      }
    }
  );
});
