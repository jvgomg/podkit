/**
 * Build a typed {@link ReadinessUnsupportedReason} for an unsupported iPod
 * generation / product ID. Centralised so `identify()` and `resolveIpodModel()`
 * (and any future cascade entry point) all produce the same shape with the
 * same `kind` discriminator and docs URL.
 *
 * Previously this logic lived in `@podkit/core` as
 * `makeUnsupportedReasonFromModel`, with the caller bridging from a bare
 * `IpodModel.notSupportedReason` string. Moving it down into the cascade
 * package lets every consumer read `model.unsupportedReason` directly —
 * single source of truth, no bridge function.
 *
 * @module
 */

import type { ReadinessUnsupportedReason, IpodGenerationId } from '@podkit/device-types';

/**
 * Canonical docs page describing podkit's supported devices. Hardcoded here
 * (rather than imported from `@podkit/core`'s `DOCS_URLS`) so the leaf
 * `@podkit/devices-ipod` package stays free of any `@podkit/core` import.
 *
 * The CLI / readiness pipeline still funnel through `@podkit/core`'s
 * `DOCS_URLS.supportedDevices` for direct docs links, but the resolver
 * embeds the URL on the payload so consumers can render it without
 * re-deriving it.
 */
const SUPPORTED_DEVICES_DOCS_URL = 'https://jvgomg.github.io/podkit/devices/supported-devices/';

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
 * `'ios-device'` for iPod touch generations (and the right bucket for any
 * iPhone/iPad routed through the iPod cascade in future). `'unsupported-device'`
 * for everything else podkit refuses to sync (nano 6G/7G, shuffle 3G/4G, …).
 */
function classifyUnsupportedKind(
  generationId: IpodGenerationId | undefined
): 'ios-device' | 'unsupported-device' {
  if (generationId && IOS_GENERATION_IDS.has(generationId)) return 'ios-device';
  return 'unsupported-device';
}

/**
 * Build the canonical {@link ReadinessUnsupportedReason} for an unsupported
 * generation/PID combination.
 *
 * `headline` is the table-derived sentence (`UNSUPPORTED_IPOD_PRODUCT_IDS`
 * entry or the iOS range fallback message); `generationId` (when known)
 * drives the `kind` discriminator.
 */
export function buildUnsupportedReason(
  headline: string,
  generationId: IpodGenerationId | undefined
): ReadinessUnsupportedReason {
  return {
    kind: classifyUnsupportedKind(generationId),
    headline,
    docsUrl: SUPPORTED_DEVICES_DOCS_URL,
  };
}
