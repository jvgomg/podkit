/**
 * Artwork extraction utilities
 *
 * Extracts embedded artwork from audio files using music-metadata.
 * Supports FLAC, MP3, M4A, and other common formats.
 */

import * as mm from 'music-metadata';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractedArtwork } from './types.js';

/**
 * Picture type preference order for selecting from multiple images.
 * Front cover is strongly preferred over other types.
 */
const PICTURE_TYPE_PRIORITY: Record<string, number> = {
  'Cover (front)': 0,
  Cover: 1,
  Media: 2,
  'Leaflet page': 3,
  'Cover (back)': 4,
  'Lead artist': 5,
  Artist: 6,
  Band: 7,
  Composer: 8,
  Conductor: 9,
  Illustration: 10,
  'Publisher logotype': 11,
  Other: 100,
};

/**
 * Get priority score for a picture type.
 * Lower is better. Unknown types get a high score.
 */
function getPictureTypePriority(type: string | undefined): number {
  if (!type) return 50;
  return PICTURE_TYPE_PRIORITY[type] ?? 50;
}

/**
 * Supported artwork MIME types and their file extensions
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/webp': '.webp',
};

/**
 * Get file extension for a MIME type
 */
function getExtensionForMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? '.jpg';
}

/**
 * Options for artwork extraction
 */
export interface ExtractArtworkOptions {
  /**
   * Logger function for verbose output (e.g., for -vvv mode).
   * Called when skipping artwork extraction due to missing artwork.
   */
  onSkip?: (reason: string) => void;
}

/**
 * Extract embedded artwork from an audio file.
 *
 * Uses music-metadata to parse the file and extract embedded pictures.
 * If multiple pictures are present, prefers front cover over other types.
 *
 * @param filePath - Path to the audio file
 * @param options - Optional extraction options
 * @returns Extracted artwork data, or null if no artwork is embedded
 *
 * @example
 * ```typescript
 * const artwork = await extractArtwork('/path/to/song.flac');
 * if (artwork) {
 *   console.log(`Found ${artwork.mimeType} artwork (${artwork.width}x${artwork.height})`);
 * }
 * ```
 */
