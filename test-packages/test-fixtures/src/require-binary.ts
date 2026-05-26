/**
 * Module-load preflight helpers.
 *
 * Each `require*()` function below throws synchronously, at module load, when
 * its dependency is missing or broken. Designed to be called at the top of a
 * test file so bun:test surfaces missing deps as a real suite failure instead
 * of letting tests silently pass through skip guards.
 *
 * Asynchronous {@link PreflightCheck}s (in `@podkit/e2e-shared`) are the right
 * tool for an interactive preflight script — they produce a green/red table
 * and don't throw. The helpers in this file are for the test-module case.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';

/**
 * Throw with an actionable install hint if `binary` is not on `$PATH`.
 *
 * Cheap (~10 ms): runs `binary --version` (or the override args) and discards
 * output. Errors are converted to an `Error` carrying both the missing binary
 * and the install hint.
 *
 * Prefer the named helpers below ({@link requireFFmpeg}, {@link requireMetaflac},
 * etc.) when calling for one of the standard tools — they bake in the right
 * version flag and a consistent install message.
 *
 * @example
 * ```ts
 * // At the top of an integration-test file:
 * requireBinary('curl', 'install curl via your package manager');
 * ```
 */
export function requireBinary(
  binary: string,
  installHint: string,
  versionArgs: readonly string[] = ['--version']
): void {
  try {
    execFileSync(binary, [...versionArgs], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `Required binary '${binary}' is not available on $PATH.\n` + `Install hint: ${installHint}`
    );
  }
}

/**
 * Require ffmpeg to be on `$PATH`.
 *
 * Note: ffmpeg accepts `-version` (single dash) but exits non-zero on
 * `--version`, so this helper passes the correct flag for you.
 */
export function requireFFmpeg(): void {
  requireBinary('ffmpeg', 'brew install ffmpeg (macOS) or apt install ffmpeg (Linux)', [
    '-version',
  ]);
}

/**
 * Require ffprobe (ships with ffmpeg) to be on `$PATH`.
 *
 * Same `-version` quirk as {@link requireFFmpeg}.
 */
export function requireFfprobe(): void {
  requireBinary('ffprobe', 'ships with ffmpeg — install ffmpeg above', ['-version']);
}

/**
 * Require metaflac (from the `flac` package) to be on `$PATH`.
 *
 * Tests that read or write FLAC artwork/comment tags need metaflac.
 */
export function requireMetaflac(): void {
  requireBinary('metaflac', 'brew install flac (macOS) or apt install flac (Linux)');
}

/**
 * Require gpod-tool to be on `$PATH`.
 *
 * Tests that synthesise or verify an iPod-formatted directory go through
 * `@podkit/gpod-testing`, which shells out to gpod-tool. The in-repo build is
 * at `bin/gpod-tool`; `mise run tools:build` produces it.
 */
export function requireGpodTool(): void {
  requireBinary('gpod-tool', 'Run `mise run tools:build` from the repo root.');
}

// `requireLibgpodNode` is intentionally NOT defined here. The natural place
// for it is `@podkit/libgpod-node` itself (so the check sits next to the
// thing it checks, and there is no workspace dep cycle — libgpod-node's own
// integration tests want to call requireGpodTool/requireFFmpeg from this
// module, and putting requireLibgpodNode here would force test-fixtures to
// depend on libgpod-node, closing the loop). Import it as:
//
//     import { requireLibgpodNode } from '@podkit/libgpod-node';
