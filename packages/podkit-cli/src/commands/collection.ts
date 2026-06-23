/**
 * Collection command - manage music and video collections
 *
 * Provides subcommands for listing, adding, removing, and viewing
 * music and video collections in the config.
 *
 * @example
 * ```bash
 * podkit collection                                    # list all collections
 * podkit collection list                               # same as above
 * podkit collection list -t music                      # list music collections only
 * podkit collection list -t video                      # list video collections only
 * podkit collection add -t music -c <name> --path <p>  # add a music collection
 * podkit collection add -t video -c <name> --path <p>  # add a video collection
 * podkit collection remove -c <name>                   # remove collection
 * podkit collection info -c <name>                     # display collection details
 * podkit collection music [-c name]                    # list tracks in music collection
 * podkit collection video [-c name]                    # list videos in video collection
 * ```
 */

import { Command, Option } from 'commander';
import * as path from 'node:path';
import { existsSync, statSync } from '../utils/fs.js';
import { confirmNo } from '../utils/confirm.js';
import { getContext } from '../context.js';
import { CliError, runAction, type CliErrorOutput } from '../errors.js';
import {
  addMusicCollection,
  addVideoCollection,
  removeCollection,
  setDefaultCollection,
  DEFAULT_CONFIG_PATH,
  CONTENT_TYPES,
} from '../config/index.js';
import type { MusicCollectionConfig, VideoCollectionConfig } from '../config/types.js';
import { OUTPUT_FORMATS } from '../output/formatters.js';
import {
  type DisplayTrack,
  AVAILABLE_FIELDS,
  parseFields,
  formatTable,
  formatJson,
  formatCsv,
  computeStats,
  formatStatsText,
  aggregateAlbums,
  formatAlbumsTable,
  aggregateArtists,
  formatArtistsTable,
  escapeCsv,
} from './display-utils.js';
import type { CollectionTrack, CollectionVideo } from '@podkit/core';
import { PlaylistNotFoundError, AmbiguousPlaylistError } from '@podkit/core';
import { createMusicAdapter } from '../utils/source-adapter.js';
import {
  resolveMusicCollection,
  resolveVideoCollection,
  findCollectionByName,
  getAllCollections,
  type CollectionType,
  type CollectionInfo,
} from '../resolvers/index.js';
import { OutputContext } from '../output/index.js';

// =============================================================================
// Shared utilities
// =============================================================================

/**
 * Error codes emitted by `podkit collection` (and all subcommands).
 *
 * Exhaustive — every CliError thrown from this command's runners uses one
 * of these. Consumers branching on `output.code` can rely on this union.
 */
export const CollectionErrorCodes = {
  INVALID_TYPE: 'INVALID_TYPE',
  TYPE_REQUIRED: 'TYPE_REQUIRED',
  COLLECTION_REQUIRED: 'COLLECTION_REQUIRED',
  PATH_REQUIRED: 'PATH_REQUIRED',
  INVALID_NAME: 'INVALID_NAME',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  PATH_NOT_DIRECTORY: 'PATH_NOT_DIRECTORY',
  COLLECTION_EXISTS: 'COLLECTION_EXISTS',
  COLLECTION_ADD_FAILED: 'COLLECTION_ADD_FAILED',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  COLLECTION_REMOVE_FAILED: 'COLLECTION_REMOVE_FAILED',
  INVALID_FIELDS_USAGE: 'INVALID_FIELDS_USAGE',
  INVALID_FIELDS: 'INVALID_FIELDS',
  COLLECTION_NOT_RESOLVED: 'COLLECTION_NOT_RESOLVED',
  COLLECTION_PATH_NOT_FOUND: 'COLLECTION_PATH_NOT_FOUND',
  COLLECTION_SCAN_FAILED: 'COLLECTION_SCAN_FAILED',
  DEFAULT_CLEAR_FAILED: 'DEFAULT_CLEAR_FAILED',
  DEFAULT_SET_FAILED: 'DEFAULT_SET_FAILED',
} as const;
export type CollectionErrorCode = (typeof CollectionErrorCodes)[keyof typeof CollectionErrorCodes];

/**
 * Get the config path to use for writing
 */
