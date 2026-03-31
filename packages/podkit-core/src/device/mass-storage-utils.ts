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

/** Podkit state directory on the device */
export const PODKIT_DIR = '.podkit';

// =============================================================================
// Content Paths
// =============================================================================

export interface ContentPaths {
  musicDir: string;
  moviesDir: string;
  tvShowsDir: string;
}

export const DEFAULT_CONTENT_PATHS: ContentPaths = {
  musicDir: 'Music',
  moviesDir: 'Video/Movies',
  tvShowsDir: 'Video/Shows',
};

export function normalizeContentDir(dir: string): string {
  // Strip leading and trailing slashes
  let result = dir.replace(/^\/+|\/+$/g, '');
  // Treat "." as root
  if (result === '.') result = '';
  return result;
}

export function normalizeContentPaths(
  partial: Partial<ContentPaths>,
  defaults: ContentPaths = DEFAULT_CONTENT_PATHS
): ContentPaths {
  return {
    musicDir: normalizeContentDir(partial.musicDir ?? defaults.musicDir),
    moviesDir: normalizeContentDir(partial.moviesDir ?? defaults.moviesDir),
    tvShowsDir: normalizeContentDir(partial.tvShowsDir ?? defaults.tvShowsDir),
  };
}

export function validateContentPaths(paths: ContentPaths): void {
  const entries: Array<[string, string]> = [
    ['musicDir', paths.musicDir],
    ['moviesDir', paths.moviesDir],
    ['tvShowsDir', paths.tvShowsDir],
  ];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i]![1] === entries[j]![1]) {
        throw new Error(
          `Content path conflict: ${entries[i]![0]} and ${entries[j]![0]} both resolve to "${entries[i]![1] || '(root)'}"`
        );
      }
    }
  }
}

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

function joinContentPath(dir: string, ...parts: string[]): string {
  return dir ? `${dir}/${parts.join('/')}` : parts.join('/');
}

// =============================================================================
// Path Templates
// =============================================================================

/**
 * Default path template for music tracks on mass-storage devices.
 *
 * Uses albumArtist for the directory (falls back to artist), which correctly
 * groups compilation/various-artist album tracks together.
 */
export const DEFAULT_MUSIC_PATH_TEMPLATE = '{albumArtist}/{album}/{trackNumber} - {title}{ext}';

/** Variables available for path template resolution */
export interface TrackPathVars {
  albumArtist?: string;
  artist?: string;
  album?: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  totalDiscs?: number;
  genre?: string;
  year?: number;
  ext: string;
}

/**
 * Resolve a path template string into a device-relative file path.
 *
 * Template variables use `{name}` syntax. Each path segment (between `/`)
 * is sanitised for FAT32/exFAT. The filename segment (after the last `/`)
 * uses smart joining: empty variable values and their adjacent separators
 * are collapsed (e.g. `{trackNumber} - {title}` → `Title` when trackNumber
 * is absent, not ` - Title`).
 *
 * @param template - Path template string (e.g. `{albumArtist}/{album}/{trackNumber} - {title}{ext}`)
 * @param vars - Variable values for resolution
 * @param musicDir - Root music directory prefix (prepended to result)
 */
export function resolvePathTemplate(
  template: string,
  vars: TrackPathVars,
  musicDir?: string
): string {
  const ext = vars.ext.startsWith('.') ? vars.ext : `.${vars.ext}`;

  // Resolve album with multi-disc suffix
  let album = vars.album || 'Unknown Album';
  if (vars.totalDiscs && vars.totalDiscs > 1 && vars.discNumber) {
    album = `${album} (disc ${vars.discNumber})`;
  }

  // Build variable map
  const trackNum = padTrackNumber(vars.trackNumber);
  const varMap: Record<string, string> = {
    albumArtist: vars.albumArtist || vars.artist || 'Unknown Artist',
    artist: vars.artist || 'Unknown Artist',
    album,
    title: vars.title,
    trackNumber: trackNum,
    genre: vars.genre || '',
    year: vars.year ? String(vars.year) : '',
    ext,
  };

  // Split template into directory segments and filename
  const templateParts = template.split('/');
  const filenamePart = templateParts.pop()!;
  const dirParts = templateParts;

  // Resolve and sanitise directory segments.
  // Check for emptiness before sanitizing so that optional variables
  // (e.g. {genre}) produce an empty string that gets filtered out,
  // rather than sanitizeFilename('') returning "Unknown".
  const resolvedDirs = dirParts
    .map((part) => {
      const resolved = resolveTemplateSegment(part, varMap).trim();
      return resolved.length > 0 ? sanitizeFilename(resolved) : '';
    })
    .filter((part) => part.length > 0);

  // Resolve filename with smart join (collapse empty vars + separators)
  const resolvedFilename = resolveFilenameTemplate(filenamePart, varMap);

  const dir = musicDir ?? DEFAULT_CONTENT_PATHS.musicDir;
  return joinContentPath(dir, ...resolvedDirs, resolvedFilename);
}

