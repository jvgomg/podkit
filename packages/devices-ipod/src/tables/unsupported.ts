/**
 * USB product IDs of iPod/iOS devices that podkit cannot sync, with the reason.
 *
 * Authority source: libgpod 0.8.3 ipod_info_table (itdb_device.c) cross-referenced
 * with linux-usb.org usb.ids for Apple vendor 0x05ac.
 *
 * Unsupported categories:
 * - Shuffle 3G/4G: libgpod has table entries but requires iTunes authentication.
 * - Nano 6G: libgpod has table entries but cannot write the iTunesDB format.
 * - Nano 7G: NOT in libgpod's ipod_info_table at all.
 * - iPod touch (all generations): Apple's proprietary sync protocol; no disk mode.
 * - iPhone / iPad: Apple's proprietary sync protocol; no disk mode.
 *
 * Note on PID sharing: some PIDs in the 0x129x / 0x12ax range appear on more
 * than one Apple product line (e.g., 0x1292 maps to both iPhone 3G and iPod touch
 * 2G in different databases). In every case the sync constraint is identical —
 * Apple's proprietary protocol is used regardless — so the reason text is
 * "iOS device" to avoid confusion.
 *
 * Keys are bare hex without 0x prefix (matches IPOD_USB_IDS / UsbFingerprint format).
 *
 * @module
 */

// ── Reason strings ────────────────────────────────────────────────────────────

const SHUFFLE_REASON =
  'iPod shuffle 3rd/4th gen requires iTunes authentication; not supported by libgpod.';

const NANO_6G_REASON = 'iPod nano 6th gen uses an iTunesDB format incompatible with libgpod.';

const NANO_7G_REASON = "iPod nano 7th gen is not in libgpod's device table; podkit cannot sync it.";

const IOS_TOUCH_REASON = (gen: string) =>
  `iPod touch (${gen}) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.`;

const IOS_SHARED_REASON =
  "iOS device (iPhone/iPad/iPod touch) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";

const IPHONE_REASON =
  "iPhone uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";

const IPAD_REASON =
  "iPad uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";

// ── Unsupported product ID table ──────────────────────────────────────────────

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
  '1291': IOS_TOUCH_REASON('1st generation'), // touch 1G
  '1293': IOS_TOUCH_REASON('3rd generation'), // touch 3G
  '12a0': IOS_TOUCH_REASON('5th generation'), // touch 5G
  '12ab': IOS_TOUCH_REASON('6th generation'), // touch 6G
  '12a8': IOS_TOUCH_REASON('7th generation'), // touch 7G

  // ── Shared PIDs (touch + iPhone / touch + iPad) ────────────────────────────
  // These PIDs appear on more than one product line; reason is generic.
  '1292': IOS_SHARED_REASON, // touch 2G / iPhone 3G
  '129a': IOS_SHARED_REASON, // touch 4G / iPad 1G
  '12a9': IOS_SHARED_REASON, // iPhone 5c / iPad mini 1G

  // ── iPhone ─────────────────────────────────────────────────────────────────
  // Source: linux-usb.org usb.ids, Apple vendor 0x05ac
  '1290': IPHONE_REASON, // iPhone (1st generation)
  '1294': IPHONE_REASON, // iPhone 3GS
  '1297': IPHONE_REASON, // iPhone 4
  '129c': IPHONE_REASON, // iPhone 4 (CDMA / Verizon)
  '12a2': IPHONE_REASON, // iPhone 4S / iPad 2 GSM (shared) — iPhone primary
  '12a6': IPHONE_REASON, // iPhone 5
  '12aa': IPHONE_REASON, // iPhone 5s

  // ── iPad ───────────────────────────────────────────────────────────────────
  // Source: linux-usb.org usb.ids, Apple vendor 0x05ac
  '129f': IPAD_REASON, // iPad 2 (WiFi)
  '12a3': IPAD_REASON, // iPad 2 (CDMA)
  '12a4': IPAD_REASON, // iPad (3rd generation, WiFi)
  '12a5': IPAD_REASON, // iPad (3rd generation, CDMA)
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
 * Use this as a range-catch fallback in the discovery layer when an unrecognised
 * Apple-vendor PID falls in a known iOS range, so that future iPhone/iPad
 * generations produce an informative "not supported" message rather than
 * silently appearing as supported.
 */
export function lookupIosRangeFallbackReason(productId: string): string | null {
  const normalized = productId.toLowerCase().replace(/^0x/, '');
  const pid = parseInt(normalized, 16);
  // 0x1290–0x12af: iOS device PID range (iPhone, iPad, iPod touch)
  if (pid >= 0x1290 && pid <= 0x12af) {
    return "iOS device (iPhone, iPad, or iPod touch) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";
  }
  return null;
}