export async function extractArtwork(
  filePath: string,
  options?: ExtractArtworkOptions
): Promise<ExtractedArtwork | null> {
  try {
    // Parse file with artwork enabled (skipCovers: false is default)
    const metadata = await mm.parseFile(filePath, {
      skipCovers: false,
    });

    const pictures = metadata.common.picture;

    // No artwork embedded
    if (!pictures || pictures.length === 0) {
      options?.onSkip?.(`No artwork embedded in ${filePath}`);
      return null;
    }

    // Select best picture (prefer front cover)
    const selectedPicture = selectBestPicture(pictures);

    // Convert Uint8Array to Buffer
    const data = Buffer.from(selectedPicture.data);

    // Try to determine dimensions (basic detection)
    const dimensions = detectImageDimensions(data, selectedPicture.format);

    return {
      data,
      mimeType: selectedPicture.format,
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (error) {
    // Return null on parse errors - don't fail the entire operation
    options?.onSkip?.(
      `Failed to extract artwork from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Select the best picture from multiple embedded images.
 * Prefers front cover, then falls back to first image.
 */
function selectBestPicture(pictures: mm.IPicture[]): mm.IPicture {
  if (pictures.length === 1) {
    return pictures[0]!;
  }

  // Sort by type priority (front cover first)
  const sorted = [...pictures].sort((a, b) => {
    return getPictureTypePriority(a.type) - getPictureTypePriority(b.type);
  });

  return sorted[0]!;
}

/**
 * Detect image dimensions from binary data.
 * Supports JPEG and PNG. Returns 0x0 for unsupported formats.
 */
function detectImageDimensions(data: Buffer, mimeType: string): { width: number; height: number } {
  try {
    if (mimeType === 'image/jpeg') {
      return parseJpegDimensions(data);
    }
    if (mimeType === 'image/png') {
      return parsePngDimensions(data);
    }
  } catch {
    // Fall through to default
  }

  return { width: 0, height: 0 };
}

/**
 * Parse JPEG dimensions from file header.
 *
 * JPEG files contain SOF (Start of Frame) markers that encode dimensions.
 * This function scans for SOF0, SOF1, or SOF2 markers.
 */
function parseJpegDimensions(data: Buffer): { width: number; height: number } {
  // JPEG files start with FFD8
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) {
    return { width: 0, height: 0 };
  }

  let offset = 2;

  while (offset < data.length - 8) {
    // Find next marker (starts with 0xFF)
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1];

    // Skip padding bytes (0xFF 0xFF sequences)
    if (marker === 0xff) {
      offset++;
      continue;
    }

    // SOF markers (Start of Frame): 0xC0-0xC3, 0xC5-0xC7, 0xC9-0xCB, 0xCD-0xCF
    // We're interested in SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2) for baseline/progressive
    if (marker !== undefined && marker >= 0xc0 && marker <= 0xc2) {
      // SOF structure: FF C0 LL LL PP HH HH WW WW
      // LL LL = length, PP = precision, HH HH = height, WW WW = width
      if (offset + 9 <= data.length) {
        const height = data.readUInt16BE(offset + 5);
        const width = data.readUInt16BE(offset + 7);
        return { width, height };
      }
    }

    // Move to next marker
    if (offset + 3 < data.length) {
      const length = data.readUInt16BE(offset + 2);
      offset += 2 + length;
    } else {
      break;
    }
  }

  return { width: 0, height: 0 };
}

/**
 * Parse PNG dimensions from file header.
 *
 * PNG files have dimensions in the IHDR chunk (the first chunk after signature).
 */
function parsePngDimensions(data: Buffer): { width: number; height: number } {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (data.length < 24) {
    return { width: 0, height: 0 };
  }

  // Check PNG signature
  if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) {
    return { width: 0, height: 0 };
  }

  // IHDR chunk starts at byte 8 (after signature)
  // Chunk structure: 4 bytes length, 4 bytes type ('IHDR'), then data
  // IHDR data: 4 bytes width, 4 bytes height, ...
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);

  return { width, height };
}

/**
 * Temp file tracking for cleanup
 */
const tempFiles = new Set<string>();

/**
 * Temp directory for artwork files
 */
let tempArtworkDir: string | null = null;

/**
 * Get or create the temp artwork directory
 */
async function getTempArtworkDir(): Promise<string> {
  if (tempArtworkDir === null) {
    tempArtworkDir = join(tmpdir(), `podkit-artwork-${randomUUID()}`);
    await mkdir(tempArtworkDir, { recursive: true });
  }
  return tempArtworkDir;
}

/**
 * Save extracted artwork to a temporary file.
 *
 * Creates a temp file with the appropriate extension based on MIME type.
 * The file should be cleaned up after use with `cleanupTempArtwork()`.
 *
 * @param artwork - Extracted artwork data
 * @returns Path to the temporary file
 *
 * @example
 * ```typescript
 * const artwork = await extractArtwork('/path/to/song.flac');
 * if (artwork) {
 *   const tempPath = await saveArtworkToTemp(artwork);
 *   // Use tempPath with libgpod...
 *   await cleanupTempArtwork(tempPath);
 * }
 * ```
 */
export async function saveArtworkToTemp(artwork: ExtractedArtwork): Promise<string> {
  const dir = await getTempArtworkDir();
  const ext = getExtensionForMimeType(artwork.mimeType);
  const filename = `artwork-${randomUUID()}${ext}`;
  const filePath = join(dir, filename);

  await writeFile(filePath, artwork.data);
  tempFiles.add(filePath);

  return filePath;
}

/**
 * Clean up a single temporary artwork file.
 *
 * @param filePath - Path to the temp file to remove
 */
export async function cleanupTempArtwork(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
    tempFiles.delete(filePath);
  } catch {
    // Ignore errors - file may already be deleted
  }
}

/**
 * Clean up all temporary artwork files created during this session.
 *
 * Should be called at the end of a sync operation to clean up
 * any remaining temp files.
 */
export async function cleanupAllTempArtwork(): Promise<void> {
  // Clean up individual files
  for (const filePath of tempFiles) {
    try {
      await rm(filePath, { force: true });
    } catch {
      // Ignore errors
    }
  }
  tempFiles.clear();

  // Remove temp directory if it was created
  if (tempArtworkDir !== null) {
    try {
      await rm(tempArtworkDir, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
    tempArtworkDir = null;
  }
}

/**
 * Extract artwork from a file and save it to a temp file.
 *
 * Convenience function that combines extraction and saving.
 * Returns null if no artwork is found (does not create a temp file).
 *
 * @param filePath - Path to the audio file
 * @param options - Optional extraction options
 * @returns Path to the temp artwork file, or null if no artwork
 *
 * @example
 * ```typescript
 * const artworkPath = await extractAndSaveArtwork('/path/to/song.flac');
 * if (artworkPath) {
 *   // artworkPath is ready for libgpod
 * }
 * ```
 */
export async function extractAndSaveArtwork(
  filePath: string,
  options?: ExtractArtworkOptions
): Promise<string | null> {
  const artwork = await extractArtwork(filePath, options);
  if (!artwork) {
    return null;
  }
  return saveArtworkToTemp(artwork);
}
