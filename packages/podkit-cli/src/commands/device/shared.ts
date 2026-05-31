/**
 * Shared helpers for the `podkit device` command family.
 *
 * Error codes live in `./error-codes.ts`; JSON output shapes live in
 * `./output-types.ts`. This file holds the cross-subcommand helpers and
 * `DeviceOpDeps` (the dep-injection seam shared by clear/reset/init/
 * reset-artwork).
 */
import { statfsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { parseCliDeviceArg, resolveEffectiveDevice } from '../../device-resolver.js';
import type { ResolvedDevice } from '../../device-resolver.js';
import { CliError } from '../../errors.js';
import { DeviceErrorCodes } from './error-codes.js';
import {
  type DisplayTrack,
  type FieldName,
  AVAILABLE_FIELDS,
  DEFAULT_FIELDS,
  escapeCsv,
} from '../display-utils.js';
import { formatNumber } from '../../output/index.js';
import type { DeviceTrack, DeviceAssessment, IFlashEvidence } from '@podkit/core';
import type { DeviceConfig } from '../../config/index.js';
import type { CoreLoaderDeps, IpodDatabaseStub } from '../../handler-deps.js';

/**
 * Dependency injection seam shared by `clear`, `reset`, `init`, and
 * `reset-artwork`. Each of these handlers happens to be iPod-only (they
 * gate with an `IPOD_ONLY` check internally), but the dep shape itself is
 * generic: a device manager + a yes/no prompt for destructive actions.
 *
 * `confirm` overrides the destructive prompt. The default is `confirmNo`
 * (safe default = NO for destructive operations). Tests inject a function
 * that returns `true`/`false` to exercise both branches deterministically.
 */
export interface DeviceOpDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  confirm?: (msg: string) => Promise<boolean>;
  /**
   * Override `core.IpodDatabase` (the static surface used by clear/reset/
   * init/reset-artwork). Tests pass a fake — see `IpodDatabaseStub`.
   */
  ipodDatabase?: IpodDatabaseStub;
  /**
   * Override `core.resetArtworkDatabase`. Only consulted by
   * `runDeviceResetArtwork`; harmless on the other runners.
   */
  resetArtworkDatabase?: typeof import('@podkit/core').resetArtworkDatabase;
}

// =============================================================================
// Cross-subcommand helpers
// =============================================================================

/**
 * Resolve a device name from the two equivalent forms — the subcommand's
 * positional argument and the program-level `-d <name>` flag.
 *
 * Both forms are equally valid: `podkit device add terapod` and
 * `podkit -d terapod device add` produce the same outcome. When both are
 * given and agree (`-d terapod device add terapod`) that's accepted — the
 * user is being explicit, not making a mistake. When they disagree the
 * call is rejected so a typo can't silently win.
 *
 * @param positional - the value the subcommand received as `<name>`
 * @param globalDeviceArg - the program-level `-d <name>` value (or path; the
 *   caller validates name-shape separately if it matters)
 * @param commandLabel - the subcommand label used in error messages, e.g.
 *   `'add'`, `'remove'` — yields "Usage: podkit device add <name>" output
 */
export function resolveDeviceName(
  positional: string | undefined,
  globalDeviceArg: string | undefined,
  commandLabel: string
): string {
  // Treat empty / whitespace-only as missing — `device add ""` and
  // `device add "   "` should both surface the same DEVICE_REQUIRED
  // message the entirely-absent case gets, not slip through to the
  // downstream regex / lookup with a misleading code.
  const trimmedPositional = positional?.trim() || undefined;
  const trimmedGlobal = globalDeviceArg?.trim() || undefined;
  if (
    trimmedPositional !== undefined &&
    trimmedGlobal !== undefined &&
    trimmedPositional !== trimmedGlobal
  ) {
    throw new CliError({
      message: `Conflicting device names: positional "${trimmedPositional}" vs -d "${trimmedGlobal}". Pass only one.`,
      code: DeviceErrorCodes.DEVICE_ARG_CONFLICT,
    });
  }
  const name = trimmedPositional ?? trimmedGlobal;
  if (!name) {
    throw new CliError({
      message: `Missing device name. Usage: podkit device ${commandLabel} <name>  (or: podkit -d <name> device ${commandLabel}).`,
      code: DeviceErrorCodes.DEVICE_REQUIRED,
    });
  }
  return name;
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

/**
 * Map a DeviceTrack (from any adapter) to a DisplayTrack for output formatting.
 */
export function deviceTrackToDisplayTrack(t: DeviceTrack): DisplayTrack {
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
export function deviceTrackToFullJson(t: DeviceTrack): Record<string, unknown> {
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
  if (complete > 0) parts.push(`✓ ${formatNumber(complete)} consistent`);
  if (missingArt > 0) parts.push(`◐ ${formatNumber(missingArt)} missing artwork hash`);
  if (noTag > 0) parts.push(`✗ ${formatNumber(noTag)} no sync tag`);
  if (missingTransfer !== undefined && missingTransfer > 0)
    parts.push(`◐ ${formatNumber(missingTransfer)} missing transfer mode`);

  // No sync tag data at all
  if (parts.length === 0) return tracksStr;

  // All consistent — just show the checkmark after track count
  if (parts.length === 1 && complete > 0 && complete === trackCount) {
    return `${tracksStr} ✓ all consistent`;
  }

  // All tags, none with art hash (single non-zero category)
  if (parts.length === 1 && noTag === trackCount) {
    return `${tracksStr} (✗ no sync tags)`;
  }

  return `${tracksStr} (${parts.join(', ')})`;
}

export type DeviceArgResult =
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
export function resolveDeviceArg(): DeviceArgResult {
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
// Display utility re-exports
// =============================================================================

export type { DisplayTrack, FieldName };
export { AVAILABLE_FIELDS, DEFAULT_FIELDS };

// =============================================================================
// Device-specific format helpers
// =============================================================================

/**
 * Helper to escape a single CSV field value.
 */
export function escapeCsvField(value: string): string {
  return escapeCsv(value);
}

/**
 * Map an IpodTrack to a full JSON object with all metadata fields.
 */
export function ipodTrackToFullJson(t: {
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

export function parseFormat(filetype: string | undefined): string {
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
    storage: { sizeBytes: 0 },
    isMounted: true,
    mountPoint,
  };
}

// =============================================================================
// Scan/list helpers (shared across multiple subcommands)
// =============================================================================

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
  if (device.connected) return '● '; // ●
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

// =============================================================================
// iFlash helpers (shared between mount and add)
// =============================================================================

/**
 * Format the iFlash evidence list into a sentence suitable for display.
 * e.g. "2048-byte block size; Capacity exceeds iPod Classic maximum"
 */
export function formatIFlashEvidence(evidence: IFlashEvidence[]): string {
  return evidence.map((e) => e.signal).join('; ');
}

/**
 * Build a multi-line explanation of why macOS cannot mount an iFlash device,
 * including all detected signals with their details.
 */
export function formatIFlashMountExplanation(assessment: DeviceAssessment): string[] {
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
