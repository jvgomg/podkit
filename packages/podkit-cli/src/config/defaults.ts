/**
 * Default configuration values for podkit
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { readFileSync } from 'node:fs';
import type { PodkitConfig } from './types.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from './types.js';

/**
 * Resolve the home directory, accounting for sudo environments where $HOME is
 * reset to root's home. Falls back to the invoking user's home via /etc/passwd.
 */
function resolveHomedir(): string {
  const sudoUser = process.env.SUDO_USER ?? process.env.DOAS_USER;
  if (sudoUser) {
    try {
      const passwd = readFileSync('/etc/passwd', 'utf-8');
      const line = passwd.split('\n').find((l) => l.startsWith(`${sudoUser}:`));
      if (line) {
        const homedir = line.split(':')[5];
        if (homedir) return homedir;
      }
    } catch {
      // Fall through to os.homedir()
    }
  }
  return os.homedir();
}

/**
 * Default location for config file
 */
export const DEFAULT_CONFIG_PATH = path.join(resolveHomedir(), '.config', 'podkit', 'config.toml');

/**
 * Default configuration values
 *
 * These are used when no config file exists and no CLI/env overrides are provided.
 */
export const DEFAULT_CONFIG: PodkitConfig = {
  quality: 'high',
  artwork: true,
  tips: true,
  transforms: DEFAULT_TRANSFORMS_CONFIG,
  videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
};

/**
 * Environment variable prefix for config overrides
 */
export const ENV_PREFIX = 'PODKIT_';

/**
 * Mapping of config keys to environment variable names
 */
export const ENV_KEYS = {
  quality: `${ENV_PREFIX}QUALITY`,
  audioQuality: `${ENV_PREFIX}AUDIO_QUALITY`,
  videoQuality: `${ENV_PREFIX}VIDEO_QUALITY`,
  encoding: `${ENV_PREFIX}ENCODING`,
  customBitrate: `${ENV_PREFIX}CUSTOM_BITRATE`,
  bitrateTolerance: `${ENV_PREFIX}BITRATE_TOLERANCE`,
  forceTranscode: `${ENV_PREFIX}FORCE_TRANSCODE`,
  forceTransferMode: `${ENV_PREFIX}FORCE_TRANSFER_MODE`,
  forceSyncTags: `${ENV_PREFIX}FORCE_SYNC_TAGS`,
  checkArtwork: `${ENV_PREFIX}CHECK_ARTWORK`,
  skipUpgrades: `${ENV_PREFIX}SKIP_UPGRADES`,
  artwork: `${ENV_PREFIX}ARTWORK`,
  tips: `${ENV_PREFIX}TIPS`,
  transferMode: `${ENV_PREFIX}TRANSFER_MODE`,
  cleanArtists: `${ENV_PREFIX}CLEAN_ARTISTS`,
  cleanArtistsDrop: `${ENV_PREFIX}CLEAN_ARTISTS_DROP`,
  cleanArtistsFormat: `${ENV_PREFIX}CLEAN_ARTISTS_FORMAT`,
  cleanArtistsIgnore: `${ENV_PREFIX}CLEAN_ARTISTS_IGNORE`,
  showLanguage: `${ENV_PREFIX}SHOW_LANGUAGE`,
  showLanguageFormat: `${ENV_PREFIX}SHOW_LANGUAGE_FORMAT`,
  showLanguageExpand: `${ENV_PREFIX}SHOW_LANGUAGE_EXPAND`,
  artworkMaxResolution: `${ENV_PREFIX}ARTWORK_MAX_RESOLUTION`,
  artworkSources: `${ENV_PREFIX}ARTWORK_SOURCES`,
  supportedAudioCodecs: `${ENV_PREFIX}SUPPORTED_AUDIO_CODECS`,
  supportsVideo: `${ENV_PREFIX}SUPPORTS_VIDEO`,
  supportsAlbumArtistBrowsing: `${ENV_PREFIX}SUPPORTS_ALBUM_ARTIST_BROWSING`,
  musicDir: `${ENV_PREFIX}MUSIC_DIR`,
  moviesDir: `${ENV_PREFIX}MOVIES_DIR`,
  tvShowsDir: `${ENV_PREFIX}TV_SHOWS_DIR`,
} as const;
