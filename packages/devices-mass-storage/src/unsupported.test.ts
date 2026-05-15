/**
 * Unit tests for `classifyAsUnsupportedDevice`.
 *
 * Pins the vendor-recognised-but-no-preset path that TASK-331 added so
 * that the Sony Walkman (and future similar entries) surface as
 * `kind: 'unsupported'` rather than silently being dropped by the
 * classifier composer.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { classifyAsUnsupportedDevice, UNSUPPORTED_VENDORS } from './unsupported.js';

describe('classifyAsUnsupportedDevice', () => {
  it('returns kind=unsupported with the canonical reason for Sony VID', () => {
    const result = classifyAsUnsupportedDevice({
      vendorId: '054c',
      productId: '0882',
    });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('unsupported');
    expect(result?.family).toBe('Sony Walkman');
    expect(result?.reason).toBe(
      'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.'
    );
  });

  it('accepts 0x-prefixed vendor and product IDs', () => {
    const result = classifyAsUnsupportedDevice({
      vendorId: '0x054c',
      productId: '0x0882',
    });
    expect(result?.kind).toBe('unsupported');
    expect(result?.reason).toContain('054c');
  });

  it('returns null for vendors not in the table', () => {
    // Apple — claimed by classifyAsIpod, not this classifier.
    expect(classifyAsUnsupportedDevice({ vendorId: '05ac', productId: '1261' })).toBeNull();
    // Pioneer — claimed by classifyAsMassStorage (Echo Mini), not this one.
    expect(classifyAsUnsupportedDevice({ vendorId: '071b', productId: '3203' })).toBeNull();
    // Random vendor.
    expect(classifyAsUnsupportedDevice({ vendorId: '1234', productId: 'abcd' })).toBeNull();
  });

  it('uses the supplied vendor product in the reason template', () => {
    const result = classifyAsUnsupportedDevice({
      vendorId: '054c',
      productId: '01ff',
    });
    expect(result?.reason).toContain('0x054c:0x01ff');
  });

  it('UNSUPPORTED_VENDORS contains at least the Sony entry', () => {
    // Sanity check the table is non-empty and the canonical Sony entry is
    // present — guards against accidental deletion.
    const sony = UNSUPPORTED_VENDORS.find((e) => e.vendorId === '054c');
    expect(sony).toBeDefined();
    expect(sony?.family).toBe('Sony Walkman');
  });
});
