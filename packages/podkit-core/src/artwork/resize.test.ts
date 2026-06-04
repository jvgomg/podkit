/**
 * Tests for artwork resize utility
 */

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtworkScaleFilter, resizeArtwork } from './resize.js';

/**
 * Probe a JPEG buffer via ffprobe. Returns `pix_fmt`, `width`, and `height`
 * of the first video stream. Used by the resize tests so the assertions
 * actually verify what FFmpeg produced, not just that the bytes parse as
 * JPEG — magic-byte checks let regressions slip through (an upscaled image
 * is still a valid JPEG).
 */
function probeImage(data: Buffer): { pixFmt: string; width: number; height: number } {
  const tmpfile = join(tmpdir(), `podkit-resize-test-${process.pid}-${Date.now()}.jpg`);
  writeFileSync(tmpfile, data);
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=pix_fmt,width,height',
        '-of',
        'csv=p=0',
        tmpfile,
      ],
      { encoding: 'utf-8' }
    );
    // ffprobe always emits stream attributes in the fixed order
    // `width,height,pix_fmt` under `-of csv=p=0`, regardless of the order
    // requested via `-show_entries`. Don't reorder the destructure based on
    // the request string — it'll silently misalign.
    const [w, h, pf] = out.trim().split(',');
    return { pixFmt: pf!, width: parseInt(w!, 10), height: parseInt(h!, 10) };
  } finally {
    unlinkSync(tmpfile);
  }
}

/** Generate a 4:4:4-chroma JPEG (yuvj444p) — what unprocessed source artwork looks like. */
function generateYuvj444pJpeg(width: number, height: number): Buffer {
  return Buffer.from(
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=red:size=${width}x${height}:duration=1:rate=1`,
        '-frames:v',
        '1',
        '-pix_fmt',
        'yuvj444p',
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

    // Largest dim landed at the cap; the other followed aspect ratio.
    const { width, height } = probeImage(resized);
    expect(Math.max(width, height)).toBeLessThanOrEqual(300);
    // 800x600 → 300x225 (kept aspect ratio); allow ±1 for even-divisible-by-2 rounding.
    expect(width).toBe(300);
    expect(Math.abs(height - 225)).toBeLessThanOrEqual(1);
  });

  test('does not upscale a small image', async () => {
    const smallImage = generateTestJpeg(100, 100);
    const resized = await resizeArtwork(smallImage, 600);

    // Output should still be valid JPEG
    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);

    // The scale filter clamps to `min(maxDim, iw/ih)`, so a 100x100 source
    // must land at 100x100 even with maxDim=600. Without dimension probing
    // an upscaling regression would slip past the magic-byte assertions.
    const { width, height } = probeImage(resized);
    expect(width).toBe(100);
    expect(height).toBe(100);
  });

  test('handles PNG input and outputs JPEG', async () => {
    const pngImage = generateTestPng(400, 400);
    const resized = await resizeArtwork(pngImage, 200);

    // Output should be JPEG regardless of input format
    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);
    expect(probeImage(resized).width).toBe(200);
  });

  test('preserves aspect ratio (downscales wider images proportionally)', async () => {
    // 800x400 image scaled to max 300 should become 300x150.
    const wideImage = generateTestJpeg(800, 400);
    const resized = await resizeArtwork(wideImage, 300);

    expect(resized[0]).toBe(0xff);
    expect(resized[1]).toBe(0xd8);

    const { width, height } = probeImage(resized);
    expect(width).toBe(300);
    expect(Math.abs(height - 150)).toBeLessThanOrEqual(1);
    // Aspect ratio held to within a percent (rounding tolerance).
    expect(Math.abs(width / height - 2.0)).toBeLessThan(0.05);
  });

  test('forces yuvj420p chroma even when source is yuvj444p', async () => {
    // Devices like Echo Mini cannot decode 4:4:4 JPEG. The taglib embed path
    // routes through resizeArtwork(), so the chroma conversion has to happen
    // here — the transcode-time embed filter is bypassed.
    const sourceJpeg = generateYuvj444pJpeg(400, 400);
    expect(probeImage(sourceJpeg).pixFmt).toBe('yuvj444p');

    const resized = await resizeArtwork(sourceJpeg, 200);
    expect(probeImage(resized).pixFmt).toBe('yuvj420p');
  });
});

describe('buildArtworkScaleFilter', () => {
  test('includes format=yuvj420p so devices without 4:4:4 support can decode', () => {
    expect(buildArtworkScaleFilter(127)).toContain('format=yuvj420p');
  });

  test('uses the supplied maxDim in scale clauses', () => {
    const filter = buildArtworkScaleFilter(200);
    expect(filter).toContain("'min(200,iw)'");
    expect(filter).toContain("'min(200,ih)'");
  });

  test('preserves aspect ratio and forces even pixel dimensions', () => {
    const filter = buildArtworkScaleFilter(127);
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('force_divisible_by=2');
  });
});
