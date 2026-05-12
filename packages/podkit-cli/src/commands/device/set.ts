/**
 * `podkit device set` — update device settings (quality, artwork, capabilities).
 */
import { Command, Option } from 'commander';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import {
  updateDevice,
  DEFAULT_CONFIG_PATH,
  QUALITY_PRESETS,
  VIDEO_QUALITY_PRESETS,
  ENCODING_MODES,
} from '../../config/index.js';
import { validateCapabilityOverrides } from '@podkit/devices-mass-storage';
import { OutputContext } from '../../output/index.js';
import { isMassStorageDevice } from '../open-device.js';
import { DeviceErrorCodes } from './error-codes.js';
import type { DeviceSetOutput } from './output-types.js';

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

export const setSubcommand = new Command('set')
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

    await runAction(out, async () => {
      if (!name) {
        throw new CliError({
          message:
            'Missing required --device flag. Usage: podkit device set -d <name> --quality <preset>',
          code: DeviceErrorCodes.DEVICE_REQUIRED,
        });
      }

      const devices = config.devices || {};
      if (!(name in devices)) {
        const error = `Device "${name}" not found in config.`;
        throw new CliError({
          message: error,
          code: DeviceErrorCodes.DEVICE_NOT_FOUND,
          printText: (o) => {
            o.error(error);
            const available = Object.keys(devices);
            if (available.length > 0) {
              o.error(`Available devices: ${available.join(', ')}`);
            }
          },
        });
      }

      // Validate quality options
      if (options.quality !== undefined && !QUALITY_PRESETS.includes(options.quality as any)) {
        throw new CliError({
          message: `Invalid quality preset "${options.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
          code: DeviceErrorCodes.INVALID_QUALITY,
        });
      }
      if (
        options.audioQuality !== undefined &&
        !QUALITY_PRESETS.includes(options.audioQuality as any)
      ) {
        throw new CliError({
          message: `Invalid audio quality preset "${options.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`,
          code: DeviceErrorCodes.INVALID_AUDIO_QUALITY,
        });
      }
      if (
        options.videoQuality !== undefined &&
        !VIDEO_QUALITY_PRESETS.includes(options.videoQuality as any)
      ) {
        throw new CliError({
          message: `Invalid video quality preset "${options.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`,
          code: DeviceErrorCodes.INVALID_VIDEO_QUALITY,
        });
      }
      if (
        options.encoding !== undefined &&
        options.encoding !== 'vbr' &&
        options.encoding !== 'cbr'
      ) {
        throw new CliError({
          message: `Invalid encoding mode "${options.encoding}". Valid values: vbr, cbr`,
          code: DeviceErrorCodes.INVALID_ENCODING,
        });
      }

      // Validate capability override options
      const capabilityOverridePatch: Parameters<typeof validateCapabilityOverrides>[0] = {};
      if (options.artworkMaxResolution !== undefined) {
        capabilityOverridePatch.artworkMaxResolution = parseInt(options.artworkMaxResolution, 10);
      }
      if (options.artworkSources !== undefined) {
        capabilityOverridePatch.artworkSources = options.artworkSources as any;
      }
      if (options.supportedAudioCodecs !== undefined) {
        capabilityOverridePatch.supportedAudioCodecs = options.supportedAudioCodecs as any;
      }
      const capabilityValidation = validateCapabilityOverrides(capabilityOverridePatch);
      if (!capabilityValidation.ok) {
        const [first] = capabilityValidation.errors;
        if (first) {
          throw new CliError({
            message: first.message,
            code: DeviceErrorCodes[first.code as keyof typeof DeviceErrorCodes],
          });
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
        throw new CliError({
          message:
            'Capability overrides and content path options are only valid for mass-storage devices (echo-mini, rockbox, generic).',
          code: DeviceErrorCodes.INVALID_OPTION_FOR_TYPE,
        });
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
        throw new CliError({
          message:
            'No settings to update. Specify at least one option (--quality, --audio-quality, --video-quality, --encoding, --artwork, --clean-artists, capability overrides, --music-dir, --movies-dir, --tv-shows-dir, or --clear-* variants).',
          code: DeviceErrorCodes.NO_UPDATES,
        });
      }

      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const result = updateDevice(name, updates, { configPath });

      if (!result.success) {
        const errMsg = result.error ?? 'Failed to update device';
        throw new CliError({
          message: errMsg,
          code: DeviceErrorCodes.CONFIG_SAVE_FAILED,
          printText: (o) => o.error(`Failed to update device: ${errMsg}`),
        });
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
  });
