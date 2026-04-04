/**
 * Pixel format decoders for iPod .ithmb thumbnail cache files.
 *
 * iPod thumbnails are stored as raw pixel data in platform-specific formats.
 * All decoders convert to RGBA (4 bytes per pixel) for uniform handling.
 *
 * Common formatId → pixel format mappings (varies by iPod model):
 *   - 1055, 1057, 1031, 1027, 1028, 1029, 1030: RGB565 (16-bit)
 *   - 1066, 1067: RGB555 (16-bit)
 *   - 1068: RGB888 (24-bit)
 */

/**
 * Decode RGB565 pixel data to RGBA.
 *
 * RGB565 is the most common iPod thumbnail format. Each pixel is 2 bytes
 * (little-endian): 5 bits red, 6 bits green, 5 bits blue.
 */
export function decodeRGB565(input: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

  for (let i = 0; i < pixelCount; i++) {
    const byteOffset = i * 2;
    if (byteOffset + 2 > input.byteLength) break;

    const pixel = view.getUint16(byteOffset, true); // little-endian
    const r = (pixel >> 11) & 0x1f;
    const g = (pixel >> 5) & 0x3f;
    const b = pixel & 0x1f;

    const outIdx = i * 4;
    rgba[outIdx] = (r * 255 + 15) / 31; // scale 5-bit to 8-bit
    rgba[outIdx + 1] = (g * 255 + 31) / 63; // scale 6-bit to 8-bit
    rgba[outIdx + 2] = (b * 255 + 15) / 31; // scale 5-bit to 8-bit
    rgba[outIdx + 3] = 255;
  }

  return rgba;
}

/**
 * Decode RGB555 pixel data to RGBA.
 *
 * Each pixel is 2 bytes (little-endian): 1 unused bit, 5 bits red,
 * 5 bits green, 5 bits blue.
 */
export function decodeRGB555(input: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);

  for (let i = 0; i < pixelCount; i++) {
    const byteOffset = i * 2;
    if (byteOffset + 2 > input.byteLength) break;

    const pixel = view.getUint16(byteOffset, true); // little-endian
    const r = (pixel >> 10) & 0x1f;
    const g = (pixel >> 5) & 0x1f;
    const b = pixel & 0x1f;

    const outIdx = i * 4;
    rgba[outIdx] = (r * 255 + 15) / 31;
    rgba[outIdx + 1] = (g * 255 + 15) / 31;
    rgba[outIdx + 2] = (b * 255 + 15) / 31;
    rgba[outIdx + 3] = 255;
  }

  return rgba;
}

/**
 * Decode RGB888 pixel data to RGBA.
 *
 * Each pixel is 3 bytes: red, green, blue (no alpha channel).
 */
export function decodeRGB888(input: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 3;
    if (srcIdx + 3 > input.byteLength) break;

    const outIdx = i * 4;
    rgba[outIdx] = input[srcIdx]!;
    rgba[outIdx + 1] = input[srcIdx + 1]!;
    rgba[outIdx + 2] = input[srcIdx + 2]!;
    rgba[outIdx + 3] = 255;
  }

  return rgba;
}

/** A pixel decoder function signature. */
export type PixelDecoder = (input: Uint8Array, width: number, height: number) => Uint8Array;

/**
 * Get the pixel decoder for a given formatId.
 *
 * Returns `null` for unknown format IDs rather than throwing, so callers
 * can skip unsupported thumbnail formats gracefully.
 */
export function getDecoder(formatId: number): PixelDecoder | null {
  // RGB565 — most common across iPod models
  switch (formatId) {
    case 1027:
    case 1028:
    case 1029:
    case 1030:
    case 1031:
    case 1055:
    case 1057:
    case 1060:
    case 1061:
    case 1068:
      // Note: formatId 1068 is listed as RGB888 in some references but
      // many iPod models actually use RGB565. The libgpod source uses
      // device-specific artwork format tables. For safety we default to
      // RGB565 for all 16-bit-sized formats and RGB888 only when the
      // image size clearly indicates 3 bytes per pixel.
      return decodeRGB565;

    case 1066:
    case 1067:
      return decodeRGB555;

    default:
      return null;
  }
}

/**
 * Get the bytes per pixel for a given formatId.
 *
 * Returns 2 for 16-bit formats (RGB565, RGB555) and 3 for 24-bit (RGB888).
 * Returns `null` for unknown formats.
 */
export function getBytesPerPixel(formatId: number): number | null {
  switch (formatId) {
    case 1027:
    case 1028:
    case 1029:
    case 1030:
    case 1031:
    case 1055:
    case 1057:
    case 1060:
    case 1061:
    case 1066:
    case 1067:
      return 2;

    case 1068:
      return 3;

    default:
      return null;
  }
}