function getConfigPath(): string {
  const { globalOpts, configResult } = getContext();
  return globalOpts.config ?? configResult.configPath ?? DEFAULT_CONFIG_PATH;
}

// CollectionType and CollectionInfo are imported from resolvers
export type { CollectionType, CollectionInfo } from '../resolvers/index.js';

/**
 * Output structure for JSON format
 */
export interface CollectionListSuccess {
  success: true;
  collections?: CollectionInfo[];
}

export type CollectionListErrorOutput = CliErrorOutput & { code: CollectionErrorCode };
export type CollectionListOutput = CollectionListSuccess | CollectionListErrorOutput;

export interface CollectionShowSuccess {
  success: true;
  collection?: CollectionInfo;
  collections?: CollectionInfo[];
}

export type CollectionShowErrorOutput = CliErrorOutput & { code: CollectionErrorCode };
export type CollectionShowOutput = CollectionShowSuccess | CollectionShowErrorOutput;

export interface CollectionModifySuccess {
  success: true;
  name?: string;
  type?: CollectionType;
  path?: string;
  configPath?: string;
  setAsDefault?: boolean;
}

export type CollectionModifyErrorOutput = CliErrorOutput & { code: CollectionErrorCode };
export type CollectionModifyOutput = CollectionModifySuccess | CollectionModifyErrorOutput;

/**
 * Format collections as a table
 */
function formatCollectionTable(collections: CollectionInfo[]): string {
  if (collections.length === 0) {
    return "No collections configured. Run 'podkit collection add' to add one, or set PODKIT_MUSIC_PATH via environment variable.";
  }

  const lines: string[] = ['Collections:', ''];

  // Calculate column widths
  const typeWidth = Math.max(4, ...collections.map((c) => c.type.length));
  const nameWidth = Math.max(4, ...collections.map((c) => c.name.length));
  // PLAYLIST column: always shown; displays the playlist name or '-' when the collection has no playlist
  const playlistValues = collections.map((c) => c.playlist ?? '-');
  const playlistWidth = Math.max(8, ...playlistValues.map((p) => p.length));

  // Header
  lines.push(
    `  ${'TYPE'.padEnd(typeWidth)}  ${'NAME'.padEnd(nameWidth)}  ${'PLAYLIST'.padEnd(playlistWidth)}  PATH`
  );

  // Data rows
  for (const col of collections) {
    const marker = col.isDefault ? '*' : ' ';
    const displayPath = col.subsonicUrl ?? col.path;
    const displayPlaylist = (col.playlist ?? '-').padEnd(playlistWidth);
    lines.push(
      `${marker} ${col.type.padEnd(typeWidth)}  ${col.name.padEnd(nameWidth)}  ${displayPlaylist}  ${displayPath}`
    );
  }

  lines.push('');
  lines.push('* = default collection');

  return lines.join('\n');
}

// Collection resolution functions are now imported from resolvers module.
// Local wrapper functions for backward compatibility with existing command code.

/**
 * Get all collections from config (wrapper for resolver function)
 */
function getCollections(filterType?: CollectionType): CollectionInfo[] {
  const { config } = getContext();
  return getAllCollections(config, filterType);
}

/**
 * Find a collection by name (wrapper for resolver function)
 */
function findCollection(name: string): {
  music?: MusicCollectionConfig;
  video?: VideoCollectionConfig;
} {
  const { config } = getContext();
  const result = findCollectionByName(config, name);
  return {
    music: result.music?.config,
    video: result.video?.config,
  };
}

/**
 * Resolve music collection from --collection flag or default
 */
function resolveMusicCollectionArg(collectionName?: string):
  | { error: string }
  | {
      collection: MusicCollectionConfig;
      name: string;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    } {
  const { config, globalOpts } = getContext();
  const result = resolveMusicCollection(config, collectionName);

  if (!result.success) {
    return { error: result.error };
  }

  return {
    collection: result.entity.config,
    name: result.entity.name,
    config,
    globalOpts,
  };
}

/**
 * Resolve video collection from --collection flag or default
 */
