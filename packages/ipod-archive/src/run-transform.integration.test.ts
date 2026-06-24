/**
 * Integration tests for the stage-2 transform against a fixture dump.
 *
 * A fixture iPod is synthesised with `@podkit/gpod-testing`, then real audio is
 * copied into it via libgpod-node so each track carries a real `ipodPath`
 * pointing at a real file inside the (dump-shaped) directory. The transform is
 * then run against that directory and the produced `Music/` tree, byte-fidelity
 * of the copies, and the tags read back via node-taglib-sharp are asserted.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, readFile, writeFile, stat, cp, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { File as TagFile } from 'node-taglib-sharp';
import { Database as SqliteDatabase } from 'bun:sqlite';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database } from '@podkit/libgpod-node';
import { runTransform } from './run-transform.js';
import { writeTrack } from './tag-writer.js';
import { retagWithFfmpeg, runFfmpegDefault } from './ffmpeg-tag.js';
import { loadDump } from './dump-loader.js';
import { IpodArchiveError } from './errors.js';
import { rgbaToPng } from './artwork/rgba-to-png.js';

/** A tiny solid-colour PNG buffer for cover-embedding tests. */
function makeCoverPng(): Buffer {
  const px = 4;
  const data = Buffer.alloc(px * px * 4, 0x80);
  return rgbaToPng({ width: px, height: px, data });
}

/** Whether a real ffmpeg is on PATH, so the fallback-via-ffmpeg test can run. */
const FFMPEG_AVAILABLE = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Build a valid-but-taglib-hostile MP3 from a real one: a minimal ID3v2 header
 * declaring zero frames, then a large zero-padding gap, then the real audio
 * frames. ffmpeg's tolerant demuxer reads it fine, but taglib's frame-sync
 * search gives up ("MPEG audio header not found") — exactly the real-world
 * failure the ffmpeg fallback exists for.
 */
async function makeTaglibHostileMp3(srcMp3: string, dest: string): Promise<void> {
  const buf = await readFile(srcMp3);
  let sync = -1;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && (buf[i + 1]! & 0xe0) === 0xe0) {
      sync = i;
      break;
    }
  }
  if (sync < 0) throw new Error('no MPEG frame sync in fixture');
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const gap = Buffer.alloc(4000, 0x00);
  await writeFile(dest, Buffer.concat([id3, gap, buf.subarray(sync)]));
}

/** Read the audio-stream properties used to prove a copy was not re-encoded. */
function readAudioProps(filePath: string): {
  description: string;
  durationMs: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
} {
  const file = TagFile.createFromPath(filePath);
  try {
    const p = file.properties;
    return {
      description: p.description,
      durationMs: Math.round(p.durationMilliseconds),
      bitrate: p.audioBitrate,
      sampleRate: p.audioSampleRate,
      channels: p.audioChannels,
    };
  } finally {
    file.dispose();
  }
}

// Resolve the shared audio fixtures relative to this test file so the suite
// runs on any machine / CI, not just the author's checkout.
// src/ → packages/ipod-archive/ → packages/ → repo root.
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

interface SeededTrack {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNumber: number;
  source: string;
}

/**
 * Build a dump-shaped iPod directory with real audio for each track. Returns
 * the directory (containing `iPod_Control`) — `loadDump` accepts it directly.
 */
async function seedDump(tracks: SeededTrack[], withNoAudioTrack: boolean): Promise<string> {
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
  if (withNoAudioTrack) {
    // A metadata-only track with no file → null ipodPath → "no audio" bucket.
    db.addTrack({ title: 'Lonely Track', artist: 'Nobody' });
  }
  db.saveSync();
  db.close();
  return ipod.path;
}

