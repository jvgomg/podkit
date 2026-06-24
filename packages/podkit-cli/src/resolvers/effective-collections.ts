/**
 * Effective collection resolution
 *
 * Single, provenance-carrying cascade for deciding *which* collections a
 * command (today: `sync`) should act on, given the CLI flags and config.
 *
 * This is the multi-type counterpart to {@link resolveMusicCollection} /
 * {@link resolveVideoCollection} in `./collection.ts`: those resolve one
 * collection of a known type and return a typed error when the lookup fails;
 * this resolves the *set* of collections to operate on across both namespaces
 * and silently omits anything that does not resolve (the sync command renders
 * the "nothing to sync" message downstream from the empty result).
 *
 * The cascade itself is not reimplemented here — name/default lookup delegates
 * to `resolveMusicCollection`/`resolveVideoCollection`, so there is exactly one
 * implementation of "pick this collection (explicit name, else configured
 * default)". This module's job is the *shape* of the decision (both types,
 * type filter, provenance), not the lookup.
 *
 * The `-c` flag is a WHOLESALE override: when set, the device and global
 * defaults are not consulted at all — only collections matching that flag name
 * are returned, each `source: 'flag'`. The per-device cascade applies ONLY in
 * the no-flag branch, independently per content type (music, video):
 *
 *   - device default `false`   → that type contributes nothing (`'none'`).
 *   - device default `<name>`  → that exact collection if it exists
 *     (`source: 'device'`); if it does not exist, nothing — the device made an
 *     explicit choice, so we do NOT fall back to the global default.
 *   - device default absent    → fall through to the global default
 *     (`source: 'global'`), exactly as before.
 *
 * When `device` is `undefined` (raw/unconfigured device), neither type has a
 * device default, so behaviour is byte-identical to the prior global-only path.
 */

import type {
  PodkitConfig,
  DeviceConfig,
  CollectionDefault,
  MusicCollectionConfig,
  VideoCollectionConfig,
} from '../config/types.js';
import type { CollectionType, ResolutionResult } from './types.js';
import { resolveMusicCollection, resolveVideoCollection } from './collection.js';

/**
 * Why a particular collection was chosen.
 *
 * - `'flag'`   — the user passed `-c <name>` and it matched.
 * - `'global'` — fell back to `config.defaults.music` / `config.defaults.video`.
 * - `'device'` — chosen by a per-device default (`device.config.defaults.*`
 *   named an existing collection).
 * - `'none'`   — a device explicitly opted out of a type (device default
 *   `false`). No collection is emitted for this case, so `'none'` never
 *   appears on an {@link EffectiveCollection}; it is the conceptual provenance
 *   a display layer reports for "this device syncs nothing of this type".
 */
export type CollectionSource = 'flag' | 'global' | 'device' | 'none';

/**
 * A collection the caller should act on, plus the provenance of why it was
 * chosen. Structurally a superset of `ResolvedCollection` (sync.ts) — the
 * extra `source` field is additive.
 */
export interface EffectiveCollection {
  name: string;
  type: CollectionType;
  config: MusicCollectionConfig | VideoCollectionConfig;
  /** Provenance of why this collection was chosen. */
  source: CollectionSource;
}

/**
 * Inputs to {@link resolveEffectiveCollections}.
 */
export interface ResolveCollectionsInput {
  /** The merged config. */
  config: PodkitConfig;
  /** The `-c` collection name, if the user passed one. */
  flag?: string;
  /** The `-t` type filter. `undefined` means "both music and video". */
  type?: CollectionType;
  /**
   * The resolved target device, if any.
   *
   * Consulted only in the no-flag branch: `device.config.defaults.{music,video}`
   * overrides the global default per content type (string default → that named
   * collection with `source: 'device'`; `false` → suppress that type entirely;
   * absent → fall through to the global default). `undefined` device means no
   * per-device layer, i.e. pure global behaviour.
   */
  device?: { name: string; config: DeviceConfig };
}

/**
 * Per-type lookup signature: resolve a named collection (or the global default
 * when `name` is omitted) of a single content type. Both
 * {@link resolveMusicCollection} and {@link resolveVideoCollection} match this.
 */
