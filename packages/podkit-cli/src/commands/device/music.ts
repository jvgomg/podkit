/**
 * `podkit device music` — list music on a connected device.
 */
import { Command, Option } from 'commander';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { loadCoreOrFail, type CoreLoaderDeps, type OpenDeviceFn } from '../../handler-deps.js';
import { OUTPUT_FORMATS } from '../../output/formatters.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
} from '../../device-resolver.js';
import { OutputContext } from '../../output/index.js';
import type { DeviceTrack, IpodTrack } from '@podkit/core';
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
} from '../display-utils.js';
import { openDevice, isMassStorageDevice, getDeviceTypeDisplayName } from '../open-device.js';
import { DeviceErrorCodes, type DeviceErrorCode } from './error-codes.js';
import {
  resolveDeviceArg,
  escapeCsvField,
  deviceTrackToDisplayTrack,
  deviceTrackToFullJson,
  ipodTrackToFullJson,
} from './shared.js';

export interface MusicVideoOptions {
  format?: string;
  fields?: string;
  tracks?: boolean;
  albums?: boolean;
  artists?: boolean;
}

/**
 * Dependency injection seam for `runDeviceMusic` (and the sibling video
 * runner). Tests pass stubs to avoid real USB walks and database opens.
 */
export interface DeviceMusicDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  /** Override the `openDevice` helper so tests don't need a real iTunesDB. */
  openDevice?: OpenDeviceFn;
}

export const musicSubcommand = new Command('music')
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
    await runAction(out, () => runDeviceMusic(options, out));
  });

export async function runDeviceMusic(
  options: MusicVideoOptions,
  out: OutputContext,
  deps: DeviceMusicDeps = {}
): Promise<void> {
  const { config, globalOpts } = getContext();
  const format = out.isJson ? 'json' : options.format;
  const mode = options.tracks
    ? 'tracks'
    : options.albums
      ? 'albums'
      : options.artists
        ? 'artists'
        : 'stats';

  const throwCliError = (error: string, code: DeviceErrorCode): never => {
    throw new CliError({
      message: error,
      code,
      printText: (o) => o.error(`Error: ${error}`),
    });
  };

  if (options.fields && mode !== 'tracks') {
    throwCliError('--fields can only be used with --tracks', DeviceErrorCodes.INVALID_OPTION);
  }

  let fields: FieldName[] = DEFAULT_FIELDS;
  try {
    fields = parseFields(options.fields);
  } catch (err) {
    throwCliError(
      err instanceof Error ? err.message : String(err),
      DeviceErrorCodes.INVALID_FIELDS
    );
  }

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throwCliError(resolved.error, DeviceErrorCodes.DEVICE_NOT_RESOLVED);
    return;
  }

  const { resolvedDevice, cliPath } = resolved;

  try {
    const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
    const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
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
      throwCliError(
        resolveResult.error ?? formatDeviceError(resolveResult),
        DeviceErrorCodes.DEVICE_PATH_UNRESOLVED
      );
      return;
    }

    if (!existsSync(resolveResult.path)) {
      const deviceLabel = isMassStorageDevice(resolvedDevice?.config?.type) ? 'Device' : 'iPod';
      throwCliError(
        `${deviceLabel} not found at path: ${resolveResult.path}`,
        DeviceErrorCodes.DEVICE_PATH_NOT_FOUND
      );
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

    const deviceResult = await (deps.openDevice ?? openDevice)(
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
        (deviceResult.isIpodDevice ? 'iPod' : getDeviceTypeDisplayName(resolvedDevice?.config));
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
    if (error instanceof CliError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throwCliError(message, DeviceErrorCodes.MUSIC_LIST_FAILED);
  }
}
