/**
 * Unit tests for the macOS device manager's direct-query `locate` contract.
 *
 * `locate` must resolve a single target via one `diskutil info <target>`
 * subprocess — never a full `diskutil list` enumerate — and degrade to `null`
 * (not throw) when the target is unresolvable or the binary is missing.
 */

import { describe, it, expect } from 'bun:test';
import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';
import { MacOSDeviceManager } from './macos.js';

function recordingRunner(handlers: Record<string, (args: string[]) => SubprocessRunResult>): {
  runner: SubprocessRunner;
  calls: Array<{ command: string; args: string[] }>;
} {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: SubprocessRunner = {
    async run(command, args) {
      calls.push({ command, args });
      const handler = handlers[command];
      if (handler) return handler(args);
      return { stdout: '', stderr: 'unexpected', exitCode: 1 };
    },
  };
  return { runner, calls };
}

const DISKUTIL_INFO = [
  'Device Identifier:        disk5s2',
  'Volume Name:              TERAPOD',
  'Mounted:                  Yes',
  'Mount Point:              /Volumes/TERAPOD',
  'Volume UUID:              AAAA-BBBB-CCCC',
  'File System Personality:  MS-DOS FAT32',
  'Media Type:               iPod',
  'Disk Size:                64.0 GB',
  'Device Block Size:        512 Bytes',
].join('\n');

describe('MacOSDeviceManager.locate', () => {
  it('locate({ volumeUuid }) issues exactly one diskutil info, no diskutil list enumerate', async () => {
    const { runner, calls } = recordingRunner({
      diskutil: (args) =>
        args[0] === 'info'
          ? { stdout: DISKUTIL_INFO, stderr: '', exitCode: 0 }
          : { stdout: '', stderr: 'unexpected', exitCode: 1 },
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });

    const device = await manager.locate({ volumeUuid: 'AAAA-BBBB-CCCC' });

    expect(device?.volumeUuid).toBe('AAAA-BBBB-CCCC');
    expect(device?.volumeName).toBe('TERAPOD');
    expect(device?.isMounted).toBe(true);
    expect(device?.mountPoint).toBe('/Volumes/TERAPOD');
    // Single direct query — the UUID is passed straight to diskutil info.
    const diskutilCalls = calls.filter((c) => c.command === 'diskutil');
    expect(diskutilCalls).toHaveLength(1);
    expect(diskutilCalls[0]!.args).toEqual(['info', 'AAAA-BBBB-CCCC']);
    expect(calls.some((c) => c.args.includes('list'))).toBe(false);
  });

  it('locate({ path }) issues one diskutil info on the path', async () => {
    const { runner, calls } = recordingRunner({
      diskutil: () => ({ stdout: DISKUTIL_INFO, stderr: '', exitCode: 0 }),
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });

    const device = await manager.locate({ path: '/Volumes/TERAPOD' });

    expect(device?.volumeUuid).toBe('AAAA-BBBB-CCCC');
    const diskutilCalls = calls.filter((c) => c.command === 'diskutil');
    expect(diskutilCalls).toHaveLength(1);
    expect(diskutilCalls[0]!.args).toEqual(['info', '/Volumes/TERAPOD']);
  });

  it('locate({ path }) preserves a UUID-less but mounted volume with empty volumeUuid', async () => {
    const noUuidInfo = [
      'Device Identifier:        disk9s1',
      'Volume Name:              GADGET',
      'Mount Point:              /Volumes/GADGET',
      'File System Personality:  MS-DOS FAT32',
    ].join('\n');
    // getPlatformDeviceInfo rejects the no-UUID record; the path fallback runs.
    // Both probes are single-target `diskutil info <path>` calls — assert the
    // fallback never reaches the full `diskutil list` enumerate.
    let infoCalls = 0;
    let listCalled = false;
    const runner: SubprocessRunner = {
      async run(command, args) {
        if (command === 'diskutil' && args[0] === 'info') {
          infoCalls++;
          return { stdout: noUuidInfo, stderr: '', exitCode: 0 };
        }
        if (command === 'diskutil' && args[0] === 'list') {
          listCalled = true;
        }
        return { stdout: '', stderr: '', exitCode: 1 };
      },
    };
    const manager = new MacOSDeviceManager({ subprocess: runner });

    const device = await manager.locate({ path: '/Volumes/GADGET' });
    expect(device).not.toBeNull();
    expect(device?.volumeUuid).toBe('');
    expect(device?.mountPoint).toBe('/Volumes/GADGET');
    expect(device?.isMounted).toBe(true);
    // Direct probe + path fallback = exactly two `diskutil info` calls, and
    // crucially no enumerate.
    expect(infoCalls).toBe(2);
    expect(listCalled).toBe(false);
  });

  it('locate({ path }) returns null for a non-mountpoint sub-path (diskutil resolves the containing volume)', async () => {
    // `diskutil info /Users/x/scratch` resolves to the CONTAINING volume
    // (Mount Point `/`). Exact-mountpoint matching must reject this so a
    // sub-path doesn't silently adopt the root volume; null lets the caller's
    // no-UUID gate decide.
    const containingVolume = [
      'Device Identifier:        disk3s1',
      'Volume Name:              Macintosh HD',
      'Mounted:                  Yes',
      'Mount Point:              /',
      'Volume UUID:              ROOT-UUID-0000',
      'File System Personality:  APFS',
    ].join('\n');
    const { runner } = recordingRunner({
      diskutil: (args) =>
        args[0] === 'info'
          ? { stdout: containingVolume, stderr: '', exitCode: 0 }
          : { stdout: '', stderr: 'unexpected', exitCode: 1 },
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });
    expect(await manager.locate({ path: '/Users/x/scratch' })).toBeNull();
  });

  it('locate returns null (does not throw) when diskutil exits non-zero (bogus UUID)', async () => {
    const { runner } = recordingRunner({
      diskutil: () => ({ stdout: '', stderr: 'Could not find disk', exitCode: 1 }),
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });
    expect(await manager.locate({ volumeUuid: 'NOPE' })).toBeNull();
  });

  it('locate returns null (does not throw) when the diskutil binary is missing', async () => {
    const runner: SubprocessRunner = {
      async run() {
        throw new Error('spawn diskutil ENOENT');
      },
    };
    const manager = new MacOSDeviceManager({ subprocess: runner });
    expect(await manager.locate({ path: '/Volumes/x' })).toBeNull();
  });
});

