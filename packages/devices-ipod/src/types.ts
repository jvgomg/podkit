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

/**
 * How much of a generation podkit can safely touch.
 *
 * A total order: `none` ⊂ `read-only` ⊂ `syncable`. There is no
 * writable-but-unreadable device — libgpod reads before it writes — so a
 * single tri-state faithfully models the domain (two booleans would admit an
 * illegal readable-false / writable-true state).
 *
 * - `syncable`  — podkit can read and write the device's database.
 * - `read-only` — podkit can read (metadata, artwork) but not write; the
 *   write path needs something libgpod cannot produce (e.g. an iTunes
 *   authentication hash) or is untested.
 * - `none`      — nothing to touch: no mountable database, or the device
 *   uses a protocol podkit cannot speak (iOS, not-in-libgpod).
 */
export type DeviceAccess = 'syncable' | 'read-only' | 'none';

/**
 * Provenance of a support claim: confirmed on real hardware or inferred from
 * libgpod tables / reverse-engineering. This is documentation confidence
 * only — it gates no behavior.
 */
export type SupportVerification = 'hardware' | 'inferred';

/**
 * A generation's support record.
 *
 * `access` gates behavior (the tri-state total order above). `verified` gates
 * NOTHING — it is provenance for docs and CLI display, letting a contributor
 * who plugs in a real device flip `inferred → hardware` (and correct `access`
 * if reality disagrees) in one place.
 */
export interface GenerationSupport {
  access: DeviceAccess;
  verified: SupportVerification;
  /** Human-readable rationale for the access tier — surfaced in docs / CLI. */
  note?: string;
}

/**
 * One serializable row of the generation support matrix.
 *
 * The flat, display-ready projection of a generation's {@link GenerationSupport}
 * that docs and the CLI consume without reaching into the generation table.
 */
export interface SupportMatrixRow {
  generation: IpodGenerationId;
  displayName: string;
  access: DeviceAccess;
  verified: SupportVerification;
  note?: string;
}

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
   * What podkit can do with this generation, on two orthogonal axes.
   *
   * `support.access` gates behavior — the tri-state total order
   * `none ⊂ read-only ⊂ syncable`. `support.verified` gates NOTHING: it is
   * provenance (hardware-confirmed vs inferred from libgpod tables) that
   * feeds documentation and CLI display only.
   *
   * Notable non-`syncable` generations:
   * - shuffle_3g/4g: `read-only` — readable iTunesDB, but writing a valid
   *   iTunesSD needs an iTunes authentication hash libgpod cannot produce.
   * - nano_6g: `read-only` — write is a format libgpod cannot produce; read
   *   is untested (non-destructive, so permitted).
   * - nano_7g, touch/iPhone/iPad, not-in-libgpod: `none` — no mountable
   *   database or a protocol podkit cannot speak.
   */
  support: GenerationSupport;
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
