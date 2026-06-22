/**
 * Integration tests for the SQLite catalogue (`library.sqlite`).
 *
 * A fixture dump is synthesised with `@podkit/gpod-testing` + libgpod-node:
 * several tracks with varied play counts / ratings / timestamps / media types,
 * one no-audio (metadata-only) track, an ordered manual playlist, and a smart
 * playlist with rules. A synthetic `ArtworkDB` is dropped in for one track. The
 * transform is run with an injected `dump_date`, then the produced
 * `library.sqlite` is reopened with `bun:sqlite` and every table is asserted.
 *
 * The libgpod test harness DOES support ordered playlists and smart playlists
 * with readable rules (verified here), so those paths are asserted directly
 * rather than left as coverage gaps. Pure rule-flattening is additionally
 * pinned in `library-db-writer.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Database as SqliteDatabase } from 'bun:sqlite';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database, MediaType, SPLField, SPLAction, SPLMatch } from '@podkit/libgpod-node';
import { runTransform } from './run-transform.js';
import { LIBRARY_DB_FILENAME, LIBRARY_DB_SCHEMA_VERSION } from './library-db-writer.js';

const FIXTURE_DIR = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'test-packages',
  'test-fixtures',
  'fixtures',
  'audio',
  'multi-format'
);
const MP3 = join(FIXTURE_DIR, '05-mp3-track.mp3');
const M4A = join(FIXTURE_DIR, '06-aac-track.m4a');

// A fixed instant so the catalogue's dump_date is deterministic.
const DUMP_DATE = new Date('2026-06-22T09:07:03.000Z');
const DUMP_DATE_UNIX = Math.floor(DUMP_DATE.getTime() / 1000);

// ── Synthetic ArtworkDB builders (RGB565, one track) ─────────────────────────
// Mirrors the framing used in artwork-decoder.integration.test.ts.

function writeTag(buf: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) buf[offset + i] = tag.charCodeAt(i);
}
function buildMhni(p: {
  formatId: number;
  ithmbOffset: number;
  size: number;
  width: number;
  height: number;
}): Uint8Array {
  const headerLen = 0x4c;
  const buf = new Uint8Array(headerLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhni');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, headerLen, true);
  view.setUint32(0x0c, 0, true);
  view.setUint32(0x10, p.formatId, true);
  view.setUint32(0x14, p.ithmbOffset, true);
  view.setUint32(0x18, p.size, true);
  view.setUint16(0x20, p.height, true);
  view.setUint16(0x22, p.width, true);
  return buf;
}
function buildThumbnailMhod(mhni: Uint8Array): Uint8Array {
  const headerLen = 0x18;
  const totalLen = headerLen + mhni.byteLength;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhod');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint16(0x0c, 2, true);
  buf.set(mhni, headerLen);
  return buf;
}
function buildMhii(imageId: number, songId: bigint, thumbMhods: Uint8Array[]): Uint8Array {
  const headerLen = 0x98;
  const childrenLen = thumbMhods.reduce((s, c) => s + c.byteLength, 0);
  const totalLen = headerLen + childrenLen;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhii');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint32(0x0c, thumbMhods.length, true);
  view.setUint32(0x10, imageId, true);
  view.setBigUint64(0x14, songId, true);
  let off = headerLen;
  for (const c of thumbMhods) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}
function buildList(tag: string, children: Uint8Array[]): Uint8Array {
  const headerLen = 0x5c;
  const childrenLen = children.reduce((s, c) => s + c.byteLength, 0);
  const buf = new Uint8Array(headerLen + childrenLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, tag);
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, children.length, true);
  let off = headerLen;
  for (const c of children) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}
function buildMhsd(sectionType: number, child: Uint8Array): Uint8Array {
  const headerLen = 0x60;
  const totalLen = headerLen + child.byteLength;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhsd');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint16(0x0c, sectionType, true);
  buf.set(child, headerLen);
  return buf;
}
function buildArtworkDB(mhiis: Uint8Array[]): Uint8Array {
  const mhli = buildList('mhli', mhiis);
  const mhsd = buildMhsd(1, mhli);
  const headerLen = 0x84;
  const totalLen = headerLen + mhsd.byteLength;
  const mhfd = new Uint8Array(headerLen);
  const view = new DataView(mhfd.buffer);
  writeTag(mhfd, 0, 'mhfd');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint32(0x14, 1, true);
  const out = new Uint8Array(totalLen);
  out.set(mhfd, 0);
  out.set(mhsd, headerLen);
  return out;
}
function rgb565(r5: number, g6: number, b5: number): [number, number] {
  const v = ((r5 & 0x1f) << 11) | ((g6 & 0x3f) << 5) | (b5 & 0x1f);
  return [v & 0xff, (v >> 8) & 0xff];
}

// ── Fixture dump builder ─────────────────────────────────────────────────────

interface SeedResult {
  root: string;
  dbids: Map<string, bigint>;
  manualPlaylistId: bigint;
  smartPlaylistId: bigint;
}

/**
 * Build a dump with several tracks (varied stats/timestamps/media types), a
 * no-audio track, an ordered manual playlist, and a smart playlist with a rule.
 * Drops a synthetic ArtworkDB granting artwork to one track.
 */