function resolveVideoCollectionArg(collectionName?: string):
  | { error: string }
  | {
      collection: VideoCollectionConfig;
      name: string;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    } {
  const { config, globalOpts } = getContext();
  const result = resolveVideoCollection(config, collectionName);

  if (!result.success) {
    return { error: result.error };
  }

  return {
    collection: result.entity.config,
    name: result.entity.name,
    config,
    globalOpts,
  };
}

// =============================================================================
// List subcommand
// =============================================================================

/**
 * `collection list` runner — testable in-process.
 *
 * Extracted from the action callback so unit tests can call it directly with a
 * captured OutputContext (BufferSink) without spawning the CLI as a subprocess.
 */
export async function runCollectionList(
  options: { type?: string },
  out: OutputContext
): Promise<void> {
  const type = options.type;
  let filterType: CollectionType | undefined;
  if (type) {
    if (type !== 'music' && type !== 'video') {
      throw new CliError({
        message: `Invalid type '${type}'. Must be 'music' or 'video'.`,
        code: CollectionErrorCodes.INVALID_TYPE,
      });
    }
    filterType = type as CollectionType;
  }

  const collections = getCollections(filterType);

  out.result<CollectionListOutput>({ success: true, collections }, () =>
    out.print(formatCollectionTable(collections))
  );
}

const listSubcommand = new Command('list')
  .description('list configured collections')
  .addOption(new Option('-t, --type <type>', 'filter by type').choices([...CONTENT_TYPES]))
  .action(async (options: { type?: string }) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runCollectionList(options, out));
  });

// =============================================================================
// Add subcommand
// =============================================================================

const addSubcommand = new Command('add')
  .description('add a new collection')
  .addOption(new Option('-t, --type <type>', 'collection type').choices([...CONTENT_TYPES]))
  .option('-c, --collection <name>', 'collection name (used as identifier)')
  .option('--path <path>', 'path to the collection directory')
  .action(async (options: { type?: string; collection?: string; path?: string }) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    await runAction(out, async () => {
      const type = options.type;
      const name = options.collection;
      const collectionPath = options.path;

      if (!type) {
        throw new CliError({
          message:
            'Missing required --type flag. Usage: podkit collection add -t music -c <name> --path <path>',
          code: CollectionErrorCodes.TYPE_REQUIRED,
        });
      }
      if (!name) {
        throw new CliError({
          message:
            'Missing required --collection flag. Usage: podkit collection add -t music -c <name> --path <path>',
          code: CollectionErrorCodes.COLLECTION_REQUIRED,
        });
      }
      if (!collectionPath) {
        throw new CliError({
          message:
            'Missing required --path flag. Usage: podkit collection add -t music -c <name> --path <path>',
          code: CollectionErrorCodes.PATH_REQUIRED,
        });
      }

      if (type !== 'music' && type !== 'video') {
        throw new CliError({
          message: `Invalid type '${type}'. Must be 'music' or 'video'.`,
          code: CollectionErrorCodes.INVALID_TYPE,
        });
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new CliError({
          message: `Invalid name '${name}'. Use only letters, numbers, underscores, and hyphens.`,
          code: CollectionErrorCodes.INVALID_NAME,
        });
      }

      const resolvedPath = path.resolve(collectionPath);
      if (!existsSync(resolvedPath)) {
        throw new CliError({
          message: `Path does not exist: ${resolvedPath}`,
          code: CollectionErrorCodes.PATH_NOT_FOUND,
        });
      }

      const stats = statSync(resolvedPath);
      if (!stats.isDirectory()) {
        throw new CliError({
          message: `Path is not a directory: ${resolvedPath}`,
          code: CollectionErrorCodes.PATH_NOT_DIRECTORY,
        });
      }

      const existing = findCollection(name);
      if ((type === 'music' && existing.music) || (type === 'video' && existing.video)) {
        throw new CliError({
          message: `A ${type} collection named '${name}' already exists.`,
          code: CollectionErrorCodes.COLLECTION_EXISTS,
        });
      }

      const collections = getCollections(type as CollectionType);
      const isFirst = collections.length === 0;

      const configPath = getConfigPath();
      let result;

      if (type === 'music') {
        result = addMusicCollection(name, { path: resolvedPath }, { configPath });
      } else {
        result = addVideoCollection(name, { path: resolvedPath }, { configPath });
      }

      if (!result.success) {
        throw new CliError({
          message: result.error ?? `Failed to add ${type} collection`,
          code: CollectionErrorCodes.COLLECTION_ADD_FAILED,
        });
      }

      let setAsDefault = false;
      if (isFirst) {
        const defaultResult = setDefaultCollection(type as CollectionType, name, {
          configPath,
        });
        setAsDefault = defaultResult.success;
      }

      out.result<CollectionModifyOutput>(
        {
          success: true,
          name,
          type: type as CollectionType,
          path: resolvedPath,
          configPath: result.configPath,
          setAsDefault,
        },
        () => {
          out.print(`Added ${type} collection '${name}': ${resolvedPath}`);
          if (setAsDefault) {
            out.print(`Set '${name}' as default ${type} collection.`);
          }
        }
      );
    });
  });

