/**
 * `identify()` USB-descriptor permutation coverage.
 *
 * Pins the multi-axis `identify()` facade against every supported iPod
 * generation's USB product IDs, plus the rejection / edge paths that the
 * discovery pipeline depends on:
 *
 *   - Table-driven check that every USB PID in `IPOD_USB_IDS` resolves to the
 *     expected generation. Goes wider than `identity.test.ts` (which spot-checks
 *     a handful) by iterating the registry itself, so the test fails when a new
 *     PID is added without its generation being verified.
 *   - Every iOS-range PID currently catalogued in IPOD_USB_IDS comes back with
 *     `unsupportedReason.kind === 'ios-device'`. Pairs with the classifier
 *     coverage in `packages/podkit-core/src/device/classify.test.ts`.
 *   - Apple unknown PID (vendor 0x05ac, PID NOT in `IPOD_USB_IDS` and NOT in
 *     the iOS range) returns `undefined`. The complementary enumerate/classify
 *     behaviour is asserted in `discovery-permutations.test.ts`.
 *   - Malformed serial (non-hex / non-3-char suffix) returns `undefined`.
 *     Doctor's sysinfo-consistency axis depends on this: a bogus serial must not
 *     silently resolve to "Unknown iPod (model M…)" and propagate downstream.
 *
 * Existing coverage that this file deliberately does NOT duplicate:
 *
 *   - `identity.test.ts` — spot-checks per axis, source-provenance assertions,
 *     and the unsupported-reason headline shape for known unsupported generations.
 *     Those assertions remain authoritative; this file widens the per-PID
 *     coverage instead of restating them.
 */

import { describe, expect, it } from 'bun:test';

import { identify } from './identity.js';
import { IPOD_USB_IDS } from './tables/usb-ids.js';
import { GENERATIONS } from './tables/generations.js';
import type { IpodGenerationId } from './types.js';

// ---------------------------------------------------------------------------
// Every USB PID in the registry resolves to the expected generation
// ---------------------------------------------------------------------------

/**
 * Generations that the registry MUST cover via at least one USB PID. Pre-USB
 * generations (`classic_1g`, `classic_2g`, `classic_3g`, `classic_4g`, `photo`)
 * are deliberately absent — see `tables/usb-ids.ts` module header.
 */
const USB_REACHABLE_GENERATIONS: ReadonlySet<IpodGenerationId> = new Set<IpodGenerationId>([
  'video_5g',
  // 5.5G shares the 5G PIDs — identified by SysInfo/serial, not USB.
  'classic_6g',
  // classic_7g is identified via SysInfo, not by a distinct USB PID
  'mini_1g',
  'mini_2g',
  'nano_1g',
  'nano_2g',
  'nano_3g',
  'nano_4g',
  'nano_5g',
  'nano_6g',
  'nano_7g',
  'shuffle_1g',
  'shuffle_2g',
  'shuffle_3g',
  'shuffle_4g',
  'touch_1g',
  'touch_2g',
  'touch_3g',
  'touch_4g',
  'touch_5g',
  'touch_6g',
  'touch_7g',
]);

describe('identify({from: "usb"}) for every PID in IPOD_USB_IDS', () => {
  // Build the table once. `IPOD_USB_IDS` keys are `"0x…"` strings.
  const entries = Object.entries(IPOD_USB_IDS);

  for (const [pid, entry] of entries) {
    it(`${pid} → ${entry.generation} (${entry.displayName})`, () => {
      const model = identify({ from: 'usb', productId: pid });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe(entry.generation);
      expect(model!.displayName).toBe(entry.displayName);
      expect(model!.source).toBe('usb');
      // Checksum type is generation-determined; assert it's threaded through.
      expect(model!.checksumType).toBe(GENERATIONS[entry.generation].checksumType);
    });
  }

  it('covers every USB-reachable generation at least once', () => {
    const covered = new Set<IpodGenerationId>();
    for (const entry of Object.values(IPOD_USB_IDS)) covered.add(entry.generation);
    for (const gen of USB_REACHABLE_GENERATIONS) {
      expect(covered.has(gen)).toBe(true);
    }
  });

  it('normalises bare-hex PIDs (no 0x prefix) for every registry entry', () => {
    for (const [pid, entry] of entries) {
      const bare = pid.replace(/^0x/i, '');
      const model = identify({ from: 'usb', productId: bare });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe(entry.generation);
    }
  });
});

