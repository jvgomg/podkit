/**
 * Synchronous "is the binary installed and runnable" guard, designed to be
 * called at the top of a test file to fail fast if a system dependency is
 * missing.
 *
 * Asynchronous {@link PreflightCheck}s are the right tool for an interactive
 * preflight script — they produce a green/red table and don't throw. For a
 * test module that *cannot run* without the dependency, the right tool is
 * this: throw at module load so bun:test surfaces the missing dep as a real
 * suite failure rather than letting tests silently pass through skip guards.
 *
 * @module
 */

import { execFileSync } from 'node:child_process';

/**
 * Throw with an actionable install hint if `binary` is not on `$PATH`.
 *
 * Cheap (≈10 ms): runs `binary --version` (or the override args) and discards
 * output. Errors are converted to a `Error` carrying both the missing binary
 * and the install hint.
 *
 * @example
 * ```ts
 * // At the top of an integration-test file:
 * requireBinary('ffmpeg', 'brew install ffmpeg or apt install ffmpeg');
 * requireBinary('metaflac', 'brew install flac or apt install flac');
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
