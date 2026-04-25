/**
 * Smoke test for readSysInfoExtendedFromUsb.
 *
 * Verifies the function is linked correctly in the native binding
 * and doesn't crash when called with invalid arguments.
 *
 * In CI prebuilds, libgpod is built without libusb, so the underlying
 * dlsym call returns null and the function gracefully returns null.
 * On developer machines with libusb, it returns null for invalid
 * bus/address. Either way: no crash, no throw.
 */

import { describe, it, expect } from 'bun:test';

import { readSysInfoExtendedFromUsb, isNativeAvailable } from '../../src/index';

describe('readSysInfoExtendedFromUsb', () => {
  it('is exported and callable', () => {
    expect(typeof readSysInfoExtendedFromUsb).toBe('function');
  });

  it('returns null for invalid bus/address without crashing', () => {
    if (!isNativeAvailable()) {
      console.log('Skipping: native binding not available');
      return;
    }

    const result = readSysInfoExtendedFromUsb(99, 99);
    expect(result).toBeNull();
  });
});
