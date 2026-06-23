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
import type { DeviceTrack, DeviceAssessment, IFlashEvidence, DiscoveredDevice } from '@podkit/core';
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
  /**
   * Override `core.sweepDeviceContent`. Only consulted by `runDeviceReset`
   * (the factory-wipe content sweep); harmless on the other runners. Tests
   * inject a spy to assert the sweep ran (or, in dry-run, did NOT run).
   */
  sweepDeviceContent?: typeof import('@podkit/core').sweepDeviceContent;
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

/**
 * Gate an iPod-only command (clear/reset/reset-artwork/init/rename) on the
 * resolved device's type. iPod commands need an iTunesDB, which mass-storage
 * devices (Echo Mini, Rockbox, generic) don't have.
 *
 * Names the offending device and its type so the error is actionable — this
 * commonly fires when the user's *default* device is a mass-storage one and no
 * `-d` was given, so a generic "only works on iPods" message left them guessing
 * which device was even selected.
 *
 * No-ops when `resolvedDevice` is undefined (path mode via `-d /path`, where the
 * type isn't known until the device is read) or already an iPod.
 */
export function assertIpodDevice(
  resolvedDevice: ResolvedDevice | undefined,
  commandLabel: string
): void {
  const type = resolvedDevice?.config?.type;
  if (type && type !== 'ipod') {
    const name = resolvedDevice?.name;
    const subject = name ? `Device "${name}"` : 'The selected device';
    throw new CliError({
      message:
        `${subject} (type: ${type}) is a mass-storage device with no iTunes database. ` +
        `"podkit device ${commandLabel}" only works on iPods — select one with -d <name>.`,
      code: DeviceErrorCodes.IPOD_ONLY,
    });
  }
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
 * every attached disk via `manager.scan({ kinds: ['ipod'] })` (which on macOS dispatches
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
 * Extract the capability-override subset of a `DeviceConfig` into the
 * `Partial<DeviceCapabilities>` shape the core capability resolvers
 * (`resolveCapabilities`, `resolveCapabilitiesResolved`) accept as
 * `overrides` / `deviceConfigOverrides`. Centralised so `device info`,
 * `device list`, and any future consumer agree on which fields count as
 * capability overrides (`musicDir` / `moviesDir` / `tvShowsDir` are NOT
 * capabilities — they're content paths and live in a different resolver).
 */
export function pickCapabilityOverrides(
  deviceConfig: DeviceConfig
): Partial<import('@podkit/core').DeviceCapabilities> {
  const overrides: Partial<import('@podkit/core').DeviceCapabilities> = {};
  if (deviceConfig.artworkMaxResolution !== undefined) {
    overrides.artworkMaxResolution = deviceConfig.artworkMaxResolution;
  }
  if (deviceConfig.artworkSources !== undefined) {
    overrides.artworkSources = deviceConfig.artworkSources;
  }
  if (deviceConfig.supportedAudioCodecs !== undefined) {
    overrides.supportedAudioCodecs = deviceConfig.supportedAudioCodecs;
  }
  if (deviceConfig.supportsVideo !== undefined) {
    overrides.supportsVideo = deviceConfig.supportsVideo;
  }
  if (deviceConfig.audioNormalization !== undefined) {
    overrides.audioNormalization = deviceConfig.audioNormalization;
  }
  if (deviceConfig.supportsAlbumArtistBrowsing !== undefined) {
    overrides.supportsAlbumArtistBrowsing = deviceConfig.supportsAlbumArtistBrowsing;
  }
  return overrides;
}

/**
 * Match a configured device to its `DiscoveredDevice` entry from a
 * `discoverConnectedDevices` enumeration. Returns `undefined` when no entry
 * matches — the device is offline or wasn't surfaced by the discovery pass.
 *
 * Match priority (first hit wins):
 *
 *   1. **Volume UUID** — `deviceConfig.volumeUuid` vs `block.volumeUuid`
 *      (case-insensitive). Survives replug; canonical match for iPods.
 *   2. **Mount path** — `deviceConfig.path` vs `block.mountPoint` (exact
 *      string compare). Used for mass-storage devices configured by path
 *      and for iPod path mode (`-d /Volumes/IPOD`).
 *   3. **USB serial** — `deviceConfig.volumeUuid` (iPod-side, when the iPod
 *      stores its serial as the volumeUuid surrogate) vs USB-side
 *      `usb.serialNumber`. Catches USB-only entries (powered iPod with no
 *      mounted volume) where the block side is absent.
 *   4. **Sole-match by preset id** — for mass-storage devices configured
 *      WITHOUT a UUID OR path, when exactly one discovered entry has
 *      `kind === 'mass-storage'` with a matching `usb.presetId`, attribute
 *      it to the config. Gated on the absence of stronger signals: if the
 *      config carried a UUID or path that just didn't match, we MUST NOT
 *      silently re-attribute the device to it (two echo-minis, one
 *      disconnected, would otherwise misroute commands to the wrong
 *      config). Strong identity beats preset-class identity.
 */
export function matchConfiguredDeviceToDiscovered(
  deviceConfig: DeviceConfig,
  discovered: readonly DiscoveredDevice[]
): DiscoveredDevice | undefined {
  const configUuid = deviceConfig.volumeUuid?.toUpperCase();
  const configPath = deviceConfig.path;

  // 1. Volume UUID match
  if (configUuid) {
    for (const d of discovered) {
      const blockUuid = d.block?.volumeUuid;
      if (blockUuid && blockUuid.toUpperCase() === configUuid) return d;
    }
  }

  // 2. Mount path match
  if (configPath) {
    for (const d of discovered) {
      if (d.block?.isMounted && d.block.mountPoint === configPath) return d;
    }
  }

  // 3. USB serial match (USB-only entries). Only meaningful when configUuid
  // is populated — for iPods, the stored UUID can be the device's serial
  // surrogate (Apple serial reused as volume UUID), so a USB-only iPod's
  // classification carries a matching serialNumber. configUuid undefined →
  // nothing to compare against; skip.
  if (configUuid) {
    for (const d of discovered) {
      // discovery.ts: ipod/mass-storage `.usb` is an `IpodClassification` /
      // `MassStorageClassification`; the underlying `EnumeratedUsbDevice` (which
      // carries `serialNumber`) is `.usb.device`. Unsupported variants are
      // skipped — they go through the dedicated unsupported-message UI.
      if (d.kind === 'unsupported') continue;
      const serial = d.usb?.device.serialNumber;
      if (serial && serial.toUpperCase() === configUuid) return d;
    }
  }

  // 4. Sole-match by preset id (mass-storage). ONLY when no stronger signal
  // was attempted — if the config had a UUID or path and neither matched,
  // refuse the fallback. Otherwise two echo-minis with UUIDs A and B, only
  // one connected (UUID A), would both resolve to the same discovered
  // device when looking up the other config (the unmatched one falls
  // through to the sole-match and grabs the connected one).
  const presetId = deviceConfig.type;
  if (presetId && presetId !== 'ipod' && !configUuid && !configPath) {
    const matches = discovered.filter(
      (d) => d.kind === 'mass-storage' && d.usb?.presetId === presetId
    );
    if (matches.length === 1) return matches[0];
  }

  return undefined;
}

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
