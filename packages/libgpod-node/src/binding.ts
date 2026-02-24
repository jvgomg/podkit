/**
 * Native binding loader for libgpod.
 *
 * This module handles loading the native N-API addon and provides
 * typed interfaces for the raw native functions.
 */

import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type {
  Track,
  Playlist,
  DeviceInfo,
  TrackInput,
  ArtworkCapabilities,
  DeviceCapabilities,
  SmartPlaylist,
  SPLRule,
  SPLPreferences,
  SPLMatch,
} from './types';

/**
 * Database info returned by native binding.
 */
export interface NativeDatabaseInfo {
  mountpoint: string | null;
  version: number;
  id: bigint;
  trackCount: number;
  playlistCount: number;
  device: DeviceInfo | null;
}

/**
 * Native Database class interface.
 */
export interface NativeDatabase {
  getInfo(): NativeDatabaseInfo;
  getTracks(): Track[];
  getPlaylists(): Playlist[];
  addTrack(input: TrackInput): Track;
  removeTrack(trackId: number): void;
  copyTrackToDevice(trackId: number, sourcePath: string): Track;
  setTrackThumbnails(trackId: number, imagePath: string): Track;
  setTrackThumbnailsFromData(trackId: number, imageData: Buffer): Track;
  removeTrackThumbnails(trackId: number): Track;
  hasTrackThumbnails(trackId: number): boolean;
  write(): boolean;
  close(): void;
  getMountpoint(): string | null;
  setMountpoint(mountpoint: string): void;
  getFilename(): string | null;
  getTrackById(id: number): Track | null;
  getTrackByDbId(dbid: bigint): Track | null;
  updateTrack(trackId: number, fields: Partial<TrackInput>): Track;
  getTrackFilePath(trackId: number): string | null;
  duplicateTrack(trackId: number): Track;
  getUniqueArtworkIds(): number[];
  getArtworkFormats(): ArtworkCapabilities;

  // Playlist operations
  createPlaylist(name: string): Playlist;
  removePlaylist(playlistId: bigint): void;
  getPlaylistById(playlistId: bigint): Playlist | null;
  getPlaylistByName(name: string): Playlist | null;
  setPlaylistName(playlistId: bigint, newName: string): Playlist;
  addTrackToPlaylist(playlistId: bigint, trackId: number): Playlist;
  removeTrackFromPlaylist(playlistId: bigint, trackId: number): Playlist;
  playlistContainsTrack(playlistId: bigint, trackId: number): boolean;
  getPlaylistTracks(playlistId: bigint): Track[];

  // Smart playlist operations
  createSmartPlaylist(
    name: string,
    config?: {
      match?: SPLMatch;
      rules?: SPLRule[];
      preferences?: SPLPreferences;
    }
  ): SmartPlaylist;
  getSmartPlaylistRules(playlistId: bigint): SPLRule[];
  addSmartPlaylistRule(playlistId: bigint, rule: SPLRule): SmartPlaylist;
  removeSmartPlaylistRule(playlistId: bigint, ruleIndex: number): SmartPlaylist;
  clearSmartPlaylistRules(playlistId: bigint): SmartPlaylist;
  setSmartPlaylistPreferences(
    playlistId: bigint,
    preferences: Partial<SPLPreferences>
  ): SmartPlaylist;
  getSmartPlaylistPreferences(playlistId: bigint): SPLPreferences;
  evaluateSmartPlaylist(playlistId: bigint): Track[];

  // Device capability operations
  getDeviceCapabilities(): DeviceCapabilities;
  getSysInfo(field: string): string | null;
  setSysInfo(field: string, value: string | null): void;
}

/**
 * Version info returned by native binding.
 */
export interface NativeVersion {
  major: number;
  minor: number;
  patch: number;
  string: string;
}

/**
 * Native binding module interface.
 */
export interface NativeBinding {
  Database: new () => NativeDatabase;
  parse(mountpoint: string): NativeDatabase;
  parseFile(filename: string): NativeDatabase;
  create(): NativeDatabase;
  getVersion(): NativeVersion;
}

// Cached binding reference
let cachedBinding: NativeBinding | null = null;
let loadError: Error | null = null;

/**
 * Binding filename
 */
const BINDING_FILENAME = 'gpod_binding.node';

/**
 * Get candidate paths for the native addon.
 *
 * Returns paths to try in order of preference:
 * 1. Relative to this source file (development, running from source)
 * 2. In node_modules/@podkit/libgpod-node (bundled CLI, published package)
 * 3. Various node_modules locations for monorepo/hoisted scenarios
 */
