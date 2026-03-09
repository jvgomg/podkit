/**
 * Collection command - manage music and video collections
 *
 * Provides subcommands for listing, adding, removing, and viewing
 * music and video collections in the config.
 *
 * @example
 * ```bash
 * podkit collection                       # list all collections
 * podkit collection list                  # same as above
 * podkit collection list music            # list music collections only
 * podkit collection list video            # list video collections only
 * podkit collection add music <name> <path>   # add a music collection
 * podkit collection add video <name> <path>   # add a video collection
 * podkit collection remove <name>         # remove collection
 * podkit collection info <name>           # display collection details
 * podkit collection music [name]          # list tracks in music collection
 * podkit collection video [name]          # list videos in video collection
 * ```
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { getContext } from '../context.js';
import {
  addMusicCollection,
  addVideoCollection,
  removeCollection,
  setDefaultCollection,
  DEFAULT_CONFIG_PATH,
} from '../config/index.js';
import type {
  MusicCollectionConfig,
  VideoCollectionConfig,
} from '../config/types.js';
import {
  type DisplayTrack,
  parseFields,
  formatTable,
  formatJson,
  formatCsv,
} from './display-utils.js';
import type { CollectionTrack, CollectionVideo } from '@podkit/core';

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

/**
 * Collection type for display/filtering
 */
export type CollectionType = 'music' | 'video';

/**
 * Collection info for display
 */
export interface CollectionInfo {
  name: string;
  type: CollectionType;
  path: string;
  isDefault: boolean;
  /** For subsonic collections */
  subsonicUrl?: string;
  subsonicUsername?: string;
}

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
 * Prompt user for yes/no confirmation
 */
async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      // Default to yes if empty
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
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

/**
 * Get all collections from config
 */
function getCollections(filterType?: CollectionType): CollectionInfo[] {
  const { config } = getContext();
  const collections: CollectionInfo[] = [];

  // Get music collections
  if (!filterType || filterType === 'music') {
    const musicCollections = config.music ?? {};
    for (const [name, col] of Object.entries(musicCollections)) {
      collections.push({
        name,
        type: 'music',
        path: col.path,
        isDefault: config.defaults?.music === name,
        subsonicUrl: col.type === 'subsonic' ? col.url : undefined,
        subsonicUsername: col.type === 'subsonic' ? col.username : undefined,
      });
    }
  }

  // Get video collections
  if (!filterType || filterType === 'video') {
    const videoCollections = config.video ?? {};
    for (const [name, col] of Object.entries(videoCollections)) {
      collections.push({
        name,
        type: 'video',
        path: col.path,
        isDefault: config.defaults?.video === name,
      });
    }
  }

  // Sort: defaults first, then alphabetically by type, then by name
  collections.sort((a, b) => {
    // Defaults first
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    // Then by type
    if (a.type < b.type) return -1;
    if (a.type > b.type) return 1;
    // Then by name
    return a.name.localeCompare(b.name);
  });

  return collections;
}

/**
 * Find a collection by name (searches both namespaces)
 */
function findCollection(name: string): {
  music?: MusicCollectionConfig;
  video?: VideoCollectionConfig;
} {
  const { config } = getContext();
  const result: {
    music?: MusicCollectionConfig;
    video?: VideoCollectionConfig;
  } = {};

  if (config.music?.[name]) {
    result.music = config.music[name];
  }
  if (config.video?.[name]) {
    result.video = config.video[name];
  }

  return result;
}

/**
 * Resolve collection from positional argument or default
 */
function resolveMusicCollectionArg(
  collectionName?: string
):
  | { error: string }
  | {
      collection: MusicCollectionConfig;
      name: string;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    } {
  const { config, globalOpts } = getContext();

  if (collectionName) {
    const col = config.music?.[collectionName];
    if (!col) {
      const available = config.music ? Object.keys(config.music).join(', ') : '(none)';
      return {
        error: `Music collection "${collectionName}" not found. Available: ${available}`,
      };
    }
    return { collection: col, name: collectionName, config, globalOpts };
  }

  // Use default
  const defaultName = config.defaults?.music;
  if (defaultName && config.music?.[defaultName]) {
    return {
      collection: config.music[defaultName],
      name: defaultName,
      config,
      globalOpts,
    };
  }

  const hasCollections = config.music && Object.keys(config.music).length > 0;
  if (hasCollections) {
    return {
      error:
        'No default music collection set. Specify a collection name or set a default.',
    };
  }
  return {
    error: "No music collections configured. Run 'podkit collection add music <name> <path>' to add one.",
  };
}

/**
 * Resolve video collection from positional argument or default
 */
