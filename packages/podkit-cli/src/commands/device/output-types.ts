/**
 * Output shapes for the `podkit device` JSON contract.
 *
 * Every subcommand emits one of these `*Output` types. Consumers of
 * `--format json` (tests, downstream tools) discriminate on `success` and,
 * for the error variant, on `code` (see `./error-codes.ts`).
 */
import type { CliErrorOutput } from '../../errors.js';
import type { ReadinessUnsupportedReason } from '@podkit/core';
import type { CapabilitySource } from '@podkit/device-types';
import type { ConfigSource } from '../../config/resolve.js';
import type { DeviceErrorCode } from './error-codes.js';

/**
 * Union of every cascade-source literal that can appear in a
 * `DeviceInfoResolvedValue.source` field. Spans the CLI config cascade
 * (`ConfigSource` — `device`, `global`, `default`, etc.) and the
 * capability cascade (`CapabilitySource` — `preset`, `device-config`,
 * `firmware`, etc.). Tightening from `string` catches typos in test
 * assertions and downstream consumers at compile time.
 */
export type DeviceInfoSource = ConfigSource | CapabilitySource;

/** Serialised iPod model identity for JSON output */
export interface DeviceModelOutput {
  displayName: string;
  generationId: string;
  checksumType: string;
  source: string;
  modelNumber?: string;
  capacityGb?: number;
  color?: string;
}

// ── list ────────────────────────────────────────────────────────────────────

export interface DeviceListSuccess {
  success: true;
  devices: Array<{
    name: string;
    isDefault: boolean;
    connected: boolean;
    type: string;
    volumeUuid?: string;
    volumeName?: string;
    quality: string;
    qualitySource: string;
    audio: string;
    audioSource: string;
    video: string | null;
    videoSource: string;
    artwork: boolean | null;
    artworkSource: string;
    /** Resolved default music collection for this device (provenance-carrying). */
    defaultMusic: DefaultCollectionOutput;
    /** Resolved default video collection for this device (provenance-carrying). */
    defaultVideo: DefaultCollectionOutput;
  }>;
  defaultDevice?: string;
}

/**
 * The resolved default collection (music or video) for a device, surfaced in
 * `device info` / `device list` JSON. `kind` is the tri-state discriminant
 * (see {@link import('../../resolvers/default-collection-state.js').DefaultCollectionState}):
 *
 *   - `name`      — explicit per-device default that exists; `name` set, `source: 'device'`.
 *   - `missing`   — per-device default that is NOT in config; `name` set, `source: 'device'`.
 *   - `inherited` — inherited from the global default; `name` set, `source: 'global'`.
 *   - `none`      — device opted out (`false`); `name` absent, `source: 'device'`.
 *   - `empty`     — nothing set, no usable global default; `name`/`source` absent.
 */
export interface DefaultCollectionOutput {
  kind: 'name' | 'missing' | 'inherited' | 'none' | 'empty';
  /** Collection name — present for `name`, `missing`, and `inherited`. */
  name?: string;
  /** Provenance — `'device'` for name/missing/none, `'global'` for inherited. */
  source?: 'device' | 'global';
}

export type DeviceListErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceListOutput = DeviceListSuccess | DeviceListErrorOutput;

// ── add ─────────────────────────────────────────────────────────────────────

export interface DeviceAddSuccess {
  success: true;
  device?: {
    name: string;
    identifier: string;
    volumeName: string;
    volumeUuid: string;
    size: number;
    isMounted: boolean;
    mountPoint?: string;
    trackCount?: number;
    modelName?: string;
  };
  initialized?: boolean;
  saved?: boolean;
  configPath?: string;
  isDefault?: boolean;
  /**
   * Which verification tier ran (doc-045). `verified` = full live SCSI
   * cross-check + SysInfo (default); `trusted-disk` = `--no-verify` (on-disk
   * SysInfo trusted, no live check); `config-only` = `--no-validate` (pure
   * config write, no device read).
   */
  verification?: 'verified' | 'trusted-disk' | 'config-only';
}

export type DeviceAddErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceAddOutput = DeviceAddSuccess | DeviceAddErrorOutput;

// ── remove ──────────────────────────────────────────────────────────────────

export interface DeviceRemoveSuccess {
  success: true;
  device?: string;
  wasDefault?: boolean;
}

export type DeviceRemoveErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceRemoveOutput = DeviceRemoveSuccess | DeviceRemoveErrorOutput;

// ── info ────────────────────────────────────────────────────────────────────