type PerTypeResolver = (
  config: PodkitConfig,
  name?: string
) => ResolutionResult<MusicCollectionConfig | VideoCollectionConfig>;

/**
 * Resolve one content type's effective collection, applying the per-device
 * cascade. Returns the collection (with provenance) or `undefined` when this
 * type contributes nothing.
 *
 * No-flag cascade for a single type:
 *   - device default `false`   → `undefined` (provenance `'none'`; nothing emitted).
 *   - device default `<name>`  → resolve that exact name; emit with `'device'`
 *     if it exists, else `undefined` (NO fallback to the global default —
 *     the device made an explicit choice).
 *   - device default absent     → resolve the global default; emit with
 *     `'global'` if it exists, else `undefined`.
 */
function resolveType(
  config: PodkitConfig,
  type: CollectionType,
  deviceDefault: CollectionDefault | undefined,
  resolve: PerTypeResolver
): EffectiveCollection | undefined {
  // Explicit "none" terminates the cascade before any lookup — the device
  // suppresses this type regardless of the global default.
  if (deviceDefault === false) {
    return undefined;
  }

  if (typeof deviceDefault === 'string') {
    // Device made an explicit choice: resolve exactly that name. A miss does
    // NOT fall back to the global default (mirrors the ghost-default behaviour
    // of yielding empty).
    const result = resolve(config, deviceDefault);
    if (result.success) {
      return { name: result.entity.name, type, config: result.entity.config, source: 'device' };
    }
    return undefined;
  }

  // No device default for this type → global default, exactly as before.
  const result = resolve(config);
  if (result.success) {
    return { name: result.entity.name, type, config: result.entity.config, source: 'global' };
  }
  return undefined;
}

/**
 * Resolve the set of collections to act on.
 *
 * Cascade:
 * 1. If `flag` is set, resolve it as an explicit name in the music and/or
 *    video namespace (filtered by `type`); matches carry `source: 'flag'`.
 *    A flag that matches nothing yields an empty result (no error) — the
 *    caller decides how to report "not found". Device and global defaults are
 *    NOT consulted: the flag is a wholesale override.
 * 2. Otherwise apply the per-device cascade independently per content type
 *    (filtered by `type`): a device string default → `source: 'device'`, a
 *    device `false` → nothing, an absent device default → the global default
 *    with `source: 'global'`. See {@link resolveType}.
 *
 * @returns The resolved collections (possibly empty).
 */
export function resolveEffectiveCollections(input: ResolveCollectionsInput): {
  collections: EffectiveCollection[];
} {
  const { config, flag, type, device } = input;

  const collections: EffectiveCollection[] = [];

  if (flag) {
    // Flag branch: wholesale override. Resolve the explicit name in each
    // requested namespace; provenance is always 'flag'. Device/global defaults
    // are deliberately not consulted here. A falsy flag (undefined or '') is
    // treated as "no flag" — matching the original inline resolver's truthy
    // check — so it cannot enter this branch with empty-string provenance.
    if (!type || type === 'music') {
      const result = resolveMusicCollection(config, flag);
      if (result.success) {
        collections.push({
          name: result.entity.name,
          type: 'music',
          config: result.entity.config,
          source: 'flag',
        });
      }
    }
    if (!type || type === 'video') {
      const result = resolveVideoCollection(config, flag);
      if (result.success) {
        collections.push({
          name: result.entity.name,
          type: 'video',
          config: result.entity.config,
          source: 'flag',
        });
      }
    }
    return { collections };
  }

  // No-flag branch: per-device cascade, independent per content type.
  const deviceDefaults = device?.config.defaults;

  if (!type || type === 'music') {
    const resolved = resolveType(config, 'music', deviceDefaults?.music, resolveMusicCollection);
    if (resolved) collections.push(resolved);
  }
  if (!type || type === 'video') {
    const resolved = resolveType(config, 'video', deviceDefaults?.video, resolveVideoCollection);
    if (resolved) collections.push(resolved);
  }

  return { collections };
}
