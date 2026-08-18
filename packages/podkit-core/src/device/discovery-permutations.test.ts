/**
 * USB-descriptor discovery permutations.
 *
 * Exercises the discovery + classification pipeline against synthetic USB
 * descriptors with no real USB hardware. Pairs the unit-side coverage with
 * the VM coverage in `test-packages/e2e-vm-tests/src/discovery.e2e.test.ts`.
 *
 * Tests cover the discovery surface (`parseSystemProfilerUsbData`,
 * `parseSysfsUsbDevices`, `classifyUsbDevices`) — the same modules
 * `discoverUsbIpods` composes when called from `podkit device scan` and
 * `podkit device add`. The conceptual `discoverUsbIpods` is the union of
 * `enumerateUsb()` (this package) + `classifyUsbDevices()` (this package);
 * see `index.ts` exports.
 *
 * Descriptors are inlined as bare-hex / serial-string constants rather than
 * imported from `@podkit/device-testing` because that package has a runtime
 * dependency on `@podkit/core` — going the other way would create a build
 * cycle (`@podkit/device-testing#build → @podkit/core#build`). The constant
 * values mirror the persona registry exactly; the comments below name the
 * source persona for cross-reference.
 *
 * # Scenarios
 *
 *   - Single iPod 5G descriptor → exactly one classified entry with
 *     `kind: 'ipod'`, `supported: true`, `model.generationId: 'video_5g'`,
 *     no unsupportedReason.
 *   - Apple unknown PID (NOT in `IPOD_USB_IDS` and NOT in iOS range)
 *     is surfaced by `enumerateUsb` but dropped by `classifyUsbDevices`.
 *     The drop is by design: such descriptors are AirPods / Apple TV /
 *     HomePod / etc., not iPods.
 *   - Non-Apple vendor (Sony Walkman, generic mass-storage stick) is surfaced
 *     by `enumerateUsb` but excluded from the iPod classifier output. The
 *     vendor-recognised path (Sony) lands in the unsupported-device classifier;
 *     the unrecognised path (random VID) is dropped entirely.
 *   - Multi-iPod ordering: covered partially here via injected fake enumerate
 *     output (two distinct Apple PIDs). The corresponding VM coverage is
 *     DEFERRED because the dummy-hcd daemon's FunctionFS mountpoint is single-
 *     instance — see `discovery-reconciliation.e2e.test.ts` for the
 *     documented infrastructure constraint.
 *   - Missing serialNumber: every parser must omit the field rather than emit
 *     `serialNumber: ""` or `null`; downstream FireWireGUID checks can then
 *     skip cleanly instead of treating an empty string as a value.
 */

import { describe, expect, it } from 'bun:test';

import {
  parseSystemProfilerUsbData,
  parseSysfsUsbDevices,
  type EnumeratedUsbDevice,
} from './usb-enumeration.js';
import { classifyUsbDevices } from './classify.js';

// ---------------------------------------------------------------------------
// Synthetic descriptors mirroring `@podkit/device-testing` persona values.
// Vendor + product IDs are bare-hex lowercase (UsbFingerprint canonical form).
// ---------------------------------------------------------------------------

/** ipod-video-5g-iflash-1tb persona — supported iPod 5G. */
const IPOD_VIDEO_5G: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1209',
  serialNumber: '000A27001BC8EED6',
};

/** ipod-nano-3g-black persona — supported nano 3G. */
const IPOD_NANO_3G: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1262',
  serialNumber: '7K845GFNYXX',
};

/** ipod-nano-4g-black persona — supported nano 4G. */
const IPOD_NANO_4G: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1263',
};

/** ipod-nano-7g-space-gray persona — unsupported nano 7G (hashAB / no libgpod entry). */
const IPOD_NANO_7G: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1267',
  serialNumber: 'DCYN72R8FJQ1',
};

/** ipod-mini-2g-pink persona — supported mini (mini_1g via PID 0x1205). */
const IPOD_MINI: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1205',
};

/** ipod-touch-5g-unsupported persona — iOS-range PID, unsupported. */
const IPOD_TOUCH_5G: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '12aa',
};

/** ipod-shuffle-not-supported persona — Apple-vendor, unsupported (iTunes auth). */
const IPOD_SHUFFLE_3G: EnumeratedUsbDevice = {
  vendorId: '05ac',
  productId: '1302',
};

