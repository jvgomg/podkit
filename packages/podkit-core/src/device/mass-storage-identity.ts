/**
 * Mass-storage device assessment.
 *
 * Symmetric counterpart to {@link assessIpodIdentity} in `./ipod-identity.js`.
 * Mass-storage devices are identified by the user-supplied preset id, not
 * from firmware inquiry — so this helper takes the preset id alongside the
 * mount point and resolves the preset + capabilities through the standard
 * `@podkit/devices-mass-storage` pipeline.
 *
 * Path validation is intentionally NOT performed here: it's a user-input
 * check (CLI's job) and `assessIpodIdentity` doesn't do it either. The
 * `mountPoint` is passed through verbatim so callers that render the
 * assessment have it on the bundle.
 *
 * Unknown preset ids surface as `preset: null` (and consequently
 * `capabilities: null`), mirroring how `assessIpodIdentity` returns
 * `model: null` when the cascade fails to resolve.
 *
 * @module
 */

import type { DeviceCapabilities, MassStorageIdentity } from '@podkit/device-types';
import {
  BUILT_IN_PRESETS,
  getCapabilities as resolveMassStorageCapabilities,
  type MassStoragePreset,
} from '@podkit/devices-mass-storage';

// =============================================================================
// Types
// =============================================================================

export interface MassStorageAssessment {
  /** Resolved mass-storage identity (kind + presetId). Always present. */
  readonly identity: MassStorageIdentity;
  /**
   * Mass-storage preset selected by `presetId`. `null` when no preset
   * matches — callers translate to an `UNKNOWN_PRESET` error.
   */
  readonly preset: MassStoragePreset | null;
  /**
   * Resolved capabilities = preset defaults + per-call overrides. `null`
   * iff `preset` is null.
   */
  readonly capabilities: DeviceCapabilities | null;
  /** Confirmed mount path (passed through from the input). */
  readonly mountPoint: string;
}

export interface AssessMassStorageDeviceOptions {
  /**
   * Preset id (e.g. `'echo-mini'`, `'rockbox'`, `'generic'`, or a
   * user-registered id). Required — mass-storage devices have no firmware
   * inquiry, so the user always selects the preset explicitly.
   */
  presetId: string;
  /**
   * Per-device capability overrides. Applied last in the preset →
   * overrides resolution order.
   */
  overrides?: Partial<DeviceCapabilities>;
  /**
   * Preset registry (typically `BUILT_IN_PRESETS` merged with any
   * user-registered presets). Defaults to `BUILT_IN_PRESETS` only.
   */
  presets?: Record<string, MassStoragePreset>;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Assess a mass-storage device's identity + capabilities from a mount path
 * and a preset id.
 *
 * The mass-storage twin of {@link assessIpodIdentity}. Path validation is
 * the caller's responsibility; this helper resolves the preset and
 * capabilities, never throws on missing presets (returns `preset: null`),
 * and never touches the filesystem.
 *
 * @param mountPoint - Mount path; passed through to `assessment.mountPoint`.
 * @param opts - `presetId` (required), optional `overrides` and `presets` registry.
 */
export function assessMassStorageDevice(
  mountPoint: string,
  opts: AssessMassStorageDeviceOptions
): MassStorageAssessment {
  // Resolution order mirrors `getCapabilities` in @podkit/devices-mass-storage:
  // user-supplied registry first, then built-ins as fallback. Returning null
  // (rather than throwing) is what distinguishes "assess" from "get": callers
  // can render "unknown preset" without try/catch.
  const builtIns = BUILT_IN_PRESETS as Record<string, MassStoragePreset>;
  const presets: Record<string, MassStoragePreset> = opts.presets ?? builtIns;
  const preset: MassStoragePreset | null =
    presets[opts.presetId] ?? builtIns[opts.presetId] ?? null;

  const identity: MassStorageIdentity = {
    kind: 'mass-storage',
    presetId: opts.presetId,
  };

  if (!preset) {
    return { identity, preset: null, capabilities: null, mountPoint };
  }

  const capabilities = resolveMassStorageCapabilities(identity, {
    presets,
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  });

  return { identity, preset, capabilities, mountPoint };
}
