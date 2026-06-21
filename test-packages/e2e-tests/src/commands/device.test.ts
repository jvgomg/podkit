/**
 * E2E tests for device management commands.
 *
 * Tests `device add`, `device reset`, and `device init` commands.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, runCliJson } from '../helpers/cli-runner';
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
    // The config-inject tier (`--no-validate`) writes the config row straight
    // from a complete identity with zero device I/O — the product-level
    // replacement for the removed test-only synthetic-UUID hatch. These tests
    // therefore need no device target at all.
    it('adds device with existing database', async () => {
      // Create minimal config
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'testipod',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-validate',
        '--volume-uuid',
        'test-existing-db',
        '--yes',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Added to config');

      // Verify config was updated
      const config = await readFile(configPath, 'utf-8');
      expect(config).toContain('[devices.testipod]');
    });

    it('outputs JSON with device info', async () => {
      await writeFile(configPath, 'version = 2\n');

      const { result, json } = await runCliJson<{
        success: boolean;
        device: { name: string };
        saved: boolean;
        isDefault: boolean;
      }>([
        '--config',
        configPath,
        '--json',
        '--device',
        'testipod',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-validate',
        '--volume-uuid',
        'test-json-info',
      ]);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.device.name).toBe('testipod');
      expect(json!.saved).toBe(true);
      expect(json!.isDefault).toBe(true); // First device becomes default
    });

    it('sets first device as default', async () => {
      await writeFile(configPath, 'version = 2\n');

      await runCli([
        '--config',
        configPath,
        '--device',
        'firstipod',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-validate',
        '--volume-uuid',
        'test-first-default',
        '--yes',
      ]);

      const config = await readFile(configPath, 'utf-8');
      expect(config).toContain('[defaults]');
      expect(config).toContain('device = "firstipod"');
    });

    it('rejects invalid device name', async () => {
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        '123invalid',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-validate',
        '--volume-uuid',
        'test-invalid-name',
        '--yes',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid device name');
    });

    it('rejects duplicate device name', async () => {
      // Create config with existing device
      await writeFile(
        configPath,
        `version = 2

[devices.existing]
volumeUuid = "test-uuid"
volumeName = "test"
`
      );

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'existing',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-validate',
        '--volume-uuid',
        'test-duplicate-name',
        '--yes',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already exists');
    });
  });

  describe('SysInfoExtended', () => {
    /**
     * Strip both identity files from the test target so the cascade has
     * nothing on disk. Combined with the test target's lack of a real USB
     * connection, the firmware-inquiry assessment lands in `unwritable`
     * state with no usable USB fingerprint — no model anchor resolves.
     */
    async function stripIdentity(targetPath: string): Promise<void> {
      const deviceDir = join(targetPath, 'iPod_Control', 'Device');
      for (const file of ['SysInfo', 'SysInfoExtended']) {
        try {
          await rm(join(deviceDir, file));
        } catch {
          /* may not exist */
        }
      }
    }

    // Host tmpdir targets have no real filesystem UUID, so a verify-tier add
    // by path now trips the no-UUID gate (VOLUME_UUID_REQUIRED) before the
    // cascade can even assess identity — the no-UUID refusal shadows the
    // empty-identity refusal for these targets. The empty-identity *policy*
    // (refuse when no signal, --force / declared bypass) is exercised directly
    // as an exhaustive Outcome table in `verification-policy.test.ts`; here we
    // pin the host-rendered no-UUID refusal copy + the `--force` bypass.
    it('refuses to add a UUID-less target in the verify tier (no-UUID gate)', async () => {
      await withTarget(async (target) => {
        await stripIdentity(target.path);
        await writeFile(configPath, 'version = 2\n');

        const result = await runCli([
          '--config',
          configPath,
          '--device',
          'testipod',
          'device',
          'add',
          '--path',
          target.path,
          '--yes',
        ]);

        // Refusal: no-UUID gate fires, exit 1, device NOT persisted.
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('does not have a readable filesystem UUID');
        // The removed flag must no longer be suggested anywhere.
        expect(result.stderr).not.toContain('--no-firmware-inquiry');
        // Config row was not written.
        const config = await readFile(configPath, 'utf-8');
        expect(config).not.toContain('[devices.testipod]');
      });
    });

    it('proceeds with --force on a UUID-less target (warning, exit 0)', async () => {
      await withTarget(async (target) => {
        await stripIdentity(target.path);
        await writeFile(configPath, 'version = 2\n');

        const result = await runCli([
          '--config',
          configPath,
          '--device',
          'testipod',
          'device',
          'add',
          '--path',
          target.path,
          '--yes',
          '--force',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Added to config');
        // --force bypasses the no-UUID gate → path-only warning, then proceeds.
        expect(result.stderr).toContain('without a stable volume UUID');
        const config = await readFile(configPath, 'utf-8');
        expect(config).toContain('[devices.testipod]');
      });
    });

    it('writes config from args with --no-validate (no device read, exit 0)', async () => {
      await withTarget(async (target) => {
        await stripIdentity(target.path);
        await writeFile(configPath, 'version = 2\n');

        // The config-inject tier replaces the old test-only synthetic-UUID
        // hatch: it writes the row straight from a complete identity with zero
        // device I/O, so a UUID-less target adds cleanly.
        const result = await runCli([
          '--config',
          configPath,
          '--device',
          'testipod',
          'device',
          'add',
          '--type',
          'ipod',
          '--no-validate',
          '--volume-uuid',
          'test-sysinfo-novalidate',
          '--yes',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Added to config');
        const config = await readFile(configPath, 'utf-8');
        expect(config).toContain('[devices.testipod]');
      });
    });

    // The partial-cascade *warning* ("Unable to determine device model" when a
    // declared type proceeds without a model anchor) is reached only after the
    // no-UUID gate passes — i.e. for a real/VM device that carries a filesystem
    // UUID. On a UUID-less host tmpdir the no-UUID gate now shadows it, so that
    // behaviour is covered as an Outcome row in `verification-policy.test.ts`
    // (partial-identity) and by the VM persona cases. Here we pin the host
    // config-inject path: a declared `--type ipod` writes the row from args.
    it('writes config from a declared --type with --no-validate', async () => {
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'testipod',
        'device',
        'add',
        '--type',
        'ipod',
        '--no-validate',
        '--volume-uuid',
        'test-declared-type',
        '--yes',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Added to config');
      const config = await readFile(configPath, 'utf-8');
      expect(config).toContain('[devices.testipod]');
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
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'newipod',
        'device',
        'add',
        '--path',
        uninitDir,
        '--yes',
        // Empty mount point → cascade has no identity signal at all.
        // Requires explicit `--force` to proceed in this case.
        '--force',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Initializing iPod database');
      expect(result.stdout).toContain('Added to config');

      // Verify database was created
      await access(join(uninitDir, 'iPod_Control', 'iTunes', 'iTunesDB'));
    });

    it('outputs JSON with initialized flag', async () => {
      await writeFile(configPath, 'version = 2\n');

      const { result, json } = await runCliJson<{
        success: boolean;
        initialized: boolean;
        device: { modelName: string };
      }>([
        '--config',
        configPath,
        '--json',
        '--device',
        'newipod',
        'device',
        'add',
        '--path',
        uninitDir,
        // Empty mount point → cascade has no identity signal at all.
        // Requires explicit `--force` to proceed.
        '--force',
      ]);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.initialized).toBe(true);
      // `device add` on an empty dir falls back to "Unknown iPod" when there
      // is no SysInfo or other identity hint, while `device init` defaults to
      // an iPod Video 5G shape. Both are valid — assert the field is a
      // non-empty string rather than coupling to either path's specific
      // default.
      expect(typeof json!.device.modelName).toBe('string');
      expect(json!.device.modelName.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('fails when path does not exist', async () => {
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'badipod',
        'device',
        'add',
        '--path',
        '/nonexistent/path',
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
      await writeFile(
        configPath,
        `version = 2

[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
      );

      // Get initial track count (should be 0, but testing the flow)
      const _initialCount = await target.getTrackCount();

      // Reset the database
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'device',
        'reset',
        '--yes',
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
      await writeFile(
        configPath,
        `version = 2

[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
      );

      const { result, json } = await runCliJson<{
        success: boolean;
        mountPoint: string;
        modelName: string;
        tracksRemoved: number;
      }>(['--config', configPath, '--json', '--device', target.path, 'device', 'reset', '--yes']);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.mountPoint).toBe(target.path);
      // Dummy target uses MA147 (iPod Video 5G). `device reset` reads
      // `ipod.device.modelName` directly from libgpod's own model table
      // (e.g. "Video (Black)"), not podkit's longer `displayName` — assert
      // the libgpod shape.
      expect(json!.modelName).toMatch(/Video/i);
    });
  });

  it('supports dry-run mode', async () => {
    await withTarget(async (target) => {
      await writeFile(
        configPath,
        `version = 2

[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
      );

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'device',
        'reset',
        '--dry-run',
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
      await writeFile(
        configPath,
        `version = 2

[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
      );

      const { result, json } = await runCliJson<{
        success: boolean;
        dryRun: boolean;
        mountPoint: string;
      }>([
        '--config',
        configPath,
        '--json',
        '--device',
        target.path,
        'device',
        'reset',
        '--dry-run',
      ]);

      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.success).toBe(true);
      expect(json!.dryRun).toBe(true);
    });
  });

  describe('error handling', () => {
    it('fails when device not found in config', async () => {
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        'nonexistent',
        'device',
        'reset',
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

      await writeFile(
        configPath,
        `version = 2

[devices.uninitipod]
volumeUuid = "test-uuid"
volumeName = "Uninitialized iPod"
`
      );

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        uninitDir,
        'device',
        'reset',
        '--yes',
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

      await writeFile(
        configPath,
        `version = 2

[devices.uninitipod]
volumeUuid = "test-uuid"
volumeName = "Uninitialized iPod"
`
      );

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        uninitDir,
        'device',
        'reset',
        '--dry-run',
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

    await writeFile(
      configPath,
      `version = 2

[devices.emptyipod]
volumeUuid = "test-uuid"
volumeName = "Empty iPod"
`
    );

    const result = await runCli([
      '--config',
      configPath,
      '--device',
      uninitDir,
      'device',
      'init',
      '--yes',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('initialized successfully');

    // Verify database was created
    await access(join(uninitDir, 'iPod_Control', 'iTunes', 'iTunesDB'));
  });

  it('fails when database already exists without --force', async () => {
    await withTarget(async (target) => {
      await writeFile(
        configPath,
        `version = 2

[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
      );

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'device',
        'init',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('already has a database');
      expect(result.stderr).toContain('--force');
    });
  });

  it('reinitializes with --force and --yes', async () => {
    await withTarget(async (target) => {
      await writeFile(
        configPath,
        `version = 2

[devices.testipod]
volumeUuid = "test-uuid"
volumeName = "Test iPod"
`
      );

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'device',
        'init',
        '--force',
        '--yes',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('initialized successfully');
    });
  });

  it('outputs JSON with model info', async () => {
    const uninitDir = join(tempDir, 'new-ipod');
    await mkdir(uninitDir, { recursive: true });

    await writeFile(
      configPath,
      `version = 2

[devices.newipod]
volumeUuid = "test-uuid"
volumeName = "New iPod"
`
    );

    const { result, json } = await runCliJson<{
      success: boolean;
      device: string;
      mountPoint: string;
      modelName: string;
    }>(['--config', configPath, '--json', '--device', uninitDir, 'device', 'init', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(json).not.toBeNull();
    expect(json!.success).toBe(true);
    // Default init: iPod Video 5G shape via libgpod ("Video (Black)").
    expect(json!.modelName).toMatch(/Video/i);
    expect(json!.mountPoint).toBe(uninitDir);
  });
});

// =============================================================================
// Device readiness diagnostics (doctor command)
// =============================================================================

describe('podkit doctor with readiness', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-doctor-readiness-'));
    configPath = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('shows readiness checks before database checks on healthy device', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, 'version = 2\n');
      // --no-system: focus on device-scope behaviour; system checks (FFmpeg,
      // libusb) are environment-coupled and have their own unit coverage.
      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'doctor',
        '--no-system',
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Device Readiness');
      expect(result.stdout).toContain('Database Health');
      // Readiness stages should show check marks for key stages
      expect(result.stdout).toContain('Mounted');
      expect(result.stdout).toContain('SysInfo');
      expect(result.stdout).toContain('Database');
      expect(result.stdout).toContain('All checks passed');
    });
  });

  it('shows readiness in JSON output', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, 'version = 2\n');
      const { result, json } = await runCliJson<{
        healthy: boolean;
        readiness?: {
          level: string;
          stages: Array<{ stage: string; status: string; summary: string }>;
        };
        checks: Array<{ id: string; status: string }>;
      }>(['--config', configPath, '--json', '--device', target.path, 'doctor', '--no-system']);
      expect(result.exitCode).toBe(0);
      expect(json).not.toBeNull();
      expect(json!.healthy).toBe(true);
      expect(json!.readiness).toBeDefined();
      expect(json!.readiness!.level).toBe('ready');
      expect(json!.readiness!.stages).toHaveLength(6);

      // Verify all six stages are present in order
      const stageNames = json!.readiness!.stages.map((s) => s.stage);
      expect(stageNames).toEqual([
        'usb',
        'partition',
        'filesystem',
        'mount',
        'sysinfo',
        'database',
      ]);

      // Mount, sysinfo, and database should pass on a healthy device
      const mount = json!.readiness!.stages.find((s) => s.stage === 'mount');
      expect(mount!.status).toBe('pass');
      const sysinfo = json!.readiness!.stages.find((s) => s.stage === 'sysinfo');
      expect(sysinfo!.status).toBe('pass');
      const database = json!.readiness!.stages.find((s) => s.stage === 'database');
      expect(database!.status).toBe('pass');
    });
  });

  it('shows readiness failures and skips DB checks when no database', async () => {
    await writeFile(configPath, 'version = 2\n');

    // Create iPod structure without database
    const ipodPath = join(tempDir, 'no-db-ipod');
    await mkdir(join(ipodPath, 'iPod_Control', 'iTunes'), { recursive: true });
    await mkdir(join(ipodPath, 'iPod_Control', 'Device'), { recursive: true });
    // Write a SysInfo file so sysinfo stage passes
    await writeFile(join(ipodPath, 'iPod_Control', 'Device', 'SysInfo'), 'ModelNumStr: MA147\n');

    const result = await runCli(['--config', configPath, '--device', ipodPath, 'doctor']);
    // Should show readiness with database failure
    expect(result.stdout).toContain('Device Readiness');
    expect(result.stdout).toContain('Database');
    // Database Health section should be skipped
    expect(result.stdout).toContain('Skipped');
    expect(result.stdout).toContain('database is not available');
    // Doctor ran cleanly but found issues — exit 2 (not 1, which would be a command error)
    expect(result.exitCode).toBe(2);
  });

  it('JSON output shows readiness failure when no database', async () => {
    await writeFile(configPath, 'version = 2\n');

    const ipodPath = join(tempDir, 'no-db-ipod-json');
    await mkdir(join(ipodPath, 'iPod_Control', 'iTunes'), { recursive: true });
    await mkdir(join(ipodPath, 'iPod_Control', 'Device'), { recursive: true });
    await writeFile(join(ipodPath, 'iPod_Control', 'Device', 'SysInfo'), 'ModelNumStr: MA147\n');

    const { result, json } = await runCliJson<{
      healthy: boolean;
      readiness?: {
        level: string;
        stages: Array<{ stage: string; status: string; summary: string }>;
      };
      checks: Array<unknown>;
    }>(['--config', configPath, '--json', '--device', ipodPath, 'doctor']);

    // Doctor ran cleanly but found issues — exit 2
    expect(result.exitCode).toBe(2);
    expect(json).not.toBeNull();
    expect(json!.healthy).toBe(false);
    expect(json!.readiness).toBeDefined();
    // Database stage should fail
    const dbStage = json!.readiness!.stages.find((s) => s.stage === 'database');
    expect(dbStage).toBeDefined();
    expect(dbStage!.status).toBe('fail');
    // No DB health checks should have run
    expect(json!.checks).toHaveLength(0);
  });

  it('shows readiness failure when iPod_Control is missing', async () => {
    await writeFile(configPath, 'version = 2\n');

    // Create empty directory (no iPod structure at all)
    const emptyPath = join(tempDir, 'empty-device');
    await mkdir(emptyPath, { recursive: true });

    const { result, json } = await runCliJson<{
      healthy: boolean;
      readiness?: {
        level: string;
        stages: Array<{ stage: string; status: string; summary: string }>;
      };
      checks: Array<unknown>;
    }>(['--config', configPath, '--json', '--device', emptyPath, 'doctor']);

    // Doctor ran cleanly but found issues — exit 2
    expect(result.exitCode).toBe(2);
    expect(json).not.toBeNull();
    expect(json!.healthy).toBe(false);
    expect(json!.readiness).toBeDefined();
    // Mount stage should fail (no iPod_Control)
    const mountStage = json!.readiness!.stages.find((s) => s.stage === 'mount');
    expect(mountStage).toBeDefined();
    expect(mountStage!.status).toBe('fail');
    // Subsequent stages should be skipped
    const sysinfoStage = json!.readiness!.stages.find((s) => s.stage === 'sysinfo');
    expect(sysinfoStage).toBeDefined();
    expect(sysinfoStage!.status).toBe('skip');
    const dbStage = json!.readiness!.stages.find((s) => s.stage === 'database');
    expect(dbStage).toBeDefined();
    expect(dbStage!.status).toBe('skip');
  });

  it('shows readiness with SysInfo missing but database present', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, 'version = 2\n');

      // Delete SysInfo to simulate missing SysInfo on an otherwise healthy device
      const sysInfoPath = join(target.path, 'iPod_Control', 'Device', 'SysInfo');
      try {
        await rm(sysInfoPath);
      } catch {
        // SysInfo may not exist in the dummy target
      }

      const { json } = await runCliJson<{
        healthy: boolean;
        readiness?: {
          level: string;
          stages: Array<{ stage: string; status: string; summary: string }>;
        };
        checks: Array<{ id: string; status: string }>;
      }>(['--config', configPath, '--json', '--device', target.path, 'doctor', '--no-system']);

      expect(json).not.toBeNull();
      expect(json!.readiness).toBeDefined();

      // SysInfo stage should fail
      const sysinfoStage = json!.readiness!.stages.find((s) => s.stage === 'sysinfo');
      expect(sysinfoStage).toBeDefined();
      expect(sysinfoStage!.status).toBe('fail');

      // Database stage should still pass (SysInfo doesn't block database check)
      const dbStage = json!.readiness!.stages.find((s) => s.stage === 'database');
      expect(dbStage).toBeDefined();
      expect(dbStage!.status).toBe('pass');

      // Readiness level should be needs-repair (SysInfo missing)
      expect(json!.readiness!.level).toBe('needs-repair');

      // DB health checks should still run despite SysInfo failure
      expect(json!.checks.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Doctor repair options
// =============================================================================

describe('podkit doctor --repair', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-doctor-repair-'));
    configPath = join(tempDir, 'config.toml');
    await writeFile(configPath, 'version = 2\n');
  });

  it('accepts sysinfo-extended as a valid repair check ID', async () => {
    // Use a nonexistent device path — we just need to verify the option is
    // accepted by the CLI parser (not rejected as "invalid choice")
    const result = await runCli([
      '--config',
      configPath,
      '--device',
      join(tempDir, 'fake-ipod'),
      'doctor',
      '--repair',
      'sysinfo-extended',
    ]);

    // Should fail because device doesn't exist, NOT because the option is invalid
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain('is invalid');
    expect(result.stderr).not.toContain('Allowed choices');
  });
});

// =============================================================================
// Device init with readiness-related behavior
// =============================================================================

describe('podkit device init with readiness', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-init-readiness-'));
    configPath = join(tempDir, 'config.toml');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('initializes device that has no database', async () => {
    await writeFile(configPath, 'version = 2\n');

    // Create empty directory (no iPod structure)
    const ipodPath = join(tempDir, 'empty-ipod');
    await mkdir(ipodPath, { recursive: true });

    const result = await runCli([
      '--config',
      configPath,
      '--device',
      ipodPath,
      'device',
      'init',
      '--yes',
    ]);

    // Should proceed with initialization
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('initialized successfully');
  });

  it('rejects init on already initialized device without --force', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'device',
        'init',
      ]);

      // Should detect existing database and refuse
      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/already (has a database|initialized)/);
      expect(output).toContain('--force');
    });
  });

  it('force reinitializes already initialized device', async () => {
    await withTarget(async (target) => {
      await writeFile(configPath, 'version = 2\n');

      const result = await runCli([
        '--config',
        configPath,
        '--device',
        target.path,
        'device',
        'init',
        '--force',
        '--yes',
      ]);

      // Should proceed with reinitialization
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('initialized successfully');
    });
  });

  it('JSON output includes readiness level when available', async () => {
    await writeFile(configPath, 'version = 2\n');

    const ipodPath = join(tempDir, 'new-ipod');
    await mkdir(ipodPath, { recursive: true });

    const { result, json } = await runCliJson<{
      success: boolean;
      mountPoint: string;
      modelName: string;
      readinessLevel?: string;
    }>(['--config', configPath, '--json', '--device', ipodPath, 'device', 'init', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(json).not.toBeNull();
    expect(json!.success).toBe(true);
    expect(json!.mountPoint).toBe(ipodPath);
    // Default init: iPod Video 5G shape via libgpod ("Video (Black)").
    expect(json!.modelName).toMatch(/Video/i);
  });
});