/**
 * Replace `{varName}` placeholders in a template segment.
 */
function resolveTemplateSegment(segment: string, vars: Record<string, string>): string {
  return segment.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
}

/**
 * Resolve a filename template with smart joining.
 *
 * When a variable resolves to empty, its adjacent literal separators
 * (` - `, `. `, etc.) are also removed to avoid orphaned punctuation.
 * The `{ext}` variable is always preserved (never collapsed).
 */
function resolveFilenameTemplate(template: string, vars: Record<string, string>): string {
  // Tokenize the template into variable refs and literal text
  const tokens: Array<{ type: 'var'; name: string } | { type: 'literal'; text: string }> = [];
  let lastIndex = 0;
  const varPattern = /\{(\w+)\}/g;
  let match;

  while ((match = varPattern.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'literal', text: template.slice(lastIndex, match.index) });
    }
    tokens.push({ type: 'var', name: match[1]! });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < template.length) {
    tokens.push({ type: 'literal', text: template.slice(lastIndex) });
  }

  // Resolve: skip empty vars and collapse adjacent separators
  let result = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'var') {
      const value = vars[token.name] ?? '';
      if (token.name === 'ext') {
        // Extension is always included
        result += value;
      } else if (value === '') {
        // Empty var: skip it and consume adjacent literal separator
        // Look ahead — if next token is a literal separator before another var/end, skip it
        if (i + 1 < tokens.length && tokens[i + 1]!.type === 'literal') {
          i++; // skip the separator
        }
      } else {
        result += sanitizeFilename(value);
      }
    } else {
      result += token.text;
    }
  }

  // Clean up any leading/trailing separators that remain
  result = result.replace(/^\s*[-–—.·]\s*/, '').replace(/\s*[-–—.·]\s*$/, '');

  return result || 'Unknown';
}

/**
 * Generate the device-relative file path for a track.
 *
 * Format: {musicDir}/{albumArtist}/{album}/{trackNumber} - {title}.{ext}
 *
 * When totalDiscs > 1, appends " (disc N)" to the album name to work
 * around the Echo Mini's broken disc-first sorting.
 */
export function generateTrackPath(opts: {
  artist?: string;
  albumArtist?: string;
  album?: string;
  title: string;
  trackNumber?: number;
  discNumber?: number;
  totalDiscs?: number;
  extension: string;
  musicDir?: string;
  pathTemplate?: string;
}): string {
  return resolvePathTemplate(
    opts.pathTemplate ?? DEFAULT_MUSIC_PATH_TEMPLATE,
    {
      albumArtist: opts.albumArtist,
      artist: opts.artist,
      album: opts.album,
      title: opts.title,
      trackNumber: opts.trackNumber,
      discNumber: opts.discNumber,
      totalDiscs: opts.totalDiscs,
      ext: opts.extension,
    },
    opts.musicDir
  );
}

/**
 * Generate the device-relative file path for a video.
 *
 * Movies:   {moviesDir}/{title} ({year}).{ext}
 * TV Shows: {tvShowsDir}/{show}/Season {N}/{episode}.{ext}
 */
export function generateVideoPath(opts: {
  title: string;
  contentType: 'movie' | 'tvshow';
  year?: number;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  extension: string;
  moviesDir?: string;
  tvShowsDir?: string;
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
    const dir = opts.tvShowsDir ?? DEFAULT_CONTENT_PATHS.tvShowsDir;
    return joinContentPath(dir, showSafe, `Season ${season}`, `${epPrefix}${titleSafe}${ext}`);
  }

  // Movie
  const yearSuffix = opts.year ? ` (${opts.year})` : '';
  const dir = opts.moviesDir ?? DEFAULT_CONTENT_PATHS.moviesDir;
  return joinContentPath(dir, `${titleSafe}${yearSuffix}${ext}`);
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
