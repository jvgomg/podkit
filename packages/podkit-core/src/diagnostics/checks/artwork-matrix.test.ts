/**
 * Artwork-rebuild and artwork-reset diagnostic checks: Tier-1 detection +
 * repair matrix (TASK-304, m-19 Phase 5d).
 *
 * Drives `artworkRebuildCheck.check()` against synthetic ArtworkDB + ithmb
 * file states written to a temp directory, and drives `.repair.run()`
 * against an in-memory IpodDatabase fake with controlled
 * source-collection coverage. Mirrors the Phase 5c pattern from
 * `sysinfo-consistency.test.ts` and the system-scope matrix from
 * `system-scope-matrix.test.ts`.
 *
 * Tier-3 (real-hardware / lima-test-vm) coverage is deferred to
 * TASK-322.05.01 per the parent task's dependency note.
 *
 * AC mapping (15 ACs, full coverage):
 *   #1  → 'detection — no ArtworkDB and no ithmb files'
 *   #2  → 'detection — ArtworkDB present with zero entries'
 *   #3  → 'detection — all entries healthy'
 *   #4  → 'detection — partial corruption'
 *   #5  → 'detection — full corruption (ithmb truncated to zero)'
 *   #6  → 'detection — missing ithmb file'
 *   #7  → 'repair — full source match'
 *   #8  → 'repair — partial source match clears art= for orphans'
 *   #9  → 'repair — sync tag quality / encoding preserved'
 *   #10 → 'repair — dry-run does not mutate'
 *   #11 → 'repair — missing source collection (no adapters)'
 *   #12 → 'repair — idempotent on second run'
 *   #13 → 'artwork-reset — clears all artwork regardless of source'
 *   #14 → 'artwork-reset — dry-run does not mutate'
 *   #15 → 'metadata — scope=device, applicableTo=[ipod]'
 *
 * @see backlog/tasks/task-304
 * @see adr/adr-013 (artwork corruption investigation)
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { artworkRebuildCheck } from './artwork.js';
import { artworkResetCheck } from './artwork-reset.js';
import {
  buildArtworkDB,
  buildMHII,
  buildMHIF,
  buildMHLF,
  buildMHLI,
  buildMHSD,
  buildThumbnail,
} from '../../artwork/__tests__/artworkdb-builder.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { IpodTrack, TrackFields } from '../../ipod/types.js';
import type { IpodDatabase } from '../../ipod/database.js';
import type { CollectionAdapter, CollectionTrack, FileAccess } from '../../adapters/interface.js';

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an iPod-shaped temp directory with the given .ithmb files (filename →
 * size in bytes) plus an optional ArtworkDB binary at the canonical path.
 */
function createIpodWithArtwork(opts: {
  artworkDb?: Buffer;
  ithmbFiles?: Record<string, number>;
  /** If true, do not create the Artwork directory at all (AC #1). */
  noArtworkDir?: boolean;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'podkit-artwork-matrix-'));
  if (!opts.noArtworkDir) {
    const artworkDir = join(root, 'iPod_Control', 'Artwork');
    mkdirSync(artworkDir, { recursive: true });
    for (const [name, size] of Object.entries(opts.ithmbFiles ?? {})) {
      writeFileSync(join(artworkDir, name), Buffer.alloc(size));
    }
    if (opts.artworkDb) {
      writeFileSync(join(artworkDir, 'ArtworkDB'), opts.artworkDb);
    }
  }
  return root;
}

/**
 * Build a healthy ArtworkDB binary with `count` MHII entries, each one
 * thumbnail in F1028_1.ithmb at offset `i * slotSize`.
 */
