/**
 * Capability override validation for iPod devices
 *
 * Symmetric counterpart of `validateCapabilityOverrides` in
 * `@podkit/devices-mass-storage`. Exists so the CLI can ask both device
 * families the same question — "is this user-supplied capability override
 * acceptable?" — through one shape.
 *
 * iPod capabilities are derived from the generation tables and (when
 * present) SysInfoExtended; they are *not* user-overridable. Every key
 * in `DeviceCapabilities` therefore counts as rejected when set.
 *
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Capability keys that iPod devices allow in per-device overrides.
 *
 * iPod capabilities are derived from generation tables; the user cannot
 * override them. Kept as an exported empty array to mirror
 * `MASS_STORAGE_CAPABILITY_KEYS` — callers iterate it the same way.
 */
export const IPOD_CAPABILITY_KEYS: readonly (keyof DeviceCapabilities)[] = [] as const;

export type CapabilityOverrideErrorCode = 'OVERRIDE_NOT_SUPPORTED';

export interface CapabilityOverrideValidationError {
  /** Which capability key was rejected. */
  field: keyof DeviceCapabilities;
  /** The error code. */
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
 * Validate a partial `DeviceCapabilities` patch against the iPod family.
 *
 * iPods do not accept user-supplied capability overrides: every value is
 * derived from the generation tables and firmware. This validator therefore
 * returns an error for every key the caller supplies.
 *
 * Returned errors are collected — not first-fail — so the CLI can surface
 * the complete set in one message.
 */
export function validateCapabilityOverrides(
  overrides: Partial<DeviceCapabilities>
): CapabilityOverrideValidationResult {
  const errors: CapabilityOverrideValidationError[] = [];

  for (const key of Object.keys(overrides) as (keyof DeviceCapabilities)[]) {
    if (overrides[key] === undefined) continue;
    errors.push({
      field: key,
      code: 'OVERRIDE_NOT_SUPPORTED',
      message: `iPod capability "${key}" cannot be overridden; values are derived from the generation tables.`,
    });
  }

  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}
