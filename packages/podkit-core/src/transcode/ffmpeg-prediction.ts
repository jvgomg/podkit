/**
 * Pure-TS predictions for what FFmpeg will produce given known inputs.
 *
 * Production code builds FFmpeg argument strings; FFmpeg itself decides the
 * bytes. Tests and matrix predictors need to *anticipate* the result without
 * running FFmpeg. This module is the one place that mirrors those quirks, so
 * production and tests can't drift apart on the same edge case.
 *
 * When you add a new prediction, write a unit test that runs FFmpeg with the
 * matching argument builder and asserts the prediction matches.
 *
 * @module
 */

/**
 * Final square edge length of an artwork cover after the FFmpeg scale filter
 * in `buildArtworkScaleFilter`. The filter:
 *
 * - clamps each dimension to `min(maxDim, source)` (no upscaling),
 * - then rounds DOWN to the nearest even number via `force_divisible_by=2`
 *   (required because some codecs/pixel formats can't accept odd dimensions).
 *
 * So an `artworkMaxResolution` of 127 yields 126 in real output, 320 stays
 * 320, a 1024px source against max=500 yields 500, and a 4096px max against
 * a 1024px source yields 1024.
 */
export function predictArtworkScaleSize(sourceSize: number, maxDim: number): number {
  return clampToEven(Math.min(sourceSize, maxDim));
}

function clampToEven(n: number): number {
  return n - (n % 2);
}
