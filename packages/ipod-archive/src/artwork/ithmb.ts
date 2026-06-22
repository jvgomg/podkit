/**
 * Extractor for iPod `.ithmb` thumbnail cache files.
 *
 * An `.ithmb` packs many fixed-size thumbnail tiles back to back. A thumbnail's
 * location is given by the `offset`/`size` from the ArtworkDB (`mhni`). The
 * stored tile may be padded to a larger grid than its content dimensions, so
 * after decoding to RGBA we crop the right/bottom padding away.
 *
 * Pure decode: takes the full `.ithmb` bytes plus a thumbnail descriptor and
 * returns RGBA. No file IO — the caller reads the `.ithmb` and hands it in.
 *
 * Ported from `@podkit/ipod-db`'s `artworkdb/ithmb.ts`.
 *
 * @module
 */

import { getDecoder } from './pixel-formats.js';
import type { ArtworkThumbnail, DecodedImage } from './types.js';

/**
 * Decode a single thumbnail tile out of an `.ithmb` file's bytes.
 *
 * @param ithmbData - the entire contents of the `.ithmb` file.
 * @param thumbnail - the thumbnail descriptor from the ArtworkDB.
 * @returns the decoded RGBA image, or `null` when the pixel format is unknown
 *   or the tile's `[offset, offset+size)` range falls outside the file.
 */
export function extractThumbnail(
  ithmbData: Uint8Array,
  thumbnail: ArtworkThumbnail
): DecodedImage | null {
  const decoder = getDecoder(thumbnail.formatId);
  if (decoder === null) {
    return null;
  }

  const endOffset = thumbnail.offset + thumbnail.size;
  if (endOffset > ithmbData.byteLength) {
    return null;
  }

  // The raw tile bytes for this thumbnail.
  const raw = ithmbData.subarray(thumbnail.offset, endOffset);

  // The stored tile may include padding rows/columns beyond the content.
  const paddedWidth = thumbnail.width + thumbnail.horizontalPadding;
  const paddedHeight = thumbnail.height + thumbnail.verticalPadding;

  const fullRgba = decoder(raw, paddedWidth, paddedHeight);

  // No padding → the decoded data is already the final image.
  if (thumbnail.horizontalPadding === 0 && thumbnail.verticalPadding === 0) {
    return {
      width: thumbnail.width,
      height: thumbnail.height,
      data: fullRgba,
    };
  }

  // Crop the right/bottom padding by copying only the content rows.
  const croppedRgba = cropImage(fullRgba, paddedWidth, thumbnail.width, thumbnail.height);

  return {
    width: thumbnail.width,
    height: thumbnail.height,
    data: croppedRgba,
  };
}

/**
 * Crop an RGBA image down to `cropWidth × cropHeight` by dropping the
 * right/bottom padding — copying the leading `cropWidth` columns of the first
 * `cropHeight` rows out of a `paddedWidth`-stride source.
 */
function cropImage(
  rgba: Uint8Array,
  paddedWidth: number,
  cropWidth: number,
  cropHeight: number
): Uint8Array {
  const result = new Uint8Array(cropWidth * cropHeight * 4);
  const srcStride = paddedWidth * 4;
  const dstStride = cropWidth * 4;

  for (let row = 0; row < cropHeight; row++) {
    const srcOffset = row * srcStride;
    const dstOffset = row * dstStride;
    result.set(rgba.subarray(srcOffset, srcOffset + dstStride), dstOffset);
  }

  return result;
}
