/**
 * Pixel-format decoders for iPod `.ithmb` thumbnail cache files.
 *
 * iPod thumbnails are stored as raw, uncompressed pixel data in one of a few
 * platform-specific formats. Every decoder converts to RGBA (4 bytes per pixel)
 * so the rest of the archive pipeline handles a single uniform shape.
 *
 * Common `formatId` → pixel-format mappings (the table varies slightly by iPod
 * model; these cover the generations podkit archives):
 *   - 1027–1031, 1055, 1057, 1060, 1061: RGB565 (16-bit, little-endian)
 *   - 1066, 1067:                        RGB555 (16-bit, little-endian)
 *   - 1068:                              treated as RGB565 (see note in
 *                                        {@link getDecoder})
 *
 * Ported from `@podkit/ipod-db`'s `artworkdb/pixel-formats.ts`. Pure and
 * IO-free: every function takes raw bytes and returns RGBA bytes, so they are
 * unit-testable with synthetic buffers.
 *
 * @module
 */

/** A pixel decoder: raw stored bytes + dimensions → RGBA bytes. */
export type PixelDecoder = (input: Uint8Array, width: number, height: number) => Uint8Array;

/**
 * Decode RGB565 pixel data to RGBA.
 *
 * RGB565 is the most common iPod thumbnail format. Each pixel is 2 bytes
 * (little-endian): 5 bits red, 6 bits green, 5 bits blue. The 5/6-bit channels
 * are scaled up to 8-bit with rounding (`(v * 255 + half) / range`).
 */
export function decodeRgb565(input: Uint8Array, width: number, height: number): Uint8Array {
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
    rgba[outIdx] = (r * 255 + 15) / 31; // 5-bit → 8-bit
    rgba[outIdx + 1] = (g * 255 + 31) / 63; // 6-bit → 8-bit
    rgba[outIdx + 2] = (b * 255 + 15) / 31; // 5-bit → 8-bit
    rgba[outIdx + 3] = 255;
  }

  return rgba;
}

/**
 * Decode RGB555 pixel data to RGBA.
 *
 * Each pixel is 2 bytes (little-endian): 1 unused (high) bit, then 5 bits red,
 * 5 bits green, 5 bits blue.
 */
export function decodeRgb555(input: Uint8Array, width: number, height: number): Uint8Array {
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
 * Each pixel is 3 bytes — red, green, blue — with no stored alpha channel.
 */
export function decodeRgb888(input: Uint8Array, width: number, height: number): Uint8Array {
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

/**
 * Resolve the pixel decoder for a given `formatId`, or `null` for an unknown
 * format so callers can skip unsupported thumbnails gracefully instead of
 * throwing.
 */
export function getDecoder(formatId: number): PixelDecoder | null {
  switch (formatId) {
    // RGB565 — most common across iPod models.
    case 1027:
    case 1028:
    case 1029:
    case 1030:
    case 1031:
    case 1055:
    case 1057:
    case 1060:
    case 1061:
    // formatId 1068 is labelled RGB888 in some references, but many iPod
    // models actually store it as RGB565. libgpod uses device-specific
    // artwork tables; we default 16-bit-sized formats to RGB565.
    case 1068:
      return decodeRgb565;

    case 1066:
    case 1067:
      return decodeRgb555;

    default:
      return null;
  }
}

/**
 * Bytes-per-pixel for a given `formatId`: 2 for the 16-bit formats (RGB565 /
 * RGB555), `null` for unknown formats.
 *
 * Must stay consistent with {@link getDecoder}: every format that resolves to a
 * 2-byte decoder reports 2 here. In particular `1068` is decoded as RGB565 (see
 * the note in {@link getDecoder}), so it reports 2 — not 3 — even though some
 * references label it RGB888.
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
    case 1068:
      return 2;

    default:
      return null;
  }
}
