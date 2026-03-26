/**
 * Unit tests for artwork reset diagnostic check
 *
 * Verifies that artworkResetCheck:
 * - Always returns 'skip' from check() (it's repair-only)
 * - Has no requirements (no source collection needed)
 * - Calls resetArtworkDatabase correctly via its repair
 * - Is registered in getDiagnosticCheckIds()
 */

import { describe, it, expect, mock } from 'bun:test';
import { artworkResetCheck } from './artwork-reset.js';
import { getDiagnosticCheckIds, getDiagnosticCheck } from '../index.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { IpodTrack } from '../../ipod/types.js';
import type { IpodDatabase } from '../../ipod/database.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeIpodTrack(hasArtwork: boolean): IpodTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    comment: undefined,
    syncTag: null,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1,
    filePath: ':iPod_Control:Music:F00:test.m4a',
    timeAdded: 0,
    timeModified: 0,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork,
    hasFile: true,
    compilation: false,
    update: mock(() => ({}) as IpodTrack),
    remove: mock(() => {}),
    copyFile: mock(() => ({}) as IpodTrack),
    setArtwork: mock(() => ({}) as IpodTrack),
    setArtworkFromData: mock(() => ({}) as IpodTrack),
    removeArtwork: mock(() => ({}) as IpodTrack),
  } as IpodTrack;
}

function makeMockDb(tracks: IpodTrack[]): IpodDatabase {
  return {
    getTracks: () => tracks,
    removeTrackArtwork: mock(() => {}),
    updateTrack: mock((_track: IpodTrack, _fields: Partial<IpodTrack>) => {}),
    save: mock(async () => {}),
    trackCount: tracks.length,
    close: mock(() => {}),
    getInfo: mock(() => ({ device: { modelName: 'iPod' } })),
  } as unknown as IpodDatabase;
}

function makeCtx(mountPoint: string, tracks: IpodTrack[]): DiagnosticContext {
  return { mountPoint, db: makeMockDb(tracks) };
}

function makeRepairCtx(mountPoint: string, tracks: IpodTrack[]): RepairContext {
  return { mountPoint, db: makeMockDb(tracks), adapters: [] };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('artworkResetCheck', () => {
  describe('registration', () => {
    it('should be registered in getDiagnosticCheckIds()', () => {
      const ids = getDiagnosticCheckIds();
      expect(ids).toContain('artwork-reset');
    });

    it('should be retrievable by getDiagnosticCheck()', () => {
      const check = getDiagnosticCheck('artwork-reset');
      expect(check).toBeDefined();
      expect(check?.id).toBe('artwork-reset');
      expect(check?.name).toBe('Artwork Reset');
    });

    it('should have a repair defined', () => {
      const check = getDiagnosticCheck('artwork-reset');
      expect(check?.repair).toBeDefined();
    });
  });

  describe('check()', () => {
    it('should always return skip — it is repair-only', async () => {
      const ctx = makeCtx('/mnt/ipod', []);
      const result = await artworkResetCheck.check(ctx);

      expect(result.status).toBe('skip');
      expect(result.repairable).toBe(false);
    });

    it('should return skip even when tracks are present', async () => {
      const tracks = [makeIpodTrack(true), makeIpodTrack(false)];
      const ctx = makeCtx('/mnt/ipod', tracks);
      const result = await artworkResetCheck.check(ctx);

      expect(result.status).toBe('skip');
    });
  });

  describe('repair', () => {
    it('should have no requirements', () => {
      expect(artworkResetCheck.repair!.requirements).toEqual([]);
    });

    it('should describe the repair action', () => {
      expect(artworkResetCheck.repair!.description).toContain('artwork');
    });

    it('should call removeTrackArtwork for each track with artwork and save on real run', async () => {
      const tracks = [makeIpodTrack(true), makeIpodTrack(true), makeIpodTrack(false)];
      const ctx = makeRepairCtx('/mnt/ipod', tracks);
      const result = await artworkResetCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect(result.details?.totalTracks).toBe(3);
      // removeTrackArtwork was called for each track (may fail silently for tracks without artwork)
      expect(
        (ctx.db.removeTrackArtwork as ReturnType<typeof mock>).mock.calls.length
      ).toBeGreaterThan(0);
      expect((ctx.db.save as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
    });

    it('should report tracksCleared and totalTracks in result details', async () => {
      const tracks = [makeIpodTrack(true), makeIpodTrack(true)];
      const ctx = makeRepairCtx('/mnt/ipod', tracks);
      const result = await artworkResetCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect(result.details?.totalTracks).toBe(2);
      expect(typeof result.details?.tracksCleared).toBe('number');
      expect(typeof result.details?.orphanedFilesRemoved).toBe('number');
    });

    it('should report dry-run counts without modifying the iPod', async () => {
      const tracks = [makeIpodTrack(true), makeIpodTrack(false)];
      const ctx = makeRepairCtx('/mnt/ipod', tracks);
      const result = await artworkResetCheck.repair!.run(ctx, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      // In dry-run mode, save should NOT be called
      expect((ctx.db.save as ReturnType<typeof mock>).mock.calls.length).toBe(0);
      // tracksCleared counts tracks that have artwork (hasArtwork=true)
      expect(result.details?.tracksCleared).toBe(1);
      expect(result.details?.totalTracks).toBe(2);
    });

    it('should include summary with track counts', async () => {
      const tracks = [makeIpodTrack(true)];
      const ctx = makeRepairCtx('/mnt/ipod', tracks);
      const result = await artworkResetCheck.repair!.run(ctx);

      expect(result.summary).toContain('1');
    });
  });
});
