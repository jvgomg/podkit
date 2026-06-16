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
  BUILT_IN_PRESETS,
} from '@podkit/devices-mass-storage';
import type {
  DiscoveredDevice,
  DiscoveredDeviceIpod,
  EnumeratedUsbDevice,
  ReadinessResult,
  ReadinessStageResult,
} from '@podkit/core';
import {
  buildEnumeratedUsbDevice,
  ipodVideo5gIflash1tb as personaIpodVideo5g,
  ipodTouch5gUnsupported as personaIpodTouch5g,
  echoMini as personaEchoMini,
} from '@podkit/device-testing';
import {
  renderDeviceScan,
  type DeviceScanInput,
  type DiscoveredDeviceRow,
} from './device-scan-render.js';

// Strip ANSI escape sequences so substring assertions don't break depending on
// whether the test runner inherits a TTY (which toggles the renderer's `bold()`
// helper). Without this, assertions that span a bold boundary (e.g.
// "Unknown iPod" + " (USB only)") fail under a TTY because `\x1b[0m` lands
// between the two halves.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Fake readiness builders ──────────────────────────────────────────────────

/**
 * A minimal stand-in for the USB-only iPod arm of `checkReadiness` (the
 * branch that fires when `device.kind === 'ipod' && !device.block`). Used
 * by renderer tests to pre-compute a `'needs-partition'` readiness result
 * without booting the real core dispatch — the renderer is purposefully
 * decoupled from core (readiness is pre-computed by the caller).
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

// ── Row builder helpers ──────────────────────────────────────────────────────

/**
 * Wrap a USB-only IpodClassification as a DiscoveredDeviceRow with
 * pre-computed readiness (supported → fakeCreateUsbOnlyReadinessResult;
 * unsupported → no readiness, renderer shows the unsupportedReason instead).
 */
function usbOnlyIpodRow(
  classification: IpodClassification<EnumeratedUsbDevice>
): DiscoveredDeviceRow {
  const device: DiscoveredDeviceIpod = {
    kind: 'ipod',
    usb: classification,
    matchedBy: 'usb-only',
  };
  const readiness = classification.supported
    ? fakeCreateUsbOnlyReadinessResult(classification)
    : undefined;
  return { device, ...(readiness ? { readiness } : {}) };
}

/**
 * Wrap a block-only iPod (matched by block-only path, no USB classification)
 * as a DiscoveredDeviceRow. Exercises the render path where `displayFor`
 * returns `source: 'usb-fingerprint'` and the guard suppresses the volume
 * name from the model-label position.
 */
function blockOnlyIpodRow(
  opts: { volumeName?: string; identifier?: string } = {}
): DiscoveredDeviceRow {
  const device: DiscoveredDeviceIpod = {
    kind: 'ipod',
    block: {
      volumeName: opts.volumeName ?? 'IPOD',
      volumeUuid: '0000-0000',
      identifier: opts.identifier ?? 'sdc1',
      storage: { sizeBytes: 8_000_000_000 },
      isMounted: true,
      mountPoint: '/media/ipod',
    },
    matchedBy: 'block-only',
  };
  return { device };
}

/**
 * Wrap a MassStorageClassification as a DiscoveredDeviceRow.
 * Mass-storage devices have no readiness in the scan output.
 */
function massStorageRow(
  classification: MassStorageClassification<EnumeratedUsbDevice>
): DiscoveredDeviceRow {
  const device: DiscoveredDevice = {
    kind: 'mass-storage',
    usb: classification,
    matchedBy: 'usb-only',
  };
  return { device };
}