/**
 * Cascade-resolved value with provenance — `{ value, source }` shape
 * mirrors `ResolvedValue<T>` (CLI ConfigSource) and `Resolved<T,
 * CapabilitySource>` (device-types CapabilitySource) at the JSON layer.
 *
 * `source` is the `DeviceInfoSource` union (`ConfigSource | CapabilitySource`)
 * — tight enough to catch consumer typos at compile time, wide enough to
 * span both cascades. JSON consumers can still switch on the string at
 * runtime since TypeScript erases unions to strings.
 */
export interface DeviceInfoResolvedValue<T> {
  value: T;
  source: DeviceInfoSource;
}

export interface DeviceInfoSuccess {
  success: true;
  device?: {
    name: string;
    volumeUuid?: string;
    volumeName?: string;
    transforms?: Record<string, unknown>;
    transformWarnings?: Array<{ type: string; message: string }>;
    isDefault: boolean;
  };
  /**
   * Resolved config + capability cascade for this device. Replaces the
   * top-level `quality` / `audioQuality` / `videoQuality` / `artwork`
   * fields on `device` (removed; consumers read `settings.audio.value`
   * etc instead). The optional `capabilities` sub-block carries the
   * mass-storage capability cascade; omitted for iPods.
   */
  settings?: {
    quality: DeviceInfoResolvedValue<string>;
    audio: DeviceInfoResolvedValue<string>;
    video: DeviceInfoResolvedValue<string | null>;
    artwork: DeviceInfoResolvedValue<boolean | null>;
    checkArtwork: DeviceInfoResolvedValue<boolean>;
    skipUpgrades: DeviceInfoResolvedValue<boolean>;
    encoding: DeviceInfoResolvedValue<string | undefined>;
    transferMode: DeviceInfoResolvedValue<string>;
    /** Resolved default music collection for this device (provenance-carrying). */
    defaultMusic: DefaultCollectionOutput;
    /** Resolved default video collection for this device (provenance-carrying). */
    defaultVideo: DefaultCollectionOutput;
    manufacturer?: DeviceInfoResolvedValue<string>;
    productName?: DeviceInfoResolvedValue<string>;
    capabilities?: {
      supportedAudioCodecs: DeviceInfoResolvedValue<string[]>;
      artworkSources: DeviceInfoResolvedValue<string[]>;
      artworkMaxResolution: DeviceInfoResolvedValue<number | null>;
      supportsVideo: DeviceInfoResolvedValue<boolean>;
      audioNormalization: DeviceInfoResolvedValue<string>;
      supportsAlbumArtistBrowsing: DeviceInfoResolvedValue<boolean>;
    };
  };
  status?: {
    mounted: boolean;
    mountPoint?: string;
    volumeUuid?: string;
    /**
     * Identity-cascade view of a mounted iPod — the same `IpodModel` the
     * device's capabilities were derived from. Absent for mass-storage
     * devices and for iPods whose database could not be opened.
     *
     * `generationId` is an `IpodGenerationId` (`nano_3g`, `shuffle_2g`); it
     * replaced a libgpod generation name (`nano_3`), which read `unknown`
     * for every device libgpod's tables miss.
     *
     * `number` / `capacity` are only populated when the cascade resolved the
     * model from an identity source that carries them (SysInfo or serial) —
     * a USB-only identification yields `null` / `0` rather than a guess.
     */
    model?: {
      name: string;
      number: string | null;
      generationId: string;
      capacity: number;
    };
    /**
     * Whether podkit can sync this device, plus the structured refusal when
     * it cannot. Derived solely from the resolved model's
     * `unsupportedReason`: a device podkit cannot identify at all fails the
     * open with `UNKNOWN_IPOD_MODEL` and never reaches this payload.
     */
    validation?: {
      supported: boolean;
      issues: Array<{
        type: string;
        message: string;
        suggestion?: string;
        reason?: string;
      }>;
    };
    storage?: {
      used: number;
      total: number;
      free: number;
      percentUsed: number;
    };
    musicCount?: number;
    videoCount?: number;
    syncTagCount?: number;
    syncTagComplete?: number;
    syncTagMissingArt?: number;
    syncTagMissingTransfer?: number;
    massStorageCapabilities?: {
      /**
       * Codecs podkit will use as device output on this device. Filtered:
       * MassStorageAdapter drops codecs whose tag-writing is unreliable
       * (today: wav, aiff). Consumers branching direct-copy vs transcode
       * should read this list.
       */
      supportedAudioCodecs: string[];
      /**
       * Unfiltered "device firmware can play" view — the preset's
       * supportedAudioCodecs after device-config / device-defaults overrides,
       * before podkit's output filter. Set out alongside
       * `supportedAudioCodecs` so users can see codecs the firmware accepts
       * but podkit transcodes before transfer.
       */
      firmwareSupportedAudioCodecs?: string[];
      artworkSources: string[];
      artworkMaxResolution: number | null;
      supportsVideo: boolean;
      audioNormalization: string;
      supportsAlbumArtistBrowsing: boolean;
    };
    databaseError?: string;
  };
  readiness?: {
    level: string;
    stages: Array<{
      stage: string;
      status: string;
      summary: string;
      details?: Record<string, unknown>;
    }>;
    model?: DeviceModelOutput;
    summary?: { trackCount: number; freeBytes?: number; totalBytes?: number };
    /** Structured rejection payload; only set when level === 'unsupported'. */
    unsupported?: ReadinessUnsupportedReason;
  };
}

