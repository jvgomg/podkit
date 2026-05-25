/**
 * T2 — `resolveUsbDeviceFromPath` on macOS against real `diskutil` +
 * `system_profiler` subprocesses.
 *
 * Pins the production code path that drives `podkit device add --path …`
 * on macOS. T1 coverage in `usb-enumeration.test.ts` already covers the
 * pure parsers (`parseSystemProfilerUsbData`, `parseLocationId`,
 * `extractProductId` / `extractVendorId`); this file adds the end-to-end
 * "real `diskutil` doesn't know this path → null" assertion.
 *
 * # Scenarios
 *
 *   - `resolveUsbDeviceFromPath` returns `null` for paths that do not
 *     correspond to any USB device. Real `diskutil info <path>` exits
 *     non-zero on an unknown path; the resolver catches that and returns
 *     null without throwing.
 *
 * # Scope
 *
 *   - Positive correlation (a real iPod under `/Volumes/<NAME>` → its
 *     fingerprint) requires physical hardware and is exercised by manual
 *     smoke tests / VM tests on Linux via dummy_hcd. Not in scope for host tests.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveUsbDeviceFromPath } from './usb-path-resolution.js';

const isDarwin = process.platform === 'darwin';
if (!isDarwin) {
  console.log(`Skipping usb-path-resolution.darwin.test.ts on ${process.platform}`);
}

describe.skipIf(!isDarwin)(
  'resolveUsbDeviceFromPath returns null for non-USB paths (macOS, real subprocesses)',
  () => {
    it('returns null for an ephemeral tmpfs path that diskutil cannot resolve', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-path-ephem-'));
      try {
        // `diskutil info <tmpDir>` exits non-zero — the resolver catches
        // the non-zero exit and returns null without throwing.
        const result = await resolveUsbDeviceFromPath(tmpDir);
        expect(result).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }, 15_000);

    it('returns null for a fabricated /Volumes path that does not exist', async () => {
      const result = await resolveUsbDeviceFromPath(
        `/Volumes/usb-path-fake-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      expect(result).toBeNull();
    }, 15_000);

    it('returns null for / (root volume is APFS-on-NVMe, not a USB device)', async () => {
      // diskutil reports a real block device for `/`, but it's the internal
      // NVMe — its bsd_name will not appear in `system_profiler
      // SPUSBDataType -json`. The resolver walks the system_profiler tree
      // and returns null when no match is found.
      const result = await resolveUsbDeviceFromPath('/');
      expect(result).toBeNull();
    }, 15_000);
  }
);
