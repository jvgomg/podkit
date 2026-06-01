/**
 * Inheritance-resolution primitive shared across podkit.
 *
 * The codebase has several parallel inheritance walks — sync settings
 * (`config/resolve.ts`), device capabilities (`getCapabilities`), and
 * content paths (`open-device.ts`) — that all follow the same shape:
 * walk an ordered list of layers from highest-priority to lowest, pick
 * the first defined value, and ideally remember *which* layer it came
 * from so consumers (`device info`, the doctor, sync-decisions JSON) can
 * display inheritance markers.
 *
 * This module is the one home for the `{ value, source }` pair and the
 * generic `resolveChain` helper. Each domain (config, capabilities, …)
 * narrows the `Source` type parameter to its own union of layer names.
 *
 * Lives in `device-types` because it's the lowest package in the
 * monorepo dep graph — `devices-mass-storage`, `devices-ipod`,
 * `podkit-core`, and the CLI all depend on it, so they can all share
 * the same primitive without pulling in cross-cutting deps. The runtime
 * function is a pure generic; it has no domain knowledge.
 *
 * @module
 */

/**
 * A value paired with the layer it came from.
 *
 * The `source` type parameter is narrowed per domain — sync settings use
 * `'default' | 'global' | 'device' | …`, capabilities use
 * `'preset' | 'preset-extends' | 'device-defaults' | 'device-config' | 'firmware'`,
 * etc. Keeping `Source extends string` lets the wrapper stay one type
 * across the codebase while each call site retains exhaustiveness.
 */
export interface Resolved<T, Source extends string = string> {
  value: T;
  source: Source;
}

/**
 * One layer of a resolution chain — a candidate value paired with its
 * source label. `value: undefined` means "this layer didn't contribute";
 * the chain falls through to the next layer.
 *
 * Layers are passed to `resolveChain` in priority order (highest first),
 * matching how the config resolver and capability resolver each list
 * their layers (`device-config first`, then `device-defaults`, then
 * `preset`, etc.).
 */
export interface ResolutionLayer<T, Source extends string> {
  /** The layer's candidate value, or `undefined` when this layer is empty. */
  value: T | undefined;
  /** Label identifying this layer for provenance display. */
  source: Source;
}

/**
 * Walk an ordered list of layers and return the first defined value with
 * its source label. Falls through to `defaultValue`/`defaultSource` when
 * every layer is undefined.
 *
 * Pure: no side effects, no allocation beyond the returned object.
 *
 * @example — sync settings
 * ```ts
 * type SyncSource = 'cli' | 'device' | 'global' | 'default';
 * const transferMode = resolveChain<TransferMode, SyncSource>(
 *   [
 *     { value: cliFlag, source: 'cli' },
 *     { value: deviceConfig.transferMode, source: 'device' },
 *     { value: globalConfig.transferMode, source: 'global' },
 *   ],
 *   'fast',
 *   'default'
 * );
 * // → { value: 'optimized', source: 'cli' } (or whichever layer hit first)
 * ```
 *
 * @example — capabilities
 * ```ts
 * type CapSource = 'device-config' | 'device-defaults' | 'preset';
 * const artworkMax = resolveChain<number, CapSource>(
 *   [
 *     { value: deviceConfig.artworkMaxResolution, source: 'device-config' },
 *     { value: envDefaults.artworkMaxResolution, source: 'device-defaults' },
 *     { value: preset.artworkMaxResolution, source: 'preset' },
 *   ],
 *   500,
 *   'preset'
 * );
 * ```
 */
export function resolveChain<T, Source extends string>(
  layers: ReadonlyArray<ResolutionLayer<T, Source>>,
  defaultValue: T,
  defaultSource: Source
): Resolved<T, Source> {
  for (const layer of layers) {
    if (layer.value !== undefined) {
      return { value: layer.value, source: layer.source };
    }
  }
  return { value: defaultValue, source: defaultSource };
}

/**
 * Variant of {@link resolveChain} for settings whose absence has no
 * intrinsic default — every defined layer wins, but a fully-empty chain
 * resolves to `undefined` with the supplied `emptySource` label
 * (typically `'unset'` or a domain-specific marker).
 *
 * Useful for optional sync settings like `customBitrate` where "nothing
 * set anywhere" is a legitimate state, distinct from "set to zero".
 */
export function resolveChainOptional<T, Source extends string>(
  layers: ReadonlyArray<ResolutionLayer<T, Source>>,
  emptySource: Source
): Resolved<T | undefined, Source> {
  for (const layer of layers) {
    if (layer.value !== undefined) {
      return { value: layer.value, source: layer.source };
    }
  }
  return { value: undefined, source: emptySource };
}

/**
 * Project a record of `Resolved<T, S>` fields down to a plain record of
 * `T` values — useful as a `.values` shim for call sites that consume the
 * resolved capabilities/settings as bare data and don't care about
 * provenance (e.g. the sync engine reading the resolved preset values).
 *
 * Avoids hand-written `{ artworkMaxResolution: r.artworkMaxResolution.value, … }`
 * fan-outs every time a caller needs the bare shape.
 */
export function projectResolved<R extends Record<string, Resolved<unknown, string>>>(
  resolved: R
): { [K in keyof R]: R[K] extends Resolved<infer V, string> ? V : never } {
  const out = {} as { [K in keyof R]: R[K] extends Resolved<infer V, string> ? V : never };
  for (const key of Object.keys(resolved) as Array<keyof R>) {
    // The cast is local to the projection helper; consumers see the
    // statically-typed result above.
    const entry = resolved[key];
    if (entry !== undefined) {
      (out as Record<string, unknown>)[key as string] = entry.value;
    }
  }
  return out;
}
