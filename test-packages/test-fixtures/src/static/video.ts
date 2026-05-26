/**
 * Generator for the video fixture set.
 *
 * Six short (1-2s) synthetic videos that cover the decision matrix podkit's
 * video sync pipeline has to handle: pure passthrough, transcode-required,
 * unsupported codec, and metadata-rich (movie + TV show).
 *
 * | File                          | Resolution | Video                | Audio    | Purpose                          |
 * | ----------------------------- | ---------- | -------------------- | -------- | -------------------------------- |
 * | compatible-h264.mp4           | 640x480    | H.264 Main L3.1 500k | AAC 128k | Passthrough (no transcode)       |
 * | low-quality.mp4               | 320x240    | H.264 Base L1.3 300k | AAC 96k  | Compatible at low quality        |
 * | high-res-h264.mkv             | 1920x1080  | H.264 High L4.1 2M   | AAC 192k | Resolution downscale + remux     |
 * | incompatible-vp9.webm         | 640x480    | VP9 500k             | Opus 128k| Unsupported codec handling       |
 * | movie-with-metadata.mp4       | 640x480    | H.264 Main L3.1 500k | AAC 128k | Movie metadata parsing           |
 * | tvshow-episode.mp4            | 640x480    | H.264 Main L3.1 500k | AAC 128k | TV show metadata parsing         |
 *
 * Each video uses a different ffmpeg test pattern (`testsrc`, `testsrc2`,
 * `smptebars`, `pal75bars`) for easy visual identification when manually
 * inspecting the fixture set, and a distinct audio tone frequency.
 *
 * @module
 */

import { join } from 'node:path';
import { requireEncoder } from '../encoder-guard.js';
import { ensureDir, metadataArgs, runFfmpeg, writeGeneratedSentinel } from './shared.js';

/**
 * Encoders the video set depends on. Surfaced separately for the build-time
 * `check-ffmpeg.ts` companion script.
 */
export const REQUIRED_ENCODERS = ['libx264', 'libvpx-vp9', 'aac', 'libopus'] as const;

/**
 * Generate the full video set into the given directory.
 */
export async function generateVideo(outputDir: string): Promise<void> {
  for (const encoder of REQUIRED_ENCODERS) {
    requireEncoder(encoder);
  }
  await ensureDir(outputDir);

  await Promise.all([
    generateCompatibleH264(outputDir),
    generateLowQuality(outputDir),
    generateHighResH264(outputDir),
    generateIncompatibleVp9(outputDir),
    generateMovieWithMetadata(outputDir),
    generateTvShowEpisode(outputDir),
  ]);

  await writeGeneratedSentinel(outputDir, 'video');
}

/**
 * 640x480 H.264 Main profile + AAC. Matches iPod Classic spec exactly so the
 * sync pipeline can copy it through without re-encoding.
 */
async function generateCompatibleH264(dir: string): Promise<void> {
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=2:size=640x480:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-level:v',
    '3.1',
    '-b:v',
    '500k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    ...metadataArgs({
      title: 'Compatible Test Video',
      artist: 'Podkit Test Generator',
      date: '2026',
    }),
    join(dir, 'compatible-h264.mp4'),
  ]);
}

/**
 * 320x240 H.264 Baseline at 300 kbps. Below typical iPod resolution but
 * still a compatible container/codec — exercises low-quality passthrough.
 */
async function generateLowQuality(dir: string): Promise<void> {
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=2:size=320x240:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=523.25:duration=2',
    '-c:v',
    'libx264',
    '-profile:v',
    'baseline',
    '-level:v',
    '1.3',
    '-b:v',
    '300k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    ...metadataArgs({
      title: 'Low Quality Test',
      artist: 'Podkit Test Generator',
      date: '2026',
    }),
    join(dir, 'low-quality.mp4'),
  ]);
}

/**
 * 1920x1080 H.264 High profile in MKV. Tests the downscale-and-remux path:
 * sync must resize to ≤640x480 and rewrap into MP4.
 */
async function generateHighResH264(dir: string): Promise<void> {
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=duration=2:size=1920x1080:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=659.25:duration=2',
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-level:v',
    '4.1',
    '-b:v',
    '2000k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    ...metadataArgs({
      title: 'High Resolution Test',
      artist: 'Podkit Test Generator',
      date: '2026',
    }),
    join(dir, 'high-res-h264.mkv'),
  ]);
}

/**
 * VP9 in WebM. Codec is wholly unsupported by iPod Classic; sync must warn
 * or skip.
 */
async function generateIncompatibleVp9(dir: string): Promise<void> {
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=2:size=640x480:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=783.99:duration=2',
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '500k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'libopus',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    ...metadataArgs({
      title: 'VP9 Incompatible Test',
      artist: 'Podkit Test Generator',
      date: '2026',
    }),
    join(dir, 'incompatible-vp9.webm'),
  ]);
}

/**
 * Compatible MP4 carrying rich movie metadata (title, year, description,
 * synopsis, genre). Used by metadata-parsing tests.
 */
async function generateMovieWithMetadata(dir: string): Promise<void> {
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'smptebars=duration=2:size=640x480:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=392:duration=2',
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-level:v',
    '3.1',
    '-b:v',
    '500k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    ...metadataArgs({
      title: 'Test Movie Title',
      artist: 'Test Director',
      album_artist: 'Test Studio',
      date: '2024',
      description: 'A test movie with embedded metadata for validation purposes.',
      synopsis:
        "Extended synopsis: This is a synthetic test video created for testing podkit's video metadata parsing capabilities.",
      genre: 'Test',
    }),
    join(dir, 'movie-with-metadata.mp4'),
  ]);
}

/**
 * Compatible MP4 carrying TV-show metadata (show, season, episode). Used by
 * tests that distinguish series episodes from movies.
 */
async function generateTvShowEpisode(dir: string): Promise<void> {
  await runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    'pal75bars=duration=2:size=640x480:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=329.63:duration=2',
    '-c:v',
    'libx264',
    '-profile:v',
    'main',
    '-level:v',
    '3.1',
    '-b:v',
    '500k',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    ...metadataArgs({
      title: 'Pilot Episode',
      show: 'Test Show',
      season_number: 1,
      episode_id: 'S01E01',
      episode_sort: 1,
      network: 'Test Network',
      description: 'The first episode of our test TV series.',
      date: '2024',
      genre: 'Drama',
    }),
    join(dir, 'tvshow-episode.mp4'),
  ]);
}
