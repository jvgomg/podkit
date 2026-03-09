/**
 * Source adapter utilities
 *
 * Creates the appropriate collection adapter based on configuration.
 * Supports directory (local) and Subsonic (remote) sources.
 */

import * as core from '@podkit/core';
import type { MusicCollectionConfig } from '../config/types.js';
import type { ScanProgress, ScanWarning } from '@podkit/core';

/**
 * Options for creating a music adapter
 */
export interface CreateMusicAdapterOptions {
  /** Collection configuration */
  config: MusicCollectionConfig;
  /** Collection name (for env var lookup and error messages) */
  name: string;
  /** Callback for scan progress (directory adapter only) */
  onProgress?: (progress: ScanProgress) => void;
  /** Callback for scan warnings (directory adapter only) */
  onWarning?: (warning: ScanWarning) => void;
}

/**
 * Get the environment variable name for a Subsonic collection password
 *
 * Format: PODKIT_MUSIC_{NAME}_PASSWORD (uppercased, hyphens to underscores)
 *
 * @example
 * getSubsonicPasswordEnvVar('my-collection') // => 'PODKIT_MUSIC_MY_COLLECTION_PASSWORD'
 */
export function getSubsonicPasswordEnvVar(collectionName: string): string {
  const normalizedName = collectionName.toUpperCase().replace(/-/g, '_');
  return `PODKIT_MUSIC_${normalizedName}_PASSWORD`;
}

/**
 * Parse a subsonic:// URL into components
 *
 * @example
 * parseSubsonicUrl('subsonic://user@music.example.com')
 * // => { url: 'https://music.example.com', username: 'user' }
 *
 * parseSubsonicUrl('subsonic://user:pass@music.example.com/path')
 * // => { url: 'https://music.example.com/path', username: 'user', password: 'pass' }
 */
export function parseSubsonicUrl(source: string): {
  url: string;
  username?: string;
  password?: string;
} {
  if (!source.startsWith('subsonic://')) {
    throw new Error(`Not a Subsonic URL: ${source}`);
  }

  // Parse as URL (using https to make URL parser happy)
  const asHttps = source.replace('subsonic://', 'https://');
  const url = new URL(asHttps);

  // Extract credentials from URL
  const username = url.username || undefined;
  const password = url.password || undefined;

  // Reconstruct the API URL without credentials
  const apiUrl = `https://${url.host}${url.pathname}`;

  return { url: apiUrl, username, password };
}

/**
 * Check if a source string is a Subsonic URL
 */
export function isSubsonicUrl(source: string): boolean {
  return source.startsWith('subsonic://');
}

/**
 * Create a music collection adapter based on configuration
 *
 * - For directory type: creates DirectoryAdapter
 * - For subsonic type: creates SubsonicAdapter with password from env var
 *
 * @throws Error if Subsonic credentials are missing
 */
export function createMusicAdapter(options: CreateMusicAdapterOptions): core.CollectionAdapter {
  const { config, name, onProgress, onWarning } = options;
  const collectionType = config.type ?? 'directory';

  if (collectionType === 'subsonic') {
    return createSubsonicAdapterFromConfig(config, name);
  }

  // Default: directory adapter
  return core.createDirectoryAdapter({
    path: config.path,
    onProgress,
    onWarning,
  });
}

/**
 * Create a SubsonicAdapter from collection config
 *
 * Password is resolved from (in order):
 * 1. Config file password field
 * 2. Environment variable PODKIT_MUSIC_{NAME}_PASSWORD
 * 3. Environment variable SUBSONIC_PASSWORD (fallback)
 *
 * @throws Error if URL, username, or password is missing
 */
function createSubsonicAdapterFromConfig(
  config: MusicCollectionConfig,
  collectionName: string
): core.SubsonicAdapter {
  if (!config.url) {
    throw new Error(
      `Subsonic collection '${collectionName}' requires 'url' in config`
    );
  }

  if (!config.username) {
    throw new Error(
      `Subsonic collection '${collectionName}' requires 'username' in config`
    );
  }

  // Look up password: config file first, then environment variables
  const envVarName = getSubsonicPasswordEnvVar(collectionName);
  const password =
    config.password ?? process.env[envVarName] ?? process.env.SUBSONIC_PASSWORD;

  if (!password) {
    throw new Error(
      `Subsonic collection '${collectionName}' requires password.\n` +
        `Add 'password' to config, or set environment variable: ${envVarName}`
    );
  }

  return core.createSubsonicAdapter({
    url: config.url,
    username: config.username,
    password,
  });
}

/**
 * Create a SubsonicAdapter from a subsonic:// URL
 *
 * Password is resolved from:
 * 1. URL credentials (subsonic://user:pass@host)
 * 2. Environment variable SUBSONIC_PASSWORD
 *
 * Username is resolved from:
 * 1. URL credentials
 * 2. Environment variable SUBSONIC_USERNAME
 *
 * @throws Error if credentials are missing
 */
export function createSubsonicAdapterFromUrl(source: string): core.SubsonicAdapter {
  const parsed = parseSubsonicUrl(source);

  const username = parsed.username ?? process.env.SUBSONIC_USERNAME;
  const password = parsed.password ?? process.env.SUBSONIC_PASSWORD;

  if (!username) {
    throw new Error(
      'Subsonic username required.\n' +
        'Include in URL: subsonic://user@host\n' +
        'Or set: SUBSONIC_USERNAME'
    );
  }

  if (!password) {
    throw new Error(
      'Subsonic password required.\n' +
        'Include in URL: subsonic://user:pass@host (not recommended)\n' +
        'Or set: SUBSONIC_PASSWORD'
    );
  }

  return core.createSubsonicAdapter({
    url: parsed.url,
    username,
    password,
  });
}

/**
 * Create an adapter from a source string
 *
 * Handles both:
 * - subsonic:// URLs -> SubsonicAdapter
 * - Directory paths -> DirectoryAdapter
 *
 * @param source - Source path or URL
 * @param options - Options for directory adapter
 */
export function createAdapterFromSource(
  source: string,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    onWarning?: (warning: ScanWarning) => void;
  }
): core.CollectionAdapter {
  if (isSubsonicUrl(source)) {
    return createSubsonicAdapterFromUrl(source);
  }

  return core.createDirectoryAdapter({
    path: source,
    onProgress: options?.onProgress,
    onWarning: options?.onWarning,
  });
}
