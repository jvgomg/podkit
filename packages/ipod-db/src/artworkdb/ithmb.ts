/**
 * Extractor for iPod .ithmb thumbnail cache files.
 *
 * The .ithmb files contain raw pixel data for multiple thumbnails packed
 * sequentially. Each thumbnail's location is specified by the offset and
 * size fields in the ArtworkDB's mhni records (exposed as ArtworkThumbnail).
 */

import type { ArtworkThumbnail, DecodedImage } from './types.js';
import { getDecoder } from './pixel-formats.js';

/**
 * Extract and decode a single thumbnail from an ithmb cache file.
 *
 * @param ithmbData - The entire contents of the .ithmb file.
 * @param thumbnail - Thumbnail metadata from the ArtworkDB parser.
 * @returns The decoded RGBA image, or `null` if the pixel format is unknown
 *          or the ithmb data is too small.
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

  // Extract raw pixel data from the ithmb file
  const raw = ithmbData.subarray(thumbnail.offset, endOffset);

  // The stored image may include padding rows/columns beyond the
  // actual content dimensions
  const paddedWidth = thumbnail.width + thumbnail.horizontalPadding;
  const paddedHeight = thumbnail.height + thumbnail.verticalPadding;

  // Decode the full padded image to RGBA
  const fullRgba = decoder(raw, paddedWidth, paddedHeight);

  // If there is no padding, return the decoded data directly
  if (thumbnail.horizontalPadding === 0 && thumbnail.verticalPadding === 0) {
    return {
      width: thumbnail.width,
      height: thumbnail.height,
      data: fullRgba,
    };
  }

  // Crop out the padding by copying only the content rows
  const croppedRgba = cropImage(fullRgba, paddedWidth, thumbnail.width, thumbnail.height);

  return {
    width: thumbnail.width,
    height: thumbnail.height,
    data: croppedRgba,
  };
}

/**
 * Crop an RGBA image by removing right and bottom padding.
 *
 * @param rgba - Full RGBA pixel data (paddedWidth * paddedHeight * 4 bytes).
 * @param paddedWidth - Width of the source image including padding.
 * @param cropWidth - Desired output width.
 * @param cropHeight - Desired output height.
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
