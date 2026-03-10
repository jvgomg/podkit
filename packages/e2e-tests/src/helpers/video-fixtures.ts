/**
 * Test video fixtures for E2E tests.
 *
 * Provides paths to pre-built video test files with various formats and metadata.
 * See test/fixtures/video/README.md for details on the test files.
 */

import { resolve, join } from 'node:path';
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

/**
 * Base path to the video fixtures directory.
 */
export function getVideoFixturesDir(): string {
  return resolve(__dirname, '../../../../test/fixtures/video');
}

/**
 * Video file categories based on compatibility with iPod.
 */
export const VideoCategories = {
  /** iPod-compatible: can be copied as-is (passthrough) */
  COMPATIBLE: 'compatible',
  /** Needs transcoding: wrong container/codec/resolution */
  TRANSCODE: 'transcode',
  /** Has rich metadata: movies and TV shows */
  METADATA: 'metadata',
} as const;

export type VideoCategory = (typeof VideoCategories)[keyof typeof VideoCategories];

/**
 * Information about a test video file.
 */
export interface TestVideo {
  /** Absolute path to the file */
  path: string;
  /** Filename without directory */
  filename: string;
  /** Category for test purposes */
  category: VideoCategory;
  /** Content type: movie or tvshow */
  contentType: 'movie' | 'tvshow' | 'video';
  /** Whether this video should be passed through (no transcode) */
  passthrough: boolean;
  /** Brief description for test output */
  description: string;
}

/**
 * Video definitions for known fixture files.
 */
export const Videos = {
  // Compatible videos (passthrough)
  COMPATIBLE_H264: {
    filename: 'compatible-h264.mp4',
    category: VideoCategories.COMPATIBLE,
    contentType: 'video' as const,
    passthrough: true,
    description: '640x480 H.264 Main L3.1, AAC 128k - passthrough',
  },
  LOW_QUALITY: {
    filename: 'low-quality.mp4',
    category: VideoCategories.COMPATIBLE,
    contentType: 'video' as const,
    passthrough: true,
    description: '320x240 H.264 Baseline L1.3, AAC 96k - passthrough',
  },

  // Needs transcoding
  HIGH_RES_H264: {
    filename: 'high-res-h264.mkv',
    category: VideoCategories.TRANSCODE,
    contentType: 'video' as const,
    passthrough: false,
    description: '1920x1080 H.264 High L4.1 - needs resolution downscale + remux',
  },
  INCOMPATIBLE_VP9: {
    filename: 'incompatible-vp9.webm',
    category: VideoCategories.TRANSCODE,
    contentType: 'video' as const,
    passthrough: false,
    description: 'VP9 + Opus - needs full transcode',
  },

  // Videos with metadata
  MOVIE_WITH_METADATA: {
    filename: 'movie-with-metadata.mp4',
    category: VideoCategories.METADATA,
    contentType: 'movie' as const,
    passthrough: true,
    description: 'Movie with embedded metadata (title, director, etc.)',
  },
  TVSHOW_EPISODE: {
    filename: 'tvshow-episode.mp4',
    category: VideoCategories.METADATA,
    contentType: 'tvshow' as const,
    passthrough: true,
    description: 'TV show S01E01 with embedded metadata',
  },
} as const;

/**
 * Get the full path to a specific video fixture.
 */
export function getVideoPath(video: (typeof Videos)[keyof typeof Videos]): string {
  return join(getVideoFixturesDir(), video.filename);
}

/**
 * Get information about a specific video.
 */
export function getVideo(video: (typeof Videos)[keyof typeof Videos]): TestVideo {
  return {
    path: getVideoPath(video),
    filename: video.filename,
    category: video.category,
    contentType: video.contentType,
    passthrough: video.passthrough,
    description: video.description,
  };
}

/**
 * Get all test videos.
 */
export function getAllVideos(): TestVideo[] {
  return Object.values(Videos).map((v) => getVideo(v));
}

/**
 * Get videos by category.
 */
export function getVideosByCategory(category: VideoCategory): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.category === category)
    .map((v) => getVideo(v));
}

/**
 * Get videos that need transcoding.
 */
export function getTranscodeVideos(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => !v.passthrough)
    .map((v) => getVideo(v));
}