export type DeviceInfoErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceInfoOutput = DeviceInfoSuccess | DeviceInfoErrorOutput;

// ── music ───────────────────────────────────────────────────────────────────

export interface DeviceMusicSuccess {
  success: true;
  tracks?: Array<Record<string, unknown>>;
  count?: number;
}

export type DeviceMusicErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceMusicOutput = DeviceMusicSuccess | DeviceMusicErrorOutput;

// ── video ───────────────────────────────────────────────────────────────────

export interface DeviceVideoSuccess {
  success: true;
  videos?: Array<Record<string, unknown>>;
  count?: number;
}

export type DeviceVideoErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceVideoOutput = DeviceVideoSuccess | DeviceVideoErrorOutput;

// ── clear ───────────────────────────────────────────────────────────────────

export interface DeviceClearSuccess {
  success: true;
  contentType?: 'music' | 'video' | 'all';
  tracksRemoved?: number;
  totalTracks?: number;
  totalSize?: number;
  dryRun?: boolean;
  fileDeleteErrors?: string[];
}

export type DeviceClearErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceClearOutput = DeviceClearSuccess | DeviceClearErrorOutput;

// ── reset ───────────────────────────────────────────────────────────────────

export interface DeviceResetSuccess {
  success: true;
  mountPoint?: string;
  modelName?: string;
  /** Track count that was on the device before the reset. */
  tracksRemoved?: number;
  /**
   * The name applied to the recreated database + disk label. Carried over from
   * the device's current name unless `--name` overrode it.
   */
  name?: string;
  /** Number of audio files brute-force removed from `iPod_Control/Music/F*`. */
  musicFilesRemoved?: number;
  /** Number of artwork files removed (`.ithmb` + `ArtworkDB`). */
  artworkFilesRemoved?: number;
  /** Total bytes freed by the on-disk content sweep. */
  bytesFreed?: number;
  /**
   * The OS volume label written during the disk-label pass. Differs from `name`
   * on lossy filesystems (FAT folds to uppercase + 11 chars).
   */
  diskLabel?: string;
  /** Human-readable warning when the disk label is a lossy rendering of the name. */
  diskWarning?: string;
  dryRun?: boolean;
}

export type DeviceResetErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceResetOutput = DeviceResetSuccess | DeviceResetErrorOutput;

// ── rename ──────────────────────────────────────────────────────────────────

export interface DeviceRenameSuccess {
  success: true;
  /** The name applied to the device. */
  name?: string;
  /** Mountpoint after the rename (re-resolved if the disk label moved it). */
  mountPoint?: string;
  /** Whether the iTunesDB master-playlist name was written. */
  databaseUpdated?: boolean;
  /** Whether the OS volume label was written. */
  diskUpdated?: boolean;
  /**
   * The disk label that was written. Differs from `name` on lossy filesystems
   * (FAT folds to uppercase + 11 chars).
   */
  diskLabel?: string;
  /** Human-readable warning when the disk label is a lossy rendering of the name. */
  diskWarning?: string;
}

export type DeviceRenameErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceRenameOutput = DeviceRenameSuccess | DeviceRenameErrorOutput;

// ── reset-artwork ───────────────────────────────────────────────────────────

export interface DeviceResetArtworkSuccess {
  success: true;
  tracksCleared?: number;
  totalTracks?: number;
  orphanedFilesRemoved?: number;
  dryRun?: boolean;
}

export type DeviceResetArtworkErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceResetArtworkOutput = DeviceResetArtworkSuccess | DeviceResetArtworkErrorOutput;

// ── eject ───────────────────────────────────────────────────────────────────

