/**
 * Transform warning utility
 *
 * Pure function that computes transform-related warnings based on
 * the resolved transform state and device capabilities. Used by
 * both `sync --dry-run` and `device info` to surface actionable
 * information about capability-gated transforms.
 *
 * @module
 */

import type { TransformsConfig } from '@podkit/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Why the cleanArtists transform is in its current state.
 *
 * - `'auto-enabled'` — global enabled + device doesn't support Album Artist browsing
 * - `'auto-suppressed'` — global enabled + device supports Album Artist browsing
 * - `'explicitly-enabled'` — per-device config explicitly enabled it
 * - `'explicitly-disabled'` — per-device config explicitly disabled it
 * - `'globally-disabled'` — global config has it disabled, no per-device override
 */
export type CleanArtistsResolutionReason =
  | 'auto-enabled'
  | 'auto-suppressed'
  | 'explicitly-enabled'
  | 'explicitly-disabled'
  | 'globally-disabled';

/** Result of resolving clean artists transform state for a device */
export interface CleanArtistsResolution {
  /** The effective transforms config (with cleanArtists.enabled adjusted) */
  transforms: TransformsConfig;
  /** Why the transform is in its current state */
  reason: CleanArtistsResolutionReason;
}

/** A warning about transform configuration */
export interface TransformWarning {
  /** Warning identifier */
  type: 'clean-artists-unnecessary';
  /** Human-readable warning message */
  message: string;
}

// =============================================================================
// Transform Resolution
// =============================================================================

/**
 * Resolve the effective clean artists transform state for a device,
 * applying capability-based gating.
 *
 * Precedence rules:
 * 1. Per-device cleanArtists explicitly set → use that (highest priority)
 * 2. Global enabled + supportsAlbumArtistBrowsing: false → auto-enable
 * 3. Global enabled + supportsAlbumArtistBrowsing: true → auto-suppress
 * 4. Global disabled → disabled regardless
 */
export function resolveCleanArtistsTransform(
  effectiveTransforms: TransformsConfig,
  supportsAlbumArtistBrowsing: boolean | undefined,
  hasPerDeviceCleanArtists: boolean
): CleanArtistsResolution {
  // Rule 1: Per-device explicit override takes highest priority
  if (hasPerDeviceCleanArtists) {
    return {
      transforms: effectiveTransforms,
      reason: effectiveTransforms.cleanArtists.enabled
        ? 'explicitly-enabled'
        : 'explicitly-disabled',
    };
  }

  // Rule 4: Global disabled → disabled regardless of capability
  if (!effectiveTransforms.cleanArtists.enabled) {
    return {
      transforms: effectiveTransforms,
      reason: 'globally-disabled',
    };
  }

  // Rules 2 & 3: Global enabled — gate on capability
  if (supportsAlbumArtistBrowsing === true) {
    // Auto-suppress: device supports Album Artist browsing
    return {
      transforms: {
        ...effectiveTransforms,
        cleanArtists: {
          ...effectiveTransforms.cleanArtists,
          enabled: false,
        },
      },
      reason: 'auto-suppressed',
    };
  }

  // Auto-enable (or no capability info — keep as-is)
  return {
    transforms: effectiveTransforms,
    reason: 'auto-enabled',
  };
}

// =============================================================================
// Warning Computation
// =============================================================================

/**
 * Compute transform warnings for a device.
 *
 * Warning conditions:
 * - "Enabled but unnecessary": cleanArtists is explicitly enabled per-device
 *   AND the device's effective supportsAlbumArtistBrowsing is true AND the
 *   user has NOT overridden supportsAlbumArtistBrowsing (trusting the preset).
 *
 * No warning when the user has overridden supportsAlbumArtistBrowsing — they've
 * made a deliberate device classification decision.
 */
export function computeTransformWarnings(
  resolution: CleanArtistsResolution,
  supportsAlbumArtistBrowsing: boolean | undefined,
  hasCapabilityOverride: boolean
): TransformWarning[] {
  const warnings: TransformWarning[] = [];

  if (
    resolution.reason === 'explicitly-enabled' &&
    supportsAlbumArtistBrowsing === true &&
    !hasCapabilityOverride
  ) {
    warnings.push({
      type: 'clean-artists-unnecessary',
      message:
        'Clean artists is enabled but this device supports Album Artist browsing — ' +
        'the transform may not be necessary. ' +
        'Set supportsAlbumArtistBrowsing = false in your device config if the device ' +
        "doesn't actually use Album Artist for browsing.",
    });
  }

  return warnings;
}
