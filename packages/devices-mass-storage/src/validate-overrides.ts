/**
 * Capability override validation for mass-storage devices
 *
 * Validates a partial `DeviceCapabilities` patch before it is applied to a
 * mass-storage device preset. Returns all errors at once (not first-fail) so
 * callers can surface a complete picture to the user.
 *
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import { ARTWORK_SOURCES, AUDIO_CODECS } from '@podkit/device-types';

// =============================================================================
// Types
// =============================================================================

/** Capability keys that mass-storage devices publish (and can be overridden per-device). */
export const MASS_STORAGE_CAPABILITY_KEYS: readonly (keyof DeviceCapabilities)[] = [
  'artworkSources',
  'artworkMaxResolution',
  'supportedAudioCodecs',
  'supportsVideo',
  'audioNormalization',
  'supportsAlbumArtistBrowsing',
] as const;

/**
 * The subset of error codes relevant to capability override validation.
 * Matches the `DeviceErrorCodes` values used in the CLI so callers can map
 * `errors[0].code` directly to the appropriate exit code.
 */
export type CapabilityOverrideErrorCode =
  | 'INVALID_ARTWORK_RESOLUTION'
  | 'INVALID_ARTWORK_SOURCE'
  | 'INVALID_AUDIO_CODEC';

export interface CapabilityOverrideValidationError {
  /** Which capability key failed validation. */
  field: keyof DeviceCapabilities;
  /** The error code — maps to CLI DeviceErrorCodes values. */
  code: CapabilityOverrideErrorCode;
  /** Human-readable message suitable for surfacing to the user. */
  message: string;
}

export type CapabilityOverrideValidationResult =
  | { ok: true }
  | { ok: false; errors: CapabilityOverrideValidationError[] };

// =============================================================================
// validateCapabilityOverrides
// =============================================================================

/**
 * Validate a partial DeviceCapabilities patch against the values mass-storage
 * accepts. Returns all errors at once (not first-fail) so the CLI can surface
 * a complete picture.
 *
 * - `artworkMaxResolution`: when a number, must be an integer in [1, 10000].
 *   `null` is valid (means "no artwork support / clear the value").
 * - `artworkSources`: every element must be a valid `DeviceArtworkSource`.
 * - `supportedAudioCodecs`: every element must be a valid `AudioCodec`.
 * - `supportsVideo`, `audioNormalization`, `supportsAlbumArtistBrowsing`:
 *   no validation (booleans / enum constrained by TypeScript callers).
 */
export function validateCapabilityOverrides(
  overrides: Partial<DeviceCapabilities>
): CapabilityOverrideValidationResult {
  const errors: CapabilityOverrideValidationError[] = [];

  // artworkMaxResolution — only validate when it's a number (null is a valid "clear")
  if (typeof overrides.artworkMaxResolution === 'number') {
    const v = overrides.artworkMaxResolution;
    if (!Number.isInteger(v) || v < 1 || v > 10000) {
      errors.push({
        field: 'artworkMaxResolution',
        code: 'INVALID_ARTWORK_RESOLUTION',
        message: `Invalid artwork-max-resolution value "${v}". Must be a positive integer between 1 and 10000.`,
      });
    }
  }

  // artworkSources — validate every element
  if (overrides.artworkSources !== undefined) {
    for (const source of overrides.artworkSources) {
      if (!(ARTWORK_SOURCES as readonly string[]).includes(source)) {
        errors.push({
          field: 'artworkSources',
          code: 'INVALID_ARTWORK_SOURCE',
          message: `Invalid artwork source "${source}". Valid values: ${ARTWORK_SOURCES.join(', ')}`,
        });
      }
    }
  }

  // supportedAudioCodecs — validate every element
  if (overrides.supportedAudioCodecs !== undefined) {
    for (const codec of overrides.supportedAudioCodecs) {
      if (!(AUDIO_CODECS as readonly string[]).includes(codec)) {
        errors.push({
          field: 'supportedAudioCodecs',
          code: 'INVALID_AUDIO_CODEC',
          message: `Invalid audio codec "${codec}". Valid values: ${AUDIO_CODECS.join(', ')}`,
        });
      }
    }
  }

  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}