// =============================================================================
// Remove subcommand
// =============================================================================

const removeSubcommand = new Command('remove')
  .description('remove a collection')
  .option('-c, --collection <name>', 'collection name to remove')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (options: { collection?: string; yes?: boolean }) => {
    const { globalOpts, config } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    await runAction(out, async () => {
      const name = options.collection;

      if (!name) {
        throw new CliError({
          message: 'Missing required --collection flag. Usage: podkit collection remove -c <name>',
          code: CollectionErrorCodes.COLLECTION_REQUIRED,
        });
      }

      const existing = findCollection(name);
      const foundInMusic = !!existing.music;
      const foundInVideo = !!existing.video;

      if (!foundInMusic && !foundInVideo) {
        throw new CliError({
          message: `Collection '${name}' not found.`,
          code: CollectionErrorCodes.COLLECTION_NOT_FOUND,
        });
      }

      let typesToRemove: CollectionType[] = [];

      if (foundInMusic && foundInVideo) {
        if (out.isJson || options.yes) {
          typesToRemove = ['music', 'video'];
        } else {
          out.print(`Found '${name}' in both music and video collections.`);
          const removeBoth = await confirmNo('Remove both?');
          if (removeBoth) {
            typesToRemove = ['music', 'video'];
          } else {
            const removeMusic = await confirmNo('Remove music collection?');
            if (removeMusic) typesToRemove.push('music');
            const removeVideo = await confirmNo('Remove video collection?');
            if (removeVideo) typesToRemove.push('video');
          }
        }
      } else {
        typesToRemove = foundInMusic ? ['music'] : ['video'];
      }

      if (typesToRemove.length === 0) {
        out.print('Cancelled. No collections removed.');
        return;
      }

      if (out.isText && !options.yes) {
        const typeList = typesToRemove.join(' and ');
        const shouldRemove = await confirmNo(`Remove ${typeList} collection '${name}'?`);
        if (!shouldRemove) {
          out.print('Cancelled. No collections removed.');
          return;
        }
      }

      const configPath = getConfigPath();
      const errors: string[] = [];

      for (const type of typesToRemove) {
        const result = removeCollection(type, name, { configPath });
        if (!result.success) {
          errors.push(result.error ?? `Failed to remove ${type} collection`);
        } else {
          if (
            (type === 'music' && config.defaults?.music === name) ||
            (type === 'video' && config.defaults?.video === name)
          ) {
            // The removeCollection function should handle this, but we note it for output
          }
        }
      }

      if (errors.length > 0) {
        throw new CliError({
          message: errors.join('; '),
          code: CollectionErrorCodes.COLLECTION_REMOVE_FAILED,
        });
      }

      out.result<CollectionModifyOutput>(
        {
          success: true,
          name,
          type: typesToRemove.length === 1 ? typesToRemove[0] : undefined,
          configPath,
        },
        () => {
          const typeList = typesToRemove.join(' and ');
          out.print(`Removed ${typeList} collection '${name}'.`);
        }
      );
    });
  });

// =============================================================================
// Info subcommand (renamed from show)
// =============================================================================

/**
 * Factory type for creating a music adapter — injected so tests can supply a
 * fake without touching the real network.
 */
export type MusicAdapterFactory = typeof createMusicAdapter;

