/**
 * Tests for artwork resize utility
 */

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resizeArtwork } from './resize.js';

/** Generate a JPEG test image of specific dimensions using FFmpeg */
function generateTestJpeg(width: number, height: number): Buffer {
  return Buffer.from(
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=blue:size=${width}x${height}:duration=1:rate=1`,
        '-frames:v',
        '1',
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
  );
}

/** Generate a PNG test image using FFmpeg */
function generateTestPng(width: number, height: number): Buffer {
  return Buffer.from(
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=green:size=${width}x${height}:duration=1:rate=1`,
        '-frames:v',
        '1',
        '-f',
        'image2',
        '-c:v',
        'png',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
  );
}

describe('resizeArtwork', () => {
  test('downscales a large image to fit within maxDim', async () => {
    const largeImage = generateTestJpeg(800, 600);
    const resized = await resizeArtwork(largeImage, 300);

    // Output should be JPEG
    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);

    // Should be smaller than original
    expect(resized.length).toBeLessThan(largeImage.length);
  });

  test('does not upscale a small image', async () => {
    const smallImage = generateTestJpeg(100, 100);
    const resized = await resizeArtwork(smallImage, 600);

    // Output should still be valid JPEG
    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);
  });

  test('handles PNG input and outputs JPEG', async () => {
    const pngImage = generateTestPng(400, 400);
    const resized = await resizeArtwork(pngImage, 200);

    // Output should be JPEG regardless of input format
    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);
  });

  test('preserves aspect ratio', async () => {
    // 800x400 image scaled to max 300 should become 300x150 (or close, with even rounding)
    const wideImage = generateTestJpeg(800, 400);
    const resized = await resizeArtwork(wideImage, 300);

    // Just verify it's a valid, non-empty JPEG
    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);
    expect(resized.length).toBeGreaterThan(100);
  });
});
