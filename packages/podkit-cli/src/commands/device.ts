/**
 * Device command - manage devices
 *
 * Provides subcommands for device management and content operations.
 *
 * @example
 * ```bash
 * podkit device                       # list configured devices
 * podkit device scan                  # scan for connected iPods
 * podkit device add -d <name>         # detect and add iPod
 * podkit device remove -d <name>      # remove from config
 * podkit device info [-d name]        # config + live status
 * podkit device music [-d name]       # list music on device
 * podkit device video [-d name]       # list video on device
 * podkit device clear [-d name]       # clear all content
 * podkit device reset [-d name]       # reset database
 * podkit device eject [-d name]       # eject device
 * podkit device mount [-d name]       # mount device
 * podkit device init [-d name]        # initialize iPod database
 * ```
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, Option } from 'commander';
import { confirm, confirmNo } from '../utils/confirm.js';
import { existsSync, statSync, statfsSync } from '../utils/fs.js';
import { getContext } from '../context.js';
import { CliError, runAction } from '../errors.js';
import {
  addDevice,
  updateDevice,
  removeDevice,
  setDefaultDevice,
  DEFAULT_CONFIG_PATH,
} from '../config/index.js';
import {
  QUALITY_PRESETS,
  VIDEO_QUALITY_PRESETS,
  ENCODING_MODES,
  DEVICE_TYPES,
  AUDIO_CODECS,
  ARTWORK_SOURCES,
} from '../config/index.js';
import { OUTPUT_FORMATS } from '../output/formatters.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
} from '../device-resolver.js';
import type { DeviceConfig } from '../config/index.js';
import type { ResolvedDevice } from '../device-resolver.js';
import {
  type DisplayTrack,
  type FieldName,
  AVAILABLE_FIELDS,
  DEFAULT_FIELDS,
  parseFields,
  formatTable,
  formatCsv,
  computeStats,
  formatStatsText,
  aggregateAlbums,
  formatAlbumsTable,
  aggregateArtists,
  formatArtistsTable,
  escapeCsv,
} from './display-utils.js';
import { OutputContext, formatBytes, formatNumber, bold } from '../output/index.js';
import { identify } from '@podkit/devices-ipod';
import {
  formatGeneration,
  validateDevice,
  formatValidationMessages,
  DEFAULT_LOSSY_STACK,
  DEFAULT_LOSSLESS_STACK,
  readSysInfoExtended,
  ensureSysInfoExtended,
  resolveUsbDeviceFromPath,
  getChecksumTypeByModelNumber,
} from '@podkit/core';
import type { SysInfoExtendedResult } from '@podkit/core';
import {
  openDevice,
  isMassStorageDevice,
  getDeviceTypeDisplayName,
  getDeviceLabel,
} from './open-device.js';
import type { DeviceAssessment, IFlashEvidence } from '@podkit/core';
import type { DeviceValidationResult } from '@podkit/core';
import type { DeviceTrack, IpodTrack } from '@podkit/core';
import { STAGE_DISPLAY_NAMES } from '@podkit/core';
import type { ReadinessResult, ReadinessStageResult, ReadinessLevel } from '@podkit/core';
import {
  stageMarker,
  formatReadinessLevel,
  printReadinessSummary,
  collectReadinessIssues,
  printIssues,
} from './readiness-display.js';

// =============================================================================
// Shared utilities
// =============================================================================

// Re-export formatting utilities for backward compatibility
export { formatBytes, formatNumber } from '../output/index.js';
export { formatGeneration } from '@podkit/core';

/**
 * Outcome of attempting to ensure the iPod has identity data.
 *
 * - `result`: parsed SysInfoExtended (existing or freshly read), or null if
 *   the device only has classic SysInfo and we didn't need to write anything.
 * - `abort`: true if the device-add flow should stop. Set when the iPod has
 *   no identity files, USB is unreachable or the user declined the prompt.
 *   Caller is responsible for printing nothing further and returning early.
 */
interface SysInfoAttempt {
  result: SysInfoExtendedResult | null;
  abort: boolean;
}

/**
 * Ensure an iPod has SysInfoExtended when required, or at least SysInfo.
 *
 * Skip path: if SysInfoExtended already exists, return it. If only SysInfo
 * exists and the device doesn't require checksums, that's sufficient.
 *
 * Upgrade path: if only SysInfo exists but the device requires checksums
 * (hash58+), SysInfoExtended is mandatory — prompt the user to read it
 * from USB firmware.
 *
 * Gate path: if neither file is present, prompt the user (default no) before
 * reading SysInfoExtended from USB firmware and writing it to the device.
 * `--yes` and JSON output bypass the prompt. If the user declines or USB
 * cannot be reached, signal abort so the caller stops the device-add flow.
 */
async function attemptSysInfoExtended(
  mountPoint: string,
  out: OutputContext,
  opts: { autoConfirm: boolean }
): Promise<SysInfoAttempt> {
  // 1. SysInfoExtended already present and parseable → done.
  const resolveModel = (sn: string) => identify({ from: 'serial', serialNumber: sn }) ?? undefined;
  const existing = readSysInfoExtended(mountPoint, resolveModel);
  if (existing?.present && (existing.model || existing.firewireGuid)) {
    return { result: existing, abort: false };
  }

  // 2. Classic SysInfo present — check if SysInfoExtended is needed.
  const sysInfoPath = join(mountPoint, 'iPod_Control', 'Device', 'SysInfo');
  if (existsSync(sysInfoPath)) {
    // Read the ModelNumStr to determine if this device needs checksums
    let needsChecksum = false;
    let modelNumber: string | undefined;
    try {
      const content = readFileSync(sysInfoPath, 'utf-8');
      const match = content.match(/ModelNumStr:\s*(\S+)/);
      if (match?.[1]) {
        modelNumber = match[1];
        const checksumType = getChecksumTypeByModelNumber(modelNumber);
        needsChecksum =
          checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';
      }
    } catch {
      // Can't read SysInfo — fall through to USB read
    }

    if (!needsChecksum) {
      // Non-checksum device: SysInfo alone is sufficient.
      return { result: null, abort: false };
    }

    // Checksum device with only SysInfo — SysInfoExtended is required.
    // Try to read it from USB.
    const usbInfo = await resolveUsbDeviceFromPath(mountPoint);
    if (!usbInfo?.bus || !usbInfo?.devnum) {
      out.newline();
      out.print(
        `Warning: This iPod (${modelNumber ?? 'unknown model'}) requires SysInfoExtended for database checksums,` +
          ' but USB device could not be located to read it.'
      );
      out.print(
        '  Run `podkit doctor --repair sysinfo-extended` when the device is connected via USB.'
      );
      return { result: null, abort: false };
    }

    const skipPrompt = opts.autoConfirm || out.isJson;
    if (!skipPrompt) {
      out.newline();
      out.print(
        `This iPod (${modelNumber ?? 'unknown'}) requires SysInfoExtended for database checksums.`
      );
      out.print('Without it, the iPod will reject the database and show "No Music" after syncing.');
      out.print(
        'podkit can read this from the iPod firmware via USB and save\n' +
          'iPod_Control/Device/SysInfoExtended to the device.'
      );
      out.newline();
      const proceed = await confirmNo('Read SysInfoExtended from USB?');
      if (!proceed) {
        out.print('Skipped. You can run `podkit doctor --repair sysinfo-extended` later.');
        return { result: null, abort: false };
      }
    }

    return readSysInfoExtendedFromUsb(
      mountPoint,
      { busNumber: usbInfo.bus!, deviceAddress: usbInfo.devnum! },
      out
    );
  }

  // 3. Neither file present. Resolve USB before prompting — without it we
  //    can't perform the read. If USB is unreachable (e.g. --path fixture,
  //    offline reattach), silently skip: the downstream init step will
  //    create classic SysInfo if the database is also missing.
  const usbInfo = await resolveUsbDeviceFromPath(mountPoint);
  if (!usbInfo?.bus || !usbInfo?.devnum) {
    out.verbose1('No SysInfo or SysInfoExtended on device, and USB device could not be located.');
    return { result: null, abort: false };
  }

  // 4. Prompt the user.
  const skipPrompt = opts.autoConfirm || out.isJson;
  if (!skipPrompt) {
    out.newline();
    out.print('This iPod has no identity files (SysInfo / SysInfoExtended).');
    out.print("podkit needs one to recognize the device's model, serial, and FireWireGUID.");
    out.print(
      'It will read this from the iPod firmware via USB and save\n' +
        'iPod_Control/Device/SysInfoExtended to the device.'
    );
    out.newline();
    const proceed = await confirmNo('Continue?');
    if (!proceed) {
      out.print('Cancelled. Device not added.');
      return { result: null, abort: true };
    }
  }

  // 5. Read from USB and write the file.
  return readSysInfoExtendedFromUsb(
    mountPoint,
    { busNumber: usbInfo.bus, deviceAddress: usbInfo.devnum },
    out
  );
}

/** Shared helper: read SysInfoExtended from USB and write to device. */
async function readSysInfoExtendedFromUsb(
  mountPoint: string,
  usbInfo: { busNumber: number; deviceAddress: number },
  out: OutputContext
): Promise<SysInfoAttempt> {
  try {
    const resolveModel = (sn: string) =>
      identify({ from: 'serial', serialNumber: sn }) ?? undefined;
    const result = await ensureSysInfoExtended(
      mountPoint,
      {
        busNumber: usbInfo.busNumber,
        deviceAddress: usbInfo.deviceAddress,
      },
      undefined,
      resolveModel
    );

    if (!result.present) {
      out.error(`Failed to read SysInfoExtended from USB: ${result.error ?? 'unknown error'}`);
      return { result: null, abort: true };
    }

    const model = result.model?.displayName ?? 'Unknown iPod';
    out.print(`Device identified via USB: ${model}`);
    return { result, abort: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out.error(`SysInfoExtended read failed: ${message}`);
    return { result: null, abort: true };
  }
}

/**
 * Get storage information for a mount point.
 */
export function getStorageInfo(
  mountpoint: string
): { total: number; free: number; used: number } | null {
  try {
    const stats = statfsSync(mountpoint);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    return { total, free, used };
  } catch {
    return null;
  }
}

// isMassStorageDevice, getDeviceTypeDisplayName, getDeviceLabel imported from ./open-device.js

/**
 * Map a DeviceTrack (from any adapter) to a DisplayTrack for output formatting.
 */
function deviceTrackToDisplayTrack(t: DeviceTrack): DisplayTrack {
  return {
    title: t.title || 'Unknown Title',
    artist: t.artist || 'Unknown Artist',
    album: t.album || 'Unknown Album',
    duration: t.duration,
    albumArtist: t.albumArtist || undefined,
    genre: t.genre || undefined,
    year: t.year && t.year > 0 ? t.year : undefined,
    trackNumber: t.trackNumber && t.trackNumber > 0 ? t.trackNumber : undefined,
    discNumber: t.discNumber && t.discNumber > 0 ? t.discNumber : undefined,
    filePath: t.filePath || undefined,
    artwork: t.hasArtwork,
    compilation: t.compilation,
    format: parseFormat(t.filetype),
    bitrate: t.bitrate > 0 ? t.bitrate : undefined,
    normalization: t.normalization,
    syncTag: t.syncTag,
    hasArtwork: t.hasArtwork,
  };
}

/**
 * Map a DeviceTrack to a full JSON object (mass-storage variant).
 *
 * Similar to ipodTrackToFullJson but only includes fields available
 * on DeviceTrack (no iPod-specific fields like timeAdded, playCount, etc.)
 */
function deviceTrackToFullJson(t: DeviceTrack): Record<string, unknown> {
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumArtist: t.albumArtist || null,
    genre: t.genre || null,
    composer: t.composer || null,
    comment: t.comment || null,
    trackNumber: t.trackNumber ?? null,
    discNumber: t.discNumber ?? null,
    year: t.year ?? null,
    compilation: t.compilation,
    duration: t.duration,
    bitrate: t.bitrate,
    sampleRate: t.sampleRate,
    size: t.size,
    filetype: t.filetype || null,
    mediaType: t.mediaType,
    filePath: t.filePath,
    hasArtwork: t.hasArtwork,
    hasFile: t.hasFile,
    normalization: t.normalization
      ? {
          gainDb: t.normalization.trackGain ?? null,
          soundcheck: t.normalization.soundcheckValue ?? null,
          source: t.normalization.source,
        }
      : null,
  };
}

/**
 * Format a terse sync tag consistency summary for device info display.
 *
 * Only shows non-zero categories. If all tracks are consistent, shows just a checkmark.
 * If there are no tracks, returns just "0 tracks".
 */
export function formatSyncTagSummary(
  trackCount: number,
  complete: number,
  missingArt: number,
  noTag: number,
  missingTransfer?: number
): string {
  const tracksStr = `${formatNumber(trackCount)} tracks`;
  if (trackCount === 0) return tracksStr;

  const parts: string[] = [];
  if (complete > 0) parts.push(`\u2713 ${formatNumber(complete)} consistent`);
  if (missingArt > 0) parts.push(`\u25D0 ${formatNumber(missingArt)} missing artwork hash`);
  if (noTag > 0) parts.push(`\u2717 ${formatNumber(noTag)} no sync tag`);
  if (missingTransfer !== undefined && missingTransfer > 0)
    parts.push(`\u25D0 ${formatNumber(missingTransfer)} missing transfer mode`);

  // No sync tag data at all
  if (parts.length === 0) return tracksStr;

  // All consistent — just show the checkmark after track count
  if (parts.length === 1 && complete > 0 && complete === trackCount) {
    return `${tracksStr} \u2713 all consistent`;
  }

  // All tags, none with art hash (single non-zero category)
  if (parts.length === 1 && noTag === trackCount) {
    return `${tracksStr} (\u2717 no sync tags)`;
  }

  return `${tracksStr} (${parts.join(', ')})`;
}

/**
 * Format a table row with consistent column widths
 */
function formatRow(columns: string[], widths: number[]): string {
  return columns.map((col, i) => col.padEnd(widths[i] || 10)).join('  ');
}

type DeviceArgResult =
  | { error: string }
  | {
      resolvedDevice: ResolvedDevice;
      cliPath?: string;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    };

/**
 * Resolve device from CLI arguments (global --device flag or default)
 */
function resolveDeviceArg(): DeviceArgResult {
  const { config, globalOpts } = getContext();

  const cliArg = parseCliDeviceArg(globalOpts.device, config);
  const result = resolveEffectiveDevice(cliArg, undefined, config);

  if (!result.success) {
    return { error: result.error };
  }

  if (result.cliPath && !result.device) {
    return {
      resolvedDevice: undefined as unknown as ResolvedDevice,
      cliPath: result.cliPath,
      config,
      globalOpts,
    };
  }

  return {
    resolvedDevice: result.device!,
    cliPath: result.cliPath,
    config,
    globalOpts,
  };
}

// =============================================================================
// Output types
// =============================================================================

export interface DeviceListOutput {
  success: boolean;
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
  error?: string;
}

export interface DeviceAddOutput {
  success: boolean;
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
  error?: string;
}

export interface DeviceRemoveOutput {
  success: boolean;
  device?: string;
  wasDefault?: boolean;
  error?: string;
}

export interface DeviceInfoOutput {
  success: boolean;
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
  error?: string;
}

export interface DeviceMusicOutput {
  success: boolean;
  tracks?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

export interface DeviceVideoOutput {
  success: boolean;
  videos?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

export interface DeviceClearOutput {
  success: boolean;
  contentType?: 'music' | 'video' | 'all';
  tracksRemoved?: number;
  totalTracks?: number;
  totalSize?: number;
  dryRun?: boolean;
  error?: string;
  fileDeleteErrors?: string[];
}

export interface DeviceResetOutput {
  success: boolean;
  mountPoint?: string;
  modelName?: string;
  tracksRemoved?: number;
  dryRun?: boolean;
  error?: string;
}

export interface DeviceEjectOutput {
  success: boolean;
  device?: string;
  forced?: boolean;
  error?: string;
}

export interface DeviceMountOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  error?: string;
  requiresSudo?: boolean;
  assessment?: import('@podkit/core').DeviceAssessment;
}

export interface DeviceInitOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  modelName?: string;
  readinessLevel?: string;
  error?: string;
}

export interface DeviceSetOutput {
  success: boolean;
  device?: string;
  updated?: Record<string, unknown>;
  error?: string;
}

export interface DeviceDefaultOutput {
  success: boolean;
  device?: string;
  cleared?: boolean;
  error?: string;
}

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

export interface DeviceScanOutput {
  success: boolean;
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
  error?: string;
}

// =============================================================================
// Re-export display utilities for backward compatibility
// =============================================================================

export type { DisplayTrack, FieldName } from './display-utils.js';
export { AVAILABLE_FIELDS, DEFAULT_FIELDS } from './display-utils.js';

// =============================================================================
// Device-specific format helpers
// =============================================================================

/**
 * Helper to escape a single CSV field value.
 */
function escapeCsvField(value: string): string {
  return escapeCsv(value);
}

/**
 * Map an IpodTrack to a full JSON object with all metadata fields.
 */
