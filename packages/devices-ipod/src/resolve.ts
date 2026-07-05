/**
 * Multi-axis iPod model resolver.
 *
 * `resolveIpodModel(input)` accepts a partial identity bag and cascades through
 * resolution sources from most-specific to least-specific, returning the first
 * successful match as an `IpodModel`.
 *
 * This is the DRY consolidation of two previously-separate bridge functions:
 * - The serial-suffix / FamilyID cascade that lived in core's resolve-capabilities.ts
 * - The modelNumStr / libgpod-generation cascade that lived in libgpod-bridge.ts
 *
 * @module
 */

import { identify } from './identity.js';
import { lookupByFamilyId, lookupByUsbId } from './lookups.js';
import { lookupByLibgpodName } from './tables/libgpod-mapping.js';
import { GENERATIONS } from './tables/generations.js';
import { buildUnsupportedReason, accessLimitationHeadline } from './build-unsupported-reason.js';
import { formatIpodLabel } from './format.js';
import type { IpodModel, IpodGenerationId } from './types.js';

// =============================================================================
// Input type
// =============================================================================

/**
 * Partial identity bag passed to `resolveIpodModel`.
 *
 * All fields are optional — populate whichever axes are available.
 * At least one field must be populated or the function returns null.
 */
export interface ResolveModelInput {
  /** Apple USB product ID, e.g. '0x1260' (with or without 0x prefix). */
  productId?: string;
  /** SysInfoExtended ModelNumStr, e.g. 'MA477'. */
  modelNumStr?: string;
  /** Full iPod serial number; uses last-3 suffix lookup. */
  serialNumber?: string;
  /** Firmware FamilyID integer (e.g. 27 for touch 2G). `null` when unknown. */
  familyId?: number | null;
  /** Raw libgpod generation string (e.g. 'classic_3'). */
  libgpodGeneration?: string;
}

// =============================================================================
// Internal helper
// =============================================================================

/**
 * Construct a synthetic IpodModel from a generation ID alone.
 *
 * Used for generation-only sources (familyId, libgpodGeneration, productId)
 * where no variant data (capacity, color) is available.
 */
function synthesizeFromGeneration(genId: IpodGenerationId): IpodModel {
  const gen = GENERATIONS[genId];
  const displayName = formatIpodLabel({ family: gen.family, ordinal: gen.ordinal });
  const limitation = accessLimitationHeadline(displayName, gen.support);
  const unsupportedReason = limitation ? buildUnsupportedReason(limitation, genId) : undefined;
  return {
    displayName,
    generationId: genId,
    family: gen.family,
    ordinal: gen.ordinal,
    checksumType: gen.checksumType,
    source: 'usb',
    ...(unsupportedReason ? { unsupportedReason } : {}),
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve a partial identity to an IpodModel. Tries each populated input field
 * in cascade order (most specific → least specific):
 *
 * 1. modelNumStr — SysInfo model number; uniquely identifies variant (capacity, color).
 * 2. serialNumber — last-3 suffix lookup; also identifies variant.
 * 3. productId — USB product ID lookup; generation-level only.
 * 4. familyId — firmware FamilyID integer; generation-level only.
 * 5. libgpodGeneration — libgpod runtime string; generation-level only.
 *
 * @returns First successful match, or `null` if nothing resolves.
 */
export function resolveIpodModel(input: ResolveModelInput): IpodModel | null {
  // 1. modelNumStr — most specific variant lookup
  if (input.modelNumStr) {
    const model = identify({ from: 'sysinfo', modelNumStr: input.modelNumStr });
    if (model) return model;
  }

  // 2. serialNumber — variant lookup via last-3 suffix
  if (input.serialNumber && input.serialNumber.length >= 3) {
    const model = identify({ from: 'serial', serialNumber: input.serialNumber });
    if (model) return model;
  }

  // 3. productId — generation-only USB lookup
  if (input.productId) {
    const entry = lookupByUsbId(input.productId);
    if (entry) return synthesizeFromGeneration(entry.generation);
  }

  // 4. familyId — generation-only firmware integer lookup
  if (input.familyId !== null && input.familyId !== undefined && input.familyId > 0) {
    const genId = lookupByFamilyId(input.familyId);
    if (genId) return synthesizeFromGeneration(genId);
  }

  // 5. libgpodGeneration — generation-only reverse libgpod string lookup
  if (input.libgpodGeneration) {
    const genId = lookupByLibgpodName(input.libgpodGeneration);
    if (genId) return synthesizeFromGeneration(genId);
  }

  return null;
}
