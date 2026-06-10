/**
 * Unit tests for artwork database operations (reset + rebuild)
 *
 * Tests the resetArtworkDatabase and rebuildArtworkDatabase functions.
 *
 * rebuildArtworkDatabase coordinates: removing all artwork from iPod tracks,
 * matching them to source collection tracks, re-extracting artwork from source,
 * setting it on iPod tracks, and updating sync tags.
 *
 * resetArtworkDatabase removes all artwork and clears sync tags without
 * needing source collections.
 */

import { describe, it, expect, mock } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import type { IpodTrack, TrackFields } from '../ipod/types.js';
import type { CollectionAdapter, CollectionTrack, FileAccess } from '../adapters/interface.js';
import type { RebuildDependencies, RebuildProgress } from './repair.js';
import { rebuildArtworkDatabase, resetArtworkDatabase } from './repair.js';
import { hashArtwork } from './hash.js';
import type { ExtractedArtwork } from './types.js';
import { makeMockIpodTrack, makeMockCollectionTrack } from '../test-utils/tracks.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal mock IpodTrack with the fields used by repair */
function makeIpodTrack(overrides: {
  artist: string;
  title: string;
  album: string;
  comment?: string;
  hasArtwork?: boolean;
}): IpodTrack {
  return makeMockIpodTrack({
    ...overrides,
    hasArtwork: overrides.hasArtwork ?? true,
    update: mock(() => ({}) as IpodTrack),
    remove: mock(() => {}),
    copyFile: mock(() => ({}) as IpodTrack),
  });
}

/** Create a minimal mock CollectionTrack */
function makeCollectionTrack(overrides: {
  artist: string;
  title: string;
  album: string;
  filePath?: string;
}): CollectionTrack {
  return makeMockCollectionTrack({
    id: `${overrides.artist}-${overrides.title}`,
    title: overrides.title,
    artist: overrides.artist,
    album: overrides.album,
    filePath: overrides.filePath ?? `/music/${overrides.artist}/${overrides.title}.flac`,
  });
}

/** Create a mock CollectionAdapter */
function makeAdapter(tracks: CollectionTrack[]): CollectionAdapter {
  return {
    name: 'test-adapter',
    adapterType: 'directory',
    connect: mock(async () => {}),
    getItems: mock(async () => tracks),
    getFilteredItems: mock(async () => tracks),
    getFileAccess: mock(
      (track: CollectionTrack): FileAccess => ({
        type: 'path' as const,
        path: track.filePath,
      })
    ),
    disconnect: mock(async () => {}),
  };
}

/** Standard mock artwork data */
const MOCK_ARTWORK_DATA = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const MOCK_ARTWORK: ExtractedArtwork = {
  data: MOCK_ARTWORK_DATA,
  mimeType: 'image/jpeg',
  width: 300,
  height: 300,
};

interface MockDb {
  getTracks: ReturnType<typeof mock>;
  removeTrackArtwork: ReturnType<typeof mock>;
  setTrackArtworkFromData: ReturnType<typeof mock>;
  updateTrack: ReturnType<typeof mock>;
  save: ReturnType<typeof mock>;
  trackCount: number;
}

/** Create a mock IpodDatabase */
function makeMockDb(ipodTracks: IpodTrack[]): MockDb {
  return {
    getTracks: mock(() => ipodTracks),
    removeTrackArtwork: mock((_track: IpodTrack) => {}),
    setTrackArtworkFromData: mock((_track: IpodTrack, _data: Buffer) => {}),
    updateTrack: mock((_track: IpodTrack, _fields: TrackFields) => {}),
    save: mock(async () => ({ warnings: [] })),
    trackCount: ipodTracks.length,
  };
}

