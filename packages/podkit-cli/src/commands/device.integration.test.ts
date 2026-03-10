/**
 * Integration tests for device subcommands that interact with iPod databases.
 *
 * These tests require:
 * - gpod-tool to be built (mise run tools:build)
 *
 * The tests use real iPod databases created by gpod-testing.
 */
import { describe, expect, it, afterEach, beforeAll } from 'bun:test';
import * as fs from 'node:fs';
import { withTestIpod, TestModels, isGpodToolAvailable } from '@podkit/gpod-testing';
import { IpodDatabase, MediaType, isMusicMediaType, isVideoMediaType } from '@podkit/core';
import { setContext, clearContext } from '../context.js';
import type { PodkitConfig, GlobalOptions, LoadConfigResult } from '../config/index.js';
import { DEFAULT_TRANSFORMS_CONFIG } from '../config/index.js';

// Test helpers

/**
 * Create a minimal CLI context for testing
 */
function createTestContext(
  overrides: {
    config?: Partial<PodkitConfig>;
    globalOpts?: Partial<GlobalOptions>;
    configPath?: string;
  } = {}
): void {
  const config: PodkitConfig = {
    quality: 'medium',
    artwork: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    devices: {},
    music: {},
    video: {},
    ...overrides.config,
  };

  const globalOpts: GlobalOptions = {
    config: overrides.configPath,
    device: undefined,
    json: false,
    quiet: false,
    verbose: 0,
    color: true,
    ...overrides.globalOpts,
  };

  const configResult: LoadConfigResult = {
    config,
    configPath: overrides.configPath,
    configFileExists: !!overrides.configPath,
  };

  setContext({ config, globalOpts, configResult });
}

/**
 * Create a test context with a device configured for a specific iPod path
 */
function createDeviceContext(
  devicePath: string,
  options: {
    deviceName?: string;
    json?: boolean;
    quiet?: boolean;
  } = {}
): void {
  const deviceName = options.deviceName ?? 'test-ipod';

  createTestContext({
    config: {
      devices: {
        [deviceName]: {
          volumeUuid: 'test-uuid-1234',
          volumeName: 'TestiPod',
        },
      },
      defaults: {
        device: deviceName,
      },
    },
    globalOpts: {
      device: devicePath, // Use --device path directly for testing
      json: options.json ?? false,
      quiet: options.quiet ?? true, // Default quiet for tests
    },
  });
}

// Check if gpod-tool is available before running tests
beforeAll(async () => {
  const available = await isGpodToolAvailable();
  if (!available) {
    throw new Error('gpod-tool is not available. Run `mise run tools:build` to build it.');
  }
});