describe('runTransform — fixture dump', () => {
  let workdir: string;
  let dump: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ipod-archive-xform-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
    if (dump) await rm(dump, { recursive: true, force: true });
  });

  test('produces a Music tree of byte-lossless, tagged copies', async () => {
    dump = await seedDump(
      [
        {
          title: 'First Song',
          artist: 'The Artist',
          album: 'Greatest Hits',
          albumArtist: 'The Band',
          trackNumber: 1,
          source: MP3,
        },
        {
          title: 'Second Song',
          artist: 'The Artist',
          album: 'Greatest Hits',
          albumArtist: 'The Band',
          trackNumber: 2,
          source: M4A,
        },
      ],
      true
    );

    const result = await runTransform(dump);

    // Two audio tracks written, one no-audio bucketed, no failures.
    expect(result.written).toBe(2);
    expect(result.noAudio).toHaveLength(1);
    expect(result.noAudio[0]?.title).toBe('Lonely Track');
    expect(result.failures).toEqual([]);

    // archive/ lives inside the dump dir (bare iPod root case).
    expect(result.archiveDir).toBe(join(dump, 'archive'));

    const firstRel = join('Music', 'The Band', 'Greatest Hits', '01 First Song.mp3');
    const secondRel = join('Music', 'The Band', 'Greatest Hits', '02 Second Song.m4a');
    const firstDest = join(result.archiveDir, firstRel);
    const secondDest = join(result.archiveDir, secondRel);

    // Tree shape exists.
    expect((await stat(firstDest)).isFile()).toBe(true);
    expect((await stat(secondDest)).isFile()).toBe(true);

    // No re-encode: the audio stream properties (codec, duration, bitrate,
    // sample rate, channels) of the archived copy match the source exactly.
    // Tag writing rewrites only the metadata region, never the audio frames.
    const srcProps = readAudioProps(MP3);
    const destProps = readAudioProps(firstDest);
    expect(destProps).toEqual(srcProps);

    // M4A (primary real-device format) must also be lossless. This is the key
    // proof that the copy path does not re-encode AAC audio.
    expect(readAudioProps(secondDest)).toEqual(readAudioProps(M4A));

    // Tags read back match the DB metadata.
    const file = TagFile.createFromPath(firstDest);
    try {
      expect(file.tag.title).toBe('First Song');
      expect(file.tag.albumArtists).toEqual(['The Band']);
      expect(file.tag.album).toBe('Greatest Hits');
      expect(file.tag.track).toBe(1);
    } finally {
      file.dispose();
    }

    // README + report files land at the archive root.
    expect(result.readmePath).toBe(join(result.archiveDir, 'README.md'));
    expect(result.reportMarkdownPath).toBe(join(result.archiveDir, 'report.md'));
    expect(result.reportJsonPath).toBe(join(result.archiveDir, 'report.json'));
    expect((await stat(result.readmePath)).isFile()).toBe(true);

    // README carries the library stats computed from the dump's tracks.
    const readme = await readFile(result.readmePath, 'utf8');
    expect(readme).toContain('# iPod Archive');
    // Stats cover the full catalogue (3 tracks: 2 with audio + 1 no-audio).
    expect(readme).toContain('| Tracks | 3 |');
    expect(readme).toContain('### Top artists');

    // The no-audio track shows up in the report's no-audio bucket; the two
    // tracks here carry no embedded artwork, so they appear in no-artwork.
    const reportMd = await readFile(result.reportMarkdownPath, 'utf8');
    expect(reportMd).toContain('### Tracks with no audio (1)');
    expect(reportMd).toContain('Lonely Track');
    expect(reportMd).toContain('### Tracks with no artwork (2)');
    // Transform-only run → stage 1 marked not available.
    expect(reportMd).toContain('Not available (transform-only run)');

    const reportJson = JSON.parse(await readFile(result.reportJsonPath, 'utf8')) as {
      stage1: unknown;
      stage2: { noAudio: Array<{ title: string }>; noArtwork: unknown[] };
    };
    expect(reportJson.stage1).toBeNull();
    expect(reportJson.stage2.noAudio).toHaveLength(1);
    expect(reportJson.stage2.noAudio[0]?.title).toBe('Lonely Track');
    expect(reportJson.stage2.noArtwork).toHaveLength(2);
  });

  test('folds threaded stage-1 buckets into the emitted report', async () => {
    dump = await seedDump(
      [
        {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          albumArtist: 'Artist',
          trackNumber: 1,
          source: MP3,
        },
      ],
      false
    );

    const result = await runTransform(dump, {
      dumpReport: {
        foreignSkipped: ['user-mixtape.flac'],
        dumpFailures: [{ path: 'iPod_Control/Music/F00/bad.m4a', error: 'EIO' }],
      },
    });

    const reportMd = await readFile(result.reportMarkdownPath, 'utf8');
    expect(reportMd).not.toContain('Not available (transform-only run)');
    expect(reportMd).toContain('### Foreign files skipped (not copied) (1)');
    expect(reportMd).toContain('user-mixtape.flac');
    // Junk is intentionally not surfaced in the report.
    expect(reportMd).not.toContain('Junk skipped');
    expect(reportMd).toContain('### Dump failures (1)');

    const reportJson = JSON.parse(await readFile(result.reportJsonPath, 'utf8')) as {
      stage1: { foreignSkipped: string[] };
    };
    expect(reportJson.stage1.foreignSkipped).toEqual(['user-mixtape.flac']);
    expect(reportJson.stage1).not.toHaveProperty('junkSkipped');
  });

  test('isolates a missing source file into failures without aborting the run', async () => {
    dump = await seedDump(
      [
        {
          title: 'Present Song',
          artist: 'Here',
          album: 'Album A',
          albumArtist: 'Here',
          trackNumber: 1,
          source: MP3,
        },
        {
          title: 'Missing Song',
          artist: 'Gone',
          album: 'Album B',
          albumArtist: 'Gone',
          trackNumber: 1,
          source: M4A,
        },
      ],
      false
    );

    // Locate the second track's on-device audio file and delete it so it
    // exists in the DB but not on disk when runTransform runs.
    const { db, ipodRoot } = await loadDump(dump);
    let missingIpodPath: string | null = null;
    for (const handle of db.getTracks()) {
      const t = db.getTrack(handle);
      if (t.title === 'Missing Song') {
        missingIpodPath = t.ipodPath;
        break;
      }
    }
    db.close();

    expect(missingIpodPath).not.toBeNull();
    const missingFile = resolve(
      ipodRoot,
      ...missingIpodPath!.split(':').filter((s) => s.length > 0)
    );
    await unlink(missingFile);

    const result = await runTransform(dump);

    // The valid track was written; the missing-file track is in failures.
    expect(result.written).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.title).toBe('Missing Song');
    expect(result.noAudio).toHaveLength(0);
    // A track that fails extraction must NOT also appear in noArtwork — only
    // successfully-extracted tracks are bucketed there.
    expect(result.noArtwork).not.toContainEqual(expect.objectContaining({ title: 'Missing Song' }));

    // The present track landed correctly.
    const presentDest = join(result.archiveDir, 'Music', 'Here', 'Album A', '01 Present Song.mp3');
    expect((await stat(presentDest)).isFile()).toBe(true);
  });

  test('a tag-write failure keeps the extracted file linked in the catalogue (not orphaned)', async () => {
    dump = await seedDump(
      [
        {
          title: 'Normal Song',
          artist: 'Tagged',
          album: 'Album',
          albumArtist: 'Tagged',
          trackNumber: 1,
          source: MP3,
        },
        {
          title: 'Hostile Song',
          artist: 'Untaggable',
          album: 'Album',
          albumArtist: 'Untaggable',
          trackNumber: 2,
          source: MP3,
        },
      ],
      false
    );

    // Replace the second track's on-device audio with a valid-but-taglib-hostile
    // MP3 so tagging fails on it.
    const { db, ipodRoot } = await loadDump(dump);
    let hostileIpodPath: string | null = null;
    for (const handle of db.getTracks()) {
      const t = db.getTrack(handle);
      if (t.title === 'Hostile Song') hostileIpodPath = t.ipodPath;
    }
    db.close();
    expect(hostileIpodPath).not.toBeNull();
    const hostileFile = resolve(
      ipodRoot,
      ...hostileIpodPath!.split(':').filter((s) => s.length > 0)
    );
    await makeTaglibHostileMp3(MP3, hostileFile);

    // Force the ffmpeg fallback to fail too (no real ffmpeg here), so the track
    // ends up genuinely untagged — the worst case the orphan-bug fix must handle.
    const result = await runTransform(dump, { ffmpegPath: '/nonexistent/ffmpeg-binary' });

    // Both tracks were extracted — the hostile one's audio is in the archive.
    expect(result.written).toBe(2);
    // It is NOT an extraction failure (the file copied fine)...
    expect(result.failures).toEqual([]);
    // ...it is a tag failure (extracted but couldn't be tagged).
    expect(result.tagFailures).toHaveLength(1);
    expect(result.tagFailures[0]?.title).toBe('Hostile Song');
    expect(result.tagFailures[0]?.reason).toContain('taglib:');
    expect(result.tagFailures[0]?.reason).toContain('ffmpeg:');

    const hostileDest = join(
      result.archiveDir,
      'Music',
      'Untaggable',
      'Album',
      '02 Hostile Song.mp3'
    );
    // The file is on disk and byte-identical to the (hostile) source — kept, not lost.
    expect((await stat(hostileDest)).isFile()).toBe(true);
    expect(await readFile(hostileDest)).toEqual(await readFile(hostileFile));

    // The catalogue links the file (exported_path set) — the orphan bug is fixed.
    const sqlite = new SqliteDatabase(result.libraryDbPath, { readonly: true });
    try {
      const row = sqlite
        .query('SELECT exported_path FROM tracks WHERE title = ?')
        .get('Hostile Song') as { exported_path: string | null };
      expect(row.exported_path).toBe('Music/Untaggable/Album/02 Hostile Song.mp3');
    } finally {
      sqlite.close();
    }

    // The report files it under tag failures, worded as "in the archive and playable".
    const reportMd = await readFile(result.reportMarkdownPath, 'utf8');
    expect(reportMd).toContain('### Tracks extracted but not tagged (1)');
    expect(reportMd).toContain('Hostile Song');
    expect(reportMd).toContain('in the archive and playable');
  });

  test.skipIf(!FFMPEG_AVAILABLE)(
    'a taglib-hostile track is tagged via the ffmpeg fallback and counted',
    async () => {
      dump = await seedDump(
        [
          {
            title: 'Hostile Song',
            artist: 'Untaggable',
            album: 'Album',
            albumArtist: 'Untaggable',
            trackNumber: 1,
            source: MP3,
          },
        ],
        false
      );

      const { db, ipodRoot } = await loadDump(dump);
      let hostileIpodPath: string | null = null;
      for (const handle of db.getTracks()) {
        const t = db.getTrack(handle);
        if (t.title === 'Hostile Song') hostileIpodPath = t.ipodPath;
      }
      db.close();
      const hostileFile = resolve(
        ipodRoot,
        ...hostileIpodPath!.split(':').filter((s) => s.length > 0)
      );
      await makeTaglibHostileMp3(MP3, hostileFile);

      const result = await runTransform(dump);

      // Tagged via fallback: written, counted, no tag failure.
      expect(result.written).toBe(1);
      expect(result.fallbackTagged).toBe(1);
      expect(result.tagFailures).toEqual([]);

      // The tags actually landed (taglib can now read the ffmpeg-remuxed file).
      const dest = join(result.archiveDir, 'Music', 'Untaggable', 'Album', '01 Hostile Song.mp3');
      const file = TagFile.createFromPath(dest);
      try {
        expect(file.tag.title).toBe('Hostile Song');
        expect(file.tag.performers).toEqual(['Untaggable']);
      } finally {
        file.dispose();
      }
    }
  );

  test('writes archive/ beside raw dump/ when given a named archive dir', async () => {
    // Stage-1 layout: <named>/raw dump/iPod_Control/...
    const seeded = await seedDump(
      [
        {
          title: 'Only Song',
          artist: 'Solo',
          album: 'Solo Album',
          albumArtist: 'Solo',
          trackNumber: 1,
          source: MP3,
        },
      ],
      false
    );
    dump = seeded;

    const named = join(workdir, 'TERAPOD-ABC-20260622-090703');
    const rawDump = join(named, 'raw dump');
    await mkdir(named, { recursive: true });
    await cp(seeded, rawDump, { recursive: true });

    const result = await runTransform(named);

    expect(result.archiveDir).toBe(join(named, 'archive'));
    expect(result.written).toBe(1);
    const dest = join(result.archiveDir, 'Music', 'Solo', 'Solo Album', '01 Only Song.mp3');
    expect((await stat(dest)).isFile()).toBe(true);
  });

  test('refuses to overwrite an existing (non-empty) archive', async () => {
    dump = await seedDump(
      [
        {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          albumArtist: 'Artist',
          trackNumber: 1,
          source: MP3,
        },
      ],
      false
    );

    // First run succeeds and populates archive/.
    await runTransform(dump);

    // Second run must refuse rather than interleave new files with stale ones.
    const err = await runTransform(dump).catch((e) => e);
    expect(err).toBeInstanceOf(IpodArchiveError);
    expect((err as IpodArchiveError).code).toBe('ARCHIVE_ALREADY_EXISTS');
    expect((err as IpodArchiveError).message).toContain(join(dump, 'archive'));
  });

  test('tolerates an empty leftover archive directory', async () => {
    dump = await seedDump(
      [
        {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          albumArtist: 'Artist',
          trackNumber: 1,
          source: MP3,
        },
      ],
      false
    );

    // A stray empty archive/ (e.g. an aborted earlier run) must not block.
    await mkdir(join(dump, 'archive'), { recursive: true });
    const result = await runTransform(dump);
    expect(result.written).toBe(1);
  });
});