function getAddonCandidatePaths(): string[] {
  const candidates: string[] = [];

  // In ESM, we need to compute __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // 1. Relative to source file (development mode)
  // When running from source, __dirname is packages/libgpod-node/src/
  // The binding is at packages/libgpod-node/build/Release/
  candidates.push(join(__dirname, '..', 'build', 'Release', BINDING_FILENAME));

  // 2. Relative to dist file (if running from built dist/)
  // When running from dist, __dirname is packages/libgpod-node/dist/
  candidates.push(join(__dirname, '..', 'build', 'Release', BINDING_FILENAME));

  // 3. Look in node_modules (for bundled CLI or external consumers)
  // Walk up from current directory to find node_modules
  let searchDir = __dirname;
  const visited = new Set<string>();

  while (searchDir && !visited.has(searchDir)) {
    visited.add(searchDir);

    // Check node_modules/@podkit/libgpod-node/build/Release/
    const nodeModulesPath = join(
      searchDir,
      'node_modules',
      '@podkit',
      'libgpod-node',
      'build',
      'Release',
      BINDING_FILENAME
    );
    candidates.push(nodeModulesPath);

    // Move up one directory
    const parentDir = dirname(searchDir);
    if (parentDir === searchDir) break; // reached root
    searchDir = parentDir;
  }

  // 4. Check process.cwd() based paths (for CLI invocation)
  const cwd = process.cwd();
  candidates.push(
    join(cwd, 'node_modules', '@podkit', 'libgpod-node', 'build', 'Release', BINDING_FILENAME)
  );

  return candidates;
}

/**
 * Find the native addon by trying candidate paths.
 *
 * @returns The path to the addon, or null if not found
 */
function findAddonPath(): string | null {
  const { existsSync } = require('fs') as typeof import('fs');
  const candidates = getAddonCandidatePaths();

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Load the native binding.
 *
 * @throws Error if the native binding cannot be loaded
 */
function loadBinding(): NativeBinding {
  if (cachedBinding) {
    return cachedBinding;
  }

  if (loadError) {
    throw loadError;
  }

  try {
    // Use createRequire for ESM compatibility
    const require = createRequire(import.meta.url);
    const addonPath = findAddonPath();

    if (!addonPath) {
      throw new Error(
        'Native binding not found. Searched locations:\n' +
          getAddonCandidatePaths()
            .slice(0, 5)
            .map((p) => `  - ${p}`)
            .join('\n')
      );
    }

    cachedBinding = require(addonPath) as NativeBinding;
    return cachedBinding;
  } catch (error) {
    loadError = new Error(
      `Failed to load native binding: ${error instanceof Error ? error.message : String(error)}\n` +
        'Make sure you have run `bun run build:native` to compile the native module.'
    );
    throw loadError;
  }
}

/**
 * Check if the native binding is available.
 */
export function isNativeAvailable(): boolean {
  try {
    loadBinding();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the native binding module.
 *
 * @throws Error if the binding is not available
 */
export function getNativeBinding(): NativeBinding {
  return loadBinding();
}

/**
 * Parse an iPod database from a mountpoint.
 *
 * @param mountpoint Path to the iPod mount point
 * @returns Native database handle
 * @throws Error if parsing fails
 */
export function parse(mountpoint: string): NativeDatabase {
  const binding = loadBinding();
  return binding.parse(mountpoint);
}

/**
 * Parse an iPod database from a specific file path.
 *
 * Unlike parse(), this reads a database file directly without requiring
 * a full iPod mount point structure. The database will have no mountpoint
 * set, and track file operations may not work correctly.
 *
 * @param filename Path to the iTunesDB file
 * @returns Native database handle
 * @throws Error if parsing fails
 */
export function parseFile(filename: string): NativeDatabase {
  const binding = loadBinding();
  return binding.parseFile(filename);
}

/**
 * Create a new empty iPod database.
 *
 * Creates a fresh database that is not associated with any mountpoint.
 * The database has reasonable defaults (version 0x13, random ID).
 * Use setMountpoint() to associate with an iPod before writing.
 *
 * @returns Native database handle
 * @throws Error if creation fails
 */
export function create(): NativeDatabase {
  const binding = loadBinding();
  return binding.create();
}

/**
 * Get libgpod version information.
 */
export function getVersion(): NativeVersion {
  const binding = loadBinding();
  return binding.getVersion();
}