export interface DeviceEjectSuccess {
  success: true;
  device?: string;
  forced?: boolean;
}

export type DeviceEjectErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceEjectOutput = DeviceEjectSuccess | DeviceEjectErrorOutput;

// ── mount ───────────────────────────────────────────────────────────────────

export interface DeviceMountSuccess {
  success: true;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  requiresSudo?: boolean;
  assessment?: import('@podkit/core').DeviceAssessment;
}

export type DeviceMountErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceMountOutput = DeviceMountSuccess | DeviceMountErrorOutput;

// ── init ────────────────────────────────────────────────────────────────────

export interface DeviceInitSuccess {
  success: true;
  device?: string;
  mountPoint?: string;
  modelName?: string;
  readinessLevel?: string;
}

export type DeviceInitErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceInitOutput = DeviceInitSuccess | DeviceInitErrorOutput;

// ── set ─────────────────────────────────────────────────────────────────────

export interface DeviceSetSuccess {
  success: true;
  device?: string;
  updated?: Record<string, unknown>;
}

export type DeviceSetErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceSetOutput = DeviceSetSuccess | DeviceSetErrorOutput;

// ── default ─────────────────────────────────────────────────────────────────

export interface DeviceDefaultSuccess {
  success: true;
  device?: string;
  cleared?: boolean;
}

export type DeviceDefaultErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceDefaultOutput = DeviceDefaultSuccess | DeviceDefaultErrorOutput;

// ── scan ────────────────────────────────────────────────────────────────────

/**
 * USB descriptor surfaced on `device scan --format json` entries.
 *
 * Both fields are bare lower-case hex (no `0x` prefix) — the canonical
 * {@link UsbFingerprint} shape used throughout `@podkit/device-types`.
 */
export interface DeviceScanUsbDescriptor {
  /** USB vendor ID (bare lower-case hex, e.g. `"05ac"`). */
  vendorId: string;
  /** USB product ID (bare lower-case hex, e.g. `"1209"`). */
  productId: string;
  /** USB serial number string, when reported by the device. */
  serialNumber?: string;
}

export interface DeviceScanSuccess {
  success: true;
  /**
   * Recognised devices found on the host.
   *
   * Block-device-bound iPods (the historical case) carry `volumeUuid`,
   * `identifier`, `size`, `isMounted`, and optionally `mountPoint`. USB-only
   * iPods — devices that present an Apple-vendor USB descriptor without any
   * lsblk/diskutil mount path (e.g. iPod 6G in restore mode, FunctionFS
   * personas before they mount a backing image) — appear with
   * `usbOnly: true`, an absent `mountPoint`, and the `usbDescriptor` field
   * populated.
   */
  devices?: Array<{
    volumeName: string;
    /** Volume UUID — empty string for USB-only entries that have no filesystem. */
    volumeUuid: string;
    /** Device identifier (e.g. `"sdb1"`) — empty string for USB-only entries. */
    identifier: string;
    /** Device size in bytes — `0` for USB-only entries. */
    size: number;
    isMounted: boolean;
    mountPoint?: string;
    configuredAs?: string;
    /**
     * `true` when the entry was discovered via the USB walk and has no
     * mounted block device. Absent for block-device-bound entries. Consumers
     * can also check `mountPoint === undefined && identifier === ''`.
     */
    usbOnly?: boolean;
    /**
     * USB descriptor for the device. Populated for USB-only entries and may
     * also be populated for block-device entries when the USB descriptor was
     * available alongside the mount.
     */
    usbDescriptor?: DeviceScanUsbDescriptor;
    /** Best available model (deviceModel ?? usbModel) */
    model?: DeviceModelOutput;
    /**
     * Structured reason the device is not supported by podkit. Populated when
     * `classifyAsIpod` recognised the device as a known-unsupported iPod
     * family member (touch, iPhone, iPad, nano 6G/7G, shuffle 3G/4G) or when
     * the device is a vendor-recognised mass-storage DAP with no preset.
     *
     * Replaces the legacy bare-string `notSupportedReason` field; consumers
     * read `unsupportedReason.headline` for the single-line message and
     * `unsupportedReason.docsUrl` for the link.
     */
    unsupportedReason?: ReadinessUnsupportedReason;
    readiness?: {
      level: string;
      stages: Array<{
        stage: string;
        status: string;
        summary: string;
        details?: Record<string, unknown>;
      }>;
      summary?: {
        trackCount: number;
        freeBytes?: number;
        totalBytes?: number;
      };
    };
  }>;
  configuredDevices?: Array<{
    name: string;
    type: string;
    path?: string;
  }>;
}

