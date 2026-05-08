/**
 * Unit tests for ipodProvider
 *
 * `inquireFirmware` from `@podkit/ipod-firmware` is mocked at the module level
 * so no real hardware, native bindings, or FS access is needed.
 *
 * Test coverage:
 * - Non-Apple vendor ID → null
 * - Apple vendor + unknown product ID → null
 * - Known iPod product ID but firmware inquiry returns null → null
 * - Known iPod product ID + successful firmware → full IpodIdentity
 * - Provider id is 'ipod'
 * - Vendor ID normalisation (with/without 0x prefix)
 * - Product ID normalisation (with/without 0x prefix)
 */

import { describe, expect, it, mock, beforeAll } from 'bun:test';
import type { ParsedFirmware } from '@podkit/device-types';
import type { UsbFingerprint } from '@podkit/device-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Canned ParsedFirmware returned by the mock when firmware is "available" */
const MOCK_FIRMWARE: ParsedFirmware = {
  firewireGuid: '000A270024A23E9E',
  serialNumber: '7K74HBYZRP2',
  rawXml: '<plist/>',
  capabilities: {
    familyId: 120,
    audioCodecs: [{ codec: 'AAC' }],
  },
};

/** A known Apple iPod USB product ID (nano 2G) */
const KNOWN_PRODUCT_ID = '1260';

/** An Apple fingerprint for a known iPod */
const VALID_FP: UsbFingerprint = {
  vendorId: '05ac',
  productId: KNOWN_PRODUCT_ID,
  bus: 3,
  devnum: 4,
};

// ---------------------------------------------------------------------------
// Module mock — must be declared before importing the module under test
// ---------------------------------------------------------------------------

let firmwareMockReturnValue: ParsedFirmware | null = MOCK_FIRMWARE;

mock.module('@podkit/ipod-firmware', () => ({
  inquireFirmware: async (_fp: UsbFingerprint) => firmwareMockReturnValue,
}));

// After mock.module, import the module under test
const { ipodProvider } = await import('./provider.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ipodProvider', () => {
  describe('id', () => {
    it('is "ipod"', () => {
      expect(ipodProvider.id).toBe('ipod');
    });
  });

  describe('detect — vendor pre-filter', () => {
    it('returns null for a non-Apple vendor ID', async () => {
      const fp: UsbFingerprint = { vendorId: '071b', productId: '3203', bus: 1, devnum: 2 };
      expect(await ipodProvider.detect(fp)).toBeNull();
    });

    it('returns null for a non-Apple vendor ID with 0x prefix', async () => {
      const fp: UsbFingerprint = { vendorId: '0x071b', productId: '3203', bus: 1, devnum: 2 };
      expect(await ipodProvider.detect(fp)).toBeNull();
    });

    it('accepts Apple vendor ID without 0x prefix', async () => {
      // Should not be null due to vendor check (may still be null for other reasons)
      const fp: UsbFingerprint = {
        vendorId: '05ac',
        productId: KNOWN_PRODUCT_ID,
        bus: 3,
        devnum: 4,
      };
      const result = await ipodProvider.detect(fp);
      // firmware mock returns MOCK_FIRMWARE → should produce a full identity
      expect(result).not.toBeNull();
    });

    it('accepts Apple vendor ID with 0x prefix', async () => {
      const fp: UsbFingerprint = {
        vendorId: '0x05ac',
        productId: KNOWN_PRODUCT_ID,
        bus: 3,
        devnum: 4,
      };
      const result = await ipodProvider.detect(fp);
      expect(result).not.toBeNull();
    });
  });

  describe('detect — product ID pre-filter', () => {
    it('returns null for Apple vendor + unknown product ID', async () => {
      const fp: UsbFingerprint = { vendorId: '05ac', productId: '9999', bus: 1, devnum: 2 };
      expect(await ipodProvider.detect(fp)).toBeNull();
    });

    it('returns null for Apple vendor + unknown product ID with 0x prefix', async () => {
      const fp: UsbFingerprint = { vendorId: '05ac', productId: '0x9999', bus: 1, devnum: 2 };
      expect(await ipodProvider.detect(fp)).toBeNull();
    });

    it('accepts known product ID without 0x prefix', async () => {
      const fp: UsbFingerprint = { vendorId: '05ac', productId: '1260', bus: 3, devnum: 4 };
      expect(await ipodProvider.detect(fp)).not.toBeNull();
    });

    it('accepts known product ID with 0x prefix', async () => {
      const fp: UsbFingerprint = { vendorId: '05ac', productId: '0x1260', bus: 3, devnum: 4 };
      expect(await ipodProvider.detect(fp)).not.toBeNull();
    });
  });

  describe('detect — firmware inquiry result', () => {
    it('returns null when firmware inquiry returns null', async () => {
      firmwareMockReturnValue = null;
      try {
        expect(await ipodProvider.detect(VALID_FP)).toBeNull();
      } finally {
        firmwareMockReturnValue = MOCK_FIRMWARE;
      }
    });

    it('returns full IpodIdentity when firmware inquiry succeeds', async () => {
      firmwareMockReturnValue = MOCK_FIRMWARE;
      const result = await ipodProvider.detect(VALID_FP);
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('ipod');
      expect(result!.firewireGuid).toBe('000A270024A23E9E');
      expect(result!.serialNumber).toBe('7K74HBYZRP2');
      expect(result!.familyId).toBe(120);
    });

    it('extracts familyId from firmware.capabilities', async () => {
      firmwareMockReturnValue = {
        ...MOCK_FIRMWARE,
        capabilities: { familyId: 90, audioCodecs: [] },
      };
      try {
        const result = await ipodProvider.detect(VALID_FP);
        expect(result!.familyId).toBe(90);
      } finally {
        firmwareMockReturnValue = MOCK_FIRMWARE;
      }
    });

    it('falls back to familyId null when capabilities is absent', async () => {
      firmwareMockReturnValue = {
        firewireGuid: '000A270024A23E9E',
        serialNumber: '7K74HBYZRP2',
        rawXml: '<plist/>',
        // capabilities intentionally absent
      };
      try {
        const result = await ipodProvider.detect(VALID_FP);
        expect(result!.familyId).toBeNull();
      } finally {
        firmwareMockReturnValue = MOCK_FIRMWARE;
      }
    });
  });

  describe('detect — known iPod product IDs', () => {
    // Spot-check a sample of real USB product IDs from the iPod table
    const SAMPLE_IDS: [string, string][] = [
      ['nano 2G (0x1260)', '0x1260'],
      ['classic 6G (0x1261)', '0x1261'],
      ['nano 4G (0x1265)', '0x1265'],
      ['nano 7G (0x1267)', '0x1267'],
      ['5G video (0x1207)', '0x1207'],
      ['mini 1G (0x1204)', '0x1204'],
    ];

    beforeAll(() => {
      firmwareMockReturnValue = MOCK_FIRMWARE;
    });

    for (const [label, productId] of SAMPLE_IDS) {
      it(`returns identity for ${label}`, async () => {
        const fp: UsbFingerprint = { vendorId: '05ac', productId, bus: 1, devnum: 2 };
        const result = await ipodProvider.detect(fp);
        expect(result).not.toBeNull();
        expect(result!.kind).toBe('ipod');
      });
    }
  });
});
