/**
 * Output shapes for the `podkit device` JSON contract.
 *
 * Every subcommand emits one of these `*Output` types. Consumers of
 * `--format json` (tests, downstream tools) discriminate on `success` and,
 * for the error variant, on `code` (see `./error-codes.ts`).
 */
import type { CliErrorOutput } from '../../errors.js';
import type { DeviceErrorCode } from './error-codes.js';

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
  }>;
  defaultDevice?: string;
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

export interface DeviceInfoSuccess {
  success: true;
  device?: {
    name: string;
    volumeUuid?: string;
    volumeName?: string;
    quality?: string;
    audioQuality?: string;
    videoQuality?: string;
    artwork?: boolean;
    transforms?: Record<string, unknown>;
    transformWarnings?: Array<{ type: string; message: string }>;
    isDefault: boolean;
  };
  status?: {
    mounted: boolean;
    mountPoint?: string;
    volumeUuid?: string;
    model?: {
      name: string;
      number: string | null;
      generation: string;
      capacity: number;
    };
    capabilities?: {
      music: boolean;
      artwork: boolean;
      video: boolean;
      podcast: boolean;
    };
    validation?: {
      supported: boolean;
      issues: Array<{
        type: string;
        message: string;
        suggestion?: string;
        reason?: string;
      }>;
      warnings: Array<{
        type: string;
        message: string;
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
      supportedAudioCodecs: string[];
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
  tracksRemoved?: number;
  dryRun?: boolean;
}

export type DeviceResetErrorOutput = CliErrorOutput & { code: DeviceErrorCode };
export type DeviceResetOutput = DeviceResetSuccess | DeviceResetErrorOutput;

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
     * Reason the device is not supported by podkit. Populated when
     * `classifyAsIpod` recognised the device as a known-unsupported iPod
     * family member (touch, iPhone, iPad, nano 6G/7G, shuffle 3G/4G).
     */
    notSupportedReason?: string;
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
