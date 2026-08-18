/**
 * Unit tests for the shuffle playback-database diagnostic.
 *
 * Reproduces the shapes observed on real hardware and produced by the database
 * layer:
 *
 *   - A shuffle 2G whose iTunesDB gained 198 tracks while its iTunesSD stayed
 *     at the 18-byte empty stub. The device reported a successful sync and
 *     played nothing.
 *   - A device initialised with no model number, which the database layer gives
 *     an empty 104-byte `bdhs` — bigger than a *populated* 1G/2G file, and
 *     unreadable by 1G/2G firmware. Size alone identifies neither defect, so
 *     these tests pin the header parse.
 *
 * The check is deliberately read-only — it explains, it does not gate and it
 * does not repair — so these tests assert `repairable: false` throughout.
 */

import { describe, it, expect } from 'bun:test';
import type { SysInfoExtendedResult } from '@podkit/ipod-firmware';
import type { DiagnosticContext } from '../types.js';
import {
  checkShufflePlaybackDb,
  shufflePlaybackDbCheck,
  parseItunesSdHeader,
  expectedItunesSdFormat,
} from './shuffle-playback-db.js';
import type { ItunesSdFsReader } from './shuffle-playback-db.js';
import type { SieReader } from './firmware-truth.js';

const MOUNT = '/Volumes/IPOD';
const ITUNESSD = `${MOUNT}/iPod_Control/iTunes/iTunesSD`;

/** Real hardware: pink 1GB shuffle 2G. */
const SHUFFLE_2G_SERIAL = '6V925GZ9436';
/** Real hardware: 2GB purple shuffle 4G. */
const SHUFFLE_4G_SERIAL = 'CC4LXAVUF4T0';
/** Real hardware: nano 3G, for the negative case. */
const NANO_3G_SERIAL = '5U8280FNYXX';

/** Fixed size of a 1G/2G header and of one of its track records. */
const V1_HEADER_BYTES = 18;
const V1_RECORD_BYTES = 558;

/**
 * A 1G/2G header: big-endian 24-bit track count, then the two constants
 * libgpod writes (`0x010600`, and `0x12` for the header's own length).
 */
function v1Header(trackCount: number): Uint8Array {
  const bytes = new Uint8Array(V1_HEADER_BYTES);
  bytes[0] = (trackCount >> 16) & 0xff;
  bytes[1] = (trackCount >> 8) & 0xff;
  bytes[2] = trackCount & 0xff;
  bytes[3] = 0x01;
  bytes[4] = 0x06;
  bytes[8] = 0x12;
  return bytes;
}

/** A `bdhs` header: magic, then a little-endian 32-bit track count at 0x0C. */
function bdhsHeader(trackCount: number): Uint8Array {
  const bytes = new Uint8Array(18);
  bytes.set([0x62, 0x64, 0x68, 0x73], 0);
  new DataView(bytes.buffer).setUint32(12, trackCount, true);
  return bytes;
}

function makeCtx(db: { generation: string; trackCount: number } | undefined): DiagnosticContext {
  return {
    mountPoint: MOUNT,
    deviceType: 'ipod',
    ...(db
      ? {
          db: {
            device: { generation: db.generation, modelName: 'Unknown' },
            trackCount: db.trackCount,
          } as unknown as DiagnosticContext['db'],
        }
      : {}),
  };
}

/**
 * Describe the `iTunesSD` on disk: its header bytes and its total size.
 * `undefined` header means no file at all.
 */
function makeFs(file: { header: Uint8Array; size: number } | undefined): ItunesSdFsReader {
  const guard = (p: string): void => {
    if (p !== ITUNESSD || !file) throw new Error(`unexpected read: ${p}`);
  };
  return {
    existsSync: (p) => p === ITUNESSD && file !== undefined,
    sizeOf: (p) => {
      guard(p);
      return file!.size;
    },
    readHeader: (p, length) => {
      guard(p);
      return file!.header.subarray(0, length);
    },
  };
}

