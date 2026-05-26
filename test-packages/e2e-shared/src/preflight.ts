/**
 * Composable preflight checks for the e2e test packages.
 *
 * Each check is a single async function returning a {@link CheckResult}.
 * Consumers (host, docker, vm) assemble their own list and pass it to
 * {@link runPreflightChecks}. The shared set covers tooling that every e2e
 * harness needs (CLI built, ffmpeg, fixtures); package-specific checks live
 * with the package that knows about them.
 *
 * @module
 */

import { access, constants } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isGpodToolAvailable, getGpodToolVersion } from '@podkit/gpod-testing';
import { ensureFixturesExist, type StaticFixtureSet } from '@podkit/test-fixtures';
import { getCliPath, isCliAvailable } from './cli-runner.js';

const execFileAsync = promisify(execFile);

/**
 * Single preflight check outcome.
 */
export interface CheckResult {
  /** Short human label (e.g. `"FFmpeg"`). */
  name: string;
  passed: boolean;
  /** One-line summary visible in the printed table. */
  message: string;
  /** Optional second line with extra context (path, version, fix hint). */
  details?: string;
}

/**
 * A preflight check is a function returning its outcome.
 *
 * Checks are async to allow filesystem and subprocess probes.
 */
export type PreflightCheck = () => Promise<CheckResult>;

/**
 * Run a list of checks in order and return all results. Does not short-circuit
 * on failure — every check runs so the user sees the full picture in one pass.
 */
export async function runPreflightChecks(
  checks: readonly PreflightCheck[]
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    results.push(await check());
  }
  return results;
}

/**
 * Print check results to stdout in a fixed-width table with a green/red
 * indicator. Returns nothing — caller is responsible for the exit code.
 */
export function printResults(results: readonly CheckResult[]): void {
  console.log('\n=== E2E Pre-flight Checks ===\n');

  const maxNameLen = Math.max(...results.map((r) => r.name.length));

  for (const result of results) {
    const icon = result.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const name = result.name.padEnd(maxNameLen);
    console.log(`  ${icon} ${name}  ${result.message}`);
    if (result.details) {
      console.log(`    ${''.padEnd(maxNameLen)}  \x1b[2m${result.details}\x1b[0m`);
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log('');

  if (failed.length === 0) {
    console.log('\x1b[32mAll checks passed!\x1b[0m');
  } else {
    console.log(
      `\x1b[31m${failed.length} check(s) failed.\x1b[0m Fix the issues above before running E2E tests.`
    );
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

/**
 * Verify the podkit CLI binary has been built.
 */
export const checkCliBuilt: PreflightCheck = async () => {
  const available = await isCliAvailable();
  const cliPath = getCliPath();
  return available
    ? { name: 'CLI Built', passed: true, message: 'podkit CLI is built', details: cliPath }
    : {
        name: 'CLI Built',
        passed: false,
        message: 'podkit CLI not found — run `bun run build` first',
        details: `Expected at: ${cliPath}`,
      };
};

/**
 * Verify gpod-tool is on `$PATH`. Used by every harness that touches a real
 * or simulated iPod database.
 */
export const checkGpodTool: PreflightCheck = async () => {
  const available = await isGpodToolAvailable();
  if (available) {
    const version = await getGpodToolVersion();
    return {
      name: 'gpod-tool',
      passed: true,
      message: 'gpod-tool is available',
      details: version,
    };
  }
  return {
    name: 'gpod-tool',
    passed: false,
    message: 'gpod-tool not found in PATH',
    details: 'Run `mise run tools:build` to build it',
  };
};

/**
 * Generic helper for "is the binary on $PATH and runnable" checks.
 */
async function checkBinary(
  name: string,
  binary: string,
  versionArgs: readonly string[],
  installHint: string
): Promise<CheckResult> {
  try {
    const result = await execFileAsync(binary, [...versionArgs]);
    const firstLine = result.stdout.split('\n')[0]?.trim() ?? 'unknown';
    return { name, passed: true, message: `${binary} is available`, details: firstLine };
  } catch {
    return {
      name,
      passed: false,
      message: `${binary} not found in PATH`,
      details: installHint,
    };
  }
}

/**
 * Verify ffmpeg is installed.
 */
export const checkFfmpeg: PreflightCheck = () =>
  checkBinary(
    'FFmpeg',
    'ffmpeg',
    ['-version'],
    'Install with `brew install ffmpeg` or `apt install ffmpeg`'
  );

/**
 * Verify metaflac (from the `flac` package) is installed. Needed by tests
 * that manipulate FLAC artwork tags.
 */
export const checkMetaflac: PreflightCheck = () =>
  checkBinary(
    'metaflac',
    'metaflac',
    ['--version'],
    'Install with `brew install flac` (macOS) or `apt install flac` (Linux)'
  );

/**
 * Verify a {@link StaticFixtureSet} from `@podkit/test-fixtures` has been
 * generated. Wraps `ensureFixturesExist` so a missing fixture surfaces as a
 * preflight check result instead of a module-load throw.
 */
export function checkFixtureSet(set: StaticFixtureSet): PreflightCheck {
  return async () => {
    try {
      ensureFixturesExist(set);
      return {
        name: `Fixtures: ${set}`,
        passed: true,
        message: `${set} fixture set is generated`,
      };
    } catch (err) {
      return {
        name: `Fixtures: ${set}`,
        passed: false,
        message: `${set} fixture set is missing or incomplete`,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Real-device checks
// ---------------------------------------------------------------------------
//
// These run against a real iPod mounted at IPOD_MOUNT. They live here because
// the e2e-tests host suite uses them; e2e-vm-tests and the docker-gated
// `*.docker.test.ts` files would never include them in their check lists.

/**
 * Verify the iPod mount path exists.
 */
export function checkMountExists(mountPath: string): PreflightCheck {
  return async () => {
    try {
      await access(mountPath);
      return {
        name: 'Mount Point',
        passed: true,
        message: 'iPod mount point exists',
        details: mountPath,
      };
    } catch {
      return {
        name: 'Mount Point',
        passed: false,
        message: 'iPod mount point not accessible',
        details: `IPOD_MOUNT=${mountPath}`,
      };
    }
  };
}

/**
 * Verify the mount point is writable.
 */
export function checkWritePermissions(mountPath: string): PreflightCheck {
  return async () => {
    try {
      await access(mountPath, constants.W_OK);
      return { name: 'Write Access', passed: true, message: 'Write permissions available' };
    } catch {
      return {
        name: 'Write Access',
        passed: false,
        message: 'No write permission',
        details: 'Check mount options or run with appropriate permissions',
      };
    }
  };
}
