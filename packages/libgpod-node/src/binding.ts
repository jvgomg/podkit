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
  write(): boolean;
  close(): void;
  getMountpoint(): string | null;
  getTrackById(id: number): Track | null;
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
  getVersion(): NativeVersion;
}

// Cached binding reference
let cachedBinding: NativeBinding | null = null;
let loadError: Error | null = null;

/**
 * Get the path to the native addon.
 */
function getAddonPath(): string {
  // In ESM, we need to compute __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // The addon is built to build/Release/gpod_binding.node relative to package root
  // src/ is one level below package root
  return join(__dirname, '..', 'build', 'Release', 'gpod_binding.node');
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
    const addonPath = getAddonPath();

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
 * Get libgpod version information.
 */
export function getVersion(): NativeVersion {
  const binding = loadBinding();
  return binding.getVersion();
}