function ipodTrackToFullJson(t: {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  comment?: string;
  grouping?: string;
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  year?: number;
  bpm?: number;
  compilation: boolean;
  duration: number;
  bitrate: number;
  sampleRate: number;
  size: number;
  filetype?: string;
  mediaType: number;
  filePath: string;
  timeAdded: number;
  timeModified: number;
  timePlayed: number;
  playCount: number;
  skipCount: number;
  rating: number;
  hasArtwork: boolean;
  hasFile: boolean;
  tvShow?: string;
  tvEpisode?: string;
  sortTvShow?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  soundcheck?: number;
  movieFlag?: boolean;
}): Record<string, unknown> {
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumArtist: t.albumArtist || null,
    genre: t.genre || null,
    composer: t.composer || null,
    comment: t.comment || null,
    grouping: t.grouping || null,
    trackNumber: t.trackNumber || null,
    totalTracks: t.totalTracks || null,
    discNumber: t.discNumber || null,
    totalDiscs: t.totalDiscs || null,
    year: t.year || null,
    bpm: t.bpm || null,
    compilation: t.compilation,
    duration: t.duration,
    bitrate: t.bitrate,
    sampleRate: t.sampleRate,
    size: t.size,
    filetype: t.filetype || null,
    mediaType: t.mediaType,
    filePath: t.filePath,
    timeAdded: t.timeAdded,
    timeModified: t.timeModified,
    timePlayed: t.timePlayed,
    playCount: t.playCount,
    skipCount: t.skipCount,
    rating: t.rating,
    hasArtwork: t.hasArtwork,
    hasFile: t.hasFile,
    tvShow: t.tvShow || null,
    tvEpisode: t.tvEpisode || null,
    sortTvShow: t.sortTvShow || null,
    seasonNumber: t.seasonNumber ?? null,
    episodeNumber: t.episodeNumber ?? null,
    soundcheck: t.soundcheck || null,
    movieFlag: t.movieFlag || null,
  };
}

function parseFormat(filetype: string | undefined): string {
  if (!filetype) return '';

  const match = filetype.match(/^(AAC|MPEG|MP3|ALAC|Apple Lossless|WAV|FLAC)/i);
  if (match && match[1]) {
    const format = match[1].toUpperCase();
    if (format === 'MPEG') return 'MP3';
    if (format === 'APPLE LOSSLESS') return 'ALAC';
    return format;
  }

  return filetype;
}

/**
 * Build a minimal `PlatformDeviceInfo` for a path the user passed via `--device`.
 *
 * In path mode we already know where the device is, so we don't need to walk
 * every attached disk via `manager.findIpodDevices()` (which on macOS dispatches
 * `diskutil list` + per-disk subprocess calls — slow under parallel load).
 *
 * Fields the readiness pipeline reads (`identifier`, `volumeName`, `volumeUuid`,
 * `isMounted`, `mountPoint`) are populated from data we have. `size` and
 * `mediaType` are unknown in path mode and left at safe defaults; callers that
 * need them must use the full enumeration path.
 */
export function synthesizePathModeDeviceInfo(
  mountPoint: string,
  volumeUuid: string | undefined
): import('@podkit/core').PlatformDeviceInfo {
  return {
    identifier: `path:${mountPoint}`,
    volumeName: mountPoint.split('/').pop() || mountPoint,
    volumeUuid: volumeUuid ?? '',
    size: 0,
    isMounted: true,
    mountPoint,
  };
}

// =============================================================================
// Scan subcommand
// =============================================================================

// ── Readiness display helpers ────────────────────────────────────────────────

function printReadinessStages(
  out: OutputContext,
  stages: ReadinessStageResult[],
  readiness: ReadinessResult,
  deviceName: string
): void {
  printReadinessSummary(out, stages);
  out.newline();

  // Summary line
  if (readiness.level === 'ready' && readiness.summary) {
    const trackStr = formatNumber(readiness.summary.trackCount);
    const parts = [`${trackStr} track${readiness.summary.trackCount === 1 ? '' : 's'}`];
    if (readiness.summary.freeBytes !== undefined) {
      parts.push(`${formatBytes(readiness.summary.freeBytes)} free`);
    }
    out.print(`  Ready \u2014 ${parts.join(', ')}`);
  } else {
    out.print(`  ${formatReadinessLevel(readiness.level, deviceName)}`);
  }

  // Issues section
  const issues = collectReadinessIssues(stages, deviceName);
  if (issues.length > 0) {
    out.newline();
    printIssues(out, issues);
  }
}

// ── Scan helpers ─────────────────────────────────────────────────────────────

/**
 * Find the configured device name for a discovered device by matching UUID.
 */
export function findConfiguredDeviceName(
  device: { volumeUuid: string },
  devices: Record<string, DeviceConfig>
): string | undefined {
  for (const [name, deviceConfig] of Object.entries(devices)) {
    if (
      deviceConfig.volumeUuid &&
      device.volumeUuid &&
      deviceConfig.volumeUuid.toUpperCase() === device.volumeUuid.toUpperCase()
    ) {
      return name;
    }
  }
  return undefined;
}

/**
 * Find configured devices that were not detected in the scan.
 * Returns devices from config whose volumeUuid doesn't match any detected iPod.
 * Devices without an explicit type default to 'ipod'.
 */
export function findUndetectedDevices(
  detectedUuids: Set<string>,
  devices: Record<string, DeviceConfig>
): Array<{ name: string; type: string; path?: string }> {
  const result: Array<{ name: string; type: string; path?: string }> = [];
  for (const [deviceName, deviceConfig] of Object.entries(devices)) {
    const type = deviceConfig.type ?? 'ipod';

    // Skip devices that were already detected in the scan
    if (deviceConfig.volumeUuid && detectedUuids.has(deviceConfig.volumeUuid.toUpperCase())) {
      continue;
    }

    result.push({
      name: deviceName,
      type,
      path: deviceConfig.path,
    });
  }
  return result;
}

/**
 * Sort devices for display: connected first, then default, then alphabetical.
 */
export function sortDevicesForDisplay<
  T extends { connected: boolean; isDefault: boolean; name: string },
