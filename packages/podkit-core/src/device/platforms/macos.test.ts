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