/** non-ipod-usb-disk persona — SanDisk Cruzer Blade (generic USB stick). */
const SANDISK_CRUZER: EnumeratedUsbDevice = {
  vendorId: '0781',
  productId: '5567',
};

/** sony-nwz-e384 persona — Sony Walkman (vendor-recognised, no preset). */
const SONY_WALKMAN: EnumeratedUsbDevice = {
  vendorId: '054c',
  productId: '0882',
};

/** echo-mini persona — vendor 0x071b registered in the mass-storage preset table. */
const ECHO_MINI: EnumeratedUsbDevice = {
  vendorId: '071b',
  productId: '3203',
  serialNumber: 'EM-001',
};

// ---------------------------------------------------------------------------
// Single iPod 5G descriptor → one supported classification entry
// ---------------------------------------------------------------------------

describe('single iPod 5G descriptor → supported video_5g classification', () => {
  it('classifies the 5G descriptor as kind=ipod, video_5g, supported, no unsupportedReason', () => {
    const classified = classifyUsbDevices([IPOD_VIDEO_5G]);
    expect(classified).toHaveLength(1);
    const first = classified[0]!;
    expect(first.kind).toBe('ipod');
    if (first.kind !== 'ipod') return; // narrow for TS
    expect(first.supported).toBe(true);
    expect(first.unsupportedReason).toBeUndefined();
    expect(first.model?.generationId).toBe('video_5g');
    expect(first.device.vendorId).toBe('05ac');
    expect(first.device.productId).toBe('1209');
  });
});

// ---------------------------------------------------------------------------
// Apple unknown PID: surfaced by enumerate, dropped by classifier
// ---------------------------------------------------------------------------

