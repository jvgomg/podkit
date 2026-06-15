/**
 * `checkReadiness()` unsupported short-circuit (TASK-331).
 *
 * Verifies that when the USB classifier has marked an iPod as unsupported,
 * the readiness pipeline surfaces `level: 'unsupported'` and the structured
 * rejection payload — instead of running the stage cascade against a
 * device that will never mount in disk mode.
 *
 * Post-T5: the unsupported short-circuit is driven by the
 * `DiscoveredDeviceIpod`'s `usb.supported === false` flag (set by
 * `classifyAsIpod`'s lookup of the Apple unsupported-PID table) rather than
 * a separate `unsupported` field on the input. The behaviour shape is
 * preserved byte-for-byte.
 *
 * Also covers the post-sysinfo unsupported short-circuit: when `usb` is absent
 * (block-only fallback path), the pipeline must still refuse unsupported
 * generations after the sysinfo stage identifies them via ModelNumStr.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkReadiness } from '../index.js';
import type { PlatformDeviceInfo } from '../../types.js';
import type { ReadinessUnsupportedReason } from '../types.js';
import type { DiscoveredDeviceIpod } from '../../discovery.js';
import type { IpodClassification } from '@podkit/devices-ipod';
import type { EnumeratedUsbDevice } from '../../usb-enumeration.js';

function makeBlock(overrides: Partial<PlatformDeviceInfo> = {}): PlatformDeviceInfo {
  return {
    identifier: 'disk5s2',
    volumeName: 'TERAPOD',
    volumeUuid: 'ABC-123',
    storage: { sizeBytes: 0 },
    isMounted: false,
    ...overrides,
  } as PlatformDeviceInfo;
}

function makeUsb(reason: ReadinessUnsupportedReason): IpodClassification<EnumeratedUsbDevice> {
  return {
    kind: 'ipod',
    device: { vendorId: '05ac', productId: '129a' } as EnumeratedUsbDevice,
    supported: false,
    unsupportedReason: reason,
  };
}

function makeIpodArm(
  overrides: {
    block?: PlatformDeviceInfo;
    usb?: IpodClassification<EnumeratedUsbDevice>;
  } = {}
): DiscoveredDeviceIpod {
  return {
    kind: 'ipod',
    ...(overrides.block ? { block: overrides.block } : {}),
    ...(overrides.usb ? { usb: overrides.usb } : {}),
    matchedBy:
      overrides.block && overrides.usb ? 'serial' : overrides.block ? 'block-only' : 'usb-only',
  };
}

describe('checkReadiness() — unsupported short-circuit (USB-classifier driven)', () => {
  it('returns level=unsupported with payload when USB classifier marks the device unsupported', async () => {
    const headline =
      "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
    const unsupported: ReadinessUnsupportedReason = { kind: 'ios-device', headline };
    const result = await checkReadiness({
      device: makeIpodArm({ block: makeBlock(), usb: makeUsb(unsupported) }),
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupported?.kind).toBe('ios-device');
    expect(result.unsupported?.headline).toBe(headline);
  });

  it('skips remaining stages and reports usb=fail with the structured reason in details', async () => {
    const headline = 'Sony Walkman is not yet supported by podkit.';
    const unsupported: ReadinessUnsupportedReason = {
      kind: 'unsupported-preset',
      headline,
    };
    const result = await checkReadiness({
      device: makeIpodArm({ block: makeBlock(), usb: makeUsb(unsupported) }),
    });
    expect(result.stages[0]?.stage).toBe('usb');
    expect(result.stages[0]?.status).toBe('fail');
    const stageUnsupported = result.stages[0]?.details?.unsupported as
      | ReadinessUnsupportedReason
      | undefined;
    expect(stageUnsupported?.headline).toBe(headline);
    expect(stageUnsupported?.kind).toBe('unsupported-preset');
    // Every remaining stage must be skipped — none of the disk-mode
    // probes have meaningful state to report against an unsupported device.
    for (let i = 1; i < result.stages.length; i++) {
      expect(result.stages[i]?.status).toBe('skip');
    }
  });

  it('also fires for USB-only iPods that the classifier rejected (e.g. iPod touch in restore mode)', async () => {
    const headline = 'iPod touch (5th generation) uses proprietary sync.';
    const result = await checkReadiness({
      device: makeIpodArm({ usb: makeUsb({ kind: 'ios-device', headline }) }),
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupported?.kind).toBe('ios-device');
    expect(result.unsupported?.headline).toBe(headline);
  });

  it('without an unsupported USB classification: pipeline runs normally and does NOT collapse to unsupported', async () => {
    // Block-only iPod (no USB classification at all) → behaves as before.
    // With an empty filesystem the cascade returns `needs-format`.
    const result = await checkReadiness({ device: makeIpodArm({ block: makeBlock() }) });
    expect(result.level).not.toBe('unsupported');
    expect(result.unsupported).toBeUndefined();
  });

  it('emits level=unsupported for the unsupported arm of DiscoveredDevice', async () => {
    // The unsupported arm of DiscoveredDevice (Sony Walkman, generic non-music
    // USB storage) also routes through `checkReadiness` — the dispatch turns
    // the classifier's `reason` into an `unsupported-preset` payload.
    const reason =
      'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0185.';
    const result = await checkReadiness({
      device: {
        kind: 'unsupported',
        usb: {
          kind: 'unsupported',
          device: { vendorId: '054c', productId: '0185' } as EnumeratedUsbDevice,
          reason,
          family: 'Sony Walkman',
        },
        matchedBy: 'usb-only',
      },
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupported?.kind).toBe('unsupported-preset');
    expect(result.unsupported?.headline).toBe(reason);
    expect(result.stages[0]?.status).toBe('fail');
  });
});

// ── Post-sysinfo unsupported short-circuit (regression: T5 block-only path) ──

describe('checkReadiness() — post-sysinfo unsupported short-circuit (block-only path)', () => {
  // Regression: before the fix, a block-only iPod (no `usb` field, e.g.
  // doctor's `ipodFromBlock` fallback) with an unsupported generation in SysInfo
  // would fall through to the database stage instead of refusing early.
  // The USB-arm short-circuit only fires when `discovered.usb` is present;
  // the post-sysinfo check must cover the case where it is not.

  let mountPoint: string;

  function writeDeviceFiles(files: Record<string, string>): void {
    const deviceDir = path.join(mountPoint, 'iPod_Control', 'Device');
    fs.mkdirSync(deviceDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(deviceDir, name), content, 'utf-8');
    }
  }

  beforeEach(() => {
    mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-readiness-unsupported-sysinfo-'));
  });

  afterEach(() => {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  });

  it('short-circuits to unsupported when sysinfo identifies an unsupported model, even without USB classification', async () => {
    // D476 = iPod nano 16GB Yellow (7th Generation) — nano_7g has supported:false
    // in the generations table. `identify({ from: 'sysinfo', modelNumStr: 'D476' })`
    // sets `unsupportedReason` on the returned IpodModel.
    //
    // The block is mounted with a valid iPod_Control directory and a SysInfo
    // file naming this model. No `usb` field — simulates the doctor fallback
    // path (`ipodFromBlock`). The pipeline must short-circuit after sysinfo
    // instead of opening the database.
    writeDeviceFiles({ SysInfo: 'ModelNumStr: D476\nVisibleBuildID: 1.0.4\n' });

    const result = await checkReadiness({
      device: {
        kind: 'ipod',
        matchedBy: 'block-only',
        block: {
          identifier: 'disk9s2',
          volumeName: 'NANO7G',
          volumeUuid: 'NANO-7G-UUID',
          storage: { sizeBytes: 16_000_000_000 },
          isMounted: true,
          mountPoint,
        } as import('../../types.js').PlatformDeviceInfo,
      },
    });

    expect(result.level).toBe('unsupported');
    expect(result.unsupported).toBeDefined();
    expect(result.unsupported?.headline).toContain('nano');
    // deviceModel must be populated (identifies the refused generation)
    expect(result.deviceModel).toBeDefined();
    expect(result.deviceModel?.generationId).toBe('nano_7g');
    // The database stage must be present but SKIPPED — the pipeline short-circuits
    // after sysinfo and appends skip rows for remaining stages (same pattern as
    // the USB-arm short-circuit). The database must NOT have run (status 'fail'
    // or 'pass' would indicate it actually executed).
    const stageResults = new Map(result.stages.map((s) => [s.stage, s]));
    expect(stageResults.has('database')).toBe(true);
    expect(stageResults.get('database')?.status).toBe('skip');
    // All stages after sysinfo must be skipped
    const stageNames = result.stages.map((s) => s.stage);
    const sysInfoIdx = stageNames.indexOf('sysinfo');
    expect(sysInfoIdx).toBeGreaterThanOrEqual(0);
    for (let i = sysInfoIdx + 1; i < result.stages.length; i++) {
      expect(result.stages[i]?.status).toBe('skip');
    }
  });
});
