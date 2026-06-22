/**
 * Integration tests for the artwork slice.
 *
 * Two paths are covered against SYNTHETIC fixtures (no real iPod user data):
 *
 *  1. `createArtworkDecoder` against a hand-built `ArtworkDB` + `.ithmb` pair —
 *     decodes the largest thumbnail to RGBA, matched by track `dbid`, across two
 *     pixel formats (RGB565 and RGB555), and returns `null` for an unknown dbid.
 *
 *  2. `runTransform` end-to-end on a seeded dump with that same synthetic
 *     ArtworkDB dropped in — proves the cover PNG is embedded in each track,
 *     `cover.png` is written once per album folder, and a track with no matching
 *     ArtworkDB image lands in the `noArtwork` bucket.
 *
 * The ArtworkDB/.ithmb bytes are constructed in-code from the documented
 * mh-record layout; nothing is copied off a device.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { File as TagFile, PictureType } from 'node-taglib-sharp';
import { PNG } from 'pngjs';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database } from '@podkit/libgpod-node';
import { createArtworkDecoder } from './artwork-decoder.js';
import { runTransform } from '../run-transform.js';

// ── Audio fixtures (shared multi-format set) ─────────────────────────────────
const FIXTURE_DIR = join(
  import.meta.dir,
  '..',
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

// ── Synthetic ArtworkDB + .ithmb builders ────────────────────────────────────
//
// Layout mirrors the parser's documented record framing. All integers are
// little-endian (the iPod native byte order for these generations).

function writeTag(buf: Uint8Array, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) buf[offset + i] = tag.charCodeAt(i);
}

/** mhni: a single thumbnail descriptor pointing into an `.ithmb`. */
function buildMhni(params: {
  formatId: number;
  ithmbOffset: number;
  size: number;
  width: number;
  height: number;
}): Uint8Array {
  const headerLen = 0x4c; // matches libgpod mhni header size
  const buf = new Uint8Array(headerLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhni');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, headerLen, true); // totalLen (no children)
  view.setUint32(0x0c, 0, true); // numChildren
  view.setUint32(0x10, params.formatId, true);
  view.setUint32(0x14, params.ithmbOffset, true);
  view.setUint32(0x18, params.size, true);
  view.setUint16(0x1c, 0, true); // verticalPadding
  view.setUint16(0x1e, 0, true); // horizontalPadding
  view.setUint16(0x20, params.height, true);
  view.setUint16(0x22, params.width, true);
  return buf;
}

/** mhod type 2: a thumbnail container wrapping one mhni. */
function buildThumbnailMhod(mhni: Uint8Array): Uint8Array {
  const headerLen = 0x18;
  const totalLen = headerLen + mhni.byteLength;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhod');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint16(0x0c, 2, true); // type 2 (16-bit in ArtworkDB)
  buf.set(mhni, headerLen);
  return buf;
}

/** mhii: one image item linking a track dbid (songId) to its thumbnails. */
function buildMhii(imageId: number, songId: bigint, thumbMhods: Uint8Array[]): Uint8Array {
  const headerLen = 0x98; // libgpod mhii header size
  const childrenLen = thumbMhods.reduce((s, c) => s + c.byteLength, 0);
  const totalLen = headerLen + childrenLen;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhii');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint32(0x0c, thumbMhods.length, true); // numChildren
  view.setUint32(0x10, imageId, true);
  view.setBigUint64(0x14, songId, true); // packed, no alignment padding
  let off = headerLen;
  for (const c of thumbMhods) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

/** A generic list record (mhli) wrapping its children. */
function buildList(tag: string, children: Uint8Array[]): Uint8Array {
  const headerLen = 0x5c;
  const childrenLen = children.reduce((s, c) => s + c.byteLength, 0);
  const buf = new Uint8Array(headerLen + childrenLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, tag);
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, children.length, true); // numChildren
  let off = headerLen;
  for (const c of children) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return buf;
}

/** mhsd: a section wrapping one child list. */
function buildMhsd(sectionType: number, child: Uint8Array): Uint8Array {
  const headerLen = 0x60;
  const totalLen = headerLen + child.byteLength;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  writeTag(buf, 0, 'mhsd');
  view.setUint32(0x04, headerLen, true);
  view.setUint32(0x08, totalLen, true);
  view.setUint16(0x0c, sectionType, true); // 16-bit in ArtworkDB
  buf.set(child, headerLen);
  return buf;
}

/** A full ArtworkDB with a single image-list section holding the given mhii's. */
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
  view.setUint32(0x14, 1, true); // numChildren = 1 (just the image list)

  const out = new Uint8Array(totalLen);
  out.set(mhfd, 0);
  out.set(mhsd, headerLen);
  return out;
}

