import { describe, it, expect, beforeAll } from 'bun:test';
import { stat } from 'node:fs/promises';
import {
  createTestIpod,
  withTestIpod,
  createTestIpodsForModels,
  TestModels,
  isGpodToolAvailable,
  getGpodToolVersion,
  gpodTool,
  GpodToolError,
} from './index';

describe('gpod-testing', () => {
  beforeAll(async () => {
    const available = await isGpodToolAvailable();
    if (!available) {
      throw new Error('gpod-tool not found in PATH. Run `mise run tools:build` first.');
    }
  });

  describe('isGpodToolAvailable', () => {
    it('returns true when gpod-tool is installed', async () => {
      const available = await isGpodToolAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getGpodToolVersion', () => {
    it('returns version string', async () => {
      const version = await getGpodToolVersion();
      expect(version).toMatch(/^gpod-tool \d+\.\d+\.\d+$/);
    });
  });

  describe('createTestIpod', () => {
    it('creates a test iPod with default options', async () => {
      const ipod = await createTestIpod();

      try {
        expect(ipod.path).toContain('test-ipod-');
        expect(ipod.model).toBe('MA147');
        expect(ipod.name).toBe('Test iPod');

        const info = await ipod.info();
        expect(info.trackCount).toBe(0);
        expect(info.playlistCount).toBe(1); // Master playlist
        expect(info.device.modelNumber).toBe('A147');
      } finally {
        await ipod.cleanup();
      }
    });

    it('creates a test iPod with custom model', async () => {
      // Use MA002 (iPod Video 30GB) - works without FirewireID
      const ipod = await createTestIpod({
        model: 'MA002',
        name: 'My Video',
      });

      try {
        expect(ipod.model).toBe('MA002');
        expect(ipod.name).toBe('My Video');

        const info = await ipod.info();
        expect(info.device.modelNumber).toBe('A002');
      } finally {
        await ipod.cleanup();
      }
    });

    it('succeeds with models requiring FirewireID (iPod Classic 6th gen+)', async () => {
      // MB565 (iPod Classic 120GB) requires FirewireID in SysInfo
      // A default test GUID is injected automatically
      const ipod = await createTestIpod({ model: 'MB565', name: 'Classic' });
      try {
        const info = await ipod.info();
        expect(info.device.supportsArtwork).toBe(true);
        expect(info.device.supportsVideo).toBe(true);
      } finally {
        await ipod.cleanup();
      }
    });

    it('allows adding tracks', async () => {
      const ipod = await createTestIpod();

      try {
        const result = await ipod.addTrack({
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          trackNumber: 1,
          durationMs: 180000,
        });

        expect(result.title).toBe('Test Song');
        expect(result.artist).toBe('Test Artist');
        expect(result.trackId).toBeGreaterThan(0);

        const tracks = await ipod.tracks();
        expect(tracks).toHaveLength(1);
        const firstTrack = tracks[0];
        expect(firstTrack).toBeDefined();
        expect(firstTrack?.title).toBe('Test Song');
        expect(firstTrack?.artist).toBe('Test Artist');
      } finally {
        await ipod.cleanup();
      }
    });

    it('verifies database integrity', async () => {
      const ipod = await createTestIpod();

      try {
        const result = await ipod.verify();
        expect(result.valid).toBe(true);
        expect(result.path).toBe(ipod.path);
      } finally {
        await ipod.cleanup();
      }
    });

    it('cleanup is idempotent', async () => {
      const ipod = await createTestIpod();

      await ipod.cleanup();
      await ipod.cleanup(); // Should not throw
    });
  });

  describe('withTestIpod', () => {
    it('creates and cleans up automatically', async () => {
      let capturedPath = '';

      await withTestIpod(async (ipod) => {
        capturedPath = ipod.path;
        const info = await ipod.info();
        expect(info.trackCount).toBe(0);
      });

      // Verify cleanup happened
      expect(capturedPath).not.toBe('');
      await expect(stat(capturedPath)).rejects.toThrow();
    });

    it('cleans up even on error', async () => {
      let capturedPath = '';

      try {
        await withTestIpod(async (ipod) => {
          capturedPath = ipod.path;
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      // Verify cleanup happened
      expect(capturedPath).not.toBe('');
      await expect(stat(capturedPath)).rejects.toThrow();
    });

    it('returns the function result', async () => {
      const result = await withTestIpod(async (ipod) => {
        await ipod.addTrack({ title: 'Test' });
        const info = await ipod.info();
        return info.trackCount;
      });

      expect(result).toBe(1);
    });
  });

  describe('createTestIpodsForModels', () => {
    it('creates multiple iPods with different models', async () => {
      // Use Video models that work without FirewireID
      const ipods = await createTestIpodsForModels(['MA147', 'MA002']);

      try {
        expect(ipods).toHaveLength(2);
        expect(ipods[0]?.model).toBe('MA147');
        expect(ipods[1]?.model).toBe('MA002');
      } finally {
        await Promise.all(ipods.map((i) => i.cleanup()));
      }
    });
  });

  describe('TestModels', () => {
    it('provides common model constants', () => {
      expect(TestModels.VIDEO_60GB).toBe('MA147');
      expect(TestModels.VIDEO_30GB).toBe('MA002');
      expect(TestModels.NANO_2GB).toBe('MA477');
    });
  });

  describe('gpodTool (low-level)', () => {
    it('exposes low-level functions', () => {
      expect(gpodTool.init).toBeFunction();
      expect(gpodTool.info).toBeFunction();
      expect(gpodTool.tracks).toBeFunction();
      expect(gpodTool.addTrack).toBeFunction();
      expect(gpodTool.verify).toBeFunction();
    });

    it('throws GpodToolError on failure', async () => {
      try {
        await gpodTool.init('/tmp/test-fail', { model: 'MB565' });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GpodToolError);
        if (error instanceof GpodToolError) {
          expect(error.message).toContain('firewire ID');
          expect(error.command).toContain('gpod-tool');
        }
      }
    });
  });
});
