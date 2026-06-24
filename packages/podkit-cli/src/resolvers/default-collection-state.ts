/**
 * Default-collection state classifier (config-state display).
 *
 * The sibling {@link resolveEffectiveCollections} resolver deliberately emits
 * ONLY collections that will actually sync — it drops the device-`false`
 * ("none") case and the missing-name case, so it cannot be the source of truth
 * for *display* provenance. `device info` / `device list` need to render the
 * full tri-state of what a device's default music/video collection resolves to,
 * including the cases the sync resolver folds into "nothing":
 *
 *   - an explicit per-device collection name (exists)            → `name`
 *   - an explicit per-device name that is NOT in config          → `missing`
 *   - no per-device default, inherited from the global default   → `inherited`
 *   - an explicit device opt-out (`defaults.<type> === false`)   → `none`
 *   - nothing set and no usable global default                   → `empty`
 *
 * This module surfaces that tri-state. It does NOT reimplement collection
 * lookup — existence is decided by reusing
 * {@link resolveMusicCollection}/{@link resolveVideoCollection} (the same
 * single-collection resolvers the cascade delegates to). The cascade precedence
 * mirrors `resolveType` in `effective-collections.ts`; there is no `-c` flag
 * here because this is a config-state view, not a per-invocation decision.
 *
 * @module
 */

import type { PodkitConfig, DeviceConfig } from '../config/types.js';
import type { CollectionType } from './types.js';
import { resolveMusicCollection, resolveVideoCollection } from './collection.js';

/**
 * The resolved state of a single content type's default collection for a
 * device, with provenance. The discriminant `kind` mirrors the display
 * vocabulary so a renderer can switch on it directly.
 */
export type DefaultCollectionState =
  /** Device default names an existing collection. */
  | { kind: 'name'; name: string; source: 'device' }
  /** Device default names a collection that is NOT in config. */
  | { kind: 'missing'; name: string; source: 'device' }
  /** Device unset → fell through to the global default (which exists). */
  | { kind: 'inherited'; name: string; source: 'global' }
  /** Device explicitly opted out (`defaults.<type> === false`). */
  | { kind: 'none'; source: 'device' }
  /** Nothing set and no usable global default (unset or ghost global). */
  | { kind: 'empty' };

/**
 * Classify a device's default collection for `type`, surfacing the full
 * tri-state (including the cases the sync resolver drops).
 *
 * Cascade (precedence, first match wins) — mirrors `resolveType`:
 *   - `deviceConfig.defaults?.[type] === false` → `none`.
 *   - string default: exists → `name`; not in config → `missing`
 *     (an explicit device choice does NOT fall back to the global default).
 *   - undefined default: consult the global default — exists → `inherited`;
 *     unset or set-but-missing (ghost) → `empty`.
 *
 * @param config - The merged config (carries `music`/`video` + global defaults).
 * @param deviceConfig - The target device's config entry (may carry per-device
 *   `defaults.music` / `defaults.video`). `undefined`-safe via optional chaining.
 * @param type - Which content type's default to classify.
 */
export function classifyDeviceDefault(
  config: PodkitConfig,
  deviceConfig: DeviceConfig | undefined,
  type: CollectionType
): DefaultCollectionState {
  const resolve = type === 'music' ? resolveMusicCollection : resolveVideoCollection;
  const deviceDefault = deviceConfig?.defaults?.[type];

  // Explicit opt-out terminates the cascade before any lookup.
  if (deviceDefault === false) {
    return { kind: 'none', source: 'device' };
  }

  if (typeof deviceDefault === 'string') {
    // Device made an explicit choice: a miss does NOT fall back to the global
    // default — it surfaces as `missing` so the UI can flag the ghost name.
    const result = resolve(config, deviceDefault);
    return result.success
      ? { kind: 'name', name: result.entity.name, source: 'device' }
      : { kind: 'missing', name: deviceDefault, source: 'device' };
  }

  // No device default → consult the global default. A set-but-missing global
  // (ghost) collapses to `empty`, exactly as the sync resolver yields nothing.
  const result = resolve(config);
  return result.success
    ? { kind: 'inherited', name: result.entity.name, source: 'global' }
    : { kind: 'empty' };
}

/** Em dash used for the `empty` display state. */
const EMPTY_DISPLAY = '—';

/**
 * Map a {@link DefaultCollectionState} to its display string, matching the
 * bracket-for-inherited convention used across `device info` / `device list`:
 *
 *   - `name`      → `main`               (explicit per-device, exists)
 *   - `inherited` → `[shows]`            (inherited from the global default)
 *   - `none`      → `none`               (device opted out)
 *   - `missing`   → `ghost (not found)`  (per-device name not in config)
 *   - `empty`     → `—`                  (nothing set, no global default)
 */
export function formatDefaultCollection(state: DefaultCollectionState): string {
  switch (state.kind) {
    case 'name':
      return state.name;
    case 'inherited':
      return `[${state.name}]`;
    case 'none':
      return 'none';
    case 'missing':
      return `${state.name} (not found)`;
    case 'empty':
      return EMPTY_DISPLAY;
  }
}
