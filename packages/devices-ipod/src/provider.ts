/**
 * iPod device provider
 *
 * Implements `DeviceProvider<IpodIdentity>` for the enumeration framework.
 * The provider acts as the live-device path: it pre-filters by USB VID/PID,
 * then calls `inquireFirmware` to obtain the canonical identity fields
 * (`firewireGuid`, `serialNumber`, `familyId`) that only exist after querying
 * connected hardware.
 *
 * ## Alignment decision (Option A)
 *
 * `identify(input)` in this package returns `IpodModel` (table-derived, offline).
 * The canonical `IpodIdentity` from `@podkit/device-types` requires firmware
 * fields that are only available from a live SCSI/USB inquiry. Option A was
 * chosen: `detect(fp)` depends on `@podkit/ipod-firmware` and returns a full
 * `IpodIdentity` when firmware is available, or `null` when it is not.
 *
 * The offline/table-only case is still available by importing `lookupByUsbId`
 * or `identify` from `@podkit/devices-ipod` directly — bypassing the provider.
 *
 * ## Dependency note
 *
 * This file adds `@podkit/ipod-firmware` as a dependency of `@podkit/devices-ipod`.
 * The dep graph remains acyclic:
 *   `ipod-firmware` → `device-types`
 *   `devices-ipod`  → `ipod-firmware` + `device-types`
 *
 * @module
 */

import type {
  DeviceProvider,
  UsbFingerprint,
  IpodIdentity,
  DeviceAddIntent,
  DiscoveredContext,
} from '@podkit/device-types';
import { inquireFirmware } from '@podkit/ipod-firmware';
import { lookupByUsbId } from './lookups.js';
import { lookupUnsupportedReadinessReason } from './tables/unsupported.js';

/** Apple USB vendor ID (lower-case, no 0x prefix) */
const APPLE_VENDOR_ID = '05ac';

/** Normalise a vendor/product ID string to lower-case hex without 0x prefix */
function normaliseHexId(id: string): string {
  const lower = id.toLowerCase();
  return lower.startsWith('0x') ? lower.slice(2) : lower;
}

/**
 * Returns true when `fp.vendorId` identifies Apple Inc.
 * Accepts both `"05ac"` and `"0x05ac"` forms.
 */
function isAppleVendor(fp: UsbFingerprint): boolean {
  return normaliseHexId(fp.vendorId) === APPLE_VENDOR_ID;
}

/**
 * Returns true when `fp.productId` is in the known iPod USB product ID table.
 * Both `"1260"` and `"0x1260"` forms are accepted.
 */
function isKnownIpodProduct(fp: UsbFingerprint): boolean {
  return lookupByUsbId(fp.productId) !== undefined;
}

/**
 * iPod device provider.
 *
 * `detect` pre-filters by Apple VID and known iPod product IDs, then calls
 * `inquireFirmware` to obtain the firmware identity. If firmware inquiry
 * fails (e.g. device is unreachable, returns unrecognised bytes, or required
 * identity fields are missing), `detect` returns `null`.
 *
 * For the offline / table-only case, use `lookupByUsbId` or `identify`
 * from `@podkit/devices-ipod` directly.
 *
 * @example
 * ```typescript
 * import { ipodProvider } from '@podkit/devices-ipod';
 *
 * const identity = await ipodProvider.detect({
 *   vendorId: '05ac',
 *   productId: '1260',
 *   bus: 3,
 *   devnum: 4,
 * });
 * // identity → { kind: 'ipod', firewireGuid: '...', serialNumber: '...', familyId: 120 }
 * ```
 */
export const ipodProvider: DeviceProvider<IpodIdentity> = {
  id: 'ipod',

  async detect(fp: UsbFingerprint): Promise<IpodIdentity | null> {
    // Pre-filter: must be an Apple device.
    if (!isAppleVendor(fp)) return null;

    // Unsupported short-circuit — return tagged identity WITHOUT calling
    // inquireFirmware. Saves the ~5s SCSI/USB timeout per device on
    // unsupported hardware (Touch/iPhone/iPad/nano 6G/7G/Shuffle 3G/4G).
    const unsupportedReason = lookupUnsupportedReadinessReason(fp.productId);
    if (unsupportedReason) {
      return {
        kind: 'ipod',
        firewireGuid: '',
        serialNumber: fp.serialNumber ?? '',
        familyId: null,
        unsupportedReason,
      };
    }

    // Pre-filter: must be a product ID we recognise as an iPod.
    if (!isKnownIpodProduct(fp)) return null;

    // Live firmware inquiry — SCSI or USB, orchestrated by ipod-firmware.
    const firmware = await inquireFirmware(fp);
    if (!firmware) return null;

    return {
      kind: 'ipod',
      firewireGuid: firmware.firewireGuid,
      serialNumber: firmware.serialNumber,
      // extractFromPlist populates familyId when FamilyID is present in the
      // SysInfoExtended plist; null when the field is absent or the firmware
      // path returned a partial result.
      familyId: firmware.capabilities?.familyId ?? null,
    };
  },

  describeAddIntent(
    identity: IpodIdentity,
    _discovered: DiscoveredContext
  ): DeviceAddIntent | null {
    // Unsupported iPod (Touch / nano 6 / shuffle 3G/4G / iOS device): surface
    // the reason as a note. No add-command to suggest — but the user benefits
    // from knowing the device was *recognised*, just not supported.
    if (identity.unsupportedReason) {
      const { headline, docsUrl } = identity.unsupportedReason;
      return {
        providerId: 'ipod',
        kind: 'ipod',
        addArgs: [],
        notes: docsUrl ? [headline, `See: ${docsUrl}`] : [headline],
      };
    }

    // Supported iPod detected via USB only — no mounted disk found by the
    // platform device manager. The user's add command was correct; they just
    // need to mount the device first (or check the USB connection).
    return {
      providerId: 'ipod',
      kind: 'ipod',
      addArgs: [],
      notes: [
        '(iPod detected via USB but no mounted disk — try `podkit device mount` first, then re-run this command)',
      ],
    };
  },
};
