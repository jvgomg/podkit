import type { ReadinessUnsupportedReason } from '@podkit/device-types';
import { SUPPORTED_DEVICES_DOCS_URL } from '../build-unsupported-reason.js';

/**
 * USB product IDs of iPod/iOS devices that podkit cannot sync, with the reason.
 *
 * Authority sources (in descending priority):
 *   1. linux-usb.org usb.ids (via usb-ids.gowdy.us mirror), Apple vendor 0x05ac.
 *      Canonical USB ID registry — used as ground truth for per-PID attribution.
 *   2. usbmuxd src/usb.h — confirms iOS PID range 0x1290–0x12af (PID_RANGE_LOW /
 *      PID_RANGE_MAX), used by libimobiledevice project for iOS device detection.
 *   3. libgpod 0.8.3 ipod_info_table (itdb_device.c) — cross-reference for
 *      iPod-specific PIDs and checksum requirements.
 *
 * Unsupported categories:
 * - Shuffle 3G/4G: readable, but writing their `bdhs` playback database has
 *   never been verified on hardware, so podkit does not attempt it.
 * - Nano 6G: libgpod has table entries but cannot write the iTunesDB format.
 * - Nano 7G: readable — libgpod opens its iTunesCDB fine (hardware-confirmed,
 *   1,414 tracks). Write is refused because libgpod's hashAB signing needs an
 *   external blob (`LIBGPOD_BLOB_DIR`) podkit does not ship.
 * - iPod touch (all generations): Apple's proprietary sync protocol; no disk mode.
 * - iPhone / iPad: Apple's proprietary sync protocol; no disk mode.
 * - Apple TV, Apple Watch, HomePod: non-iPod Apple USB devices; out of scope.
 *
 * PID sharing notes:
 * - 0x1292: usb.ids lists "iPhone 3G" only; prior tables incorrectly listed this
 *   as shared with iPod touch 2G (touch 2G = 0x1293).
 * - 0x129a: usb.ids lists "iPad" (iPad 1G) only; prior tables incorrectly listed
 *   this as shared with iPod touch 4G (touch 4G = 0x129e).
 * - 0x12a8: shared across iPhone 5, 5c, 5s, 6, SE, 7, 8, X, XR per usb.ids.
 *   Apple reused this PID across many iPhone generations; reason text is generic.
 *
 * Keys are bare hex without 0x prefix (matches IPOD_USB_IDS / UsbFingerprint format).
 *
 * @module
 */

// ── Reason strings ────────────────────────────────────────────────────────────

// The 3G/4G play from an `iTunesSD` in the `bdhs` format. Nothing in that
// write path is cryptographically closed to podkit — it is simply unproven:
// no such device has been written to and confirmed to still play. Until one
// has been, podkit reads these devices and refuses to write them.
const SHUFFLE_REASON =
  'iPod shuffle 3rd/4th gen can be read but not written: writing its iTunesSD playback database is unverified on hardware.';

const NANO_6G_REASON =
  'iPod nano 6th gen uses an iTunesDB format podkit cannot write; read access is untested.';

// nano_7g reads fine — libgpod opens its classic iTunesCDB database without
// trouble (hardware-confirmed: 1,414 tracks, `device archive` succeeded).
// Writing needs a hashAB signature; libgpod only computes hashAB via an
// external `hashab` blob loaded through `LIBGPOD_BLOB_DIR`
// (itdb_hashAB.c:43-68) and fails closed without it. podkit ships no such
// blob, so the write path is refused while reads remain fine.
const NANO_7G_REASON =
  'iPod nano 7th gen can be read and archived, but not synced: writing needs the hashAB signature libgpod cannot produce without an external blob podkit does not ship.';

const itouch = (gen: string) =>
  `iPod touch (${gen}) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.`;

const iphone = (model: string) =>
  `${model} uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.`;

const ipad = (model: string) =>
  `${model} uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.`;

// ── Unsupported product ID table ──────────────────────────────────────────────
//
// Source for 0x129x / 0x12ax range: usb-ids.gowdy.us (linux-usb.org mirror),
// Apple vendor 0x05ac, accessed 2026-05-06.