function resolveVideoCollectionArg(
  collectionName?: string
):
  | { error: string }
  | {
      collection: VideoCollectionConfig;
      name: string;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    } {
  const { config, globalOpts } = getContext();

  if (collectionName) {
    const col = config.video?.[collectionName];
    if (!col) {
      const available = config.video ? Object.keys(config.video).join(', ') : '(none)';
      return {
        error: `Video collection "${collectionName}" not found. Available: ${available}`,
      };
    }
    return { collection: col, name: collectionName, config, globalOpts };
  }

  // Use default
  const defaultName = config.defaults?.video;
  if (defaultName && config.video?.[defaultName]) {
    return {
      collection: config.video[defaultName],
      name: defaultName,
      config,
      globalOpts,
    };
  }

  const hasCollections = config.video && Object.keys(config.video).length > 0;
  if (hasCollections) {
    return {
      error:
        'No default video collection set. Specify a collection name or set a default.',
    };
  }
  return {
    error: "No video collections configured. Run 'podkit collection add video <name> <path>' to add one.",
  };
}

// =============================================================================
// List subcommand
// =============================================================================

const listSubcommand = new Command('list')
  .description('list configured collections')
  .argument('[type]', 'filter by type: music or video')
  .action((type?: string) => {
    const { globalOpts } = getContext();

    // Validate type if provided
    let filterType: CollectionType | undefined;
    if (type) {
      if (type !== 'music' && type !== 'video') {
        const error = `Invalid type '${type}'. Must be 'music' or 'video'.`;
        if (globalOpts.json) {
          console.log(JSON.stringify({ success: false, error }, null, 2));
        } else {
          console.error(`Error: ${error}`);
        }
        process.exitCode = 1;
        return;
      }
      filterType = type as CollectionType;
    }

    const collections = getCollections(filterType);

    if (globalOpts.json) {
      const output: CollectionListOutput = {
        success: true,
        collections,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatCollectionTable(collections));
    }
  });

// =============================================================================
// Add subcommand
// =============================================================================