/**
 * `collection info` runner — testable in-process.
 *
 * Extracted from the action callback so unit/integration tests can call it
 * directly with a captured OutputContext (BufferSink) and a fake adapter
 * factory instead of spawning the CLI as a subprocess or hitting a real server.
 *
 * @param options.collection - collection name from --collection flag
 * @param out - OutputContext (text or JSON mode)
 * @param adapterFactory - overridable adapter factory (defaults to createMusicAdapter)
 */
export async function runCollectionInfo(
  options: { collection?: string },
  out: OutputContext,
  adapterFactory: MusicAdapterFactory = createMusicAdapter
): Promise<void> {
  const { config } = getContext();
  const name = options.collection;

  if (!name) {
    throw new CliError({
      message: 'Missing required --collection flag. Usage: podkit collection info -c <name>',
      code: CollectionErrorCodes.COLLECTION_REQUIRED,
    });
  }

  const existing = findCollection(name);
  const collections: CollectionInfo[] = [];

  if (existing.music) {
    const isSubsonic = existing.music.type === 'subsonic';
    const musicCol: CollectionInfo = {
      name,
      type: 'music',
      path: existing.music.path,
      isDefault: config.defaults?.music === name,
      subsonicUrl: isSubsonic ? existing.music.url : undefined,
      subsonicUsername: isSubsonic ? existing.music.username : undefined,
      playlist: isSubsonic ? existing.music.playlist : undefined,
    };

    // For playlist-scoped subsonic collections, resolve the playlist to
    // get its status (OK+count / MISSING / AMBIGUOUS / ERROR). This is the
    // explicit on-demand validation surface; a network call is expected.
    if (isSubsonic && existing.music.playlist !== undefined) {
      const adapter = adapterFactory({ config: existing.music, name });
      try {
        await adapter.connect();
        const tracks = await adapter.getItems();
        musicCol.playlistStatus = 'OK';
        musicCol.playlistTrackCount = tracks.length;
      } catch (err) {
        if (err instanceof PlaylistNotFoundError) {
          musicCol.playlistStatus = 'MISSING';
        } else if (err instanceof AmbiguousPlaylistError) {
          musicCol.playlistStatus = 'AMBIGUOUS';
        } else {
          musicCol.playlistStatus = 'ERROR';
        }
      } finally {
        await adapter.disconnect();
      }
    }

    collections.push(musicCol);
  }

  if (existing.video) {
    collections.push({
      name,
      type: 'video',
      path: existing.video.path,
      isDefault: config.defaults?.video === name,
    });
  }

  if (collections.length === 0) {
    throw new CliError({
      message: `Collection '${name}' not found.`,
      code: CollectionErrorCodes.COLLECTION_NOT_FOUND,
    });
  }

  out.result<CollectionShowOutput>({ success: true, collections }, () => {
    for (const col of collections) {
      out.print(`Collection: ${col.name} (${col.type})`);
      out.newline();

      if (col.subsonicUrl) {
        out.print('  Type:      subsonic');
        out.print(`  URL:       ${col.subsonicUrl}`);
        if (col.subsonicUsername) {
          out.print(`  Username:  ${col.subsonicUsername}`);
        }
        out.print(`  Path:      ${col.path}`);
        if (col.playlist !== undefined) {
          const statusSuffix =
            col.playlistStatus === 'OK'
              ? ` (OK, ${col.playlistTrackCount} track${col.playlistTrackCount === 1 ? '' : 's'})`
              : col.playlistStatus === 'MISSING'
                ? ' (MISSING)'
                : col.playlistStatus === 'AMBIGUOUS'
                  ? ' (AMBIGUOUS)'
                  : col.playlistStatus === 'ERROR'
                    ? ' (ERROR)'
                    : '';
          out.print(`  Playlist:  ${col.playlist}${statusSuffix}`);
        }
      } else {
        out.print('  Type:      directory');
        out.print(`  Path:      ${col.path}`);
      }

      if (col.isDefault) {
        out.print(`  Default:   yes`);
      }

      if (collections.indexOf(col) < collections.length - 1) {
        out.newline();
      }
    }
  });
}

const infoSubcommand = new Command('info')
  .description('display collection details')
  .option('-c, --collection <name>', 'collection name')
  .action(async (options: { collection?: string }) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runCollectionInfo(options, out));
  });

// =============================================================================
// Music subcommand (list tracks in a music collection)
// =============================================================================

