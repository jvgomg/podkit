/**
 * `device add` verification policy (M4).
 *
 * The single source of truth for the add-time scenario matrix. Given a
 * verification tier, the user's claim, a kind-agnostic device assessment view,
 * and a device-state view, it decides the {@link Outcome}: proceed, warn,
 * prompt, refuse, or error.
 *
 * Hard constraints (verified by tests + review):
 *   - **Pure** — no `fs`, no `process`, no subprocess. It may call other pure
 *     helpers (e.g. `isFilesystemUnsupportedHere`), but performs no effectful
 *     or async work.
 *   - **Total** — every (tier × claim × assessment × state) tuple yields an
 *     `Outcome`.
 *   - **Never throws** — refusals are returned as `Outcome` variants; the
 *     orchestrator maps each to a `CliError`.
 *   - **Kind-agnostic** — ZERO `if (isMassStorage)` branches. The iPod-vs-
 *     mass-storage distinction is erased by {@link DeviceAssessmentView}: a
 *     mass-storage device simply yields `identityStore: 'not-applicable'` with
 *     `identityStoreRequired: false`. The single kind dispatch lives in the
 *     per-kind adapters (`./assessment-views.ts`), never here.
 *
 * @module
 */

import { isFilesystemUnsupportedHere } from '@podkit/core';

// =============================================================================
// Input views
// =============================================================================

/**
 * Kind-agnostic view of a device's identity assessment. Both the iPod and the
 * mass-storage assessments reduce to this shape via the adapters in
 * `./assessment-views.ts` — that reduction is the *only* place kind matters.
 */
export interface DeviceAssessmentView {
  /**
   * Did the cascade resolve a model anchor (an actual device identity)? For
   * iPods this is a resolved {@link IpodModel}; for mass-storage, a resolved
   * preset.
   */
  readonly hasIdentity: boolean;
  /** Human display name for the device, for messages. */
  readonly displayName: string;
  /**
   * State of the on-disk identity store (iPod SysInfoExtended). Mass-storage
   * devices have no such store and always report `'not-applicable'`.
   */
  readonly identityStore: 'present' | 'missing' | 'unwritable' | 'not-applicable';
  /**
   * Whether sync for this device *requires* the identity store on disk
   * (checksum-based iPod generations). Mass-storage is always `false`.
   */
  readonly identityStoreRequired: boolean;
  /**
   * Set when the device is a known-unsupported generation/kind (iOS device,
   * refused vendor, …). Surfaces the canonical refusal copy.
   */
  readonly unsupportedReason?: {
    readonly kind: string;
    readonly headline: string;
    readonly docsUrl?: string;
    readonly details?: string[];
  };
  /**
   * Whether the classic SysInfo `ModelNumStr` was read off disk. Even when
   * the model lookup fails (model is null), having an on-disk ModelNumStr is
   * a meaningful identity signal — mirrors `isIdentityFullyEmpty`'s
   * `hasSysInfoModelNumber` check in the core predicate.
   * Mass-storage devices always report `false`.
   */
  readonly hasSysInfoModelNumber: boolean;
}

/** Kind-agnostic view of the device's OS-level state. */
export interface DeviceStateView {
  /** Did the OS locate the device (path/uuid resolved to a real volume)? */
  readonly located: boolean;
  /** Volume UUID, when the OS surfaced one. Empty/undefined = none. */
  readonly volumeUuid?: string;
  /** Filesystem string, when known. */
  readonly filesystem?: string | null;
  /** `process.platform`-style platform string (e.g. `'linux'`, `'darwin'`). */
  readonly platform: string;
  /** Mount point / probe path, when known — threaded into refusal payloads. */
  readonly path?: string;
  /** Live SCSI/USB cross-check result against the on-disk identity. */
  readonly crossCheck: 'pass' | 'mismatch' | 'skipped';
  /** Detail string for a `mismatch` (e.g. the diagnostic summary). */
  readonly crossCheckDetail?: string;
}

import type { VerificationTier, DeviceClaim } from './resolve-add-request.js';

// =============================================================================
// Outcome
// =============================================================================

/**
 * The decision M4 returns. The orchestrator maps each refusal/error kind to a
 * `DeviceErrorCodes` value + `CliError`, and each prompt kind to a confirm
 * flow.
 */
export type Outcome =
  | { readonly kind: 'proceed' }
  | {
      readonly kind: 'proceed-with-warning';
      readonly warning: 'partial-identity' | 'path-only-no-uuid' | 'empty-identity-forced';
    }
  | { readonly kind: 'prompt-write-sie'; readonly mountPoint: string }
  | {
      readonly kind: 'prompt-unsupported';
      readonly reason: { readonly kind: string; readonly headline: string };
    }
  | { readonly kind: 'error-mismatch'; readonly detail?: string }
  | { readonly kind: 'error-missing-sysinfo'; readonly hint: 'run-doctor' }
  | { readonly kind: 'refuse-no-uuid'; readonly path?: string; readonly filesystem?: string | null }
  | {
      readonly kind: 'refuse-hfsplus-on-linux';
      readonly filesystem?: string | null;
      readonly path?: string;
    }
  | { readonly kind: 'refuse-empty-identity'; readonly path?: string }
  /**
   * Config-inject completeness failure. Part of the doc-045 `Outcome` union for
   * the orchestrator's error mapping, but NOT produced by
   * {@link decideAddOutcome}: M3's `resolveAddRequest` validates config-inject
   * completeness statically (throwing `EMPTY_IDENTITY`) before M4 runs, and the
   * `config-inject` tier short-circuits to `proceed`. Retained so the union is
   * exhaustive over the spec's error space.
   */
  | { readonly kind: 'error-incomplete-injection'; readonly missing: string[] };

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Replicates `isIdentityFullyEmpty` semantics over the kind-agnostic view: an
 * identity is fully empty when the cascade resolved no model, the device has
 * no usable identity store, and the user did not declare a type.
 *
 * Mirrors the core `isIdentityFullyEmpty` predicate (which keys off the iPod
 * assessment). Kept here in view-terms so M4 stays kind-agnostic: a declared
 * type (`claim.mode === 'declared'`) is a user assertion that counts as a
 * signal, exactly as `userType` does in the core predicate.
 */
