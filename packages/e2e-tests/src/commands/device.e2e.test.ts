/**
 * E2E tests for device management commands.
 *
 * Tests `device add`, `device reset`, and `device init` commands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson, createTempConfig, cleanupTempConfig } from '../helpers/cli-runner';
import { withTarget } from '../targets';

describe('podkit device add', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-device-add-test-'));
    configPath = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('with explicit path', () => {
    it('adds device with existing database', async () => {
      await withTarget(async (target) => {
        // Create minimal config
        await writeFile(configPath, '# podkit config\n');

        const result = await runCli([
          '--config', configPath,
          'device', 'add', 'testipod', target.path,
          '--yes',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('added to config');

        // Verify config was updated
        const config = await readFile(configPath, 'utf-8');
        expect(config).toContain('[devices.testipod]');
      });
    });

    it('outputs JSON with device info', async () => {
      await withTarget(async (target) => {
        await writeFile(configPath, '# podkit config\n');

        const { result, json } = await runCliJson<{
          success: boolean;
          device: { name: string; trackCount: number };
          saved: boolean;
          isDefault: boolean;
        }>([
          '--config', configPath,
          '--json',
          'device', 'add', 'testipod', target.path,
        ]);

        expect(result.exitCode).toBe(0);
        expect(json).not.toBeNull();
        expect(json!.success).toBe(true);
        expect(json!.device.name).toBe('testipod');
        expect(json!.saved).toBe(true);
        expect(json!.isDefault).toBe(true); // First device becomes default
      });
    });

    it('sets first device as default', async () => {
      await withTarget(async (target) => {
        await writeFile(configPath, '# podkit config\n');

        await runCli([
          '--config', configPath,
          'device', 'add', 'firstipod', target.path,
          '--yes',
        ]);

        const config = await readFile(configPath, 'utf-8');
        expect(config).toContain('[defaults]');
        expect(config).toContain('device = "firstipod"');
      });
    });

    it('rejects invalid device name', async () => {
      await withTarget(async (target) => {
        await writeFile(configPath, '# podkit config\n');

        const result = await runCli([
          '--config', configPath,
          'device', 'add', '123invalid', target.path,
          '--yes',
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid device name');
      });
    });

    it('rejects duplicate device name', async () => {
      await withTarget(async (target) => {
        // Create config with existing device
        await writeFile(configPath, `[devices.existing]
volumeUuid = "test-uuid"
volumeName = "test"
`);

        const result = await runCli([
          '--config', configPath,
          'device', 'add', 'existing', target.path,
          '--yes',
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('already exists');
      });
    });
  });

  describe('with uninitialized device', () => {
    let uninitDir: string;

    beforeEach(async () => {
      // Create a directory that looks like an iPod mount but has no database
      uninitDir = join(tempDir, 'uninitialized-ipod');
      await mkdir(uninitDir, { recursive: true });
    });

    it('offers to initialize and succeeds with --yes', async () => {
      await writeFile(configPath, '# podkit config\n');

      const result = await runCli([
        '--config', configPath,
        'device', 'add', 'newipod', uninitDir,
        '--yes',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Initializing iPod database');
      expect(result.stdout).toContain('added to config');

      // Verify database was created
      await access(join(uninitDir, 'iPod_Control', 'iTunes', 'iTunesDB'));
    });

    it('outputs JSON with initialized flag', async () => {
      await writeFile(configPath, '# podkit config\n');

      const { result, json } = await runCliJson<{
        success: boolean;
        initialized: boolean;
        device: { modelName: string };
      }>([
        '--config', configPath,
        '--json',
        'device', 'add', 'newipod', uninitDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.initialized).toBe(true);
      expect(json!.device.modelName).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('fails when path does not exist', async () => {
      await writeFile(configPath, '# podkit config\n');

      const result = await runCli([
        '--config', configPath,
        'device', 'add', 'badipod', '/nonexistent/path',
        '--yes',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Path not found');
    });
  });
});

describe('podkit device reset', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-device-reset-test-'));
    configPath = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('recreates database from scratch', async () => {
    await withTarget(async (target) => {
      // Add a device to config
      await writeFile(configPath, `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`);

      // Get initial track count (should be 0, but testing the flow)
      const initialCount = await target.getTrackCount();

      // Reset the database
      const result = await runCli([
        '--config', configPath,
        'device', 'reset', 'testipod',
        '--yes',
        '--device', target.path,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Database recreated');
      expect(result.stdout).toContain('Tracks: 0');

      // Verify database still works
      const verifyResult = await target.verify();
      expect(verifyResult.valid).toBe(true);
    });
  });

  it('outputs JSON with reset info', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`);

      const { result, json } = await runCliJson<{
        success: boolean;
        mountPoint: string;
        modelName: string;
        tracksRemoved: number;
      }>([
        '--config', configPath,
        '--json',
        'device', 'reset', 'testipod',
        '--yes',
        '--device', target.path,
      ]);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.mountPoint).toBe(target.path);
      expect(json!.modelName).toBeDefined();
    });
  });

  it('supports dry-run mode', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`);

      const result = await runCli([
        '--config', configPath,
        'device', 'reset', 'testipod',
        '--dry-run',
        '--device', target.path,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Dry run');
      expect(result.stdout).toContain('No changes made');

      // Verify database was NOT recreated (still valid)
      const verifyResult = await target.verify();
      expect(verifyResult.valid).toBe(true);
    });
  });

  it('dry-run outputs JSON', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`);

      const { result, json } = await runCliJson<{
        success: boolean;
        dryRun: boolean;
        mountPoint: string;
      }>([
        '--config', configPath,
        '--json',
        'device', 'reset', 'testipod',
        '--dry-run',
        '--device', target.path,
      ]);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.dryRun).toBe(true);
    });
  });

  describe('error handling', () => {
    it('fails when device not found in config', async () => {
      await writeFile(configPath, '# empty config\n');

      const result = await runCli([
        '--config', configPath,
        'device', 'reset', 'nonexistent',
        '--yes',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });
  });

  describe('edge cases', () => {
    it('creates database when resetting uninitialized device', async () => {
      // Create uninitialized directory
      const uninitDir = join(tempDir, 'uninit-ipod');
      await mkdir(uninitDir, { recursive: true });

      await writeFile(configPath, `[devices.uninitipod]
volumeUuid = "test-uuid"
volumeName = "Uninitialized iPod"
`);

      const result = await runCli([
        '--config', configPath,
        'device', 'reset', 'uninitipod',
        '--yes',
        '--device', uninitDir,
      ]);

      expect(result.exitCode).toBe(0);
      // Should say "created" not "recreated" since there was no database
      expect(result.stdout).toContain('Creating database');
      expect(result.stdout).toContain('Database created');

      // Verify database was created
      await access(join(uninitDir, 'iPod_Control', 'iTunes', 'iTunesDB'));
    });

    it('dry-run shows correct message for uninitialized device', async () => {
      const uninitDir = join(tempDir, 'uninit-dry-ipod');
      await mkdir(uninitDir, { recursive: true });

      await writeFile(configPath, `[devices.uninitipod]
volumeUuid = "test-uuid"
volumeName = "Uninitialized iPod"
`);

      const result = await runCli([
        '--config', configPath,
        'device', 'reset', 'uninitipod',
        '--dry-run',
        '--device', uninitDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('no existing database found');
    });
  });
});

describe('podkit device init', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-device-init-test-'));
    configPath = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('initializes uninitialized device', async () => {
    // Create uninitialized directory
    const uninitDir = join(tempDir, 'empty-ipod');
    await mkdir(uninitDir, { recursive: true });

    await writeFile(configPath, `[devices.emptyipod]
volumeUuid = "test-uuid"
volumeName = "Empty iPod"
`);

    const result = await runCli([
      '--config', configPath,
      'device', 'init', 'emptyipod',
      '--yes',
      '--device', uninitDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('initialized successfully');

    // Verify database was created
    await access(join(uninitDir, 'iPod_Control', 'iTunes', 'iTunesDB'));
  });

  it('fails when database already exists without --force', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`);

      const result = await runCli([
        '--config', configPath,
        'device', 'init', 'testipod',
        '--device', target.path,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already has a database');
      expect(result.stderr).toContain('--force');
    });
  });

  it('reinitializes with --force and --yes', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, `[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`);

      const result = await runCli([
        '--config', configPath,
        'device', 'init', 'testipod',
        '--force',
        '--yes',
        '--device', target.path,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('initialized successfully');
    });
  });

  it('outputs JSON with model info', async () => {
    const uninitDir = join(tempDir, 'new-ipod');
    await mkdir(uninitDir, { recursive: true });

    await writeFile(configPath, `[devices.newipod]
volumeUuid = "test-uuid"
volumeName = "New iPod"
`);

    const { result, json } = await runCliJson<{
      success: boolean;
      device: string;
      mountPoint: string;
      modelName: string;
    }>([
      '--config', configPath,
      '--json',
      'device', 'init', 'newipod',
      '--yes',
      '--device', uninitDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(json).not.toBeNull();
    expect(json!.success).toBe(true);
    expect(json!.modelName).toBeDefined();
    expect(json!.mountPoint).toBe(uninitDir);
  });
});