>(devices: T[]): T[] {
  return [...devices].sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get the prefix character for a device row.
 *
 * - ● for connected devices
 * - * for the default device (when not connected)
 * - (space) for other devices
 */
export function getDevicePrefix(device: { connected: boolean; isDefault: boolean }): string {
  if (device.connected) return '\u25CF '; // ●
  if (device.isDefault) return '* ';
  return '  ';
}

/**
 * Redact user home directory paths from text.
 * Volume names and mount points under /Volumes/ are preserved.
 */
export function redactPaths(text: string): string {
  return text
    .replace(/\/Users\/[^/]+\//g, '/Users/****/')
    .replace(/\/home\/[^/]+\//g, '/home/****/');
}

/**
 * Generate a diagnostic report for troubleshooting.
 */
async function generateDiagnosticReport(
  ipods: Array<{
    volumeName: string;
    volumeUuid: string;
    identifier: string;
    size: number;
    isMounted: boolean;
    mountPoint?: string;
  }>,
  readinessResults: ReadinessResult[],
  usbOnlyDevices: Array<{ modelName?: string; supported?: boolean; notSupportedReason?: string }>,
  configuredDevices: Array<{ name: string; type: string; path?: string }>,
  config: { devices?: Record<string, DeviceConfig> },
  version: string
): Promise<string> {
  const { release } = await import('node:os');
  const lines: string[] = [];

  lines.push('podkit diagnostic report');
  lines.push('========================');
  lines.push('');

  // System info
  lines.push('System:');
  lines.push(`  podkit version: ${version}`);
  const platformName =
    process.platform === 'darwin'
      ? `darwin (macOS ${release()})`
      : `${process.platform} (${release()})`;
  lines.push(`  Platform: ${platformName}`);
  lines.push(`  Node.js: ${process.version}`);
  lines.push('');

  const hasAnyDevices =
    ipods.length > 0 || usbOnlyDevices.length > 0 || configuredDevices.length > 0;

  if (!hasAnyDevices) {
    lines.push('No devices found.');
    lines.push('');
    lines.push('---');
    lines.push('Generated by podkit device scan --report');
    return lines.join('\n');
  }

  lines.push('Devices:');

  // iPods with readiness
  for (let i = 0; i < ipods.length; i++) {
    if (i > 0) lines.push('---');
    const device = ipods[i]!;
    const readiness = readinessResults[i];
    const label = device.volumeName || '(unnamed)';
    const identifier = device.identifier ? ` (${device.identifier})` : '';

    lines.push(`  iPod: ${label}${identifier}`);

    // Config relationship
    const configName = findConfiguredDeviceName(device, config.devices ?? {});
    if (configName) {
      lines.push(`  Configured as: ${configName}`);
    } else {
      lines.push('  Not configured');
    }

    if (readiness) {
      lines.push('');
      lines.push('  Readiness:');
      for (const stage of readiness.stages) {
        const marker = stageMarker(stage.status);
        const name = STAGE_DISPLAY_NAMES[stage.stage] || stage.stage;
        let line = `    ${marker} ${name}`;
        if (stage.summary) {
          line += ` \u2014 ${stage.summary}`;
        }
        lines.push(line);

        // Include error interpretation for failed stages
        if (stage.status === 'fail' && stage.details?.interpretation) {
          lines.push(`      ${stage.details.interpretation}`);
        }
      }

      lines.push('');

      // Summary line
      if (readiness.level === 'ready' && readiness.summary) {
        const trackStr = formatNumber(readiness.summary.trackCount);
        const parts = [`${trackStr} track${readiness.summary.trackCount === 1 ? '' : 's'}`];
        if (readiness.summary.freeBytes !== undefined) {
          parts.push(`${formatBytes(readiness.summary.freeBytes)} free`);
        }
        lines.push(`  Level: Ready \u2014 ${parts.join(', ')}`);
      } else {
        const cmdId = configName ?? device.mountPoint ?? label;
        lines.push(`  Level: ${formatReadinessLevel(readiness.level, cmdId)}`);
      }
    }

    lines.push('');
  }

  // USB-only devices
  for (const usbDevice of usbOnlyDevices) {
    lines.push('---');
    const label = usbDevice.modelName ?? 'Unknown iPod';
    lines.push(`  iPod: ${label} (USB only)`);
    if (!usbDevice.supported && usbDevice.notSupportedReason) {
      lines.push(`  ${usbDevice.notSupportedReason}`);
    }
    lines.push('');
  }

  // Configured devices not detected
  for (const cd of configuredDevices) {
    lines.push('---');
    const pathInfo = cd.path ? ` \u2014 ${cd.path}` : '';
    lines.push(`  ${cd.name} (${cd.type})${pathInfo} [not detected]`);
    lines.push('');
  }

  lines.push('---');
  lines.push('Generated by podkit device scan --report');
  return lines.join('\n');
}

// ── Scan subcommand ──────────────────────────────────────────────────────────

const scanSubcommand = new Command('scan')
  .description('scan for connected devices')
  .option('--mount', 'automatically mount unmounted devices')
  .option('--report', 'output diagnostic report for troubleshooting')
  .action(async (scanOptions: { mount?: boolean; report?: boolean }) => {
    const { globalOpts, config } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    // Load core dependencies
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;
    let checkReadiness: typeof import('@podkit/core').checkReadiness;
    let discoverUsbIpods: typeof import('@podkit/core').discoverUsbIpods;
    let createUsbOnlyReadinessResult: typeof import('@podkit/core').createUsbOnlyReadinessResult;
    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
      checkReadiness = core.checkReadiness;
      discoverUsbIpods = core.discoverUsbIpods;
      createUsbOnlyReadinessResult = core.createUsbOnlyReadinessResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceScanOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    // Scan for iPods and USB devices in parallel (only on supported platforms)
    type UsbDiscoveredDevice = Awaited<ReturnType<typeof discoverUsbIpods>>[number];
    let ipods: Awaited<ReturnType<typeof manager.findIpodDevices>> = [];
    let allUsbDevices: UsbDiscoveredDevice[] = [];
    if (manager.isSupported) {
      [ipods, allUsbDevices] = await Promise.all([manager.findIpodDevices(), discoverUsbIpods()]);
    }

    // Correlate USB devices with disk iPods by diskIdentifier ↔ identifier.
    // USB diskIdentifier is the whole-disk BSD name (e.g., "disk5"),
    // PlatformDeviceInfo.identifier is the partition (e.g., "disk5s2").
    const usbByDisk = new Map<string, UsbDiscoveredDevice>();
    for (const usb of allUsbDevices) {
      if (usb.diskIdentifier) {
        usbByDisk.set(usb.diskIdentifier, usb);
      }
    }

    function findMatchingUsb(identifier: string): UsbDiscoveredDevice | undefined {
      const wholeDisk = identifier.replace(/s\d+$/, '');
      return usbByDisk.get(wholeDisk);
    }

    // USB-only = USB devices that didn't match any disk iPod
    const matchedDiskIds = new Set<string>();
    for (const ipod of ipods) {
      const wholeDisk = ipod.identifier.replace(/s\d+$/, '');
      if (usbByDisk.has(wholeDisk)) matchedDiskIds.add(wholeDisk);
    }
    const usbOnlyDevices = allUsbDevices.filter(
      (usb) => !usb.diskIdentifier || !matchedDiskIds.has(usb.diskIdentifier)
    );

    // Gather configured devices not found in the scan
    const detectedUuids = new Set(ipods.map((d) => d.volumeUuid?.toUpperCase()).filter(Boolean));
    const configuredDevices = findUndetectedDevices(detectedUuids, config.devices ?? {});

    // Run readiness pipeline on each iPod (only on supported platforms)
    const readinessResults: ReadinessResult[] = [];
    if (manager.isSupported) {
      for (const ipod of ipods) {
        const matchedUsb = findMatchingUsb(ipod.identifier);
        readinessResults.push(
          await checkReadiness({
            device: ipod,
            usbConnection: matchedUsb?.usb,
            usbModel: matchedUsb?.model,
          })
        );
      }
    }

    // Handle unmounted devices: prompt or auto-mount
    if (manager.isSupported) {
      const { interpretError } = await import('@podkit/core');
      for (let i = 0; i < ipods.length; i++) {
        const ipod = ipods[i]!;
        if (ipod.isMounted) continue;

        const readiness = readinessResults[i];
        const mountStage = readiness?.stages.find((s) => s.stage === 'mount');
        if (!mountStage || mountStage.status !== 'fail') continue;
        if (mountStage.details?.isMounted !== false) continue;

        const label = ipod.volumeName || '(unnamed)';
        let shouldMount = false;

        if (scanOptions.mount) {
          // --mount flag: auto-mount
          shouldMount = true;
        } else if (process.stdout.isTTY && !globalOpts.json) {
          // Interactive TTY: prompt user
          shouldMount = await confirm(`${label} is unmounted. Mount now?`);
        }

        if (shouldMount) {
          try {
            const result = await manager.mount(ipod.identifier);
            if (result.success && result.mountPoint) {
              // Update the ipod entry with new mount info
              ipod.isMounted = true;
              (ipod as { mountPoint?: string }).mountPoint = result.mountPoint;
              // Re-run readiness to get full picture
              readinessResults[i] = await checkReadiness({ device: ipod });
              out.verbose1(`Mounted ${label} at ${result.mountPoint}`);
            } else if (result.requiresSudo) {
              const assessment = result.assessment;
              if (assessment?.iFlash.confirmed) {
                const lines = formatIFlashMountExplanation(assessment);
                for (const line of lines) {
                  out.error(line);
                }
              } else {
                out.error(`Failed to mount ${label}: elevated privileges required.`);
              }
              out.newline();
              out.error(`Run:  ${bold('sudo')} podkit device scan --mount`);
            } else {
              const errMsg = result.error ?? 'Unknown mount error';
              const interpreted = interpretError(errMsg);
              out.error(`Failed to mount ${label}: ${interpreted.explanation}`);
            }
          } catch (err) {
            const interpreted = interpretError(err instanceof Error ? err : String(err));
            out.error(`Failed to mount ${label}: ${interpreted.explanation}`);
          }
        }
      }
    }

    const devices = ipods.map((d, i) => {
      const readiness = readinessResults[i];
      const configuredAs = findConfiguredDeviceName(d, config.devices ?? {});
      const bestModel = readiness?.deviceModel ?? readiness?.usbModel;
      return {
        volumeName: d.volumeName,
        volumeUuid: d.volumeUuid,
        identifier: d.identifier,
        size: d.size,
        isMounted: d.isMounted,
        ...(d.mountPoint ? { mountPoint: d.mountPoint } : {}),
        ...(configuredAs ? { configuredAs } : {}),
        ...(bestModel ? { model: bestModel } : {}),
        ...(readiness
          ? {
              readiness: {
                level: readiness.level,
                stages: readiness.stages.map((s) => ({
                  stage: s.stage,
                  status: s.status,
                  summary: s.summary,
                  ...(s.details ? { details: s.details } : {}),
                })),
                ...(readiness.summary ? { summary: readiness.summary } : {}),
              },
            }
          : {}),
      };
    });

    const hasAnyDevices =
      ipods.length > 0 || usbOnlyDevices.length > 0 || configuredDevices.length > 0;

    // Handle --report flag: generate diagnostic report instead of normal output
    if (scanOptions.report) {
      const cliVersion = scanSubcommand.parent?.parent?.version() ?? 'unknown';
      const report = await generateDiagnosticReport(
        ipods,
        readinessResults,
        usbOnlyDevices,
        configuredDevices,
        config,
        cliVersion
      );
      out.stdout(redactPaths(report));
      return;
    }

    if (!hasAnyDevices) {
      out.result<DeviceScanOutput>({ success: true, devices: [], configuredDevices: [] }, () => {
        out.print('No devices found.');
        out.newline();
        out.print(
          'Make sure your device is connected and mounted, or add one with: podkit device add'
        );
      });
      return;
    }

    out.result<DeviceScanOutput>({ success: true, devices, configuredDevices }, () => {
      // Show iPods with readiness
      if (ipods.length > 0) {
        for (let i = 0; i < ipods.length; i++) {
          const device = ipods[i]!;
          const readiness = readinessResults[i];
          const label = device.volumeName || '(unnamed)';
          const identifier = device.identifier ? ` (${device.identifier})` : '';

          // Use richest available model: deviceModel (from SysInfo) > usbModel (from USB product ID)
          const displayModel = readiness?.deviceModel ?? readiness?.usbModel;
          const matchedUsb = findMatchingUsb(device.identifier);
          const modelLabel = displayModel?.displayName ?? matchedUsb?.model?.displayName;
          const modelSource = displayModel?.source === 'usb' ? ' (USB)' : '';
          if (modelLabel) {
            out.print(`  ${bold(label)}${identifier}  ${modelLabel}${modelSource}`);
          } else {
            out.print(`  ${bold(label)}${identifier}`);
          }

          // Show config relationship
          const configName = findConfiguredDeviceName(device, config.devices ?? {});
          if (configName) {
            out.print(`  Configured as: ${configName}`);
          } else {
            const suggestedName = label.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'myipod';
            out.print(`  Not configured \u2014 run: podkit device add -d ${suggestedName}`);
          }

          out.newline();

          if (readiness) {
            // Use configured name, mount path, or volume label (in that order) for CLI hints
            const cmdId = configName ?? device.mountPoint ?? label;
            printReadinessStages(out, readiness.stages, readiness, cmdId);
          } else {
            // Unsupported platform — fall back to basic display
            out.print(`    Volume UUID:  ${device.volumeUuid || '(unknown)'}`);
            out.print(`    Size:         ${formatBytes(device.size)}`);
            if (device.isMounted && device.mountPoint) {
              out.print(`    Mounted:      ${device.mountPoint}`);
            } else {
              out.print(`    Mounted:      no`);
            }
          }
          out.newline();
        }
      }

      // Show USB-only devices (no disk representation)
      if (usbOnlyDevices.length > 0) {
        for (const usbDevice of usbOnlyDevices) {
          const label = usbDevice.model?.displayName ?? 'Unknown iPod';
          out.print(`  ${bold(label)} (USB only)`);
          out.newline();

          if (!usbDevice.supported) {
            // Unsupported device — show reason and move on
            out.print('  This device is not supported by podkit.');
            if (usbDevice.notSupportedReason) {
              out.print(`  ${usbDevice.notSupportedReason}`);
            }
          } else {
            // Supported but needs partitioning — show readiness stages
            const readiness = createUsbOnlyReadinessResult(usbDevice);
            printReadinessStages(out, readiness.stages, readiness, label);
          }
          out.newline();
        }
      } else if (ipods.length === 0 && manager.isSupported) {
        out.print('No iPod devices found.');
        out.newline();
      }

      // Show configured devices not detected in the scan
      if (configuredDevices.length > 0) {
        out.print('Not detected:');
        for (const cd of configuredDevices) {
          const pathInfo = cd.path ? ` \u2014 ${cd.path}` : '';
          out.print(`  ${bold(cd.name)} (${getDeviceTypeDisplayName(cd.type)})${pathInfo}`);
        }
        out.newline();
      }
    });
  });

// =============================================================================
// List subcommand
// =============================================================================

const listSubcommand = new Command('list')
  .description('list configured devices')
  .action(async () => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const devices = config.devices || {};
    const defaultDevice = config.defaults?.device;
    const deviceNames = Object.keys(devices);

    if (deviceNames.length === 0) {
      out.result<DeviceListOutput>({ success: true, devices: [], defaultDevice: undefined }, () =>
        out.print("No devices configured. Run 'podkit device add -d <name>' to add one.")
      );
      return;
    }

    // Detect connected iPods (lightweight — no readiness pipeline)
    const connectedUuids = new Map<string, { mountPoint?: string }>();
    try {
      const { getDeviceManager } = await import('@podkit/core');
      const manager = getDeviceManager();
      if (manager.isSupported) {
        const ipods = await manager.findIpodDevices();
        for (const ipod of ipods) {
          if (ipod.volumeUuid) {
            connectedUuids.set(ipod.volumeUuid.toUpperCase(), {
              mountPoint: ipod.isMounted ? ipod.mountPoint : undefined,
            });
          }
        }
      }
    } catch {
      // Core not available — skip detection
    }

    // Also check mass-storage device paths
    const connectedPaths = new Set<string>();
    for (const [, deviceConfig] of Object.entries(devices)) {
      if (
        isMassStorageDevice(deviceConfig.type) &&
        deviceConfig.path &&
        existsSync(deviceConfig.path)
      ) {
        connectedPaths.add(deviceConfig.path);
      }
    }

    // Resolve capabilities and settings for each device
    const { resolveGlobalConfig, resolveDeviceSettings, formatResolved, formatGlobalResolved } =
      await import('../config/resolve.js');
    const { resolveCapabilities, identifyCapabilities } = await import('@podkit/core');
    const { resolveIpodModel } = await import('@podkit/devices-ipod');

    // Import Device class for lightweight capability queries (no database needed)
    let deviceFromMountPoint:
      | typeof import('@podkit/libgpod-node').deviceFromMountPoint
      | undefined;
    try {
      const libgpod = await import('@podkit/libgpod-node');
      deviceFromMountPoint = libgpod.deviceFromMountPoint;
    } catch {
      // libgpod not available — fall back to generation-based capabilities
    }

    const globalResolved = resolveGlobalConfig(config);

    const resolvedDevices: ReturnType<typeof resolveDeviceSettings>[] = [];

    for (const name of deviceNames) {
      const deviceConfig = devices[name]!;
      const type = deviceConfig.type ?? 'ipod';
      const isDefault = name === defaultDevice;

      // Determine connection status
      let connected = false;
      let capabilities: import('@podkit/core').DeviceCapabilities | null = null;

      if (type === 'ipod') {
        const uuid = deviceConfig.volumeUuid?.toUpperCase();
        const connInfo = uuid ? connectedUuids.get(uuid) : undefined;
        connected = connInfo !== undefined;

        if (connected && connInfo?.mountPoint && deviceFromMountPoint) {
          // Connected iPod — bridge libgpod data → IpodModel → capabilities
          try {
            const dev = deviceFromMountPoint(connInfo.mountPoint);
            const libgpodCaps = dev.getCapabilities();
            const model = resolveIpodModel({
              modelNumStr: libgpodCaps.modelNumber ?? undefined,
              libgpodGeneration: libgpodCaps.generation,
            });
            if (model) {
              capabilities = identifyCapabilities(model);
            }
            dev.close();
          } catch {
            // Fall through — capabilities remain null
          }
        }
        // Disconnected iPod — capabilities stay null (unknown)
      } else {
        // Mass-storage device — resolve via unified resolveCapabilities
        connected = deviceConfig.path ? connectedPaths.has(deviceConfig.path) : false;
        const massStorageIdentity: import('@podkit/core').MassStorageIdentity = {
          kind: 'mass-storage',
          presetId: type,
        };
        try {
          capabilities = resolveCapabilities(massStorageIdentity, {
            overrides: deviceConfig as Partial<import('@podkit/core').DeviceCapabilities>,
          });
        } catch {
          capabilities = null;
        }
      }

      resolvedDevices.push(
        resolveDeviceSettings(config, name, deviceConfig, capabilities, connected, isDefault)
      );
    }

    // Sort: connected first, then default, then alphabetical
    const sorted = sortDevicesForDisplay(resolvedDevices);
    resolvedDevices.length = 0;
    resolvedDevices.push(...sorted);

    // Build JSON output (backward-compatible shape + new resolved fields)
    const deviceList = resolvedDevices.map((d) => ({
      name: d.name,
      isDefault: d.isDefault,
      connected: d.connected,
      type: d.type,
      volumeUuid: devices[d.name]?.volumeUuid,
      volumeName: devices[d.name]?.volumeName,
      quality: d.quality.value,
      qualitySource: d.quality.source,
      audio: d.audio.value,
      audioSource: d.audio.source,
      video: d.video.value,
      videoSource: d.video.source,
      artwork: d.artwork.value,
      artworkSource: d.artwork.source,
    }));

    out.result<DeviceListOutput>({ success: true, devices: deviceList, defaultDevice }, () => {
      // Global config line
      out.print(
        `Global: quality=${formatGlobalResolved(globalResolved.quality)}` +
          `  audio=${formatGlobalResolved(globalResolved.audio)}` +
          `  video=${formatGlobalResolved(globalResolved.video)}` +
          `  artwork=${formatGlobalResolved(globalResolved.artwork)}`
      );
      out.newline();

      const headers = ['NAME', 'TYPE', 'QUALITY', 'AUDIO', 'VIDEO', 'ARTWORK'];
      const widths = [
        Math.max(6, ...resolvedDevices.map((d) => d.name.length + 2)),
        Math.max(6, ...resolvedDevices.map((d) => getDeviceTypeDisplayName(d.type).length)),
        9,
        9,
        9,
        9,
      ];

      out.print('  ' + formatRow(headers, widths));

      for (const d of resolvedDevices) {
        const prefix = getDevicePrefix(d);

        const row = formatRow(
          [
            d.name,
            getDeviceTypeDisplayName(d.type),
            formatResolved(d.quality),
            formatResolved(d.audio),
            formatResolved(d.video),
            formatResolved(d.artwork),
          ],
          widths
        );

        out.print(prefix + row);
      }

      out.newline();
      out.print(
        '\u25CF = connected  * = default  [value] = inherited  \u2717 = unsupported  ? = unknown'
      );
    });
  });

// =============================================================================
// Add subcommand
// =============================================================================

/**
 * Format the iFlash evidence list into a sentence suitable for display.
 * e.g. "2048-byte block size; Capacity exceeds iPod Classic maximum"
 */
function formatIFlashEvidence(evidence: IFlashEvidence[]): string {
  return evidence.map((e) => e.signal).join('; ');
}

/**
 * Build a multi-line explanation of why macOS cannot mount an iFlash device,
 * including all detected signals with their details.
 */
function formatIFlashMountExplanation(assessment: DeviceAssessment): string[] {
  const lines: string[] = [];
  lines.push('macOS cannot automatically mount this device.');
  lines.push('');
  lines.push('iFlash confirmed by:');
  for (const e of assessment.iFlash.evidence) {
    lines.push(`  • ${e.signal}: ${e.value}`);
    lines.push(`    ${e.detail}`);
  }
  lines.push('');
  lines.push('macOS refuses to mount large FAT32 volumes through its normal mechanisms.');
  lines.push('Elevated privileges are required to mount this device directly.');
  return lines;
}

interface AddOptions {
  yes?: boolean;
  type?: string;
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
  artworkMaxResolution?: string;
  artworkSources?: string[];
  supportedAudioCodecs?: string[];
  supportsVideo?: boolean;
  musicDir?: string;
  moviesDir?: string;
  tvShowsDir?: string;
}

const addSubcommand = new Command('add')
  .description('detect and add a device to config')
  .addOption(new Option('--type <type>', 'device type').choices([...DEVICE_TYPES]))
  .option('--path <path>', 'path to device mount point')
  .option('-y, --yes', 'skip confirmation prompts')
  .addOption(
    new Option('--quality <preset>', 'transcoding quality preset').choices([...QUALITY_PRESETS])
  )
  .addOption(
    new Option('--audio-quality <preset>', 'audio quality (overrides --quality)').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(
    new Option('--video-quality <preset>', 'video quality (overrides --quality)').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(new Option('--encoding <mode>', 'encoding mode').choices([...ENCODING_MODES]))
  .option('--artwork', 'sync artwork to this device')
  .option('--no-artwork', 'do not sync artwork to this device')
  .option(
    '--artwork-max-resolution <pixels>',
    'max artwork resolution in pixels (mass-storage only)'
  )
  .option(
    '--artwork-sources <sources...>',
    'artwork sources: database, embedded, sidecar (mass-storage only)'
  )
  .option(
    '--supported-audio-codecs <codecs...>',
    'supported audio codecs: aac, alac, mp3, flac, ogg, opus, wav, aiff (mass-storage only)'
  )
  .option('--supports-video', 'device supports video playback (mass-storage only)')
  .option('--no-supports-video', 'device does not support video playback (mass-storage only)')
  .option(
    '--music-dir <name>',
    'music directory name on device (default: Music, mass-storage only)'
  )
  .option(
    '--movies-dir <name>',
    'movies directory name on device (default: Video/Movies, mass-storage only)'
  )
  .option(
    '--tv-shows-dir <name>',
    'TV shows directory name on device (default: Video/Shows, mass-storage only)'
  )
  .action(async (options: AddOptions & { path?: string }) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceAdd(options, out));
  });

/**
 * Dependency injection seam for `runDeviceAdd`. Tests pass stubs to avoid
 * real USB walks / disk operations / interactive prompts. Production passes
 * nothing — the defaults are the real implementations.
 */
export interface DeviceAddDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  confirm?: (msg: string) => Promise<boolean>;
  loadCore?: () => Promise<typeof import('@podkit/core')>;
}

/**
 * `device add` runner — testable in-process.
 *
 * Extracted from the action callback. The body is unchanged; tests construct
 * an OutputContext with BufferSinks, call this directly, then assert on
 * captured output + `process.exitCode`. Use `deps` to inject fakes for the
 * device manager, confirm prompts, and the dynamic `@podkit/core` import.
 */
export async function runDeviceAdd(
  options: AddOptions & { path?: string },
  out: OutputContext,
  deps: DeviceAddDeps = {}
): Promise<void> {
  const { globalOpts, configResult } = getContext();
  const name = globalOpts.device;
  const explicitPath = options.path;
  const autoConfirm = options.yes ?? false;
  const confirmFn = deps.confirm ?? confirm;
  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));

  // Require --device flag
  if (!name) {
    throw new CliError({
      message: 'Missing required --device flag. Usage: podkit device add -d <name>',
      code: 'DEVICE_REQUIRED',
    });
  }

  // Validate device name
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    throw new CliError({
      message:
        'Invalid device name. Must start with a letter and contain only letters, numbers, hyphens, and underscores.',
      code: 'INVALID_DEVICE_NAME',
    });
  }

  const existingDevices = configResult.config.devices || {};
  if (name in existingDevices) {
    throw new CliError({
      message: `Device "${name}" already exists in config. Use a different name or remove it first.`,
      code: 'DEVICE_EXISTS',
    });
  }

  // Validate quality options
  if (options.quality !== undefined && !QUALITY_PRESETS.includes(options.quality as any)) {
    throw new CliError({
      message: `Invalid quality preset "${options.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
      code: 'INVALID_QUALITY',
    });
  }
  if (
    options.audioQuality !== undefined &&
    !QUALITY_PRESETS.includes(options.audioQuality as any)
  ) {
    throw new CliError({
      message: `Invalid audio quality preset "${options.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
      code: 'INVALID_AUDIO_QUALITY',
    });
  }
  if (
    options.videoQuality !== undefined &&
    !VIDEO_QUALITY_PRESETS.includes(options.videoQuality as any)
  ) {
    throw new CliError({
      message: `Invalid video quality preset "${options.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`,
      code: 'INVALID_VIDEO_QUALITY',
    });
  }
  if (options.encoding !== undefined && options.encoding !== 'vbr' && options.encoding !== 'cbr') {
    throw new CliError({
      message: `Invalid encoding mode "${options.encoding}". Valid values: vbr, cbr`,
      code: 'INVALID_ENCODING',
    });
  }

  // =========================================================================
  // Mass-storage device flow (--type echo-mini|rockbox|generic)
  // =========================================================================
  const deviceType = options.type;

  if (deviceType && isMassStorageDevice(deviceType)) {
    // Mass-storage devices require --path
    if (!explicitPath) {
      throw new CliError({
        message: `--path is required for ${getDeviceTypeDisplayName(deviceType)} devices. Usage: podkit device add -d <name> --type ${deviceType} --path <mount-point>`,
        code: 'PATH_REQUIRED',
      });
    }

    // Verify path exists and is a directory
    if (!existsSync(explicitPath) || !statSync(explicitPath).isDirectory()) {
      throw new CliError({
        message: existsSync(explicitPath)
          ? `Path is not a directory: ${explicitPath}`
          : `Path not found: ${explicitPath}`,
        code: existsSync(explicitPath) ? 'PATH_NOT_DIRECTORY' : 'PATH_NOT_FOUND',
      });
    }

    // Validate capability override options
    if (options.artworkMaxResolution !== undefined) {
      const parsed = parseInt(options.artworkMaxResolution, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
        throw new CliError({
          message: `Invalid --artwork-max-resolution value "${options.artworkMaxResolution}". Must be a positive integer between 1 and 10000.`,
          code: 'INVALID_ARTWORK_RESOLUTION',
        });
      }
    }
    if (options.artworkSources !== undefined) {
      for (const source of options.artworkSources) {
        if (!ARTWORK_SOURCES.includes(source as any)) {
          throw new CliError({
            message: `Invalid artwork source "${source}". Valid values: ${ARTWORK_SOURCES.join(', ')}`,
            code: 'INVALID_ARTWORK_SOURCE',
          });
        }
      }
    }
    if (options.supportedAudioCodecs !== undefined) {
      for (const codec of options.supportedAudioCodecs) {
        if (!AUDIO_CODECS.includes(codec as any)) {
          throw new CliError({
            message: `Invalid audio codec "${codec}". Valid values: ${AUDIO_CODECS.join(', ')}`,
            code: 'INVALID_AUDIO_CODEC',
          });
        }
      }
    }

    const deviceConfig: DeviceConfig = {
      type: deviceType as DeviceConfig['type'],
      path: explicitPath,
    };
    if (options.quality) deviceConfig.quality = options.quality as any;
    if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
    if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
    if (options.encoding) deviceConfig.encoding = options.encoding as any;
    if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;
    if (options.artworkMaxResolution !== undefined)
      deviceConfig.artworkMaxResolution = parseInt(options.artworkMaxResolution, 10);
    if (options.artworkSources !== undefined)
      deviceConfig.artworkSources = options.artworkSources as any;
    if (options.supportedAudioCodecs !== undefined)
      deviceConfig.supportedAudioCodecs = options.supportedAudioCodecs as any;
    if (options.supportsVideo !== undefined) deviceConfig.supportsVideo = options.supportsVideo;
    if (options.musicDir !== undefined) deviceConfig.musicDir = options.musicDir;
    if (options.moviesDir !== undefined) deviceConfig.moviesDir = options.moviesDir;
    if (options.tvShowsDir !== undefined) deviceConfig.tvShowsDir = options.tvShowsDir;

    const volumeName = explicitPath.split('/').pop() || name;
    const deviceCount = Object.keys(existingDevices).length;
    const isFirstDevice = deviceCount === 0;
    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;

    const deviceInfo = {
      name,
      identifier: 'mass-storage',
      volumeName,
      volumeUuid: '',
      size: 0,
      isMounted: true,
      mountPoint: explicitPath,
    };

    // Interactive confirmation (skip if auto-confirm or JSON mode)
    if (!autoConfirm && out.isText) {
      out.newline();
      out.print(`Adding ${getDeviceTypeDisplayName(deviceType)} device:`);
      out.print(`  Name:   ${name}`);
      out.print(`  Type:   ${getDeviceTypeDisplayName(deviceType)}`);
      out.print(`  Path:   ${explicitPath}`);
      out.newline();

      const shouldSave = await confirmFn(`Add this device as "${name}"?`);
      if (!shouldSave) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    // Save device to config
    const result = addDevice(name, deviceConfig, { configPath });

    if (!result.success) {
      throw new CliError({
        message: `Failed to save config: ${result.error}`,
        code: 'CONFIG_SAVE_FAILED',
        details: { device: deviceInfo },
      });
    }

    if (isFirstDevice) {
      setDefaultDevice(name, { configPath });
    }

    out.result<DeviceAddOutput>(
      {
        success: true,
        device: deviceInfo,
        saved: true,
        configPath: result.configPath,
        isDefault: isFirstDevice,
      },
      () => {
        out.newline();
        out.print(
          result.created
            ? `Created config file: ${result.configPath}`
            : `Updated config file: ${result.configPath}`
        );
        out.newline();
        out.print(`Device "${name}" added to config (${getDeviceTypeDisplayName(deviceType)}).`);
        if (isFirstDevice) {
          out.print(`Set as default device.`);
        }
        out.newline();
        out.print('Next steps:');
        out.print(
          '  podkit collection add -t music -c <name> --path <path>   # Add your music library'
        );
        out.print(`  podkit sync                    # Sync to this device`);
      }
    );
    return;
  }

  // =========================================================================
  // iPod device flow (--type ipod or no --type)
  // =========================================================================

  // Reject mass-storage-only options on iPod devices
  const massStorageOnlyOptions = [
    options.artworkMaxResolution !== undefined && '--artwork-max-resolution',
    options.artworkSources !== undefined && '--artwork-sources',
    options.supportedAudioCodecs !== undefined && '--supported-audio-codecs',
    options.supportsVideo !== undefined && '--supports-video',
    options.musicDir !== undefined && '--music-dir',
    options.moviesDir !== undefined && '--movies-dir',
    options.tvShowsDir !== undefined && '--tv-shows-dir',
  ].filter(Boolean) as string[];

  if (massStorageOnlyOptions.length > 0) {
    throw new CliError({
      message: `${massStorageOnlyOptions.join(', ')} ${massStorageOnlyOptions.length === 1 ? 'is' : 'are'} only valid for mass-storage devices (--type echo-mini|rockbox|generic).`,
      code: 'INVALID_OPTION_FOR_TYPE',
    });
  }

  // Load core dependencies (overridable via deps.loadCore for tests)
  let core: typeof import('@podkit/core');
  let IpodDatabase: typeof import('@podkit/core').IpodDatabase;

  try {
    core = await loadCore();
    IpodDatabase = core.IpodDatabase;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
    throw new CliError({
      message: `Failed to load podkit-core: ${message}`,
      code: 'CORE_LOAD_FAILED',
    });
  }

  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  // If explicit path provided, use it directly
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new CliError({
        message: `Path not found: ${explicitPath}`,
        code: 'PATH_NOT_FOUND',
      });
    }

    // Attempt SysInfoExtended read (before database init so it's available for checksums)
    const sysInfoAttempt = await attemptSysInfoExtended(explicitPath, out, { autoConfirm });
    if (sysInfoAttempt.abort) {
      process.exitCode = 1;
      return;
    }
    const sysInfoResult = sysInfoAttempt.result;

    // Check if database exists
    const hasDb = await IpodDatabase.hasDatabase(explicitPath);
    let trackCount = 0;
    let modelName = 'Unknown';
    let initialized = false;

    if (!hasDb) {
      out.print('');
      out.print('This iPod needs to be initialized (no iTunesDB found).');

      const shouldInit =
        autoConfirm || out.isJson || (await confirmFn('Initialize iPod database now?'));

      if (!shouldInit) {
        out.print('Cancelled. iPod not initialized.');
        return;
      }

      try {
        out.print('Initializing iPod database...');
        const ipod = await IpodDatabase.initializeIpod(explicitPath);
        modelName = ipod.device.modelName;
        ipod.close();
        initialized = true;
        out.print(`Initialized as ${modelName}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message: `Failed to initialize iPod: ${message}`,
          code: 'INIT_FAILED',
        });
      }
    } else {
      // Database exists, read info
      try {
        const ipod = await IpodDatabase.open(explicitPath);
        try {
          trackCount = ipod.trackCount;
          modelName = ipod.device.modelName;
        } finally {
          ipod.close();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        out.verbose1(`Warning: Could not read database: ${message}`);
      }
    }

    // Enrich model name from SysInfoExtended if available (more specific than database model)
    if (sysInfoResult?.model?.displayName) {
      modelName = sysInfoResult.model.displayName;
    }

    // Get volume UUID if possible (for macOS)
    let volumeUuid = '';
    let volumeName = explicitPath.split('/').pop() || 'iPod';

    if (manager.isSupported) {
      const ipods = await manager.findIpodDevices();
      const matchingDevice = ipods.find((d) => d.mountPoint === explicitPath);
      if (matchingDevice) {
        volumeUuid = matchingDevice.volumeUuid;
        volumeName = matchingDevice.volumeName;
      }
    }

    // If no UUID found, generate a stable one from the path
    if (!volumeUuid) {
      volumeUuid = `manual-${Buffer.from(explicitPath).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;
    }

    const deviceInfo = {
      name,
      identifier: 'unknown',
      volumeName,
      volumeUuid,
      size: 0,
      isMounted: true,
      mountPoint: explicitPath,
      trackCount,
      modelName,
    };

    const deviceCount = Object.keys(existingDevices).length;
    const isFirstDevice = deviceCount === 0;
    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const deviceConfig: DeviceConfig = { volumeUuid, volumeName };
    if (options.quality) deviceConfig.quality = options.quality as any;
    if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
    if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
    if (options.encoding) deviceConfig.encoding = options.encoding as any;
    if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;

    // Validate device if database is available
    let addValidation: DeviceValidationResult | undefined;
    try {
      const ipodForValidation = await IpodDatabase.open(explicitPath);
      try {
        addValidation = validateDevice(ipodForValidation.device, explicitPath);
      } finally {
        ipodForValidation.close();
      }
    } catch {
      // Database may not be readable yet (e.g., just initialized)
    }

    if (addValidation && !addValidation.supported) {
      const messages = formatValidationMessages(addValidation);
      // Validation failures may have multiple messages; surface them all in
      // text mode but use the first as the primary error message for JSON.
      if (out.isText) {
        out.newline();
        for (const msg of messages) {
          out.print(msg);
        }
      }
      throw new CliError({
        message: messages[0] ?? 'Device validation failed',
        code: 'VALIDATION_FAILED',
        details: { messages },
      });
    }

    // Interactive confirmation (skip if auto-confirm or JSON mode)
    if (!autoConfirm && out.isText) {
      out.newline();
      out.print('iPod at path:');
      out.print(`  Path:        ${explicitPath}`);
      out.print(`  Model:       ${modelName}`);
      out.print(`  Tracks:      ${formatNumber(trackCount)}`);

      // Show validation warnings during add
      if (addValidation) {
        if (addValidation.issues.length > 0) {
          out.newline();
          for (const issue of addValidation.issues) {
            out.warn(issue.message);
            if (issue.suggestion) {
              out.print(`  ${issue.suggestion}`);
            }
          }
        }

        // Show capability summary
        if (addValidation.capabilities) {
          out.print('  Capabilities:');
          const caps = addValidation.capabilities;
          const capEntries: Array<[string, boolean]> = [
            ['Music', caps.music],
            ['Artwork', caps.artwork],
            ['Video', caps.video],
            ['Podcasts', caps.podcast],
          ];
          for (const [capName, supported] of capEntries) {
            if (supported) {
              out.print(`    + ${capName}`);
            } else {
              out.print(`    - ${capName}`);
            }
          }
        }
      }

      out.newline();

      const shouldSave = await confirmFn(`Add this iPod as "${name}"?`);

      if (!shouldSave) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    // Save device to config
    const result = addDevice(name, deviceConfig, { configPath });

    if (!result.success) {
      throw new CliError({
        message: `Failed to save config: ${result.error}`,
        code: 'CONFIG_SAVE_FAILED',
        details: { device: deviceInfo },
      });
    }

    if (isFirstDevice) {
      setDefaultDevice(name, { configPath });
    }

    out.result<DeviceAddOutput>(
      {
        success: true,
        device: deviceInfo,
        initialized,
        saved: true,
        configPath: result.configPath,
        isDefault: isFirstDevice,
      },
      () => {
        out.newline();
        out.print(
          result.created
            ? `Created config file: ${result.configPath}`
            : `Updated config file: ${result.configPath}`
        );
        out.newline();
        out.print(`Device "${name}" added to config.`);
        if (isFirstDevice) {
          out.print(`Set as default device.`);
        }
        if (initialized) {
          out.print(`Database initialized (${modelName}).`);
        }
        out.newline();
        out.print('Next steps:');
        out.print(
          '  podkit collection add -t music -c <name> --path <path>   # Add your music library'
        );
        out.print(`  podkit sync                    # Sync to this device`);
      }
    );
    return;
  }

  // No explicit path - scan for devices
  if (!manager.isSupported) {
    throw new CliError({
      message: `Device scanning is not supported on ${manager.platform}. Specify a path explicitly: podkit device add -d <name> --path <path>`,
      code: 'SCAN_UNSUPPORTED',
    });
  }

  out.print('Scanning for attached devices...');

  const ipods = await manager.findIpodDevices();

  if (ipods.length === 0) {
    // No iPod found via the manager. Run the broader USB enumeration to check
    // whether a recognised mass-storage device (e.g. Echo Mini) is connected.
    // This replaces the generic "no iPod found" error with an actionable hint.
    let massStorageHint: string | undefined;

    try {
      const { enumerateConnectedDevices } = await loadCore();
      const { ipodProvider } = await import('@podkit/devices-ipod');
      const { createMassStorageProvider, BUILT_IN_PRESETS } =
        await import('@podkit/devices-mass-storage');

      const enumerated = await enumerateConnectedDevices({
        providers: [ipodProvider, createMassStorageProvider(BUILT_IN_PRESETS)],
      });

      const massStorageDevice = enumerated.find(
        (d) =>
          d.matchedProviderId === 'mass-storage' &&
          d.identity?.kind === 'mass-storage' &&
          d.identity.presetId
      );

      if (massStorageDevice && massStorageDevice.identity?.kind === 'mass-storage') {
        const presetId = massStorageDevice.identity.presetId!;
        const displayName = getDeviceTypeDisplayName(presetId);

        // Duplicate detection: check whether a device with the same USB serial
        // is already configured. DeviceConfig does not persist serialNumber today
        // (mass-storage entries store type + path), so this check is best-effort
        // and will be a no-op until a future migration stores the serial.
        // volumeUuid is unavailable at USB-scan time (requires mounting).
        const detectedSerial = massStorageDevice.identity.serialNumber;

        massStorageHint = presetId;
        out.print(`Detected ${displayName} via USB.`);

        if (detectedSerial !== undefined) {
          out.verbose1(`  USB serial: ${detectedSerial}`);
        }

        out.print(`To add it, run:`);
        out.print(`  podkit device add -d ${name} --type ${presetId} --path <mount-point>`);
        if (massStorageDevice.discovered.diskIdentifier) {
          out.print(
            `  (disk: ${massStorageDevice.discovered.diskIdentifier} — mount it first if not already mounted)`
          );
        }
      }
    } catch {
      // Enumeration is best-effort: if it fails (e.g. USB walk errors),
      // fall through to the original "no iPod found" error path.
    }

    if (!massStorageHint) {
      throw new CliError({
        message:
          'No iPod devices found. Make sure your iPod is connected, or specify a path explicitly with --path.',
        code: 'NO_IPOD',
      });
    }
    throw new CliError({
      message: `Detected ${massStorageHint} device — add with --type ${massStorageHint} --path <mount-point>`,
      code: 'DETECTED_MASS_STORAGE',
      details: { presetId: massStorageHint },
    });
  }

  // Multiple iPods found - error with guidance
  if (ipods.length > 1) {
    if (out.isText) {
      out.newline();
      for (const ipod of ipods) {
        const path = ipod.mountPoint ?? ipod.identifier;
        out.error(`  podkit device add -d ${name} --path ${path}`);
        out.error(`    ${ipod.volumeName || '(unnamed)'} - ${formatBytes(ipod.size)}`);
        out.newline();
      }
    }
    throw new CliError({
      message: `Multiple iPod devices found (${ipods.length}). Specify a path explicitly.`,
      code: 'MULTIPLE_IPODS',
      details: {
        ipods: ipods.map((d) => ({
          identifier: d.identifier,
          mountPoint: d.mountPoint,
          volumeName: d.volumeName,
          size: d.size,
        })),
      },
    });
  }

  let ipod = ipods[0]!;

  // Handle unmounted device: assess, attempt mount, guide user if sudo required
  if (!ipod.isMounted) {
    const assessment = await manager.assessDevice(ipod.identifier);

    out.newline();
    out.print(`Found iPod: ${ipod.volumeName} (${formatBytes(ipod.size)}) — not mounted`);
    if (assessment?.usb?.productId) {
      const { identify } = await loadCore();
      const assessModel = identify({ from: 'usb', productId: assessment.usb.productId });
      out.print(
        `  Model:   ${assessModel?.displayName ?? `iPod (USB ${assessment.usb.productId})`}`
      );
    }
    if (assessment?.iFlash.confirmed) {
      out.print(
        `  Storage: iFlash confirmed — ${formatIFlashEvidence(assessment.iFlash.evidence)}`
      );
    }
    out.newline();
    out.print('Attempting to mount...');

    const mountResult = await manager.mount(ipod.identifier);

    if (mountResult.success && mountResult.mountPoint) {
      out.print(`Mounted at ${mountResult.mountPoint}.`);
      // Re-fetch device info so subsequent code has the mount point
      const updated = await manager.findByVolumeUuid(ipod.volumeUuid);
      if (updated?.isMounted) ipod = updated;
    } else if (mountResult.requiresSudo) {
      const explanationLines = assessment?.iFlash.confirmed
        ? formatIFlashMountExplanation(assessment)
        : ['Mounting requires elevated privileges.'];
      if (out.isText) {
        for (const line of explanationLines) {
          out.error(line);
        }
        out.newline();
        out.error(`Run:  ${bold('sudo')} podkit device add -d ${name}`);
      }
      throw new CliError({
        message: 'Elevated privileges required to mount device',
        code: 'MOUNT_REQUIRES_SUDO',
        details: { explanation: explanationLines },
      });
    } else {
      throw new CliError({
        message: `Failed to mount: ${mountResult.error ?? 'unknown error'}`,
        code: 'MOUNT_FAILED',
      });
    }
  }

  // Attempt SysInfoExtended read (before database init so it's available for checksums)
  let autoSysInfoResult: SysInfoExtendedResult | null = null;
  if (ipod.mountPoint) {
    const attempt = await attemptSysInfoExtended(ipod.mountPoint, out, { autoConfirm });
    if (attempt.abort) {
      process.exitCode = 1;
      return;
    }
    autoSysInfoResult = attempt.result;
  }

  // Check if the iPod has a database
  let trackCount = 0;
  let modelName = 'Unknown';
  let initialized = false;

  if (ipod.mountPoint) {
    const hasDb = await IpodDatabase.hasDatabase(ipod.mountPoint);

    if (!hasDb) {
      out.newline();
      out.print('This iPod needs to be initialized (no iTunesDB found).');

      const shouldInit =
        autoConfirm || out.isJson || (await confirmFn('Initialize iPod database now?'));

      if (!shouldInit) {
        out.print('Cancelled. iPod not initialized.');
        return;
      }

      try {
        out.print('Initializing iPod database...');
        const db = await IpodDatabase.initializeIpod(ipod.mountPoint);
        modelName = db.device.modelName;
        db.close();
        initialized = true;
        out.print(`Initialized as ${modelName}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new CliError({
          message: `Failed to initialize iPod: ${message}`,
          code: 'INIT_FAILED',
        });
      }
    } else {
      // Database exists, read info
      try {
        const db = await IpodDatabase.open(ipod.mountPoint);
        try {
          trackCount = db.trackCount;
          modelName = db.device.modelName;
        } finally {
          db.close();
        }
      } catch {
        // Couldn't read database info, continue anyway
      }
    }
  }

  // Enrich model name from SysInfoExtended if available (more specific than database model)
  if (autoSysInfoResult?.model?.displayName) {
    modelName = autoSysInfoResult.model.displayName;
  }

  const deviceInfo = {
    name,
    identifier: ipod.identifier,
    volumeName: ipod.volumeName,
    volumeUuid: ipod.volumeUuid,
    size: ipod.size,
    isMounted: ipod.isMounted,
    mountPoint: ipod.mountPoint,
    trackCount,
    modelName,
  };

  const deviceCount = Object.keys(existingDevices).length;
  const isFirstDevice = deviceCount === 0;
  const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
  const deviceConfig: DeviceConfig = {
    volumeUuid: ipod.volumeUuid,
    volumeName: ipod.volumeName,
  };
  if (options.quality) deviceConfig.quality = options.quality as any;
  if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
  if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
  if (options.encoding) deviceConfig.encoding = options.encoding as any;
  if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;

  // Validate detected device
  let autoDetectValidation: DeviceValidationResult | undefined;
  if (ipod.mountPoint) {
    try {
      const db = await IpodDatabase.open(ipod.mountPoint);
      try {
        autoDetectValidation = validateDevice(db.device, ipod.mountPoint);
      } finally {
        db.close();
      }
    } catch {
      // Couldn't validate, continue anyway
    }
  }

  if (autoDetectValidation && !autoDetectValidation.supported) {
    const messages = formatValidationMessages(autoDetectValidation);
    if (out.isText) {
      out.newline();
      for (const msg of messages) {
        out.print(msg);
      }
    }
    throw new CliError({
      message: messages[0] ?? 'Device validation failed',
      code: 'VALIDATION_FAILED',
      details: { messages },
    });
  }

  // Interactive mode (skip if auto-confirm or JSON mode)
  if (!autoConfirm && out.isText) {
    out.newline();
    out.print('Found attached iPod:');
    out.print(`  Name:        ${ipod.volumeName || '(unnamed)'}`);
    out.print(`  Model:       ${modelName}`);
    out.print(`  Size:        ${formatBytes(ipod.size)}`);
    out.print(`  Tracks:      ${formatNumber(trackCount)}`);
    out.print(`  Volume UUID: ${ipod.volumeUuid}`);
    out.print(`  Mounted:     ${ipod.isMounted ? 'Yes' : 'No'}`);
    if (ipod.mountPoint) {
      out.print(`  Mount point: ${ipod.mountPoint}`);
    }
    out.print(`  Device:      /dev/${ipod.identifier}`);

    // Show validation warnings during add
    if (autoDetectValidation) {
      if (autoDetectValidation.issues.length > 0) {
        out.newline();
        for (const issue of autoDetectValidation.issues) {
          out.warn(issue.message);
          if (issue.suggestion) {
            out.print(`  ${issue.suggestion}`);
          }
        }
      }

      // Show capability summary
      if (autoDetectValidation.capabilities) {
        out.print('  Capabilities:');
        const caps = autoDetectValidation.capabilities;
        const capEntries: Array<[string, boolean]> = [
          ['Music', caps.music],
          ['Artwork', caps.artwork],
          ['Video', caps.video],
          ['Podcasts', caps.podcast],
        ];
        for (const [capName, supported] of capEntries) {
          if (supported) {
            out.print(`    + ${capName}`);
          } else {
            out.print(`    - ${capName}`);
          }
        }
      }
    }

    out.newline();

    const shouldSave = await confirmFn(`Add this iPod as "${name}"?`);

    if (!shouldSave) {
      out.print('Cancelled. No changes made.');
      return;
    }
  }

  // Save device to config
  const result = addDevice(name, deviceConfig, { configPath });

  if (!result.success) {
    throw new CliError({
      message: `Failed to save config: ${result.error}`,
      code: 'CONFIG_SAVE_FAILED',
      details: { device: deviceInfo },
    });
  }

  if (isFirstDevice) {
    setDefaultDevice(name, { configPath });
  }

  out.result<DeviceAddOutput>(
    {
      success: true,
      device: deviceInfo,
      initialized,
      saved: true,
      configPath: result.configPath,
      isDefault: isFirstDevice,
    },
    () => {
      out.newline();
      out.print(
        result.created
          ? `Created config file: ${result.configPath}`
          : `Updated config file: ${result.configPath}`
      );
      out.newline();
      out.print(`Device "${name}" added to config.`);
      if (isFirstDevice) {
        out.print(`Set as default device.`);
      }
      if (initialized) {
        out.print(`Database initialized (${modelName}).`);
      }
      out.newline();
      out.print('Next steps:');
      out.print(
        '  podkit collection add -t music -c <name> --path <path>   # Add your music library'
      );
      out.print(`  podkit sync                    # Sync to this device`);
    }
  );
}

// =============================================================================
// Remove subcommand
// =============================================================================

const removeSubcommand = new Command('remove')
  .description('remove a device from config')
  .option('--confirm', 'skip confirmation prompt')
  .action(async (options: { confirm?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();
    const name = globalOpts.device;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    if (!name) {
      const error = 'Missing required --device flag. Usage: podkit device remove -d <name>';
      out.result<DeviceRemoveOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const devices = config.devices || {};
    const defaultDevice = config.defaults?.device;

    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      out.result<DeviceRemoveOutput>({ success: false, error }, () => {
        out.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          out.error(`Available devices: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    const wasDefault = name === defaultDevice;

    if (!options.confirm && out.isText) {
      out.print(`This will remove device "${name}" from the config.`);
      if (wasDefault) {
        out.print('This device is currently set as the default.');
      }
      out.newline();

      const confirmed = await confirmNo(`Remove device "${name}"?`);
      if (!confirmed) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = removeDevice(name, { configPath });

    if (!result.success) {
      out.result<DeviceRemoveOutput>({ success: false, error: result.error }, () =>
        out.error(`Failed to remove device: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    if (wasDefault) {
      setDefaultDevice('', { configPath });
    }

    out.result<DeviceRemoveOutput>({ success: true, device: name, wasDefault }, () => {
      out.print(`Device "${name}" removed from config.`);
      if (wasDefault) {
        out.print('Cleared default device setting.');
      }
    });
  });

// =============================================================================
// Info subcommand
// =============================================================================

const infoSubcommand = new Command('info')
  .description('display device configuration and live status')
  .action(async () => {
    const { globalOpts, config: podkitConfig } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceInfoOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath, config } = resolved;
    const device = resolvedDevice?.config;
    const deviceName = resolvedDevice?.name;
    const defaultDevice = config.defaults?.device;
    const isDefault = deviceName === defaultDevice;

    // Try to get live status if device is connected
    let liveStatus: DeviceInfoOutput['status'] | undefined;
    let databaseErrorIsUnexpected = false;
    let resolvedDeviceCapabilities: import('@podkit/core').DeviceCapabilities | undefined;
    let readinessData: DeviceInfoOutput['readiness'] | undefined;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (cliPath || deviceIdentity) {
        const resolveResult = await resolveDevicePath({
          cliDevice: cliPath,
          deviceIdentity,
          manager,
          requireMounted: true,
          quiet: true,
        });

        if (resolveResult.path && existsSync(resolveResult.path)) {
          // Hold the open device for the entire live-status block: UUID
          // lookup + readiness reuse the already-parsed iTunesDB rather than
          // re-opening it inside checkDatabase. The try/finally guarantees
          // adapter.close() runs even if a later block (UUID, readiness)
          // throws an unexpected exception.
          let openedDeviceResult: Awaited<ReturnType<typeof openDevice>> | undefined;
          try {
            try {
              openedDeviceResult = await openDevice(
                core,
                resolveResult.path,
                device,
                podkitConfig.deviceDefaults
              );
              resolvedDeviceCapabilities = openedDeviceResult.capabilities;
              const storage = getStorageInfo(resolveResult.path);
              const tracks = openedDeviceResult.adapter.getTracks();
              const musicTracks = tracks.filter((t) => core.isMusicMediaType(t.mediaType));
              const musicCount = musicTracks.length;
              const videoCount = tracks.filter((t) => core.isVideoMediaType(t.mediaType)).length;
              const parsedSyncTags = musicTracks.map((t) => ({
                tag: t.syncTag,
                hasArtwork: t.hasArtwork,
              }));
              const syncTagCount = parsedSyncTags.filter((t) => t.tag !== null).length;
              const syncTagComplete = parsedSyncTags.filter(
                (t) => t.tag !== null && (t.tag.artworkHash || t.hasArtwork === false)
              ).length;
              const syncTagMissingArt = syncTagCount - syncTagComplete;
              const syncTagMissingTransfer = parsedSyncTags.filter(
                (t) => t.tag !== null && !t.tag.transferMode
              ).length;

              liveStatus = {
                mounted: true,
                mountPoint: resolveResult.path,
                musicCount,
                videoCount,
                syncTagCount,
                syncTagComplete,
                syncTagMissingArt,
                syncTagMissingTransfer,
              };

              // iPod-specific model and validation info
              if (openedDeviceResult.ipod) {
                const info = openedDeviceResult.ipod.getInfo();
                const deviceValidation = validateDevice(info.device, resolveResult.path);
                liveStatus.model = {
                  name: info.device.modelName,
                  number: info.device.modelNumber,
                  generation: info.device.generation,
                  capacity: info.device.capacity,
                };
                liveStatus.capabilities = deviceValidation.capabilities;
                liveStatus.validation = {
                  supported: deviceValidation.supported,
                  issues: deviceValidation.issues,
                  warnings: deviceValidation.warnings,
                };
              }

              // Mass-storage capabilities for JSON output
              if (!openedDeviceResult.ipod && resolvedDeviceCapabilities) {
                liveStatus.massStorageCapabilities = {
                  supportedAudioCodecs: [...resolvedDeviceCapabilities.supportedAudioCodecs],
                  artworkSources: [...resolvedDeviceCapabilities.artworkSources],
                  artworkMaxResolution: resolvedDeviceCapabilities.artworkMaxResolution,
                  supportsVideo: resolvedDeviceCapabilities.supportsVideo,
                  audioNormalization: resolvedDeviceCapabilities.audioNormalization,
                  supportsAlbumArtistBrowsing:
                    resolvedDeviceCapabilities.supportsAlbumArtistBrowsing,
                };
              }

              if (storage) {
                liveStatus.storage = {
                  used: storage.used,
                  total: storage.total,
                  free: storage.free,
                  percentUsed: Math.round((storage.used / storage.total) * 100),
                };
              }
            } catch (err) {
              liveStatus = { mounted: true, mountPoint: resolveResult.path };
              const message = err instanceof Error ? err.message : String(err);
              liveStatus.databaseError = message;
              // IpodError on iPod devices is expected (empty/uninitialized)
              if (err instanceof core.IpodError && !isMassStorageDevice(device?.type)) {
                // Database not found or corrupt — expected on empty/uninitialized iPods
              } else {
                databaseErrorIsUnexpected = true;
              }
            }

            // Look up filesystem UUID for the mount point. Single diskutil-info
            // call (cheap); avoids the full findIpodDevices walk below.
            if (liveStatus?.mounted && manager.isSupported) {
              try {
                const uuid = await manager.getUuidForMountPoint(resolveResult.path);
                if (uuid) {
                  liveStatus.volumeUuid = uuid;
                }
              } catch {
                // Gracefully skip UUID display when extraction fails
              }
            }

            // Run readiness check for iPod devices (skip mass-storage). In path
            // mode we synthesize the PlatformDeviceInfo from data we already
            // have rather than calling manager.findIpodDevices() — that's a
            // full disk enumeration which on macOS dispatches diskutil
            // subprocesses per attached disk.
            if (liveStatus?.mounted && !isMassStorageDevice(device?.type) && manager.isSupported) {
              try {
                const matchingIpod =
                  resolveResult.deviceInfo ??
                  synthesizePathModeDeviceInfo(resolveResult.path, liveStatus.volumeUuid);
                const readiness = await core.checkReadiness({
                  device: matchingIpod,
                  ipod: openedDeviceResult?.ipod,
                });
                const bestModel = readiness.deviceModel ?? readiness.usbModel;
                readinessData = {
                  level: readiness.level,
                  stages: readiness.stages.map((s) => ({
                    stage: s.stage,
                    status: s.status,
                    summary: s.summary,
                    ...(s.details ? { details: s.details } : {}),
                  })),
                  ...(bestModel ? { model: bestModel } : {}),
                  ...(readiness.summary ? { summary: readiness.summary } : {}),
                };
              } catch {
                // Gracefully skip readiness if it fails
              }
            }
          } finally {
            // Guaranteed close, even if UUID/readiness blocks throw.
            // adapter.close() owns the underlying ipod handle.
            openedDeviceResult?.adapter.close();
          }
        } else if (resolveResult.deviceInfo) {
          liveStatus = { mounted: false };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      liveStatus = { mounted: false, databaseError: message };
      databaseErrorIsUnexpected = true;
    }

    // Compute transform warnings for JSON output
    let deviceTransformWarnings: Array<{ type: string; message: string }> | undefined;
    if (
      device &&
      isMassStorageDevice(device.type) &&
      resolvedDeviceCapabilities &&
      device.transforms?.cleanArtists
    ) {
      const { resolveCleanArtistsTransform, computeTransformWarnings } =
        await import('./transform-warnings.js');
      const deviceCleanArtists = device.transforms.cleanArtists as Partial<
        import('@podkit/core').CleanArtistsConfig
      >;
      const effectiveTransforms: import('@podkit/core').TransformsConfig = {
        cleanArtists: {
          ...podkitConfig.transforms.cleanArtists,
          ...deviceCleanArtists,
        },
      };
      const resolution = resolveCleanArtistsTransform(
        effectiveTransforms,
        resolvedDeviceCapabilities.supportsAlbumArtistBrowsing,
        true
      );
      const hasCapabilityOverride = device.supportsAlbumArtistBrowsing !== undefined;
      const warnings = computeTransformWarnings(
        resolution,
        resolvedDeviceCapabilities.supportsAlbumArtistBrowsing,
        hasCapabilityOverride
      );
      if (warnings.length > 0) {
        deviceTransformWarnings = warnings.map((w) => ({ type: w.type, message: w.message }));
      }
    }

    out.result<DeviceInfoOutput>(
      {
        success: true,
        device: device
          ? {
              name: deviceName!,
              volumeUuid: device.volumeUuid,
              volumeName: device.volumeName,
              quality: device.quality,
              audioQuality: device.audioQuality,
              videoQuality: device.videoQuality,
              artwork: device.artwork,
              transforms: device.transforms as unknown as Record<string, unknown> | undefined,
              transformWarnings: deviceTransformWarnings,
              isDefault,
            }
          : undefined,
        status: liveStatus,
        readiness: readinessData,
      },
      () => {
        // Human-readable output — Summary zone then Issues zone
        const isMassStorage = device ? isMassStorageDevice(device.type) : false;
        const infoIssues: import('./readiness-display.js').ReadinessIssue[] = [];
        const cmdTarget = deviceName || cliPath || 'device';

        // ── Summary zone ──────────────────────────────────────────────
        if (device) {
          out.print(`Device: ${deviceName}${isDefault ? ' (default)' : ''}`);
          if (isMassStorage) {
            out.print(`  Type:          ${getDeviceTypeDisplayName(device.type)}`);
          }
          if (device.volumeUuid) {
            out.print(`  Volume UUID:   ${device.volumeUuid}`);
          }
          if (device.volumeName) {
            out.print(`  Volume Name:   ${device.volumeName}`);
          }
        } else if (cliPath) {
          out.print(`Device: ${cliPath} (path mode)`);
          if (liveStatus?.volumeUuid) {
            out.print(`  Volume UUID:   ${liveStatus.volumeUuid}`);
          }
        }

        if (liveStatus) {
          if (liveStatus.mounted && liveStatus.mountPoint) {
            out.print(`  Status:        Mounted at ${liveStatus.mountPoint}`);
          } else if (liveStatus.mounted === false) {
            out.print(`  Status:        Not mounted`);
          }

          // Model line — prefer IpodModel (has color) over database model
          if (!isMassStorage && readinessData?.model) {
            out.print(`  Model:         ${readinessData.model.displayName}`);
          } else if (!isMassStorage && liveStatus.model) {
            const capacityStr =
              liveStatus.model.capacity > 0 ? ` (${liveStatus.model.capacity}GB)` : '';
            const genStr = formatGeneration(liveStatus.model.generation);
            out.print(`  Model:         ${liveStatus.model.name}${capacityStr} - ${genStr}`);
          } else if (!isMassStorage && !liveStatus.model && liveStatus.mounted) {
            out.print('  Model:         Unknown \u2014 SysInfo missing');
          }

          // Readiness line — short status only
          if (!isMassStorage && readinessData) {
            const levelLabel =
              readinessData.level === 'ready'
                ? 'Ready'
                : formatReadinessLevel(readinessData.level as ReadinessLevel, cmdTarget);
            out.print(`  Readiness:     ${levelLabel}`);

            // Collect readiness issues for the Issues zone
            const readinessIssues = collectReadinessIssues(
              readinessData.stages as import('@podkit/core').ReadinessStageResult[],
              cmdTarget
            );
            infoIssues.push(...readinessIssues);
          }

          // Collect validation issues for the Issues zone (iPod only)
          if (!isMassStorage && liveStatus.validation) {
            for (const issue of liveStatus.validation.issues) {
              infoIssues.push({
                marker: issue.type === 'unsupported_device' ? '\u2717' : '!',
                label: 'Validation',
                summary: issue.message,
                details: [],
                ...(issue.suggestion ? { docsUrl: undefined, fixCommand: undefined } : {}),
              });
            }
          }

          // Capabilities — compact
          if (!isMassStorage && liveStatus.capabilities && liveStatus.model) {
            out.print('  Capabilities:');
            const caps = liveStatus.capabilities;
            const gen = formatGeneration(liveStatus.model.generation);
            const capEntries: Array<[string, boolean]> = [
              ['Music', caps.music],
              ['Artwork', caps.artwork],
              ['Video', caps.video],
              ['Podcasts', caps.podcast],
            ];
            for (const [name, supported] of capEntries) {
              if (supported) {
                out.print(`    + ${name}`);
              } else {
                out.print(`    - ${name} (not supported on ${gen})`);
              }
            }
          } else if (!isMassStorage && !liveStatus.model && liveStatus.mounted) {
            out.print('  Capabilities:  Music only (model unknown)');
          } else if (isMassStorage && resolvedDeviceCapabilities) {
            out.print('  Capabilities:');
            out.print(
              `    Audio Codecs:    ${resolvedDeviceCapabilities.supportedAudioCodecs.join(', ')}`
            );
            out.print(
              `    Artwork:         ${resolvedDeviceCapabilities.artworkSources.join(', ')} (max ${resolvedDeviceCapabilities.artworkMaxResolution}px)`
            );
            out.print(
              `    Video:           ${resolvedDeviceCapabilities.supportsVideo ? 'yes' : 'no'}`
            );
            out.print(`    Normalization:   ${resolvedDeviceCapabilities.audioNormalization}`);
            out.print(
              `    Album Artist:    ${resolvedDeviceCapabilities.supportsAlbumArtistBrowsing ? 'yes' : 'no'}`
            );
          }

          // Codec display
          if (resolvedDeviceCapabilities) {
            const deviceCodecs = new Set<string>(resolvedDeviceCapabilities.supportedAudioCodecs);
            const codecConfig = device?.codec ?? podkitConfig.codec;
            const lossyStack = codecConfig?.lossy ?? DEFAULT_LOSSY_STACK;
            const losslessStack = codecConfig?.lossless ?? DEFAULT_LOSSLESS_STACK;

            const allStacks = [...lossyStack, ...losslessStack];
            const seen = new Set<string>();
            const supportedCodecs = allStacks.filter((c) => {
              if (c === 'source' || seen.has(c)) return false;
              seen.add(c);
              return deviceCodecs.has(c);
            });

            out.print(`  Codecs:          ${supportedCodecs.join(', ') || 'none'}`);
          }

          if (liveStatus.storage) {
            const usedStr = formatBytes(liveStatus.storage.used);
            const totalStr = formatBytes(liveStatus.storage.total);
            out.print(
              `  Storage:       ${usedStr} used / ${totalStr} total (${liveStatus.storage.percentUsed}%)`
            );
          }

          if (liveStatus.musicCount !== undefined) {
            const trackCount = liveStatus.musicCount;
            const syncTagCount = liveStatus.syncTagCount ?? 0;
            const complete = liveStatus.syncTagComplete ?? 0;
            const missingArt = liveStatus.syncTagMissingArt ?? 0;
            const noTag = trackCount - syncTagCount;
            const missingTransfer = liveStatus.syncTagMissingTransfer ?? 0;

            out.print(
              `  Music:         ${formatSyncTagSummary(trackCount, complete, missingArt, noTag, missingTransfer)}`
            );
          }
          if (liveStatus.videoCount !== undefined && liveStatus.videoCount > 0) {
            out.print(`  Video:         ${formatNumber(liveStatus.videoCount)} videos`);
          }

          if (liveStatus.databaseError) {
            out.newline();
            if (databaseErrorIsUnexpected) {
              const errLabel = isMassStorage ? 'Cannot read device' : 'Cannot read iPod database';
              out.error(`${errLabel}: ${liveStatus.databaseError}`);
            } else {
              out.print(`  Database:      Could not read (${liveStatus.databaseError})`);
            }
          }
        }

        if (device) {
          out.print(`  Quality:       ${device.quality || '(not set)'}`);
          if (device.audioQuality) {
            out.print(`  Audio Quality: ${device.audioQuality}`);
          }
          if (device.videoQuality) {
            out.print(`  Video Quality: ${device.videoQuality}`);
          }
          out.print(
            `  Artwork:       ${device.artwork === true ? 'yes' : device.artwork === false ? 'no' : '(not set)'}`
          );

          if (device.transforms) {
            out.print('  Transforms:');
            for (const [transformName, transformConfig] of Object.entries(device.transforms)) {
              const cfg = transformConfig as Record<string, unknown>;
              const enabled = cfg.enabled !== false;
              const details: string[] = [];

              if ('format' in cfg && cfg.format) {
                details.push(`format: "${cfg.format}"`);
              }
              if ('drop' in cfg && cfg.drop === true) {
                details.push('drop');
              }

              const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
              out.print(`    ${transformName}: ${enabled ? 'enabled' : 'disabled'}${detailStr}`);
            }
          }

          // Collect transform warnings for Issues zone
          if (deviceTransformWarnings) {
            for (const warning of deviceTransformWarnings) {
              infoIssues.push({
                marker: '!',
                label: 'Transform',
                summary: warning.message,
                details: [],
              });
            }
          }

          // Show mass-storage-specific config overrides
          if (isMassStorage) {
            const overrides: string[] = [];
            if (device.artworkMaxResolution !== undefined) {
              overrides.push(`  Artwork Resolution: ${device.artworkMaxResolution}px (override)`);
            }
            if (device.artworkSources !== undefined) {
              overrides.push(
                `  Artwork Sources:    ${device.artworkSources.join(', ')} (override)`
              );
            }
            if (device.supportedAudioCodecs !== undefined) {
              overrides.push(
                `  Audio Codecs:       ${device.supportedAudioCodecs.join(', ')} (override)`
              );
            }
            if (device.supportsVideo !== undefined) {
              overrides.push(
                `  Video Support:      ${device.supportsVideo ? 'yes' : 'no'} (override)`
              );
            }
            if (device.audioNormalization !== undefined) {
              overrides.push(`  Normalization:      ${device.audioNormalization} (override)`);
            }
            if (device.supportsAlbumArtistBrowsing !== undefined) {
              overrides.push(
                `  Album Artist:       ${device.supportsAlbumArtistBrowsing ? 'yes' : 'no'} (override)`
              );
            }
            if (device.musicDir !== undefined) {
              overrides.push(`  Music Directory:    ${device.musicDir}`);
            }
            if (device.moviesDir !== undefined) {
              overrides.push(`  Movies Directory:   ${device.moviesDir}`);
            }
            if (device.tvShowsDir !== undefined) {
              overrides.push(`  TV Shows Directory: ${device.tvShowsDir}`);
            }
            if (overrides.length > 0) {
              for (const line of overrides) {
                out.print(line);
              }
            }
          }
        }

        // ── Issues zone ───────────────────────────────────────────────
        if (infoIssues.length > 0) {
          out.newline();
          printIssues(out, infoIssues);
        }

        // Show tips based on sync tag state
        if (liveStatus?.musicCount !== undefined && liveStatus.musicCount > 0) {
          const syncTagCount = liveStatus.syncTagCount ?? 0;
          const missingArt = liveStatus.syncTagMissingArt ?? 0;
          out.printTips({
            syncTagInfo: {
              trackCount: liveStatus.musicCount,
              syncTagCount,
              missingArt,
            },
          });
        }
      }
    );

    if (databaseErrorIsUnexpected) {
      process.exitCode = 1;
    }
  });

// =============================================================================
// Music subcommand
// =============================================================================

interface MusicVideoOptions {
  format?: string;
  fields?: string;
  tracks?: boolean;
  albums?: boolean;
  artists?: boolean;
}

const musicSubcommand = new Command('music')
  .description('list music on device (shows stats by default)')
  .option('--tracks', 'list all tracks')
  .option('--albums', 'list albums with track counts')
  .option('--artists', 'list artists with album/track counts')
  .addOption(
    new Option('--format <fmt>', 'output format').choices([...OUTPUT_FORMATS]).default('table')
  )
  .option(
    '--fields <list>',
    `fields to show (comma-separated, for --tracks). Valid: ${[...AVAILABLE_FIELDS].join(', ')}`
  )
  .action(async (options: MusicVideoOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    const format = out.isJson ? 'json' : options.format;
    const mode = options.tracks
      ? 'tracks'
      : options.albums
        ? 'albums'
        : options.artists
          ? 'artists'
          : 'stats';

    const outputError = (error: string) => {
      if (format === 'json') {
        out.stdout(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        out.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    if (options.fields && mode !== 'tracks') {
      outputError('--fields can only be used with --tracks');
      return;
    }

    let fields;
    try {
      fields = parseFields(options.fields);
    } catch (err) {
      outputError(err instanceof Error ? err.message : String(err));
      return;
    }

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (deviceIdentity?.volumeUuid && format !== 'json') {
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
      }

      const resolveResult = await resolveDevicePath({
        cliDevice: cliPath,
        deviceIdentity,
        manager,
        requireMounted: true,
        quiet: globalOpts.quiet,
      });

      if (!resolveResult.path) {
        outputError(resolveResult.error ?? formatDeviceError(resolveResult));
        return;
      }

      if (!existsSync(resolveResult.path)) {
        const deviceLabel = isMassStorageDevice(resolvedDevice?.config?.type) ? 'Device' : 'iPod';
        outputError(`${deviceLabel} not found at path: ${resolveResult.path}`);
        return;
      }

      // Output helper for music tracks (shared between iPod and mass-storage)
      const outputMusicTracks = (
        musicTracks: DeviceTrack[],
        displayTracks: DisplayTrack[],
        heading: string,
        fullJsonMapper: (t: DeviceTrack) => Record<string, unknown>
      ) => {
        if (mode === 'stats') {
          const stats = computeStats(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(stats, null, 2));
          } else {
            out.stdout(
              formatStatsText(stats, heading, { verbose: out.isVerbose, tips: out.tipsEnabled })
            );
          }
        } else if (mode === 'albums') {
          const albums = aggregateAlbums(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(albums, null, 2));
          } else if (format === 'csv') {
            const lines = ['Album,Artist,Tracks'];
            for (const a of albums) {
              lines.push(`${escapeCsvField(a.album)},${escapeCsvField(a.artist)},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatAlbumsTable(albums, heading));
          }
        } else if (mode === 'artists') {
          const artists = aggregateArtists(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(artists, null, 2));
          } else if (format === 'csv') {
            const lines = ['Artist,Albums,Tracks'];
            for (const a of artists) {
              lines.push(`${escapeCsvField(a.artist)},${a.albums},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatArtistsTable(artists, heading));
          }
        } else {
          // tracks mode
          if (format === 'json') {
            const fullTracks = musicTracks.map((t) => ({
              ...fullJsonMapper(t),
              syncTag: t.syncTag,
            }));
            out.stdout(JSON.stringify(fullTracks, null, 2));
          } else if (format === 'csv') {
            out.stdout(formatCsv(displayTracks, fields));
          } else {
            out.stdout(formatTable(displayTracks, fields));
          }
        }
      };

      const deviceResult = await openDevice(
        core,
        resolveResult.path,
        resolvedDevice?.config,
        config.deviceDefaults
      );
      try {
        const allTracks = deviceResult.adapter.getTracks();
        const musicTracks = allTracks.filter((t) => core.isMusicMediaType(t.mediaType));
        const deviceName =
          resolvedDevice?.name?.toUpperCase() ||
          (deviceResult.isIpodDevice
            ? 'iPod'
            : getDeviceTypeDisplayName(resolvedDevice?.config?.type));
        const heading = `Music on ${deviceName}:`;
        const displayTracks = musicTracks.map(deviceTrackToDisplayTrack);

        // When isIpodDevice, the DeviceTrack objects are IpodTrack instances
        // (IpodDeviceAdapter returns them directly), so the cast is safe.
        const jsonMapper = deviceResult.isIpodDevice
          ? (t: DeviceTrack) => ipodTrackToFullJson(t as IpodTrack)
          : deviceTrackToFullJson;
        outputMusicTracks(musicTracks, displayTracks, heading, jsonMapper);
      } finally {
        deviceResult.adapter.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Video subcommand
// =============================================================================

const videoSubcommand = new Command('video')
  .description('list video content on device (shows stats by default)')
  .option('--tracks', 'list all tracks')
  .option('--albums', 'list albums with track counts')
  .option('--artists', 'list artists with album/track counts')
  .addOption(
    new Option('--format <fmt>', 'output format').choices([...OUTPUT_FORMATS]).default('table')
  )
  .option(
    '--fields <list>',
    `fields to show (comma-separated, for --tracks). Valid: ${[...AVAILABLE_FIELDS].join(', ')}`
  )
  .action(async (options: MusicVideoOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    const format = out.isJson ? 'json' : options.format;
    const mode = options.tracks
      ? 'tracks'
      : options.albums
        ? 'albums'
        : options.artists
          ? 'artists'
          : 'stats';

    const outputError = (error: string) => {
      if (format === 'json') {
        out.stdout(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        out.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    if (options.fields && mode !== 'tracks') {
      outputError('--fields can only be used with --tracks');
      return;
    }

    let fields;
    try {
      fields = parseFields(options.fields);
    } catch (err) {
      outputError(err instanceof Error ? err.message : String(err));
      return;
    }

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (deviceIdentity?.volumeUuid && format !== 'json') {
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
      }

      const resolveResult = await resolveDevicePath({
        cliDevice: cliPath,
        deviceIdentity,
        manager,
        requireMounted: true,
        quiet: globalOpts.quiet,
      });

      if (!resolveResult.path) {
        outputError(resolveResult.error ?? formatDeviceError(resolveResult));
        return;
      }

      if (!existsSync(resolveResult.path)) {
        const deviceLabel = isMassStorageDevice(resolvedDevice?.config?.type) ? 'Device' : 'iPod';
        outputError(`${deviceLabel} not found at path: ${resolveResult.path}`);
        return;
      }

      // Output helper for video tracks (shared between iPod and mass-storage)
      const outputVideoTracks = (
        videoTracks: DeviceTrack[],
        displayTracks: DisplayTrack[],
        heading: string,
        fullJsonMapper: (t: DeviceTrack) => Record<string, unknown>
      ) => {
        if (mode === 'stats') {
          const stats = computeStats(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(stats, null, 2));
          } else {
            out.stdout(
              formatStatsText(stats, heading, { verbose: out.isVerbose, tips: out.tipsEnabled })
            );
          }
        } else if (mode === 'albums') {
          const albums = aggregateAlbums(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(albums, null, 2));
          } else if (format === 'csv') {
            const lines = ['Album,Artist,Tracks'];
            for (const a of albums) {
              lines.push(`${escapeCsvField(a.album)},${escapeCsvField(a.artist)},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatAlbumsTable(albums, heading));
          }
        } else if (mode === 'artists') {
          const artists = aggregateArtists(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(artists, null, 2));
          } else if (format === 'csv') {
            const lines = ['Artist,Albums,Tracks'];
            for (const a of artists) {
              lines.push(`${escapeCsvField(a.artist)},${a.albums},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatArtistsTable(artists, heading));
          }
        } else {
          // tracks mode
          if (format === 'json') {
            const fullTracks = videoTracks.map((t) => ({
              ...fullJsonMapper(t),
              syncTag: t.syncTag,
            }));
            out.stdout(JSON.stringify(fullTracks, null, 2));
          } else if (format === 'csv') {
            out.stdout(formatCsv(displayTracks, fields));
          } else {
            out.stdout(formatTable(displayTracks, fields));
          }
        }
      };

      const deviceResult = await openDevice(
        core,
        resolveResult.path,
        resolvedDevice?.config,
        config.deviceDefaults
      );
      try {
        // Check if device supports video
        if (!deviceResult.capabilities.supportsVideo) {
          if (format === 'json') {
            out.stdout(JSON.stringify({ message: 'This device does not support video.' }, null, 2));
          } else {
            out.print('This device does not support video.');
          }
          return;
        }

        const allTracks = deviceResult.adapter.getTracks();
        const videoTracks = allTracks.filter((t) => core.isVideoMediaType(t.mediaType));
        const deviceName =
          resolvedDevice?.name?.toUpperCase() ||
          (deviceResult.isIpodDevice
            ? 'iPod'
            : getDeviceTypeDisplayName(resolvedDevice?.config?.type));
        const heading = `Video on ${deviceName}:`;
        const displayTracks = videoTracks.map(deviceTrackToDisplayTrack);

        // When isIpodDevice, the DeviceTrack objects are IpodTrack instances
        // (IpodDeviceAdapter returns them directly), so the cast is safe.
        const jsonMapper = deviceResult.isIpodDevice
          ? (t: DeviceTrack) => ipodTrackToFullJson(t as IpodTrack)
          : deviceTrackToFullJson;
        outputVideoTracks(videoTracks, displayTracks, heading, jsonMapper);
      } finally {
        deviceResult.adapter.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Clear subcommand
// =============================================================================

interface ClearOptions {
  confirm?: boolean;
  dryRun?: boolean;
  type?: 'music' | 'video' | 'all';
}

const clearSubcommand = new Command('clear')
  .description('remove content from the device (all, music only, or video only)')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .option(
    '--type <type>',
    'content type to clear: "music", "video", or "all" (default: all)',
    'all'
  )
  .action(async (options: ClearOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceClearOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    // Gate: this command only works with iPod devices (requires iTunesDB)
    const resolvedType = resolvedDevice?.config?.type;
    if (resolvedType && resolvedType !== 'ipod') {
      const error =
        'This command is only supported for iPod devices. Mass-storage devices do not use an iTunesDB.';
      out.result<DeviceClearOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let IpodError: typeof import('@podkit/core').IpodError;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      IpodError = core.IpodError;
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceClearOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceClearOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceClearOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    let ipod;
    try {
      ipod = await IpodDatabase.open(devicePath);
    } catch (err) {
      const isIpodError = err instanceof IpodError;
      const message = err instanceof Error ? err.message : String(err);

      out.result<DeviceClearOutput>(
        {
          success: false,
          error: isIpodError ? `Not an iPod or database corrupted: ${message}` : message,
        },
        () => {
          out.error(`Cannot read iPod database at: ${devicePath}`);
          out.newline();
          if (isIpodError) {
            out.error('This path does not appear to be a valid iPod:');
            out.error('  - Missing iTunesDB file');
            out.error('  - Database may be corrupted');
          } else {
            out.error(`Error: ${message}`);
          }
        }
      );
      process.exitCode = 1;
      return;
    }

    // Validate type option
    const contentType = options.type ?? 'all';
    if (!['music', 'video', 'all'].includes(contentType)) {
      const errorMsg = `Invalid type "${contentType}". Must be "music", "video", or "all".`;
      out.result<DeviceClearOutput>({ success: false, error: errorMsg }, () => out.error(errorMsg));
      process.exitCode = 1;
      ipod.close();
      return;
    }

    try {
      const { isMusicMediaType, isVideoMediaType } = await import('@podkit/core');

      const allTracks = ipod.getTracks();

      // Filter tracks based on content type
      let targetTracks;
      if (contentType === 'all') {
        targetTracks = allTracks;
      } else if (contentType === 'music') {
        targetTracks = allTracks.filter((t) => isMusicMediaType(t.mediaType));
      } else {
        targetTracks = allTracks.filter((t) => isVideoMediaType(t.mediaType));
      }

      const targetCount = targetTracks.length;
      const targetSize = targetTracks.reduce((sum, track) => sum + track.size, 0);

      const contentLabel =
        contentType === 'all' ? 'content' : contentType === 'music' ? 'music tracks' : 'videos';

      if (targetCount === 0) {
        out.result<DeviceClearOutput>(
          { success: true, contentType, tracksRemoved: 0, totalTracks: 0, dryRun: options.dryRun },
          () => out.print(`iPod has no ${contentLabel} to remove.`)
        );
        return;
      }

      if (options.dryRun) {
        out.result<DeviceClearOutput>(
          {
            success: true,
            contentType,
            tracksRemoved: targetCount,
            totalTracks: targetCount,
            totalSize: targetSize,
            dryRun: true,
          },
          () => {
            out.print(
              `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
            );
            out.newline();
            out.print(`Dry run: would remove ${contentLabel} and files.`);
          }
        );
        return;
      }

      if (!options.confirm && out.isText) {
        out.print(
          `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
        );
        out.newline();
        if (contentType === 'all') {
          out.print('This will remove ALL content from the iPod. Files will be deleted.');
        } else {
          out.print(`This will remove all ${contentLabel} from the iPod. Files will be deleted.`);
        }
        out.print('This action cannot be undone.');
        out.newline();

        const confirmPrompt =
          contentType === 'all' ? 'Delete all content?' : `Delete all ${contentLabel}?`;
        const confirmed = await confirmNo(confirmPrompt);
        if (!confirmed) {
          out.result<DeviceClearOutput>(
            { success: false, error: 'Operation cancelled by user' },
            () => out.print('Operation cancelled.')
          );
          process.exitCode = 1;
          return;
        }
      }

      out.print(`Removing ${contentLabel}...`);

      // Perform the removal based on content type
      let result;
      if (contentType === 'all') {
        result = ipod.removeAllTracks({ deleteFiles: true });
      } else {
        result = ipod.removeTracksByContentType(contentType, { deleteFiles: true });
      }
      await ipod.save();

      if (result.fileDeleteErrors.length > 0) {
        for (const error of result.fileDeleteErrors) {
          out.warn(error);
        }
      }

      out.result<DeviceClearOutput>(
        {
          success: true,
          contentType,
          tracksRemoved: result.removedCount,
          totalTracks: targetCount,
          totalSize: targetSize,
          fileDeleteErrors:
            result.fileDeleteErrors.length > 0 ? result.fileDeleteErrors : undefined,
        },
        () =>
          out.print(
            `Removed ${formatNumber(result.removedCount)} ${contentLabel}, freed ${formatBytes(targetSize)}.`
          )
      );
    } finally {
      ipod.close();
    }
  });

// =============================================================================
// Reset subcommand
// =============================================================================

interface ResetOptions {
  yes?: boolean;
  dryRun?: boolean;
}

const resetSubcommand = new Command('reset')
  .description(
    'recreate iPod database from scratch (note: does not delete orphaned audio files in iPod_Control/Music/; use "device clear --type all" first to remove all content)'
  )
  .option('-y, --yes', 'skip confirmation prompt')
  .option('--dry-run', 'show what would happen without making changes')
  .action(async (options: ResetOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const autoConfirm = options.yes ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceResetOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    // Gate: this command only works with iPod devices (requires iTunesDB)
    const resolvedType = resolvedDevice?.config?.type;
    if (resolvedType && resolvedType !== 'ipod') {
      const error =
        'This command is only supported for iPod devices. Mass-storage devices do not use an iTunesDB.';
      out.result<DeviceResetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceResetOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceResetOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceResetOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    // Check if database exists and get current track count
    const hasDb = await IpodDatabase.hasDatabase(devicePath);
    let currentTrackCount = 0;

    if (hasDb) {
      try {
        const ipod = await IpodDatabase.open(devicePath);
        try {
          currentTrackCount = ipod.trackCount;
        } finally {
          ipod.close();
        }
      } catch {
        // Database exists but couldn't be read - that's fine, we're resetting anyway
      }
    }

    const actionVerb = hasDb ? 'recreate' : 'create';
    const actionVerbPast = hasDb ? 'recreated' : 'created';
    const actionVerbIng = hasDb ? 'Recreating' : 'Creating';

    if (options.dryRun) {
      out.result<DeviceResetOutput>(
        { success: true, mountPoint: devicePath, tracksRemoved: currentTrackCount, dryRun: true },
        () => {
          out.print('Dry run - would perform the following:');
          out.newline();
          if (hasDb) {
            out.print(`  1. Remove existing database (${formatNumber(currentTrackCount)} tracks)`);
            out.print('  2. Create fresh iTunesDB');
          } else {
            out.print('  1. Create new iTunesDB (no existing database found)');
          }
          out.print(`  ${hasDb ? '3' : '2'}. Preserve filesystem and volume UUID`);
          out.newline();
          out.print('No changes made.');
        }
      );
      return;
    }

    // Strong confirmation (defaults to No) - only needed if there's content to lose
    if (!autoConfirm && out.isText) {
      out.newline();
      if (hasDb) {
        out.print('WARNING: This will recreate the iPod database from scratch.');
        out.print('All tracks, playlists, and play counts will be lost.');
        if (currentTrackCount > 0) {
          out.print(`Currently: ${formatNumber(currentTrackCount)} tracks`);
        }
        out.newline();
        out.print('Your device configuration in podkit will remain valid.');
        out.newline();

        const confirmed = await confirmNo('Continue?');
        if (!confirmed) {
          out.print('Cancelled. No changes made.');
          return;
        }
      } else {
        out.print('No existing database found. A fresh database will be created.');
        out.newline();
      }
    }

    out.print(`${actionVerbIng} database...`);

    try {
      const ipod = await IpodDatabase.initializeIpod(devicePath);
      const modelName = ipod.device.modelName;
      ipod.close();

      out.result<DeviceResetOutput>(
        { success: true, mountPoint: devicePath, modelName, tracksRemoved: currentTrackCount },
        () => {
          out.newline();
          out.print(`Database ${actionVerbPast}.`);
          out.print(`  Model:  ${modelName}`);
          out.print(`  Tracks: 0`);
          out.print(`  Path:   ${devicePath}`);
          if (currentTrackCount > 0) {
            out.newline();
            out.print(`Removed ${formatNumber(currentTrackCount)} tracks.`);
          }
          out.newline();
          out.print('You can now sync fresh content:');
          out.print('  podkit sync');
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.result<DeviceResetOutput>(
        { success: false, mountPoint: devicePath, error: message },
        () => out.error(`Failed to ${actionVerb} iPod database: ${message}`)
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Eject subcommand
// =============================================================================

interface EjectOptions {
  force?: boolean;
}

const ejectSubcommand = new Command('eject')
  .alias('unmount')
  .description('safely unmount a device')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (options: EjectOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const force = options.force ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceEjectOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceEjectOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      out.result<DeviceEjectOutput>(
        { success: false, error: `Eject is not supported on ${manager.platform}` },
        () => {
          out.error(`Eject is not supported on ${manager.platform}.`);
          out.newline();
          out.error(manager.getManualInstructions('eject'));
        }
      );
      process.exitCode = 1;
      return;
    }

    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceEjectOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    const deviceLabel = isMassStorageDevice(resolvedDevice?.config?.type)
      ? getDeviceTypeDisplayName(resolvedDevice?.config?.type)
      : 'iPod';

    if (!existsSync(devicePath)) {
      out.result<DeviceEjectOutput>(
        { success: false, device: devicePath, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`${deviceLabel} not found at: ${devicePath}`);
          out.newline();
          out.error(`Make sure the ${deviceLabel.toLowerCase()} is connected and mounted.`);
        }
      );
      process.exitCode = 1;
      return;
    }

    out.print(`Ejecting ${deviceLabel} at ${devicePath}...`);

    const result = await manager.eject(devicePath, { force });

    if (result.success) {
      out.result<DeviceEjectOutput>(
        { success: true, device: devicePath, forced: result.forced },
        () => out.success(`${deviceLabel} ejected successfully. Safe to disconnect.`)
      );
    } else {
      out.result<DeviceEjectOutput>(
        { success: false, device: devicePath, forced: result.forced, error: result.error },
        () => {
          out.error(`Failed to eject ${deviceLabel.toLowerCase()}.`);
          out.newline();
          if (result.error) {
            out.error(result.error);
          }
          if (!force) {
            out.newline();
            out.error('Try: podkit device eject --force');
          }
        }
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Mount subcommand
// =============================================================================

interface MountOptions {
  disk?: string;
  target?: string;
  dryRun?: boolean;
}

const mountSubcommand = new Command('mount')
  .description('mount a device')
  .option('--disk <identifier>', 'disk identifier (e.g., /dev/disk4s2)')
  .option('--target <path>', 'mount point path (default: /tmp/podkit-{volumeName})')
  .option('--dry-run', 'show mount command without executing')
  .action(async (options: MountOptions) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    const explicitDisk = options.disk;
    const dryRun = options.dryRun ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved && !explicitDisk) {
      out.result<DeviceMountOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const resolvedDevice = 'resolvedDevice' in resolved ? resolved.resolvedDevice : undefined;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceMountOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      out.result<DeviceMountOutput>(
        { success: false, error: `Mount is not supported on ${manager.platform}` },
        () => {
          out.error(`Mount is not supported on ${manager.platform}.`);
          out.newline();
          out.error(manager.getManualInstructions('mount'));
        }
      );
      process.exitCode = 1;
      return;
    }

    let deviceId: string | undefined;
    let volumeName: string | undefined;

    if (explicitDisk) {
      deviceId = explicitDisk;
    } else {
      const volumeUuid = resolvedDevice?.config.volumeUuid;

      if (volumeUuid) {
        const deviceIdentity = getDeviceIdentity(resolvedDevice);
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));

        const device = await manager.findByVolumeUuid(volumeUuid);

        if (!device) {
          const devLabel = getDeviceLabel(resolvedDevice?.config?.type);
          out.result<DeviceMountOutput>(
            { success: false, error: `${devLabel} not found with UUID: ${volumeUuid}` },
            () => {
              out.error(`${devLabel} not found with UUID: ${volumeUuid}`);
              out.newline();
              out.error(`Make sure the ${devLabel.toLowerCase()} is connected.`);
              out.newline();
              out.error('You can specify a device explicitly:');
              out.error('  podkit device mount --disk /dev/disk4s2');
            }
          );
          process.exitCode = 1;
          return;
        }

        if (device.isMounted && device.mountPoint) {
          out.result<DeviceMountOutput>(
            { success: true, device: device.identifier, mountPoint: device.mountPoint },
            () => out.print(`Device already mounted at: ${device.mountPoint}`)
          );
          return;
        }

        deviceId = device.identifier;
        volumeName = device.volumeName;
      } else {
        out.result<DeviceMountOutput>(
          { success: false, error: 'No device specified and no device registered in config' },
          () => {
            out.error('No device specified and no device registered in config.');
            out.newline();
            out.error('Either specify a device:');
            out.error('  podkit device mount --disk /dev/disk4s2');
            out.newline();
            out.error('Or register a device first:');
            out.error('  podkit device add -d <name>');
          }
        );
        process.exitCode = 1;
        return;
      }
    }

    if (!dryRun) {
      const displayName = volumeName || deviceId;
      const devLabel = getDeviceLabel(resolvedDevice?.config?.type);
      out.print(`Mounting ${devLabel}: ${displayName}...`);
    }

    const mountTarget = options.target ?? (volumeName ? `/tmp/podkit-${volumeName}` : undefined);

    const result = await manager.mount(deviceId, {
      target: mountTarget,
      dryRun,
    });

    if (dryRun) {
      out.result<DeviceMountOutput>(
        {
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
          dryRunCommand: result.dryRunCommand,
        },
        () => {
          out.print('Dry run - command that would be executed:');
          out.print(`  ${result.dryRunCommand}`);
          if (result.mountPoint) {
            out.print(`  Mount point: ${result.mountPoint}`);
          }
        }
      );
      return;
    }

    if (result.requiresSudo) {
      const assessment = result.assessment;
      out.result<DeviceMountOutput>(
        {
          success: false,
          device: deviceId,
          error: 'Mount requires elevated privileges',
          requiresSudo: true,
          dryRunCommand: result.dryRunCommand,
          assessment,
        },
        () => {
          const displayName = assessment?.volumeName ?? deviceId;
          const diskId = assessment?.diskIdentifier ?? deviceId;
          out.error(`Mount failed for ${displayName} (${diskId})`);
          out.newline();

          if (assessment?.iFlash.confirmed) {
            out.error('iFlash storage detected:');
            for (const evidence of assessment.iFlash.evidence) {
              out.error(`  • ${evidence.signal}: ${evidence.value}`);
              out.error(`    ${evidence.detail}`);
            }
            out.newline();
            out.error('macOS refuses to automatically mount large FAT32 volumes created by');
            out.error('iFlash adapters. Elevated privileges are required to bypass this.');
          } else {
            out.error('This device requires elevated privileges to mount.');
          }

          out.newline();
          out.error('Run:');
          out.error(`  ${bold('sudo')} podkit device mount`);

          out.printTips({ mountRequiresSudo: true });
        }
      );
      process.exitCode = 1;
      return;
    }

    if (result.success) {
      out.result<DeviceMountOutput>(
        { success: true, device: deviceId, mountPoint: result.mountPoint },
        () => {
          const devLabel = getDeviceLabel(resolvedDevice?.config?.type);
          out.print(`${devLabel} mounted at: ${result.mountPoint}`);
          out.newline();
          out.print('You can now use:');
          out.print(`  podkit device info`);
          out.print(`  podkit sync`);
        }
      );
    } else {
      out.result<DeviceMountOutput>(
        { success: false, device: deviceId, error: result.error },
        () => {
          out.error(
            `Failed to mount ${getDeviceLabel(resolvedDevice?.config?.type).toLowerCase()}.`
          );
          out.newline();
          if (result.error) {
            out.error(result.error);
          }
        }
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Init subcommand
// =============================================================================

interface InitOptions {
  force?: boolean;
  yes?: boolean;
}

const initSubcommand = new Command('init')
  .description('initialize iPod database on a device')
  .option('-f, --force', 'overwrite existing database')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (options: InitOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const autoConfirm = options.yes ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceInitOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    // Gate: this command only works with iPod devices (requires iTunesDB)
    const resolvedType = resolvedDevice?.config?.type;
    if (resolvedType && resolvedType !== 'ipod') {
      const error =
        'This command is only supported for iPod devices. Mass-storage devices do not use an iTunesDB.';
      out.result<DeviceInitOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;
    let checkReadiness: typeof import('@podkit/core').checkReadiness;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      getDeviceManager = core.getDeviceManager;
      checkReadiness = core.checkReadiness;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceInitOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceInitOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceInitOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    // Run readiness check to determine device state
    let readinessLevel: ReadinessLevel | undefined;
    if (manager.isSupported) {
      try {
        const ipods = await manager.findIpodDevices();
        const matchingIpod = ipods.find((d) => d.mountPoint === devicePath);
        if (matchingIpod) {
          const readiness = await checkReadiness({ device: matchingIpod });
          readinessLevel = readiness.level;
        }
      } catch {
        // Fall through to legacy hasDatabase check if readiness fails
      }
    }

    // Branch on readiness level (when available)
    if (readinessLevel) {
      switch (readinessLevel) {
        case 'ready': {
          if (!options.force) {
            out.result<DeviceInitOutput>(
              {
                success: false,
                readinessLevel,
                error: 'Device is already initialized. Use --force to reinitialize.',
              },
              () => {
                out.print('Device is already initialized.');
                out.newline();
                out.print(
                  'Use --force to reinitialize (this will delete all tracks and playlists).'
                );
              }
            );
            process.exitCode = 1;
            return;
          }
          // --force on ready device: proceed with reinit (handled below)
          break;
        }
        case 'needs-init':
          // Proceed with init (handled below)
          break;
        case 'needs-format': {
          const error = 'Device has a partition table but no recognized filesystem.';
          out.result<DeviceInitOutput>({ success: false, readinessLevel, error }, () => {
            out.print('This device has a partition table but no recognized filesystem.');
            out.newline();
            out.print('Automatic formatting is not yet supported by podkit.');
            out.print('To format manually:');
            out.print(
              '  macOS: Open Disk Utility \u2192 Select the device \u2192 Erase \u2192 Format: MS-DOS (FAT32)'
            );
            out.print('  Or: Use iTunes/Finder to restore the iPod');
            out.newline();
            out.print('After formatting, run: podkit device init');
          });
          process.exitCode = 1;
          return;
        }
        case 'needs-partition': {
          const error = 'Device has no partition table. It appears to be completely uninitialized.';
          out.result<DeviceInitOutput>({ success: false, readinessLevel, error }, () => {
            out.print(
              'This device has no partition table. It appears to be completely uninitialized.'
            );
            out.newline();
            out.print('Automatic partitioning is not yet supported by podkit.');
            out.print('To set up manually:');
            out.print(
              '  macOS: Open Disk Utility \u2192 Select the device \u2192 Erase \u2192 Scheme: Master Boot Record, Format: MS-DOS (FAT32)'
            );
            out.print('  Or: Use iTunes/Finder to restore the iPod');
            out.newline();
            out.print('After partitioning and formatting, run: podkit device init');
          });
          process.exitCode = 1;
          return;
        }
        case 'needs-repair': {
          const error =
            'Device database or SysInfo appears corrupt. Run `podkit device reset` to recreate.';
          out.result<DeviceInitOutput>({ success: false, readinessLevel, error }, () => {
            out.error(error);
          });
          process.exitCode = 1;
          return;
        }
        case 'hardware-error': {
          const error =
            'Hardware error detected. Check that the device is properly connected and the cable is working.';
          out.result<DeviceInitOutput>({ success: false, readinessLevel, error }, () => {
            out.error(error);
          });
          process.exitCode = 1;
          return;
        }
        default:
          // Unknown level — fall through to legacy check
          break;
      }
    }

    // Legacy path: readiness not available (unsupported platform) or --force on ready device
    if (!readinessLevel) {
      // Fall back to hasDatabase check
      const hasDb = await IpodDatabase.hasDatabase(devicePath);

      if (hasDb && !options.force) {
        out.result<DeviceInitOutput>(
          { success: false, error: 'Database already exists. Use --force to overwrite.' },
          () => {
            out.error('iPod already has a database. Use --force to reinitialize.');
            out.newline();
            out.error('Warning: This will delete all tracks and playlists!');
          }
        );
        process.exitCode = 1;
        return;
      }
    }

    // Confirm reinit when --force is used
    if (options.force && !autoConfirm && out.isText) {
      out.newline();
      out.print('WARNING: This will delete all existing tracks and playlists!');
      out.newline();
      const confirmed = await confirmNo('Reinitialize the iPod database?');
      if (!confirmed) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    out.print('Initializing iPod database...');

    try {
      const ipod = await IpodDatabase.initializeIpod(devicePath);
      const modelName = ipod.device.modelName;
      ipod.close();

      out.result<DeviceInitOutput>(
        {
          success: true,
          device: resolvedDevice?.name,
          mountPoint: devicePath,
          modelName,
          readinessLevel: readinessLevel ?? undefined,
        },
        () => {
          out.newline();
          out.print(`iPod database initialized successfully.`);
          out.print(`  Model: ${modelName}`);
          out.print(`  Path:  ${devicePath}`);
          out.newline();
          out.print('You can now use:');
          out.print('  podkit sync    # Sync content to this device');
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.result<DeviceInitOutput>(
        {
          success: false,
          device: resolvedDevice?.name,
          mountPoint: devicePath,
          readinessLevel: readinessLevel ?? undefined,
          error: message,
        },
        () => out.error(`Failed to initialize iPod database: ${message}`)
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Set subcommand
// =============================================================================

interface SetOptions {
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
  clearQuality?: boolean;
  clearAudioQuality?: boolean;
  clearVideoQuality?: boolean;
  clearEncoding?: boolean;
  clearArtwork?: boolean;
  artworkMaxResolution?: string;
  artworkSources?: string[];
  supportedAudioCodecs?: string[];
  supportsVideo?: boolean;
  musicDir?: string;
  moviesDir?: string;
  tvShowsDir?: string;
  clearArtworkMaxResolution?: boolean;
  clearArtworkSources?: boolean;
  clearSupportedAudioCodecs?: boolean;
  clearSupportsVideo?: boolean;
  clearMusicDir?: boolean;
  clearMoviesDir?: boolean;
  clearTvShowsDir?: boolean;
  cleanArtists?: boolean;
  clearCleanArtists?: boolean;
}

const setSubcommand = new Command('set')
  .description('update device settings (quality, artwork)')
  .addOption(
    new Option('--quality <preset>', 'transcoding quality preset').choices([...QUALITY_PRESETS])
  )
  .addOption(
    new Option('--audio-quality <preset>', 'audio quality (overrides --quality)').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(
    new Option('--video-quality <preset>', 'video quality (overrides --quality)').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(new Option('--encoding <mode>', 'encoding mode').choices([...ENCODING_MODES]))
  .option('--artwork', 'sync artwork to this device')
  .option('--no-artwork', 'do not sync artwork to this device')
  .option('--clear-quality', 'remove quality setting (use global default)')
  .option('--clear-audio-quality', 'remove audio quality setting (use global default)')
  .option('--clear-video-quality', 'remove video quality setting (use global default)')
  .option('--clear-encoding', 'remove encoding setting (use global default)')
  .option('--clear-artwork', 'remove artwork setting (use global default)')
  .option(
    '--artwork-max-resolution <pixels>',
    'max artwork resolution in pixels (mass-storage only)'
  )
  .option(
    '--artwork-sources <sources...>',
    'artwork sources: database, embedded, sidecar (mass-storage only)'
  )
  .option('--supported-audio-codecs <codecs...>', 'supported audio codecs (mass-storage only)')
  .option('--supports-video', 'device supports video playback (mass-storage only)')
  .option('--no-supports-video', 'device does not support video playback (mass-storage only)')
  .option('--music-dir <name>', 'music directory name on device (mass-storage only)')
  .option('--movies-dir <name>', 'movies directory name on device (mass-storage only)')
  .option('--tv-shows-dir <name>', 'TV shows directory name on device (mass-storage only)')
  .option(
    '--clear-artwork-max-resolution',
    'remove artwork resolution override (use preset default)'
  )
  .option('--clear-artwork-sources', 'remove artwork sources override (use preset default)')
  .option('--clear-supported-audio-codecs', 'remove audio codecs override (use preset default)')
  .option('--clear-supports-video', 'remove video support override (use preset default)')
  .option('--clear-music-dir', 'remove music directory override (use default "Music")')
  .option('--clear-movies-dir', 'remove movies directory override (use default "Video/Movies")')
  .option('--clear-tv-shows-dir', 'remove TV shows directory override (use default "Video/Shows")')
  .option('--clean-artists', 'enable clean artists transform')
  .option('--no-clean-artists', 'disable clean artists transform')
  .option('--clear-clean-artists', 'remove clean artists setting (use global default)')
  .action(async (options: SetOptions) => {
    const { config, globalOpts, configResult } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const name = globalOpts.device;

    if (!name) {
      const error =
        'Missing required --device flag. Usage: podkit device set -d <name> --quality <preset>';
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const devices = config.devices || {};
    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      out.result<DeviceSetOutput>({ success: false, error }, () => {
        out.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          out.error(`Available devices: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    // Validate quality options
    if (options.quality !== undefined && !QUALITY_PRESETS.includes(options.quality as any)) {
      const error = `Invalid quality preset "${options.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.audioQuality !== undefined &&
      !QUALITY_PRESETS.includes(options.audioQuality as any)
    ) {
      const error = `Invalid audio quality preset "${options.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.videoQuality !== undefined &&
      !VIDEO_QUALITY_PRESETS.includes(options.videoQuality as any)
    ) {
      const error = `Invalid video quality preset "${options.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.encoding !== undefined &&
      options.encoding !== 'vbr' &&
      options.encoding !== 'cbr'
    ) {
      const error = `Invalid encoding mode "${options.encoding}". Valid values: vbr, cbr`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    // Validate capability override options
    if (options.artworkMaxResolution !== undefined) {
      const parsed = parseInt(options.artworkMaxResolution, 10);
      if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
        const error = `Invalid --artwork-max-resolution value "${options.artworkMaxResolution}". Must be a positive integer between 1 and 10000.`;
        out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
        process.exitCode = 1;
        return;
      }
    }
    if (options.artworkSources !== undefined) {
      for (const source of options.artworkSources) {
        if (!ARTWORK_SOURCES.includes(source as any)) {
          const error = `Invalid artwork source "${source}". Valid values: ${ARTWORK_SOURCES.join(', ')}`;
          out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
          process.exitCode = 1;
          return;
        }
      }
    }
    if (options.supportedAudioCodecs !== undefined) {
      for (const codec of options.supportedAudioCodecs) {
        if (!AUDIO_CODECS.includes(codec as any)) {
          const error = `Invalid audio codec "${codec}". Valid values: ${AUDIO_CODECS.join(', ')}`;
          out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
          process.exitCode = 1;
          return;
        }
      }
    }

    // Validate mass-storage-only options are not set on iPod devices
    const deviceConfig = devices[name]!;
    const isMassStorage = isMassStorageDevice(deviceConfig.type);
    const massStorageOptions = [
      options.artworkMaxResolution,
      options.artworkSources,
      options.supportedAudioCodecs,
      options.supportsVideo,
      options.musicDir,
      options.moviesDir,
      options.tvShowsDir,
      options.clearArtworkMaxResolution,
      options.clearArtworkSources,
      options.clearSupportedAudioCodecs,
      options.clearSupportsVideo,
      options.clearMusicDir,
      options.clearMoviesDir,
      options.clearTvShowsDir,
    ];
    if (!isMassStorage && massStorageOptions.some((o) => o !== undefined)) {
      const error =
        'Capability overrides and content path options are only valid for mass-storage devices (echo-mini, rockbox, generic).';
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    // Build updates object (null means remove the setting)
    const updates: Record<string, string | number | boolean | string[] | null> = {};

    if (options.clearQuality) {
      updates.quality = null;
    } else if (options.quality !== undefined) {
      updates.quality = options.quality;
    }

    if (options.clearAudioQuality) {
      updates.audioQuality = null;
    } else if (options.audioQuality !== undefined) {
      updates.audioQuality = options.audioQuality;
    }

    if (options.clearVideoQuality) {
      updates.videoQuality = null;
    } else if (options.videoQuality !== undefined) {
      updates.videoQuality = options.videoQuality;
    }

    if (options.clearEncoding) {
      updates.encoding = null;
    } else if (options.encoding !== undefined) {
      updates.encoding = options.encoding;
    }

    if (options.clearArtwork) {
      updates.artwork = null;
    } else if (options.artwork !== undefined) {
      updates.artwork = options.artwork;
    }

    if (options.clearArtworkMaxResolution) {
      updates.artworkMaxResolution = null;
    } else if (options.artworkMaxResolution !== undefined) {
      updates.artworkMaxResolution = parseInt(options.artworkMaxResolution, 10);
    }

    if (options.clearArtworkSources) {
      updates.artworkSources = null;
    } else if (options.artworkSources !== undefined) {
      updates.artworkSources = options.artworkSources;
    }

    if (options.clearSupportedAudioCodecs) {
      updates.supportedAudioCodecs = null;
    } else if (options.supportedAudioCodecs !== undefined) {
      updates.supportedAudioCodecs = options.supportedAudioCodecs;
    }

    if (options.clearSupportsVideo) {
      updates.supportsVideo = null;
    } else if (options.supportsVideo !== undefined) {
      updates.supportsVideo = options.supportsVideo;
    }

    if (options.clearMusicDir) {
      updates.musicDir = null;
    } else if (options.musicDir !== undefined) {
      updates.musicDir = options.musicDir;
    }

    if (options.clearMoviesDir) {
      updates.moviesDir = null;
    } else if (options.moviesDir !== undefined) {
      updates.moviesDir = options.moviesDir;
    }

    if (options.clearTvShowsDir) {
      updates.tvShowsDir = null;
    } else if (options.tvShowsDir !== undefined) {
      updates.tvShowsDir = options.tvShowsDir;
    }

    if (options.clearCleanArtists) {
      updates.cleanArtists = null;
    } else if (options.cleanArtists !== undefined) {
      updates.cleanArtists = options.cleanArtists;
    }

    if (Object.keys(updates).length === 0) {
      const error =
        'No settings to update. Specify at least one option (--quality, --audio-quality, --video-quality, --encoding, --artwork, --clean-artists, capability overrides, --music-dir, --movies-dir, --tv-shows-dir, or --clear-* variants).';
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = updateDevice(name, updates, { configPath });

    if (!result.success) {
      out.result<DeviceSetOutput>({ success: false, error: result.error }, () =>
        out.error(`Failed to update device: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    out.result<DeviceSetOutput>({ success: true, device: name, updated: updates }, () => {
      const changes: string[] = [];
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          changes.push(`  ${key}: cleared (will use global default)`);
        } else {
          changes.push(`  ${key}: ${value}`);
        }
      }
      out.print(`Updated device "${name}":`);
      for (const change of changes) {
        out.print(change);
      }
    });
  });

// =============================================================================
// Default subcommand
// =============================================================================

const defaultSubcommand = new Command('default')
  .description('set or clear the default device')
  .option('--clear', 'clear the default device')
  .action(async (options: { clear?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();
    const name = globalOpts.device;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    if (options.clear) {
      // Clear the default
      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const result = setDefaultDevice('', { configPath });

      if (!result.success) {
        out.result<DeviceDefaultOutput>({ success: false, error: result.error }, () =>
          out.error(`Failed to clear default device: ${result.error}`)
        );
        process.exitCode = 1;
        return;
      }

      out.result<DeviceDefaultOutput>({ success: true, cleared: true }, () =>
        out.print('Cleared default device.')
      );
      return;
    }

    if (!name) {
      // Show current default
      const defaultDevice = config.defaults?.device;
      out.result<DeviceDefaultOutput>({ success: true, device: defaultDevice }, () => {
        if (defaultDevice) {
          out.print(`Default device: ${defaultDevice}`);
        } else {
          out.print('No default device set.');
        }
      });
      return;
    }

    // Set default
    const devices = config.devices || {};
    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      out.result<DeviceDefaultOutput>({ success: false, error }, () => {
        out.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          out.error(`Available devices: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = setDefaultDevice(name, { configPath });

    if (!result.success) {
      out.result<DeviceDefaultOutput>({ success: false, error: result.error }, () =>
        out.error(`Failed to set default device: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    out.result<DeviceDefaultOutput>({ success: true, device: name }, () =>
      out.print(`Set "${name}" as the default device.`)
    );
  });

// =============================================================================
// Reset artwork subcommand
// =============================================================================

interface ResetArtworkOptions {
  yes?: boolean;
  dryRun?: boolean;
}

interface DeviceResetArtworkOutput {
  success: boolean;
  tracksCleared?: number;
  totalTracks?: number;
  orphanedFilesRemoved?: number;
  dryRun?: boolean;
  error?: string;
}

const resetArtworkSubcommand = new Command('reset-artwork')
  .description('wipe all artwork and clear artwork sync tags')
  .option('-y, --yes', 'skip confirmation prompt')
  .option('--dry-run', 'show what would happen without making changes')
  .action(async (options: ResetArtworkOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const autoConfirm = options.yes ?? false;
    const dryRun = options.dryRun ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceResetArtworkOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    // Gate: this command only works with iPod devices (requires iTunesDB)
    const resolvedType = resolvedDevice?.config?.type;
    if (resolvedType && resolvedType !== 'ipod') {
      const error =
        'This command is only supported for iPod devices. Mass-storage devices do not use an iTunesDB.';
      out.result<DeviceResetArtworkOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;
    let resetArtworkDatabase: typeof import('@podkit/core').resetArtworkDatabase;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      getDeviceManager = core.getDeviceManager;
      resetArtworkDatabase = core.resetArtworkDatabase;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceResetArtworkOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceResetArtworkOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceResetArtworkOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    // Open database to get track count for confirmation message
    let db: Awaited<ReturnType<typeof IpodDatabase.open>>;
    try {
      db = await IpodDatabase.open(devicePath);
    } catch (err) {
      out.result<DeviceResetArtworkOutput>(
        {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to open iPod database',
        },
        () => out.error(err instanceof Error ? err.message : 'Failed to open iPod database')
      );
      process.exitCode = 1;
      return;
    }

    const trackCount = db.trackCount;

    // Confirmation prompt (destructive operation — default to NO)
    if (!dryRun && !autoConfirm && out.isText) {
      out.print(`This will remove all artwork from ${trackCount.toLocaleString()} tracks`);
      out.print('and clear artwork sync tags so the next sync re-adds artwork.');
      out.newline();

      const confirmed = await confirmNo('Reset artwork database?');
      if (!confirmed) {
        db.close();
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    try {
      const result = await resetArtworkDatabase(db, devicePath, { dryRun });

      const output: DeviceResetArtworkOutput = {
        success: true,
        tracksCleared: result.tracksCleared,
        totalTracks: result.totalTracks,
        orphanedFilesRemoved: result.orphanedFilesRemoved,
        dryRun,
      };

      out.result<DeviceResetArtworkOutput>(output, () => {
        if (dryRun) {
          out.print(
            `Dry run: would clear artwork from ${result.tracksCleared.toLocaleString()} of ${result.totalTracks.toLocaleString()} tracks.`
          );
        } else {
          out.success(
            `Cleared artwork from ${result.tracksCleared.toLocaleString()} of ${result.totalTracks.toLocaleString()} tracks.`
          );
          if (result.orphanedFilesRemoved > 0) {
            out.print(
              `Cleaned up ${result.orphanedFilesRemoved} orphaned .ithmb file${result.orphanedFilesRemoved === 1 ? '' : 's'}.`
            );
          }
          out.newline();
          out.print('The next `podkit sync` will re-add artwork from your source collection.');
        }
      });
    } catch (err) {
      out.result<DeviceResetArtworkOutput>(
        {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        },
        () => out.error(`Reset artwork failed: ${err instanceof Error ? err.message : String(err)}`)
      );
      process.exitCode = 1;
    } finally {
      db.close();
    }
  });

// =============================================================================
// Main device command
// =============================================================================

export const deviceCommand = new Command('device')
  .description('manage devices')
  .addCommand(scanSubcommand)
  .addCommand(listSubcommand)
  .addCommand(addSubcommand)
  .addCommand(removeSubcommand)
  .addCommand(setSubcommand)
  .addCommand(defaultSubcommand)
  .addCommand(infoSubcommand)
  .addCommand(musicSubcommand)
  .addCommand(videoSubcommand)
  .addCommand(clearSubcommand)
  .addCommand(resetSubcommand)
  .addCommand(resetArtworkSubcommand)
  .addCommand(ejectSubcommand)
  .addCommand(mountSubcommand)
  .addCommand(initSubcommand)
  .action(async () => {
    // Default action: run list subcommand
    await listSubcommand.parseAsync([], { from: 'user' });
  });