function isIdentityFullyEmptyView(
  assessment: DeviceAssessmentView | null,
  claim: DeviceClaim
): boolean {
  if (claim.mode === 'declared') return false;
  if (!assessment) return true;
  if (assessment.hasIdentity) return false;
  // Classic SysInfo ModelNumStr on disk is a meaningful identity signal even
  // when the model lookup failed — mirrors the core `isIdentityFullyEmpty`
  // predicate's `hasSysInfoModelNumber` check.
  if (assessment.hasSysInfoModelNumber) return false;
  // No model and no declared type. `present`/`missing` on an iPod both carry a
  // real signal (SysInfoExtended on disk, or a USB fingerprint complete enough
  // to write it) — not empty. `unwritable` means no such signal. Mass-storage
  // ('not-applicable') only reaches this line when undeclared AND its preset
  // failed to resolve (hasIdentity === false) — a genuinely empty config row,
  // since mass-storage has no fallback identity store.
  return assessment.identityStore === 'unwritable' || assessment.identityStore === 'not-applicable';
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Decide the add outcome. Pure, total, never throws.
 *
 * `forced` reflects the user's `--force` flag (orthogonal to the tier/claim,
 * so it is a separate scalar rather than folded into a sum type). It only
 * relaxes the no-UUID and empty-identity refusals into warnings; every other
 * branch is independent of it. Defaults to `false` so the doc-045 §A scenario
 * matrix can be written against the 4-argument form.
 *
 * Decision ordering — refusals first, then prompts, then warnings, then
 * proceed:
 *   1. `config-inject` → proceed (completeness already validated in M3).
 *   2. HFS+-on-Linux refusal.
 *   3. No-UUID refusal (unless `forced` → warn `path-only-no-uuid`).
 *   4. Empty-identity refusal (unless `forced` or declared claim → warn
 *      `empty-identity-forced`).
 *   5. trust-disk + identity store missing/unwritable + required →
 *      `error-missing-sysinfo`.
 *   6. verify + identity store missing → `prompt-write-sie`.
 *   7. verify + cross-check mismatch → `error-mismatch`.
 *   8. unsupported reason → `prompt-unsupported`.
 *   9. partial identity (no model anchor) → warn `partial-identity`.
 *  10. else → proceed.
 */
export function decideAddOutcome(
  tier: VerificationTier,
  claim: DeviceClaim,
  assessment: DeviceAssessmentView | null,
  deviceState: DeviceStateView,
  forced = false
): Outcome {
  if (tier === 'config-inject') {
    return { kind: 'proceed' };
  }

  const fs = deviceState.filesystem;
  const path = deviceState.path;

  // 2. HFS+ on Linux.
  if (isFilesystemUnsupportedHere(fs ?? undefined, deviceState.platform)) {
    return {
      kind: 'refuse-hfsplus-on-linux',
      ...(fs !== undefined ? { filesystem: fs } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  // 3. No usable volume UUID.
  const hasUuid = !!deviceState.volumeUuid && !deviceState.volumeUuid.startsWith('manual-');
  if (!hasUuid) {
    if (forced) {
      return { kind: 'proceed-with-warning', warning: 'path-only-no-uuid' };
    }
    return {
      kind: 'refuse-no-uuid',
      ...(path !== undefined ? { path } : {}),
      ...(fs !== undefined ? { filesystem: fs } : {}),
    };
  }

  // 4. Empty identity.
  if (isIdentityFullyEmptyView(assessment, claim)) {
    if (forced || claim.mode === 'declared') {
      return { kind: 'proceed-with-warning', warning: 'empty-identity-forced' };
    }
    return { kind: 'refuse-empty-identity', ...(path !== undefined ? { path } : {}) };
  }

  // 5. trust-disk requires a present, ready on-disk identity store.
  if (tier === 'trust-disk') {
    if (
      assessment &&
      assessment.identityStoreRequired &&
      (assessment.identityStore === 'missing' || assessment.identityStore === 'unwritable')
    ) {
      return { kind: 'error-missing-sysinfo', hint: 'run-doctor' };
    }
  }

  // 6. verify + identity store missing → offer to write it.
  if (tier === 'verify' && assessment && assessment.identityStore === 'missing') {
    return { kind: 'prompt-write-sie', mountPoint: path ?? '' };
  }

  // 7. verify + cross-check mismatch → error.
  if (tier === 'verify' && deviceState.crossCheck === 'mismatch') {
    return {
      kind: 'error-mismatch',
      ...(deviceState.crossCheckDetail !== undefined
        ? { detail: deviceState.crossCheckDetail }
        : {}),
    };
  }

  // 8. Known-unsupported generation/kind → prompt.
  if (assessment?.unsupportedReason) {
    return { kind: 'prompt-unsupported', reason: assessment.unsupportedReason };
  }

  // 9. Partial identity: some signal but no model anchor.
  if (assessment && !assessment.hasIdentity) {
    return { kind: 'proceed-with-warning', warning: 'partial-identity' };
  }

  // 10. All clear.
  return { kind: 'proceed' };
}