describe('loadDump', () => {
  let dump: string;

  afterEach(async () => {
    if (dump) await rm(dump, { recursive: true, force: true });
  });

  test('opens a dump and surfaces identity, degrading when serial is absent', async () => {
    dump = await seedDump(
      [
        {
          title: 'A',
          artist: 'B',
          album: 'C',
          albumArtist: 'D',
          trackNumber: 1,
          source: MP3,
        },
      ],
      false
    );

    const loaded = await loadDump(dump);
    try {
      expect(loaded.ipodRoot).toBe(dump);
      // The test iPod has no SysInfoExtended → serial degrades to undefined.
      expect(loaded.identity.serialNumber).toBeUndefined();
      // libgpod still classifies the model from the test DB.
      expect(loaded.db.getTracks().length).toBe(1);
    } finally {
      loaded.db.close();
    }
  });

  test('throws DUMP_NOT_READABLE when no iPod_Control is present', async () => {
    dump = await mkdtemp(join(tmpdir(), 'ipod-archive-empty-'));
    const err = await loadDump(dump).catch((e) => e);
    expect(err).toBeInstanceOf(IpodArchiveError);
    expect((err as IpodArchiveError).code).toBe('DUMP_NOT_READABLE');
  });
});

describe('writeTrack', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ipod-archive-tw-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('creates parent directories and copies the audio losslessly (no re-encode)', async () => {
    const dest = join(workdir, 'nested', 'dir', 'out.mp3');
    await writeTrack(MP3, dest, {
      title: 'T',
      artist: 'A',
      album: 'Al',
      albumArtist: 'AA',
      trackNumber: 4,
    });

    // The nested parents were created and a file landed.
    expect((await stat(dest)).isFile()).toBe(true);

    // The audio stream is untouched — same codec/duration/bitrate/rate/channels.
    expect(readAudioProps(dest)).toEqual(readAudioProps(MP3));

    // The requested tags read back.
    const file = TagFile.createFromPath(dest);
    try {
      expect(file.tag.title).toBe('T');
      expect(file.tag.performers).toEqual(['A']);
      expect(file.tag.albumArtists).toEqual(['AA']);
      expect(file.tag.track).toBe(4);
    } finally {
      file.dispose();
    }
  });

  test('a pure copy (no metadata) is byte-identical to the source', async () => {
    // With no tag fields to write, writeTrack must not rewrite the container —
    // the copy is bit-for-bit identical to the source.
    const dest = join(workdir, 'passthrough.mp3');
    const result = await writeTrack(MP3, dest, {});
    expect(result.outcome).toBe('tagged');
    expect(await readFile(dest)).toEqual(await readFile(MP3));
  });

  test('taglib success reports the fast path', async () => {
    const dest = join(workdir, 'fast.mp3');
    const result = await writeTrack(MP3, dest, { title: 'T' });
    expect(result.outcome).toBe('tagged');
    expect(result.reason).toBeUndefined();
  });

  test('falls back to ffmpeg when taglib cannot parse the file, and reports the reason', async () => {
    // A file that defeats taglib's frame-sync search but is still valid audio.
    const hostile = join(workdir, 'hostile-src.mp3');
    await makeTaglibHostileMp3(MP3, hostile);

    // The fallback is exercised via an injected runner so the test does not
    // depend on a real ffmpeg: it stands in for ffmpeg by producing the output
    // file the real tool would (here, the pristine source bytes).
    const dest = join(workdir, 'fallback.mp3');
    const calls: string[][] = [];
    const result = await writeTrack(
      hostile,
      dest,
      { title: 'T', artist: 'A' },
      {
        runFfmpeg: async (_binary, args) => {
          calls.push([...args]);
          // The last arg is the temp output path ffmpeg would write.
          const out = args[args.length - 1]!;
          await cp(hostile, out);
        },
      }
    );

    expect(result.outcome).toBe('fallback');
    expect(result.reason).toContain('MPEG audio header not found');
    // The runner was invoked once, reading the pristine source (not the dest).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(hostile);
    expect((await stat(dest)).isFile()).toBe(true);
  });

  test('keeps an untouched byte copy when both taglib and ffmpeg fail', async () => {
    const hostile = join(workdir, 'hostile-untagged-src.mp3');
    await makeTaglibHostileMp3(MP3, hostile);

    const dest = join(workdir, 'untagged.mp3');
    const result = await writeTrack(
      hostile,
      dest,
      { title: 'T' },
      {
        runFfmpeg: async () => {
          throw new Error('spawn ffmpeg ENOENT');
        },
      }
    );

    expect(result.outcome).toBe('untagged');
    // The reason carries both failures so the report explains what happened.
    expect(result.reason).toContain('taglib:');
    expect(result.reason).toContain('ffmpeg:');
    expect(result.reason).toContain('ENOENT');
    // The archived file is the pristine source — no audio lost, no half-write.
    expect(await readFile(dest)).toEqual(await readFile(hostile));
  });

  test.skipIf(!FFMPEG_AVAILABLE)(
    'real ffmpeg fallback losslessly tags a taglib-hostile file',
    async () => {
      const hostile = join(workdir, 'real-hostile-src.mp3');
      await makeTaglibHostileMp3(MP3, hostile);

      const dest = join(workdir, 'real-fallback.mp3');
      const result = await writeTrack(hostile, dest, {
        title: 'FB Title',
        artist: 'FB Artist',
        album: 'FB Album',
        trackNumber: 3,
      });

      expect(result.outcome).toBe('fallback');

      // After the ffmpeg remux taglib CAN open the file, and the tags read back.
      const file = TagFile.createFromPath(dest);
      try {
        expect(file.tag.title).toBe('FB Title');
        expect(file.tag.performers).toEqual(['FB Artist']);
        expect(file.tag.album).toBe('FB Album');
        expect(file.tag.track).toBe(3);
      } finally {
        file.dispose();
      }
    }
  );

  test.skipIf(!FFMPEG_AVAILABLE)('real ffmpeg fallback embeds the cover art (MP3)', async () => {
    const hostile = join(workdir, 'cover-hostile-src.mp3');
    await makeTaglibHostileMp3(MP3, hostile);

    const dest = join(workdir, 'cover-fallback.mp3');
    const result = await writeTrack(hostile, dest, { title: 'Covered', cover: makeCoverPng() });

    expect(result.outcome).toBe('fallback');
    const file = TagFile.createFromPath(dest);
    try {
      expect(file.tag.title).toBe('Covered');
      // The cover landed as a front-cover picture, not just text tags.
      expect(file.tag.pictures.length).toBeGreaterThan(0);
    } finally {
      file.dispose();
    }
  });

  test.skipIf(!FFMPEG_AVAILABLE)(
    'retagWithFfmpeg writes a valid cover-bearing M4A and omits the MP3-only flag',
    async () => {
      // M4A is the primary real-device format and a valid M4A never reaches the
      // fallback through taglib, so the ffmpeg remux is tested directly here.
      // Cover art in MP4 needs the attached-picture mapping and must NOT carry
      // `-id3v2_version` (an MP3-muxer option that errors on MP4 output).
      const dest = join(workdir, 'direct-fallback.m4a');
      let seenArgs: readonly string[] = [];
      await retagWithFfmpeg(
        M4A,
        dest,
        { title: 'Direct M4A', artist: 'A', cover: makeCoverPng() },
        'ffmpeg',
        async (binary, args) => {
          seenArgs = args;
          await runFfmpegDefault(binary, args);
        }
      );

      expect(seenArgs).not.toContain('-id3v2_version');
      expect(seenArgs).toContain('attached_pic');

      const file = TagFile.createFromPath(dest);
      try {
        expect(file.tag.title).toBe('Direct M4A');
        expect(file.tag.performers).toEqual(['A']);
        expect(file.tag.pictures.length).toBeGreaterThan(0);
      } finally {
        file.dispose();
      }
    }
  );

  test('M4A: copies losslessly and writes tags into MP4 atoms', async () => {
    const dest = join(workdir, 'nested', 'dir', 'out.m4a');
    await writeTrack(M4A, dest, {
      title: 'M4A Track',
      artist: 'Some Artist',
      album: 'Some Album',
      albumArtist: 'Some Album Artist',
      trackNumber: 3,
    });

    // File was created.
    expect((await stat(dest)).isFile()).toBe(true);

    // Audio stream properties are unchanged (lossless copy, no re-encode).
    expect(readAudioProps(dest)).toEqual(readAudioProps(M4A));

    // Tags read back from the MP4 atoms.
    const file = TagFile.createFromPath(dest);
    try {
      expect(file.tag.title).toBe('M4A Track');
      expect(file.tag.performers).toEqual(['Some Artist']);
      expect(file.tag.albumArtists).toEqual(['Some Album Artist']);
      expect(file.tag.track).toBe(3);
    } finally {
      file.dispose();
    }
  });
});
