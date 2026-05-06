/**
 * iPod model identification types
 *
 * Foundational types for identifying a specific iPod model. These live in
 * `@podkit/device-types` (rather than `@podkit/devices-ipod`) so that
 * `@podkit/ipod-firmware` can reference them without a circular dependency —
 * `@podkit/devices-ipod` depends on `@podkit/ipod-firmware`, so the firmware
 * package cannot import back from devices-ipod.
 *
 * @module
 */

// ── ChecksumType ────────────────────────────────────────────────────────────

/** Checksum type required for iPod database */
export type IpodChecksumType = 'none' | 'hash58' | 'hash72' | 'hashAB';

// ── IpodGenerationId ────────────────────────────────────────────────────────

/**
 * Known iPod generation identifiers.
 * Maintained as a const array for runtime iteration and as a type alias for
 * compile-time autocomplete.
 */
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

// ── IpodModel ───────────────────────────────────────────────────────────────

/** How an IpodModel was identified */
export type IpodModelSource = 'usb' | 'sysinfo' | 'serial';

/**
 * Canonical representation of an identified iPod model.
 *
 * Built from a single identification source. USB discovery yields generation
 * and a generic displayName. SysInfo/serial yields richer data including
 * color, capacity, and model number.
 *
 * When `notSupportedReason` is present, the device was identified but podkit
 * cannot sync to it (libgpod unsupported, iTunes authentication required, or
 * Apple proprietary sync protocol). Callers should surface this to the user
 * rather than attempting a sync.
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
  /**
   * When present, this device is identified but cannot be synced by podkit.
   * Populated when `IpodGeneration.supported === false` or the USB product ID
   * appears in UNSUPPORTED_IPOD_PRODUCT_IDS.
   */
  readonly notSupportedReason?: string;
}
