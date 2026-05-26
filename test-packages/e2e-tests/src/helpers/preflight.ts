/**
 * Host-side preflight check assembly.
 *
 * The composable checks come from `@podkit/e2e-shared`; this file picks the
 * subset that the host suite needs, layers on real-iPod checks that depend on
 * gpod-tool / df / iPod_Control inspection, and exposes the standard
 * `runHostPreflightChecks()` entrypoint.
 *
 * Run directly: `bun run src/helpers/preflight.ts`.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gpodTool } from '@podkit/gpod-testing';
import {
  type CheckResult,
  type PreflightCheck,
  checkCliBuilt,
  checkFfmpeg,
  checkFixtureSet,
  checkGpodTool,
  checkMountExists,
  checkWritePermissions,
  printResults,
  runPreflightChecks,
} from '@podkit/e2e-shared';

export { printResults, type CheckResult };

const execFileAsync = promisify(execFile);

/**
 * Verify iTunesDB on `mountPath` is parseable by gpod-tool.
 *
 * Host-only — the docker and vm harnesses test against synthesised iPods that
 * have no iTunesDB to read.
 */
function checkItunesDb(mountPath: string): PreflightCheck {
  return async () => {
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
  };
}

/**
 * Verify `iPod_Control/` exists under the mount.
 */
function checkIpodStructure(mountPath: string): PreflightCheck {
  return async () => {
    const ipodControlPath = join(mountPath, 'iPod_Control');
    try {
      await execFileAsync('test', ['-d', ipodControlPath]);
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
  };
}

/**
 * Verify at least 50 MB free on the mount.
 */
function checkFreeSpace(mountPath: string): PreflightCheck {
  const minSpaceMb = 50;
  return async () => {
    try {
      const { stdout } = await execFileAsync('df', ['-m', mountPath]);
      const dataLine = stdout.split('\n')[1];
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
      return { name: 'Free Space', passed: false, message: 'Could not parse disk space' };
    } catch (err) {
      return {
        name: 'Free Space',
        passed: false,
        message: 'Failed to check free space',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

/**
 * Run every preflight check the host e2e suite cares about. Real-iPod checks
 * are appended when `IPOD_MOUNT` is set.
 */
export async function runHostPreflightChecks(): Promise<CheckResult[]> {
  const checks: PreflightCheck[] = [
    checkCliBuilt,
    checkGpodTool,
    checkFfmpeg,
    checkFixtureSet('multi-format'),
    checkFixtureSet('goldberg-selections'),
    checkFixtureSet('synthetic-tests'),
    checkFixtureSet('video'),
  ];

  const mountPath = process.env['IPOD_MOUNT'];
  if (mountPath) {
    checks.push(
      checkMountExists(mountPath),
      checkIpodStructure(mountPath),
      checkItunesDb(mountPath),
      checkFreeSpace(mountPath),
      checkWritePermissions(mountPath)
    );
  }

  return runPreflightChecks(checks);
}

// Allow running directly as a script.
if (import.meta.main) {
  const mountPath = process.env['IPOD_MOUNT'];
  if (!mountPath) {
    console.log('\x1b[33mNote: IPOD_MOUNT not set - skipping real iPod checks\x1b[0m');
    console.log('Set IPOD_MOUNT=/Volumes/YourIPod to check real device.\n');
  }

  const results = await runHostPreflightChecks();
  printResults(results);

  const failed = results.filter((r) => !r.passed);
  process.exit(failed.length > 0 ? 1 : 0);
}
