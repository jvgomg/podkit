/**
 * Unit tests for `renderDeviceScan` — the pure rendering function for
 * `podkit device scan` text output.
 *
 * These tests pin the CLI's rendering output for synthetic
 * classified-device sets, closing the coverage gap that the integration
 * test (`device-scan.integration.test.ts`) acknowledges but does not close
 * — namely, that a regression which reintroduced "render every USB device
 * as a phantom iPod" at the *rendering* layer (downstream of
 * `classifyUsbDevices`) would not be caught by the integration test.
 */

import { describe, expect, it } from 'bun:test';
import { classifyAsIpod, type IpodClassification, type IpodModel } from '@podkit/devices-ipod';
import {
  classifyAsMassStorage,
  type MassStorageClassification,
} from '@podkit/devices-mass-storage';
import type { EnumeratedUsbDevice, ReadinessResult, ReadinessStageResult } from '@podkit/core';
import { renderDeviceScan, type DeviceScanInput } from './device-scan-render.js';

// ── Fake injectables ─────────────────────────────────────────────────────────

/**
 * A minimal stand-in for `createUsbOnlyReadinessResult` used by the
 * renderer when a USB-only iPod is supported and needs partitioning.
 * The real implementation lives in `@podkit/core`; we don't import it
 * here because the renderer is purposefully decoupled from core to keep
 * these tests synchronous and zero-I/O.
 */
function fakeCreateUsbOnlyReadinessResult(
  classification: IpodClassification<EnumeratedUsbDevice>
): ReadinessResult {
  const stages: ReadinessStageResult[] = [
    {
      stage: 'usb',
      status: 'pass',
      summary: `${classification.model?.displayName ?? 'Unknown iPod'} (Apple ${classification.device.vendorId})`,
    },
    {
      stage: 'partition',
      status: 'fail',
      summary: 'No disk representation found',
    },
    { stage: 'filesystem', status: 'skip', summary: 'skipped' },
    { stage: 'mount', status: 'skip', summary: 'skipped' },
    { stage: 'sysinfo', status: 'skip', summary: 'skipped' },
    { stage: 'database', status: 'skip', summary: 'skipped' },
  ];
  return {
    level: 'needs-partition',
    stages,
    usbModel: classification.model,
  };
}

function emptyInput(overrides: Partial<DeviceScanInput> = {}): DeviceScanInput {
  return {
    ipods: [],
    usbOnlyIpods: [],
    massStorageDevices: [],
    configuredDevices: [],
    isSupportedPlatform: true,
    createUsbOnlyReadinessResult: fakeCreateUsbOnlyReadinessResult,
    ...overrides,
  };
}

// ── Helpers to build classified devices via the real classifiers ────────────

function classifyIpod(device: EnumeratedUsbDevice): IpodClassification<EnumeratedUsbDevice> {
  const result = classifyAsIpod(device);
  if (!result) throw new Error(`expected iPod for ${device.vendorId}/${device.productId}`);
  return result;
}

function classifyMassStorage(
  device: EnumeratedUsbDevice
): MassStorageClassification<EnumeratedUsbDevice> {
  const result = classifyAsMassStorage(device);
  if (!result) throw new Error(`expected mass-storage for ${device.vendorId}/${device.productId}`);
  return result;
}