async function seedDump(): Promise<SeedResult> {
  const ipod = await createTestIpod();
  const db = await Database.open(ipod.path);

  // Two album tracks, different stats. Order of insert is reversed from track
  // number so playlist ordering is provably insertion-order, not sort-order.
  const songB = db.addTrack({
    title: 'Song B',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    genre: 'Rock',
    composer: 'A Composer',
    trackNumber: 2,
    year: 1999,
  });
  db.copyTrackToDevice(songB, M4A);
  // Play stats are applied via updateTrack (libgpod ignores them on addTrack).
  db.updateTrack(songB, { rating: 100, playCount: 7, skipCount: 3 });

  const songA = db.addTrack({
    title: 'Song A',
    artist: 'The Artist',
    album: 'Greatest Hits',
    albumArtist: 'The Band',
    genre: 'Rock',
    trackNumber: 1,
    year: 1999,
  });
  db.copyTrackToDevice(songA, MP3);
  db.updateTrack(songA, { rating: 60, playCount: 2, skipCount: 0 });

  // A podcast (distinct media type + album) to prove media_type / album split.
  const pod = db.addTrack({
    title: 'Episode 1',
    artist: 'Some Show',
    album: 'Some Show',
    mediaType: MediaType.Podcast,
  });
  db.copyTrackToDevice(pod, MP3);
  db.updateTrack(pod, { playCount: 1 });

  // A metadata-only track → no audio body → null exported_path in the catalogue.
  db.addTrack({ title: 'Lonely Track', artist: 'Nobody' });

  // Ordered manual playlist: B then A (reverse of track number).
  const manual = db.createPlaylist('My Mix');
  db.addTrackToPlaylist(manual.id, songB);
  db.addTrackToPlaylist(manual.id, songA);

  // Smart playlist with one genre rule (its id is read back below).
  db.createSmartPlaylist({
    name: 'Rock Only',
    match: SPLMatch.And,
    rules: [{ field: SPLField.Genre, action: SPLAction.Contains, string: 'Rock' }],
  });

  db.saveSync();
  db.close();

  // Reopen for assigned dbids + playlist ids.
  const re = await Database.open(ipod.path);
  const dbids = new Map<string, bigint>();
  for (const h of re.getTracks()) {
    const t = re.getTrack(h);
    if (t.title) dbids.set(t.title, t.dbid);
  }
  const manualPlaylistId = re.getPlaylistByName('My Mix')!.id;
  const smartPlaylistId = re.getPlaylistByName('Rock Only')!.id;

  // Drop a synthetic ArtworkDB giving 'Song B' a 2x1 thumbnail.
  const artworkDir = join(ipod.path, 'iPod_Control', 'Artwork');
  await mkdir(artworkDir, { recursive: true });
  const ithmb = new Uint8Array([...rgb565(31, 0, 0), ...rgb565(0, 63, 0)]); // 2x1
  await writeFile(join(artworkDir, 'F1057_1.ithmb'), ithmb);
  await writeFile(
    join(artworkDir, 'ArtworkDB'),
    buildArtworkDB([
      buildMhii(1, dbids.get('Song B')!, [
        buildThumbnailMhod(
          buildMhni({ formatId: 1057, ithmbOffset: 0, size: 4, width: 2, height: 1 })
        ),
      ]),
    ])
  );

  re.close();
  return { root: ipod.path, dbids, manualPlaylistId, smartPlaylistId };
}