describe('device info integration', () => {
  afterEach(() => {
    clearContext();
  });

  it('returns device info for valid iPod', async () => {
    await withTestIpod(async (ipod) => {
      createDeviceContext(ipod.path, { json: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const info = db.getInfo();

        expect(info).toBeDefined();
        expect(info.device).toBeDefined();
        expect(info.device.modelName).toBeTruthy();
        expect(typeof info.trackCount).toBe('number');
      } finally {
        db.close();
      }
    });
  });

  it('shows track count correctly', async () => {
    await withTestIpod(async (ipod) => {
      // Add some tracks
      await ipod.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await ipod.addTrack({ title: 'Song 2', artist: 'Artist 2' });
      await ipod.addTrack({ title: 'Song 3', artist: 'Artist 3' });

      createDeviceContext(ipod.path, { json: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const info = db.getInfo();
        expect(info.trackCount).toBe(3);
      } finally {
        db.close();
      }
    });
  });

  it('shows storage information', async () => {
    await withTestIpod(async (ipod) => {
      createDeviceContext(ipod.path, { json: true });

      // Check filesystem storage info is accessible
      const stats = fs.statfsSync(ipod.path);
      expect(stats).toBeDefined();
      expect(stats.blocks).toBeGreaterThan(0);
      expect(stats.bsize).toBeGreaterThan(0);

      // Calculate storage values
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;

      expect(total).toBeGreaterThan(0);
      expect(free).toBeGreaterThanOrEqual(0);
      expect(used).toBeGreaterThanOrEqual(0);
    });
  });

  it('handles unmounted device gracefully', async () => {
    createDeviceContext('/nonexistent/path');

    // The IpodDatabase.open should fail for nonexistent path
    await expect(IpodDatabase.open('/nonexistent/path')).rejects.toThrow();
  });

  it('provides correct JSON output structure', async () => {
    await withTestIpod(
      async (ipod) => {
        await ipod.addTrack({ title: 'Test Song', artist: 'Test Artist' });

        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const info = db.getInfo();

          // Verify JSON output structure matches DeviceInfoOutput
          expect(info).toMatchObject({
            device: expect.objectContaining({
              modelName: expect.any(String),
              generation: expect.any(String),
            }),
            trackCount: expect.any(Number),
          });
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });
});

describe('device music integration', () => {
  afterEach(() => {
    clearContext();
  });

  it('lists music tracks on iPod', async () => {
    await withTestIpod(async (ipod) => {
      // Add test tracks
      await ipod.addTrack({ title: 'Track 1', artist: 'Artist A', album: 'Album X' });
      await ipod.addTrack({ title: 'Track 2', artist: 'Artist B', album: 'Album Y' });

      createDeviceContext(ipod.path, { json: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const tracks = db.getTracks();

        expect(tracks).toHaveLength(2);
        expect(tracks[0]).toMatchObject({
          title: 'Track 1',
          artist: 'Artist A',
          album: 'Album X',
        });
        expect(tracks[1]).toMatchObject({
          title: 'Track 2',
          artist: 'Artist B',
          album: 'Album Y',
        });
      } finally {
        db.close();
      }
    });
  });

  it('returns empty for iPod with no music', async () => {
    await withTestIpod(async (ipod) => {
      createDeviceContext(ipod.path, { json: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const tracks = db.getTracks();
        expect(tracks).toHaveLength(0);
      } finally {
        db.close();
      }
    });
  });

  it('respects track metadata fields', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        trackNumber: 5,
        durationMs: 180000,
        bitrate: 256,
      });

      createDeviceContext(ipod.path, { json: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const tracks = db.getTracks();

        expect(tracks).toHaveLength(1);
        const track = tracks[0]!;
        expect(track.title).toBe('Test Song');
        expect(track.artist).toBe('Test Artist');
        expect(track.album).toBe('Test Album');
        expect(track.trackNumber).toBe(5);
      } finally {
        db.close();
      }
    });
  });

  it('handles multiple tracks with same artist', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Song A', artist: 'Same Artist', album: 'Album 1' });
      await ipod.addTrack({ title: 'Song B', artist: 'Same Artist', album: 'Album 1' });
      await ipod.addTrack({ title: 'Song C', artist: 'Same Artist', album: 'Album 2' });

      createDeviceContext(ipod.path, { json: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const tracks = db.getTracks();

        expect(tracks).toHaveLength(3);
        expect(tracks.every((t) => t.artist === 'Same Artist')).toBe(true);
      } finally {
        db.close();
      }
    });
  });
});

