/**
 * libgpod bridge — converts libgpod's DeviceInfo shape to the canonical IpodModel.
 *
 * This thin adapter exists because `open-device.ts` and `device.ts` receive data
 * from `libgpod-node` (via `device.getCapabilities()`) in a shape that predates the
 * unified `IpodModel` type. Rather than duplicating the conversion at every call site
 * we centralise it here.
 *
 * Note: m-8 will eventually replace libgpod entirely; when that happens this bridge
 * disappears along with the last libgpod dependency in core.
 *
 * @module
 */

import { identify, GENERATION_ID_TO_LIBGPOD, GENERATIONS } from '@podkit/devices-ipod';
import type { IpodModel, IpodGenerationId } from '@podkit/devices-ipod';

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
