/**
 * Smoke test for readSysInfoExtendedFromUsb.
 *
 * Verifies the function is linked correctly in the native binding
 * and throws descriptive errors when the USB read fails.
 *
 * In CI prebuilds, libgpod is built without libusb, so the underlying
 * dlsym call returns null and the function throws "libgpod was compiled
 * without USB support". On developer machines with libusb, it throws a
 * USB control transfer error for invalid bus/address.
 */

import { describe, it, expect } from 'bun:test';

import { readSysInfoExtendedFromUsb, isNativeAvailable } from '../../src/index';

describe('readSysInfoExtendedFromUsb', () => {
  it('is exported and callable', () => {
    expect(typeof readSysInfoExtendedFromUsb).toBe('function');
  });

  it('throws a descriptive error for invalid bus/address', () => {
    if (!isNativeAvailable()) {
      console.log('Skipping: native binding not available');
      return;
    }

    expect(() => readSysInfoExtendedFromUsb(99, 99)).toThrow(
      /USB support|USB control transfer failed/
    );
  });
});
