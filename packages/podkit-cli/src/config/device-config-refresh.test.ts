/**
 * Tests for makeDeviceConfigRefresh — the CLI seam that updates `volumeName`
 * and `path` in the podkit config after a disk relabel.
 *
 * All tests use temp directories with in-memory TOML content to avoid
 * touching any real config or device.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeDeviceConfigRefresh } from './device-config-refresh.js';
import { loadConfigFile } from './loader.js';
import type { ConfigRefreshInfo } from '@podkit/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeConfig(configPath: string, content: string): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, content);
}

function readConfig(configPath: string): string {
  return fs.readFileSync(configPath, 'utf-8');
}

// Minimal valid config with one device entry that has a volumeUuid.
function makeConfigContent(
  overrides: {
    deviceName?: string;
    volumeUuid?: string;
    volumeName?: string;
    path?: string;
  } = {}
): string {
  const {
    deviceName = 'terapod',
    volumeUuid = 'DEADBEEF-1234',
    volumeName = 'TERAPOD',
    path: devicePath = '/Volumes/TERAPOD',
  } = overrides;

  return (
    [
      'version = 2',
      '',
      `[devices.${deviceName}]`,
      `volumeUuid = "${volumeUuid}"`,
      `volumeName = "${volumeName}"`,
      `path = "${devicePath}"`,
    ].join('\n') + '\n'
  );
}

function makeInfo(overrides: Partial<ConfigRefreshInfo> = {}): ConfigRefreshInfo {
  return {
    volumeUuid: 'DEADBEEF-1234',
    oldPath: '/Volumes/TERAPOD',
    newPath: '/Volumes/PARTY IPOD',
    newLabel: 'PARTY IPOD',
    name: 'Party iPod',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('makeDeviceConfigRefresh', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-config-refresh-test-'));
    configPath = path.join(tempDir, 'config.toml');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  // -------------------------------------------------------------------------
  // Happy path: device present in config
  // -------------------------------------------------------------------------

  it('updates volumeName and path when device is found by volumeUuid', async () => {
    writeConfig(configPath, makeConfigContent());

    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(makeInfo());

    const updated = readConfig(configPath);
    expect(updated).toContain('volumeName = "PARTY IPOD"');
    expect(updated).toContain('path = "/Volumes/PARTY IPOD"');
  });

  it('does NOT change the device alias (config key)', async () => {
    writeConfig(configPath, makeConfigContent({ deviceName: 'terapod' }));

    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(makeInfo());

    const updated = readConfig(configPath);
    expect(updated).toContain('[devices.terapod]');
  });

  it('does NOT change the volumeUuid', async () => {
    writeConfig(configPath, makeConfigContent({ volumeUuid: 'DEADBEEF-1234' }));

    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(makeInfo({ volumeUuid: 'DEADBEEF-1234' }));

    const updated = readConfig(configPath);
    expect(updated).toContain('volumeUuid = "DEADBEEF-1234"');
  });

  it('matching is case-insensitive on volumeUuid', async () => {
    // Config stores lowercase uuid; info supplies uppercase
    writeConfig(configPath, makeConfigContent({ volumeUuid: 'deadbeef-1234' }));

    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(makeInfo({ volumeUuid: 'DEADBEEF-1234' }));

    const updated = readConfig(configPath);
    expect(updated).toContain('volumeName = "PARTY IPOD"');
  });

  it('updated config still round-trips through loadConfigFile', async () => {
    writeConfig(configPath, makeConfigContent());

    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(makeInfo());

    // Must parse without throwing
    const config = loadConfigFile(configPath);
    const device = config?.devices?.['terapod'];
    expect(device).toBeDefined();
    expect(device?.volumeName).toBe('PARTY IPOD');
    expect(device?.path).toBe('/Volumes/PARTY IPOD');
    // UUID unchanged
    expect(device?.volumeUuid).toBe('DEADBEEF-1234');
  });

  // -------------------------------------------------------------------------
  // Skip conditions — all silent (no throw)
  // -------------------------------------------------------------------------

  it('skips silently when volumeUuid is absent from info', async () => {
    writeConfig(configPath, makeConfigContent());

    const refresh = makeDeviceConfigRefresh({ configPath });

    // Must not throw
    await expect(refresh(makeInfo({ volumeUuid: undefined }))).resolves.toBeUndefined();

    // Config unchanged
    const content = readConfig(configPath);
    expect(content).toContain('volumeName = "TERAPOD"');
  });

  it('skips silently when no config file exists', async () => {
    // configPath does not exist — no writeConfig call
    const refresh = makeDeviceConfigRefresh({ configPath });

    // Must not throw
    await expect(refresh(makeInfo())).resolves.toBeUndefined();
  });

  it('skips silently when no device in config matches the volumeUuid', async () => {
    writeConfig(configPath, makeConfigContent({ volumeUuid: 'DIFFERENT-UUID' }));

    const refresh = makeDeviceConfigRefresh({ configPath });
    await expect(refresh(makeInfo({ volumeUuid: 'DEADBEEF-1234' }))).resolves.toBeUndefined();

    // Config unchanged
    const content = readConfig(configPath);
    expect(content).toContain('volumeName = "TERAPOD"');
  });

  it('skips silently when config has no [devices.*] section', async () => {
    writeConfig(configPath, 'version = 1\n');

    const refresh = makeDeviceConfigRefresh({ configPath });
    await expect(refresh(makeInfo())).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Reusability — same seam works for multiple devices in the same config
  // -------------------------------------------------------------------------

  it('only updates the device matching the uuid, not others', async () => {
    const content =
      [
        'version = 2',
        '',
        '[devices.terapod]',
        'volumeUuid = "DEADBEEF-1234"',
        'volumeName = "TERAPOD"',
        'path = "/Volumes/TERAPOD"',
        '',
        '[devices.nano]',
        'volumeUuid = "CAFECAFE-5678"',
        'volumeName = "NANO"',
        'path = "/Volumes/NANO"',
      ].join('\n') + '\n';

    writeConfig(configPath, content);

    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(makeInfo({ volumeUuid: 'DEADBEEF-1234' }));

    const updated = readConfig(configPath);

    // terapod updated
    expect(updated).toContain('[devices.terapod]');
    expect(updated).toContain('path = "/Volumes/PARTY IPOD"');

    // nano untouched
    expect(updated).toContain('[devices.nano]');
    expect(updated).toContain('path = "/Volumes/NANO"');
  });

  // -------------------------------------------------------------------------
  // TOML safety: special characters in the written values must round-trip
  // -------------------------------------------------------------------------

  it('escapes special characters so the config remains parseable', async () => {
    writeConfig(configPath, makeConfigContent());

    // An HFS+ name preserves case and can contain a quote/backslash; the
    // resolved path embeds it too. These must not corrupt the TOML.
    const refresh = makeDeviceConfigRefresh({ configPath });
    await refresh(
      makeInfo({
        newLabel: 'James\'s "Big" iPod\\Mini',
        newPath: '/Volumes/James\'s "Big" iPod\\Mini',
      })
    );

    // The file must still load (would throw / drop the device if corrupt).
    const reloaded = loadConfigFile(configPath);
    expect(reloaded?.devices?.terapod?.volumeName).toBe('James\'s "Big" iPod\\Mini');
    expect(reloaded?.devices?.terapod?.path).toBe('/Volumes/James\'s "Big" iPod\\Mini');
  });

  // -------------------------------------------------------------------------
  // Non-fatal warning when the config write fails
  // -------------------------------------------------------------------------

  it('warns (does not throw) when the config write fails', async () => {
    writeConfig(configPath, makeConfigContent());

    const warnings: string[] = [];
    // Point at a path inside a now-removed dir is fragile; instead make the
    // file read-only so the write fails while the load still succeeds.
    fs.chmodSync(configPath, 0o444);

    const refresh = makeDeviceConfigRefresh({ configPath, warn: (m) => warnings.push(m) });
    await refresh(makeInfo());

    // Restore perms so afterEach cleanup works regardless.
    fs.chmodSync(configPath, 0o644);

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('config');
  });
});