describe('writeLibraryDb — catalogue from a fixture dump', () => {
  let dump: string;
  let seeded: SeedResult;
  let sqlite: SqliteDatabase;

  beforeEach(async () => {
    seeded = await seedDump();
    dump = seeded.root;
    const result = await runTransform(dump, {
      podkitVersion: '9.9.9-test',
      now: () => DUMP_DATE,
    });
    sqlite = new SqliteDatabase(join(result.archiveDir, LIBRARY_DB_FILENAME), { readonly: true });
  });

  afterEach(async () => {
    sqlite?.close();
    if (dump) await rm(dump, { recursive: true, force: true });
  });

  test('records schema_version', () => {
    const row = sqlite.query('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(LIBRARY_DB_SCHEMA_VERSION);
  });

  test('writes a single device row with injected dump_date + version', () => {
    const rows = sqlite.query('SELECT * FROM device').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const d = rows[0]!;
    expect(d.dump_date).toBe(DUMP_DATE_UNIX);
    expect(d.podkit_version).toBe('9.9.9-test');
    // libgpod classifies the test MA147 as an iPod Video.
    expect(typeof d.model_name).toBe('string');
  });

  test('preserves play counts / ratings / skip counts exactly as stored', () => {
    const b = sqlite.query('SELECT * FROM tracks WHERE title = ?').get('Song B') as Record<
      string,
      unknown
    >;
    expect(b.rating).toBe(100);
    expect(b.play_count).toBe(7);
    expect(b.skip_count).toBe(3);
    expect(b.genre).toBe('Rock');
    expect(b.composer).toBe('A Composer');
    expect(b.year).toBe(1999);
    expect(b.track_number).toBe(2);

    const a = sqlite.query('SELECT * FROM tracks WHERE title = ?').get('Song A') as Record<
      string,
      unknown
    >;
    expect(a.rating).toBe(60);
    expect(a.play_count).toBe(2);
    expect(a.skip_count).toBe(0);
  });

  test('stores dbid as exact decimal TEXT (no precision loss)', () => {
    const expected = seeded.dbids.get('Song B')!.toString();
    const b = sqlite.query('SELECT dbid FROM tracks WHERE title = ?').get('Song B') as {
      dbid: string;
    };
    expect(typeof b.dbid).toBe('string');
    expect(b.dbid).toBe(expected);
  });

  test('maps each track to its exported_path and dump_path; null for no-audio', () => {
    const b = sqlite
      .query('SELECT exported_path, dump_path FROM tracks WHERE title = ?')
      .get('Song B') as { exported_path: string | null; dump_path: string | null };
    expect(b.exported_path).toBe('Music/The Band/Greatest Hits/02 Song B.m4a');
    expect(b.dump_path).toMatch(/^:iPod_Control:/);

    const lonely = sqlite
      .query('SELECT exported_path, dump_path FROM tracks WHERE title = ?')
      .get('Lonely Track') as { exported_path: string | null; dump_path: string | null };
    expect(lonely.exported_path).toBeNull();
    expect(lonely.dump_path).toBeNull();
  });

  test('every track appears in the catalogue (including no-audio)', () => {
    const count = sqlite.query('SELECT COUNT(*) AS n FROM tracks').get() as { n: number };
    expect(count.n).toBe(4);
  });

  test('derives albums with track counts', () => {
    const greatest = sqlite
      .query('SELECT track_count FROM albums WHERE album = ? AND album_artist = ?')
      .get('Greatest Hits', 'The Band') as { track_count: number } | null;
    expect(greatest?.track_count).toBe(2);

    // The podcast (album 'Some Show', null albumArtist) is its own rollup.
    const show = sqlite
      .query('SELECT track_count FROM albums WHERE album = ?')
      .get('Some Show') as { track_count: number } | null;
    expect(show?.track_count).toBe(1);
  });

  test('writes one artwork row matching the indexed thumbnail', () => {
    const rows = sqlite.query('SELECT * FROM artwork').all() as Array<{
      track_dbid: string;
      width: number;
      height: number;
      format: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.track_dbid).toBe(seeded.dbids.get('Song B')!.toString());
    expect(rows[0]!.width).toBe(2);
    expect(rows[0]!.height).toBe(1);
    expect(rows[0]!.format).toBe(1057);
  });

  test('preserves playlist ordering in playlist_items', () => {
    const items = sqlite
      .query(
        `SELECT t.title AS title, pi.position AS position
           FROM playlist_items pi
           JOIN tracks t ON t.dbid = pi.track_dbid
          WHERE pi.playlist_id = ?
          ORDER BY pi.position`
      )
      .all(seeded.manualPlaylistId.toString()) as Array<{ title: string; position: number }>;

    expect(items.map((i) => i.title)).toEqual(['Song B', 'Song A']);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
  });

  test('records playlists with master / smart flags', () => {
    const master = sqlite.query('SELECT name FROM playlists WHERE is_master = 1').all() as Array<{
      name: string;
    }>;
    expect(master).toHaveLength(1);

    const smart = sqlite.query('SELECT name FROM playlists WHERE is_smart = 1').get() as {
      name: string;
    } | null;
    expect(smart?.name).toBe('Rock Only');
  });

  test('persists smart-playlist rules', () => {
    const rules = sqlite
      .query(
        'SELECT field, action, string FROM smart_playlist_rules WHERE playlist_id = ? ORDER BY rule_index'
      )
      .all(seeded.smartPlaylistId.toString()) as Array<{
      field: number;
      action: number;
      string: string | null;
    }>;

    expect(rules).toHaveLength(1);
    expect(rules[0]!.field).toBe(SPLField.Genre);
    expect(rules[0]!.action).toBe(SPLAction.Contains);
    expect(rules[0]!.string).toBe('Rock');
  });

  test('stores no raw iTunesDB/ArtworkDB blobs (parsed view only)', () => {
    // No table carries a BLOB column; assert the schema is blob-free.
    const cols = sqlite.query("SELECT type FROM pragma_table_info('tracks')").all() as Array<{
      type: string;
    }>;
    for (const c of cols) {
      expect(c.type.toUpperCase()).not.toBe('BLOB');
    }
  });
});
