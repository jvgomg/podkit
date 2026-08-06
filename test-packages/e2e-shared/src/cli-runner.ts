/**
 * Generic CLI runner used by every e2e test package.
 *
 * Spawns the built podkit CLI as a subprocess and captures output, exactly as
 * a real user would invoke it. Subsonic / docker-specific config helpers live
 * next to the docker harness in `@podkit/e2e-tests` (under
 * `src/helpers/subsonic-config.ts`), not here.
 *
 * @module
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Result of running the CLI.
 */
export interface CliResult {
  /** Process exit code (0 on success). */
  exitCode: number;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
  /** Execution duration in milliseconds. */
  duration: number;
}

/**
 * Which build of the CLI to run.
 *
 * - `'production'` (default): the bundled `dist/main.js` (`bun build
 *   --target bun`) invoked under `bun`. Hook bodies (see
 *   `documents/architecture/dev-builds.md`) are tree-shaken away. This is a
 *   fast e2e proxy — per ADR-021 the user-shipped artefact is the Bun
 *   `--compile` binary (`bin/podkit`), not this bundle, but both run under
 *   the Bun runtime so the proxy is faithful (`bun:sqlite` etc. resolve).
 * - `'debug'`: the compiled `bin/podkit-debug` binary invoked directly.
 *   Hook bodies are active; tests can drive `devPause(key)` via
 *   `PODKIT_DEV_PAUSE_KEY`. Tests opt in explicitly — most paths should
 *   stay on `'production'` so we exercise the real shipping artefact.
 */
export type CliBinary = 'production' | 'debug';

/**
 * Options for running the CLI.
 */
export interface CliOptions {
  /** Working directory for the process. */
  cwd?: string;
  /** Environment variables (merged with process.env). */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 90000). */
  timeout?: number;
  /** Standard input to send to the process. */
  stdin?: string;
  /**
   * Which CLI build to run. Default `'production'`. See {@link CliBinary}.
   *
   * When `'debug'`, the test is responsible for ensuring `bin/podkit-debug`
   * has been built — the turbo `test:e2e` / `test:vm` tasks declare a
   * `podkit#compile:debug` dependency so this is satisfied in CI.
   */
  binary?: CliBinary;
}

/**
 * Env override: a path to a **standalone (Bun `--compile`) CLI binary** to
 * exercise instead of the bundled `dist/main.js` production proxy. When set, the
 * `'production'` build resolves to this path and is invoked **directly** (a
 * compiled binary is self-contained), exactly like the debug binary.
 *
 * This is what lets the host e2e run against the real shipped artefact — the
 * `--compile` mac binary (`packages/podkit-cli/bin/podkit`) or a fetched
 * pre-release tarball — rather than the fast bundle proxy. It mirrors the VM
 * harness's `PODKIT_LINUX_*_BINARY` overrides so a release-candidate gate can
 * drive every surface off the exact bytes about to ship. Ignored for the
 * explicit `'debug'` build.
 */
export const CLI_BINARY_ENV = 'PODKIT_CLI_BINARY';

/**
 * Path to the built CLI artifact for the given build.
 *
 * E2E tests run against the compiled CLI, not TypeScript source. The path is
 * resolved at runtime from this file's directory; both the source location
 * (`test-packages/e2e-shared/src/`) and the bundled location
 * (`test-packages/e2e-shared/dist/`) are exactly three levels below the repo
 * root, so the same relative walk works in either mode.
 *
 * - `'production'` → `packages/podkit-cli/dist/main.js` (invoke under `bun`),
 *   OR the {@link CLI_BINARY_ENV} override path when set (invoke directly).
 * - `'debug'` → `packages/podkit-cli/bin/podkit-debug` (invoke directly)
 */
export function getCliPath(binary: CliBinary = 'production'): string {
  const here = dirname(fileURLToPath(import.meta.url));
  if (binary === 'debug') {
    return resolve(here, '../../../packages/podkit-cli/bin/podkit-debug');
  }
  const override = process.env[CLI_BINARY_ENV]?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(here, '../../../packages/podkit-cli/dist/main.js');
}

/**
 * Whether the resolved CLI for `binary` is a standalone binary invoked directly
 * (vs the bundle run under `bun`). True for `'debug'` and for `'production'`
 * when {@link CLI_BINARY_ENV} points at a compiled binary.
 */
function cliRunsDirectly(binary: CliBinary): boolean {
  if (binary === 'debug') return true;
  return Boolean(process.env[CLI_BINARY_ENV]?.trim());
}