// Synthetic ready-state readiness for a mounted iPod row — no fail/warn stages,
// a `summary` block so the renderer emits the "Ready — N tracks, M free" line.
function readyReadiness(model?: IpodModel): ReadinessResult {
  const stages: ReadinessStageResult[] = [
    { stage: 'usb', status: 'pass', summary: 'USB present' },
    { stage: 'partition', status: 'pass', summary: 'partitioned' },
    { stage: 'filesystem', status: 'pass', summary: 'HFS+' },
    { stage: 'mount', status: 'pass', summary: 'mounted' },
    { stage: 'sysinfo', status: 'pass', summary: 'present' },
    { stage: 'database', status: 'pass', summary: 'present' },
  ];
  return {
    level: 'ready',
    stages,
    summary: { trackCount: 42, freeBytes: 10_000_000_000 },
    deviceModel: model,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('renderDeviceScan', () => {
  describe('phantom-iPod regression — empty inputs render no phantom entries', () => {
    it('emits the no-devices footer for fully empty input — no "Unknown iPod" anywhere', () => {
      const lines = renderDeviceScan(emptyInput());
      const joined = lines.join('\n');
      expect(joined).not.toContain('Unknown iPod');
      expect(joined).not.toContain('USB only');
      expect(joined).not.toContain('Not detected');
      expect(lines).toEqual([
        'No devices found.',
        '',
        'Make sure your device is connected and mounted, or add one with: podkit device add',
      ]);
    });

    it('emits the no-devices footer regardless of platform support', () => {
      // Even on an unsupported platform (e.g. Linux without lsblk), an empty
      // bus must not produce phantom entries.
      const lines = renderDeviceScan(emptyInput({ isSupportedPlatform: false }));
      expect(lines.join('\n')).not.toContain('Unknown iPod');
      expect(lines[0]).toBe('No devices found.');
    });
  });

  describe('mixed scan — synthetic input with one of each kind', () => {
    // 1 mounted iPod (real) — uses `readyReadiness` so the row renders the
    //   full readiness summary block.
    // 1 USB-only iPod — supported (iPod 5G Video, PID 1209).
    // 1 mass-storage DAP (Echo Mini, presetId echo-mini).
    // 1 iOS device (iPod touch 5G, PID 12aa) — recognised, supported: false.
    // 1 configured-but-not-detected device.

    const mountedIpod = {
      device: {
        volumeName: 'TERAPOD',
        volumeUuid: 'AAAA-BBBB',
        identifier: 'disk5s2',
        size: 80_000_000_000,
        isMounted: true,
        mountPoint: '/Volumes/TERAPOD',
      },
      readiness: readyReadiness({
        displayName: 'iPod 5G Video',
        generationId: 'video_5g',
        checksumType: 'none',
        source: 'usb',
      } as IpodModel),
      configuredName: 'terapod',
    };

    const usbOnlySupported = classifyIpod({
      vendorId: '05ac',
      productId: '1209',
      diskIdentifier: 'disk7',
    });
    const usbOnlyUnsupported = classifyIpod({
      vendorId: '05ac',
      productId: '12aa',
    });
    const echoMini = classifyMassStorage({
      vendorId: '071b',
      productId: '3203',
      diskIdentifier: 'disk8',
    });

    const input: DeviceScanInput = emptyInput({
      ipods: [mountedIpod],
      usbOnlyIpods: [usbOnlySupported, usbOnlyUnsupported],
      massStorageDevices: [echoMini],
      configuredDevices: [{ name: 'spare', type: 'ipod' }],
    });

    const output = renderDeviceScan(input).join('\n');

    it('renders the mounted iPod with its label and configured name', () => {
      expect(output).toContain('TERAPOD');
      expect(output).toContain('(disk5s2)');
      expect(output).toContain('Configured as: terapod');
    });

    it('renders the supported USB-only iPod with its model display name', () => {
      // The classifier yields `model.displayName` for PID 1209 — the renderer
      // surfaces it on the "(USB only)" line.
      expect(output).toContain('(USB only)');
      expect(output).toContain(usbOnlySupported.model!.displayName);
    });

    it('renders the unsupported USB-only iPod with its not-supported reason', () => {
      expect(output).toContain('This device is not supported by podkit.');
      expect(output).toContain(usbOnlyUnsupported.notSupportedReason!);
    });

    it('renders the mass-storage DAP with preset id and disk identifier', () => {
      expect(output).toContain('(echo-mini)');
      expect(output).toContain('disk: disk8');
    });

    it('renders the configured-but-not-detected device under "Not detected"', () => {
      expect(output).toContain('Not detected:');
      expect(output).toContain('spare');
    });

    it('keeps recognised devices in input order — mounted, USB-only, mass-storage, configured', () => {
      // Sanity: each group's marker phrase appears in the expected order.
      const idxTerapod = output.indexOf('TERAPOD');
      const idxUsbOnly = output.indexOf('(USB only)');
      const idxMassStorage = output.indexOf('echo-mini');
      const idxNotDetected = output.indexOf('Not detected:');
      expect(idxTerapod).toBeGreaterThan(-1);
      expect(idxUsbOnly).toBeGreaterThan(idxTerapod);
      expect(idxMassStorage).toBeGreaterThan(idxUsbOnly);
      expect(idxNotDetected).toBeGreaterThan(idxMassStorage);
    });
  });

  describe('configured-not-detected only — supported platform', () => {
    it('emits "No iPod devices found." plus the Not detected block', () => {
      const lines = renderDeviceScan(
        emptyInput({
          configuredDevices: [
            { name: 'spare', type: 'ipod' },
            { name: 'mini', type: 'echo-mini', path: '/Volumes/SDCARD' },
          ],
        })
      );
      const joined = lines.join('\n');
      expect(joined).toContain('No iPod devices found.');
      expect(joined).toContain('Not detected:');
      expect(joined).toContain('spare');
      expect(joined).toContain('mini');
      expect(joined).toContain('/Volumes/SDCARD');
      expect(joined).not.toContain('Unknown iPod');
    });
  });

  describe('USB-only iPod with no model (defensive — should not happen post-classify)', () => {
    it('falls back to "Unknown iPod" label only when model is absent', () => {
      // Construct a synthetic IpodClassification by hand rather than via the
      // classifier — the real classifier always yields a model for PIDs in
      // its tables. This pins the fallback so we can detect any change in
      // wording without coupling to a specific classifier path.
      const synthetic: IpodClassification<EnumeratedUsbDevice> = {
        kind: 'ipod',
        device: { vendorId: '05ac', productId: '0000' },
        supported: true,
      };
      const lines = renderDeviceScan(emptyInput({ usbOnlyIpods: [synthetic] }));
      expect(lines.join('\n')).toContain('Unknown iPod (USB only)');
    });
  });
});
