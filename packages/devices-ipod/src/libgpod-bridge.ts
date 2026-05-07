/**
 * libgpod bridge — libgpod-specific types and unsupported-device classification.
 *
 * Houses the `LibgpodDeviceInfo` input shape (used by callers that receive data
 * from `@podkit/libgpod-node`) and `getUnsupportedReasonByLibgpodName` (used by
 * device-validation to build structured `DeviceIssue` objects without embedding
 * libgpod generation name tables in core).
 *
 * Model resolution from libgpod data is handled by `resolveIpodModel` in resolve.ts.
 *
 * @module
 */

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
 * The subset of libgpod Device capabilities needed to resolve an iPod model.
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
