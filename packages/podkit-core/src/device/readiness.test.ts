import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { PlatformDeviceInfo } from './types.js';
import { checkReadiness, checkIpodStructure, checkSysInfo, checkDatabase } from './readiness.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-readiness-'));
}

function createDevice(overrides: Partial<PlatformDeviceInfo> = {}): PlatformDeviceInfo {
  return {
    identifier: 'disk5s2',
    volumeName: 'TERAPOD',
    volumeUuid: 'ABC-123',
    size: 120 * 1024 * 1024 * 1024,
    isMounted: true,
    mountPoint: '/tmp/fake-mount',
    ...overrides,
  };
}

function createIpodStructure(mountPoint: string): void {
  fs.mkdirSync(path.join(mountPoint, 'iPod_Control', 'iTunes'), { recursive: true });
  fs.mkdirSync(path.join(mountPoint, 'iPod_Control', 'Device'), { recursive: true });
}

function writeSysInfo(mountPoint: string, content: string): void {
  const deviceDir = path.join(mountPoint, 'iPod_Control', 'Device');
  fs.mkdirSync(deviceDir, { recursive: true });
  fs.writeFileSync(path.join(deviceDir, 'SysInfo'), content);
}

// ── checkIpodStructure ───────────────────────────────────────────────────────

describe('checkIpodStructure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when iPod_Control exists and mount is writable', async () => {
    createIpodStructure(tmpDir);
    const result = await checkIpodStructure(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.stage).toBe('mount');
    expect(result.details?.readOnly).toBe(false);
  });

  it('fails when iPod_Control does not exist', async () => {
    const result = await checkIpodStructure(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('iPod_Control');
    expect(result.details?.ipodControlExists).toBe(false);
  });

  it('fails when mount point does not exist (stale mount)', async () => {
    const result = await checkIpodStructure('/tmp/nonexistent-podkit-test-' + Date.now());
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('not accessible');
  });
});

// ── checkSysInfo ─────────────────────────────────────────────────────────────

describe('checkSysInfo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes with valid SysInfo containing a known ModelNumStr', async () => {
    writeSysInfo(tmpDir, 'ModelNumStr: MA147\nFirewireGuid: 0001234');
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.summary).toContain('MA147');
    expect(result.summary).toContain('iPod Video');
    expect(result.details?.modelNumber).toBe('MA147');
    expect(result.details?.modelName).toBeTruthy();
  });

  it('warns when SysInfo has ModelNumStr that is not in the known model list', async () => {
    writeSysInfo(tmpDir, 'ModelNumStr: XX999\nFirewireGuid: 0001234');
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('XX999');
    expect(result.details?.modelNumber).toBe('XX999');
    expect(result.details?.suggestion).toBeTruthy();
  });

  it('fails when SysInfo file is missing', async () => {
    createIpodStructure(tmpDir);
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('not found');
    expect(result.details?.exists).toBe(false);
    expect(result.details?.suggestion).toBeTruthy();
  });

  it('fails when Device directory does not exist', async () => {
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('not found');
    expect(result.details?.suggestion).toBeTruthy();
  });

  it('fails when SysInfo file is empty', async () => {
    writeSysInfo(tmpDir, '');
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('empty');
    expect(result.details?.suggestion).toBeTruthy();
  });

  it('fails when SysInfo file contains binary content', async () => {
    const deviceDir = path.join(tmpDir, 'iPod_Control', 'Device');
    fs.mkdirSync(deviceDir, { recursive: true });
    // Write binary content including null bytes and control chars
    const binaryBuf = Buffer.from([0x00, 0x01, 0x02, 0x4d, 0x6f, 0x64, 0x65, 0x6c]);
    fs.writeFileSync(path.join(deviceDir, 'SysInfo'), binaryBuf);
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('binary');
    expect(result.details?.suggestion).toBeTruthy();
  });

  it('fails when SysInfo exists but ModelNumStr key is absent', async () => {
    writeSysInfo(tmpDir, 'FirewireGuid: 0001234\nSomethingElse: value');
    const result = await checkSysInfo(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('ModelNumStr not found');
    expect(result.details?.suggestion).toBeTruthy();
  });

  it('includes suggestion strings in all fail results', async () => {
    // Missing
    createIpodStructure(tmpDir);
    const missing = await checkSysInfo(tmpDir);
    expect(missing.status).toBe('fail');
    expect(typeof missing.details?.suggestion).toBe('string');

    // Empty
    writeSysInfo(tmpDir, '');
    const empty = await checkSysInfo(tmpDir);
    expect(empty.status).toBe('fail');
    expect(typeof empty.details?.suggestion).toBe('string');

    // No ModelNumStr
    writeSysInfo(tmpDir, 'FirewireGuid: 0001234');
    const noModel = await checkSysInfo(tmpDir);
    expect(noModel.status).toBe('fail');
    expect(typeof noModel.details?.suggestion).toBe('string');
  });
});

