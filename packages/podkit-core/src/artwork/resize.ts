/**
 * Artwork resize using FFmpeg
 *
 * Resizes image buffers via FFmpeg for cases where artwork embedding is
 * post-processed (e.g., OGG/Opus files where FFmpeg can't embed artwork
 * during transcode). Uses the same downscale-only, aspect-ratio-preserving
 * logic as the transcode artwork filter.
 *
 * @module
 */

import { spawn } from 'node:child_process';

/**
 * Build an FFmpeg `-vf` filter string for artwork scaling.
 *
 * Downscales to fit within `maxDim`×`maxDim`, preserves aspect ratio, never
 * upscales, and forces even pixel dimensions for codec compatibility. Forces
 * `yuvj420p` (4:2:0) chroma so output is decodable on devices that don't
 * support 4:4:4 (e.g. Echo Mini).
 *
 * Shared by the buffer-based {@link resizeArtwork} (taglib embed path) and the
 * transcode-time embed filter in `transcode/ffmpeg.ts`. Keeping one definition
 * here avoids the kind of silent drift where one path forces yuvj420p and the
 * other doesn't — exactly the bug that surfaced when the embed and post-resize
 * paths went out of sync.
 */
export function buildArtworkScaleFilter(maxDim: number): string {
  return `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuvj420p`;
}

/**
 * Resize an image buffer to fit within maxDim×maxDim using FFmpeg.
 *
 * - Preserves aspect ratio (never distorts)
 * - Never upscales (images smaller than maxDim pass through)
 * - Forces even pixel dimensions for codec compatibility
 * - Forces yuvj420p (4:2:0) chroma — see {@link buildArtworkScaleFilter}
 * - Outputs JPEG regardless of input format
 *
 * @param imageData - Source image buffer (JPEG, PNG, etc.)
 * @param maxDim - Maximum width/height in pixels
 * @param ffmpegPath - Override FFmpeg binary path
 * @returns Resized JPEG image buffer
 */
export async function resizeArtwork(
  imageData: Buffer,
  maxDim: number,
  ffmpegPath = 'ffmpeg'
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      [
        '-i',
        'pipe:0',
        '-vf',
        buildArtworkScaleFilter(maxDim),
        '-f',
        'image2',
        '-c:v',
        'mjpeg',
        '-q:v',
        '2',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const chunks: Buffer[] = [];
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg artwork resize failed (exit ${code}): ${stderr.slice(-200)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    proc.stdin.write(imageData);
    proc.stdin.end();
  });
}