describe('MacOSDeviceManager.detectFilesystem', () => {
  it('reads the File System Personality from diskutil info', async () => {
    const { runner, calls } = recordingRunner({
      diskutil: () => ({ stdout: DISKUTIL_INFO, stderr: '', exitCode: 0 }),
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });

    expect(await manager.detectFilesystem('/Volumes/TERAPOD')).toBe('MS-DOS FAT32');
    expect(calls[0]!.args).toEqual(['info', '/Volumes/TERAPOD']);
  });

  it('returns null when diskutil exits non-zero', async () => {
    const { runner } = recordingRunner({
      diskutil: () => ({ stdout: '', stderr: 'not found', exitCode: 1 }),
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });
    expect(await manager.detectFilesystem('/Volumes/x')).toBeNull();
  });
});

describe('MacOSDeviceManager.setVolumeLabel', () => {
  it('relabels via `diskutil rename <path> <label>`', async () => {
    const { runner, calls } = recordingRunner({
      diskutil: () => ({ stdout: 'Volume renamed', stderr: '', exitCode: 0 }),
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });

    await manager.setVolumeLabel('/Volumes/IPOD', 'PARTY IPOD');

    const diskutilCalls = calls.filter((c) => c.command === 'diskutil');
    expect(diskutilCalls).toHaveLength(1);
    expect(diskutilCalls[0]!.args).toEqual(['rename', '/Volumes/IPOD', 'PARTY IPOD']);
  });

  it('throws VolumeLabelError when diskutil rename fails', async () => {
    const { runner } = recordingRunner({
      diskutil: () => ({ stdout: '', stderr: 'Resource busy', exitCode: 1 }),
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });

    await expect(manager.setVolumeLabel('/Volumes/IPOD', 'X')).rejects.toThrow(/Resource busy/);
  });
});

describe('MacOSDeviceManager.scan whole-disk volumes', () => {
  // Some iPod shuffles write their filesystem to the bare disk (`disk4`) with
  // no partition map, so the mounted volume is a whole disk — not `disk4s1`.
  // Enumeration must surface such a whole disk, while a normal disk that DOES
  // have partitions must still be represented by its partitions, never the
  // container disk itself.
  const listPlist = [
    '<plist><dict><key>AllDisksAndPartitions</key><array>',
    '<dict><key>DeviceIdentifier</key><string>disk4</string>',
    '<key>MountPoint</key><string>/Volumes/NIKKI POD</string></dict>',
    '<dict><key>DeviceIdentifier</key><string>disk5</string>',
    '<key>Partitions</key><array>',
    '<dict><key>DeviceIdentifier</key><string>disk5s2</string></dict>',
    '</array></dict>',
    '</array></dict></plist>',
  ].join('\n');

  const infoFor: Record<string, string> = {
    disk4: [
      'Device Identifier:        disk4',
      'Volume Name:              NIKKI POD',
      'Mounted:                  Yes',
      'Mount Point:              /Volumes/NIKKI POD',
      'Volume UUID:              50D938CA-2681-3CE1-9162-AAB0109B3B71',
      'File System Personality:  MS-DOS FAT32',
      'Media Type:               iPod',
    ].join('\n'),
    disk5s2: [
      'Device Identifier:        disk5s2',
      'Volume Name:              DATA',
      'Mounted:                  Yes',
      'Mount Point:              /Volumes/DATA',
      'Volume UUID:              1111-2222-3333-4444',
      'File System Personality:  APFS',
      'Media Type:               Generic',
    ].join('\n'),
  };

  it('surfaces a partitionless whole-disk iPod volume; skips a partitioned container disk', async () => {
    const { runner, calls } = recordingRunner({
      diskutil: (args) => {
        if (args[0] === 'list') return { stdout: listPlist, stderr: '', exitCode: 0 };
        if (args[0] === 'info') {
          const out = infoFor[args[1] ?? ''];
          return out
            ? { stdout: out, stderr: '', exitCode: 0 }
            : { stdout: '', stderr: 'no such disk', exitCode: 1 };
        }
        return { stdout: '', stderr: 'unexpected', exitCode: 1 };
      },
    });
    const manager = new MacOSDeviceManager({ subprocess: runner });

    const ipods = await manager.scan();

    // The whole-disk shuffle-style volume is discovered as a mounted iPod.
    const shuffle = ipods.find((d) => d.identifier === 'disk4');
    expect(shuffle).toBeDefined();
    expect(shuffle!.isMounted).toBe(true);
    expect(shuffle!.mountPoint).toBe('/Volumes/NIKKI POD');

    // The container disk that HAS a partition is never queried as a whole disk;
    // its partition represents it instead.
    const infoIds = calls.filter((c) => c.args[0] === 'info').map((c) => c.args[1]);
    expect(infoIds).toContain('disk4');
    expect(infoIds).not.toContain('disk5');
  });
});
