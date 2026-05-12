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

export interface DeviceScanSuccess {
  success: true;
  devices?: Array<{
    volumeName: string;
    volumeUuid: string;
    identifier: string;
    size: number;
    isMounted: boolean;
    mountPoint?: string;
    configuredAs?: string;
    /** Best available model (deviceModel ?? usbModel) */
    model?: DeviceModelOutput;
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
