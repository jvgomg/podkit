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
 * Resize an image buffer to fit within maxDim×maxDim using FFmpeg.
 *
 * - Preserves aspect ratio (never distorts)
 * - Never upscales (images smaller than maxDim pass through)
 * - Forces even pixel dimensions for codec compatibility
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
        `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
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
