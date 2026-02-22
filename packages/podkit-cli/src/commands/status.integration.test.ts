import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createTestIpod, TestModels } from '@podkit/gpod-testing';
import { Database } from '@podkit/libgpod-node';

/**
 * Integration tests for the status command.
 *
 * These tests require gpod-tool to be built and available.
 * Run: `mise run tools:build` before running these tests.
 */
describe('status command integration', () => {
  let testIpod: Awaited<ReturnType<typeof createTestIpod>> | null = null;

  afterEach(async () => {
    if (testIpod) {
      await testIpod.cleanup();
      testIpod = null;
    }
  });

  describe('with test iPod', () => {
    beforeEach(async () => {
      testIpod = await createTestIpod({
        model: TestModels.VIDEO_60GB,
        name: 'Test iPod',
      });
    });

    it('opens database and gets device info', async () => {
      const db = await Database.open(testIpod!.path);

      try {
        const info = db.getInfo();

        expect(info.trackCount).toBe(0);
        expect(info.mountpoint).toBe(testIpod!.path);
        expect(info.device).toBeDefined();
        expect(info.device.generation).toBe('video_1');
      } finally {
        db.close();
      }
    });

    it('returns correct track count after adding tracks', async () => {
      // Add tracks using gpod-testing
      await testIpod!.addTrack({ title: 'Song 1', artist: 'Artist 1' });
      await testIpod!.addTrack({ title: 'Song 2', artist: 'Artist 2' });
      await testIpod!.addTrack({ title: 'Song 3', artist: 'Artist 3' });

      // Open with libgpod-node and verify
      const db = await Database.open(testIpod!.path);

      try {
        const info = db.getInfo();
        expect(info.trackCount).toBe(3);
      } finally {
        db.close();
      }
    });

    it('gets device capacity from database', async () => {
      const db = await Database.open(testIpod!.path);

      try {
        const device = db.device;

        // MA147 is a 60GB Video iPod
        expect(device.capacity).toBe(60);
        expect(device.generation).toBe('video_1');
      } finally {
        db.close();
      }
    });
  });

  describe('with different iPod models', () => {
    it('works with Video 30GB model', async () => {
      testIpod = await createTestIpod({
        model: TestModels.VIDEO_30GB,
        name: 'Test Video 30GB',
      });

      const db = await Database.open(testIpod.path);

      try {
        const device = db.device;
        expect(device.capacity).toBe(30);
        expect(device.generation).toBe('video_1');
      } finally {
        db.close();
      }
    });

    it('works with Nano 2GB model', async () => {
      testIpod = await createTestIpod({
        model: TestModels.NANO_2GB,
        name: 'Test Nano 2GB',
      });

      const db = await Database.open(testIpod.path);

      try {
        const device = db.device;
        expect(device.capacity).toBe(2);
        expect(device.generation).toBe('nano_2');
      } finally {
        db.close();
      }
    });
  });

  describe('error handling', () => {
    it('throws for non-existent path', async () => {
      const invalidPath = '/nonexistent/path/to/ipod';

      await expect(Database.open(invalidPath)).rejects.toThrow();
    });

    it('throws for path without iTunesDB', async () => {
      // Create a temp directory without iPod structure
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tempDir = await mkdtemp(join(tmpdir(), 'not-an-ipod-'));

      try {
        await expect(Database.open(tempDir)).rejects.toThrow();
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });
  });
});
