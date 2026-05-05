/**
 * Core types for @podkit/devices-ipod
 *
 * @module
 */

// ── ChecksumType ────────────────────────────────────────────────────────────

/** Checksum type required for iPod database */
export type IpodChecksumType = 'none' | 'hash58' | 'hash72' | 'hashAB';

// ── IpodGenerationId: literal + runtime union ───────────────────────────────
//
// Pattern: const array + literal type alias + relaxed companion.
// The const array enables runtime iteration; the type alias provides
// compile-time autocomplete; the 'Like' variant accepts user-defined strings
// without losing autocomplete for built-ins.

export const IPOD_GENERATION_IDS = [
  'classic_1g',
  'classic_2g',
  'classic_3g',
  'classic_4g',
  'photo',
  'video_5g',
  'video_5_5g',
  'classic_6g',
  'classic_7g',
  'mini_1g',
  'mini_2g',
  'nano_1g',
  'nano_2g',
  'nano_3g',
  'nano_4g',
  'nano_5g',
  'nano_6g',
  'nano_7g',
  'shuffle_1g',
  'shuffle_2g',
  'shuffle_3g',
  'shuffle_4g',
  'touch_1g',
  'touch_2g',
  'touch_3g',
  'touch_4g',
  'touch_5g',
  'touch_6g',
  'touch_7g',
] as const;

/** iPod generation identifier */
export type IpodGenerationId = (typeof IPOD_GENERATION_IDS)[number];

/** Allow user-defined generation IDs without losing autocomplete for built-ins */
export type IpodGenerationIdLike = IpodGenerationId | (string & {});

// ── IpodGeneration ──────────────────────────────────────────────────────────

/** Generation metadata */
export interface IpodGeneration {
  id: IpodGenerationId;
  displayName: string;
  checksumType: IpodChecksumType;
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
   * 0 indicates no artwork support (no colour screen).
   */
  artworkMaxResolution: number;
}

// ── IpodModel ───────────────────────────────────────────────────────────────

/** How an IpodModel was identified */
export type IpodModelSource = 'usb' | 'sysinfo' | 'serial';

/**
 * Canonical representation of an identified iPod model.
 *
 * Built from a single identification source. USB discovery yields generation
 * and a generic displayName. SysInfo/serial yields richer data including
 * color, capacity, and model number.
 */
export interface IpodModel {
  /** Best available human-readable name (e.g., "iPod nano 4GB Silver (2nd Generation)") */
  readonly displayName: string;
  /** iPod generation identifier */
  readonly generationId: IpodGenerationId;
  /** Checksum type required for this generation's iTunesDB */
  readonly checksumType: IpodChecksumType;
  /** Apple model number without prefix, e.g., "A426" (present for sysinfo/serial sources) */
  readonly modelNumber?: string;
  /** Storage capacity in GB (present for sysinfo/serial sources) */
  readonly capacityGb?: number;
  /** Device color (present for sysinfo/serial sources) */
  readonly color?: string;
  /** How this model was identified */
  readonly source: IpodModelSource;
}

// ── IpodModelVariant ────────────────────────────────────────────────────────

/** Model entry from serial suffix lookup -- specific variant (color, capacity) */
export interface IpodModelVariant {
  modelNumber: string; // e.g., "B261" (without M prefix)
  displayName: string; // e.g., "iPod nano 8GB Black (3rd Generation)"
  generation: IpodGenerationId;
  capacityGb?: number;
  color?: string;
}