function emptyInput(overrides: Partial<DeviceScanInput> = {}): DeviceScanInput {
  return {
    discovered: [],
    configuredDevices: [],
    isSupportedPlatform: true,
    presets: BUILT_IN_PRESETS,
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

    const mountedIpodModel: IpodModel = {
      displayName: 'iPod 5G Video',
      generationId: 'video_5g',
      checksumType: 'none',
      source: 'usb',
    };

    const mountedIpodDevice: DiscoveredDeviceIpod = {
      kind: 'ipod',
      block: {
        volumeName: 'TERAPOD',
        volumeUuid: 'AAAA-BBBB',
        identifier: 'disk5s2',
        storage: { sizeBytes: 80_000_000_000 },
        isMounted: true,
        mountPoint: '/Volumes/TERAPOD',
      },
      matchedBy: 'disk-identifier',
    };

    const mountedIpodRow: DiscoveredDeviceRow = {
      device: mountedIpodDevice,
      readiness: readyReadiness(mountedIpodModel),
      configuredName: 'terapod',
    };

    // Persona-derived USB descriptors — keeps the test in lockstep with the
    // canonical persona registry instead of hand-coding bare hex IDs that
    // could drift if a persona is renamed or recaptured.
    const usbOnlySupported = classifyIpod(
      buildEnumeratedUsbDevice(personaIpodVideo5g, { diskIdentifier: 'disk7' })
    );
    const usbOnlyUnsupported = classifyIpod(buildEnumeratedUsbDevice(personaIpodTouch5g));
    const echoMini = classifyMassStorage(
      buildEnumeratedUsbDevice(personaEchoMini, { diskIdentifier: 'disk8' })
    );

    const input: DeviceScanInput = emptyInput({
      discovered: [
        mountedIpodRow,
        usbOnlyIpodRow(usbOnlySupported),
        usbOnlyIpodRow(usbOnlyUnsupported),
        massStorageRow(echoMini),
      ],
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
      expect(output).toContain(usbOnlyUnsupported.unsupportedReason!.headline);
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
      const lines = renderDeviceScan(emptyInput({ discovered: [usbOnlyIpodRow(synthetic)] }));
      expect(stripAnsi(lines.join('\n'))).toContain('Unknown iPod (USB only)');
    });

    it('renders "iOS device" label for an iOS-range PID with no model (TASK-317.03 #4)', () => {
      // PID 0x12ad is in the iOS-range catch (0x1290–0x12af) but not in
      // IPOD_USB_IDS — the classifier returns supported=false with an
      // unsupportedReason but no model. The renderer should NOT collapse
      // that to "Unknown iPod" — it should derive a friendly "iOS device"
      // label from the PID range so the user sees what podkit recognised.
      const synthetic: IpodClassification<EnumeratedUsbDevice> = {
        kind: 'ipod',
        device: { vendorId: '05ac', productId: '12ad' },
        supported: false,
        unsupportedReason: {
          kind: 'ios-device',
          headline:
            "iOS device (iPhone, iPad, or iPod touch) uses Apple's proprietary sync protocol.",
        },
      };
      const lines = renderDeviceScan(emptyInput({ discovered: [usbOnlyIpodRow(synthetic)] }));
      const output = stripAnsi(lines.join('\n'));
      expect(output).toContain('iOS device (USB only)');
      expect(output).not.toContain('Unknown iPod (USB only)');
    });

    it('renders the resolved model name for a known iPod touch PID (TASK-317.03 #4)', () => {
      // The known iPod touch 5G PID 0x12a0 IS in IPOD_USB_IDS — the
      // classifier returns a model with displayName. The renderer must
      // surface that name verbatim, not "Unknown iPod".
      const usbOnly = classifyIpod({ vendorId: '05ac', productId: '12a0' });
      const output = stripAnsi(
        renderDeviceScan(emptyInput({ discovered: [usbOnlyIpodRow(usbOnly)] })).join('\n')
      );
      expect(output).toContain(`${usbOnly.model!.displayName} (USB only)`);
      expect(output).not.toContain('Unknown iPod (USB only)');
    });
  });

  describe('block-only iPod (no USB classification, no readiness)', () => {
    it('renders header with volume name + identifier and no model-label suffix', () => {
      const lines = renderDeviceScan(
        emptyInput({ discovered: [blockOnlyIpodRow({ volumeName: 'MUSIC', identifier: 'sdc1' })] })
      );
      const output = stripAnsi(lines.join('\n'));
      expect(output).toContain('MUSIC');
      expect(output).toContain('(sdc1)');
      // Block-only iPod has no USB classification → no `(USB only)` suffix,
      // and the volume-name fallback from `displayFor` must NOT appear as a
      // model label (would duplicate the header label).
      expect(output).not.toContain('MUSIC  MUSIC');
      expect(output).not.toContain('(USB only)');
    });
  });

  describe('needs-partition remediation copy (TASK-317.11 #3)', () => {
    it('points at docs, not at the destructive `device init` command', () => {
      // The supported USB-only iPod (PID 1209) renders with the synthetic
      // `needs-partition` readiness produced by `fakeCreateUsbOnlyReadinessResult`.
      // The remediation line must be the new docs-pointing copy — not the
      // old "Needs partitioning — see: podkit device init" wording, which
      // misled users to a command that does not partition and requires the
      // device to already be mounted.
      const usbOnly = classifyIpod({
        vendorId: '05ac',
        productId: '1209',
      });
      const output = renderDeviceScan(emptyInput({ discovered: [usbOnlyIpodRow(usbOnly)] })).join(
        '\n'
      );
      expect(output).toContain(
        'No mountable partition detected — see: https://jvgomg.github.io/podkit/devices/troubleshooting'
      );
      expect(output).not.toContain('Needs partitioning — see: podkit device init');
    });
  });
});