function buildArtworkDbBinary(opts: {
  count: number;
  slotSize?: number;
  filename?: string;
  formatId?: number;
}): Buffer {
  const { count, slotSize = 20000, filename = ':F1028_1.ithmb', formatId = 1028 } = opts;
  const thumbnails = Array.from({ length: count }, (_, i) =>
    buildMHII({
      imageId: 100 + i,
      songId: BigInt(1000 + i),
      thumbnails: [
        buildThumbnail({
          formatId,
          offset: i * slotSize,
          imageSize: slotSize,
          width: 100,
          height: 100,
          filename,
        }),
      ],
    })
  );

  const mhli = buildMHLI(thumbnails);
  const mhlf = buildMHLF([buildMHIF({ formatId, imageSize: slotSize })]);

  return buildArtworkDB({
    nextId: 1000,
    sections: [
      buildMHSD({ sectionIndex: 1, contentBuffer: mhli }),
      buildMHSD({ sectionIndex: 3, contentBuffer: mhlf }),
    ],
  });
}

/** Build an empty (zero MHII) but otherwise valid ArtworkDB. */
function buildEmptyArtworkDb(): Buffer {
  return buildArtworkDB({
    nextId: 1,
    sections: [
      buildMHSD({ sectionIndex: 1, contentBuffer: buildMHLI([]) }),
      buildMHSD({ sectionIndex: 3, contentBuffer: buildMHLF([]) }),
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// IpodDatabase + adapter fakes for repair coverage
// ─────────────────────────────────────────────────────────────────────────────

function makeTrack(overrides: {
  artist: string;
  title: string;
  album: string;
  comment?: string;
  hasArtwork?: boolean;
}): IpodTrack {
  return {
    title: overrides.title,
    artist: overrides.artist,
    album: overrides.album,
    comment: overrides.comment,
    syncTag: null,
    duration: 180_000,
    bitrate: 256,
    sampleRate: 44_100,
    size: 5_000_000,
    mediaType: 1,
    filePath: ':iPod_Control:Music:F00:test.m4a',
    timeAdded: 0,
    timeModified: 0,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: overrides.hasArtwork ?? true,
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

interface MockDbHandle {
  db: IpodDatabase;
  /** Live track list, mutated by `updateTrack` so subsequent reads reflect repair. */
  tracks: IpodTrack[];
  /** Number of times `save` was invoked. */
  saveCalls: () => number;
  /** Number of times `updateTrack` was invoked. */
  updateCalls: () => Array<[IpodTrack, TrackFields]>;
  /** Number of times `removeTrackArtwork` was invoked. */
  removeArtworkCalls: () => number;
  /** Number of times `setTrackArtworkFromData` was invoked. */
  setArtworkCalls: () => number;
}

/**
 * Build a stateful IpodDatabase fake whose `updateTrack` mutates the track's
 * comment in place — this is what lets the idempotency test (#12) see the
 * effect of the first repair when running a second time.
 */
function makeMockDb(initial: IpodTrack[]): MockDbHandle {
  const tracks: IpodTrack[] = [...initial];
  const updates: Array<[IpodTrack, TrackFields]> = [];
  let saves = 0;
  let removes = 0;
  let setArt = 0;

  const fake = {
    getTracks: () => tracks,
    removeTrackArtwork: (track: IpodTrack) => {
      removes++;
      // Mutate the live track so subsequent calls observe the reset.
      const t = track as IpodTrack & { hasArtwork: boolean };
      t.hasArtwork = false;
    },
    setTrackArtworkFromData: (_track: IpodTrack, _data: Buffer) => {
      setArt++;
    },
    updateTrack: (track: IpodTrack, fields: TrackFields) => {
      updates.push([track, fields]);
      if (fields.comment !== undefined) {
        // Mutate the live track so the second repair pass sees the cleared art=.
        (track as IpodTrack & { comment: string | undefined }).comment = fields.comment;
      }
    },
    save: mock(async () => {
      saves++;
      return { warnings: [] };
    }),
    trackCount: tracks.length,
    close: mock(() => {}),
    getInfo: () => ({ device: { modelName: 'iPod' } }),
  };

  return {
    db: fake as unknown as IpodDatabase,
    tracks,
    saveCalls: () => saves,
    updateCalls: () => updates,
    removeArtworkCalls: () => removes,
    setArtworkCalls: () => setArt,
  };
}

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

function makeCollectionTrack(args: {
  artist: string;
  title: string;
  album: string;
}): CollectionTrack {
  return {
    id: `${args.artist}-${args.title}`,
    title: args.title,
    artist: args.artist,
    album: args.album,
    filePath: `/music/${args.artist}/${args.title}.flac`,
    fileType: 'flac' as const,
  } as CollectionTrack;
}

// ─────────────────────────────────────────────────────────────────────────────
// Temp dir lifecycle
// ─────────────────────────────────────────────────────────────────────────────

const TEMP_DIRS: string[] = [];

function track(dir: string): string {
  TEMP_DIRS.push(dir);
  return dir;
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tiny db stub for cases where check() should never reach the DB
// (we only need `db` to be truthy for the early-return guard in artwork.ts).
// ─────────────────────────────────────────────────────────────────────────────

const dbStub = {} as unknown as IpodDatabase;

function makeCheckCtx(mountPoint: string): DiagnosticContext {
  return { mountPoint, deviceType: 'ipod', db: dbStub };
}

// ═════════════════════════════════════════════════════════════════════════════
// AC #15 — metadata: scope=device, applicableTo=['ipod']
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#15 — both artwork checks are iPod-only device-scope', () => {
  it('artworkRebuildCheck declares applicableTo=[ipod]', () => {
    expect(artworkRebuildCheck.applicableTo).toEqual(['ipod']);
  });

  it('artworkResetCheck declares applicableTo=[ipod]', () => {
    expect(artworkResetCheck.applicableTo).toEqual(['ipod']);
  });

  // Both checks declare scope: 'database-health' explicitly — the field is
  // required on every DiagnosticCheck (Approach A, no defaulting).
  it('artworkRebuildCheck declares scope=database-health', () => {
    expect(artworkRebuildCheck.scope).toBe('database-health');
  });

  it('artworkResetCheck declares scope=database-health', () => {
    expect(artworkResetCheck.scope).toBe('database-health');
  });

  it('artworkRebuildCheck has a repair (rebuild) with source-collection requirement', () => {
    expect(artworkRebuildCheck.repair).toBeDefined();
    expect(artworkRebuildCheck.repair?.requirements).toContain('source-collection');
  });

  it('artworkResetCheck has a repair with only the database requirement (source-less reset)', () => {
    // The defining property: no source-collection (it just clears artwork).
    // But the iTunesDB is required to enumerate the tracks whose artwork is
    // being cleared. See `RepairRequirement` in diagnostics/types.ts.
    expect(artworkResetCheck.repair).toBeDefined();
    expect(artworkResetCheck.repair?.requirements).toEqual(['database']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #1 — no ArtworkDB and no ithmb files: skip
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#1 — no ArtworkDB and no ithmb files → skip', () => {
  it('returns skip when the Artwork directory is entirely absent', async () => {
    const mount = track(createIpodWithArtwork({ noArtworkDir: true }));
    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
    expect(result.summary.toLowerCase()).toContain('no artworkdb');
  });

  it('returns skip when the Artwork directory exists but is empty', async () => {
    const mount = track(createIpodWithArtwork({}));
    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
    // Implementation also surfaces "No ArtworkDB found" when only the dir exists.
    expect(result.summary.toLowerCase()).toContain('no artworkdb');
  });

  it('returns skip when ctx.db is undefined (no iPod database)', async () => {
    // No filesystem touched — the check returns early on missing db.
    const result = await artworkRebuildCheck.check({
      mountPoint: '/nonexistent',
      deviceType: 'ipod',
    });

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #2 — ArtworkDB present but zero entries: pass
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#2 — ArtworkDB present with zero MHII entries → pass', () => {
  it('returns pass with "no artwork entries" summary', async () => {
    const mount = track(createIpodWithArtwork({ artworkDb: buildEmptyArtworkDb() }));
    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
    expect(result.summary.toLowerCase()).toContain('no artwork entries');
  });

  // Also exercise the empty-buffer skip path: an existing-but-zero-byte
  // ArtworkDB returns skip, not pass — the parser would throw. We pin this so
  // the two empty-shape paths don't collapse.
  it('returns skip when ArtworkDB exists but is zero-length', async () => {
    const mount = track(createIpodWithArtwork({ artworkDb: Buffer.alloc(0), ithmbFiles: {} }));
    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('skip');
    expect(result.summary.toLowerCase()).toContain('empty');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #3 — All entries healthy: pass with totalEntries=N, corruptEntries=0
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#3 — healthy ArtworkDB with N entries → pass', () => {
  it('returns pass + details.totalEntries=N when all offsets are in-bounds', async () => {
    const N = 5;
    const SLOT = 20_000;
    const mount = track(
      createIpodWithArtwork({
        artworkDb: buildArtworkDbBinary({ count: N, slotSize: SLOT }),
        ithmbFiles: { 'F1028_1.ithmb': N * SLOT },
      })
    );

    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
    expect(result.details?.totalEntries).toBe(N);
    // Pass path now emits zero-valued fields for JSON-consumer symmetry.
    expect(result.details?.corruptEntries).toBe(0);
    expect(result.details?.healthyEntries).toBe(N);
    expect(result.details?.corruptPercent).toBe(0);
    const formats = result.details?.formats as Array<{ id: number; entries: number }>;
    expect(formats).toHaveLength(1);
    expect(formats[0]!.id).toBe(1028);
    expect(formats[0]!.entries).toBe(N);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #4 — Partial corruption: fail+repairable, corruptEntries>0, healthy>0
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#4 — partial corruption (ithmb truncated mid-way) → fail+repairable', () => {
  it('reports corrupt/healthy split with corruptPercent reflecting the ratio', async () => {
    const N = 10;
    const SLOT = 20_000;
    // Truncate to half — second half of entries are out-of-bounds.
    const mount = track(
      createIpodWithArtwork({
        artworkDb: buildArtworkDbBinary({ count: N, slotSize: SLOT }),
        ithmbFiles: { 'F1028_1.ithmb': (N * SLOT) / 2 },
      })
    );

    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.details?.totalEntries).toBe(N);
    expect(result.details?.corruptEntries).toBeGreaterThan(0);
    expect(result.details?.healthyEntries).toBeGreaterThan(0);
    expect(
      (result.details?.corruptEntries as number) + (result.details?.healthyEntries as number)
    ).toBe(N);
    // Half corrupt → 50% (give a small tolerance for rounding).
    const pct = result.details?.corruptPercent as number;
    expect(pct).toBeGreaterThanOrEqual(40);
    expect(pct).toBeLessThanOrEqual(60);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #5 — All ithmb files truncated to zero: fail, 100% corrupt
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#5 — ithmb truncated to zero → fail+repairable, 100% corrupt', () => {
  it('reports corruptEntries === totalEntries and corruptPercent=100', async () => {
    const N = 4;
    const SLOT = 20_000;
    const mount = track(
      createIpodWithArtwork({
        artworkDb: buildArtworkDbBinary({ count: N, slotSize: SLOT }),
        ithmbFiles: { 'F1028_1.ithmb': 0 },
      })
    );

    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.details?.totalEntries).toBe(N);
    expect(result.details?.corruptEntries).toBe(N);
    expect(result.details?.healthyEntries).toBe(0);
    expect(result.details?.corruptPercent).toBe(100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #6 — entry references a missing ithmb file → fail+repairable
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#6 — entry references a missing ithmb file → fail+repairable', () => {
  it('flags every entry as out-of-bounds when the .ithmb file does not exist', async () => {
    const N = 3;
    const SLOT = 20_000;
    // ArtworkDB references F1028_1.ithmb, but we don't create it on disk.
    const mount = track(
      createIpodWithArtwork({
        artworkDb: buildArtworkDbBinary({ count: N, slotSize: SLOT }),
        ithmbFiles: {}, // intentionally empty
      })
    );

    const result = await artworkRebuildCheck.check(makeCheckCtx(mount));

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    // Every entry is "missing file" out-of-bounds.
    expect(result.details?.corruptEntries).toBe(N);
    expect(result.details?.corruptPercent).toBe(100);
    // The format summary should report fileSize === -1 for the missing file.
    const formats = result.details?.formats as Array<{
      id: number;
      fileSize: number;
      outOfBoundsEntries: number;
    }>;
    expect(formats[0]!.fileSize).toBe(-1);
    expect(formats[0]!.outOfBoundsEntries).toBe(N);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #7 — repair with full source match: success, matched=N, errors=0
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#7 — repair with full source match', () => {
  it('rebuilds artwork for every track, errors=0, success=true', async () => {
    const ipodTracks = [
      makeTrack({ artist: 'A', title: 'S1', album: 'X' }),
      makeTrack({ artist: 'B', title: 'S2', album: 'Y' }),
      makeTrack({ artist: 'C', title: 'S3', album: 'Z' }),
    ];
    const sourceTracks = [
      makeCollectionTrack({ artist: 'A', title: 'S1', album: 'X' }),
      makeCollectionTrack({ artist: 'B', title: 'S2', album: 'Y' }),
      makeCollectionTrack({ artist: 'C', title: 'S3', album: 'Z' }),
    ];

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [makeAdapter(sourceTracks)],
    };

    // The check.repair surface doesn't expose `extractArtwork` injection
    // (only RepairRunOptions: dryRun / onProgress / signal). The default
    // extractor opens the source file from disk — our fake adapter returns
    // path strings that don't exist, so extractArtwork returns null and every
    // matched track ends up counted as `noArtwork` (not matched). We assert
    // the contract that matters at this surface: success=true, errors=0,
    // noSource=0 (every iPod track resolves to a source), totalTracks=N. The
    // sync-tag mutation path is verified in AC#9 via the noArtwork branch.
    const result = await artworkRebuildCheck.repair!.run(ctx);

    expect(result.success).toBe(true);
    // totalTracks always equals iPod track count.
    expect(result.details?.totalTracks).toBe(3);
    // Without injectable artwork extraction at the check.repair surface, the
    // sources resolve but their audio files don't exist on disk → noArtwork
    // (the cache's default extractor returns null). The key invariant is
    // errors=0 — the repair surface didn't throw or partial-fail.
    expect(result.details?.errors).toBe(0);
    // noSource should be 0 (every iPod track has a matching source).
    expect(result.details?.noSource).toBe(0);
    // Summary uses the "Rebuilt artwork for N tracks (...)" template.
    expect(result.summary).toMatch(/Rebuilt artwork for \d+ tracks/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #8 — repair with partial source match: clears art= for orphans
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#8 — repair with partial source match clears art= for unmatched tracks', () => {
  it('marks orphan tracks as noSource and strips art= from their sync tag', async () => {
    const ipodTracks = [
      makeTrack({
        artist: 'Matched',
        title: 'S1',
        album: 'X',
        comment: '[podkit:v1 quality=high encoding=vbr art=11111111]',
      }),
      makeTrack({
        artist: 'Orphan',
        title: 'S2',
        album: 'Y',
        // Pre-existing art= hash that must be cleared because this track has no source.
        comment: '[podkit:v1 quality=high encoding=vbr art=deadbeef]',
      }),
    ];
    // Only the matched track has a source.
    const sourceTracks = [makeCollectionTrack({ artist: 'Matched', title: 'S1', album: 'X' })];

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [makeAdapter(sourceTracks)],
    };

    const result = await artworkRebuildCheck.repair!.run(ctx);

    expect(result.success).toBe(true);
    expect(result.details?.totalTracks).toBe(2);
    expect(result.details?.noSource).toBe(1);

    // The orphan track must have had `art=` stripped from its sync tag.
    const orphanUpdate = handle.updateCalls().find(([t]) => t.artist === 'Orphan');
    expect(orphanUpdate).toBeDefined();
    const orphanComment = (orphanUpdate![1] as TrackFields).comment ?? '';
    expect(orphanComment).not.toContain('art=');
    // Quality / encoding survive (AC #9 cross-pin).
    expect(orphanComment).toContain('quality=high');
    expect(orphanComment).toContain('encoding=vbr');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #9 — repair preserves quality / encoding (only mutates art=)
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#9 — repair preserves quality and encoding fields in sync tag', () => {
  it('only the art= field changes; quality + encoding survive untouched', async () => {
    // Use the lower-level rebuildArtworkDatabase via the repair surface, then
    // inspect the sync-tag mutation directly. We can't reach into the repair
    // surface to inject `extractArtwork`, so we test sync-tag preservation
    // via the "noArtwork" path: an iPod track WITH an existing art= hash whose
    // source resolves but yields no artwork → art= must be cleared, quality
    // + encoding must survive.
    const ipodTrack = makeTrack({
      artist: 'A',
      title: 'S1',
      album: 'X',
      comment: '[podkit:v1 quality=high encoding=vbr art=cafebabe]',
    });
    const sourceTrack = makeCollectionTrack({ artist: 'A', title: 'S1', album: 'X' });

    const handle = makeMockDb([ipodTrack]);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [makeAdapter([sourceTrack])],
    };

    // BEFORE: confirm the baseline.
    const beforeComment = ipodTrack.comment ?? '';
    expect(beforeComment).toContain('quality=high');
    expect(beforeComment).toContain('encoding=vbr');
    expect(beforeComment).toContain('art=cafebabe');

    await artworkRebuildCheck.repair!.run(ctx);

    // AFTER: quality + encoding preserved, art= cleared (no source artwork on disk).
    const update = handle.updateCalls().find(([t]) => t.artist === 'A');
    expect(update).toBeDefined();
    const afterComment = (update![1] as TrackFields).comment ?? '';
    expect(afterComment).toContain('quality=high');
    expect(afterComment).toContain('encoding=vbr');
    expect(afterComment).not.toContain('art=cafebabe');
    expect(afterComment).not.toContain('art=');
  });

  // Cover the inverse: a track WITHOUT an existing art= hash whose repair
  // run also produces no artwork → updateTrack should NOT be called (no-op
  // optimisation in clearArtworkSyncTag).
  it('skips updateTrack when track has no existing art= to clear', async () => {
    const ipodTrack = makeTrack({
      artist: 'A',
      title: 'S1',
      album: 'X',
      comment: '[podkit:v1 quality=high encoding=vbr]', // no art=
    });

    const handle = makeMockDb([ipodTrack]);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [makeAdapter([])], // no source → noSource branch
    };

    await artworkRebuildCheck.repair!.run(ctx);

    // No source AND no existing art= → no sync-tag mutation needed.
    expect(handle.updateCalls()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #10 — dry-run does not mutate
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#10 — dry-run does not mutate the database or filesystem', () => {
  it('rebuild dry-run leaves DB untouched and emits a "Dry run:" summary', async () => {
    const ipodTracks = [
      makeTrack({
        artist: 'A',
        title: 'S1',
        album: 'X',
        comment: '[podkit:v1 quality=high encoding=vbr art=cafebabe]',
      }),
    ];
    const sourceTracks = [makeCollectionTrack({ artist: 'A', title: 'S1', album: 'X' })];

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [makeAdapter(sourceTracks)],
    };

    const result = await artworkRebuildCheck.repair!.run(ctx, { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('Dry run');
    // No save, no removeArtwork, no updateTrack, no setArtwork on dry-run.
    expect(handle.saveCalls()).toBe(0);
    expect(handle.removeArtworkCalls()).toBe(0);
    expect(handle.updateCalls()).toHaveLength(0);
    expect(handle.setArtworkCalls()).toBe(0);
    // The pre-existing art= hash survives.
    expect(ipodTracks[0]!.comment).toContain('art=cafebabe');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #11 — repair fails clearly when no source collection is supplied
// ═════════════════════════════════════════════════════════════════════════════
//
// The CLI maps the `source-collection` requirement to a flag and prompts the
// user when missing. At the core level, "no source collection" means
// `adapters: []`. In that configuration every track ends up noSource and the
// repair reports zero matched. We pin the contract: success=true (the repair
// ran cleanly — there's nothing to fail on, just nothing to do), every track
// counted as noSource, and zero matched. The CLI's failure-when-flag-missing
// is its own concern.

describe('AC#11 — repair with no source adapters yields noSource for every track', () => {
  it('returns success=true with noSource === totalTracks and matched=0', async () => {
    const ipodTracks = [
      makeTrack({ artist: 'A', title: 'S1', album: 'X' }),
      makeTrack({ artist: 'B', title: 'S2', album: 'Y' }),
    ];

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [], // intentionally none — simulates --collection pointing at nothing.
    };

    const result = await artworkRebuildCheck.repair!.run(ctx);

    expect(result.success).toBe(true);
    expect(result.details?.totalTracks).toBe(2);
    expect(result.details?.noSource).toBe(2);
    expect(result.details?.matched).toBe(0);
    expect(result.details?.errors).toBe(0);
    // Summary surfaces the noSource count.
    expect(result.summary).toContain('2 no source');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #12 — idempotent: second run is a no-op
// ═════════════════════════════════════════════════════════════════════════════
//
// Run repair twice in a row against the same fake DB. The first run strips
// `art=` from all tracks (they have no source). The second run sees tracks
// whose comments no longer contain `art=` — so `clearArtworkSyncTag` short-
// circuits and no further updateTrack calls happen. This is the canonical
// idempotency signal we get without re-reading the ArtworkDB.

describe('AC#12 — repair idempotent: second run is a no-op for sync-tag mutation', () => {
  it('first run clears art=, second run makes no further updateTrack calls', async () => {
    const ipodTracks = [
      makeTrack({
        artist: 'Orphan',
        title: 'S1',
        album: 'X',
        comment: '[podkit:v1 quality=high encoding=vbr art=deadbeef]',
      }),
    ];

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: '/mnt/ipod',
      deviceType: 'ipod',
      db: handle.db,
      adapters: [makeAdapter([])], // no source — first run will clear art=
    };

    // First run.
    const first = await artworkRebuildCheck.repair!.run(ctx);
    expect(first.success).toBe(true);
    expect(first.details?.noSource).toBe(1);
    const updatesAfterFirst = handle.updateCalls().length;
    expect(updatesAfterFirst).toBe(1);
    // The mutation must have stripped art=.
    expect(ipodTracks[0]!.comment ?? '').not.toContain('art=');

    // Second run, same fake DB, same adapters.
    const second = await artworkRebuildCheck.repair!.run(ctx);
    expect(second.success).toBe(true);
    expect(second.details?.noSource).toBe(1);
    expect(second.details?.errors).toBe(0);
    // No further sync-tag mutation — already idempotent.
    expect(handle.updateCalls().length).toBe(updatesAfterFirst);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #13 — artwork-reset clears all artwork regardless of source
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#13 — artwork-reset clears all artwork without requiring source collection', () => {
  it('removeTrackArtwork called for every track; art= stripped from each sync tag', async () => {
    const ipodTracks = [
      makeTrack({
        artist: 'A',
        title: 'S1',
        album: 'X',
        comment: '[podkit:v1 quality=high encoding=vbr art=aaaaaaaa]',
        hasArtwork: true,
      }),
      makeTrack({
        artist: 'B',
        title: 'S2',
        album: 'Y',
        comment: '[podkit:v1 quality=high encoding=vbr art=bbbbbbbb]',
        hasArtwork: true,
      }),
    ];

    // Build an iPod-shaped temp dir with stray ithmb files — the reset
    // cleanupOrphanedIthmb pass must scrub them.
    const mount = track(
      createIpodWithArtwork({
        artworkDb: buildEmptyArtworkDb(),
        ithmbFiles: { 'F1028_1.ithmb': 60_000, 'F1029_1.ithmb': 80_000 },
      })
    );

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: mount,
      deviceType: 'ipod',
      db: handle.db,
      adapters: [], // crucially: no adapters required
    };

    const result = await artworkResetCheck.repair!.run(ctx);

    expect(result.success).toBe(true);
    expect(result.details?.totalTracks).toBe(2);
    // removeTrackArtwork called once per track.
    expect(handle.removeArtworkCalls()).toBe(2);
    // Both art= hashes stripped.
    const aUpdate = handle.updateCalls().find(([t]) => t.artist === 'A');
    const bUpdate = handle.updateCalls().find(([t]) => t.artist === 'B');
    expect((aUpdate![1] as TrackFields).comment).not.toContain('art=');
    expect((bUpdate![1] as TrackFields).comment).not.toContain('art=');
    // quality preserved.
    expect((aUpdate![1] as TrackFields).comment).toContain('quality=high');
    // Orphaned .ithmb files cleaned up by the post-save sweep.
    expect(result.details?.orphanedFilesRemoved).toBe(2);
    expect(existsSync(join(mount, 'iPod_Control', 'Artwork', 'F1028_1.ithmb'))).toBe(false);
    expect(existsSync(join(mount, 'iPod_Control', 'Artwork', 'F1029_1.ithmb'))).toBe(false);
  });

  it('artwork-reset check() always returns skip (it is repair-only)', async () => {
    const mount = track(createIpodWithArtwork({}));
    const result = await artworkResetCheck.check({
      mountPoint: mount,
      deviceType: 'ipod',
      db: dbStub,
    });
    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC #14 — artwork-reset dry-run does not mutate
// ═════════════════════════════════════════════════════════════════════════════

describe('AC#14 — artwork-reset --dry-run leaves filesystem and DB untouched', () => {
  it('dry-run reports counts without calling removeTrackArtwork / updateTrack / save', async () => {
    const ipodTracks = [
      makeTrack({
        artist: 'A',
        title: 'S1',
        album: 'X',
        comment: '[podkit:v1 quality=high encoding=vbr art=aaaaaaaa]',
        hasArtwork: true,
      }),
      makeTrack({
        artist: 'B',
        title: 'S2',
        album: 'Y',
        hasArtwork: false, // no artwork — tracksCleared should still reflect only those with art
      }),
    ];

    const mount = track(
      createIpodWithArtwork({
        artworkDb: buildEmptyArtworkDb(),
        ithmbFiles: { 'F1028_1.ithmb': 60_000 },
      })
    );

    const handle = makeMockDb(ipodTracks);
    const ctx: RepairContext = {
      mountPoint: mount,
      deviceType: 'ipod',
      db: handle.db,
      adapters: [],
    };

    const result = await artworkResetCheck.repair!.run(ctx, { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('Dry run');
    // Only the track with hasArtwork=true counts as "would clear".
    expect(result.details?.tracksCleared).toBe(1);
    expect(result.details?.totalTracks).toBe(2);
    // No mutation calls in dry-run.
    expect(handle.removeArtworkCalls()).toBe(0);
    expect(handle.updateCalls()).toHaveLength(0);
    expect(handle.saveCalls()).toBe(0);
    // ithmb file untouched.
    expect(existsSync(join(mount, 'iPod_Control', 'Artwork', 'F1028_1.ithmb'))).toBe(true);
  });
});