/**
 * Get videos that can be passed through (no transcode needed).
 */
export function getPassthroughVideos(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.passthrough)
    .map((v) => getVideo(v));
}

/**
 * Get movies (content type = movie).
 */
export function getMovies(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.contentType === 'movie')
    .map((v) => getVideo(v));
}

/**
 * Get TV shows (content type = tvshow).
 */
export function getTVShows(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.contentType === 'tvshow')
    .map((v) => getVideo(v));
}

/**
 * Check if video fixtures are available.
 */
export async function areVideoFixturesAvailable(): Promise<boolean> {
  try {
    const fixturesDir = getVideoFixturesDir();
    await access(fixturesDir);

    // Check that at least one video exists
    const compatible = getVideoPath(Videos.COMPATIBLE_H264);
    await access(compatible);

    return true;
  } catch {
    return false;
  }
}

/**
 * Create a temporary video source directory with selected fixtures.
 *
 * @param videos - Videos to include (defaults to all)
 * @returns Path to the temporary directory (caller must clean up)
 *
 * @example
 * ```typescript
 * const sourceDir = await createVideoSourceDir();
 * try {
 *   const configPath = await createTempConfig(sourceDir); // video collection
 *   const result = await runCli(['--config', configPath, 'sync', 'video', ...]);
 * } finally {
 *   await cleanupVideoSourceDir(sourceDir);
 * }
 * ```
 */
export async function createVideoSourceDir(videos?: TestVideo[]): Promise<string> {
  const videosToInclude = videos ?? getAllVideos();
  const tempDir = join(tmpdir(), `podkit-video-e2e-${Date.now()}`);

  await mkdir(tempDir, { recursive: true });

  for (const video of videosToInclude) {
    await cp(video.path, join(tempDir, video.filename));
  }

  return tempDir;
}

/**
 * Create a video source directory organized by content type.
 * Movies go in /Movies, TV shows go in /TV Shows/{show name}/
 *
 * @returns Path to the temporary directory (caller must clean up)
 */
export async function createOrganizedVideoSourceDir(): Promise<string> {
  const tempDir = join(tmpdir(), `podkit-video-organized-${Date.now()}`);

  // Create directory structure
  const moviesDir = join(tempDir, 'Movies');
  const tvDir = join(tempDir, 'TV Shows', 'Test Show', 'Season 1');
  await mkdir(moviesDir, { recursive: true });
  await mkdir(tvDir, { recursive: true });

  // Copy movies
  const movie = getVideo(Videos.MOVIE_WITH_METADATA);
  await cp(movie.path, join(moviesDir, movie.filename));

  // Copy TV shows
  const tvShow = getVideo(Videos.TVSHOW_EPISODE);
  await cp(tvShow.path, join(tvDir, tvShow.filename));

  // Copy other videos to root (will be classified as generic video)
  const compatible = getVideo(Videos.COMPATIBLE_H264);
  await cp(compatible.path, join(tempDir, compatible.filename));

  return tempDir;
}

/**
 * Clean up a temporary video source directory.
 */
export async function cleanupVideoSourceDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Helper to run a test with a video source directory.
 *
 * @param videos - Videos to include (defaults to all)
 * @param fn - Test function to run with the source directory path
 *
 * @example
 * ```typescript
 * await withVideoSourceDir(async (sourceDir) => {
 *   const configPath = await createTempConfig(sourceDir); // video collection
 *   const result = await runCli(['--config', configPath, 'sync', 'video', ...]);
 *   expect(result.exitCode).toBe(0);
 * });
 * ```
 */
export async function withVideoSourceDir<T>(
  fn: (sourceDir: string) => Promise<T>,
  videos?: TestVideo[]
): Promise<T> {
  const sourceDir = await createVideoSourceDir(videos);
  try {
    return await fn(sourceDir);
  } finally {
    await cleanupVideoSourceDir(sourceDir);
  }
}

/**
 * Helper to run a test with an organized video source directory.
 */
export async function withOrganizedVideoSourceDir<T>(
  fn: (sourceDir: string) => Promise<T>
): Promise<T> {
  const sourceDir = await createOrganizedVideoSourceDir();
  try {
    return await fn(sourceDir);
  } finally {
    await cleanupVideoSourceDir(sourceDir);
  }
}
