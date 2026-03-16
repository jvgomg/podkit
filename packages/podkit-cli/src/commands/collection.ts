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

import { Command } from 'commander';
import * as path from 'node:path';
import { existsSync, statSync } from '../utils/fs.js';
import { confirmNo } from '../utils/confirm.js';
import { getContext } from '../context.js';
import {
  addMusicCollection,
  addVideoCollection,
  removeCollection,
  setDefaultCollection,
  DEFAULT_CONFIG_PATH,
} from '../config/index.js';
import type { MusicCollectionConfig, VideoCollectionConfig } from '../config/types.js';
import {
  type DisplayTrack,
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
export interface CollectionListOutput {
  success: boolean;
  collections?: CollectionInfo[];
  error?: string;
}

export interface CollectionShowOutput {
  success: boolean;
  collection?: CollectionInfo;
  collections?: CollectionInfo[];
  error?: string;
}

export interface CollectionModifyOutput {
  success: boolean;
  name?: string;
  type?: CollectionType;
  path?: string;
  configPath?: string;
  setAsDefault?: boolean;
  error?: string;
}


/**
 * Format collections as a table
 */
function formatCollectionTable(collections: CollectionInfo[]): string {
  if (collections.length === 0) {
    return "No collections configured. Run 'podkit collection add' to add one.";
  }

  const lines: string[] = ['Collections:', ''];

  // Calculate column widths
  const typeWidth = Math.max(4, ...collections.map((c) => c.type.length));
  const nameWidth = Math.max(4, ...collections.map((c) => c.name.length));

  // Header
  lines.push(`  ${'TYPE'.padEnd(typeWidth)}  ${'NAME'.padEnd(nameWidth)}  PATH`);

  // Data rows
  for (const col of collections) {
    const marker = col.isDefault ? '*' : ' ';
    const displayPath = col.subsonicUrl ?? col.path;
    lines.push(
      `${marker} ${col.type.padEnd(typeWidth)}  ${col.name.padEnd(nameWidth)}  ${displayPath}`
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

const listSubcommand = new Command('list')
  .description('list configured collections')
  .option('-t, --type <type>', 'filter by type: music or video')
  .action((options: { type?: string }) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    // Validate type if provided
    const type = options.type;
    let filterType: CollectionType | undefined;
    if (type) {
      if (type !== 'music' && type !== 'video') {
        const error = `Invalid type '${type}'. Must be 'music' or 'video'.`;
        out.result<CollectionListOutput>({ success: false, error }, () =>
          out.error(`Error: ${error}`)
        );
        process.exitCode = 1;
        return;
      }
      filterType = type as CollectionType;
    }

    const collections = getCollections(filterType);

    out.result<CollectionListOutput>({ success: true, collections }, () =>
      out.print(formatCollectionTable(collections))
    );
  });

// =============================================================================
// Add subcommand
// =============================================================================

const addSubcommand = new Command('add')
  .description('add a new collection')
  .option('-t, --type <type>', 'collection type: music or video')
  .option('-c, --collection <name>', 'collection name (used as identifier)')
  .option('--path <path>', 'path to the collection directory')
  .action(async (options: { type?: string; collection?: string; path?: string }) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const type = options.type;
    const name = options.collection;
    const collectionPath = options.path;

    // Validate required flags
    if (!type) {
      const error =
        'Missing required --type flag. Usage: podkit collection add -t music -c <name> --path <path>';
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }
    if (!name) {
      const error =
        'Missing required --collection flag. Usage: podkit collection add -t music -c <name> --path <path>';
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }
    if (!collectionPath) {
      const error =
        'Missing required --path flag. Usage: podkit collection add -t music -c <name> --path <path>';
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Validate type
    if (type !== 'music' && type !== 'video') {
      const error = `Invalid type '${type}'. Must be 'music' or 'video'.`;
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Validate name (no special characters)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      const error = `Invalid name '${name}'. Use only letters, numbers, underscores, and hyphens.`;
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Resolve and validate path
    const resolvedPath = path.resolve(collectionPath);
    if (!existsSync(resolvedPath)) {
      const error = `Path does not exist: ${resolvedPath}`;
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    const stats = statSync(resolvedPath);
    if (!stats.isDirectory()) {
      const error = `Path is not a directory: ${resolvedPath}`;
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Check if collection already exists
    const existing = findCollection(name);
    if ((type === 'music' && existing.music) || (type === 'video' && existing.video)) {
      const error = `A ${type} collection named '${name}' already exists.`;
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Check if this is the first collection of this type (to set as default)
    const collections = getCollections(type as CollectionType);
    const isFirst = collections.length === 0;

    // Add the collection
    const configPath = getConfigPath();
    let result;

    if (type === 'music') {
      result = addMusicCollection(name, { path: resolvedPath }, { configPath });
    } else {
      result = addVideoCollection(name, { path: resolvedPath }, { configPath });
    }

    if (!result.success) {
      out.result<CollectionModifyOutput>({ success: false, error: result.error }, () =>
        out.error(`Error: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Set as default if first collection of this type
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
    const name = options.collection;

    if (!name) {
      const error = 'Missing required --collection flag. Usage: podkit collection remove -c <name>';
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Find the collection
    const existing = findCollection(name);
    const foundInMusic = !!existing.music;
    const foundInVideo = !!existing.video;

    if (!foundInMusic && !foundInVideo) {
      const error = `Collection '${name}' not found.`;
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // If found in both, ask which to remove (in interactive mode)
    let typesToRemove: CollectionType[] = [];

    if (foundInMusic && foundInVideo) {
      if (out.isJson || options.yes) {
        // In JSON mode or with --yes, remove both
        typesToRemove = ['music', 'video'];
      } else {
        // Interactive mode: ask user
        out.print(`Found '${name}' in both music and video collections.`);
        const removeBoth = await confirmNo('Remove both?');
        if (removeBoth) {
          typesToRemove = ['music', 'video'];
        } else {
          // Let them choose
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

    // Confirm removal in interactive mode
    if (out.isText && !options.yes) {
      const typeList = typesToRemove.join(' and ');
      const shouldRemove = await confirmNo(`Remove ${typeList} collection '${name}'?`);
      if (!shouldRemove) {
        out.print('Cancelled. No collections removed.');
        return;
      }
    }

    // Remove the collection(s)
    const configPath = getConfigPath();
    const errors: string[] = [];

    for (const type of typesToRemove) {
      const result = removeCollection(type, name, { configPath });
      if (!result.success) {
        errors.push(result.error ?? `Failed to remove ${type} collection`);
      } else {
        // Clear default if this was the default
        if (
          (type === 'music' && config.defaults?.music === name) ||
          (type === 'video' && config.defaults?.video === name)
        ) {
          // The removeCollection function should handle this, but we note it for output
        }
      }
    }

    if (errors.length > 0) {
      const error = errors.join('; ');
      out.result<CollectionModifyOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
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

// =============================================================================
// Info subcommand (renamed from show)
// =============================================================================

const infoSubcommand = new Command('info')
  .description('display collection details')
  .option('-c, --collection <name>', 'collection name')
  .action((options: { collection?: string }) => {
    const { globalOpts, config } = getContext();
    const name = options.collection;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    if (!name) {
      const error = 'Missing required --collection flag. Usage: podkit collection info -c <name>';
      out.result<CollectionShowOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    // Find the collection
    const existing = findCollection(name);
    const collections: CollectionInfo[] = [];

    if (existing.music) {
      const isSubsonic = existing.music.type === 'subsonic';
      collections.push({
        name,
        type: 'music',
        path: existing.music.path,
        isDefault: config.defaults?.music === name,
        subsonicUrl: isSubsonic ? existing.music.url : undefined,
        subsonicUsername: isSubsonic ? existing.music.username : undefined,
      });
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
      const error = `Collection '${name}' not found.`;
      out.result<CollectionShowOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
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
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated, for --tracks)')
  .action(async (options: ContentListOptions & { collection?: string }) => {
    const name = options.collection;
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    const format = out.isJson ? 'json' : options.format;
    const fields = parseFields(options.fields);
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

    const resolved = resolveMusicCollectionArg(name);
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { collection } = resolved;
    const collectionConfig = collection as MusicCollectionConfig;
    const isSubsonic = collectionConfig.type === 'subsonic';

    // Check if path exists (only for directory collections)
    if (!isSubsonic && !existsSync(collectionConfig.path)) {
      outputError(`Collection path does not exist: ${collectionConfig.path}`);
      return;
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
      const tracks = await adapter.getTracks();
      spinner.stop();

      const heading = `Music in collection '${resolved.name}':`;

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
        artwork: undefined, // Not available from collection adapter
        compilation: t.compilation,
        format: t.fileType || undefined,
        bitrate: t.bitrate && t.bitrate > 0 ? t.bitrate : undefined,
        soundcheck: t.soundcheck || undefined,
        soundcheckSource: t.soundcheckSource,
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
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Video subcommand (list videos in a video collection)
// =============================================================================

const videoSubcommand = new Command('video')
  .description('list videos in a collection (shows stats by default)')
  .option('-c, --collection <name>', 'collection name (uses default if omitted)')
  .option('--tracks', 'list all tracks')
  .option('--albums', 'list albums with track counts')
  .option('--artists', 'list artists with album/track counts')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated, for --tracks)')
  .action(async (options: ContentListOptions & { collection?: string }) => {
    const name = options.collection;
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);
    const format = out.isJson ? 'json' : options.format;
    const fields = parseFields(options.fields);
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

    const resolved = resolveVideoCollectionArg(name);
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { collection } = resolved;

    // Check if path exists
    if (!existsSync(collection.path)) {
      outputError(`Collection path does not exist: ${collection.path}`);
      return;
    }

    try {
      // Dynamically import podkit-core to scan the collection
      const core = await import('@podkit/core');

      // For video collections, we scan for video files
      const adapter = core.createVideoDirectoryAdapter({
        path: collection.path,
      });

      const spinner = out.spinner(`Scanning ${collection.path}...`);

      const videos = await adapter.getVideos();
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
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Default subcommand
// =============================================================================

export interface CollectionDefaultOutput {
  success: boolean;
  type?: CollectionType;
  name?: string;
  cleared?: boolean;
  error?: string;
}

const defaultSubcommand = new Command('default')
  .description('set or show the default collection')
  .option('-t, --type <type>', 'collection type: music or video')
  .option(
    '-c, --collection <name>',
    'collection name (omit to show current default, use --clear to unset)'
  )
  .option('--clear', 'clear the default collection for this type')
  .action(async (options: { type?: string; collection?: string; clear?: boolean }) => {
    const { globalOpts, config } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const type = options.type;
    const name = options.collection;

    // Validate type (required)
    if (!type) {
      const error =
        'Missing required --type flag. Usage: podkit collection default -t music [-c name]';
      out.result<CollectionDefaultOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }
    if (type !== 'music' && type !== 'video') {
      const error = `Invalid type '${type}'. Must be 'music' or 'video'.`;
      out.result<CollectionDefaultOutput>({ success: false, error }, () =>
        out.error(`Error: ${error}`)
      );
      process.exitCode = 1;
      return;
    }

    const collType = type as CollectionType;

    if (options.clear) {
      const configPath = getConfigPath();
      const result = setDefaultCollection(collType, '', { configPath });

      if (!result.success) {
        out.result<CollectionDefaultOutput>({ success: false, error: result.error }, () =>
          out.error(`Error: ${result.error}`)
        );
        process.exitCode = 1;
        return;
      }

      out.result<CollectionDefaultOutput>({ success: true, type: collType, cleared: true }, () =>
        out.print(`Cleared default ${type} collection.`)
      );
      return;
    }

    if (!name) {
      // Show current default
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

    // Validate that the collection exists
    const collections = type === 'music' ? config.music : config.video;
    if (!collections || !(name in collections)) {
      const error = `${type.charAt(0).toUpperCase() + type.slice(1)} collection '${name}' not found.`;
      out.result<CollectionDefaultOutput>({ success: false, error }, () => {
        out.error(`Error: ${error}`);
        const available = collections ? Object.keys(collections) : [];
        if (available.length > 0) {
          out.error(`Available ${type} collections: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    const configPath = getConfigPath();
    const result = setDefaultCollection(collType, name, { configPath });

    if (!result.success) {
      out.result<CollectionDefaultOutput>({ success: false, error: result.error }, () =>
        out.error(`Error: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    out.result<CollectionDefaultOutput>({ success: true, type: collType, name }, () =>
      out.print(`Set '${name}' as the default ${type} collection.`)
    );
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
  .action(() => {
    // Default action: list all collections
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const collections = getCollections();

    out.result<CollectionListOutput>({ success: true, collections }, () =>
      out.print(formatCollectionTable(collections))
    );
  });
