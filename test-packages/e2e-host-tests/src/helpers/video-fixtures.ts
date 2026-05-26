/**
 * E2E-side semantic catalogue of the static video fixture set.
 *
 * The fixture *files* are owned by `@podkit/test-fixtures` (see that
 * package's README). This module layers on the e2e-test perspective:
 * category enums, passthrough/transcode classification, content-type
 * tagging, and helpers for building temporary source directories.
 */

import { access, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getVideoFixturesDir } from '@podkit/test-fixtures';

// Re-export the lib path resolver so existing imports continue to work.
export { getVideoFixturesDir };

/**
 * Check whether the video fixture set has been generated.
 *
 * Returns a boolean rather than throwing so legacy `skipIfUnavailable` call
 * sites continue to compile. Tests should prefer
 * `import { ensureFixturesExist } from '@podkit/test-fixtures'` at module
 * load.
 *
 * @deprecated Migrate to `ensureFixturesExist('video')` from
 * `@podkit/test-fixtures`. Will be removed once the e2e per-test
 * `skipIfUnavailable` pattern is gone.
 */
export async function areVideoFixturesAvailable(): Promise<boolean> {
  try {
    await access(getVideoFixturesDir());
    await access(join(getVideoFixturesDir(), 'compatible-h264.mp4'));
    return true;
  } catch {
    return false;
  }
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

export interface TestVideo {
  path: string;
  filename: string;
  category: VideoCategory;
  contentType: 'movie' | 'tvshow' | 'video';
  /** True when the file already matches iPod specs and should be copied as-is. */
  passthrough: boolean;
  description: string;
}

/**
 * Video definitions for known fixture files.
 */
export const Videos = {
  // Compatible (passthrough)
  COMPATIBLE_H264: {
    filename: 'compatible-h264.mp4',
    category: VideoCategories.COMPATIBLE,
    contentType: 'video' as const,
    passthrough: true,
    description: '640x480 H.264 Main L3.1, AAC 128k — passthrough',
  },
  LOW_QUALITY: {
    filename: 'low-quality.mp4',
    category: VideoCategories.COMPATIBLE,
    contentType: 'video' as const,
    passthrough: true,
    description: '320x240 H.264 Baseline L1.3, AAC 96k — passthrough',
  },

  // Needs transcoding
  HIGH_RES_H264: {
    filename: 'high-res-h264.mkv',
    category: VideoCategories.TRANSCODE,
    contentType: 'video' as const,
    passthrough: false,
    description: '1920x1080 H.264 High L4.1 — needs resolution downscale + remux',
  },
  INCOMPATIBLE_VP9: {
    filename: 'incompatible-vp9.webm',
    category: VideoCategories.TRANSCODE,
    contentType: 'video' as const,
    passthrough: false,
    description: 'VP9 + Opus — needs full transcode',
  },

  // Metadata-rich
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

export function getVideoPath(video: (typeof Videos)[keyof typeof Videos]): string {
  return join(getVideoFixturesDir(), video.filename);
}

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

export function getAllVideos(): TestVideo[] {
  return Object.values(Videos).map((v) => getVideo(v));
}

export function getVideosByCategory(category: VideoCategory): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.category === category)
    .map((v) => getVideo(v));
}

export function getTranscodeVideos(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => !v.passthrough)
    .map((v) => getVideo(v));
}

export function getPassthroughVideos(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.passthrough)
    .map((v) => getVideo(v));
}

export function getMovies(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.contentType === 'movie')
    .map((v) => getVideo(v));
}

export function getTVShows(): TestVideo[] {
  return Object.values(Videos)
    .filter((v) => v.contentType === 'tvshow')
    .map((v) => getVideo(v));
}

/**
 * Create a temporary video source directory containing copies of the
 * selected fixtures.
 *
 * Caller must clean up via `cleanupVideoSourceDir` (or use `withVideoSourceDir`).
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
 * Create a video source directory organised by content type.
 * Movies go in /Movies, TV shows go in /TV Shows/{show name}/Season N/.
 */
export async function createOrganizedVideoSourceDir(): Promise<string> {
  const tempDir = join(tmpdir(), `podkit-video-organized-${Date.now()}`);

  const moviesDir = join(tempDir, 'Movies');
  const tvDir = join(tempDir, 'TV Shows', 'Test Show', 'Season 1');
  await mkdir(moviesDir, { recursive: true });
  await mkdir(tvDir, { recursive: true });

  const movie = getVideo(Videos.MOVIE_WITH_METADATA);
  await cp(movie.path, join(moviesDir, movie.filename));

  const tvShow = getVideo(Videos.TVSHOW_EPISODE);
  await cp(tvShow.path, join(tvDir, tvShow.filename));

  const compatible = getVideo(Videos.COMPATIBLE_H264);
  await cp(compatible.path, join(tempDir, compatible.filename));

  return tempDir;
}

export async function cleanupVideoSourceDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

/**
 * Run a test against a temporary unstructured video source directory.
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
 * Run a test against a temporary organised (Movies / TV Shows) source dir.
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
