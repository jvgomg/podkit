/**
 * Unit tests for inquiry/selection.ts
 *
 * Pure-function tests — every input maps to a deterministic SelectionPlan.
 */

import { describe, expect, it } from 'bun:test';
import { chooseTransports } from './selection';
import type { InquiryMethodsAvailability } from './probe';

function avail(usb: boolean, scsi: boolean): InquiryMethodsAvailability {
  return {
    usb: { available: usb },
    scsi: { available: scsi },
  };
}

describe('chooseTransports', () => {
  it('returns "usb-then-scsi" when both transports are available', () => {
    expect(chooseTransports(avail(true, true))).toBe('usb-then-scsi');
  });

  it('returns "usb-only" when only USB is available', () => {
    expect(chooseTransports(avail(true, false))).toBe('usb-only');
  });

  it('returns "scsi-only" when only SCSI is available', () => {
    expect(chooseTransports(avail(false, true))).toBe('scsi-only');
  });

  it('returns "none" when no transport is available', () => {
    expect(chooseTransports(avail(false, false))).toBe('none');
  });
});
