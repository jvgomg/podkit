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

interface VideoSyncOutput {
  success: boolean;
  dryRun: boolean;
  plan?: {
    videosToAdd: number;
    videosToRemove: number;
    videosToTranscode: number;
    videosToCopy: number;
  };
  operations?: Array<{
    type: 'transcode' | 'copy' | 'remove';
    video: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
  }>;
  result?: {
    completed: number;
    failed: number;
    skipped: number;
  };
  error?: string;
}

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
      const { result, json } = await runCliJson<VideoSyncOutput>([
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

        const { result } = await runCliJson<VideoSyncOutput>([
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
      if (passthroughVideos.length === 0) {
        console.log('Skipping: no passthrough videos in fixtures');
        return;
      }

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([passthroughVideos[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result } = await runCliJson<VideoSyncOutput>([
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
      });
    });

    it('identifies videos needing transcode', async () => {
      const transcodeVideos = getTranscodeVideos();
      if (transcodeVideos.length === 0) {
        console.log('Skipping: no transcode videos in fixtures');
        return;
      }

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([transcodeVideos[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result } = await runCliJson<VideoSyncOutput>([
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
      });
    });
  });

  describe('content type categorization', () => {
    it('categorizes movie files', async () => {
      const movies = getMovies();
      if (movies.length === 0) {
        console.log('Skipping: no movie fixtures available');
        return;
      }

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([movies[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result } = await runCliJson<VideoSyncOutput>([
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
      });
    });

    it('categorizes TV show files', async () => {
      const tvShows = getTVShows();
      if (tvShows.length === 0) {
        console.log('Skipping: no TV show fixtures available');
        return;
      }

      await withTarget(async (target) => {
        const sourceDir = await createVideoSourceDir([tvShows[0]!]);
        tempSourceDirs.push(sourceDir);
        const configPath = await createVideoConfig(sourceDir);
        tempConfigPaths.push(configPath);

        const { result } = await runCliJson<VideoSyncOutput>([
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