interface ContentListOptions {
  format?: string;
  fields?: string;
  tracks?: boolean;
  albums?: boolean;
  artists?: boolean;
}

const musicSubcommand = new Command('music')
  .description('list music in a collection (shows stats by default)')
  .option('-c, --collection <name>', 'collection name (uses default if omitted)')
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
  .action(async (options: ContentListOptions & { collection?: string }) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    await runAction(out, () => runCollectionMusic(options, out));
  });

/**
 * `collection music` runner — testable in-process.
 *
 * Extracted from the action callback so unit/integration tests can call it
 * directly with a captured OutputContext (BufferSink) instead of spawning
 * the CLI as a subprocess.
 */
export async function runCollectionMusic(
  options: ContentListOptions & { collection?: string },
  out: OutputContext
): Promise<void> {
  const name = options.collection;
  const format = out.isJson ? 'json' : options.format;
  const mode = options.tracks
    ? 'tracks'
    : options.albums
      ? 'albums'
      : options.artists
        ? 'artists'
        : 'stats';

  if (options.fields && mode !== 'tracks') {
    throw new CliError({
      message: '--fields can only be used with --tracks',
      code: CollectionErrorCodes.INVALID_FIELDS_USAGE,
    });
  }

  let fields;
  try {
    fields = parseFields(options.fields);
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : String(err),
      code: CollectionErrorCodes.INVALID_FIELDS,
    });
  }

  const resolved = resolveMusicCollectionArg(name);
  if ('error' in resolved) {
    throw new CliError({
      message: resolved.error,
      code: CollectionErrorCodes.COLLECTION_NOT_RESOLVED,
    });
  }

  const { collection } = resolved;
  const collectionConfig = collection as MusicCollectionConfig;
  const isSubsonic = collectionConfig.type === 'subsonic';

  // Check if path exists (only for directory collections)
  if (!isSubsonic && !existsSync(collectionConfig.path)) {
    throw new CliError({
      message: `Collection path does not exist: ${collectionConfig.path}`,
      code: CollectionErrorCodes.COLLECTION_PATH_NOT_FOUND,
    });
  }

  try {
    const adapter = createMusicAdapter({
      config: collectionConfig,
      name: resolved.name,
    });

    const scanMessage = isSubsonic
      ? `Fetching from ${collectionConfig.url}...`
      : `Scanning ${collectionConfig.path}...`;
    const spinner = out.spinner(scanMessage);

    await adapter.connect();
    const tracks = await adapter.getItems();
    spinner.stop();

    const playlistAnnotation =
      collectionConfig.type === 'subsonic' && collectionConfig.playlist
        ? ` (playlist: ${collectionConfig.playlist})`
        : '';
    const heading = `Music in collection '${resolved.name}'${playlistAnnotation}:`;

    const displayTracks: DisplayTrack[] = tracks.map((t: CollectionTrack) => ({
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
      hasArtwork: t.hasArtwork,
      compilation: t.compilation,
      format: t.fileType || undefined,
      codec: t.codec || undefined,
      lossless: t.lossless,
      bitrate: t.bitrate && t.bitrate > 0 ? t.bitrate : undefined,
      normalization: t.normalization,
    }));

    if (mode === 'stats') {
      const stats = computeStats(displayTracks);
      if (format === 'json') {
        out.stdout(JSON.stringify(stats, null, 2));
      } else {
        const sourceInfo =
          collectionConfig.type === 'subsonic'
            ? { adapterType: 'subsonic', location: collectionConfig.url! }
            : { adapterType: 'directory', location: collectionConfig.path };
        out.stdout(
          formatStatsText(stats, heading, {
            verbose: out.isVerbose,
            tips: out.tipsEnabled,
            source: sourceInfo,
          })
        );
      }
    } else if (mode === 'albums') {
      const albums = aggregateAlbums(displayTracks);
      if (format === 'json') {
        out.stdout(JSON.stringify(albums, null, 2));
      } else if (format === 'csv') {
        const lines = ['Album,Artist,Tracks'];
        for (const a of albums) {
          lines.push(`${escapeCsv(a.album)},${escapeCsv(a.artist)},${a.tracks}`);
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
          lines.push(`${escapeCsv(a.artist)},${a.albums},${a.tracks}`);
        }
        out.stdout(lines.join('\n'));
      } else {
        out.stdout(formatArtistsTable(artists, heading));
      }
    } else {
      // tracks mode
      let output: string;
      switch (format) {
        case 'json':
          output = formatJson(displayTracks, fields);
          break;
        case 'csv':
          output = formatCsv(displayTracks, fields);
          break;
        case 'table':
        default:
          output = formatTable(displayTracks, fields);
          break;
      }
      out.stdout(output);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError({ message, code: CollectionErrorCodes.COLLECTION_SCAN_FAILED });
  }
}

