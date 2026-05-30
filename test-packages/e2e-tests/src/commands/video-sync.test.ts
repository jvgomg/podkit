/**
 * E2E tests for video sync via `podkit sync -t video`.
 *
 * Tests video sync operations including dry-run, quality presets,
 * video type detection, and device compatibility.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureFixturesExist } from '@podkit/e2e-shared';
import type { SyncOutput } from 'podkit/types';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import {
  createVideoSourceDir,
  cleanupVideoSourceDir,
  Videos,
  getVideo,
  getPassthroughVideos,
  getTranscodeVideos,
  getMovies,
  getTVShows,
} from '../helpers/video-fixtures';

ensureFixturesExist('video');

// Video sync uses the shared SyncOutput type — its `plan.tracksToAdd` /
// `tracksToCopy` / `tracksToTranscode` fields are populated from the video
// presenter (commands/video-presenter.ts), and `plan.videoSummary` carries
// the movie/show split for category checks. (The "tracks" naming is shared
// with music sync, not "videos".)

/**
 * Create a temp config file with a video collection
 */
async function createVideoConfig(videoPath: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'podkit-video-sync-config-'));
  const configPath = join(tempDir, 'config.toml');

  const content = `version = 2

[video.main]
path = "${videoPath}"

[defaults]
video = "main"
`;

  await writeFile(configPath, content);
  return configPath;
}

// Track temp paths for cleanup
let tempConfigPaths: string[] = [];
let tempSourceDirs: string[] = [];

describe('podkit sync -t video', () => {
  afterEach(async () => {
    // Clean up temp config files
    for (const configPath of tempConfigPaths) {
      try {
        const dir = join(configPath, '..');
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
    tempConfigPaths = [];

    // Clean up temp source dirs
    for (const dir of tempSourceDirs) {
      await cleanupVideoSourceDir(dir);
    }
    tempSourceDirs = [];
  });

  describe('validation', () => {
    it('fails when no video collections configured', async () => {
      await withTarget(async (target) => {
        const result = await runCli([
          '--config',
          '/nonexistent/config.toml',
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('No collections configured');
      });
    });

    it('fails when video collection path does not exist', async () => {
      await withTarget(async (target) => {
        const configPath = await createVideoConfig('/nonexistent/videos');
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('not found');
      });
    });

    it('outputs validation errors in JSON', async () => {
      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        '/nonexistent/config.toml',
        'sync',
        '--type',
        'video',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.success).toBe(false);
      expect(json?.error).toBeDefined();
    });
  });

  describe('dry-run', () => {
    it('shows video sync plan without making changes', async () => {
      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([getVideo(Videos.COMPATIBLE_H264)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Dry Run');

        // Verify no changes were made
        const trackCount = await target.getTrackCount();
        expect(trackCount).toBe(0);
      });
    });

    it('outputs dry-run plan in JSON', async () => {
      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([getVideo(Videos.COMPATIBLE_H264)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json!.success).toBe(true);
        expect(json!.dryRun).toBe(true);
        expect(json!.plan).toBeDefined();
        // Single-video fixture → exactly 1 video planned.
        expect(json!.plan!.tracksToAdd).toBe(1);
      });
    });
  });

  describe('quality presets', () => {
    it('accepts --video-quality max', async () => {
      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([getVideo(Videos.COMPATIBLE_H264)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--video-quality',
          'max',
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
      });
    });

    it('accepts --video-quality low', async () => {
      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([getVideo(Videos.COMPATIBLE_H264)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--video-quality',
          'low',
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
      });
    });
  });

  describe('video type handling', () => {
    it('identifies compatible videos for passthrough', async () => {
      const passthroughVideos = getPassthroughVideos();
      // Videos catalogue is static (helpers/video-fixtures.ts) with 4
      // passthrough entries. ensureFixturesExist('video') at module load
      // validates the on-disk files; pinning the exact count here turns the
      // assert into a regression detector for the catalogue itself.
      expect(passthroughVideos.length).toBe(4);

      await withTarget(async (target) => {
        // The dummy target is an iPod Video 5G (MA147) which only handles
        // H.264 Baseline up to L1.3. LOW_QUALITY (320x240, Baseline L1.3) is
        // the one passthrough fixture that actually matches that ceiling.
        // COMPATIBLE_H264 (640x480, Main L3.1) is "compatible" for newer
        // iPods but the 5G needs to transcode it.
        const sourceDir = await createVideoSourceDir([getVideo(Videos.LOW_QUALITY)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json!.plan).toBeDefined();
        // iPod-Video-5G-compatible fixture → planner picks the copy path.
        expect(json!.plan!.tracksToCopy).toBe(1);
        expect(json!.plan!.tracksToTranscode).toBe(0);
      });
    });

    it('identifies videos needing transcode', async () => {
      const transcodeVideos = getTranscodeVideos();
      expect(transcodeVideos.length).toBe(2);

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([transcodeVideos[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json!.plan).toBeDefined();
        // Incompatible fixture → planner picks the transcode path, not copy.
        expect(json!.plan!.tracksToTranscode).toBe(1);
        expect(json!.plan!.tracksToCopy).toBe(0);
      });
    });
  });

  describe('content type categorization', () => {
    it('categorizes movie files', async () => {
      const movies = getMovies();
      expect(movies.length).toBe(1);

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([movies[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json!.plan).toBeDefined();
        // Movie fixture → planner categorises as movie, not TV show.
        expect(json!.plan!.videoSummary?.movieCount).toBe(1);
        expect(json!.plan!.videoSummary?.showCount).toBe(0);
      });
    });

    it('categorizes TV show files', async () => {
      const tvShows = getTVShows();
      expect(tvShows.length).toBe(1);

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([tvShows[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json!.plan).toBeDefined();
        // TV-show fixture → planner categorises as TV show, not movie.
        expect(json!.plan!.videoSummary?.showCount).toBe(1);
        expect(json!.plan!.videoSummary?.movieCount).toBe(0);
        expect(json!.plan!.videoSummary?.episodeCount).toBe(1);
      });
    });
  });

  describe('quiet mode', () => {
    it('suppresses output with --quiet', async () => {
      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([getVideo(Videos.COMPATIBLE_H264)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--quiet',
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        // Should have minimal output
        expect(result.stdout.length).toBeLessThan(100);
      });
    });
  });

  describe('verbose mode', () => {
    it('shows detailed output with --verbose', async () => {
      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([getVideo(Videos.COMPATIBLE_H264)]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const result = await runCli([
          '--verbose',
          '--config',
          configPath,
          'sync',
          '--type',
          'video',
          '--device',
          target.path,
          '--dry-run',
        ]);

        expect(result.exitCode).toBe(0);
        // Verbose should produce more output
        expect(result.stdout.length).toBeGreaterThan(0);
      });
    });
  });
});