export const UNSUPPORTED_IPOD_PRODUCT_IDS: Record<string, string> = {
  // ── iPod shuffle 3G / 4G ───────────────────────────────────────────────────
  '1302': SHUFFLE_REASON,
  '1303': SHUFFLE_REASON,

  // ── iPod nano 6G ───────────────────────────────────────────────────────────
  '120d': NANO_6G_REASON,
  '1266': NANO_6G_REASON,

  // ── iPod nano 7G ───────────────────────────────────────────────────────────
  // Not in libgpod 0.8.3 ipod_info_table. USB IDs from linux-usb.org + IPOD_USB_IDS.
  '120e': NANO_7G_REASON,
  '1267': NANO_7G_REASON,

  // ── iPod touch (all generations) ───────────────────────────────────────────
  // Apple's proprietary sync protocol; no disk mode on any touch generation.
  // libgpod has ipod_info_table entries for 1G–4G but they are unreachable
  // because the device never mounts as a mass-storage volume.
  //
  // usb.ids source: 1291=iPod Touch 1.Gen, 1293=iPod Touch 2.Gen,
  //   1296=iPod Touch 3.Gen (8GB), 1299=iPod Touch 3.Gen,
  //   129e=iPod Touch 4.Gen, 12aa=iPod Touch 5.Gen [A1421]
  '1291': itouch('1st generation'), // usb.ids: "iPod Touch 1.Gen"
  '1293': itouch('2nd generation'), // usb.ids: "iPod Touch 2.Gen" (was "3rd gen" — corrected)
  '1296': itouch('3rd generation (8 GB)'), // usb.ids: "iPod Touch 3.Gen (8GB)"
  '1299': itouch('3rd generation'), // usb.ids: "iPod Touch 3.Gen"
  '129e': itouch('4th generation'), // usb.ids: "iPod Touch 4.Gen"
  '12aa': itouch('5th generation'), // usb.ids: "iPod Touch 5.Gen [A1421]" (was "iPhone 5s" — corrected)

  // ── iPhone ─────────────────────────────────────────────────────────────────
  // Source: usb-ids.gowdy.us (linux-usb.org), Apple vendor 0x05ac
  '1290': iphone('iPhone (1st generation)'), // usb.ids: "iPhone"
  '1292': iphone('iPhone 3G'), // usb.ids: "iPhone 3G" (was listed as shared with touch 2G — corrected)
  '1294': iphone('iPhone 3GS'), // usb.ids: "iPhone 3GS"
  '1297': iphone('iPhone 4'), // usb.ids: "iPhone 4"
  '129c': iphone('iPhone 4 (CDMA)'), // usb.ids: "iPhone 4(CDMA)"
  '129d': iphone('iPhone 4 variant'), // usb.ids: "iPhone" (unspecified variant; likely OEM/regional)
  '12a0': iphone('iPhone 4S'), // usb.ids: "iPhone 4S" (was "iPod touch 5G" — corrected)
  '12a1': iphone('iPhone (variant)'), // usb.ids: "iPhone" (unspecified; likely regional variant)
  '12a8': iphone('iPhone 5 / 5c / 5s / 6 / SE / 7 / 8 / X / XR'), // usb.ids: shared PID across many iPhone generations
  '12ac': iphone('iPhone (variant)'), // usb.ids: "iPhone" (unspecified; likely regional variant)

  // ── iPad ───────────────────────────────────────────────────────────────────
  // Source: usb-ids.gowdy.us (linux-usb.org), Apple vendor 0x05ac
  '129a': ipad('iPad (1st generation)'), // usb.ids: "iPad" (was listed as shared with touch 4G — corrected)
  '129f': ipad('iPad 2 (Wi-Fi)'), // usb.ids: "iPad 2"
  '12a2': ipad('iPad 2 (3G, 64 GB)'), // usb.ids: "iPad 2 (3G; 64GB)" (was "iPhone 4S" primary — corrected)
  '12a3': ipad('iPad 2 (CDMA)'), // usb.ids: "iPad 2 (CDMA)"
  '12a4': ipad('iPad (3rd generation, Wi-Fi)'), // usb.ids: "iPad 3 (wifi)"
  '12a5': ipad('iPad (3rd generation, CDMA)'), // usb.ids: "iPad 3 (CDMA)"
  '12a6': ipad('iPad (3rd generation, 3G 16 GB)'), // usb.ids: "iPad 3 (3G, 16 GB)" (was "iPhone 5" — corrected)
  '12a9': ipad('iPad 2 (late 2012)'), // usb.ids: "iPad 2" (was "iPhone 5c / iPad mini 1G" — corrected)
  '12ab': ipad('iPad (4th generation or later)'), // usb.ids: "iPad" (was "iPod touch 6G" — corrected)

  // ── Apple Watch ────────────────────────────────────────────────────────────
  // 0x12af falls within the iOS range catch (0x1290–0x12af); listed explicitly
  // to give a more specific error message than the generic iOS fallback.
  '12af':
    "Apple Watch uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.",
};