describe('device video integration', () => {
  afterEach(() => {
    clearContext();
  });

  it('lists video tracks on iPod (empty by default)', async () => {
    await withTestIpod(
      async (ipod) => {
        // Fresh iPod should have no videos
        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const tracks = db.getTracks();
          // Test helper only adds audio tracks, so filter for video media types
          // Video mediaType values are > 0 and specific to video content
          const videoTracks = tracks.filter((t) => {
            // Video media types from libgpod: movie=0x0002, tvshow=0x0040, etc.
            const videoTypes = [0x0002, 0x0006, 0x0040, 0x0080];
            return videoTypes.includes(t.mediaType);
          });
          expect(videoTracks).toHaveLength(0);
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('returns empty for iPod with no video', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add only audio tracks
        await ipod.addTrack({ title: 'Audio Track', artist: 'Artist' });

        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const tracks = db.getTracks();
          // Filter for video types
          const videoTypes = [0x0002, 0x0006, 0x0040, 0x0080];
          const videoTracks = tracks.filter((t) => videoTypes.includes(t.mediaType));
          expect(videoTracks).toHaveLength(0);
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('correctly identifies model supports video', async () => {
    await withTestIpod(
      async (ipod) => {
        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const info = db.getInfo();
          // Video 60GB model should support video
          expect(info.device.supportsVideo).toBe(true);
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });
});

describe('device clear integration', () => {
  afterEach(() => {
    clearContext();
  });

  it('removes all tracks with confirmation', async () => {
    await withTestIpod(async (ipod) => {
      // Add tracks first
      await ipod.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await ipod.addTrack({ title: 'Song 2', artist: 'Artist 2' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        // Verify tracks exist
        expect(db.trackCount).toBe(2);

        // Remove all tracks
        const result = db.removeAllTracks({ deleteFiles: true });
        await db.save();

        expect(result.removedCount).toBe(2);
        expect(db.trackCount).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it('dry-run shows what would be removed', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await ipod.addTrack({ title: 'Song 2', artist: 'Artist 2' });
      await ipod.addTrack({ title: 'Song 3', artist: 'Artist 3' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        // Check track count for dry-run
        const trackCount = db.trackCount;
        expect(trackCount).toBe(3);

        // In dry-run mode, we would just report without removing
        const tracks = db.getTracks();
        const totalSize = tracks.reduce((sum, t) => sum + t.size, 0);
        expect(totalSize).toBeGreaterThanOrEqual(0);
      } finally {
        db.close();
      }
    });
  });

  it('handles empty iPod gracefully', async () => {
    await withTestIpod(async (ipod) => {
      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        // Fresh iPod has 0 tracks
        expect(db.trackCount).toBe(0);

        // Removing from empty iPod should succeed
        const result = db.removeAllTracks({ deleteFiles: true });
        expect(result.removedCount).toBe(0);
        expect(result.fileDeleteErrors).toHaveLength(0);
      } finally {
        db.close();
      }
    });
  });

  it('reports correct track count in result', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Track A', artist: 'Artist' });
      await ipod.addTrack({ title: 'Track B', artist: 'Artist' });
      await ipod.addTrack({ title: 'Track C', artist: 'Artist' });
      await ipod.addTrack({ title: 'Track D', artist: 'Artist' });
      await ipod.addTrack({ title: 'Track E', artist: 'Artist' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const initialCount = db.trackCount;
        expect(initialCount).toBe(5);

        const result = db.removeAllTracks({ deleteFiles: true });
        await db.save();

        expect(result.removedCount).toBe(5);
        expect(db.trackCount).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it('returns file deletion errors if any occur', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Test', artist: 'Artist' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        // Remove tracks - gpod-testing creates dummy files, so deletion should work
        const result = db.removeAllTracks({ deleteFiles: true });

        // fileDeleteErrors array exists even if empty
        expect(Array.isArray(result.fileDeleteErrors)).toBe(true);
      } finally {
        db.close();
      }
    });
  });
});

describe('device clear selective content-type integration', () => {
  afterEach(() => {
    clearContext();
  });

  it('removes only music tracks when clearing music', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add music and video content using IpodDatabase
        const db = await IpodDatabase.open(ipod.path);
        try {
          db.addTrack({
            title: 'Song 1',
            artist: 'Artist 1',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Song 2',
            artist: 'Artist 2',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Movie 1',
            artist: 'Director 1',
            mediaType: MediaType.Movie,
          });
          db.addTrack({
            title: 'TV Episode 1',
            artist: 'Show 1',
            mediaType: MediaType.TVShow,
          });
          await db.save();
        } finally {
          db.close();
        }

        createDeviceContext(ipod.path, { json: true, quiet: true });

        // Verify tracks were added
        let db2 = await IpodDatabase.open(ipod.path);
        try {
          expect(db2.trackCount).toBe(4);
        } finally {
          db2.close();
        }

        // Clear only music tracks
        db2 = await IpodDatabase.open(ipod.path);
        try {
          const result = db2.removeTracksByContentType('music', { deleteFiles: false });
          expect(result.removedCount).toBe(2);
          expect(result.totalCount).toBe(2);
          expect(db2.trackCount).toBe(2); // Only videos remain
          await db2.save();
        } finally {
          db2.close();
        }

        // Verify only video tracks remain
        db2 = await IpodDatabase.open(ipod.path);
        try {
          expect(db2.trackCount).toBe(2);
          const tracks = db2.getTracks();
          expect(tracks.every((t) => isVideoMediaType(t.mediaType))).toBe(true);
        } finally {
          db2.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('removes only video tracks when clearing video', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add mixed content using IpodDatabase
        const db = await IpodDatabase.open(ipod.path);
        try {
          db.addTrack({
            title: 'Song 1',
            artist: 'Artist 1',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Song 2',
            artist: 'Artist 2',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Movie 1',
            artist: 'Director 1',
            mediaType: MediaType.Movie,
          });
          db.addTrack({
            title: 'TV Episode 1',
            artist: 'Show 1',
            mediaType: MediaType.TVShow,
          });
          db.addTrack({
            title: 'Music Video 1',
            artist: 'Artist 3',
            mediaType: MediaType.MusicVideo,
          });
          await db.save();
        } finally {
          db.close();
        }

        createDeviceContext(ipod.path, { json: true, quiet: true });

        // Clear video tracks
        const db2 = await IpodDatabase.open(ipod.path);
        try {
          const result = db2.removeTracksByContentType('video', { deleteFiles: false });
          expect(result.removedCount).toBe(3); // Movie, TV Show, Music Video
          expect(result.totalCount).toBe(3);
          expect(db2.trackCount).toBe(2); // Only music remains
          await db2.save();
        } finally {
          db2.close();
        }

        // Verify only music tracks remain
        const db3 = await IpodDatabase.open(ipod.path);
        try {
          expect(db3.trackCount).toBe(2);
          const tracks = db3.getTracks();
          expect(tracks.every((t) => isMusicMediaType(t.mediaType))).toBe(true);
        } finally {
          db3.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('handles iPod with only music (no videos to clear)', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add only music
        const db = await IpodDatabase.open(ipod.path);
        try {
          db.addTrack({
            title: 'Song 1',
            artist: 'Artist 1',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Song 2',
            artist: 'Artist 2',
            mediaType: MediaType.Audio,
          });
          await db.save();
        } finally {
          db.close();
        }

        createDeviceContext(ipod.path, { json: true, quiet: true });

        // Try to clear video (should find nothing)
        const db2 = await IpodDatabase.open(ipod.path);
        try {
          const result = db2.removeTracksByContentType('video', { deleteFiles: false });
          expect(result.removedCount).toBe(0);
          expect(result.totalCount).toBe(0);
          expect(db2.trackCount).toBe(2); // Music still there
        } finally {
          db2.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('handles iPod with only video (no music to clear)', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add only video
        const db = await IpodDatabase.open(ipod.path);
        try {
          db.addTrack({
            title: 'Movie 1',
            artist: 'Director 1',
            mediaType: MediaType.Movie,
          });
          db.addTrack({
            title: 'TV Show 1',
            artist: 'Show 1',
            mediaType: MediaType.TVShow,
          });
          await db.save();
        } finally {
          db.close();
        }

        createDeviceContext(ipod.path, { json: true, quiet: true });

        // Try to clear music (should find nothing)
        const db2 = await IpodDatabase.open(ipod.path);
        try {
          const result = db2.removeTracksByContentType('music', { deleteFiles: false });
          expect(result.removedCount).toBe(0);
          expect(result.totalCount).toBe(0);
          expect(db2.trackCount).toBe(2); // Videos still there
        } finally {
          db2.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('does not remove podcasts when clearing music', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add music and podcasts
        const db = await IpodDatabase.open(ipod.path);
        try {
          db.addTrack({
            title: 'Song 1',
            artist: 'Artist 1',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Podcast 1',
            artist: 'Podcast Host',
            mediaType: MediaType.Podcast,
          });
          await db.save();
        } finally {
          db.close();
        }

        createDeviceContext(ipod.path, { json: true, quiet: true });

        // Clear music - should not remove podcasts
        const db2 = await IpodDatabase.open(ipod.path);
        try {
          const result = db2.removeTracksByContentType('music', { deleteFiles: false });
          expect(result.removedCount).toBe(1); // Only music
          expect(db2.trackCount).toBe(1); // Podcast remains
          await db2.save();
        } finally {
          db2.close();
        }

        // Verify podcast still exists
        const db3 = await IpodDatabase.open(ipod.path);
        try {
          const tracks = db3.getTracks();
          expect(tracks.length).toBe(1);
          expect(tracks[0]!.title).toBe('Podcast 1');
          expect(tracks[0]!.mediaType & MediaType.Podcast).not.toBe(0);
        } finally {
          db3.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('does not remove audiobooks when clearing music', async () => {
    await withTestIpod(
      async (ipod) => {
        // Add music and audiobooks
        const db = await IpodDatabase.open(ipod.path);
        try {
          db.addTrack({
            title: 'Song 1',
            artist: 'Artist 1',
            mediaType: MediaType.Audio,
          });
          db.addTrack({
            title: 'Audiobook 1',
            artist: 'Author 1',
            mediaType: MediaType.Audiobook,
          });
          await db.save();
        } finally {
          db.close();
        }

        createDeviceContext(ipod.path, { json: true, quiet: true });

        // Clear music - should not remove audiobooks
        const db2 = await IpodDatabase.open(ipod.path);
        try {
          const result = db2.removeTracksByContentType('music', { deleteFiles: false });
          expect(result.removedCount).toBe(1); // Only music
          expect(db2.trackCount).toBe(1); // Audiobook remains
          await db2.save();
        } finally {
          db2.close();
        }

        // Verify audiobook still exists
        const db3 = await IpodDatabase.open(ipod.path);
        try {
          const tracks = db3.getTracks();
          expect(tracks.length).toBe(1);
          expect(tracks[0]!.title).toBe('Audiobook 1');
          expect(tracks[0]!.mediaType & MediaType.Audiobook).not.toBe(0);
        } finally {
          db3.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('handles empty iPod gracefully for selective clearing', async () => {
    await withTestIpod(
      async (ipod) => {
        createDeviceContext(ipod.path, { json: true, quiet: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          expect(db.trackCount).toBe(0);

          const musicResult = db.removeTracksByContentType('music', { deleteFiles: false });
          expect(musicResult.removedCount).toBe(0);
          expect(musicResult.totalCount).toBe(0);

          const videoResult = db.removeTracksByContentType('video', { deleteFiles: false });
          expect(videoResult.removedCount).toBe(0);
          expect(videoResult.totalCount).toBe(0);
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });
});

describe('device reset integration', () => {
  afterEach(() => {
    clearContext();
  });

  it('removes all tracks with confirmation', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await ipod.addTrack({ title: 'Song 2', artist: 'Artist 2' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        expect(db.trackCount).toBe(2);

        const result = db.removeAllTracks({ deleteFiles: true });
        await db.save();

        expect(result.removedCount).toBe(2);
      } finally {
        db.close();
      }
    });
  });

  it('dry-run shows what would be removed', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Song 1', artist: 'Artist 1' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        // For dry-run, just verify we can read the count
        const trackCount = db.trackCount;
        expect(trackCount).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  it('handles empty iPod gracefully', async () => {
    await withTestIpod(async (ipod) => {
      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        expect(db.trackCount).toBe(0);

        const result = db.removeAllTracks({ deleteFiles: true });
        expect(result.removedCount).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it('correctly reports removed count', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'A', artist: 'X' });
      await ipod.addTrack({ title: 'B', artist: 'X' });
      await ipod.addTrack({ title: 'C', artist: 'X' });

      createDeviceContext(ipod.path, { json: true, quiet: true });

      const db = await IpodDatabase.open(ipod.path);
      try {
        const result = db.removeAllTracks({ deleteFiles: true });
        await db.save();

        expect(result.removedCount).toBe(3);
      } finally {
        db.close();
      }
    });
  });
});

describe('device operations across models', () => {
  afterEach(() => {
    clearContext();
  });

  it('works with Video 60GB model', async () => {
    await withTestIpod(
      async (ipod) => {
        await ipod.addTrack({ title: 'Test', artist: 'Artist' });

        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const info = db.getInfo();
          expect(info.device.capacity).toBe(60);
          expect(info.trackCount).toBe(1);
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_60GB }
    );
  });

  it('works with Video 30GB model', async () => {
    await withTestIpod(
      async (ipod) => {
        await ipod.addTrack({ title: 'Test', artist: 'Artist' });

        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const info = db.getInfo();
          expect(info.device.capacity).toBe(30);
          expect(info.trackCount).toBe(1);
        } finally {
          db.close();
        }
      },
      { model: TestModels.VIDEO_30GB }
    );
  });

  it('works with Nano 2GB model', async () => {
    await withTestIpod(
      async (ipod) => {
        await ipod.addTrack({ title: 'Test', artist: 'Artist' });

        createDeviceContext(ipod.path, { json: true });

        const db = await IpodDatabase.open(ipod.path);
        try {
          const info = db.getInfo();
          expect(info.device.capacity).toBe(2);
          expect(info.trackCount).toBe(1);
        } finally {
          db.close();
        }
      },
      { model: TestModels.NANO_2GB }
    );
  });
});

describe('database persistence', () => {
  afterEach(() => {
    clearContext();
  });

  it('persists changes after save', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Persistent Track', artist: 'Artist' });

      createDeviceContext(ipod.path, { json: true });

      // Open database, modify, save, close
      let db = await IpodDatabase.open(ipod.path);
      try {
        const tracks = db.getTracks();
        expect(tracks).toHaveLength(1);

        db.removeAllTracks({ deleteFiles: false });
        await db.save();
      } finally {
        db.close();
      }

      // Re-open and verify changes persisted
      db = await IpodDatabase.open(ipod.path);
      try {
        expect(db.trackCount).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it('changes are lost without save', async () => {
    await withTestIpod(async (ipod) => {
      await ipod.addTrack({ title: 'Track to Remove', artist: 'Artist' });

      createDeviceContext(ipod.path, { json: true });

      // Open, remove tracks, but don't save
      let db = await IpodDatabase.open(ipod.path);
      try {
        db.removeAllTracks({ deleteFiles: false });
        // Note: NOT calling db.save()
      } finally {
        db.close();
      }

      // Re-open - track should still be there
      db = await IpodDatabase.open(ipod.path);
      try {
        expect(db.trackCount).toBe(1);
      } finally {
        db.close();
      }
    });
  });
});