/**
 * Build the `[command, commandArgs]` to spawn for a CLI invocation, applying the
 * direct-vs-`bun` decision once: the `'production'` bundle runs under `bun`,
 * while `'debug'` and a {@link CLI_BINARY_ENV} override run the standalone
 * compiled binary directly.
 *
 * Bespoke spawners that need the raw `ChildProcess` (e.g. signal-delivery
 * tests) MUST use this rather than hardcoding `spawn('bun', …)`, otherwise a
 * `PODKIT_CLI_BINARY` override pointing at a compiled binary would be mis-run
 * as a bun script (and exit non-zero).
 */
export function cliSpawnArgv(binary: CliBinary, args: string[]): [string, string[]] {
  const cliPath = getCliPath(binary);
  return cliRunsDirectly(binary) ? [cliPath, args] : ['bun', [cliPath, ...args]];
}

/**
 * Run the podkit CLI with given arguments.
 *
 * @example
 * ```ts
 * const result = await runCli(['status', '/Volumes/iPod']);
 * expect(result.exitCode).toBe(0);
 * expect(result.stdout).toContain('Track count');
 * ```
 */
export async function runCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  const binary: CliBinary = options.binary ?? 'production';
  const timeout = options.timeout ?? 90000;
  const startTime = performance.now();

  return new Promise((resolveResult, rejectResult) => {
    const env = {
      ...process.env,
      ...options.env,
      // Consistent output formatting across hosts.
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };

    // 'production' runs the bundle under bun; 'debug' (and a PODKIT_CLI_BINARY
    // override) invoke a standalone compiled binary directly. See
    // documents/architecture/dev-builds.md.
    const [command, commandArgs] = cliSpawnArgv(binary, args);

    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGKILL');
        rejectResult(new Error(`CLI timed out after ${timeout}ms`));
      }
    }, timeout);

    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveResult({
        exitCode: code ?? 1,
        stdout,
        stderr,
        duration: performance.now() - startTime,
      });
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      rejectResult(err);
    });
  });
}

/**
 * Result of running the CLI with JSON parsing.
 */
export interface CliJsonResult<T> {
  /** Raw CLI result. */
  result: CliResult;
  /** Parsed JSON, or null if parsing failed. */
  json: T | null;
  /** Parse error, if any. */
  parseError?: string;
}

/**
 * Run the CLI and parse stdout as JSON.
 *
 * @example
 * ```ts
 * const { result, json } = await runCliJson<StatusOutput>(['status', path, '--json']);
 * if (json) {
 *   expect(json.trackCount).toBeGreaterThan(0);
 * }
 * ```
 */
export async function runCliJson<T>(
  args: string[],
  options: CliOptions = {}
): Promise<CliJsonResult<T>> {
  const result = await runCli(args, options);

  let json: T | null = null;
  let parseError: string | undefined;

  try {
    const trimmed = result.stdout.trim();
    if (trimmed) {
      json = JSON.parse(trimmed) as T;
    }
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  return { result, json, parseError };
}

/**
 * Check whether the CLI binary has been built.
 *
 * Used by the preflight checks. Tests should not call this themselves —
 * turbo wires `^build` (and `podkit#compile:debug` for the debug binary)
 * so the CLI exists by the time tests run.
 */
export async function isCliAvailable(binary: CliBinary = 'production'): Promise<boolean> {
  try {
    await access(getCliPath(binary));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a temporary config file with a directory-based music collection.
 *
 * Subsonic-style configs live in `@podkit/e2e-tests/src/helpers/subsonic-config.ts`
 * because they're only meaningful next to the Docker harness that backs the
 * Subsonic server.
 *
 * @example
 * ```ts
 * const configPath = await createTempConfig('/path/to/music', target.path);
 * const result = await runCli(['--config', configPath, 'sync']);
 * ```
 */
export async function createTempConfig(musicPath: string, devicePath?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'podkit-e2e-config-'));
  const configPath = join(tempDir, 'config.toml');

  let content = `version = 2

[music.main]
path = "${musicPath}"

[defaults]
music = "main"
`;

  if (devicePath) {
    // A device stanza so the test target is addressable as `-d test`. Real
    // configs key on volume UUID; this fixed `test-uuid` stands in for tests
    // that only need an addressable device row (no `device add` involved).
    content += `
[devices.test]
volumeUuid = "test-uuid"
volumeName = "test"
`;
  }

  await writeFile(configPath, content);
  return configPath;
}

/**
 * Remove a temp config file (and its parent directory) created by
 * {@link createTempConfig}. Swallows ENOENT-style errors so it's safe to call
 * unconditionally in `afterEach`.
 */
export async function cleanupTempConfig(configPath: string): Promise<void> {
  try {
    await rm(dirname(configPath), { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}