/** Encode one RGB565 pixel little-endian. */
function rgb565(r5: number, g6: number, b5: number): [number, number] {
  const v = ((r5 & 0x1f) << 11) | ((g6 & 0x3f) << 5) | (b5 & 0x1f);
  return [v & 0xff, (v >> 8) & 0xff];
}

/** Encode one RGB555 pixel little-endian. */
function rgb555(r5: number, g5: number, b5: number): [number, number] {
  const v = ((r5 & 0x1f) << 10) | ((g5 & 0x1f) << 5) | (b5 & 0x1f);
  return [v & 0xff, (v >> 8) & 0xff];
}

describe('createArtworkDecoder — synthetic ArtworkDB + .ithmb', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ipod-archive-art-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('decodes the largest thumbnail per dbid across RGB565 and RGB555', async () => {
    const artworkDir = join(root, 'iPod_Control', 'Artwork');
    await mkdir(artworkDir, { recursive: true });

    // --- RGB565 track (dbid 0xAAAA): two thumbnails; the LARGER (2x1) wins. ---
    // ithmb F1057_1: [small 1x1 red][large 2x1 red,green]
    const small565 = new Uint8Array(rgb565(31, 0, 0)); // red, 1x1 = 2 bytes
    const large565 = new Uint8Array([...rgb565(31, 0, 0), ...rgb565(0, 63, 0)]); // 2x1 = 4 bytes
    const ithmb565 = new Uint8Array([...small565, ...large565]);
    await writeFile(join(artworkDir, 'F1057_1.ithmb'), ithmb565);

    const mhii565 = buildMhii(1, 0xaaaan, [
      buildThumbnailMhod(
        buildMhni({ formatId: 1057, ithmbOffset: 0, size: 2, width: 1, height: 1 })
      ),
      buildThumbnailMhod(
        buildMhni({ formatId: 1057, ithmbOffset: 2, size: 4, width: 2, height: 1 })
      ),
    ]);

    // --- RGB555 track (dbid 0xBBBB): one 1x1 blue thumbnail in F1066_1. ---
    const ithmb555 = new Uint8Array(rgb555(0, 0, 31)); // blue 1x1
    await writeFile(join(artworkDir, 'F1066_1.ithmb'), ithmb555);

    const mhii555 = buildMhii(2, 0xbbbbn, [
      buildThumbnailMhod(
        buildMhni({ formatId: 1066, ithmbOffset: 0, size: 2, width: 1, height: 1 })
      ),
    ]);

    await writeFile(join(artworkDir, 'ArtworkDB'), buildArtworkDB([mhii565, mhii555]));

    const decoder = createArtworkDecoder(root);

    // RGB565 track → the LARGER 2x1 thumbnail (red, green), not the 1x1.
    const a = decoder.coverRgba(0xaaaan);
    expect(a).not.toBeNull();
    expect(a!.width).toBe(2);
    expect(a!.height).toBe(1);
    expect([...a!.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]); // red
    expect([...a!.data.subarray(4, 8)]).toEqual([0, 255, 0, 255]); // green

    // RGB555 track → 1x1 blue.
    const b = decoder.coverRgba(0xbbbbn);
    expect(b).not.toBeNull();
    expect(b!.width).toBe(1);
    expect(b!.height).toBe(1);
    expect([...b!.data]).toEqual([0, 0, 255, 255]); // blue

    // Unknown dbid → null.
    expect(decoder.coverRgba(0x1234n)).toBeNull();
  });

  test('degrades to a null decoder when there is no ArtworkDB', () => {
    const decoder = createArtworkDecoder(root);
    expect(decoder.coverRgba(0xaaaan)).toBeNull();
  });
});

// ── run-transform end-to-end with embedded cover + cover.png ─────────────────

interface SeededTrack {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number;
  source: string;
}

/** Seed a dump and return its root plus the per-title track dbids. */
async function seedDumpWithDbids(
  tracks: SeededTrack[]
): Promise<{ root: string; dbids: Map<string, bigint> }> {
  const ipod = await createTestIpod();
  const db = await Database.open(ipod.path);
  for (const t of tracks) {
    const h = db.addTrack({
      title: t.title,
      artist: t.artist,
      album: t.album,
      albumArtist: t.albumArtist,
      trackNumber: t.trackNumber,
    });
    db.copyTrackToDevice(h, t.source);
  }
  db.saveSync();
  db.close();

  // Reopen to read the assigned dbids.
  const reopened = await Database.open(ipod.path);
  const dbids = new Map<string, bigint>();
  for (const h of reopened.getTracks()) {
    const t = reopened.getTrack(h);
    if (t.title) dbids.set(t.title, t.dbid);
  }
  reopened.close();

  return { root: ipod.path, dbids };
}

