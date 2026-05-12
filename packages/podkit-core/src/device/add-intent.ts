/**
 * Cross-provider add-intent helper.
 *
 * Walks the USB bus via {@link enumerateConnectedDevices}, then asks each
 * provider that recognised a device "how would the user add this?" by
 * calling its optional {@link DeviceProvider.describeAddIntent} method.
 *
 * The CLI uses this when the user runs `podkit device add` but no
 * configured iPod is found: instead of a bare "no iPod found" error, it
 * walks the bus and renders provider-supplied "you have an Echo Mini
 * attached — add it with…" hints.
 *
 * Provider-driven by design: adding a new device family means implementing
 * `describeAddIntent` on its provider; the CLI helper here needs no change.
 *
 * @module
 */

import type { DeviceAddIntent, DeviceProvider, DiscoveredContext } from '@podkit/device-types';
import type { EnumeratedUsbDevice } from './usb-enumeration.js';
import { enumerateConnectedDevices } from './enumeration.js';

// =============================================================================
// Types
// =============================================================================

export interface SuggestAddIntentsOptions {
  /** Providers to ask, in priority order. Mirrors {@link enumerateConnectedDevices}. */
  providers: DeviceProvider[];
  /**
   * Optional override for the USB walk (for testing). Same shape as
   * {@link enumerateConnectedDevices}; passed through verbatim.
   */
  walk?: () => Promise<EnumeratedUsbDevice[]>;
}

// =============================================================================
// suggestAddIntents
// =============================================================================

/**
 * Build CLI add-intents for every attached device whose provider can
 * describe how to add it.
 *
 * Calls `provider.describeAddIntent(identity, discovered)` for each
 * enumerated device that:
 *   1. Was matched by a provider (identity present)
 *   2. The provider implements `describeAddIntent`
 *   3. The provider's intent is non-null (some matches don't yield a
 *      meaningful suggestion)
 *
 * Order mirrors `enumerateConnectedDevices` — which mirrors the OS USB
 * walk order. The CLI typically renders the first intent, but the full
 * list is returned for callers that want to surface all options.
 */
export async function suggestAddIntents(
  opts: SuggestAddIntentsOptions
): Promise<DeviceAddIntent[]> {
  const enumerated = await enumerateConnectedDevices(opts);
  const intents: DeviceAddIntent[] = [];

  for (const device of enumerated) {
    if (!device.identity || !device.matchedProviderId) continue;
    const provider = opts.providers.find((p) => p.id === device.matchedProviderId);
    if (!provider?.describeAddIntent) continue;

    const ctx: DiscoveredContext = {};
    if (device.discovered.diskIdentifier !== undefined) {
      ctx.diskIdentifier = device.discovered.diskIdentifier;
    }
    const intent = provider.describeAddIntent(device.identity, ctx);
    if (intent) intents.push(intent);
  }

  return intents;
}
