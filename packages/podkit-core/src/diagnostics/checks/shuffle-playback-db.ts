/**
 * Shuffle playback-database presence check.
 *
 * An iPod shuffle does not play from the `iTunesDB`. It plays from
 * `iPod_Control/iTunes/iTunesSD` — a separate, much simpler index written
 * alongside it. The `iTunesDB` carries the metadata; the `iTunesSD` is what the
 * firmware actually reads at play time.
 *
 * That split makes a very quiet failure possible: a sync can populate the
 * `iTunesDB`, copy every audio file, report success, and leave the `iTunesSD`
 * untouched. The user gets a full device that plays nothing and blinks an
 * error, with no diagnostic anywhere pointing at the cause. This check turns
 * that into one line of output.
 *
 * There are two ways to end up unplayable, and this check distinguishes them,
 * because a file's *size* alone tells you neither:
 *
 *   - **Empty** — the file indexes no tracks while the `iTunesDB` holds some.
 *   - **Wrong format** — the file is the `bdhs` container of a shuffle 3G/4G
 *     on a 1G/2G, which reads only the flat fixed-record format. An empty
 *     `bdhs` is ~104 bytes, comfortably larger than a *populated* 1G/2G file's
 *     18-byte header, so both defects are read out of the header itself.
 *
 * It is a **diagnostic, not a gate**. It reports the state it finds; it does
 * not block anything and it does not repair. The underlying cause is almost
 * always an identity one — the database layer could not tell the device was a
 * shuffle, so it skipped the write, or could not tell *which* shuffle, so it
 * wrote the wrong format — which `sysinfo-modelnum-missing` detects and
 * repairs. That repair saves the database with the corrected identity in
 * place, which writes the file there and then.
 *
 * @module
 */

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSieReader, resolveFirmwareTruth, type SieReader } from './firmware-truth.js';
import { readDatabaseDeviceView, readDatabaseTrackCount } from './database-device-view.js';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

/** Relative path of the shuffle playback database. */
const ITUNESSD_PATH = join('iPod_Control', 'iTunes', 'iTunesSD');

// ── Header parsing ───────────────────────────────────────────────────────────

/**
 * Which of the two `iTunesSD` layouts a file is in.
 *
 * - `v1`   — shuffle 1G/2G. An 18-byte header followed by fixed-size records.
 * - `bdhs` — shuffle 3G/4G. A `bdhs`-magic container of length-prefixed
 *   regions.
 */
export type ItunesSdFormat = 'v1' | 'bdhs';

/** What the header of an `iTunesSD` says about itself. */
export interface ItunesSdHeader {
  format: ItunesSdFormat;
  /** Number of tracks the file indexes. */
  trackCount: number;
}

/** Bytes of a header worth reading — the larger of the two layouts' headers. */
const HEADER_BYTES = 18;

/** How each layout is named in output written for a person. */
const FORMAT_LABEL: Record<ItunesSdFormat, string> = {
  v1: 'the flat 1st/2nd-generation format',
  bdhs: 'the bdhs 3rd/4th-generation format',
};

/**
 * Read an `iTunesSD` header.
 *
 * Both layouts are written by libgpod's `itdb_shuffle_write_file`:
 *
 *   - **v1** opens with a big-endian 24-bit track count, then the constants
 *     `0x010600` and `0x000012` (the header's own 18-byte length). Those two
 *     constants are what distinguishes a real v1 header from arbitrary bytes.
 *   - **bdhs** opens with its 4-byte magic and carries a little-endian 32-bit
 *     track count at offset 12.
 *
 * @returns `null` when the bytes match neither layout.
 */
export function parseItunesSdHeader(bytes: Uint8Array): ItunesSdHeader | null {
  const byteAt = (index: number): number => bytes[index] ?? 0;
  const beUint24 = (offset: number): number =>
    (byteAt(offset) << 16) | (byteAt(offset + 1) << 8) | byteAt(offset + 2);

  // 'bdhs'
  if (
    bytes.length >= 16 &&
    byteAt(0) === 0x62 &&
    byteAt(1) === 0x64 &&
    byteAt(2) === 0x68 &&
    byteAt(3) === 0x73
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: 'bdhs', trackCount: view.getUint32(12, true) };
  }

  if (bytes.length >= HEADER_BYTES && beUint24(3) === 0x010600 && beUint24(6) === HEADER_BYTES) {
    return { format: 'v1', trackCount: beUint24(0) };
  }

  return null;
}

/**
 * The `iTunesSD` layout a generation's firmware reads, or `undefined` when the
 * generation is not a shuffle or is not known precisely enough to say.
 *
 * Accepts both podkit generation ids (`shuffle_2g`) and the database layer's
 * own generation strings (`shuffle_2`) — the check has to work from whichever
 * of the two identified the device.
 */
export function expectedItunesSdFormat(generation: string): ItunesSdFormat | undefined {
  const ordinal = /^shuffle_(\d)/.exec(generation)?.[1];
  if (ordinal === '1' || ordinal === '2') return 'v1';
  if (ordinal === '3' || ordinal === '4') return 'bdhs';
  return undefined;
}

// ── Filesystem seam ──────────────────────────────────────────────────────────

/** Filesystem seam so tests can describe a device without creating one. */
export interface ItunesSdFsReader {
  existsSync(path: string): boolean;
  sizeOf(path: string): number;
  /** The file's first `length` bytes — fewer if the file is shorter. */
  readHeader(path: string, length: number): Uint8Array;
}

