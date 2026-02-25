import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestIpod, TestModels } from '@podkit/gpod-testing';
import {
  IpodDatabase,
  computeDiff,
  createPlan,
  getPlanSummary,
  createDirectoryAdapter,
} from '@podkit/core';

/**
 * Integration tests for the sync command.
 *
 * These tests require:
 * - gpod-tool to be built (mise run tools:build)
 * - FFmpeg to be installed
 *
 * The tests use real iPod databases (created by gpod-tool) and
 * test the sync flow components.
 */
describe('sync command integration', () => {
  let testIpod: Awaited<ReturnType<typeof createTestIpod>> | null = null;
  let tempSourceDir: string | null = null;

  afterEach(async () => {
    if (testIpod) {
      await testIpod.cleanup();
      testIpod = null;
    }
    if (tempSourceDir) {
      await rm(tempSourceDir, { recursive: true, force: true });
      tempSourceDir = null;
    }
  });

  describe('diff computation', () => {
    beforeEach(async () => {
      testIpod = await createTestIpod({
        model: TestModels.VIDEO_60GB,
        name: 'Test iPod',
      });

      // Create a temporary source directory
      tempSourceDir = join(tmpdir(), `podkit-sync-test-${Date.now()}`);
      await mkdir(tempSourceDir, { recursive: true });
    });

    it('computes empty diff when iPod is empty and source is empty', async () => {
      // Use empty source directory
      const adapter = createDirectoryAdapter({ path: tempSourceDir! });
      await adapter.connect();
      const collectionTracks = await adapter.getTracks();

      // Open iPod and get tracks using IpodDatabase
      const ipod = await IpodDatabase.open(testIpod!.path);
      try {
        // IpodDatabase.getTracks() returns IPodTrack[] directly
        const ipodTracks = ipod.getTracks();

        const diff = computeDiff(collectionTracks, ipodTracks);

        expect(diff.toAdd).toHaveLength(0);
        expect(diff.toRemove).toHaveLength(0);
        expect(diff.existing).toHaveLength(0);
        expect(diff.conflicts).toHaveLength(0);
      } finally {
        ipod.close();
        await adapter.disconnect();
      }
    });

    it('identifies tracks to remove when iPod has tracks but source is empty', async () => {
      // Add tracks to iPod
      await testIpod!.addTrack({ title: 'Song 1', artist: 'Artist 1', album: 'Album 1' });
      await testIpod!.addTrack({ title: 'Song 2', artist: 'Artist 2', album: 'Album 2' });

      // Use empty source directory
      const adapter = createDirectoryAdapter({ path: tempSourceDir! });
      await adapter.connect();
      const collectionTracks = await adapter.getTracks();

      // Open iPod and get tracks using IpodDatabase
      const ipod = await IpodDatabase.open(testIpod!.path);
      try {
        // IpodDatabase.getTracks() returns IPodTrack[] directly
        const ipodTracks = ipod.getTracks();

        const diff = computeDiff(collectionTracks, ipodTracks);

        expect(diff.toAdd).toHaveLength(0);
        expect(diff.toRemove).toHaveLength(2);
        expect(diff.existing).toHaveLength(0);
      } finally {
        ipod.close();
        await adapter.disconnect();
      }
    });
  });

  describe('sync plan creation', () => {
    beforeEach(async () => {
      testIpod = await createTestIpod({
        model: TestModels.VIDEO_60GB,
        name: 'Test iPod',
      });
    });

    it('creates remove operations when removeOrphans is true', async () => {
      // Add tracks to iPod
      await testIpod!.addTrack({ title: 'Song 1', artist: 'Artist 1', album: 'Album 1' });
      await testIpod!.addTrack({ title: 'Song 2', artist: 'Artist 2', album: 'Album 2' });

      const ipod = await IpodDatabase.open(testIpod!.path);
      try {
        // IpodDatabase.getTracks() returns IPodTrack[] directly
        const ipodTracks = ipod.getTracks();

        // Empty collection diff
        const diff = computeDiff([], ipodTracks);

        // Create plan with removeOrphans
        const plan = createPlan(diff, { removeOrphans: true });
        const summary = getPlanSummary(plan);

        expect(summary.removeCount).toBe(2);
        expect(summary.transcodeCount).toBe(0);
        expect(summary.copyCount).toBe(0);
      } finally {
        ipod.close();
      }
    });

    it('skips remove operations when removeOrphans is false', async () => {
      // Add tracks to iPod
      await testIpod!.addTrack({ title: 'Song 1', artist: 'Artist 1', album: 'Album 1' });

      const ipod = await IpodDatabase.open(testIpod!.path);
      try {
        // IpodDatabase.getTracks() returns IPodTrack[] directly
        const ipodTracks = ipod.getTracks();

        // Empty collection diff
        const diff = computeDiff([], ipodTracks);

        // Create plan without removeOrphans
        const plan = createPlan(diff, { removeOrphans: false });
        const summary = getPlanSummary(plan);

        expect(summary.removeCount).toBe(0);
        expect(plan.operations).toHaveLength(0);
      } finally {
        ipod.close();
      }
    });
  });

  describe('device compatibility', () => {
    it('works with Video 30GB model', async () => {
      testIpod = await createTestIpod({
        model: TestModels.VIDEO_30GB,
        name: 'Test Video 30GB',
      });

      const ipod = await IpodDatabase.open(testIpod.path);
      try {
        const info = ipod.getInfo();
        expect(info.trackCount).toBe(0);
        expect(info.device.capacity).toBe(30);
      } finally {
        ipod.close();
      }
    });

    it('works with Nano model', async () => {
      testIpod = await createTestIpod({
        model: TestModels.NANO_2GB,
        name: 'Test Nano',
      });

      const ipod = await IpodDatabase.open(testIpod.path);
      try {
        const info = ipod.getInfo();
        expect(info.trackCount).toBe(0);
        expect(info.device.capacity).toBe(2);
      } finally {
        ipod.close();
      }
    });
  });
});
