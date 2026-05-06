/**
 * Test helpers for iPod capability resolution.
 *
 * Convenience wrappers used in integration tests that need a `DeviceCapabilities`
 * from a libgpod generation string (e.g. `'classic_3'`). Production code should
 * use `resolveIpodModelCapabilities` with a real `IpodModel` from `identify()`.
 *
 * @internal Test use only — not exported from the package public surface.
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { IpodGenerationId, IpodModel } from '@podkit/devices-ipod';
import { GENERATIONS, GENERATION_ID_TO_LIBGPOD } from '@podkit/devices-ipod';
import { resolveIpodModelCapabilities } from '../device/resolve-capabilities.js';

/**
 * Reverse-index: libgpod generation name → IpodGenerationId.
 * Built once from the authoritative GENERATION_ID_TO_LIBGPOD map.
 */
const LIBGPOD_TO_GENERATION_ID = new Map<string, IpodGenerationId>();
for (const [genId, libgpodName] of Object.entries(GENERATION_ID_TO_LIBGPOD)) {
  if (!LIBGPOD_TO_GENERATION_ID.has(libgpodName)) {
    LIBGPOD_TO_GENERATION_ID.set(libgpodName, genId as IpodGenerationId);
  }
}

/**
 * Resolve `DeviceCapabilities` from a libgpod generation string.
 *
 * Looks up the canonical `IpodGenerationId` via the libgpod mapping table,
 * constructs a minimal synthetic `IpodModel`, and delegates to
 * `resolveIpodModelCapabilities`. Falls back to `classic_7g` for unrecognised
 * generation strings (mirrors the old `getDeviceCapabilities` fallback behaviour).
 *
 * @param libgpodGeneration - Generation string as returned by libgpod
 *   (e.g. `'classic_3'`, `'nano_5'`, `'video_1'`).
 * @returns Device capabilities for the given generation.
 */
export function capsForLibgpodGeneration(libgpodGeneration: string): DeviceCapabilities {
  const genId: IpodGenerationId = LIBGPOD_TO_GENERATION_ID.get(libgpodGeneration) ?? 'classic_7g';
  const gen = GENERATIONS[genId];
  const model: IpodModel = {
    generationId: genId,
    displayName: gen.displayName,
    checksumType: gen.checksumType,
    source: 'usb',
  };
  return resolveIpodModelCapabilities(model);
}
