/**
 * Type definitions for parsed ArtworkDB records.
 *
 * The ArtworkDB is a binary database stored on iPod devices alongside the
 * iTunesDB. It maps track artwork (referenced via MhitRecord.mhiiLink) to
 * thumbnail images stored in .ithmb cache files.
 *
 * The format uses the same mh-record convention as iTunesDB: each record
 * starts with a 4-byte ASCII tag, a header length, and a total length.
 */

// ── Top-level parsed database ───────────────────────────────────────

export interface ArtworkDatabase {
  images: ArtworkImage[];
  albums: ArtworkAlbum[];
  files: ArtworkFile[];
}

// ── Image records ───────────────────────────────────────────────────

export interface ArtworkImage {
  /** Image ID — maps to MhitRecord.mhiiLink in the iTunesDB. */
  imageId: number;
  /** Original image size in bytes. */
  imageSize: number;
  /** Track dbid associated with this artwork (for backward compat). */
  sourceId: bigint;
  /** Thumbnail variants stored in ithmb files. */
  thumbnails: ArtworkThumbnail[];
}

export interface ArtworkThumbnail {
  /** Format identifier — determines pixel format and ithmb filename. */
  formatId: number;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Byte offset into the ithmb cache file. */
  offset: number;
  /** Byte size of pixel data in the ithmb file. */
  size: number;
  /** Horizontal padding in pixels (extra columns beyond width). */
  horizontalPadding: number;
  /** Vertical padding in pixels (extra rows beyond height). */
  verticalPadding: number;
  /** Optional filename from MHOD type 3 (e.g. ":iPod_Control:Artwork:F1057_1.ithmb"). */
  filename?: string;
}

// ── Album records ───────────────────────────────────────────────────

export interface ArtworkAlbum {
  albumId: number;
  name?: string;
  imageIds: number[];
}

// ── File records ────────────────────────────────────────────────────

export interface ArtworkFile {
  /** Format identifier — matches ArtworkThumbnail.formatId. */
  formatId: number;
  /** Size of each image tile in the ithmb file. */
  imageSize: number;
}

// ── Decoded image output ────────────────────────────────────────────

export interface DecodedImage {
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** RGBA pixel data (width * height * 4 bytes). */
  data: Uint8Array;
}
