/**
 * Parsed-ArtworkDB record shapes and the decoded-image output shape.
 *
 * The ArtworkDB is a binary database stored alongside the iTunesDB. It maps
 * track artwork (linked to a track's 64-bit `dbid`) to thumbnail tiles packed
 * inside `.ithmb` cache files. The format uses the same mh-record convention as
 * the iTunesDB: a 4-byte ASCII tag, a header length, then a total length.
 *
 * Ported from `@podkit/ipod-db`'s `artworkdb/types.ts` — only the records this
 * package actually consumes (images + their thumbnails) are retained.
 *
 * @module
 */

/** Top-level parsed ArtworkDB: the image list (each with its thumbnails). */
export interface ArtworkDatabase {
  images: ArtworkImage[];
}

/** One image item (`mhii`) — links a track `dbid` to its thumbnail variants. */
export interface ArtworkImage {
  /** Image ID (`mhii.imageId`); links to the iTunesDB artwork id. */
  imageId: number;
  /**
   * Track `dbid` this artwork belongs to (`mhii.songId`, 64-bit). This is the
   * linkage podkit uses: `image.sourceId === track.dbid`.
   */
  sourceId: bigint;
  /** Thumbnail variants stored across the `.ithmb` cache files. */
  thumbnails: ArtworkThumbnail[];
}

/** One thumbnail variant (`mhni`): where it lives in an `.ithmb` and its size. */
export interface ArtworkThumbnail {
  /** Format identifier — selects the pixel format and the `F<id>_n.ithmb` file. */
  formatId: number;
  /** Content width in pixels (excluding padding). */
  width: number;
  /** Content height in pixels (excluding padding). */
  height: number;
  /** Byte offset of this tile inside its `.ithmb` file. */
  offset: number;
  /** Byte size of the tile's pixel data in the `.ithmb`. */
  size: number;
  /** Extra padding columns stored beyond `width`. */
  horizontalPadding: number;
  /** Extra padding rows stored beyond `height`. */
  verticalPadding: number;
  /**
   * Optional colon-separated device path from an `mhod` type-3 child, e.g.
   * `":iPod_Control:Artwork:F1057_1.ithmb"`. When present it names the exact
   * `.ithmb` file; otherwise the file is found by `formatId`.
   */
  filename?: string;
}

/** A decoded RGBA image: `data` is `width * height * 4` bytes. */
export interface DecodedImage {
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** RGBA pixel data (`width * height * 4` bytes). */
  data: Uint8Array;
}