/** Create mock deps with injected extractArtwork */
function makeDeps(
  db: MockDb,
  adapters: CollectionAdapter[],
  extractArtworkImpl?: (path: string) => Promise<ExtractedArtwork | null>,
  overrides: Partial<RebuildDependencies> = {}
): RebuildDependencies {
  return {
    db,
    adapters,
    extractArtwork: extractArtworkImpl ?? (async () => MOCK_ARTWORK),
    cleanupAllTempArtwork: async () => {},
    // Bypass the real fs-touching validity probe in unit tests — source paths
    // here are fabricated and don't exist on disk. The dedicated
    // "source-file validity gate" describe block below uses a real probe
    // against actual temp files to exercise the gate end-to-end.
    checkSourceFileValidity: () => ({ ok: true }),
    ...overrides,
  } as unknown as RebuildDependencies;
}

// ── rebuildArtworkDatabase tests ────────────────────────────────────────────

describe('rebuildArtworkDatabase', () => {
  describe('core orchestration', () => {
    it('rebuilds all tracks when all match source with artwork', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeIpodTrack({ artist: 'Artist B', title: 'Song 2', album: 'Album 2' }),
        makeIpodTrack({ artist: 'Artist C', title: 'Song 3', album: 'Album 3' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeCollectionTrack({ artist: 'Artist B', title: 'Song 2', album: 'Album 2' }),
        makeCollectionTrack({ artist: 'Artist C', title: 'Song 3', album: 'Album 3' }),
      ];

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(result.totalTracks).toBe(3);
      expect(result.matched).toBe(3);
      expect(result.noSource).toBe(0);
      expect(result.noArtwork).toBe(0);
      expect(result.errors).toBe(0);

      expect(db.removeTrackArtwork).toHaveBeenCalledTimes(3);
      expect(db.setTrackArtworkFromData).toHaveBeenCalledTimes(3);
      // Phase 1 save (clear corrupt artwork) + final batch save
      expect(db.save).toHaveBeenCalledTimes(2);
    });

    it('reports noSource for iPod tracks with no matching source', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeIpodTrack({ artist: 'Unknown', title: 'Orphan', album: 'Nowhere' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
      ];

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(result.totalTracks).toBe(2);
      expect(result.matched).toBe(1);
      expect(result.noSource).toBe(1);
      expect(db.removeTrackArtwork).toHaveBeenCalledTimes(2);
      expect(db.setTrackArtworkFromData).toHaveBeenCalledTimes(1);
    });

    it('handles mixed results: matched, noSource, and noArtwork', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Has Art', title: 'Match', album: 'A' }),
        makeIpodTrack({ artist: 'No Art', title: 'Match', album: 'B' }),
        makeIpodTrack({ artist: 'Orphan', title: 'NoMatch', album: 'C' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Has Art', title: 'Match', album: 'A' }),
        makeCollectionTrack({ artist: 'No Art', title: 'Match', album: 'B' }),
      ];

      let callCount = 0;
      const extractArtwork = async () => {
        callCount++;
        // First call returns artwork, second returns null
        return callCount === 1 ? MOCK_ARTWORK : null;
      };

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter], extractArtwork));

      expect(result.totalTracks).toBe(3);
      expect(result.matched).toBe(1);
      expect(result.noSource).toBe(1);
      expect(result.noArtwork).toBe(1);
      expect(result.errors).toBe(0);
    });
  });

  describe('dry run mode', () => {
    it('does not mutate the database in dry run', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeIpodTrack({ artist: 'Artist B', title: 'Song 2', album: 'Album 2' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeCollectionTrack({ artist: 'Artist B', title: 'Song 2', album: 'Album 2' }),
      ];

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      await rebuildArtworkDatabase(makeDeps(db, [adapter]), { dryRun: true });

      expect(db.removeTrackArtwork).not.toHaveBeenCalled();
      expect(db.setTrackArtworkFromData).not.toHaveBeenCalled();
      expect(db.updateTrack).not.toHaveBeenCalled();
      expect(db.save).not.toHaveBeenCalled();
    });

    it('reports correct counts in dry run', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeIpodTrack({ artist: 'Orphan', title: 'NoMatch', album: 'X' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
      ];

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter]), { dryRun: true });

      expect(result.totalTracks).toBe(2);
      expect(result.matched).toBe(1);
      expect(result.noSource).toBe(1);
    });
  });

  describe('sync tag handling', () => {
    it('updates art= hash in existing sync tag', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
        comment: '[podkit:v1 quality=high encoding=vbr art=00000000]',
      });

      const sourceTrack = makeCollectionTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([sourceTrack]);

      await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(db.updateTrack).toHaveBeenCalledTimes(1);

      const updateCall = (db.updateTrack as ReturnType<typeof mock>).mock.calls[0]!;
      const fields = updateCall[1] as TrackFields;
      const newComment = fields.comment!;

      const expectedHash = hashArtwork(MOCK_ARTWORK_DATA);
      expect(newComment).toContain(`art=${expectedHash}`);
      expect(newComment).toContain('quality=high');
      expect(newComment).toContain('encoding=vbr');
    });

    it('clears art= hash when track has no source match', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Orphan',
        title: 'No Match',
        album: 'Gone',
        comment: '[podkit:v1 quality=high encoding=vbr art=deadbeef]',
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([]); // no source tracks

      await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(db.updateTrack).toHaveBeenCalledTimes(1);
      const fields = (db.updateTrack as ReturnType<typeof mock>).mock.calls[0]![1] as TrackFields;
      expect(fields.comment).toContain('quality=high');
      expect(fields.comment).toContain('encoding=vbr');
      expect(fields.comment).not.toContain('art=');
    });

    it('clears art= hash when source has no artwork', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
        comment: '[podkit:v1 quality=high encoding=vbr art=deadbeef]',
      });

      const sourceTrack = makeCollectionTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([sourceTrack]);

      // extractArtwork returns null (source has no artwork)
      await rebuildArtworkDatabase(makeDeps(db, [adapter], async () => null));

      expect(db.updateTrack).toHaveBeenCalledTimes(1);
      const fields = (db.updateTrack as ReturnType<typeof mock>).mock.calls[0]![1] as TrackFields;
      expect(fields.comment).toContain('quality=high');
      expect(fields.comment).toContain('encoding=vbr');
      expect(fields.comment).not.toContain('art=');
    });

    it('clears art= hash when artwork extraction errors', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
        comment: '[podkit:v1 quality=high encoding=vbr art=deadbeef]',
      });

      const sourceTrack = makeCollectionTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([sourceTrack]);

      await rebuildArtworkDatabase(
        makeDeps(db, [adapter], async () => {
          throw new Error('extraction failed');
        })
      );

      expect(db.updateTrack).toHaveBeenCalledTimes(1);
      const fields = (db.updateTrack as ReturnType<typeof mock>).mock.calls[0]![1] as TrackFields;
      expect(fields.comment).toContain('quality=high');
      expect(fields.comment).toContain('encoding=vbr');
      expect(fields.comment).not.toContain('art=');
    });

    it('does not touch sync tag when track has no art= hash and no source match', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Orphan',
        title: 'No Match',
        album: 'Gone',
        comment: '[podkit:v1 quality=high encoding=vbr]',
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([]);

      await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      // No updateTrack call needed — sync tag already has no art= hash
      expect(db.updateTrack).not.toHaveBeenCalled();
    });

    it('does not touch sync tag when track has no tag and no source match', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Orphan',
        title: 'No Match',
        album: 'Gone',
        comment: undefined,
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([]);

      await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(db.updateTrack).not.toHaveBeenCalled();
    });

    it('does not write a sync tag when track has no existing tag', async () => {
      const ipodTrack = makeIpodTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
        comment: undefined,
      });

      const sourceTrack = makeCollectionTrack({
        artist: 'Artist A',
        title: 'Song 1',
        album: 'Album 1',
      });

      const db = makeMockDb([ipodTrack]);
      const adapter = makeAdapter([sourceTrack]);

      await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(db.setTrackArtworkFromData).toHaveBeenCalledTimes(1);
      expect(db.updateTrack).not.toHaveBeenCalled();
    });
  });

  describe('progress reporting', () => {
    it('calls onProgress for each track with correct counts', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Match', title: 'S1', album: 'A' }),
        makeIpodTrack({ artist: 'Orphan', title: 'S2', album: 'B' }),
        makeIpodTrack({ artist: 'Match2', title: 'S3', album: 'C' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Match', title: 'S1', album: 'A' }),
        makeCollectionTrack({ artist: 'Match2', title: 'S3', album: 'C' }),
      ];

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      const progressUpdates: RebuildProgress[] = [];
      await rebuildArtworkDatabase(makeDeps(db, [adapter]), {
        onProgress: (p) => progressUpdates.push({ ...p }),
      });

      expect(progressUpdates.length).toBe(3);
      expect(progressUpdates[0]!.current).toBe(1);
      expect(progressUpdates[0]!.total).toBe(3);
      expect(progressUpdates[0]!.matched).toBe(1);
      expect(progressUpdates[1]!.current).toBe(2);
      expect(progressUpdates[1]!.noSource).toBe(1);
      expect(progressUpdates[2]!.current).toBe(3);
      expect(progressUpdates[2]!.matched).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty iPod with zero tracks', async () => {
      const db = makeMockDb([]);
      const adapter = makeAdapter([]);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter]));

      expect(result.totalTracks).toBe(0);
      expect(result.matched).toBe(0);
      // Phase 1 save still runs to clear any existing artwork files
      expect(db.save).toHaveBeenCalledTimes(1);
    });

    it('searches tracks from multiple adapters', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
        makeIpodTrack({ artist: 'Artist B', title: 'Song 2', album: 'Album 2' }),
      ];

      const adapter1 = makeAdapter([
        makeCollectionTrack({ artist: 'Artist A', title: 'Song 1', album: 'Album 1' }),
      ]);
      const adapter2 = makeAdapter([
        makeCollectionTrack({ artist: 'Artist B', title: 'Song 2', album: 'Album 2' }),
      ]);

      const db = makeMockDb(ipodTracks);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter1, adapter2]));

      expect(result.totalTracks).toBe(2);
      expect(result.matched).toBe(2);
      expect(result.noSource).toBe(0);
    });

    it('increments error count when artwork extraction throws', async () => {
      const ipodTracks = [
        makeIpodTrack({ artist: 'Good', title: 'Song 1', album: 'A' }),
        makeIpodTrack({ artist: 'Bad', title: 'Song 2', album: 'B' }),
        makeIpodTrack({ artist: 'Good2', title: 'Song 3', album: 'C' }),
      ];

      const sourceTracks = [
        makeCollectionTrack({ artist: 'Good', title: 'Song 1', album: 'A' }),
        makeCollectionTrack({ artist: 'Bad', title: 'Song 2', album: 'B' }),
        makeCollectionTrack({ artist: 'Good2', title: 'Song 3', album: 'C' }),
      ];

      let callCount = 0;
      const extractArtwork = async () => {
        callCount++;
        if (callCount === 2) throw new Error('Corrupt audio file');
        return MOCK_ARTWORK;
      };

      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter], extractArtwork));

      expect(result.matched).toBe(2);
      expect(result.errors).toBe(1);
      expect(result.errorDetails).toHaveLength(1);
      expect(result.errorDetails[0]!.artist).toBe('Bad');
      expect(result.errorDetails[0]!.error).toBe('Corrupt audio file');
      expect(db.setTrackArtworkFromData).toHaveBeenCalledTimes(2);
      // Phase 1 save (clear corrupt artwork) + final batch save
      expect(db.save).toHaveBeenCalledTimes(2);
    });

    it('calls cleanupAllTempArtwork even when errors occur', async () => {
      const ipodTracks = [makeIpodTrack({ artist: 'A', title: 'S1', album: 'X' })];

      const sourceTracks = [makeCollectionTrack({ artist: 'A', title: 'S1', album: 'X' })];

      const cleanupMock = mock(async () => {});
      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);

      await rebuildArtworkDatabase({
        db,
        adapters: [adapter],
        extractArtwork: async () => {
          throw new Error('fail');
        },
        cleanupAllTempArtwork: cleanupMock,
      } as unknown as RebuildDependencies);

      expect(cleanupMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('adapter artwork fallback (TASK-142)', () => {
    it('uses adapter.getArtwork() when extractArtwork returns null (e.g. directory sidecar)', async () => {
      const ipodTracks = [makeIpodTrack({ artist: 'Artist', title: 'Song', album: 'Album' })];
      const sourceTracks = [
        makeCollectionTrack({ artist: 'Artist', title: 'Song', album: 'Album' }),
      ];

      const sidecarBytes = Buffer.from('sidecar-cover-bytes');
      const adapter: CollectionAdapter = {
        name: 'fake-with-sidecar',
        adapterType: 'directory',
        connect: mock(async () => {}),
        getItems: mock(async () => sourceTracks),
        getFilteredItems: mock(async () => sourceTracks),
        getFileAccess: mock(
          (track: CollectionTrack): FileAccess => ({ type: 'path' as const, path: track.filePath })
        ),
        disconnect: mock(async () => {}),
        getArtwork: mock(async () => sidecarBytes),
      };

      const db = makeMockDb(ipodTracks);
      // extractArtwork returns null for every file (no embed) — repair must
      // fall back to the adapter to find the sidecar bytes.
      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter], async () => null));

      expect(result.matched).toBe(1);
      expect(result.noArtwork).toBe(0);
      expect(adapter.getArtwork).toHaveBeenCalledTimes(1);
      expect(db.setTrackArtworkFromData).toHaveBeenCalledTimes(1);
      // Verify the bytes that landed on the track are the adapter bytes.
      const [, dataArg] = db.setTrackArtworkFromData.mock.calls[0]!;
      expect((dataArg as Buffer).equals(sidecarBytes)).toBe(true);
    });

    it('clears artwork when neither extractArtwork nor adapter.getArtwork returns bytes', async () => {
      // Track starts with a stale `art=` in its syncTag — the no-art repair
      // path must clear it (calls db.updateTrack with a syncTag whose art= is
      // gone) so the next sync re-adds artwork rather than treating the track
      // as already-synced.
      const ipodTracks = [
        makeIpodTrack({
          artist: 'Artist',
          title: 'Song',
          album: 'Album',
          comment: '[podkit:v1 quality=high art=cafebabe]',
        }),
      ];
      const sourceTracks = [
        makeCollectionTrack({ artist: 'Artist', title: 'Song', album: 'Album' }),
      ];

      const adapter: CollectionAdapter = {
        name: 'fake-no-art',
        adapterType: 'directory',
        connect: mock(async () => {}),
        getItems: mock(async () => sourceTracks),
        getFilteredItems: mock(async () => sourceTracks),
        getFileAccess: mock(
          (track: CollectionTrack): FileAccess => ({ type: 'path' as const, path: track.filePath })
        ),
        disconnect: mock(async () => {}),
        getArtwork: mock(async () => null),
      };

      const db = makeMockDb(ipodTracks);
      const result = await rebuildArtworkDatabase(makeDeps(db, [adapter], async () => null));

      expect(result.matched).toBe(0);
      expect(result.noArtwork).toBe(1);
      expect(db.setTrackArtworkFromData).not.toHaveBeenCalled();
      // syncTag art= cleared via updateTrack (clearArtworkSyncTag)
      expect(db.updateTrack).toHaveBeenCalled();
      const lastUpdate = db.updateTrack.mock.calls.at(-1);
      expect(lastUpdate).toBeDefined();
      const [, fields] = lastUpdate as [unknown, { comment: string }];
      expect(fields.comment).toContain('[podkit:v1');
      expect(fields.comment).not.toMatch(/art=/);
    });
  });

  // ─── Source-file validity gate ────────────────────────────────────────────
  describe('source-file validity gate', () => {
    // The validity probe is real-filesystem (statSync/openSync/readSync), so
    // these tests write fixtures to a temp directory rather than mocking the
    // fs. The repair pipeline still uses the test extractArtwork stub so we
    // can isolate cache + bucketing behaviour from real audio parsing.
    function withTempCollection<T>(
      files: Record<string, Buffer>,
      fn: (dir: string) => Promise<T>
    ): Promise<T> {
      const dir = mkdtempSync(joinPath(tmpdir(), 'podkit-repair-validity-'));
      for (const [name, contents] of Object.entries(files)) {
        writeFileSync(joinPath(dir, name), contents);
      }
      return fn(dir).finally(() => {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      });
    }

    const FLAC_HEAD = Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(64, 0)]);

    it('places a corrupt source file in `errors` even when a sibling on the same album extracts successfully (album-cache cannot rescue it)', async () => {
      await withTempCollection(
        {
          'good-1.flac': FLAC_HEAD,
          'good-2.flac': FLAC_HEAD,
          'bad.flac': Buffer.from('NOT_A_VALID_FLAC_FILE'),
        },
        async (dir) => {
          const ipodTracks = [
            // Good tracks scan first so the album cache populates with a
            // positive entry before the bad track is visited. Without the
            // validity gate, the bad track would inherit the cached art and
            // land in `matched`.
            makeIpodTrack({ artist: 'Artist', title: 'Good One', album: 'Album' }),
            makeIpodTrack({ artist: 'Artist', title: 'Good Two', album: 'Album' }),
            makeIpodTrack({ artist: 'Artist', title: 'Bad', album: 'Album' }),
          ];
          const sourceTracks = [
            makeCollectionTrack({
              artist: 'Artist',
              title: 'Good One',
              album: 'Album',
              filePath: joinPath(dir, 'good-1.flac'),
            }),
            makeCollectionTrack({
              artist: 'Artist',
              title: 'Good Two',
              album: 'Album',
              filePath: joinPath(dir, 'good-2.flac'),
            }),
            makeCollectionTrack({
              artist: 'Artist',
              title: 'Bad',
              album: 'Album',
              filePath: joinPath(dir, 'bad.flac'),
            }),
          ];

          let extractCount = 0;
          const db = makeMockDb(ipodTracks);
          const adapter = makeAdapter(sourceTracks);
          // Use the real validity probe — override the default stub.
          const result = await rebuildArtworkDatabase(
            makeDeps(
              db,
              [adapter],
              async () => {
                extractCount++;
                return MOCK_ARTWORK;
              },
              { checkSourceFileValidity: undefined }
            )
          );

          expect(result.totalTracks).toBe(3);
          expect(result.matched).toBe(2);
          expect(result.noSource).toBe(0);
          expect(result.noArtwork).toBe(0);
          expect(result.errors).toBe(1);

          const detail = result.errorDetails[0]!;
          expect(detail.artist).toBe('Artist');
          expect(detail.title).toBe('Bad');
          expect(detail.path).toBe(joinPath(dir, 'bad.flac'));
          expect(detail.reason).toBe('badMagic');

          // Album-cache regression check: the two healthy tracks share an
          // album, so the cache must memoise — only the first healthy track
          // should hit extractArtwork. (The bad track never reaches extract
          // because the validity gate stops it earlier.)
          expect(extractCount).toBe(1);
        }
      );
    });

    it('places a missing source file in `errors` with reason=missing', async () => {
      // No collection directory — the source track points at a nonexistent
      // file. The validity gate stat()s the file, gets ENOENT, and emits a
      // missing-reason error without ever calling extractArtwork.
      const ipodTracks = [makeIpodTrack({ artist: 'Artist', title: 'Song', album: 'Album' })];
      const sourceTracks = [
        makeCollectionTrack({
          artist: 'Artist',
          title: 'Song',
          album: 'Album',
          filePath: '/this/path/does/not/exist/song.flac',
        }),
      ];

      let extractCount = 0;
      const db = makeMockDb(ipodTracks);
      const adapter = makeAdapter(sourceTracks);
      const result = await rebuildArtworkDatabase(
        makeDeps(
          db,
          [adapter],
          async () => {
            extractCount++;
            return MOCK_ARTWORK;
          },
          { checkSourceFileValidity: undefined }
        )
      );

      expect(result.errors).toBe(1);
      expect(result.matched).toBe(0);
      expect(result.errorDetails[0]!.reason).toBe('missing');
      expect(extractCount).toBe(0); // validity gate short-circuited before extract
    });
  });
});

