/**
 * Metadata extraction utilities for audio files
 *
 * Provides utilities for extracting display metadata from audio files
 * for use in listing and verification commands.
 */

import * as mm from 'music-metadata';

/**
 * Display metadata extracted from an audio file
 */
export interface FileDisplayMetadata {
  /** Whether the file has embedded artwork */
  hasArtwork: boolean;
  /** Bitrate in kbps (undefined if not available) */
  bitrate: number | undefined;
}

/**
 * Extract display metadata from an audio file
 *
 * Extracts artwork presence and bitrate information in a single pass.
 * Returns sensible defaults if extraction fails.
 *
 * @param filePath - Path to the audio file
 * @returns Display metadata with artwork and bitrate info
 *
 * @example
 * ```typescript
 * const metadata = await getFileDisplayMetadata('/path/to/song.flac');
 * console.log(`Has artwork: ${metadata.hasArtwork}`);
 * console.log(`Bitrate: ${metadata.bitrate} kbps`);
 * ```
 */
export async function getFileDisplayMetadata(filePath: string): Promise<FileDisplayMetadata> {
  try {
    const metadata = await mm.parseFile(filePath, { skipCovers: false });

    // Check for artwork
    const hasArtwork = metadata.common.picture !== undefined && metadata.common.picture.length > 0;

    // Extract bitrate (convert from bps to kbps)
    const bitrate = metadata.format.bitrate
      ? Math.round(metadata.format.bitrate / 1000)
      : undefined;

    return { hasArtwork, bitrate };
  } catch {
    // Return defaults if extraction fails
    return { hasArtwork: false, bitrate: undefined };
  }
}

/**
 * Extract display metadata for multiple files in parallel
 *
 * Efficiently extracts metadata from multiple files concurrently.
 *
 * @param filePaths - Array of file paths to extract metadata from
 * @returns Map of file path to display metadata
 *
 * @example
 * ```typescript
 * const paths = ['/path/to/song1.flac', '/path/to/song2.mp3'];
 * const metadataMap = await getFilesDisplayMetadata(paths);
 * for (const [path, metadata] of metadataMap) {
 *   console.log(`${path}: artwork=${metadata.hasArtwork}, bitrate=${metadata.bitrate}`);
 * }
 * ```
 */
export async function getFilesDisplayMetadata(
  filePaths: string[]
): Promise<Map<string, FileDisplayMetadata>> {
  const results = await Promise.all(
    filePaths.map(async (filePath) => {
      const metadata = await getFileDisplayMetadata(filePath);
      return [filePath, metadata] as const;
    })
  );

  return new Map(results);
}