// =============================================================================
// Video subcommand (list videos in a video collection)
// =============================================================================

const videoSubcommand = new Command('video')
  .description('list videos in a collection (shows stats by default)')
  .option('-c, --collection <name>', 'collection name (uses default if omitted)')
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
  .action(async (options: ContentListOptions & { collection?: string }) => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    await runAction(out, () => runCollectionVideo(options, out));
  });

/**
 * `collection video` runner — testable in-process. See `runCollectionMusic`.
 */
export async function runCollectionVideo(
  options: ContentListOptions & { collection?: string },
  out: OutputContext
): Promise<void> {
  const name = options.collection;
  const format = out.isJson ? 'json' : options.format;
  const mode = options.tracks
    ? 'tracks'
    : options.albums
      ? 'albums'
      : options.artists
        ? 'artists'
        : 'stats';

  if (options.fields && mode !== 'tracks') {
    throw new CliError({
      message: '--fields can only be used with --tracks',
      code: CollectionErrorCodes.INVALID_FIELDS_USAGE,
    });
  }

  let fields;
  try {
    fields = parseFields(options.fields);
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : String(err),
      code: CollectionErrorCodes.INVALID_FIELDS,
    });
  }

  const resolved = resolveVideoCollectionArg(name);
  if ('error' in resolved) {
    throw new CliError({
      message: resolved.error,
      code: CollectionErrorCodes.COLLECTION_NOT_RESOLVED,
    });
  }

  const { collection } = resolved;

  // Check if path exists
  if (!existsSync(collection.path)) {
    throw new CliError({
      message: `Collection path does not exist: ${collection.path}`,
      code: CollectionErrorCodes.COLLECTION_PATH_NOT_FOUND,
    });
  }

  try {
    // Dynamically import podkit-core to scan the collection
    const core = await import('@podkit/core');

    // For video collections, we scan for video files
    const adapter = core.createVideoDirectoryAdapter({
      path: collection.path,
    });

    const spinner = out.spinner(`Scanning ${collection.path}...`);

    const videos = await adapter.getItems();
    spinner.stop();

    const heading = `Video in collection '${resolved.name}':`;

    const displayTracks: DisplayTrack[] = videos.map((v: CollectionVideo) => ({
      title: v.title || 'Unknown Title',
      artist: v.seriesTitle || '', // Use series title for TV shows
      album: '',
      duration: v.duration * 1000, // Convert seconds to milliseconds
      year: v.year && v.year > 0 ? v.year : undefined,
      filePath: v.filePath || undefined,
      format: v.container || undefined,
      bitrate: undefined,
    }));

    if (mode === 'stats') {
      const stats = computeStats(displayTracks);
      if (format === 'json') {
        out.stdout(JSON.stringify(stats, null, 2));
      } else {
        out.stdout(formatStatsText(stats, heading, { tips: out.tipsEnabled }));
      }
    } else if (mode === 'albums') {
      const albums = aggregateAlbums(displayTracks);
      if (format === 'json') {
        out.stdout(JSON.stringify(albums, null, 2));
      } else if (format === 'csv') {
        const lines = ['Album,Artist,Tracks'];
        for (const a of albums) {
          lines.push(`${escapeCsv(a.album)},${escapeCsv(a.artist)},${a.tracks}`);
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
          lines.push(`${escapeCsv(a.artist)},${a.albums},${a.tracks}`);
        }
        out.stdout(lines.join('\n'));
      } else {
        out.stdout(formatArtistsTable(artists, heading));
      }
    } else {
      // tracks mode
      let output: string;
      switch (format) {
        case 'json':
          output = formatJson(displayTracks, fields);
          break;
        case 'csv':
          output = formatCsv(displayTracks, fields);
          break;
        case 'table':
        default:
          output = formatTable(displayTracks, fields);
          break;
      }
      out.stdout(output);
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError({ message, code: CollectionErrorCodes.COLLECTION_SCAN_FAILED });
  }
}

