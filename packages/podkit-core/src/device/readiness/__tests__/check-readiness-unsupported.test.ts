/**
 * `checkReadiness()` unsupported short-circuit (TASK-331).
 *
 * Verifies that when the caller threads `unsupportedReason` into the
 * pipeline, the readiness result surfaces `level: 'unsupported'` and the
 * canonical reason text — instead of running the stage cascade against
 * a device that will never mount in disk mode.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { checkReadiness } from '../index.js';
import type { PlatformDeviceInfo } from '../../types.js';

function makeDevice(overrides: Partial<PlatformDeviceInfo> = {}): PlatformDeviceInfo {
  return {
    identifier: 'disk5s2',
    volumeName: 'TERAPOD',
    volumeUuid: 'ABC-123',
    size: 0,
    isMounted: false,
    ...overrides,
  };
}

describe('checkReadiness() — unsupported short-circuit', () => {
  it('returns level=unsupported with reason when caller threads unsupportedReason', async () => {
    const reason =
      "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
    const result = await checkReadiness({
      device: makeDevice(),
      unsupportedReason: reason,
    });
    expect(result.level).toBe('unsupported');
    expect(result.unsupportedReason).toBe(reason);
  });

  it('skips remaining stages and reports usb=fail with the reason in details', async () => {
    const reason = 'Sony Walkman is not yet supported by podkit.';
    const result = await checkReadiness({
      device: makeDevice(),
      unsupportedReason: reason,
    });
    expect(result.stages[0]?.stage).toBe('usb');
    expect(result.stages[0]?.status).toBe('fail');
    expect(result.stages[0]?.details?.unsupportedReason).toBe(reason);
    // Every remaining stage must be skipped — none of the disk-mode
    // probes have meaningful state to report against an unsupported device.
    for (let i = 1; i < result.stages.length; i++) {
      expect(result.stages[i]?.status).toBe('skip');
    }
  });

  it('without unsupportedReason: pipeline runs normally and does NOT collapse to unsupported', async () => {
    // No reason threaded → behaves as before. With an empty filesystem
    // the cascade returns `needs-format` (filesystem stage fails when
    // volumeName is missing).
    const result = await checkReadiness({ device: makeDevice() });
    expect(result.level).not.toBe('unsupported');
    expect(result.unsupportedReason).toBeUndefined();
  });
});