// ── resetArtworkDatabase tests ──────────────────────────────────────────────

describe('resetArtworkDatabase', () => {
  it('removes artwork from all tracks and saves', async () => {
    const ipodTracks = [
      makeIpodTrack({ artist: 'A', title: 'S1', album: 'X' }),
      makeIpodTrack({ artist: 'B', title: 'S2', album: 'Y' }),
    ];

    const db = makeMockDb(ipodTracks);

    const result = await resetArtworkDatabase(
      db as unknown as Parameters<typeof resetArtworkDatabase>[0],
      '/tmp/fake-ipod'
    );

    expect(result.tracksCleared).toBe(2);
    expect(result.totalTracks).toBe(2);
    expect(db.removeTrackArtwork).toHaveBeenCalledTimes(2);
    expect(db.save).toHaveBeenCalledTimes(1);
  });

  it('clears artwork sync tags', async () => {
    const ipodTracks = [
      makeIpodTrack({
        artist: 'A',
        title: 'S1',
        album: 'X',
        comment: '[podkit:v1 quality=high art=deadbeef]',
      }),
    ];

    const db = makeMockDb(ipodTracks);

    await resetArtworkDatabase(
      db as unknown as Parameters<typeof resetArtworkDatabase>[0],
      '/tmp/fake-ipod'
    );

    expect(db.updateTrack).toHaveBeenCalledTimes(1);
    const fields = (db.updateTrack as ReturnType<typeof mock>).mock.calls[0]![1] as TrackFields;
    expect(fields.comment).toContain('quality=high');
    expect(fields.comment).not.toContain('art=');
  });

  it('does not mutate the database in dry run', async () => {
    const ipodTracks = [
      makeIpodTrack({ artist: 'A', title: 'S1', album: 'X', hasArtwork: true }),
      makeIpodTrack({ artist: 'B', title: 'S2', album: 'Y', hasArtwork: false }),
    ];

    const db = makeMockDb(ipodTracks);

    const result = await resetArtworkDatabase(
      db as unknown as Parameters<typeof resetArtworkDatabase>[0],
      '/tmp/fake-ipod',
      { dryRun: true }
    );

    expect(result.tracksCleared).toBe(1); // Only one has artwork
    expect(result.totalTracks).toBe(2);
    expect(db.removeTrackArtwork).not.toHaveBeenCalled();
    expect(db.updateTrack).not.toHaveBeenCalled();
    expect(db.save).not.toHaveBeenCalled();
  });

  it('handles empty iPod', async () => {
    const db = makeMockDb([]);

    const result = await resetArtworkDatabase(
      db as unknown as Parameters<typeof resetArtworkDatabase>[0],
      '/tmp/fake-ipod'
    );

    expect(result.tracksCleared).toBe(0);
    expect(result.totalTracks).toBe(0);
    expect(db.save).toHaveBeenCalledTimes(1);
  });
});