const addSubcommand = new Command('add')
  .description('add a new collection')
  .argument('<type>', 'collection type: music or video')
  .argument('<name>', 'collection name (used as identifier)')
  .argument('<path>', 'path to the collection directory')
  .action(async (type: string, name: string, collectionPath: string) => {
    const { globalOpts } = getContext();

    const outputJson = (data: CollectionModifyOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Validate type
    if (type !== 'music' && type !== 'video') {
      const error = `Invalid type '${type}'. Must be 'music' or 'video'.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    // Validate name (no special characters)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      const error = `Invalid name '${name}'. Use only letters, numbers, underscores, and hyphens.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    // Resolve and validate path
    const resolvedPath = path.resolve(collectionPath);
    if (!fs.existsSync(resolvedPath)) {
      const error = `Path does not exist: ${resolvedPath}`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isDirectory()) {
      const error = `Path is not a directory: ${resolvedPath}`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    // Check if collection already exists
    const existing = findCollection(name);
    if (
      (type === 'music' && existing.music) ||
      (type === 'video' && existing.video)
    ) {
      const error = `A ${type} collection named '${name}' already exists.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
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
      if (globalOpts.json) {
        outputJson({ success: false, error: result.error });
      } else {
        console.error(`Error: ${result.error}`);
      }
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

    if (globalOpts.json) {
      outputJson({
        success: true,
        name,
        type: type as CollectionType,
        path: resolvedPath,
        configPath: result.configPath,
        setAsDefault,
      });
    } else {
      console.log(`Added ${type} collection '${name}': ${resolvedPath}`);
      if (setAsDefault) {
        console.log(`Set '${name}' as default ${type} collection.`);
      }
    }
  });

// =============================================================================
// Remove subcommand
// =============================================================================

const removeSubcommand = new Command('remove')
  .description('remove a collection')
  .argument('<name>', 'collection name to remove')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (name: string, options: { yes?: boolean }) => {
    const { globalOpts, config } = getContext();

    const outputJson = (data: CollectionModifyOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Find the collection
    const existing = findCollection(name);
    const foundInMusic = !!existing.music;
    const foundInVideo = !!existing.video;

    if (!foundInMusic && !foundInVideo) {
      const error = `Collection '${name}' not found.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    // If found in both, ask which to remove (in interactive mode)
    let typesToRemove: CollectionType[] = [];

    if (foundInMusic && foundInVideo) {
      if (globalOpts.json || options.yes) {
        // In JSON mode or with --yes, remove both
        typesToRemove = ['music', 'video'];
      } else {
        // Interactive mode: ask user
        console.log(`Found '${name}' in both music and video collections.`);
        const removeBoth = await confirm('Remove both? [y/N] ');
        if (removeBoth) {
          typesToRemove = ['music', 'video'];
        } else {
          // Let them choose
          const removeMusic = await confirm('Remove music collection? [y/N] ');
          if (removeMusic) typesToRemove.push('music');
          const removeVideo = await confirm('Remove video collection? [y/N] ');
          if (removeVideo) typesToRemove.push('video');
        }
      }
    } else {
      typesToRemove = foundInMusic ? ['music'] : ['video'];
    }

    if (typesToRemove.length === 0) {
      if (!globalOpts.json) {
        console.log('Cancelled. No collections removed.');
      }
      return;
    }

    // Confirm removal in interactive mode
    if (!globalOpts.json && !options.yes) {
      const typeList = typesToRemove.join(' and ');
      const shouldRemove = await confirm(
        `Remove ${typeList} collection '${name}'? [y/N] `
      );
      if (!shouldRemove) {
        console.log('Cancelled. No collections removed.');
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
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    if (globalOpts.json) {
      outputJson({
        success: true,
        name,
        type: typesToRemove.length === 1 ? typesToRemove[0] : undefined,
        configPath,
      });
    } else {
      const typeList = typesToRemove.join(' and ');
      console.log(`Removed ${typeList} collection '${name}'.`);
    }
  });

// =============================================================================
// Info subcommand (renamed from show)
// =============================================================================

const infoSubcommand = new Command('info')
  .description('display collection details')
  .argument('<name>', 'collection name')
  .action((name: string) => {
    const { globalOpts } = getContext();

    const outputJson = (data: CollectionShowOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Find the collection
    const existing = findCollection(name);
    const collections: CollectionInfo[] = [];

    if (existing.music) {
      const { config } = getContext();
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
      const { config } = getContext();
      collections.push({
        name,
        type: 'video',
        path: existing.video.path,
        isDefault: config.defaults?.video === name,
      });
    }

    if (collections.length === 0) {
      const error = `Collection '${name}' not found.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    if (globalOpts.json) {
      // Return all matches
      console.log(
        JSON.stringify(
          {
            success: true,
            collections,
          },
          null,
          2
        )
      );
      return;
    }

    // Text output
    for (const col of collections) {
      console.log(`Collection: ${col.name} (${col.type})`);
      console.log('');

      if (col.subsonicUrl) {
        console.log('  Type:      subsonic');
        console.log(`  URL:       ${col.subsonicUrl}`);
        if (col.subsonicUsername) {
          console.log(`  Username:  ${col.subsonicUsername}`);
        }
        console.log(`  Path:      ${col.path}`);
      } else {
        console.log('  Type:      directory');
        console.log(`  Path:      ${col.path}`);
      }

      if (col.isDefault) {
        console.log(`  Default:   yes`);
      }

      if (collections.indexOf(col) < collections.length - 1) {
        console.log('');
      }
    }
  });

// =============================================================================
// Music subcommand (list tracks in a music collection)
// =============================================================================

interface ContentListOptions {
  format?: string;
  fields?: string;
}

const musicSubcommand = new Command('music')
  .description('list tracks in a music collection')
  .argument('[name]', 'collection name (uses default if omitted)')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated)')
  .action(async (name: string | undefined, options: ContentListOptions) => {
    const { globalOpts } = getContext();
    const format = globalOpts.json ? 'json' : options.format;
    const fields = parseFields(options.fields);

    const outputError = (error: string) => {
      if (format === 'json') {
        console.log(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    const resolved = resolveMusicCollectionArg(name);
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { collection } = resolved;

    // Check if path exists
    if (!fs.existsSync(collection.path)) {
      outputError(`Collection path does not exist: ${collection.path}`);
      return;
    }

    try {
      // Dynamically import podkit-core to scan the collection
      const core = await import('@podkit/core');
      const adapter = core.createDirectoryAdapter({
        path: collection.path,
      });

      if (!globalOpts.quiet && format !== 'json') {
        console.error(`Scanning ${collection.path}...`);
      }

      const tracks = await adapter.getTracks();

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
        format: t.fileType || undefined,
        bitrate: t.bitrate && t.bitrate > 0 ? t.bitrate : undefined,
      }));

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

      console.log(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Video subcommand (list videos in a video collection)
// =============================================================================

const videoSubcommand = new Command('video')
  .description('list videos in a video collection')
  .argument('[name]', 'collection name (uses default if omitted)')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated)')
  .action(async (name: string | undefined, options: ContentListOptions) => {
    const { globalOpts } = getContext();
    const format = globalOpts.json ? 'json' : options.format;
    const fields = parseFields(options.fields);

    const outputError = (error: string) => {
      if (format === 'json') {
        console.log(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    const resolved = resolveVideoCollectionArg(name);
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { collection } = resolved;

    // Check if path exists
    if (!fs.existsSync(collection.path)) {
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

      if (!globalOpts.quiet && format !== 'json') {
        console.error(`Scanning ${collection.path}...`);
      }

      const videos = await adapter.getVideos();

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

      console.log(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Main collection command
// =============================================================================

export const collectionCommand = new Command('collection')
  .description('manage music and video collections')
  .addCommand(listSubcommand)
  .addCommand(addSubcommand)
  .addCommand(removeSubcommand)
  .addCommand(infoSubcommand)
  .addCommand(musicSubcommand)
  .addCommand(videoSubcommand)
  .action(() => {
    // Default action: list all collections
    const { globalOpts } = getContext();
    const collections = getCollections();

    if (globalOpts.json) {
      const output: CollectionListOutput = {
        success: true,
        collections,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatCollectionTable(collections));
    }
  });