const defaultFsReader: ItunesSdFsReader = {
  existsSync,
  sizeOf: (p) => statSync(p).size,
  readHeader: (p, length) => {
    const fd = openSync(p, 'r');
    try {
      const buffer = new Uint8Array(length);
      const read = readSync(fd, buffer, 0, length, 0);
      return buffer.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  },
};

/**
 * Decide whether this device is a shuffle, and which one.
 *
 * Firmware truth first — the database layer's own generation is unreliable
 * here by construction, since a shuffle it failed to identify is precisely the
 * case this check exists for. Its answer is still worth consulting as a
 * fallback for devices with no readable `SysInfoExtended`.
 */
function isShuffle(
  ctx: DiagnosticContext,
  databaseGeneration: string,
  sieReader: SieReader
): { shuffle: boolean; generation: string; displayName?: string } {
  const truth = resolveFirmwareTruth(ctx.mountPoint, ctx.liveIdentity, sieReader);
  if (truth) {
    return {
      shuffle: truth.model.family === 'iPod shuffle',
      generation: truth.model.generationId,
      displayName: truth.model.displayName,
    };
  }
  return { shuffle: databaseGeneration.startsWith('shuffle'), generation: databaseGeneration };
}

/**
 * Run the shuffle playback-database comparison.
 *
 * Exposed for unit tests so they can drive it with a synthetic database view
 * and an in-memory filesystem, rather than a module-level mock.
 */
export async function checkShufflePlaybackDb(
  ctx: DiagnosticContext,
  fsReader: ItunesSdFsReader = defaultFsReader,
  sieReader: SieReader = defaultSieReader
): Promise<CheckResult> {
  const view = readDatabaseDeviceView(ctx.db);
  const trackCount = readDatabaseTrackCount(ctx.db);
  if (!view || trackCount === undefined) {
    return { status: 'skip', summary: 'No iPod database', repairable: false };
  }

  const { shuffle, generation, displayName } = isShuffle(ctx, view.generation, sieReader);
  if (!shuffle) {
    return {
      status: 'skip',
      summary: 'Not an iPod shuffle — no separate playback database to check',
      repairable: false,
    };
  }

  const label = displayName ?? 'This iPod shuffle';
  const path = join(ctx.mountPoint, ITUNESSD_PATH);
  const present = fsReader.existsSync(path);

  let size = 0;
  let header: ItunesSdHeader | null = null;
  if (present) {
    try {
      size = fsReader.sizeOf(path);
      header = parseItunesSdHeader(fsReader.readHeader(path, HEADER_BYTES));
    } catch {
      // Unreadable is indistinguishable from absent for this purpose.
      size = 0;
    }
  }

  // A file in the wrong format is a defect on its own terms — it indexes
  // tracks the firmware will never read — so it is reported whether or not
  // the iTunesDB has anything in it, and before the emptiness comparison.
  const expectedFormat = expectedItunesSdFormat(generation);
  if (present && header && expectedFormat && header.format !== expectedFormat) {
    return {
      status: 'warn',
      summary:
        `${label} has a playback database (iTunesSD) in ${FORMAT_LABEL[header.format]}, but ` +
        `this shuffle reads ${FORMAT_LABEL[expectedFormat]} — its firmware cannot play from ` +
        'that file. It is the signature of a database layer that could not tell which shuffle ' +
        'this is. Check the database-layer device identity, then write the database again.',
      repairable: false,
      details: {
        itunesSdPresent: true,
        itunesSdBytes: size,
        itunesSdFormat: header.format,
        expectedItunesSdFormat: expectedFormat,
        itunesSdTrackCount: header.trackCount,
        trackCount,
        databaseGeneration: view.generation,
      },
    };
  }

  if (trackCount === 0) {
    return {
      status: 'skip',
      summary: `${label} has no tracks — nothing for the playback database to index`,
      repairable: false,
    };
  }

  if (present && header && header.trackCount > 0) {
    return {
      status: 'pass',
      summary:
        `${label} has a populated playback database (iTunesSD, ` +
        `${FORMAT_LABEL[header.format]}, ${header.trackCount} track(s), ${size} bytes)`,
      repairable: false,
      details: {
        itunesSdBytes: size,
        itunesSdFormat: header.format,
        itunesSdTrackCount: header.trackCount,
        trackCount,
      },
    };
  }

  const state = !present
    ? 'no playback database (iTunesSD) at all'
    : header
      ? `an empty playback database (iTunesSD, ${FORMAT_LABEL[header.format]}, ${size} bytes)`
      : `an unreadable playback database (iTunesSD, ${size} bytes, in no format podkit recognises)`;

  return {
    status: 'warn',
    summary:
      `${label} has ${trackCount} track(s) in its iTunesDB but ${state}` +
      ' — a shuffle plays from iTunesSD, so it will not play any of them. ' +
      'Check the database-layer device identity, then sync again.',
    repairable: false,
    details: {
      itunesSdPresent: present,
      itunesSdBytes: size,
      ...(header ? { itunesSdFormat: header.format, itunesSdTrackCount: header.trackCount } : {}),
      trackCount,
      databaseGeneration: view.generation,
    },
  };
}

// ── Exported check object ────────────────────────────────────────────────────

export const shufflePlaybackDbCheck: DiagnosticCheck = {
  id: 'shuffle-playback-db',
  name: 'Shuffle playback database',
  scope: 'database-health',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    return checkShufflePlaybackDb(ctx);
  },
};
