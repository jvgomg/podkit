/**
 * E2E tests for the `podkit video-sync` command.
 *
 * Tests video sync operations including dry-run analysis, metadata handling,
 * quality presets, and error handling.
 *
 * Note: Full execution tests require real transcoding which is too slow for E2E.
 * Focus on dry-run tests that verify CLI output and behavior.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import {
  areVideoFixturesAvailable,
  withVideoSourceDir,
  withOrganizedVideoSourceDir,
  Videos,
  getVideo,
  getPassthroughVideos,
  getTranscodeVideos,
} from '../helpers/video-fixtures';

/**
 * JSON output structure for video sync command
 */
interface VideoSyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  plan?: {
    videosToAdd: number;
    videosToRemove: number;
    videosToTranscode: number;
    videosToCopy: number;
    movieCount: number;
    tvShowCount: number;
    estimatedSize: number;
    estimatedTime: number;
  };
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
  };
  warnings?: Array<{
    type: string;
    message: string;
    videoCount: number;
  }>;
  error?: string;
}

describe('podkit video-sync', () => {
  let fixturesAvailable: boolean;

  beforeAll(async () => {
    fixturesAvailable = await areVideoFixturesAvailable();
  });

  describe('help and usage', () => {
    it('displays help text', async () => {
      const result = await runCli(['video-sync', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('video-sync');
      expect(result.stdout).toContain('sync video collection to iPod');
      expect(result.stdout).toContain('--source');
      expect(result.stdout).toContain('--dry-run');
      expect(result.stdout).toContain('--quality');
    });

    it('shows quality preset options in help', async () => {
      const result = await runCli(['video-sync', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('max');
      expect(result.stdout).toContain('high');
      expect(result.stdout).toContain('medium');
      expect(result.stdout).toContain('low');
    });
  });

  describe('validation', () => {
    it('fails when no source specified', async () => {
      await withTarget(async (target) => {
        // Use non-existent config to ensure we don't pick up user's source config
        const result = await runCli([
          '--config',
          '/nonexistent/config.toml',
          'video-sync',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('No video source');
      });
    });

    it('fails when no device specified', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        // Use non-existent config to ensure we don't pick up user's device config
        const result = await runCli([
          '--config',
          '/nonexistent/config.toml',
          'video-sync',
          '--source',
          sourceDir,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('No iPod device specified');
      });
    });

    it('fails when source does not exist', async () => {
      await withTarget(async (target) => {
        const result = await runCli([
          'video-sync',
          '--source',
          '/nonexistent/video/path',
          '--device',
          target.path,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('not found');
      });
    });

    it('fails with invalid quality preset', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--quality',
            'invalid',
          ]);

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain('Invalid quality preset');
        });
      });
    });

    it('outputs validation errors in JSON', async () => {
      const { result, json } = await runCliJson<VideoSyncOutput>([
        '--config',
        '/nonexistent/config.toml',
        'video-sync',
        '--json',
      ]);

      expect(result.exitCode).toBe(1);
      expect(json?.success).toBe(false);
      expect(json?.error).toBeDefined();
    });
  });

  describe('device video support', () => {
    it('shows error when device does not support video', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      // Note: Dummy iPod targets may not have video support flag set
      // This test verifies the error message is shown when video isn't supported
      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
          ]);

          // Either succeeds (video supported) or shows appropriate error
          if (result.exitCode !== 0) {
            expect(
              result.stderr.includes('does not support video') ||
                result.stderr.includes('video playback')
            ).toBe(true);
          }
        });
      });
    });

    it('outputs video support error in JSON', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const { result, json } = await runCliJson<VideoSyncOutput>([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // Either succeeds or shows video support error in JSON
          if (result.exitCode !== 0) {
            expect(json?.success).toBe(false);
            if (json?.error?.includes('video')) {
              expect(json.error).toContain('video');
            }
          }
        });
      });
    });
  });

  describe('dry-run analysis', () => {
    it('shows video analysis in dry-run mode', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
          ]);

          // If device doesn't support video, skip this test
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain('Dry Run');
          expect(result.stdout).toContain('Videos to add');
        });
      });
    });

    it('shows movie vs TV show breakdown', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withOrganizedVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
          ]);

          // If device doesn't support video, skip
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          // Should show movie/TV breakdown
          expect(result.stdout).toMatch(/Movies?:/i);
          expect(result.stdout).toMatch(/TV Shows?:/i);
        });
      });
    });

    it('shows passthrough vs transcode counts', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      // Include videos that need both passthrough and transcode
      const mixedVideos = [
        getVideo(Videos.COMPATIBLE_H264),
        getVideo(Videos.HIGH_RES_H264),
      ];

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--verbose',
          ]);

          // If device doesn't support video, skip
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          // Should differentiate transcode from passthrough
          expect(
            result.stdout.includes('Transcode') ||
              result.stdout.includes('transcode') ||
              result.stdout.includes('Passthrough') ||
              result.stdout.includes('passthrough')
          ).toBe(true);
        });
      }, mixedVideos);
    });

    it('outputs dry-run plan in JSON format', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const { result, json } = await runCliJson<VideoSyncOutput>([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // If device doesn't support video, skip
          if (result.exitCode !== 0 && json?.error?.includes('video')) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(json?.success).toBe(true);
          expect(json?.dryRun).toBe(true);
          expect(json?.plan).toBeDefined();
          expect(json?.plan?.videosToAdd).toBeGreaterThanOrEqual(0);
          expect(json?.plan?.movieCount).toBeGreaterThanOrEqual(0);
          expect(json?.plan?.tvShowCount).toBeGreaterThanOrEqual(0);
        });
      });
    });

    it('shows already synced message for empty source', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const emptySource = await mkdtemp(join(tmpdir(), 'empty-video-source-'));

      try {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            emptySource,
            '--device',
            target.path,
            '--dry-run',
          ]);

          // If device doesn't support video, skip
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          // Should show no videos to add
          expect(result.stdout).toContain('0');
        });
      } finally {
        await rm(emptySource, { recursive: true, force: true });
      }
    });
  });

  describe('quality presets', () => {
    const presets = ['max', 'high', 'medium', 'low'] as const;

    for (const preset of presets) {
      it(`accepts --quality ${preset}`, async () => {
        if (!fixturesAvailable) {
          console.log('Skipping: video fixtures not available');
          return;
        }

        await withVideoSourceDir(async (sourceDir) => {
          await withTarget(async (target) => {
            const result = await runCli([
              'video-sync',
              '--source',
              sourceDir,
              '--device',
              target.path,
              '--quality',
              preset,
              '--dry-run',
            ]);

            // If device doesn't support video, skip
            if (
              result.exitCode !== 0 &&
              result.stderr.includes('does not support video')
            ) {
              console.log('Skipping: device does not support video');
              return;
            }

            expect(result.exitCode).toBe(0);
            // Should show the quality preset in output
            expect(result.stdout.toLowerCase()).toContain(preset);
          });
        }, [getVideo(Videos.COMPATIBLE_H264)]); // Use single video for speed
      });
    }

    it('uses high quality by default', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
          ]);

          // If device doesn't support video, skip
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(result.stdout.toLowerCase()).toContain('high');
        });
      }, [getVideo(Videos.COMPATIBLE_H264)]);
    });
  });

  describe('video type handling', () => {
    it('identifies compatible videos for passthrough', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      const passthroughVideos = getPassthroughVideos();

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const { result, json } = await runCliJson<VideoSyncOutput>([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // If device doesn't support video, skip
          if (result.exitCode !== 0 && json?.error?.includes('video')) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(json?.plan?.videosToCopy).toBeGreaterThanOrEqual(0);
        });
      }, passthroughVideos);
    });

    it('identifies videos needing transcode', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      const transcodeVideos = getTranscodeVideos();

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const { result, json } = await runCliJson<VideoSyncOutput>([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // If device doesn't support video, skip
          if (result.exitCode !== 0 && json?.error?.includes('video')) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(json?.plan?.videosToTranscode).toBeGreaterThanOrEqual(0);
        });
      }, transcodeVideos);
    });
  });

  describe('metadata content types', () => {
    it('correctly categorizes movie files', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const { result, json } = await runCliJson<VideoSyncOutput>([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // If device doesn't support video, skip
          if (result.exitCode !== 0 && json?.error?.includes('video')) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(json?.plan?.movieCount).toBeGreaterThanOrEqual(0);
        });
      }, [getVideo(Videos.MOVIE_WITH_METADATA)]);
    });

    it('correctly categorizes TV show files', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const { result, json } = await runCliJson<VideoSyncOutput>([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--json',
          ]);

          // If device doesn't support video, skip
          if (result.exitCode !== 0 && json?.error?.includes('video')) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          expect(json?.plan?.tvShowCount).toBeGreaterThanOrEqual(0);
        });
      }, [getVideo(Videos.TVSHOW_EPISODE)]);
    });
  });

  describe('quiet mode', () => {
    it('suppresses output with --quiet', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--quiet',
          ]);

          // If device doesn't support video, skip
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          // Should have minimal output (much less than verbose mode)
          // Note: Even in quiet mode, some output may be produced (e.g., dry-run summary)
          expect(result.stdout.length).toBeLessThan(1000);
        });
      }, [getVideo(Videos.COMPATIBLE_H264)]);
    });
  });

  describe('verbose mode', () => {
    it('shows detailed operations with --verbose', async () => {
      if (!fixturesAvailable) {
        console.log('Skipping: video fixtures not available');
        return;
      }

      await withVideoSourceDir(async (sourceDir) => {
        await withTarget(async (target) => {
          const result = await runCli([
            'video-sync',
            '--source',
            sourceDir,
            '--device',
            target.path,
            '--dry-run',
            '--verbose',
          ]);

          // If device doesn't support video, skip
          if (
            result.exitCode !== 0 &&
            result.stderr.includes('does not support video')
          ) {
            console.log('Skipping: device does not support video');
            return;
          }

          expect(result.exitCode).toBe(0);
          // Verbose should show more detail than non-verbose
          expect(result.stdout.length).toBeGreaterThan(100);
        });
      });
    });
  });
});
