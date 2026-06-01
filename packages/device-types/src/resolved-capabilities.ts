/**
 * Provenance-tracked device capabilities.
 *
 * Mirrors {@link DeviceCapabilities} field-for-field, but each value is a
 * `{ value, source }` pair so consumers (`device info`, the doctor, JSON
 * outputs) can show where each capability came from in the inheritance
 * chain — preset, env-var defaults, per-device config, firmware overlay,
 * etc.
 *
 * Lives in `device-types` because both `@podkit/devices-mass-storage`
 * (preset → overrides merge) and `@podkit/core` (cross-cutting
 * resolveCapabilities) emit this shape, and neither package can depend
 * on the other.
 *
 * @module
 */

import type { Resolved } from './resolved.js';
import type {
  AudioCodec,
  AudioContainer,
  AudioNormalizationMode,
  DeviceArtworkSource,
} from './capabilities.js';

/**
 * Where a resolved capability value came from. Single union spanning
 * every layer any device kind exposes; individual `getCapabilities`
 * implementations narrow to the subset they emit.
 */
export type CapabilitySource =
  /** Hardcoded fallback when every layer is empty. Rare in practice. */
  | 'default'
  /** Mass-storage preset (post-extends resolution at `definePreset` time). */
  | 'preset'
  /** iPod generation table (table-derived defaults). */
  | 'generation'
  /** iPod firmware overlay (USB-inquired SCSI capabilities). */
  | 'firmware'
  /** Global device defaults (env-var driven, e.g. `PODKIT_ARTWORK_SOURCES`). */
  | 'device-defaults'
  /** Per-device TOML overrides (e.g. `[devices.<n>] artworkMaxResolution = 96`). */
  | 'device-config';

/**
 * Capabilities resolved with provenance per field. Structurally
 * parallel to {@link DeviceCapabilities}; the only difference is each
 * field is wrapped in {@link Resolved}.
 *
 * Project to bare `DeviceCapabilities` via `projectResolved` when a
 * consumer doesn't care about provenance (most of the sync pipeline
 * falls into this bucket today).
 */
export interface ResolvedDeviceCapabilities {
  artworkSources: Resolved<DeviceArtworkSource[], CapabilitySource>;
  /**
   * `null` means "device has no artwork display" — distinct from "value
   * not supplied". Mirrors `DeviceCapabilities.artworkMaxResolution`.
   */
  artworkMaxResolution: Resolved<number | null, CapabilitySource>;
  supportedAudioCodecs: Resolved<AudioCodec[], CapabilitySource>;
  /**
   * Container constraints are a sparse map — left optional so a layer
   * that doesn't supply them doesn't force consumers to render an empty
   * provenance entry. When present, the whole sub-object inherits one
   * source label rather than tracking per-codec-container provenance.
   */
  containerConstraints?: Resolved<Partial<Record<AudioCodec, AudioContainer[]>>, CapabilitySource>;
  supportsVideo: Resolved<boolean, CapabilitySource>;
  audioNormalization: Resolved<AudioNormalizationMode, CapabilitySource>;
  supportsAlbumArtistBrowsing: Resolved<boolean, CapabilitySource>;
}
