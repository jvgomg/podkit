/**
 * Shared shell-escaping + container-JSON helpers for the Tier-5 `docker-dist`
 * suite.
 *
 * Both the one-shot CLI flow (`image.docker-dist.test.ts`) and the daemon
 * steady-state flow (`daemon.docker-dist.test.ts`) drive the shipped musl image
 * via `nerdctl run` inside the device-harness VM and parse podkit's `--json`
 * envelope out of container stdout. The parsing is non-trivial (the entrypoint
 * prints a plain-text banner + device-access probe BEFORE handing off to
 * podkit, so the envelope is never the only thing on stdout), so it lives here
 * once rather than being copy-pasted into each file.
 *
 * Pure + I/O helpers only — no test state. `runContainerJson` is the single
 * point that shells into the VM via `limaTestVmRunner`.
 *
 * @module
 */

import { limaTestVmRunner } from '@podkit/device-testing';

/** Single-quote-escape a value for interpolation into a VM shell command. */
export function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Extract the trailing JSON object/array from a container's stdout.
 *
 * The image entrypoint prints a plain-text banner (and a device-access probe)
 * to stdout BEFORE handing off to `podkit`, so the `--json` envelope is not the
 * only thing on stdout — `JSON.parse(stdout)` would choke on the banner. podkit
 * emits its `--json` envelope as the final structured block, so we scan from
 * the last `{`/`[` that parses cleanly to end-of-output.
 */
export function parseTrailingJson(stdout: string): { parsed?: unknown; parseError?: string } {
  const trimmed = stdout.trimEnd();
  // Walk candidate start indices from the last `{`/`[` backwards; the first that
  // yields a clean parse to end-of-string is the envelope.
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch !== '{' && ch !== '[') continue;
    const candidate = trimmed.slice(i);
    let value: unknown;
    try {
      value = JSON.parse(candidate) as unknown;
    } catch {
      // Not a valid JSON start here — keep scanning earlier.
      continue;
    }
    // Reject a parse that is not a non-empty object/array: a stray trailing
    // `{}`/`[]` (or a bare literal) is never a podkit `--json` envelope, so keep
    // scanning earlier rather than returning it as a false positive.
    if (value === null || typeof value !== 'object') continue;
    if (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0) continue;
    return { parsed: value };
  }
  return { parseError: `no parseable JSON envelope in stdout: ${trimmed.slice(-200)}` };
}

/** The normalised result of one container invocation that emits `--json`. */
export interface ContainerJsonResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  parsed?: unknown;
  parseError?: string;
}

/** Run a container command in the VM and parse its trailing `--json` envelope. */
export async function runContainerJson(
  command: string,
  timeoutMs: number
): Promise<ContainerJsonResult> {
  const result = await limaTestVmRunner.run(command, { timeoutMs });
  const { parsed, parseError } = parseTrailingJson(result.stdout);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed,
    parseError,
  };
}

/**
 * Assert a container step exited 0 and produced a parseable `--json` envelope,
 * surfacing the FULL container stdout/stderr on failure. Without this, a failing
 * `nerdctl run` collapses to a bare `expect(1).toBe(0)` with no clue why the
 * container errored — useless for a step whose failure modes live inside the
 * container (device inquiry, transcode, mount).
 */
export function assertContainerOk(
  invocation: { exitCode: number; stdout: string; stderr: string; parseError?: string },
  label: string
): void {
  if (invocation.exitCode !== 0 || invocation.parseError !== undefined) {
    throw new Error(
      `${label}: container step failed (exit=${invocation.exitCode})` +
        `${invocation.parseError ? `, parseError=${invocation.parseError}` : ''}\n` +
        `--- stdout ---\n${invocation.stdout}\n--- stderr ---\n${invocation.stderr}`
    );
  }
}
