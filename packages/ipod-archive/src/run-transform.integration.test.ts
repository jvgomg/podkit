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
import { mkdtemp, mkdir, rm, readFile, stat, cp, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { File as TagFile } from 'node-taglib-sharp';
import { createTestIpod } from '@podkit/gpod-testing';
import { Database } from '@podkit/libgpod-node';
import { runTransform } from './run-transform.js';
import { writeTrack } from './tag-writer.js';
import { loadDump } from './dump-loader.js';
import { IpodArchiveError } from './errors.js';

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
    await writeTrack(MP3, dest, {});
    expect(await readFile(dest)).toEqual(await readFile(MP3));
  });

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
