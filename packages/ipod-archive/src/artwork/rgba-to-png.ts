/**
 * `rgbaToPng` — encode a decoded RGBA image to a PNG buffer in-process.
 *
 * A thin wrapper over `pngjs`' synchronous encoder. The decoded thumbnail RGBA
 * from {@link ArtworkDecoder} is 8-bit-per-channel, 4-channels (RGBA), already
 * the shape `pngjs` expects for `colorType: 6`. Pure and in-memory: no temp
 * files, no spawned process.
 *
 * @module
 */

import { PNG } from 'pngjs';
import type { DecodedImage } from './types.js';

/**
 * Encode an RGBA image to a PNG byte buffer.
 *
 * @param image - decoded RGBA pixels; `data` must be `width * height * 4` bytes.
 * @returns the PNG file bytes (signature `\x89PNG\r\n\x1a\n`, then the chunks).
 * @throws RangeError when `data` is not exactly `width * height * 4` bytes —
 *   a malformed decode would otherwise silently produce a corrupt PNG.
 */
export function rgbaToPng(image: DecodedImage): Buffer {
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new RangeError(
      `rgbaToPng: expected ${expected} RGBA bytes for ${image.width}x${image.height}, ` +
        `got ${image.data.length}`
    );
  }

  const png = new PNG({ width: image.width, height: image.height });
  // pngjs's `data` is a Buffer of RGBA bytes (colorType 6, 8-bit). Copy the
  // decoded pixels in; `Buffer.from` over a Uint8Array is a byte copy.
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}