describe('runTransform — embeds cover + writes cover.png per album', () => {
  let dump: string;

  afterEach(async () => {
    if (dump) await rm(dump, { recursive: true, force: true });
  });

  test('two same-album tracks share one cover.png; a third lands in noArtwork', async () => {
    const seeded = await seedDumpWithDbids([
      {
        title: 'Track One',
        artist: 'The Artist',
        album: 'Greatest Hits',
        albumArtist: 'The Band',
        trackNumber: 1,
        source: MP3,
      },
      {
        title: 'Track Two',
        artist: 'The Artist',
        album: 'Greatest Hits',
        albumArtist: 'The Band',
        trackNumber: 2,
        source: M4A,
      },
      {
        title: 'Artless Track',
        artist: 'The Artist',
        album: 'Greatest Hits',
        albumArtist: 'The Band',
        trackNumber: 3,
        source: MP3,
      },
    ]);
    dump = seeded.root;

    const dbid1 = seeded.dbids.get('Track One')!;
    const dbid2 = seeded.dbids.get('Track Two')!;
    // 'Artless Track' deliberately gets NO ArtworkDB image.

    const artworkDir = join(dump, 'iPod_Control', 'Artwork');
    await mkdir(artworkDir, { recursive: true });

    // A 1x1 red RGB565 thumbnail, shared by both art-bearing tracks.
    const red = new Uint8Array(rgb565(31, 0, 0));
    await writeFile(join(artworkDir, 'F1057_1.ithmb'), red);

    const db = buildArtworkDB([
      buildMhii(1, dbid1, [
        buildThumbnailMhod(
          buildMhni({ formatId: 1057, ithmbOffset: 0, size: 2, width: 1, height: 1 })
        ),
      ]),
      buildMhii(2, dbid2, [
        buildThumbnailMhod(
          buildMhni({ formatId: 1057, ithmbOffset: 0, size: 2, width: 1, height: 1 })
        ),
      ]),
    ]);
    await writeFile(join(artworkDir, 'ArtworkDB'), db);

    const result = await runTransform(dump);

    expect(result.written).toBe(3);
    expect(result.failures).toEqual([]);

    // The artless track is bucketed; the two art-bearing ones are not.
    expect(result.noArtwork.map((s) => s.title).sort()).toEqual(['Artless Track']);

    const albumDir = join(result.archiveDir, 'Music', 'The Band', 'Greatest Hits');

    // cover.png written exactly once for the album, and it is a valid 1x1 PNG.
    const coverBytes = await readFile(join(albumDir, 'cover.png'));
    const coverPng = PNG.sync.read(coverBytes);
    expect(coverPng.width).toBe(1);
    expect(coverPng.height).toBe(1);
    expect([...coverPng.data]).toEqual([255, 0, 0, 255]);

    // Both art-bearing tracks carry an embedded front-cover picture.
    for (const rel of ['01 Track One.mp3', '02 Track Two.m4a']) {
      const file = TagFile.createFromPath(join(albumDir, rel));
      try {
        expect(file.tag.pictures.length).toBe(1);
        expect(file.tag.pictures[0]!.type).toBe(PictureType.FrontCover);
        const embedded = PNG.sync.read(Buffer.from(file.tag.pictures[0]!.data.toByteArray()));
        expect(embedded.width).toBe(1);
        expect([...embedded.data]).toEqual([255, 0, 0, 255]);
      } finally {
        file.dispose();
      }
    }

    // The artless track has no embedded picture.
    const artless = TagFile.createFromPath(join(albumDir, '03 Artless Track.mp3'));
    try {
      expect(artless.tag.pictures.length).toBe(0);
    } finally {
      artless.dispose();
    }
  });

  test('no ArtworkDB at all → every track lands in noArtwork, no cover.png', async () => {
    const seeded = await seedDumpWithDbids([
      {
        title: 'Solo',
        artist: 'Solo',
        album: 'Solo Album',
        albumArtist: 'Solo',
        trackNumber: 1,
        source: MP3,
      },
    ]);
    dump = seeded.root;

    const result = await runTransform(dump);
    expect(result.written).toBe(1);
    expect(result.noArtwork).toHaveLength(1);

    const albumDir = join(result.archiveDir, 'Music', 'Solo', 'Solo Album');
    const coverExists = await stat(join(albumDir, 'cover.png')).then(
      () => true,
      () => false
    );
    expect(coverExists).toBe(false);
  });
});
