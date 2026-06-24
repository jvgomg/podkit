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
 * The `device` input is accepted now so the call site and signature are stable,
 * but it is NOT consulted yet: resolution is global-only. A later task wires a
 * per-device default-collection layer into this module, at which point a
 * collection chosen because of a device default carries `source: 'device'`.
 */

import type {
  PodkitConfig,
  DeviceConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
} from '../config/types.js';
import type { CollectionType } from './types.js';
import { resolveMusicCollection, resolveVideoCollection } from './collection.js';

/**
 * Why a particular collection was chosen.
 *
 * - `'flag'`   — the user passed `-c <name>` and it matched.
 * - `'global'` — fell back to `config.defaults.music` / `config.defaults.video`.
 * - `'device'` — chosen by a per-device default. **Not emitted yet**; reserved
 *   for the per-device-default-collections feature so the union (and every
 *   downstream `switch`) is ready before that layer lands.
 * - `'none'`   — reserved for a future explicit "device opts out of a default"
 *   case. Not emitted yet.
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
   * Accepted now so the signature is stable, but **ignored this slice** —
   * resolution is global-only. A later task uses this to apply per-device
   * default collections.
   */
  device?: { name: string; config: DeviceConfig };
}

/**
 * Resolve the set of collections to act on.
 *
 * Cascade (global-only this slice):
 * 1. If `flag` is set, resolve it as an explicit name in the music and/or
 *    video namespace (filtered by `type`); matches carry `source: 'flag'`.
 *    A flag that matches nothing yields an empty result (no error) — the
 *    caller decides how to report "not found".
 * 2. Otherwise fall back to the global defaults
 *    (`config.defaults.music` / `config.defaults.video`, filtered by `type`);
 *    matches carry `source: 'global'`.
 *
 * @returns The resolved collections (possibly empty).
 */
export function resolveEffectiveCollections(input: ResolveCollectionsInput): {
  collections: EffectiveCollection[];
} {
  const { config, flag, type } = input;
  // NOTE: `input.device` is intentionally unused this slice (global-only).

  const collections: EffectiveCollection[] = [];

  // Provenance is purely a function of whether the user named a collection:
  // an explicit `-c` is 'flag', the configured global default is 'global'.
  const source: CollectionSource = flag ? 'flag' : 'global';

  if (!type || type === 'music') {
    // Delegates the explicit-name/default cascade to the single shared resolver.
    const result = resolveMusicCollection(config, flag);
    if (result.success) {
      collections.push({
        name: result.entity.name,
        type: 'music',
        config: result.entity.config,
        source,
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
        source,
      });
    }
  }

  return { collections };
}
