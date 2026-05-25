/**
 * T2 — `resolveUsbDeviceFromPath` on Linux against real subprocesses + sysfs.
 *
 * Pins the production code path that drives `podkit device add --path …`
 * when the user supplies a literal mount point. T1 coverage in
 * `usb-enumeration.test.ts` already covers the pure parsers
 * (`findBlockDeviceForMount`, `findUsbAncestor`); this file adds the
 * end-to-end "OS doesn't know this path → null" assertion.
 *
 * # Scenarios
 *
 *   - `resolveUsbDeviceFromPath` returns `null` for paths that do not
 *     correspond to any USB device. Three flavours:
 *       1. A tmpfs path that isn't a mount point at all (`/tmp/<rand>`).
 *       2. A path under tmpfs (`/tmp`) — `/proc/mounts` will list `/tmp`
 *          but it's not a block-device-backed FS, so the sysfs walk
 *          terminates with no USB ancestor.
 *       3. `/` — almost always backed by a real block device, but a
 *          non-USB one (NVMe / SATA / virtio). The walk reaches sysfs
 *          but finds no USB ancestor.
 *
 * # Scope
 *
 *   - Positive correlation ("given a real iPod at /mnt/ipod, returns the
 *     right bus/devnum/serial") is exercised end-to-end by the VM-test
 *     `personas-baseline.e2e.test.ts` against the dummy-hcd persona.
 *     That's the right place: T2 cannot synthesise a USB device, and the
 *     macOS-equivalent assertion would need physical hardware.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveUsbDeviceFromPath } from './usb-path-resolution.js';

const isLinux = process.platform === 'linux';
if (!isLinux) {
  console.log(`Skipping usb-path-resolution.linux.test.ts on ${process.platform}`);
}

describe.skipIf(!isLinux)(
  'resolveUsbDeviceFromPath returns null for non-USB paths (Linux, real subprocesses)',
  () => {
    it('returns null for an ephemeral tmpfs path that is not a mount point', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-path-ephem-'));
      try {
        // The directory exists but is not listed in /proc/mounts as its own
        // mount point — `findBlockDeviceForMount` returns null and the
        // resolver short-circuits to null without throwing.
        const result = await resolveUsbDeviceFromPath(tmpDir);
        expect(result).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns null for a tmpfs mount point (/tmp or similar)', async () => {
      // /tmp is typically tmpfs on Linux; its `/proc/mounts` entry has a
      // non-/dev/ source (`tmpfs`). The resolver must drop it cleanly
      // instead of walking into sysfs with a bogus block-device name.
      const result = await resolveUsbDeviceFromPath('/tmp');
      expect(result).toBeNull();
    });

    it('returns null for a fabricated /mnt path that does not exist', async () => {
      const result = await resolveUsbDeviceFromPath(
        `/mnt/usb-path-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      expect(result).toBeNull();
    });

    it('returns null for the root filesystem (real block device, non-USB)', async () => {
      // / on this VM/host is backed by virtio-blk or a similar non-USB
      // transport; the sysfs walk should terminate at a non-USB parent
      // (no `busnum`/`devnum` files), and `findUsbAncestor` returns null.
      const result = await resolveUsbDeviceFromPath('/');
      expect(result).toBeNull();
    });
  }
);
