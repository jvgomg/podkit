/**
 * Behavioural tests for the persona SCSI-discovery script builders.
 *
 * These scripts decide which `/dev/sd<x>` belongs to which persona, and they
 * are the only thing standing between a two-persona substrate and a test that
 * mounts the wrong disk. Asserting on the generated string would pin the
 * wrong property — the risk is not the text, it is whether the four-level
 * `device/../../../..` walk actually lands on the USB device dir.
 *
 * So each case builds a synthetic sysfs tree with the real shape (class entry
 * → scsi leaf → target → host → USB interface → USB device) and runs the
 * generated script through a real `sh`. That makes these subprocess-bearing
 * rather than pure, in common with the other runner suites here; no device or
 * substrate is involved.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildScsiSdDiscoveryScript, buildDeviceNodeDiscoveryScript } from './scsi-discovery.js';

// ---------------------------------------------------------------------------
// Synthetic sysfs
// ---------------------------------------------------------------------------

interface FakeDevice {
  /** Class entry name, e.g. `sg0`. */
  sg: string;
  vendorId: number;
  productId: number;
  /** Block device to attach, e.g. `sdb`. Omit to model a LUN-less gadget. */
  block?: string;
  busnum?: number;
  devnum?: number;
}

let root: string;
let classDir: string;
let treeCount = 0;

/**
 * Materialise `devices` under a fresh temp root, mirroring the sysfs layout
 * the walk depends on:
 *
 *   <class>/sg0/device -> <devices>/usb1/<port>/<port>:1.0/host0/target0:0:0/0:0:0:0
 *
 * Four `..` from that leaf is `<devices>/usb1/<port>`, the USB device dir that
 * carries idVendor/idProduct.
 */
async function buildSysfs(devices: readonly FakeDevice[]): Promise<void> {
  // Each case gets its own tree — sysfs is global, the fixture must not be.
  const tree = join(root, `tree-${treeCount++}`);
  classDir = join(tree, 'class', 'scsi_generic');
  await mkdir(classDir, { recursive: true });

  for (const [index, device] of devices.entries()) {
    const port = `1-${index + 1}`;
    const usbDir = join(tree, 'devices', 'usb1', port);
    const leaf = join(usbDir, `${port}:1.0`, 'host0', 'target0:0:0', '0:0:0:0');
    await mkdir(leaf, { recursive: true });

    const hex = (v: number) => v.toString(16).padStart(4, '0');
    await writeFile(join(usbDir, 'idVendor'), `${hex(device.vendorId)}\n`);
    await writeFile(join(usbDir, 'idProduct'), `${hex(device.productId)}\n`);
    if (device.busnum !== undefined) {
      await writeFile(join(usbDir, 'busnum'), `${device.busnum}\n`);
    }
    if (device.devnum !== undefined) {
      await writeFile(join(usbDir, 'devnum'), `${device.devnum}\n`);
    }
    if (device.block) await mkdir(join(leaf, 'block', device.block), { recursive: true });

    const sgDir = join(classDir, device.sg);
    await mkdir(sgDir, { recursive: true });
    await symlink(leaf, join(sgDir, 'device'));
  }
}

/** Run a generated script through a real `sh`, as the substrate link does. */
async function runScript(script: string): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(['sh', '-c', script], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

const ECHO_MINI = { vendorId: 0x071b, productId: 0x3203 };
const IPOD_VIDEO = { vendorId: 0x05ac, productId: 0x1209 };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'podkit-scsi-discovery-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// buildScsiSdDiscoveryScript
// ---------------------------------------------------------------------------

describe('buildScsiSdDiscoveryScript', () => {
  it('walks four levels up to the USB device dir and returns its block node', async () => {
    await buildSysfs([{ sg: 'sg0', ...ECHO_MINI, block: 'sdb' }]);
    const result = await runScript(
      buildScsiSdDiscoveryScript(ECHO_MINI.vendorId, ECHO_MINI.productId, classDir)
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('sdb');
  });

  it("picks the persona's own node when a foreign gadget enumerated first", async () => {
    // The whole point of the walk. `ls /dev/sg*` would answer sg0 here.
    await buildSysfs([
      { sg: 'sg0', ...ECHO_MINI, block: 'sdb' },
      { sg: 'sg1', ...IPOD_VIDEO, block: 'sdc' },
    ]);
    const result = await runScript(
      buildScsiSdDiscoveryScript(IPOD_VIDEO.vendorId, IPOD_VIDEO.productId, classDir)
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('sdc');
  });

  it('does not match a foreign gadget — exits 1 rather than returning its disk', async () => {
    await buildSysfs([{ sg: 'sg0', ...ECHO_MINI, block: 'sdb' }]);
    const result = await runScript(
      buildScsiSdDiscoveryScript(IPOD_VIDEO.vendorId, IPOD_VIDEO.productId, classDir)
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout.trim()).toBe('');
  });

  it('treats a matched gadget with no attached disk as not-yet', async () => {
    // An sg node appears before the kernel attaches the disk. Callers want
    // the disk, so this must read as "keep waiting", not as a match.
    await buildSysfs([{ sg: 'sg0', ...ECHO_MINI }]);
    const result = await runScript(
      buildScsiSdDiscoveryScript(ECHO_MINI.vendorId, ECHO_MINI.productId, classDir)
    );
    expect(result.exitCode).toBe(1);
  });

  it('exits 1 on an empty class dir rather than globbing its own pattern', async () => {
    await buildSysfs([]);
    const result = await runScript(
      buildScsiSdDiscoveryScript(ECHO_MINI.vendorId, ECHO_MINI.productId, classDir)
    );
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDeviceNodeDiscoveryScript
// ---------------------------------------------------------------------------

describe('buildDeviceNodeDiscoveryScript', () => {
  it('returns the block node and the zero-padded usbfs path', async () => {
    await buildSysfs([{ sg: 'sg0', ...IPOD_VIDEO, block: 'sdb', busnum: 3, devnum: 7 }]);
    const result = await runScript(
      buildDeviceNodeDiscoveryScript(IPOD_VIDEO.vendorId, IPOD_VIDEO.productId, classDir)
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['/dev/sdb', '/dev/bus/usb/003/007']);
  });

  it('keeps searching past a matching gadget that has no busnum', async () => {
    await buildSysfs([
      { sg: 'sg0', ...IPOD_VIDEO, block: 'sdb' },
      { sg: 'sg1', ...IPOD_VIDEO, block: 'sdc', busnum: 2, devnum: 11 },
    ]);
    const result = await runScript(
      buildDeviceNodeDiscoveryScript(IPOD_VIDEO.vendorId, IPOD_VIDEO.productId, classDir)
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['/dev/sdc', '/dev/bus/usb/002/011']);
  });
});