// ── checkDatabase ────────────────────────────────────────────────────────────

describe('checkDatabase', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails when iTunesDB does not exist', async () => {
    createIpodStructure(tmpDir);
    const result = await checkDatabase(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('not found');
    expect(result.details?.exists).toBe(false);
  });

  it('fails when iTunesDB exists but is corrupt', async () => {
    createIpodStructure(tmpDir);
    const dbPath = path.join(tmpDir, 'iPod_Control', 'iTunes', 'iTunesDB');
    fs.writeFileSync(dbPath, 'not a valid database');
    const result = await checkDatabase(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.details?.exists).toBe(true);
  });
});

// ── checkReadiness pipeline ──────────────────────────────────────────────────

describe('checkReadiness', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces 6 stages in correct order', async () => {
    createIpodStructure(tmpDir);
    const device = createDevice({ mountPoint: tmpDir });
    const result = await checkReadiness({ device });
    expect(result.stages).toHaveLength(6);
    expect(result.stages.map((s) => s.stage)).toEqual([
      'usb',
      'partition',
      'filesystem',
      'mount',
      'sysinfo',
      'database',
    ]);
  });

  it('produces stages in correct order', async () => {
    // Use a filesystem-fail scenario to produce all 6 stages (4 real + 2 skipped)
    const device = createDevice({ volumeName: '', mountPoint: tmpDir });
    const result = await checkReadiness({ device });
    const expectedOrder = ['usb', 'partition', 'filesystem', 'mount', 'sysinfo', 'database'];
    expect(result.stages.map((s) => s.stage)).toEqual(expectedOrder);
  });

  describe('cascade behavior', () => {
    it('skips mount/sysinfo/database when filesystem fails', async () => {
      const device = createDevice({ volumeName: '', mountPoint: tmpDir });
      const result = await checkReadiness({ device });
      expect(result.stages[2]!.status).toBe('fail'); // filesystem
      expect(result.stages[3]!.status).toBe('skip'); // mount
      expect(result.stages[4]!.status).toBe('skip'); // sysinfo
      expect(result.stages[5]!.status).toBe('skip'); // database
    });

    it('skips sysinfo/database when device is not mounted', async () => {
      const device = createDevice({ isMounted: false, mountPoint: undefined });
      const result = await checkReadiness({ device });
      expect(result.stages[3]!.status).toBe('fail'); // mount
      expect(result.stages[4]!.status).toBe('skip'); // sysinfo
      expect(result.stages[5]!.status).toBe('skip'); // database
    });

    it('skips sysinfo/database when iPod_Control is missing', async () => {
      // tmpDir exists but has no iPod_Control
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });
      expect(result.stages[3]!.status).toBe('fail'); // mount — no iPod_Control
      expect(result.stages[4]!.status).toBe('skip'); // sysinfo
      expect(result.stages[5]!.status).toBe('skip'); // database
    });
  });

  describe('level determination', () => {
    it('returns needs-init when iPod_Control is missing', async () => {
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });
      expect(result.level).toBe('needs-init');
    });

    it('returns needs-init when iPod_Control exists but no iTunesDB', async () => {
      createIpodStructure(tmpDir);
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });
      expect(result.level).toBe('needs-init');
    });

    it('returns needs-format when filesystem is unrecognized', async () => {
      const device = createDevice({ volumeName: '' });
      const result = await checkReadiness({ device });
      expect(result.level).toBe('needs-format');
    });

    it('returns needs-init when device is not mounted', async () => {
      const device = createDevice({ isMounted: false, mountPoint: undefined });
      const result = await checkReadiness({ device });
      // Unmounted device with valid filesystem → needs-init (can't check further)
      expect(result.level).toBe('needs-init');
    });

    it('returns hardware-error for stale mount point', async () => {
      const fakePath = '/tmp/nonexistent-podkit-readiness-' + Date.now();
      const device = createDevice({ mountPoint: fakePath });
      const result = await checkReadiness({ device });
      expect(result.level).toBe('hardware-error');
    });
  });

  describe('SysInfo behavior', () => {
    it('fails for missing SysInfo but continues to database check (non-blocking)', async () => {
      createIpodStructure(tmpDir);
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });

      const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
      const database = result.stages.find((s) => s.stage === 'database');
      expect(sysinfo?.status).toBe('fail');
      expect(database?.status).not.toBe('skip');
    });

    it('fails for SysInfo with no ModelNumStr but continues to database check', async () => {
      createIpodStructure(tmpDir);
      writeSysInfo(tmpDir, 'FirewireGuid: 0001234');
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });

      const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
      const database = result.stages.find((s) => s.stage === 'database');
      expect(sysinfo?.status).toBe('fail');
      expect(sysinfo?.summary).toContain('ModelNumStr not found');
      expect(database?.status).not.toBe('skip');
    });

    it('warns for SysInfo with unrecognized model number', async () => {
      createIpodStructure(tmpDir);
      writeSysInfo(tmpDir, 'ModelNumStr: XX999\nFirewireGuid: 0001234');
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });

      const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
      expect(sysinfo?.status).toBe('warn');
      expect(sysinfo?.summary).toContain('XX999');
    });

    it('SysInfo fail and database pass produces needs-repair level', async () => {
      createIpodStructure(tmpDir);
      // No SysInfo → sysinfo fail
      // No database → database fail (needs-init takes priority)
      // So write a corrupt SysInfo but let the database stage fail as not-found
      // To test needs-repair: we need sysinfo fail + database fail(corrupt)
      const dbPath = path.join(tmpDir, 'iPod_Control', 'iTunes', 'iTunesDB');
      fs.writeFileSync(dbPath, 'not a valid database');
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });

      const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
      expect(sysinfo?.status).toBe('fail');
      expect(result.level).toBe('needs-repair');
    });
  });

  describe('USB and partition stages', () => {
    it('always passes usb and partition for discovered devices', async () => {
      createIpodStructure(tmpDir);
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });

      expect(result.stages[0]!.status).toBe('pass');
      expect(result.stages[0]!.stage).toBe('usb');
      expect(result.stages[1]!.status).toBe('pass');
      expect(result.stages[1]!.stage).toBe('partition');
    });
  });

  describe('summary', () => {
    it('does not include summary for non-ready devices', async () => {
      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });
      expect(result.level).not.toBe('ready');
      expect(result.summary).toBeUndefined();
    });
  });

  describe('independent check functions', () => {
    it('checkIpodStructure is callable independently', async () => {
      createIpodStructure(tmpDir);
      const result = await checkIpodStructure(tmpDir);
      expect(result.stage).toBe('mount');
      expect(result.status).toBe('pass');
    });

    it('checkSysInfo is callable independently', async () => {
      writeSysInfo(tmpDir, 'ModelNumStr: MC297');
      const result = await checkSysInfo(tmpDir);
      expect(result.stage).toBe('sysinfo');
      expect(result.status).toBe('pass');
      expect(result.summary).toContain('MC297');
      expect(result.details?.modelNumber).toBe('MC297');
    });

    it('checkDatabase is callable independently', async () => {
      createIpodStructure(tmpDir);
      const result = await checkDatabase(tmpDir);
      expect(result.stage).toBe('database');
      // No actual iTunesDB → fail
      expect(result.status).toBe('fail');
    });
  });

  describe('corrupt database', () => {
    it('returns needs-repair when iTunesDB exists but is corrupt', async () => {
      createIpodStructure(tmpDir);
      writeSysInfo(tmpDir, 'ModelNumStr: MA147');
      const dbPath = path.join(tmpDir, 'iPod_Control', 'iTunes', 'iTunesDB');
      fs.writeFileSync(dbPath, 'not a valid database');

      const device = createDevice({ mountPoint: tmpDir });
      const result = await checkReadiness({ device });
      expect(result.level).toBe('needs-repair');
    });
  });
});
