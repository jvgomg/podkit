/**
 * ArtworkDecoder — resolve a track's largest album-art thumbnail to RGBA.
 *
 * One decoder is built per dump from its iPod root. Construction parses the
 * `ArtworkDB` once and indexes every image by its track `dbid`, keeping only
 * the *largest* thumbnail per track (largest = greatest pixel area). Decoding
 * is then on demand: {@link ArtworkDecoder.coverRgba} reads the matching
 * `F<formatId>_<n>.ithmb` (memoised) and decodes the tile to RGBA.
 *
 * Degrades gracefully — the factory returns a decoder whose `coverRgba` always
 * yields `null` when the dump has no `ArtworkDB` (or it can't be read), and an
 * individual lookup returns `null` when the track has no artwork or its
 * `.ithmb` is missing. None of this aborts the archive run; tracks without
 * artwork are simply skipped.
 *
 * @module
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArtworkDatabase } from './artwork-db.js';
import { extractThumbnail } from './ithmb.js';
import type { ArtworkThumbnail, DecodedImage } from './types.js';

/** Relative path of the Artwork directory inside an iPod root. */
const ARTWORK_DIR = join('iPod_Control', 'Artwork');
/** Relative path of the ArtworkDB inside an iPod root. */
const ARTWORK_DB_PATH = join(ARTWORK_DIR, 'ArtworkDB');

/**
 * The dimensions and pixel-format identifier of the largest indexed thumbnail
 * for a track. This is metadata only — it is read straight from the indexed
 * `ArtworkThumbnail` without touching the `.ithmb` pixel bytes, so it is cheap
 * and never decodes. The catalogue's `artwork` table is sourced from this.
 */
export interface ArtworkInfo {
  /** Content width in pixels of the largest thumbnail. */
  width: number;
  /** Content height in pixels of the largest thumbnail. */
  height: number;
  /** libgpod format identifier of the largest thumbnail (`F<formatId>_n.ithmb`). */
  formatId: number;
}

/** Reads a track's largest album art as RGBA, or `null` when none is available. */
export interface ArtworkDecoder {
  /**
   * Decode the largest thumbnail for the track with this `dbid` to RGBA.
   *
   * @returns the decoded image, or `null` when the track has no artwork, the
   *   thumbnail's pixel format is unsupported, or its `.ithmb` is absent.
   */
  coverRgba(dbid: bigint): DecodedImage | null;

  /**
   * The dimensions + format of the largest indexed thumbnail for `dbid`, or
   * `null` when the track has no artwork record. Pure metadata: it reports what
   * the ArtworkDB index already knows without reading or decoding any `.ithmb`
   * pixels, so the catalogue can record artwork rows even for thumbnails whose
   * pixel format it cannot decode.
   */
  artworkInfo(dbid: bigint): ArtworkInfo | null;
}

/** A decoder that always yields `null` — used when the dump has no readable ArtworkDB. */
const NULL_DECODER: ArtworkDecoder = {
  coverRgba() {
    return null;
  },
  artworkInfo() {
    return null;
  },
};

/**
 * Build an {@link ArtworkDecoder} for the dump rooted at `ipodRoot`.
 *
 * Reads and parses `<ipodRoot>/iPod_Control/Artwork/ArtworkDB`. When that file
 * is absent or unparseable, returns a decoder that yields `null` for every
 * track (many iPods carry no artwork — this is not an error).
 */
export function createArtworkDecoder(ipodRoot: string): ArtworkDecoder {
  let db;
  try {
    const bytes = readFileSync(join(ipodRoot, ARTWORK_DB_PATH));
    db = parseArtworkDatabase(bytes);
  } catch {
    // Missing or unreadable/malformed ArtworkDB → no artwork for this dump.
    return NULL_DECODER;
  }

  // Index the largest thumbnail per track dbid. A dbid can appear on more than
  // one image record; keep whichever yields the largest-area thumbnail.
  const byDbid = new Map<bigint, ArtworkThumbnail>();
  for (const image of db.images) {
    const largest = largestThumbnail(image.thumbnails);
    if (largest === null) continue;

    const existing = byDbid.get(image.sourceId);
    if (existing === undefined || thumbArea(largest) > thumbArea(existing)) {
      byDbid.set(image.sourceId, largest);
    }
  }

  if (byDbid.size === 0) {
    return NULL_DECODER;
  }

  const artworkDir = join(ipodRoot, ARTWORK_DIR);
  // Memoise loaded .ithmb files (and load failures, recorded as null) so a
  // shared cache file is read once across an album's worth of tracks.
  const ithmbCache = new Map<string, Uint8Array | null>();

  return {
    coverRgba(dbid: bigint): DecodedImage | null {
      const thumb = byDbid.get(dbid);
      if (thumb === undefined) return null;

      const ithmb = loadIthmb(artworkDir, thumb, ithmbCache);
      if (ithmb === null) return null;

      return extractThumbnail(ithmb, thumb);
    },

    artworkInfo(dbid: bigint): ArtworkInfo | null {
      const thumb = byDbid.get(dbid);
      if (thumb === undefined) return null;
      return { width: thumb.width, height: thumb.height, formatId: thumb.formatId };
    },
  };
}

/** Pick the largest-area thumbnail, or `null` when the list is empty. */
function largestThumbnail(thumbnails: ArtworkThumbnail[]): ArtworkThumbnail | null {
  let best: ArtworkThumbnail | null = null;
  for (const t of thumbnails) {
    if (best === null || thumbArea(t) > thumbArea(best)) {
      best = t;
    }
  }
  return best;
}

/** Content pixel area (excluding padding). */
function thumbArea(t: ArtworkThumbnail): number {
  return t.width * t.height;
}

/**
 * Load the `.ithmb` cache file for a thumbnail, memoised on its resolved
 * filename. Prefers the explicit colon-path filename from the ArtworkDB; falls
 * back to scanning the Artwork dir for an `F<formatId>_*.ithmb`. A failed load
 * is cached as `null` so it isn't retried.
 */
function loadIthmb(
  artworkDir: string,
  thumb: ArtworkThumbnail,
  cache: Map<string, Uint8Array | null>
): Uint8Array | null {
  const basename = resolveIthmbBasename(artworkDir, thumb);
  if (basename === null) return null;

  const cached = cache.get(basename);
  if (cached !== undefined) return cached;

  let data: Uint8Array | null;
  try {
    data = readFileSync(join(artworkDir, basename));
  } catch {
    data = null;
  }
  cache.set(basename, data);
  return data;
}

/**
 * Resolve the `.ithmb` basename for a thumbnail. The ArtworkDB filename (if
 * present) is a colon-separated device path like
 * `":iPod_Control:Artwork:F1057_1.ithmb"`; its last segment is the basename.
 * Otherwise the Artwork dir is scanned for an `F<formatId>_*.ithmb`.
 */
function resolveIthmbBasename(artworkDir: string, thumb: ArtworkThumbnail): string | null {
  if (thumb.filename) {
    const parts = thumb.filename.split(':');
    const last = parts[parts.length - 1];
    if (last && last.length > 0) return last;
  }

  const prefix = `F${thumb.formatId}_`;
  try {
    for (const name of readdirSync(artworkDir)) {
      if (name.startsWith(prefix) && name.endsWith('.ithmb')) {
        return name;
      }
    }
  } catch {
    // Artwork dir missing — no ithmb to resolve.
  }
  return null;
}
