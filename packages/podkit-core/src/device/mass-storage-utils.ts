/**
 * Utility functions for mass-storage device file management
 *
 * Provides filename sanitization and path generation for FAT32/exFAT
 * filesystems used by mass-storage DAPs (Echo Mini, Rockbox, etc.).
 *
 * @module
 */

// =============================================================================
// Constants
// =============================================================================

/** Characters that are invalid on FAT32/exFAT filesystems */
const FAT32_INVALID_CHARS = /[:"*?<>|/\\]/g;

/** Emoji and other symbol Unicode ranges that display as blank on some devices */
const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{E0020}-\u{E007F}]|\u{200D}|\u{20E3}|\u{FE00}-\u{FE0F}/gu;

/** Maximum filename length in bytes (UTF-8) for FAT32/exFAT */
const MAX_FILENAME_BYTES = 255;

/** The managed music directory on the device */
export const MUSIC_DIR = 'Music';

/** The managed video directory on the device */
export const VIDEO_DIR = 'Video';

/** Podkit state directory on the device */
export const PODKIT_DIR = '.podkit';

/** State manifest filename */
export const MANIFEST_FILE = 'state.json';

/** Audio file extensions recognized by the scanner */
export const AUDIO_EXTENSIONS = new Set([
  '.flac',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.alac',
  '.wav',
  '.aiff',
  '.aif',
  '.opus',
  '.wma',
  '.ape',
  '.dsf',
  '.dff',
]);

/** Video file extensions recognized during device scanning */
export const VIDEO_EXTENSIONS = new Set(['.m4v', '.mp4', '.mov', '.avi', '.mkv']);

// =============================================================================
// Filename Sanitization
// =============================================================================

/**
 * Sanitize a string for use as a filename on FAT32/exFAT.
 *
 * - Replaces invalid characters with underscore
 * - Strips emoji (display as blank on Echo Mini)
 * - Trims whitespace
 * - Collapses consecutive spaces/underscores
 * - Truncates to MAX_FILENAME_BYTES (UTF-8)
 */
export function sanitizeFilename(name: string): string {
  let result = name;

  // Replace FAT32-invalid characters
  result = result.replace(FAT32_INVALID_CHARS, '_');

  // Strip emoji
  result = result.replace(EMOJI_PATTERN, '');

  // Trim whitespace
  result = result.trim();

  // Collapse consecutive spaces/underscores
  result = result.replace(/[_ ]{2,}/g, (match) => {
    // Prefer a space if the sequence contains a space, otherwise underscore
    return match.includes(' ') ? ' ' : '_';
  });

  // Truncate to max byte length
  result = truncateToBytes(result, MAX_FILENAME_BYTES);

  // If the name is empty after sanitization, use a fallback
  if (result.length === 0) {
    result = 'Unknown';
  }

  return result;
}

/**
 * Truncate a string to fit within a maximum byte length (UTF-8).
 * Avoids splitting multi-byte characters.
 */
function truncateToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) {
    return str;
  }

  // Binary search for the longest valid substring
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return str.slice(0, lo);
}

// =============================================================================
// Path Generation
// =============================================================================

/**
 * Pad a track number to at least 2 digits.
 */
export function padTrackNumber(num: number | undefined): string {
  if (num === undefined || num <= 0) return '';
  return String(num).padStart(2, '0');
}

/**
 * Generate the device-relative file path for a track.
 *
 * Format: Music/{artist}/{album}/{trackNumber} - {title}.{ext}
 *
 * When totalDiscs > 1, appends " (disc N)" to the album name to work
 * around the Echo Mini's broken disc-first sorting.
 */
export function generateTrackPath(opts: {
  artist?: string;
  album?: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  totalDiscs?: number;
  extension: string;
}): string {
  const artist = sanitizeFilename(opts.artist || 'Unknown Artist');
  let album = opts.album || 'Unknown Album';

  // Multi-disc handling: append disc number to album name
  if (opts.totalDiscs && opts.totalDiscs > 1 && opts.discNumber) {
    album = `${album} (disc ${opts.discNumber})`;
  }

  const albumSafe = sanitizeFilename(album);
  const titleSafe = sanitizeFilename(opts.title);

  // Build filename: "01 - Title.ext" or "Title.ext" if no track number
  const trackNum = padTrackNumber(opts.trackNumber);
  const ext = opts.extension.startsWith('.') ? opts.extension : `.${opts.extension}`;
  const filename = trackNum ? `${trackNum} - ${titleSafe}${ext}` : `${titleSafe}${ext}`;

  return `${MUSIC_DIR}/${artist}/${albumSafe}/${filename}`;
}

/**
 * Generate the device-relative file path for a video.
 *
 * Movies:   Video/Movies/{title} ({year}).{ext}
 * TV Shows: Video/{show}/Season {N}/{episode}.{ext}
 */
export function generateVideoPath(opts: {
  title: string;
  contentType: 'movie' | 'tvshow';
  year?: number;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  extension: string;
}): string {
  const ext = opts.extension.startsWith('.') ? opts.extension : `.${opts.extension}`;
  const titleSafe = sanitizeFilename(opts.title);

  if (opts.contentType === 'tvshow' && opts.seriesTitle) {
    const showSafe = sanitizeFilename(opts.seriesTitle);
    const season = opts.seasonNumber ?? 1;
    const episode = opts.episodeNumber;
    const epPrefix =
      episode !== undefined
        ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} - `
        : '';
    return `${VIDEO_DIR}/${showSafe}/Season ${season}/${epPrefix}${titleSafe}${ext}`;
  }

  // Movie
  const yearSuffix = opts.year ? ` (${opts.year})` : '';
  return `${VIDEO_DIR}/Movies/${titleSafe}${yearSuffix}${ext}`;
}

/**
 * Given a desired path, find a unique variant by appending " (2)", " (3)", etc.
 * if the original path is already taken.
 *
 * @param desiredPath - The ideal path (device-relative)
 * @param existingPaths - Set of paths already in use
 * @returns A unique path
 */
export function deduplicatePath(desiredPath: string, existingPaths: Set<string>): string {
  if (!existingPaths.has(desiredPath)) {
    return desiredPath;
  }

  // Split into base and extension
  const lastDot = desiredPath.lastIndexOf('.');
  const base = lastDot > 0 ? desiredPath.slice(0, lastDot) : desiredPath;
  const ext = lastDot > 0 ? desiredPath.slice(lastDot) : '';

  let counter = 2;
  while (true) {
    const candidate = `${base} (${counter})${ext}`;
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
    counter++;
  }
}

// =============================================================================
// Manifest
// =============================================================================

/**
 * Sync state manifest stored on the device.
 * Tracks which files podkit created so we don't accidentally delete user files.
 */
export interface MassStorageManifest {
  version: 1;
  managedFiles: string[];
  lastSync: string;
}

/**
 * Create an empty manifest.
 */
export function createEmptyManifest(): MassStorageManifest {
  return {
    version: 1,
    managedFiles: [],
    lastSync: new Date().toISOString(),
  };
}

/**
 * Check if a file extension is a recognized audio format.
 */
export function isAudioExtension(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Check if a file extension is a recognized video format.
 */
export function isVideoExtension(ext: string): boolean {
  return VIDEO_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Check if a file extension is a recognized media format (audio or video).
 */
export function isMediaExtension(ext: string): boolean {
  return isAudioExtension(ext) || isVideoExtension(ext);
}