describe('Apple unknown PID is enumerated but dropped by classifier', () => {
  const appleUnknownPids = [
    '12b0', // HomePod
    '0273', // legacy Apple keyboard range
    '9999', // fabricated
  ];

  for (const pid of appleUnknownPids) {
    it(`enumerated shape for Apple PID ${pid} round-trips through parseSystemProfilerUsbData`, () => {
      const data = {
        SPUSBDataType: [
          {
            _name: 'USB Bus',
            _items: [
              {
                vendor_id: '0x05ac (Apple Inc.)',
                product_id: `0x${pid}`,
              },
            ],
          },
        ],
      };
      const enumerated = parseSystemProfilerUsbData(data);
      expect(enumerated).toHaveLength(1);
      expect(enumerated[0]!.vendorId).toBe('05ac');
      expect(enumerated[0]!.productId).toBe(pid);
    });

    it(`classifier drops Apple PID ${pid} (not iPod, not in iOS range, not mass-storage preset)`, () => {
      const classified = classifyUsbDevices([{ vendorId: '05ac', productId: pid }]);
      // The current contract per `classifyAsIpod`: unrecognised Apple PIDs
      // outside the iOS range are dropped. iPhone/iPad PIDs that fall inside
      // 0x1290–0x12af are caught by the iOS-range fallback and surface as
      // unsupported instead — covered in the iOS-range unit tests.
      expect(classified).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Non-Apple vendor: enumerated but excluded from iPod results
// ---------------------------------------------------------------------------

describe('non-Apple vendor enumerated but not classified as iPod', () => {
  it('SanDisk Cruzer (vendor 0x0781) is NOT classified as iPod (surfaces as kind=unsupported via the vendor-table)', () => {
    const classified = classifyUsbDevices([SANDISK_CRUZER]);
    // A non-Apple vendor MUST NOT be classified as an iPod. SanDisk is also
    // in `UNSUPPORTED_VENDORS` so it surfaces as kind=unsupported rather than
    // being silently dropped, giving the CLI a canonical reason payload.
    expect(classified.find((c) => c.kind === 'ipod')).toBeUndefined();
    expect(classified.find((c) => c.kind === 'mass-storage')).toBeUndefined();
    const unsupported = classified.find((c) => c.kind === 'unsupported');
    expect(unsupported).toBeDefined();
  });

  it('truly unknown vendor (not in any table) is dropped entirely', () => {
    // A vendor that's neither Apple, nor a registered mass-storage preset,
    // nor in `UNSUPPORTED_VENDORS` — the classifier drops it. Important for
    // the "phantom-iPod regression" coverage: random USB peripherals never
    // surface as iPods.
    const unknown: EnumeratedUsbDevice = { vendorId: '1234', productId: 'abcd' };
    const classified = classifyUsbDevices([unknown]);
    expect(classified).toHaveLength(0);
  });

  it('Sony Walkman (vendor 0x054c) surfaces as kind=unsupported (vendor-recognised, no preset)', () => {
    const classified = classifyUsbDevices([SONY_WALKMAN]);
    // Sony is vendor-recognised by the unsupported-device table; surfaces as
    // kind=unsupported so the CLI can render a canonical reason rather than
    // silently dropping. Importantly: NOT kind=ipod.
    expect(classified.find((c) => c.kind === 'ipod')).toBeUndefined();
    const unsupported = classified.find((c) => c.kind === 'unsupported');
    expect(unsupported).toBeDefined();
  });

  it('Echo Mini (vendor 0x071b, registered preset) is classified as mass-storage', () => {
    const classified = classifyUsbDevices([ECHO_MINI]);
    // Echo Mini IS in the registered preset table — this is the positive
    // control for the "non-Apple but recognised" path.
    expect(classified).toHaveLength(1);
    expect(classified[0]!.kind).toBe('mass-storage');
  });
});

// ---------------------------------------------------------------------------
// Multi-iPod ordering (T3 is DEFERRED; see discovery-reconciliation.tier3)
// ---------------------------------------------------------------------------

describe('multiple iPod descriptors classified in stable order', () => {
  it('two distinct iPod descriptors classified in input order with their own bus/devnum', () => {
    // Distinct bus/devnum pin each entry's identity to its origin descriptor.
    const enumerated: EnumeratedUsbDevice[] = [
      { ...IPOD_VIDEO_5G, bus: 1, devnum: 4 },
      { ...IPOD_NANO_3G, bus: 2, devnum: 9 },
    ];
    const classified = classifyUsbDevices(enumerated);
    expect(classified).toHaveLength(2);
    expect(classified[0]!.kind).toBe('ipod');
    expect(classified[1]!.kind).toBe('ipod');
    expect(classified[0]!.device.bus).toBe(1);
    expect(classified[0]!.device.devnum).toBe(4);
    expect(classified[0]!.device.productId).toBe('1209'); // video_5g
    expect(classified[1]!.device.bus).toBe(2);
    expect(classified[1]!.device.devnum).toBe(9);
    expect(classified[1]!.device.productId).toBe('1262'); // nano_3g
  });

  it('mixed supported / unsupported iPods preserved in input order', () => {
    const enumerated: EnumeratedUsbDevice[] = [
      IPOD_NANO_4G, // supported
      IPOD_NANO_7G, // unsupported (nano_7g)
      IPOD_MINI, // supported
      IPOD_TOUCH_5G, // unsupported (iOS-range)
    ];
    const classified = classifyUsbDevices(enumerated);
    expect(classified).toHaveLength(4);
    expect(classified.map((c) => c.device.productId)).toEqual(['1263', '1267', '1205', '12aa']);
    expect(classified[0]!.kind === 'ipod' && classified[0]!.supported).toBe(true);
    expect(classified[1]!.kind === 'ipod' && classified[1]!.supported).toBe(false);
    expect(classified[2]!.kind === 'ipod' && classified[2]!.supported).toBe(true);
    expect(classified[3]!.kind === 'ipod' && classified[3]!.supported).toBe(false);
  });

  // NB — the VM-test counterpart (two physical synthetic USB devices bound
  // concurrently) is DEFERRED: the dummy-hcd daemon uses a single hardcoded
  // FunctionFS mount point (`/dev/ffs-podkit`), and a second `systemctl start
  // dummy-hcd-daemon@<id>.service` exits 4 with `mount: /dev/ffs-podkit:
  // podkit-test already mounted`. The reconcile-primitive's dual-iPod ordering
  // path is exhaustively covered unit-side in `reconcile.test.ts`. See
  // `discovery-reconciliation.e2e.test.ts` for the long-form rationale.
});

// ---------------------------------------------------------------------------
// Missing serialNumber: parsers omit the field, classifier still works
// ---------------------------------------------------------------------------

describe('missing serialNumber is omitted (not "" / not null)', () => {
  it('parseSystemProfilerUsbData omits serialNumber when serial_num is absent', () => {
    const data = {
      SPUSBDataType: [
        {
          _items: [
            {
              vendor_id: 'apple_vendor_id',
              product_id: '0x1261', // classic_6g
              // No serial_num field at all.
            },
          ],
        },
      ],
    };
    const enumerated = parseSystemProfilerUsbData(data);
    expect(enumerated).toHaveLength(1);
    expect(Object.hasOwn(enumerated[0]!, 'serialNumber')).toBe(false);
    expect(enumerated[0]!.serialNumber).toBeUndefined();
  });

  it('parseSystemProfilerUsbData omits serialNumber when serial_num is empty string', () => {
    const data = {
      SPUSBDataType: [
        {
          _items: [
            {
              vendor_id: 'apple_vendor_id',
              product_id: '0x1261',
              serial_num: '',
            },
          ],
        },
      ],
    };
    const enumerated = parseSystemProfilerUsbData(data);
    expect(enumerated[0]!.serialNumber).toBeUndefined();
  });

  it('parseSysfsUsbDevices omits serialNumber when serial is absent', () => {
    const enumerated = parseSysfsUsbDevices([{ idVendor: '05ac', idProduct: '1261' }]);
    expect(Object.hasOwn(enumerated[0]!, 'serialNumber')).toBe(false);
    expect(enumerated[0]!.serialNumber).toBeUndefined();
  });

  it('parseSysfsUsbDevices omits serialNumber when serial is empty string', () => {
    const enumerated = parseSysfsUsbDevices([{ idVendor: '05ac', idProduct: '1261', serial: '' }]);
    expect(enumerated[0]!.serialNumber).toBeUndefined();
  });

  it('classifier still resolves model + supported flag from PID alone when serial is missing', () => {
    // No serial — model identification falls back to the USB PID lookup,
    // which is generation-only but sufficient for `supported` and
    // `unsupportedReason` decisions. Doctor's downstream FireWireGUID axis
    // checks `serialNumber === undefined` and skips cleanly.
    const classified = classifyUsbDevices([{ vendorId: '05ac', productId: '1209' }]);
    expect(classified).toHaveLength(1);
    expect(classified[0]!.kind).toBe('ipod');
    if (classified[0]!.kind !== 'ipod') return;
    expect(classified[0]!.supported).toBe(true);
    expect(classified[0]!.model?.generationId).toBe('video_5g');
    expect(classified[0]!.device.serialNumber).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Realistic mixed-bus snapshot (integration)
// ---------------------------------------------------------------------------

describe('realistic mixed-bus snapshot', () => {
  it('classifies a representative mix: 5G + unsupported nano 7G + Sony + Echo Mini + Cruzer + Apple unknown', () => {
    const enumerated: EnumeratedUsbDevice[] = [
      IPOD_VIDEO_5G, // → supported iPod
      IPOD_NANO_7G, // → unsupported iPod
      SONY_WALKMAN, // → kind=unsupported (vendor-recognised)
      ECHO_MINI, // → kind=mass-storage
      SANDISK_CRUZER, // → kind=unsupported (vendor-recognised, no preset)
      { vendorId: '05ac', productId: '12b0' }, // Apple unknown (HomePod) → dropped
      { vendorId: '1234', productId: 'abcd' }, // truly unknown vendor → dropped
    ];
    const classified = classifyUsbDevices(enumerated);
    // 5 recognised: 2 iPods + 1 mass-storage + 2 unsupported vendors.
    // 2 dropped: Apple unknown PID + truly unknown vendor.
    expect(classified).toHaveLength(5);
    const ipods = classified.filter((c) => c.kind === 'ipod');
    expect(ipods).toHaveLength(2);
    const supported = ipods.filter((i) => i.kind === 'ipod' && i.supported);
    expect(supported).toHaveLength(1);
    expect(classified.filter((c) => c.kind === 'mass-storage')).toHaveLength(1);
    expect(classified.filter((c) => c.kind === 'unsupported')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Shuffle 3G (unsupported Apple PID, NOT in iOS range)
// ---------------------------------------------------------------------------

describe('shuffle 3G classified as kind=ipod, unsupported, kind=unsupported-device', () => {
  it('shuffle 3G PID resolves to shuffle_3g with unsupportedReason kind=unsupported-device', () => {
    const classified = classifyUsbDevices([IPOD_SHUFFLE_3G]);
    expect(classified).toHaveLength(1);
    const first = classified[0]!;
    expect(first.kind).toBe('ipod');
    if (first.kind !== 'ipod') return;
    expect(first.supported).toBe(false);
    expect(first.model?.generationId).toBe('shuffle_3g');
    // NOT iOS — it's an unverified write path, not a sync-protocol mismatch.
    expect(first.unsupportedReason?.kind).toBe('unsupported-device');
    expect(first.unsupportedReason?.headline).toMatch(/unverified on hardware/i);
  });
});