export type DeviceScanErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceScanOutput = DeviceScanSuccess | DeviceScanErrorOutput;

// ── archive ───────────────────────────────────────────────────────────────────

export interface DeviceArchiveDumpSuccess {
  success: true;
  /** The raw-dump stage (stage 1). */
  stage: 'dump';
  /** Absolute path of the named archive root directory. */
  outputDir: string;
  /** Absolute path of the raw-dump tree inside `outputDir`. */
  rawDumpDir: string;
  /** Absolute path of the written `manifest.sha256`. */
  manifestPath: string;
  /** Count of files copied + hashed into the manifest. */
  fileCount: number;
  /** User-added entries skipped + reported (not copied). */
  foreign: string[];
  /** Files that could not be copied (recorded, not fatal). */
  failures: Array<{ path: string; error: string }>;
  /** Absolute path of the human-readable `report.md`. */
  reportMarkdownPath: string;
  /** Absolute path of the machine-readable `report.json`. */
  reportJsonPath: string;
}

export interface DeviceArchiveTransformSuccess {
  success: true;
  /** The device-free transform stage (stage 2). */
  stage: 'transform';
  /** Absolute path of the browsable archive root (`archive/`). */
  archiveDir: string;
  /** Count of tracks whose audio was extracted (lossless copy) into the archive. */
  written: number;
  /** Count of written tracks tagged via the ffmpeg fallback (a subset of `written`). */
  fallbackTaggedCount: number;
  /** Count of tracks with no audio body (null/empty ipodPath). */
  noAudioCount: number;
  /** Count of tracks extracted but carrying no decodable album artwork. */
  noArtworkCount: number;
  /** Count of tracks whose audio was missing or whose extraction (copy) failed. */
  failureCount: number;
  /** Count of tracks extracted but left untagged (taglib + ffmpeg both failed). */
  tagFailureCount: number;
  /** Absolute path of the emitted `README.md` identity card. */
  readmePath: string;
  /** Absolute path of the human-readable `report.md`. */
  reportMarkdownPath: string;
  /** Absolute path of the machine-readable `report.json`. */
  reportJsonPath: string;
}

export interface DeviceArchiveBothSuccess {
  success: true;
  /** The full happy path — raw dump followed by the transform (both stages). */
  stage: 'both';
  /** Absolute path of the named, self-contained output directory. */
  outputDir: string;
  /** Absolute path of the raw-dump tree (`raw dump/`) inside `outputDir`. */
  rawDumpDir: string;
  /** Absolute path of the written `manifest.sha256`. */
  manifestPath: string;
  /** Absolute path of the browsable archive root (`archive/`) inside `outputDir`. */
  archiveDir: string;
  /** Count of files copied + hashed into the manifest (stage 1). */
  fileCount: number;
  /** User-added entries skipped + reported (stage 1, not copied). */
  foreign: string[];
  /** Files that could not be copied (stage 1, recorded, not fatal). */
  dumpFailures: Array<{ path: string; error: string }>;
  /** Count of tracks whose audio was extracted (lossless copy) into the archive (stage 2). */
  written: number;
  /** Count of written tracks tagged via the ffmpeg fallback (stage 2, subset of `written`). */
  fallbackTaggedCount: number;
  /** Count of tracks with no audio body (stage 2, null/empty ipodPath). */
  noAudioCount: number;
  /** Count of tracks extracted but carrying no decodable album artwork (stage 2). */
  noArtworkCount: number;
  /** Count of tracks whose audio was missing or whose extraction (copy) failed (stage 2). */
  failureCount: number;
  /** Count of tracks extracted but left untagged (stage 2, taglib + ffmpeg both failed). */
  tagFailureCount: number;
  /** Absolute path of the emitted `README.md` identity card. */
  readmePath: string;
  /** Absolute path of the unified human-readable `report.md` (covers both stages). */
  reportMarkdownPath: string;
  /** Absolute path of the unified machine-readable `report.json` (covers both stages). */
  reportJsonPath: string;
}

export type DeviceArchiveErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceArchiveOutput =
  | DeviceArchiveDumpSuccess
  | DeviceArchiveTransformSuccess
  | DeviceArchiveBothSuccess
  | DeviceArchiveErrorOutput;

/**
 * Back-compat alias: stage-1 callers/tests refer to the dump-success shape as
 * `DeviceArchiveSuccess`.
 */
export type DeviceArchiveSuccess = DeviceArchiveDumpSuccess;
