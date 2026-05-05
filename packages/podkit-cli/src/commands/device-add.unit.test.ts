/**
 * Unit tests for `device add` auto-detect flow (TASK-294.07)
 *
 * Tests the enumerate-and-classify pre-step wired into `device add`.
 * Uses process-level CLI invocation (execSync) since the auto-detect path
 * runs a live USB walk — tests cover argument-validation paths and the
 * error-path behaviours that do not require hardware.
 *
 * Hardware and Echo Mini USB detection are exercised in TASK-294.14
 * (full hardware + Echo Mini validation).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createMassStorageProvider, BUILT_IN_PRESETS } from '@podkit/devices-mass-storage';
import { enumerateConnectedDevices } from '@podkit/core';
import type { UsbDiscoveredDevice } from '@podkit/core';

const CLI_PATH = join(import.meta.dir, '..', 'main.ts');

let tempDir: string;
let configPath: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'device-add-test-'));
  configPath = join(tempDir, 'config.toml');
  writeFileSync(configPath, `version = 1\n`);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Run the CLI with the given args and return { stdout, stderr, exitCode } */
function runCli(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`bun ${CLI_PATH} --config ${configPath} ${args}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('device add --type X (explicit type, bypass enumeration)', () => {
  it('requires --path when --type echo-mini is given', () => {
    const result = runCli('device add -d myecho --type echo-mini');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--path is required');
    expect(result.stderr).toContain('echo-mini');
  });

  it('requires --path when --type rockbox is given', () => {
    const result = runCli('device add -d myrock --type rockbox');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--path is required');
    expect(result.stderr).toContain('rockbox');
  });

  it('reports path-not-found when --type echo-mini and bad --path are given', () => {
    const result = runCli('device add -d myecho --type echo-mini --path /nonexistent/path');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('/nonexistent/path');
  });
});

describe('device add (no --type, no --path) — enumeration fallback', () => {
  it('fails when --device flag is missing', () => {
    const result = runCli('device add');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--device');
  });

  it('exits non-zero when no device is found (no hardware connected)', () => {
    // This test exercises the new code path: enumerateConnectedDevices is
    // called after manager.findIpodDevices() returns empty. With no hardware,
    // enumeration also returns nothing and we fall through to the existing
    // "No iPod devices found" error.
    const result = runCli('device add -d testipod');

    expect(result.exitCode).toBe(1);
    // Should report that no iPod/device was found (one of the two messages)
    const combined = result.stdout + result.stderr;
    const hasNoDevice =
      combined.includes('No iPod devices found') ||
      combined.includes('No devices found') ||
      combined.includes('Device scanning is not supported');
    expect(hasNoDevice).toBe(true);
  });

  it('does not emit --type or --path errors when neither flag is given', () => {
    // The "no device found" error must NOT say "--path is required" since the
    // user did not pass --type (the --path-required error only applies when
    // --type is explicitly a mass-storage type).
    const result = runCli('device add -d testipod');

    expect(result.stderr).not.toContain('--path is required');
  });
});

describe('device add --type ipod (explicit iPod type)', () => {
  it('does not error on --path not required (iPod auto-scans)', () => {
    // When --type ipod is explicit, the iPod path is taken (no mass-storage
    // path check). Without a device, it should fail with the iPod-not-found
    // error, NOT "--path is required".
    const result = runCli('device add -d testipod --type ipod');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain('--path is required');
  });
});

describe('device add --type X --path <dir> (explicit mass-storage, complete path)', () => {
  it('adds a mass-storage device when type and valid path are given', () => {
    // Use a real temp directory as the "device mount point"
    const fakePath = mkdtempSync(join(tmpdir(), 'fake-echo-'));

    try {
      const result = runCli(`device add -d echotest --type echo-mini --path ${fakePath} -y`);

      // Should succeed (or at least not fail with validation errors)
      // Full add requires the tempDir to look like a real device, so we just
      // check that the error is NOT about missing --path.
      const combined = result.stdout + result.stderr;
      expect(combined).not.toContain('--path is required');
    } finally {
      rmSync(fakePath, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// AC #1 + #5: Echo Mini VID/PID hint + mocked USB tree enumeration
// =============================================================================

describe('enumerateConnectedDevices with real providers and mocked USB walk (AC #1, #5)', () => {
  // Simulate a USB walk that returns an Echo Mini fingerprint.
  const echoMiniDiscovered: UsbDiscoveredDevice = {
    usb: { vendorId: '0x071b', productId: '0x3203', serialNumber: 'EM-SERIAL-001' },
    supported: true,
  };

  it('detects Echo Mini via VID/PID 0x071b/0x3203 using built-in presets', async () => {
    const massStorageProvider = createMassStorageProvider(BUILT_IN_PRESETS);

    const result = await enumerateConnectedDevices({
      providers: [massStorageProvider],
      walk: () => Promise.resolve([echoMiniDiscovered]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.matchedProviderId).toBe('mass-storage');
    expect(result[0]!.identity?.kind).toBe('mass-storage');
    if (result[0]!.identity?.kind === 'mass-storage') {
      expect(result[0]!.identity.presetId).toBe('echo-mini');
    }
  });

  it('reports no identity for an unrecognised VID/PID with mass-storage provider only', async () => {
    const massStorageProvider = createMassStorageProvider(BUILT_IN_PRESETS);
    const unknownDevice: UsbDiscoveredDevice = {
      usb: { vendorId: '0xdead', productId: '0xbeef' },
      supported: true,
    };

    const result = await enumerateConnectedDevices({
      providers: [massStorageProvider],
      walk: () => Promise.resolve([unknownDevice]),
    });

    expect(result).toHaveLength(1);
    // Not matched by mass-storage provider (no hint for this VID/PID)
    expect(result[0]!.matchedProviderId).toBeUndefined();
    expect(result[0]!.identity).toBeUndefined();
  });

  it('returns Echo Mini presetId in identity when serialNumber is present', async () => {
    const massStorageProvider = createMassStorageProvider(BUILT_IN_PRESETS);

    const result = await enumerateConnectedDevices({
      providers: [massStorageProvider],
      walk: () =>
        Promise.resolve([
          {
            usb: { vendorId: '0x071b', productId: '0x3203', serialNumber: 'MY-ECHO-123' },
            supported: true,
          } as UsbDiscoveredDevice,
        ]),
    });

    expect(result).toHaveLength(1);
    const identity = result[0]!.identity;
    expect(identity?.kind).toBe('mass-storage');
    if (identity?.kind === 'mass-storage') {
      expect(identity.presetId).toBe('echo-mini');
      expect(identity.serialNumber).toBe('MY-ECHO-123');
    }
  });
});
