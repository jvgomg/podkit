/**
 * Tier-1 smoke tests for the rejection-case personas.
 *
 * Pins the persona-fixture shape after TASK-331 added `'unsupported'` to
 * `ReadinessLevel`. Both rejection personas must:
 *   1. Declare `expectedReadiness.level === 'unsupported'`
 *   2. Surface the canonical `unsupportedReason` text on the result
 *   3. Have a fail `usb` stage whose `details.unsupportedReason` matches
 *
 * These assertions are intentionally lightweight — Tier 3 still owns
 * end-to-end coverage of the inquiry pipeline. This file's job is to fail
 * loudly when a future schema change accidentally drops the rejection
 * fixture back to `'unknown'`.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { ipodTouch5gUnsupported } from './ipod-touch-5g-unsupported/persona.js';
import { sonyNwzE384 } from './sony-nwz-e384/persona.js';

describe('rejection personas: TASK-331 shape', () => {
  describe('ipod-touch-5g-unsupported', () => {
    it('declares expectedReadiness.level === unsupported', () => {
      expect(ipodTouch5gUnsupported.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes a canonical unsupportedReason matching the unsupported-PID table', () => {
      // The canonical wording comes from
      // `packages/devices-ipod/src/tables/unsupported.ts` —
      // `itouch('5th generation')`.
      expect(ipodTouch5gUnsupported.expectedReadiness.unsupportedReason).toBe(
        "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode."
      );
    });

    it('keeps the usb-stage fail surface in sync with the top-level reason', () => {
      const usbStage = ipodTouch5gUnsupported.expectedReadiness.stages.find(
        (s) => s.stage === 'usb'
      );
      expect(usbStage?.status).toBe('fail');
      expect(usbStage?.details?.unsupportedReason).toBe(
        ipodTouch5gUnsupported.expectedReadiness.unsupportedReason
      );
    });
  });

  describe('sony-nwz-e384', () => {
    it('declares expectedReadiness.level === unsupported', () => {
      expect(sonyNwzE384.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes the Sony vendor-no-preset rejection reason', () => {
      // Canonical wording comes from
      // `packages/devices-mass-storage/src/unsupported.ts` —
      // the Sony entry's `reason(vendorId, productId)` template applied
      // to `054c:0882`.
      expect(sonyNwzE384.expectedReadiness.unsupportedReason).toBe(
        'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.'
      );
    });

    it('keeps the usb-stage fail surface in sync with the top-level reason', () => {
      const usbStage = sonyNwzE384.expectedReadiness.stages.find((s) => s.stage === 'usb');
      expect(usbStage?.status).toBe('fail');
      expect(usbStage?.details?.unsupportedReason).toBe(
        sonyNwzE384.expectedReadiness.unsupportedReason
      );
    });
  });
});