/**
 * Returns the unsupported reason for a USB product ID, or null if the device
 * is supported (or unknown to this table).
 *
 * Accepts both `"1302"` and `"0x1302"` forms.
 */
export function lookupUnsupportedReason(productId: string): string | null {
  const normalized = productId.toLowerCase().replace(/^0x/, '');
  return UNSUPPORTED_IPOD_PRODUCT_IDS[normalized] ?? null;
}

/**
 * Returns a generic unsupported reason for Apple-vendor (0x05ac) PIDs in the
 * iOS device ranges (0x1290–0x12af) that are not explicitly listed in
 * UNSUPPORTED_IPOD_PRODUCT_IDS and not in IPOD_USB_IDS.
 *
 * The range 0x1290–0x12af is the canonical iOS device PID range per
 * usbmuxd (libimobiledevice project), which defines PID_RANGE_LOW=0x1290
 * and PID_RANGE_MAX=0x12af in src/usb.h. All known iPhone, iPad, and iPod
 * touch USB PIDs fall within this range.
 *
 * Disk-mode-capable iPod PIDs (0x1200–0x126f, 0x1300–0x1303) are outside
 * this range, so no supported iPod will be accidentally caught here.
 *
 * The range is NOT extended to 0x12b0+ (HomePod=0x12b0) because those devices
 * are not iOS sync targets and do not need an informative rejection message.
 *
 * Use this as a range-catch fallback in the discovery layer when an unrecognised
 * Apple-vendor PID falls in a known iOS range, so that future iPhone/iPad
 * generations produce an informative "not supported" message rather than
 * silently appearing as supported.
 */
export function lookupIosRangeFallbackReason(productId: string): string | null {
  const normalized = productId.toLowerCase().replace(/^0x/, '');
  const pid = parseInt(normalized, 16);
  // 0x1290–0x12af: iOS device PID range (iPhone, iPad, iPod touch, Apple Watch)
  if (pid >= 0x1290 && pid <= 0x12af) {
    return "iOS device (iPhone, iPad, or iPod touch) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
  }
  return null;
}

/**
 * Combined lookup that returns a fully-typed {@link ReadinessUnsupportedReason}
 * for an unsupported USB product ID, or `null` if the device is supported.
 *
 * Picks the `kind` discriminator based on PID range:
 * - PIDs in the iOS range (0x1290–0x12af) get `'ios-device'` — iPhone / iPad /
 *   iPod touch / Apple Watch all use Apple's proprietary sync protocol.
 * - Explicit Apple table entries outside that range (nano 6G/7G, shuffle 3G/4G)
 *   get `'unsupported-device'` — podkit-specific limitations, not iOS.
 *
 * Used by `IpodClassification`, `IpodIdentity`, and the device-scan JSON
 * envelope so every consumer sees the same canonical shape, replacing the
 * legacy bare-string `notSupportedReason` field.
 */
export function lookupUnsupportedReadinessReason(
  productId: string
): ReadinessUnsupportedReason | null {
  const headline = lookupUnsupportedReason(productId) ?? lookupIosRangeFallbackReason(productId);
  if (!headline) return null;
  const normalized = productId.toLowerCase().replace(/^0x/, '');
  const pid = parseInt(normalized, 16);
  const isIosRange = Number.isFinite(pid) && pid >= 0x1290 && pid <= 0x12af;
  return {
    kind: isIosRange ? 'ios-device' : 'unsupported-device',
    headline,
    docsUrl: SUPPORTED_DEVICES_DOCS_URL,
  };
}
