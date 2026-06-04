/**
 * Tests for artwork resize utility
 */

import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtworkScaleFilter, resizeArtwork } from './resize.js';

/** Read pix_fmt of the first video stream in a JPEG buffer via ffprobe. */
function probePixFmt(data: Buffer): string {
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
        'stream=pix_fmt',
        '-of',
        'csv=p=0',
        tmpfile,
      ],
      { encoding: 'utf-8' }
    );
    return out.trim();
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

  test('forces yuvj420p chroma even when source is yuvj444p', async () => {
    // Devices like Echo Mini cannot decode 4:4:4 JPEG. The taglib embed path
    // routes through resizeArtwork(), so the chroma conversion has to happen
    // here — the transcode-time embed filter is bypassed.
    const sourceJpeg = generateYuvj444pJpeg(400, 400);
    expect(probePixFmt(sourceJpeg)).toBe('yuvj444p');

    const resized = await resizeArtwork(sourceJpeg, 200);
    expect(probePixFmt(resized)).toBe('yuvj420p');
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