// =============================================================================
// Default subcommand
// =============================================================================

export interface CollectionDefaultSuccess {
  success: true;
  type?: CollectionType;
  name?: string;
  cleared?: boolean;
}

export type CollectionDefaultErrorOutput = CliErrorOutput & { code: CollectionErrorCode };
export type CollectionDefaultOutput = CollectionDefaultSuccess | CollectionDefaultErrorOutput;

const defaultSubcommand = new Command('default')
  .description('set or show the default collection')
  .addOption(new Option('-t, --type <type>', 'collection type').choices([...CONTENT_TYPES]))
  .option(
    '-c, --collection <name>',
    'collection name (omit to show current default, use --clear to unset)'
  )
  .option('--clear', 'clear the default collection for this type')
  .action(async (options: { type?: string; collection?: string; clear?: boolean }) => {
    const { globalOpts, config } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    await runAction(out, async () => {
      const type = options.type;
      const name = options.collection;

      if (!type) {
        throw new CliError({
          message:
            'Missing required --type flag. Usage: podkit collection default -t music [-c name]',
          code: CollectionErrorCodes.TYPE_REQUIRED,
        });
      }
      if (type !== 'music' && type !== 'video') {
        throw new CliError({
          message: `Invalid type '${type}'. Must be 'music' or 'video'.`,
          code: CollectionErrorCodes.INVALID_TYPE,
        });
      }

      const collType = type as CollectionType;

      if (options.clear) {
        const configPath = getConfigPath();
        const result = setDefaultCollection(collType, '', { configPath });

        if (!result.success) {
          throw new CliError({
            message: result.error ?? 'Failed to clear default collection',
            code: CollectionErrorCodes.DEFAULT_CLEAR_FAILED,
          });
        }

        out.result<CollectionDefaultOutput>({ success: true, type: collType, cleared: true }, () =>
          out.print(`Cleared default ${type} collection.`)
        );
        return;
      }

      if (!name) {
        const defaultName = type === 'music' ? config.defaults?.music : config.defaults?.video;
        out.result<CollectionDefaultOutput>(
          { success: true, type: collType, name: defaultName },
          () => {
            if (defaultName) {
              out.print(`Default ${type} collection: ${defaultName}`);
            } else {
              out.print(`No default ${type} collection set.`);
            }
          }
        );
        return;
      }

      const collections = type === 'music' ? config.music : config.video;
      if (!collections || !(name in collections)) {
        const message = `${type.charAt(0).toUpperCase() + type.slice(1)} collection '${name}' not found.`;
        throw new CliError({
          message,
          code: CollectionErrorCodes.COLLECTION_NOT_FOUND,
          printText: (o) => {
            o.error(message);
            const available = collections ? Object.keys(collections) : [];
            if (available.length > 0) {
              o.error(`Available ${type} collections: ${available.join(', ')}`);
            }
          },
        });
      }

      const configPath = getConfigPath();
      const result = setDefaultCollection(collType, name, { configPath });

      if (!result.success) {
        throw new CliError({
          message: result.error ?? 'Failed to set default collection',
          code: CollectionErrorCodes.DEFAULT_SET_FAILED,
        });
      }

      out.result<CollectionDefaultOutput>({ success: true, type: collType, name }, () =>
        out.print(`Set '${name}' as the default ${type} collection.`)
      );
    });
  });

// =============================================================================
// Main collection command
// =============================================================================

export const collectionCommand = new Command('collection')
  .description('manage music and video collections')
  .addCommand(listSubcommand)
  .addCommand(addSubcommand)
  .addCommand(removeSubcommand)
  .addCommand(defaultSubcommand)
  .addCommand(infoSubcommand)
  .addCommand(musicSubcommand)
  .addCommand(videoSubcommand)
  .action(async () => {
    // Default action: list all collections
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runCollectionList({}, out));
  });
