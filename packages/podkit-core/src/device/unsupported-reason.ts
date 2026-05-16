/**
 * Single source of truth bridge from cascade-resolved iPod identity to the
 * typed `ReadinessUnsupportedReason` payload.
 *
 * The cascade resolver (`resolveIpodModel`) attaches `notSupportedReason: string`
 * to its result when the generation is one podkit refuses to operate on
 * (touch_*, nano_6, nano_7, shuffle_3g/4g, iPhone/iPad/Apple Watch). The
 * readiness pipeline + CLI commands consume the typed `ReadinessUnsupportedReason`
 * payload (carries a `kind` discriminator, headline, indented detail lines, and
 * a docs URL).
 *
 * This module owns the conversion. Every command that gates on unsupported-device
 * status (`podkit device add`, `device scan`, `device info`, `sync`, `doctor`)
 * imports and calls one of:
 *
 * - {@link makeUnsupportedReasonFromModel}: convert a cascade-resolved `IpodModel`
 *   (when its `notSupportedReason` is set).
 * - {@link makeUnsupportedReasonFromAssessment}: convenience wrapper that
 *   threads `IpodIdentityAssessment.model` through the same conversion.
 *
 * No command re-derives the check. No user-facing copy mentions `libgpod`.
 *
 * @module
 */

import type { IpodGenerationId, IpodModel } from '@podkit/devices-ipod';
import { DOCS_URLS } from '../docs-urls.js';
import type { ReadinessUnsupportedReason } from './readiness/types.js';
import type { IpodIdentityAssessment } from './ipod-identity.js';

// =============================================================================
// Generation classification
// =============================================================================

/**
 * Generation ids that are iOS-based sync targets (no disk mode). Used to pick
 * the `'ios-device'` discriminator on `ReadinessUnsupportedReason.kind`.
 */
const IOS_GENERATION_IDS = new Set<IpodGenerationId>([
  'touch_1g',
  'touch_2g',
  'touch_3g',
  'touch_4g',
  'touch_5g',
  'touch_6g',
  'touch_7g',
]);

/**
 * Return the canonical `ReadinessUnsupportedReason.kind` for a generation id.
 *
 * `'ios-device'` for iPod touch generations (and is the right bucket for any
 * iPhone/iPad routed through the iPod cascade in future). `'unsupported-device'`
 * for everything else podkit refuses to sync (nano 6G/7G, shuffle 3G/4G, …).
 */
function classifyUnsupportedKind(
  generationId: IpodGenerationId | undefined
): 'ios-device' | 'unsupported-device' {
  if (generationId && IOS_GENERATION_IDS.has(generationId)) return 'ios-device';
  return 'unsupported-device';
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Convert a cascade-resolved `IpodModel` to a typed
 * {@link ReadinessUnsupportedReason}, or `undefined` if the model is supported.
 *
 * Wraps {@link IpodModel.notSupportedReason} as the headline, picks the
 * `kind` discriminator based on the generation id, and attaches the
 * canonical docs URL. Callers route this through the same channels the
 * readiness pipeline uses (`ReadinessResult.unsupported`, `CliError.details`).
 *
 * Returns `undefined` for supported models — callers can chain
 * `if (reason) refuse(reason);` without nullish-checking the model first.
 */
export function makeUnsupportedReasonFromModel(
  model: IpodModel | null | undefined
): ReadinessUnsupportedReason | undefined {
  if (!model?.notSupportedReason) return undefined;
  return {
    kind: classifyUnsupportedKind(model.generationId),
    headline: model.notSupportedReason,
    docsUrl: DOCS_URLS.supportedDevices,
  };
}

/**
 * Convenience wrapper around {@link makeUnsupportedReasonFromModel} that
 * accepts an {@link IpodIdentityAssessment}.
 *
 * `device add`, `sync`, `device info`, and `doctor` all call
 * `assessIpodIdentity` first; this lets them feed the result straight through
 * without unpacking `.model` at each call site.
 */
export function makeUnsupportedReasonFromAssessment(
  assessment: IpodIdentityAssessment | null | undefined
): ReadinessUnsupportedReason | undefined {
  return makeUnsupportedReasonFromModel(assessment?.model);
}
