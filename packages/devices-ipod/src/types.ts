/**
 * Core types for @podkit/devices-ipod
 *
 * @module
 */

// ── IpodChecksumType, IpodGenerationId, IpodModelSource, IpodModel ──────────
//
// These foundational types live in `@podkit/device-types` so that
// `@podkit/ipod-firmware` can reference them without a circular dependency.
// Re-exported here for backward compatibility.

export type {
  IpodChecksumType,
  IpodGenerationId,
  IpodGenerationIdLike,
  IpodModelSource,
  IpodModel,
} from '@podkit/device-types';
export { IPOD_GENERATION_IDS } from '@podkit/device-types';

// ── IpodGeneration ──────────────────────────────────────────────────────────

import type { IpodGenerationId, IpodChecksumType } from '@podkit/device-types';

/** Generation metadata */
export interface IpodGeneration {
  id: IpodGenerationId;
  /**
   * Marketing family name without the generation marker.
   * Examples: `"iPod"`, `"iPod Video"`, `"iPod Classic"`, `"iPod nano"`,
   * `"iPod Photo"`. Combined with {@link ordinal} via `formatIpodLabel`
   * to produce the human-readable display string. See ADR-020.
   */
  family: string;
  /**
   * Generation number as written in the marketing name. `5.5` for the
   * iPod Video 5.5G. `null` for entries that never carried a generation
   * marker (`photo`). See ADR-020.
   */
  ordinal: number | null;
  checksumType: IpodChecksumType;
  /**
   * Whether libgpod 0.8.x can read and write the iTunesDB for this generation.
   * `false` means the device can be detected and identified, but podkit cannot
   * sync to it (libgpod has no ipod_info_table entry for it).
   *
   * Generations where this is `false`:
   * - nano_7g: not in libgpod's ipod_info_table
   * - touch_5g/6g/7g: not in libgpod's ipod_info_table
   * - nano_6g: in libgpod's table but uses an iTunesDB format libgpod cannot write
   * - shuffle_3g/4g: in libgpod's table but requires iTunes authentication
   */
  supported: boolean;
  /**
   * Whether this generation natively decodes ALAC (and therefore also
   * tolerates WAV / AIFF). Earlier iPods (1G–3G), Mini 1G, Nano 1G/2G/6G
   * and all Shuffles do not.
   */
  supportsAlac: boolean;
  /**
   * Whether this generation has video playback hardware. Devices without
   * video have no video transcoding pipeline and the sync engine will
   * skip video collections entirely.
   */
  supportsVideo: boolean;
  /**
   * Maximum artwork display dimension in pixels (square — actual stored
   * artwork may be rectangular but the longer edge is bounded by this).
   * `null` indicates no artwork support (no colour screen).
   */
  artworkMaxResolution: number | null;
}

// ── IpodModelVariant ────────────────────────────────────────────────────────

/** Model entry from serial suffix lookup -- specific variant (color, capacity) */
export interface IpodModelVariant {
  modelNumber: string; // e.g., "B261" (without M prefix)
  generation: IpodGenerationId;
  capacityGb?: number;
  color?: string;
  /** Variant tag (e.g., "U2", "2015"). Inserted by formatIpodLabel between family and capacity. */
  variant?: string;
}