const sieReader =
  (serialNumber: string | null): SieReader =>
  () =>
    serialNumber
      ? ({
          present: true,
          source: 'existing',
          identity: { serialNumber },
          serialNumber,
        } satisfies SysInfoExtendedResult)
      : null;

describe('parseItunesSdHeader', () => {
  it('reads the track count of a 1G/2G header as a big-endian 24-bit value', () => {
    expect(parseItunesSdHeader(v1Header(198))).toEqual({ format: 'v1', trackCount: 198 });
    expect(parseItunesSdHeader(v1Header(0))).toEqual({ format: 'v1', trackCount: 0 });
    expect(parseItunesSdHeader(v1Header(0x010203))).toEqual({
      format: 'v1',
      trackCount: 0x010203,
    });
  });

  it('reads the track count of a bdhs header as a little-endian 32-bit value at 0x0C', () => {
    expect(parseItunesSdHeader(bdhsHeader(89))).toEqual({ format: 'bdhs', trackCount: 89 });
    expect(parseItunesSdHeader(bdhsHeader(0))).toEqual({ format: 'bdhs', trackCount: 0 });
  });

  it('rejects bytes that match neither layout', () => {
    // Right length, but without the constants a 1G/2G header always carries.
    expect(parseItunesSdHeader(new Uint8Array(V1_HEADER_BYTES))).toBeNull();
    // Truncated below either header.
    expect(parseItunesSdHeader(new Uint8Array(4))).toBeNull();
    expect(parseItunesSdHeader(new Uint8Array(0))).toBeNull();
  });
});

describe('expectedItunesSdFormat', () => {
  it('maps each shuffle generation to the layout its firmware reads', () => {
    // Both the podkit generation ids and the database layer's own strings —
    // the check works from whichever identified the device.
    expect(expectedItunesSdFormat('shuffle_1g')).toBe('v1');
    expect(expectedItunesSdFormat('shuffle_2')).toBe('v1');
    expect(expectedItunesSdFormat('shuffle_3g')).toBe('bdhs');
    expect(expectedItunesSdFormat('shuffle_4')).toBe('bdhs');
  });

  it('has no answer for a non-shuffle or an unplaced device', () => {
    expect(expectedItunesSdFormat('nano_3g')).toBeUndefined();
    expect(expectedItunesSdFormat('unknown')).toBeUndefined();
    expect(expectedItunesSdFormat('shuffle')).toBeUndefined();
  });
});

describe('shufflePlaybackDbCheck metadata', () => {
  it('is an iPod-only database-health diagnostic with no repair', () => {
    expect(shufflePlaybackDbCheck.id).toBe('shuffle-playback-db');
    expect(shufflePlaybackDbCheck.scope).toBe('database-health');
    expect(shufflePlaybackDbCheck.applicableTo).toEqual(['ipod']);
    expect(shufflePlaybackDbCheck.repair).toBeUndefined();
  });
});

