/**
 * Per-kind assessment adapters.
 *
 * The ONE place where the iPod-vs-mass-storage kind distinction is allowed to
 * matter in the `device add` decision layer. Each adapter maps a concrete,
 * kind-specific assessment (`IpodIdentityAssessment` from the firmware/disk
 * cascade, or `MassStorageAssessment` from the preset resolver) onto the
 * kind-agnostic {@link DeviceAssessmentView} consumed by the M4
 * verification policy. M3 and M4 themselves stay kind-agnostic.
 *
 * iPod mapping (grounded in the real `ipod-identity.ts` types):
 *   - `firmwareInquiry` → `identityStore`: `'present' → 'present'`,
 *     `'missing' → 'missing'`, `'unwritable' → 'unwritable'`.
 *   - `model` → `hasIdentity` (`!!model`) and `displayName`
 *     (`model.displayName`, falling back to `'Unknown iPod'`).
 *   - `needsChecksum` → `identityStoreRequired` (checksum generations require
 *     SysInfoExtended on disk).
 *   - `model.unsupportedReason` → `unsupportedReason` (kind + headline).
 *
 * Mass-storage mapping:
 *   - `identityStore: 'not-applicable'`, `identityStoreRequired: false` —
 *     mass-storage has no firmware identity store, which is exactly what lets
 *     M4 stay free of kind branches.
 *   - `preset` → `hasIdentity` (`!!preset`); display from the preset.
 *
 * @module
 */

import type { IpodIdentityAssessment, MassStorageAssessment } from '@podkit/core';
import type { DeviceAssessmentView } from './verification-policy.js';

/**
 * Map an iPod identity assessment onto the kind-agnostic view.
 *
 * `userType` mirrors the user's `--type` assertion: when present, a missing
 * model still counts as a declared identity for display purposes, matching the
 * cascade's treatment of an explicit type as a signal. (M4's empty-identity
 * predicate keys off the claim, so this only affects `displayName`.)
 */
export function ipodAssessmentToView(
  assessment: IpodIdentityAssessment,
  opts: { userType?: string } = {}
): DeviceAssessmentView {
  const model = assessment.model;
  const displayName = model?.displayName ?? (opts.userType ? opts.userType : 'Unknown iPod');

  const identityStore: DeviceAssessmentView['identityStore'] = assessment.firmwareInquiry;

  const view: DeviceAssessmentView = {
    hasIdentity: !!model,
    displayName,
    identityStore,
    identityStoreRequired: assessment.needsChecksum,
    hasSysInfoModelNumber:
      assessment.sysInfoModelNumber !== null && assessment.sysInfoModelNumber !== undefined,
    ...(model?.unsupportedReason
      ? {
          unsupportedReason: {
            kind: model.unsupportedReason.kind,
            headline: model.unsupportedReason.headline,
            ...(model.unsupportedReason.docsUrl !== undefined
              ? { docsUrl: model.unsupportedReason.docsUrl }
              : {}),
            ...(model.unsupportedReason.details !== undefined
              ? { details: model.unsupportedReason.details }
              : {}),
          },
        }
      : {}),
  };
  return view;
}

/**
 * Map a mass-storage assessment onto the kind-agnostic view. Mass-storage
 * always reports `identityStore: 'not-applicable'` and
 * `identityStoreRequired: false`, so M4 needs no kind branch.
 */
export function massStorageAssessmentToView(
  assessment: MassStorageAssessment
): DeviceAssessmentView {
  // `MassStoragePreset` carries no `id` field — the id is the registry map key,
  // surfaced here as `identity.presetId`. Prefer the human product name, fall
  // back to the preset id.
  const preset = assessment.preset;
  const displayName: string =
    preset?.productName ?? assessment.identity.presetId ?? 'Mass-storage device';

  return {
    hasIdentity: !!preset,
    displayName,
    identityStore: 'not-applicable',
    identityStoreRequired: false,
    hasSysInfoModelNumber: false,
  };
}
