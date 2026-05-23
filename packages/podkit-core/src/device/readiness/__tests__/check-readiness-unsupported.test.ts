/**
 * `checkReadiness()` unsupported short-circuit (TASK-331).
 *
 * Verifies that when the caller threads `unsupported` into the pipeline,
 * the readiness result surfaces `level: 'unsupported'` and the structured
 * rejection payload — instead of running the stage cascade against a
 * device that will never mount in disk mode.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { checkReadiness } from '../index.js';
import type { PlatformDeviceInfo } from '../../types.js';
import type { ReadinessUnsupportedReason } from '../types.js';

function makeDevice(overrides: Partial<PlatformDeviceInfo> = {}): PlatformDeviceInfo {
  return {
    identifier: 'disk5s2',
    volumeName: 'TERAPOD',
    volumeUuid: 'ABC-123',
    storage: { sizeBytes: 0 },
    isMounted: false,
    ...overrides,
  } as PlatformDeviceInfo;
}

describe('checkReadiness() — unsupported short-circuit', () => {
  it('returns level=unsupported with payload when caller threads unsupported', async () => {
    const headline =
      "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
    const unsupported: ReadinessUnsupportedReason = { kind: 'ios-device', headline };
    const result = await checkReadiness({
      device: makeDevice(),
      unsupported,
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
      device: makeDevice(),
      unsupported,
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

  it('accepts a bare string for `unsupported` (legacy callers) and wraps as unsupported-device', async () => {
    const headline = 'legacy string call site';
    const result = await checkReadiness({
      device: makeDevice(),
      unsupported: headline,
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupported?.kind).toBe('unsupported-device');
    expect(result.unsupported?.headline).toBe(headline);
  });

  it('without unsupported: pipeline runs normally and does NOT collapse to unsupported', async () => {
    // No payload threaded → behaves as before. With an empty filesystem
    // the cascade returns `needs-format` (filesystem stage fails when
    // volumeName is missing).
    const result = await checkReadiness({ device: makeDevice() });
    expect(result.level).not.toBe('unsupported');
    expect(result.unsupported).toBeUndefined();
  });
});
