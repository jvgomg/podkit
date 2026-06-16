/**
 * Unit tests for `resolveDeviceName` — the helper that lets `device add` /
 * `device remove` accept either a positional `<name>` argument or the
 * program-level `-d <name>` flag, but rejects a silent disagreement
 * between the two.
 */
import { describe, it, expect } from 'bun:test';
import type { DiscoveredDevice } from '@podkit/core';
import { CliError } from '../../errors.js';
import { matchConfiguredDeviceToDiscovered, resolveDeviceName } from './shared.js';

describe('resolveDeviceName', () => {
  it('returns the positional argument when given alone', () => {
    expect(resolveDeviceName('terapod', undefined, 'add')).toBe('terapod');
  });

  it('returns the -d global flag when given alone', () => {
    expect(resolveDeviceName(undefined, 'terapod', 'remove')).toBe('terapod');
  });

  it('accepts both forms when they agree (user being explicit)', () => {
    expect(resolveDeviceName('terapod', 'terapod', 'add')).toBe('terapod');
  });

  it('throws DEVICE_ARG_CONFLICT when positional and -d disagree', () => {
    let thrown: unknown;
    try {
      resolveDeviceName('terapod', 'sallys-ipod', 'remove');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliError);
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_ARG_CONFLICT');
    expect(err.message).toContain('terapod');
    expect(err.message).toContain('sallys-ipod');
  });

  it('throws DEVICE_REQUIRED with both-form usage hint when neither is given', () => {
    let thrown: unknown;
    try {
      resolveDeviceName(undefined, undefined, 'add');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliError);
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_REQUIRED');
    // Both forms must be in the usage hint so a confused user sees both.
    expect(err.message).toContain('podkit device add <name>');
    expect(err.message).toContain('podkit -d <name> device add');
  });

  it('treats empty-string positional as missing (not as a valid name)', () => {
    let thrown: unknown;
    try {
      resolveDeviceName('', undefined, 'add');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_REQUIRED');
  });

  it('treats whitespace-only positional as missing', () => {
    let thrown: unknown;
    try {
      resolveDeviceName('   ', undefined, 'remove');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as CliError;
    expect(err.code).toBe('DEVICE_REQUIRED');
  });

  it('trims surrounding whitespace from a valid positional', () => {
    expect(resolveDeviceName('  terapod  ', undefined, 'add')).toBe('terapod');
  });

  it('uses the command label in the usage hint', () => {
    let thrown: unknown;
    try {
      resolveDeviceName(undefined, undefined, 'remove');
    } catch (err) {
      thrown = err;
    }
    const err = thrown as CliError;
    expect(err.message).toContain('podkit device remove <name>');
    expect(err.message).toContain('podkit -d <name> device remove');
  });
});

// =============================================================================
// matchConfiguredDeviceToDiscovered — priority chain + over-match gating
// =============================================================================

function ipodDiscovered(opts: {
  volumeUuid?: string;
  mountPoint?: string;
  serial?: string;
}): DiscoveredDevice {
  return {
    kind: 'ipod',
    matchedBy: opts.serial ? 'serial' : opts.mountPoint ? 'disk-identifier' : 'usb-only',
    block: opts.mountPoint
      ? {
          identifier: 'disk2s2',
          volumeName: 'IPOD',
          volumeUuid: opts.volumeUuid ?? '',
          isMounted: true,
          mountPoint: opts.mountPoint,
          storage: { sizeBytes: 0 },
        }
      : undefined,
    usb: opts.serial
      ? ({
          kind: 'ipod',
          supported: true,
          device: {
            vendorId: '05ac',
            productId: '1261',
            serialNumber: opts.serial,
          },
        } as unknown as DiscoveredDevice extends { usb?: infer U } ? U : never)
      : undefined,
  } as DiscoveredDevice;
}

function massStorageDiscovered(opts: {
  presetId: string;
  mountPoint?: string;
  volumeUuid?: string;
}): DiscoveredDevice {
  return {
    kind: 'mass-storage',
    matchedBy: opts.mountPoint ? 'disk-identifier' : 'usb-only',
    block: opts.mountPoint
      ? {
          identifier: 'disk3s1',
          volumeName: 'ECHO',
          volumeUuid: opts.volumeUuid ?? '',
          isMounted: true,
          mountPoint: opts.mountPoint,
          storage: { sizeBytes: 0 },
        }
      : undefined,
    usb: {
      kind: 'mass-storage',
      presetId: opts.presetId,
      // The renderer only touches `.presetId` and `.device.serialNumber`;
      // the rest of `MassStorageClassification` is filled with cast-shape
      // placeholders that the matcher never reads.
      preset: {} as unknown as never,
      confidence: 'exact',
      device: { vendorId: '071b', productId: '3203' },
    } as unknown as DiscoveredDevice extends { usb?: infer U } ? U : never,
  } as DiscoveredDevice;
}

describe('matchConfiguredDeviceToDiscovered', () => {
  it('priority 1: volume UUID wins (case-insensitive)', () => {
    const d1 = ipodDiscovered({ volumeUuid: 'aaaa-1111', mountPoint: '/Volumes/IPOD' });
    const d2 = ipodDiscovered({ volumeUuid: 'bbbb-2222', mountPoint: '/Volumes/IPOD2' });
    const match = matchConfiguredDeviceToDiscovered({ volumeUuid: 'AAAA-1111', type: 'ipod' }, [
      d2,
      d1,
    ]);
    expect(match).toBe(d1);
  });

  it('priority 2: mount path matches when UUID absent', () => {
    const d = ipodDiscovered({ mountPoint: '/Volumes/IPOD' });
    const match = matchConfiguredDeviceToDiscovered({ path: '/Volumes/IPOD', type: 'ipod' }, [d]);
    expect(match).toBe(d);
  });

  it('priority 3: USB serial matches against configUuid (USB-only device)', () => {
    const d = ipodDiscovered({ serial: '5U851AEH3R0' });
    const match = matchConfiguredDeviceToDiscovered({ volumeUuid: '5U851AEH3R0', type: 'ipod' }, [
      d,
    ]);
    expect(match).toBe(d);
  });

  it('priority 3: case-insensitive serial match', () => {
    const d = ipodDiscovered({ serial: '5u851aeh3r0' });
    const match = matchConfiguredDeviceToDiscovered({ volumeUuid: '5U851AEH3R0', type: 'ipod' }, [
      d,
    ]);
    expect(match).toBe(d);
  });

  it('priority 4: sole-preset-match fires only when no UUID or path was set', () => {
    const d = massStorageDiscovered({ presetId: 'echo-mini', mountPoint: '/Volumes/ECHO' });
    const match = matchConfiguredDeviceToDiscovered({ type: 'echo-mini' }, [d]);
    expect(match).toBe(d);
  });

  it('priority 4 is GATED: configured UUID present but unmatched → no fallback', () => {
    // Regression for the round-1 reviewer finding: two echo-minis, one
    // disconnected. Looking up Config B (UUID = BBBB) when only A (UUID =
    // AAAA) is plugged in must NOT re-attribute the connected device to B.
    const d = massStorageDiscovered({
      presetId: 'echo-mini',
      mountPoint: '/Volumes/ECHO_A',
      volumeUuid: 'AAAA-1111',
    });
    const match = matchConfiguredDeviceToDiscovered(
      { type: 'echo-mini', volumeUuid: 'BBBB-2222' },
      [d]
    );
    expect(match).toBeUndefined();
  });

  it('priority 4 is GATED: configured path present but unmatched → no fallback', () => {
    const d = massStorageDiscovered({
      presetId: 'echo-mini',
      mountPoint: '/Volumes/ECHO_A',
    });
    const match = matchConfiguredDeviceToDiscovered(
      { type: 'echo-mini', path: '/Volumes/ECHO_B' },
      [d]
    );
    expect(match).toBeUndefined();
  });

  it('priority 4: sole-match refuses when two devices share a preset id', () => {
    const a = massStorageDiscovered({ presetId: 'echo-mini', mountPoint: '/Volumes/ECHO_A' });
    const b = massStorageDiscovered({ presetId: 'echo-mini', mountPoint: '/Volumes/ECHO_B' });
    const match = matchConfiguredDeviceToDiscovered({ type: 'echo-mini' }, [a, b]);
    expect(match).toBeUndefined();
  });

  it('priority 4: skipped for iPod-typed configs (type === "ipod" is not a preset)', () => {
    const d = ipodDiscovered({ serial: '5U851AEH3R0' });
    const match = matchConfiguredDeviceToDiscovered({ type: 'ipod' }, [d]);
    expect(match).toBeUndefined();
  });

  it('returns undefined when no discovered entry matches', () => {
    const match = matchConfiguredDeviceToDiscovered({ volumeUuid: 'AAAA-1111' }, []);
    expect(match).toBeUndefined();
  });
});