describe('checkShufflePlaybackDb', () => {
  it('warns when a shuffle has tracks but only the empty iTunesSD stub', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'unknown', trackCount: 198 }),
      makeFs({ header: v1Header(0), size: V1_HEADER_BYTES }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain('198 track');
    expect(result.summary).toContain('empty');
    expect(result.details?.itunesSdBytes).toBe(V1_HEADER_BYTES);
    expect(result.details?.itunesSdPresent).toBe(true);
    expect(result.details?.itunesSdTrackCount).toBe(0);
  });

  it('warns when a shuffle has tracks and no iTunesSD at all', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'unknown', trackCount: 3 }),
      makeFs(undefined),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('warn');
    expect(result.details?.itunesSdPresent).toBe(false);
  });

  it('warns on a 1G/2G carrying the 3G/4G bdhs format, however large the file', async () => {
    // The state a model-less initialisation used to leave behind: an empty
    // bdhs, ~104 bytes — larger than a populated 1G/2G file's header, so a
    // size threshold reads it as healthy.
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'unknown', trackCount: 198 }),
      makeFs({ header: bdhsHeader(0), size: 104 }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('warn');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain('bdhs 3rd/4th-generation format');
    expect(result.summary).toContain('reads the flat 1st/2nd-generation format');
    expect(result.details?.itunesSdFormat).toBe('bdhs');
    expect(result.details?.expectedItunesSdFormat).toBe('v1');
  });

  it('warns about the wrong format even when the iTunesDB is empty', async () => {
    // The file is unreadable by this hardware whether or not anything has been
    // synced yet — that is a defect on its own terms, not a consequence of
    // having tracks.
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'unknown', trackCount: 0 }),
      makeFs({ header: bdhsHeader(0), size: 104 }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('warn');
    expect(result.details?.itunesSdFormat).toBe('bdhs');
  });

  it('accepts bdhs on a shuffle 4G, which is the format it reads', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'unknown', trackCount: 89 }),
      makeFs({ header: bdhsHeader(89), size: 34020 }),
      sieReader(SHUFFLE_4G_SERIAL)
    );
    expect(result.status).toBe('pass');
    expect(result.details?.itunesSdFormat).toBe('bdhs');
    expect(result.details?.itunesSdTrackCount).toBe(89);
  });

  it('passes when the iTunesSD indexes tracks', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'shuffle_2', trackCount: 3 }),
      makeFs({ header: v1Header(3), size: V1_HEADER_BYTES + V1_RECORD_BYTES * 3 }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('pass');
    expect(result.details?.trackCount).toBe(3);
    expect(result.details?.itunesSdTrackCount).toBe(3);
  });

  it('warns when the file is in no recognised format', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'shuffle_2', trackCount: 3 }),
      makeFs({ header: new Uint8Array(V1_HEADER_BYTES), size: 4096 }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('unreadable');
    expect(result.details?.itunesSdFormat).toBeUndefined();
  });

  it('skips a shuffle with no tracks and no playback database', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'shuffle_2', trackCount: 0 }),
      makeFs({ header: v1Header(0), size: V1_HEADER_BYTES }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('skip');
  });

  it('skips a device that is not a shuffle', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'nano_3', trackCount: 500 }),
      makeFs(undefined),
      sieReader(NANO_3G_SERIAL)
    );
    expect(result.status).toBe('skip');
  });

  it('falls back to the database-layer generation when there is no firmware truth', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'shuffle_1', trackCount: 10 }),
      makeFs({ header: v1Header(0), size: V1_HEADER_BYTES }),
      sieReader(null)
    );
    expect(result.status).toBe('warn');
  });

  it('reports emptiness but not format when the generation is unplaced', async () => {
    // No firmware truth, and a database layer that knows only "some shuffle":
    // which layout the hardware reads is unknowable, so only the emptiness
    // comparison is safe to make.
    const result = await checkShufflePlaybackDb(
      makeCtx({ generation: 'shuffle', trackCount: 10 }),
      makeFs({ header: bdhsHeader(0), size: 104 }),
      sieReader(null)
    );
    expect(result.status).toBe('warn');
    expect(result.summary).toContain('empty');
    expect(result.details?.expectedItunesSdFormat).toBeUndefined();
  });

  it('skips instead of throwing when the database handle is closed', async () => {
    // A real `IpodDatabase` exposes `device` and `trackCount` as getters that
    // throw once the handle is closed, and the check runner has no per-check
    // try/catch — a throw here would take down the whole doctor run instead of
    // skipping one check. The plain-object fakes above cannot express that, so
    // this case builds a handle whose getters actually throw.
    const closed = {
      get device(): never {
        throw new Error('Database is closed');
      },
      get trackCount(): never {
        throw new Error('Database is closed');
      },
    };
    const ctx: DiagnosticContext = {
      mountPoint: MOUNT,
      deviceType: 'ipod',
      db: closed as unknown as DiagnosticContext['db'],
    };

    const result = await checkShufflePlaybackDb(
      ctx,
      makeFs({ header: v1Header(0), size: V1_HEADER_BYTES }),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });

  it('skips when no database is open', async () => {
    const result = await checkShufflePlaybackDb(
      makeCtx(undefined),
      makeFs(undefined),
      sieReader(SHUFFLE_2G_SERIAL)
    );
    expect(result.status).toBe('skip');
  });
});
