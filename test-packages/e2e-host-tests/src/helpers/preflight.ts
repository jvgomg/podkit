/**
 * Pre-flight checks for E2E testing.
 *
 * Validates the environment before running tests, especially important
 * for real iPod testing where hardware access is required.
 *
 * Run directly: bun run src/helpers/preflight.ts
 */

import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { isGpodToolAvailable, getGpodToolVersion, gpodTool } from '@podkit/gpod-testing';
import { isCliAvailable, getCliPath } from './cli-runner';
import { areFixturesAvailable, getFixturesDir } from './fixtures';

/**
 * Check result with pass/fail status and details.
 */
export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

/**
 * Run all pre-flight checks.
 */
export async function runPreflightChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check 1: CLI is built
  results.push(await checkCliBuilt());

  // Check 2: gpod-tool is available
  results.push(await checkGpodTool());

  // Check 3: FFmpeg is available
  results.push(await checkFfmpeg());

  // Check 4: Test fixtures are available
  results.push(await checkFixtures());

  // Check 5-8: Real iPod checks (only if IPOD_MOUNT is set)
  const mountPath = process.env['IPOD_MOUNT'];
  if (mountPath) {
    results.push(await checkMountExists(mountPath));
    results.push(await checkIpodStructure(mountPath));
    results.push(await checkItunesDb(mountPath));
    results.push(await checkFreeSpace(mountPath));
    results.push(await checkWritePermissions(mountPath));
  }

  return results;
}

async function checkCliBuilt(): Promise<CheckResult> {
  const available = await isCliAvailable();
  const cliPath = getCliPath();

  if (available) {
    return {
      name: 'CLI Built',
      passed: true,
      message: 'podkit CLI is built',
      details: cliPath,
    };
  }
  return {
    name: 'CLI Built',
    passed: false,
    message: 'podkit CLI not found - run `bun run build` first',
    details: `Expected at: ${cliPath}`,
  };
}

async function checkGpodTool(): Promise<CheckResult> {
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
}

async function checkFfmpeg(): Promise<CheckResult> {
  try {
    const result = await $`ffmpeg -version`.quiet().nothrow();
    if (result.exitCode === 0) {
      const firstLine = result.stdout.toString().split('\n')[0] ?? 'unknown';
      return {
        name: 'FFmpeg',
        passed: true,
        message: 'FFmpeg is available',
        details: firstLine,
      };
    }
    return {
      name: 'FFmpeg',
      passed: false,
      message: 'FFmpeg found but returned error',
      details: result.stderr.toString(),
    };
  } catch {
    return {
      name: 'FFmpeg',
      passed: false,
      message: 'FFmpeg not found in PATH',
      details: 'Install with `brew install ffmpeg` or equivalent',
    };
  }
}

async function checkFixtures(): Promise<CheckResult> {
  const available = await areFixturesAvailable();
  const dir = getFixturesDir();

  if (available) {
    return {
      name: 'Test Fixtures',
      passed: true,
      message: 'Audio fixtures are available',
      details: dir,
    };
  }
  return {
    name: 'Test Fixtures',
    passed: false,
    message: 'Test fixtures not found',
    details: `Expected at: ${dir}`,
  };
}

async function checkMountExists(mountPath: string): Promise<CheckResult> {
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
}

async function checkIpodStructure(mountPath: string): Promise<CheckResult> {
  const ipodControlPath = join(mountPath, 'iPod_Control');

  try {
    await access(ipodControlPath);
    return {
      name: 'iPod Structure',
      passed: true,
      message: 'iPod_Control directory exists',
      details: ipodControlPath,
    };
  } catch {
    return {
      name: 'iPod Structure',
      passed: false,
      message: 'iPod_Control directory not found',
      details: 'This may not be a valid iPod mount point',
    };
  }
}

async function checkItunesDb(mountPath: string): Promise<CheckResult> {
  try {
    const result = await gpodTool.verify(mountPath);
    if (result.valid) {
      return {
        name: 'iTunesDB',
        passed: true,
        message: 'iTunesDB is readable',
        details: `${result.trackCount} tracks, ${result.playlistCount} playlists`,
      };
    }
    return {
      name: 'iTunesDB',
      passed: false,
      message: 'iTunesDB verification failed',
      details: result.error,
    };
  } catch (err) {
    return {
      name: 'iTunesDB',
      passed: false,
      message: 'Failed to verify iTunesDB',
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkFreeSpace(mountPath: string): Promise<CheckResult> {
  const minSpaceMb = 50;

  try {
    const result = await $`df -m ${mountPath}`.quiet();
    const lines = result.stdout.toString().trim().split('\n');
    const dataLine = lines[1];
    if (dataLine) {
      const parts = dataLine.split(/\s+/);
      const availableMb = parseInt(parts[3] ?? '0', 10);

      if (availableMb >= minSpaceMb) {
        return {
          name: 'Free Space',
          passed: true,
          message: `${availableMb}MB available`,
          details: `Minimum required: ${minSpaceMb}MB`,
        };
      }
      return {
        name: 'Free Space',
        passed: false,
        message: `Only ${availableMb}MB available`,
        details: `Minimum required: ${minSpaceMb}MB`,
      };
    }
    return {
      name: 'Free Space',
      passed: false,
      message: 'Could not parse disk space',
    };
  } catch (err) {
    return {
      name: 'Free Space',
      passed: false,
      message: 'Failed to check free space',
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkWritePermissions(mountPath: string): Promise<CheckResult> {
  try {
    await access(mountPath, constants.W_OK);
    return {
      name: 'Write Access',
      passed: true,
      message: 'Write permissions available',
    };
  } catch {
    return {
      name: 'Write Access',
      passed: false,
      message: 'No write permission',
      details: 'Check mount options or run with appropriate permissions',
    };
  }
}

/**
 * Print check results to console.
 */
export function printResults(results: CheckResult[]): void {
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

// Allow running directly as a script
if (import.meta.main) {
  const mountPath = process.env['IPOD_MOUNT'];
  if (!mountPath) {
    console.log('\x1b[33mNote: IPOD_MOUNT not set - skipping real iPod checks\x1b[0m');
    console.log('Set IPOD_MOUNT=/Volumes/YourIPod to check real device.\n');
  }

  const results = await runPreflightChecks();
  printResults(results);

  const failed = results.filter((r) => !r.passed);
  process.exit(failed.length > 0 ? 1 : 0);
}
