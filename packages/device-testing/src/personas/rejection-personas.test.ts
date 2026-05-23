/**
 * Tier-1 smoke tests for the rejection-case personas.
 *
 * Pins the persona-fixture shape for the `'unsupported'` ReadinessLevel.
 * Both rejection personas must:
 *   1. Declare `expectedReadiness.level === 'unsupported'`
 *   2. Surface the structured `unsupported` payload on the result
 *   3. Have a fail `usb` stage whose `details.unsupported` matches
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
import { sonyNwA1000 } from './sony-nw-a1000/persona.js';
import { sonyNwA1200 } from './sony-nw-a1200/persona.js';
import { sonyNwA3000 } from './sony-nw-a3000/persona.js';
import { sonyNwHd5 } from './sony-nw-hd5/persona.js';
import { ipodShuffleNotSupported } from './ipod-shuffle-not-supported/persona.js';
import { nonIpodUsbDisk } from './non-ipod-usb-disk/persona.js';
import { personas } from './index.js';
import type { ReadinessUnsupportedReason } from '@podkit/core';

describe('rejection personas: unsupported readiness shape', () => {
  describe('ipod-touch-5g-unsupported', () => {
    it('declares expectedReadiness.level === unsupported', () => {
      expect(ipodTouch5gUnsupported.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes a structured unsupported payload matching the unsupported-PID table', () => {
      // The canonical wording comes from
      // `packages/devices-ipod/src/tables/unsupported.ts` —
      // `itouch('5th generation')`.
      expect(ipodTouch5gUnsupported.expectedReadiness.unsupported?.headline).toBe(
        "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode."
      );
      expect(ipodTouch5gUnsupported.expectedReadiness.unsupported?.kind).toBe('ios-device');
    });

    it('keeps the usb-stage fail surface in sync with the top-level payload', () => {
      const usbStage = ipodTouch5gUnsupported.expectedReadiness.stages.find(
        (s) => s.stage === 'usb'
      );
      expect(usbStage?.status).toBe('fail');
      const stageUnsupported = usbStage?.details?.unsupported as
        | ReadinessUnsupportedReason
        | undefined;
      expect(stageUnsupported?.headline).toBe(
        ipodTouch5gUnsupported.expectedReadiness.unsupported?.headline
      );
    });
  });

  describe('ipod-shuffle-not-supported', () => {
    it('is registered in the persona registry under its declared id', () => {
      expect(personas.get('ipod-shuffle-not-supported')).toBe(ipodShuffleNotSupported);
    });

    it('declares expectedReadiness.level === unsupported', () => {
      expect(ipodShuffleNotSupported.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes the canonical shuffle 3G/4G rejection payload (matches tables/unsupported.ts)', () => {
      // SHUFFLE_REASON in `packages/devices-ipod/src/tables/unsupported.ts:35`.
      expect(ipodShuffleNotSupported.expectedReadiness.unsupported?.headline).toBe(
        'iPod shuffle 3rd/4th gen requires iTunes authentication; not supported by libgpod.'
      );
      expect(ipodShuffleNotSupported.expectedReadiness.unsupported?.kind).toBe(
        'unsupported-device'
      );
    });

    it('keeps the usb-stage fail surface in sync with the top-level payload', () => {
      const usbStage = ipodShuffleNotSupported.expectedReadiness.stages.find(
        (s) => s.stage === 'usb'
      );
      expect(usbStage?.status).toBe('fail');
      const stageUnsupported = usbStage?.details?.unsupported as
        | ReadinessUnsupportedReason
        | undefined;
      expect(stageUnsupported?.headline).toBe(
        ipodShuffleNotSupported.expectedReadiness.unsupported?.headline
      );
    });

    it('has a non-empty USB descriptor pinned to Apple vendor + shuffle 3G PID', () => {
      expect(ipodShuffleNotSupported.usbDescriptor.vendorId).toBe(0x05ac);
      expect(ipodShuffleNotSupported.usbDescriptor.productId).toBe(0x1302);
      expect(ipodShuffleNotSupported.usbDescriptor.deviceSerial?.length ?? 0).toBeGreaterThan(0);
    });

    it('is marked synthesised in its provenance', () => {
      expect(ipodShuffleNotSupported.provenance.source).toBe('synthesised');
    });
  });

  describe('non-ipod-usb-disk', () => {
    it('is registered in the persona registry under its declared id', () => {
      expect(personas.get('non-ipod-usb-disk')).toBe(nonIpodUsbDisk);
    });

    it('declares expectedReadiness.level === unsupported', () => {
      expect(nonIpodUsbDisk.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes the SanDisk vendor-no-preset rejection payload (matches mass-storage table)', () => {
      // Canonical wording comes from the SanDisk entry's
      // `reason(vendorId, productId)` template in
      // `packages/devices-mass-storage/src/unsupported.ts`.
      expect(nonIpodUsbDisk.expectedReadiness.unsupported?.headline).toBe(
        'Non-Apple USB storage device (SanDisk); podkit has no preset for this vendor (USB 0x0781:0x5567).'
      );
      expect(nonIpodUsbDisk.expectedReadiness.unsupported?.kind).toBe('unsupported-preset');
    });

    it('keeps the usb-stage fail surface in sync with the top-level payload', () => {
      const usbStage = nonIpodUsbDisk.expectedReadiness.stages.find((s) => s.stage === 'usb');
      expect(usbStage?.status).toBe('fail');
      const stageUnsupported = usbStage?.details?.unsupported as
        | ReadinessUnsupportedReason
        | undefined;
      expect(stageUnsupported?.headline).toBe(
        nonIpodUsbDisk.expectedReadiness.unsupported?.headline
      );
    });

    it('has a non-empty USB descriptor pinned to SanDisk Cruzer Blade', () => {
      expect(nonIpodUsbDisk.usbDescriptor.vendorId).toBe(0x0781);
      expect(nonIpodUsbDisk.usbDescriptor.productId).toBe(0x5567);
      expect(nonIpodUsbDisk.usbDescriptor.deviceSerial?.length ?? 0).toBeGreaterThan(0);
    });

    it('ships plausible host-probe data (rejection happens at the mass-storage classifier, after probes)', () => {
      // Unlike the shuffle persona where the rejection short-circuits
      // before any probe, the non-Apple rejection runs on populated
      // `PlatformDeviceInfo` so the probes must be present.
      expect(nonIpodUsbDisk.lsblkJson).not.toBeNull();
      expect(nonIpodUsbDisk.systemProfilerJson).not.toBeNull();
      expect(nonIpodUsbDisk.diskutilPlist).not.toBeNull();
    });

    it('is marked synthesised in its provenance', () => {
      expect(nonIpodUsbDisk.provenance.source).toBe('synthesised');
    });
  });

  describe('sony-nwz-e384', () => {
    it('declares expectedReadiness.level === unsupported', () => {
      expect(sonyNwzE384.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes the Sony vendor-no-preset rejection payload', () => {
      // Canonical wording comes from
      // `packages/devices-mass-storage/src/unsupported.ts` —
      // the Sony entry's `reason(vendorId, productId)` template applied
      // to `054c:0882`.
      expect(sonyNwzE384.expectedReadiness.unsupported?.headline).toBe(
        'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.'
      );
      expect(sonyNwzE384.expectedReadiness.unsupported?.kind).toBe('unsupported-preset');
    });

    it('keeps the usb-stage fail surface in sync with the top-level payload', () => {
      const usbStage = sonyNwzE384.expectedReadiness.stages.find((s) => s.stage === 'usb');
      expect(usbStage?.status).toBe('fail');
      const stageUnsupported = usbStage?.details?.unsupported as
        | ReadinessUnsupportedReason
        | undefined;
      expect(stageUnsupported?.headline).toBe(sonyNwzE384.expectedReadiness.unsupported?.headline);
    });
  });

  // Legacy `'unknown'` rejection personas now use the canonical `'unsupported'`
  // ReadinessLevel shape introduced for this persona category.
  describe.each([
    { persona: sonyNwA1000, id: 'sony-nw-a1000' },
    { persona: sonyNwA1200, id: 'sony-nw-a1200' },
    { persona: sonyNwA3000, id: 'sony-nw-a3000' },
    { persona: sonyNwHd5, id: 'sony-nw-hd5' },
  ])('$id — unsupported-preset shape', ({ persona, id }) => {
    it('declares expectedReadiness.level === unsupported', () => {
      expect(persona.expectedReadiness.level).toBe('unsupported');
    });

    it('exposes a structured unsupported payload on the top-level result', () => {
      expect(persona.expectedReadiness.unsupported).toBeDefined();
      expect(persona.expectedReadiness.unsupported?.kind).toBe('unsupported-preset');
      expect(typeof persona.expectedReadiness.unsupported?.headline).toBe('string');
      expect(persona.expectedReadiness.unsupported!.headline.length).toBeGreaterThan(0);
    });

    it('keeps the usb-stage fail surface in sync with the top-level payload', () => {
      const usbStage = persona.expectedReadiness.stages.find((s) => s.stage === 'usb');
      expect(usbStage?.status).toBe('fail');
      const stageUnsupported = usbStage?.details?.unsupported as
        | ReadinessUnsupportedReason
        | undefined;
      expect(stageUnsupported?.headline).toBe(persona.expectedReadiness.unsupported?.headline);
    });

    it('is registered in the persona registry', () => {
      expect(personas.get(id)).toBe(persona);
    });
  });
});