// ---------------------------------------------------------------------------
// iOS-range PIDs surface as unsupported with kind: 'ios-device'
// ---------------------------------------------------------------------------

/**
 * iOS-range PIDs (0x1290–0x12af) that ARE in IPOD_USB_IDS. Every catalogued
 * iPod touch generation falls in this range. The classifier additionally
 * catches uncatalogued PIDs in the range via `lookupIosRangeFallbackReason`,
 * which is covered by the discovery-permutations T1 test.
 */
const CATALOGUED_IOS_RANGE_PIDS: ReadonlyArray<readonly [string, IpodGenerationId]> = [
  ['0x1291', 'touch_1g'],
  ['0x1292', 'touch_2g'],
  ['0x1293', 'touch_3g'],
  ['0x129a', 'touch_4g'],
  ['0x12a0', 'touch_5g'],
  ['0x12ab', 'touch_6g'],
  ['0x12a8', 'touch_7g'],
];

describe('iOS-range PIDs in IPOD_USB_IDS map to ios-device unsupportedReason', () => {
  for (const [pid, gen] of CATALOGUED_IOS_RANGE_PIDS) {
    it(`${pid} (${gen}) carries kind=ios-device + a non-empty headline`, () => {
      const model = identify({ from: 'usb', productId: pid });
      expect(model).toBeDefined();
      expect(model!.generationId).toBe(gen);
      expect(model!.unsupportedReason).toBeDefined();
      expect(model!.unsupportedReason!.kind).toBe('ios-device');
      expect(model!.unsupportedReason!.headline.length).toBeGreaterThan(10);
      // The docsUrl is threaded so the CLI can deep-link.
      expect(model!.unsupportedReason!.docsUrl).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Apple unknown PID (vendor 0x05ac, PID outside IPOD_USB_IDS and outside the
// iOS range) returns undefined from `identify`.
// ---------------------------------------------------------------------------

/**
 * PIDs deliberately chosen to NOT be in IPOD_USB_IDS and NOT in the iOS range
 * (0x1290–0x12af). The lookup must return `undefined`. The downstream
 * classifier behaviour (drops these from `classifyUsbDevices`) is asserted in
 * `discovery-permutations.test.ts`.
 */
const APPLE_UNKNOWN_PIDS = [
  '0x9999', // entirely fabricated
  '0x12b0', // HomePod — outside the iOS range, NOT in IPOD_USB_IDS
  '0x1330', // post-shuffle-4G fabricated PID, NOT in tables
  '0x0273', // legacy Apple keyboard range — vendor matches, product unknown
];

describe('identify returns undefined for unknown Apple PIDs', () => {
  for (const pid of APPLE_UNKNOWN_PIDS) {
    it(`${pid} → undefined`, () => {
      expect(identify({ from: 'usb', productId: pid })).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Malformed serial returns undefined. The doctor's sysinfo-consistency model
// axis depends on this so it can skip cleanly instead of resolving to a
// "Unknown iPod (model M…)" fallback row.
// ---------------------------------------------------------------------------

describe('identify({from: "serial"}) returns undefined for malformed serial', () => {
  it('returns undefined for empty string', () => {
    expect(identify({ from: 'serial', serialNumber: '' })).toBeUndefined();
  });

  it('returns undefined for too-short serial', () => {
    expect(identify({ from: 'serial', serialNumber: 'AB' })).toBeUndefined();
    expect(identify({ from: 'serial', serialNumber: 'A' })).toBeUndefined();
  });

  it('returns undefined when the 3-char suffix is not in SERIAL_TO_MODEL', () => {
    // ZZZ is reserved-shape garbage — not in the serial table.
    expect(identify({ from: 'serial', serialNumber: 'XXXXXXXXZZZ' })).toBeUndefined();
  });

  it('returns undefined for FireWireGUID-looking input (16 hex)', () => {
    // The FireWireGUID and the serial number occupy distinct identification axes;
    // accidentally treating a GUID as a serial must not silently match anything.
    expect(identify({ from: 'serial', serialNumber: '000A27001A0647CB' })).toBeUndefined();
  });

  it('returns undefined for non-ASCII / non-alphanumeric junk', () => {
    // Non-hex characters in the suffix that don't map to any catalogued model.
    expect(identify({ from: 'serial', serialNumber: 'XXXXXXX !@#' })).toBeUndefined();
    expect(identify({ from: 'serial', serialNumber: 'XXXXXXX---' })).toBeUndefined();
  });
});
