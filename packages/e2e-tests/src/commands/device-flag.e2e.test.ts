/**
 * E2E tests for the global `--device` flag.
 *
 * Tests the `--device` flag which accepts either:
 * - A path (e.g., /Volumes/IPOD, ./ipod)
 * - A named device (e.g., terapod)
 *
 * Detection logic:
 * - If value contains '/' or starts with '.' -> treat as path
 * - Otherwise -> try named device lookup
 */

import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, Albums, getAlbumDir } from '../helpers/fixtures';

interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  error?: string;
  plan?: {
    tracksToAdd: number;
  };
}

// Track temp directories for cleanup
let tempDirs: string[] = [];

describe('global --device flag', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
  });

  afterEach(async () => {
    // Clean up temp directories
    for (const dir of tempDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    tempDirs = [];
  });

  describe('path detection', () => {
    it('treats absolute paths as paths (contains /)', async () => {
      await withTarget(async (target) => {
        // Create minimal config
        const tempDir = await mkdtemp(join(tmpdir(), 'podkit-path-test-'));
        tempDirs.push(tempDir);
        const configPath = join(tempDir, 'config.toml');
        await writeFile(configPath, '# empty config\n');

        // Using --device with an absolute path should work
        const result = await runCli([
          '--config',
          configPath,
          '--device',
          target.path,
          'device',
          'info',
        ]);

        // Should recognize it as path mode and show device info
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('path mode');
        // Should NOT say "device not found in config"
        expect(result.stderr).not.toContain('not found in config');
      });
    });

    it('treats relative paths with dot as paths (starts with .)', async () => {
      // Create a config with a device named to avoid any confusion
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-dot-test-'));
      tempDirs.push(tempDir);
      const configPath = join(tempDir, 'config.toml');
      await writeFile(configPath, '# empty config\n');

      // Use ./relative/path style - should be treated as path
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        './some/relative/path',
        'device',
        'info',
      ]);

      // Should be recognized as path mode
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('path mode');
      // Should NOT try to look up as a device name
      expect(result.stderr).not.toContain('not found in config');
    });

    it('treats values with slashes as paths, not device names', async () => {
      // Create a config with a device named "some" to verify it doesn't resolve
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-slash-test-'));
      tempDirs.push(tempDir);
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        `[devices.some]
volumeUuid = "test-uuid"
volumeName = "Some Device"
`
      );

      // Use "some/path" - should be treated as path, not as device "some"
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'some/path',
        'device',
        'info',
      ]);

      // Should be path mode, not resolve "some" device
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('path mode');
      expect(result.stdout).toContain('some/path');
      // Should NOT show device UUID from "some" device
      expect(result.stdout).not.toContain('test-uuid');
    });
  });

  describe('named device lookup', () => {
    it('resolves named device when no slashes present', async () => {
      // Create config with a device
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-named-test-'));
      tempDirs.push(tempDir);
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        `[devices.terapod]
volumeUuid = "ABC-123-UUID"
volumeName = "Terapod"
`
      );

      // Use --device with a name (no slashes) - should try named lookup
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'terapod',
        'device',
        'info',
      ]);

      // Should resolve the named device and show its UUID
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('terapod');
      expect(result.stdout).toContain('ABC-123-UUID');
      // Should NOT be in path mode
      expect(result.stdout).not.toContain('path mode');
    });

    it('shows error for unknown named device', async () => {
      // Create config with one device
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-unknown-test-'));
      tempDirs.push(tempDir);
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        `[devices.realdevice]
volumeUuid = "real-uuid"
volumeName = "Real"
`
      );

      // Use --device with unknown name (no slash, no dot prefix)
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'unknowndevice',
        'device',
        'info',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    it('shows error with suggestions for typos', async () => {
      // Create config with a device
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-typo-test-'));
      tempDirs.push(tempDir);
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        `[devices.terapod]
volumeUuid = "tera-uuid"
volumeName = "Terapod"
`
      );

      // Use --device with typo
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'tearpod', // typo
        'device',
        'info',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('tearpod');
      // May suggest "terapod" as similar device
    });
  });

  describe('sync command with --device', () => {
    it('uses --device path for sync', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);

        // Create config with music but no device default
        const tempDir = await mkdtemp(join(tmpdir(), 'podkit-sync-device-test-'));
        tempDirs.push(tempDir);
        const configPath = join(tempDir, 'config.toml');
        await writeFile(
          configPath,
          `[music.main]
path = "${sourcePath}"

[defaults]
music = "main"
`
        );

        // Sync using --device with path
        const result = await runCli([
          '--config',
          configPath,
          '--device',
          target.path,
          'sync',
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Dry Run');
        expect(result.stdout).toContain('Tracks to add: 3');
      });
    });

    it('outputs JSON with --device flag', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: fixtures not available');
        return;
      }

      await withTarget(async (target) => {
        const sourcePath = getAlbumDir(Albums.GOLDBERG_SELECTIONS);

        const tempDir = await mkdtemp(join(tmpdir(), 'podkit-sync-json-test-'));
        tempDirs.push(tempDir);
        const configPath = join(tempDir, 'config.toml');
        await writeFile(
          configPath,
          `[music.main]
path = "${sourcePath}"

[defaults]
music = "main"
`
        );

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          '--device',
          target.path,
          '--json',
          'sync',
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.dryRun).toBe(true);
        expect(json?.plan?.tracksToAdd).toBe(3);
      });
    });
  });

  describe('device reset command with --device', () => {
    it('uses --device path to locate device for reset', async () => {
      await withTarget(async (target) => {
        const tempDir = await mkdtemp(join(tmpdir(), 'podkit-reset-test-'));
        tempDirs.push(tempDir);
        const configPath = join(tempDir, 'config.toml');
        await writeFile(
          configPath,
          `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
        );

        // Reset using --device path
        const result = await runCli([
          '--config',
          configPath,
          'device',
          'reset',
          'testipod',
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Dry run');
      });
    });
  });

  describe('device init command with --device', () => {
    it('uses --device path for initialization', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'podkit-init-device-test-'));
      tempDirs.push(tempDir);
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        `[devices.newipod]
volumeUuid = "new-uuid"
volumeName = "New iPod"
`
      );

      // Create an empty directory to initialize
      const uninitDir = join(tempDir, 'uninit-ipod');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(uninitDir, { recursive: true });

      // Init using --device path
      const result = await runCli([
        '--config',
        configPath,
        'device',
        'init',
        'newipod',
        '--device',
        uninitDir,
        '--yes',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('initialized');
    });
  });
});
