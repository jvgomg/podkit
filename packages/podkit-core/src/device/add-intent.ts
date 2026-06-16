/**
 * Cross-kind add-intent helper.
 *
 * Walks the USB bus via {@link discoverConnectedDevices}, then asks the
 * per-kind {@link describeAddIntent} dispatcher "how would the user add
 * this?" for each discovered device.
 *
 * The CLI uses this when the user runs `podkit device add` but no
 * configured iPod is found: instead of a bare "no iPod found" error, it
 * walks the bus and renders kind-supplied "you have an Echo Mini
 * attached — add it with…" hints.
 *
 * Post-TASK-427 the per-kind dispatcher (in `./discovery.ts`, sibling to
 * `displayFor`) replaces the old `DeviceProvider.describeAddIntent`
 * provider-driven surface — adding a new device kind now means adding
 * one helper to that dispatcher, no provider registration required.
 *
 * @module
 */

import type { DeviceAddIntent } from '@podkit/device-types';
import {
  describeAddIntent,
  discoverConnectedDevices,
  type DiscoverConnectedDevicesOptions,
} from './discovery.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Public options for {@link suggestAddIntents} — narrows
 * {@link DiscoverConnectedDevicesOptions} to the fields a CLI hint-helper
 * caller actually needs. The full union (including the `enumerate` /
 * `classify` test seams) is available via {@link SuggestAddIntentsTestOptions}
 * for in-package unit tests that need to stub the USB walk.
 *
 * Pass `massStoragePresets: mergedPresets(config)` so user-defined
 * `[presets.X]` DAPs surface intents alongside built-ins.
 */
export type SuggestAddIntentsOptions = Pick<
  DiscoverConnectedDevicesOptions,
  'deviceManager' | 'massStoragePresets'
>;

/**
 * Internal options shape — equals the underlying
 * {@link DiscoveredConnectedDevicesOptions} so unit tests can inject
 * `enumerate` / `classify` seams. NOT part of the public package API;
 * production callers should use {@link SuggestAddIntentsOptions}.
 *
 * @internal
 */
export type SuggestAddIntentsTestOptions = DiscoverConnectedDevicesOptions;

// =============================================================================
// suggestAddIntents
// =============================================================================

/**
 * Build CLI add-intents for every attached device whose kind can describe
 * how to add it.
 *
 * Calls {@link describeAddIntent} for each discovered device; collects
 * non-null intents. Order mirrors `discoverConnectedDevices` (block-matched
 * first, then USB-only second), so the CLI can render the first intent or
 * surface the full list.
 */
export async function suggestAddIntents(
  opts: SuggestAddIntentsOptions | SuggestAddIntentsTestOptions
): Promise<DeviceAddIntent[]> {
  const discovered = await discoverConnectedDevices(opts as DiscoverConnectedDevicesOptions);
  const intents: DeviceAddIntent[] = [];
  for (const d of discovered) {
    const intent = describeAddIntent(d);
    if (intent) intents.push(intent);
  }
  return intents;
}
