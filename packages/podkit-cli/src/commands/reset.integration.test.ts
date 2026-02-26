import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createTestIpod, TestModels } from '@podkit/gpod-testing';
import { IpodDatabase } from '@podkit/core';

/**
 * Integration tests for the reset command.
 *
 * These tests require gpod-tool to be built and available.
 * Run: `mise run tools:build` before running these tests.
 */
describe('reset command integration', () => {
  let testIpod: Awaited<ReturnType<typeof createTestIpod>> | null = null;

  afterEach(async () => {
    if (testIpod) {
      await testIpod.cleanup();
      testIpod = null;
    }
  });

  describe('removeAllTracks via IpodDatabase', () => {
    beforeEach(async () => {
      testIpod = await createTestIpod({
        model: TestModels.VIDEO_60GB,
        name: 'Test iPod',
      });
    });

    it('removes all tracks from iPod', async () => {
      // Add tracks using gpod-testing
      await testIpod!.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await testIpod!.addTrack({ title: 'Song 2', artist: 'Artist 2' });
      await testIpod!.addTrack({ title: 'Song 3', artist: 'Artist 3' });

      // Verify tracks were added
      let ipod = await IpodDatabase.open(testIpod!.path);
      try {
        expect(ipod.trackCount).toBe(3);
      } finally {
        ipod.close();
      }

      // Open again and remove all tracks
      ipod = await IpodDatabase.open(testIpod!.path);
      try {
        const removedCount = ipod.removeAllTracks({ deleteFiles: false });
        expect(removedCount).toBe(3);
        expect(ipod.trackCount).toBe(0);
        await ipod.save();
      } finally {
        ipod.close();
      }

      // Verify tracks are gone in new session
      ipod = await IpodDatabase.open(testIpod!.path);
      try {
        expect(ipod.trackCount).toBe(0);
      } finally {
        ipod.close();
      }
    });

    it('handles empty iPod gracefully', async () => {
      const ipod = await IpodDatabase.open(testIpod!.path);
      try {
        expect(ipod.trackCount).toBe(0);

        const removedCount = ipod.removeAllTracks({ deleteFiles: false });
        expect(removedCount).toBe(0);
        expect(ipod.trackCount).toBe(0);
      } finally {
        ipod.close();
      }
    });

    it('preserves playlists but clears tracks from them', async () => {
      // Add tracks using gpod-testing
      await testIpod!.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await testIpod!.addTrack({ title: 'Song 2', artist: 'Artist 2' });

      // Open and create a playlist
      let ipod = await IpodDatabase.open(testIpod!.path);
      try {
        const playlist = ipod.createPlaylist('My Playlist');
        const tracks = ipod.getTracks();
        playlist.addTrack(tracks[0]!).addTrack(tracks[1]!);
        await ipod.save();
      } finally {
        ipod.close();
      }

      // Remove all tracks
      ipod = await IpodDatabase.open(testIpod!.path);
      try {
        ipod.removeAllTracks({ deleteFiles: false });
        await ipod.save();
      } finally {
        ipod.close();
      }

      // Verify playlist still exists but is empty
      ipod = await IpodDatabase.open(testIpod!.path);
      try {
        const playlist = ipod.getPlaylistByName('My Playlist');
        expect(playlist).not.toBeNull();
        expect(playlist!.trackCount).toBe(0);
        expect(ipod.trackCount).toBe(0);
      } finally {
        ipod.close();
      }
    });
  });
});
