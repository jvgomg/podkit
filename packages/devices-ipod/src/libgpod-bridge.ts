/**
 * libgpod bridge — converts libgpod's DeviceInfo shape to the canonical IpodModel.
 *
 * This thin adapter exists because `open-device.ts` and `device.ts` receive data
 * from `libgpod-node` (via `device.getCapabilities()`) in a shape that predates the
 * unified `IpodModel` type. Rather than duplicating the conversion at every call site
 * we centralise it here.
 *
 * Moved from `@podkit/core/device/libgpod-bridge.ts` at m-18. All iPod-classification
 * logic that touches libgpod naming lives in `@podkit/devices-ipod`, not in core.
 *
 * Note: m-8 will eventually replace libgpod entirely; when that happens this bridge
 * disappears along with the last libgpod dependency in core.
 *
 * @module
 */

import { identify } from './identity.js';
import { GENERATION_ID_TO_LIBGPOD } from './tables/libgpod-mapping.js';
import { GENERATIONS } from './tables/generations.js';
import type { IpodModel, IpodGenerationId } from './types.js';

// =============================================================================
// Unsupported reason by libgpod generation name
// =============================================================================

/**
 * Category of unsupported device (keyed by libgpod generation string).
 *
 * - `'ios_device'`        — iPod Touch, iPhone, iPad (Apple proprietary protocol)
 * - `'buttonless_shuffle'` — Shuffle 3G/4G (requires iTunes authentication)
 * - `'nano_6'`            — Nano 6th gen (incompatible iTunesDB format)
 */
export type UnsupportedGenerationKind = 'ios_device' | 'buttonless_shuffle' | 'nano_6';

/** libgpod generation names that use Apple's proprietary sync protocol. */
const IOS_LIBGPOD_NAMES = new Set([
  'touch_1',
  'touch_2',
  'touch_3',
  'touch_4',
  'iphone_1',
  'iphone_2',
  'iphone_3',
  'iphone_4',
  'ipad_1',
]);

/** libgpod generation names for "buttonless" Shuffles requiring iTunes auth. */
const BUTTONLESS_SHUFFLE_LIBGPOD_NAMES = new Set(['shuffle_3', 'shuffle_4']);

/**
 * Returns the unsupported kind for a libgpod generation string, or null if the
 * generation is supported by podkit.
 *
 * Used by `core/ipod/device-validation.ts` to build structured `DeviceIssue`
 * objects without embedding libgpod generation name tables in core.
 *
 * @param libgpodName - Generation string as returned by libgpod (e.g. 'touch_1', 'nano_6')
 */
export function getUnsupportedReasonByLibgpodName(
  libgpodName: string
): UnsupportedGenerationKind | null {
  if (IOS_LIBGPOD_NAMES.has(libgpodName)) return 'ios_device';
  if (BUTTONLESS_SHUFFLE_LIBGPOD_NAMES.has(libgpodName)) return 'buttonless_shuffle';
  if (libgpodName === 'nano_6') return 'nano_6';
  return null;
}

// =============================================================================
// Types
// =============================================================================

/**
 * The subset of libgpod Device capabilities needed by the bridge.
 *
 * This mirrors the shape returned by `device.getCapabilities()` in
 * `@podkit/libgpod-node`. A local definition avoids importing the native
 * package at this layer.
 */
export interface LibgpodDeviceInfo {
  readonly supportsArtwork: boolean;
  readonly supportsVideo: boolean;
  readonly generation: string;
  readonly modelNumber?: string | null;
}

// =============================================================================
// Internal index: libgpod generation name → IpodGenerationId
// =============================================================================

// Built once at module load from the canonical forward mapping.
const LIBGPOD_TO_GENERATION_ID = new Map<string, IpodGenerationId>();
for (const [genId, libgpodName] of Object.entries(GENERATION_ID_TO_LIBGPOD)) {
  LIBGPOD_TO_GENERATION_ID.set(libgpodName, genId as IpodGenerationId);
}

// =============================================================================
// Bridge
// =============================================================================

/**
 * Build an `IpodModel` from libgpod device info.
 *
 * Resolution chain (first match wins):
 * 1. SysInfo model number — `identify({ from: 'sysinfo', modelNumStr })` when
 *    `device.modelNumber` is present. Most specific — identifies capacity, color.
 * 2. libgpod generation → IpodGenerationId reverse mapping — constructs a
 *    synthetic IpodModel from the generation table.
 * 3. Minimal synthetic fallback — `video_5g` for unrecognised generations.
 *
 * Used by core for callers that have libgpod's DeviceInfo shape rather than a
 * UsbFingerprint. m-8 will eventually replace libgpod entirely; this bridge
 * disappears then.
 */
export function modelFromLibgpodInfo(device: LibgpodDeviceInfo): IpodModel {
  // 1. SysInfo model number lookup
  if (device.modelNumber) {
    const model = identify({ from: 'sysinfo', modelNumStr: device.modelNumber });
    if (model) return model;
  }

  // 2. Reverse libgpod generation → IpodGenerationId
  const generationId = LIBGPOD_TO_GENERATION_ID.get(device.generation);
  if (generationId) {
    const gen = GENERATIONS[generationId];
    return {
      displayName: gen.displayName,
      generationId,
      checksumType: gen.checksumType,
      source: 'usb',
      ...(gen.supported
        ? {}
        : {
            notSupportedReason: `${gen.displayName} is not supported by podkit (libgpod cannot sync this generation).`,
          }),
    };
  }

  // 3. Minimal synthetic fallback
  const fallbackGen = GENERATIONS['video_5g'];
  return {
    displayName: fallbackGen.displayName,
    generationId: 'video_5g',
    checksumType: fallbackGen.checksumType,
    source: 'usb',
  };
}
