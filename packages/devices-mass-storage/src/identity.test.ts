/**
 * Tests for identify()
 */

import { describe, expect, it } from 'bun:test';
import { identify } from './identity.js';
import { BUILT_IN_PRESETS } from './presets/built-in.js';
import type { UsbFingerprint } from '@podkit/device-types';

// =============================================================================
// Known device matching
// =============================================================================

describe('identify — USB VID/PID matching', () => {
  it('matches Echo Mini by exact VID/PID (lowercase 0x prefix)', () => {
    const usb: UsbFingerprint = { vendorId: '0x071b', productId: '0x3203' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('mass-storage');
    expect(result?.presetId).toBe('echo-mini');
  });

  it('returns null for unknown VID/PID', () => {
    const usb: UsbFingerprint = { vendorId: '0x1234', productId: '0x5678' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result).toBeNull();
  });

  it('returns null when correct vendor but wrong product', () => {
    const usb: UsbFingerprint = { vendorId: '0x071b', productId: '0x9999' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result).toBeNull();
  });

  it('returns null for a totally unrelated device', () => {
    const usb: UsbFingerprint = { vendorId: '0x05ac', productId: '0x1209' }; // Apple iPod
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Case-insensitive matching
// =============================================================================

describe('identify — case-insensitive VID/PID', () => {
  it('matches Echo Mini with uppercase hex digits', () => {
    const usb: UsbFingerprint = { vendorId: '0x071B', productId: '0x3203' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result?.presetId).toBe('echo-mini');
  });

  it('matches Echo Mini without 0x prefix (bare hex)', () => {
    const usb: UsbFingerprint = { vendorId: '071b', productId: '3203' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result?.presetId).toBe('echo-mini');
  });

  it('matches Echo Mini with mixed-case and no prefix', () => {
    const usb: UsbFingerprint = { vendorId: '071B', productId: '3203' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result?.presetId).toBe('echo-mini');
  });
});

// =============================================================================
// Serial number propagation
// =============================================================================

describe('identify — serial number handling', () => {
  it('propagates serialNumber from USB info when present', () => {
    const usb: UsbFingerprint = {
      vendorId: '0x071b',
      productId: '0x3203',
      serialNumber: 'ABC123',
    };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result?.serialNumber).toBe('ABC123');
  });

  it('does not set serialNumber when absent from USB info', () => {
    const usb: UsbFingerprint = { vendorId: '0x071b', productId: '0x3203' };
    const result = identify(usb, BUILT_IN_PRESETS);
    expect(result?.serialNumber).toBeUndefined();
  });
});

// =============================================================================
// Preset scope filtering
// =============================================================================

describe('identify — preset scope filtering via presets map', () => {
  it('returns null when the matched preset is not in the provided presets map', () => {
    // Provide an empty map — echo-mini is in hint table but not in scope
    const usb: UsbFingerprint = { vendorId: '0x071b', productId: '0x3203' };
    const result = identify(usb, {});
    expect(result).toBeNull();
  });

  it('matches when echo-mini is in the provided presets map', () => {
    const usb: UsbFingerprint = { vendorId: '0x071b', productId: '0x3203' };
    const result = identify(usb, { 'echo-mini': BUILT_IN_PRESETS['echo-mini'] });
    expect(result?.presetId).toBe('echo-mini');
  });

  it('matches when no presets map is provided (no filter)', () => {
    const usb: UsbFingerprint = { vendorId: '0x071b', productId: '0x3203' };
    const result = identify(usb); // no presets arg
    expect(result?.presetId).toBe('echo-mini');
  });
});
