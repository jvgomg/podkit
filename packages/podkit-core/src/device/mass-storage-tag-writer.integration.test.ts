/**
 * Tests for TagLibTagWriter
 *
 * Integration tests that create real audio files, write tags via
 * node-taglib-sharp, and read them back with music-metadata to verify the
 * round-trip works across FLAC, MP3, M4A, OGG, and Opus containers.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as mm from 'music-metadata';
import {
  generateMiniFlac,
  generateMiniM4a,
  generateMiniMp3,
  generateMiniOggOpus,
  generateMiniOggVorbis,
  requireFFmpeg,
} from '@podkit/test-fixtures';
import { PODKIT_TEMP_SUFFIX } from '../utils/atomic-fs.js';
import { TagLibTagWriter, type TagFields } from './mass-storage-tag-writer.js';

requireFFmpeg();

// =============================================================================
// Helpers
// =============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'podkit-tag-writer-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Overwrite the COMMENT tag on a freshly-generated audio file.
 *
 * ffmpeg's `-metadata comment=...` maps to DESCRIPTION in FLAC's Vorbis
 * Comments and to TXXX:comment in MP3 ID3v2 — neither of which is the
 * field the tag writer reads back as `comment`. We let test-fixtures
 * lay the file down with the rest of the metadata, then re-open via
 * node-taglib-sharp to set the real COMMENT field for tests that need
 * to verify comment round-tripping.
 */
function setComment(filePath: string, comment: string): void {
  const { File: TagFile } = require('node-taglib-sharp');
  const file = TagFile.createFromPath(filePath);
  file.tag.comment = comment;
  file.save();
  file.dispose();
}

function generateFlac(dir: string, filename: string, comment?: string): string {
  const outPath = generateMiniFlac(dir, { filename, comment });
  if (comment) setComment(outPath, comment);
  return outPath;
}

function generateM4a(dir: string, filename: string, comment?: string): string {
  return generateMiniM4a(dir, { filename, comment });
}

function generateMp3(dir: string, filename: string, comment?: string): string {
  const outPath = generateMiniMp3(dir, { filename });
  if (comment) setComment(outPath, comment);
  return outPath;
}

function generateOgg(dir: string, filename: string): string {
  return generateMiniOggVorbis(dir, { filename });
}

function generateOpus(dir: string, filename: string): string {
  return generateMiniOggOpus(dir, { filename });
}

/** Generate a minimal JPEG image using FFmpeg */
function generateTestImage(width = 100, height = 100): Buffer {
  const result = execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=red:size=${width}x${height}:duration=1:rate=1`,
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return Buffer.from(result);
}

/** Read the comment tag from an audio file using music-metadata */
async function readComment(filePath: string): Promise<string | undefined> {
  const metadata = await mm.parseFile(filePath, { skipCovers: true });
  const comments = metadata.common.comment;
  if (!comments || comments.length === 0) return undefined;
  const first = comments[0];
  if (typeof first === 'string') return first;
  return first?.text;
}

// =============================================================================
// Tests
// =============================================================================

describe('TagLibTagWriter', () => {
  let tempDir: string;
  let writer: TagLibTagWriter;

  beforeEach(() => {
    tempDir = createTempDir();
    writer = new TagLibTagWriter();
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  // ---------------------------------------------------------------------------
  // writeTags — per-format round-trips
  // ---------------------------------------------------------------------------

  describe('writeTags — comment-only (sync-tag path)', () => {
    test('FLAC: writes comment to file without existing comment', async () => {
      const filePath = generateFlac(tempDir, 'no-comment.flac');
      const syncTag = '[podkit:v1 quality=high encoding=vbr]';

      await writer.writeTags(filePath, { comment: syncTag });

      expect(await readComment(filePath)).toBe(syncTag);
    });

    test('FLAC: overwrites existing comment', async () => {
      const filePath = generateFlac(tempDir, 'has-comment.flac', 'original');
      const syncTag = '[podkit:v1 quality=medium encoding=cbr]';

      await writer.writeTags(filePath, { comment: syncTag });

      expect(await readComment(filePath)).toBe(syncTag);
    });

    test('M4A: writes comment', async () => {
      const filePath = generateM4a(tempDir, 'test.m4a');
      const syncTag = '[podkit:v1 quality=high art=a1b2c3d4]';

      await writer.writeTags(filePath, { comment: syncTag });

      expect(await readComment(filePath)).toBe(syncTag);
    });

    test('MP3: writes comment', async () => {
      const filePath = generateMp3(tempDir, 'test.mp3');
      const syncTag = '[podkit:v1 quality=copy transfer=fast]';

      await writer.writeTags(filePath, { comment: syncTag });

      expect(await readComment(filePath)).toBe(syncTag);
    });

    test('Opus: writes comment', async () => {
      const filePath = generateOpus(tempDir, 'test.opus');
      const syncTag = '[podkit:v1 quality=high]';

      await writer.writeTags(filePath, { comment: syncTag });

      expect(await readComment(filePath)).toBe(syncTag);
    });

    test('OGG: writes comment', async () => {
      const filePath = generateOgg(tempDir, 'test.ogg');
      const syncTag = '[podkit:v1 quality=high]';

      await writer.writeTags(filePath, { comment: syncTag });

      expect(await readComment(filePath)).toBe(syncTag);
    });

    test('preserves audio data and other metadata', async () => {
      const filePath = generateFlac(tempDir, 'preserve.flac');
      const sizeBefore = fs.statSync(filePath).size;

      await writer.writeTags(filePath, { comment: '[podkit:v1 quality=high]' });

      const sizeAfter = fs.statSync(filePath).size;
      expect(Math.abs(sizeAfter - sizeBefore)).toBeLessThan(1000);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Test Song');
      expect(metadata.common.artist).toBe('Test Artist');
      expect(metadata.format.duration).toBeGreaterThan(0);
    });
  });

  describe('writeTags — full metadata field coverage', () => {
    // Cover the full set of textual metadata fields across the formats
    // podkit actually produces as device-resident output. WAV/AIFF are
    // skipped — taglib coverage on those is fragile and the formats are
    // exceedingly rare on portable devices.

    const fullFields: TagFields = {
      title: 'New Title',
      artist: 'New Artist',
      albumArtist: 'New Album Artist',
      album: 'New Album',
      genre: 'New Genre',
      year: 2030,
      trackNumber: 7,
      discNumber: 2,
      compilation: true,
      comment: '[podkit:v1 quality=high]',
    };

    function assertAllFields(metadata: mm.IAudioMetadata): void {
      expect(metadata.common.title).toBe('New Title');
      expect(metadata.common.artist).toBe('New Artist');
      expect(metadata.common.albumartist).toBe('New Album Artist');
      expect(metadata.common.album).toBe('New Album');
      expect(metadata.common.genre).toEqual(['New Genre']);
      expect(metadata.common.year).toBe(2030);
      expect(metadata.common.track.no).toBe(7);
      expect(metadata.common.disk.no).toBe(2);
      expect(metadata.common.compilation).toBe(true);
    }

    test('FLAC: round-trips every supported field', async () => {
      const filePath = generateFlac(tempDir, 'full.flac');
      await writer.writeTags(filePath, fullFields);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      assertAllFields(metadata);
      expect(await readComment(filePath)).toBe(fullFields.comment);
    });

    test('MP3: round-trips every supported field', async () => {
      const filePath = generateMp3(tempDir, 'full.mp3');
      await writer.writeTags(filePath, fullFields);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      assertAllFields(metadata);
      expect(await readComment(filePath)).toBe(fullFields.comment);
    });

    test('M4A: round-trips every supported field', async () => {
      const filePath = generateM4a(tempDir, 'full.m4a');
      await writer.writeTags(filePath, fullFields);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      assertAllFields(metadata);
      expect(await readComment(filePath)).toBe(fullFields.comment);
    });

    test('Opus: round-trips every supported field', async () => {
      const filePath = generateOpus(tempDir, 'full.opus');
      await writer.writeTags(filePath, fullFields);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      assertAllFields(metadata);
      expect(await readComment(filePath)).toBe(fullFields.comment);
    });

    test('OGG: round-trips every supported field', async () => {
      const filePath = generateOgg(tempDir, 'full.ogg');
      await writer.writeTags(filePath, fullFields);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      assertAllFields(metadata);
      expect(await readComment(filePath)).toBe(fullFields.comment);
    });
  });

  describe('writeTags — partial updates and edge cases', () => {
    test('undefined fields leave existing values untouched', async () => {
      const filePath = generateFlac(tempDir, 'partial.flac');
      // Seed with a full set.
      await writer.writeTags(filePath, {
        title: 'Original Title',
        artist: 'Original Artist',
        albumArtist: 'Original AA',
        album: 'Original Album',
      });

      // Update only albumArtist.
      await writer.writeTags(filePath, { albumArtist: 'Renamed AA' });

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Original Title');
      expect(metadata.common.artist).toBe('Original Artist');
      expect(metadata.common.albumartist).toBe('Renamed AA');
      expect(metadata.common.album).toBe('Original Album');
    });

    test('successive comment writes coalesce on disk to the latest value', async () => {
      const filePath = generateFlac(tempDir, 'successive.flac');

      await writer.writeTags(filePath, { comment: '[podkit:v1 quality=high]' });
      await writer.writeTags(filePath, { comment: '[podkit:v1 quality=high art=deadbeef]' });

      expect(await readComment(filePath)).toBe('[podkit:v1 quality=high art=deadbeef]');
    });

    test('toggling compilation off removes the flag', async () => {
      const filePath = generateFlac(tempDir, 'compilation.flac');

      await writer.writeTags(filePath, { compilation: true });
      let metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.compilation).toBe(true);

      await writer.writeTags(filePath, { compilation: false });
      metadata = await mm.parseFile(filePath, { skipCovers: true });
      // music-metadata reports unset/false as undefined; either is acceptable
      // as long as it is not still true.
      expect(metadata.common.compilation === true).toBe(false);
    });

    test('Unicode field values round-trip', async () => {
      const filePath = generateFlac(tempDir, 'unicode.flac');

      await writer.writeTags(filePath, {
        title: 'Café Mañana — 日本語',
        artist: 'Björk',
        albumArtist: 'Björk',
      });

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Café Mañana — 日本語');
      expect(metadata.common.artist).toBe('Björk');
    });

    test('does not leave temp files', async () => {
      const filePath = generateFlac(tempDir, 'cleanup.flac');

      await writer.writeTags(filePath, { comment: 'tag' });

      const files = fs.readdirSync(tempDir);
      expect(files).toEqual(['cleanup.flac']);
    });

    test('throws for nonexistent file', async () => {
      await expect(
        writer.writeTags(path.join(tempDir, 'nonexistent.flac'), { comment: 'tag' })
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // writeTags — ReplayGain round-trip across containers
  // ---------------------------------------------------------------------------

  describe('writeTags — ReplayGain', () => {
    /**
     * Re-open via the same taglib bindings podkit ships with and read back
     * the four ReplayGain accessors. Validates the in-and-out cycle goes
     * through the format-specific tag block (Vorbis comments on FLAC/OGG/
     * Opus, TXXX:REPLAYGAIN_* on MP3, iTunes-style atoms on M4A) without
     * the caller having to care which dialect was used.
     */
    function readReplayGain(filePath: string): {
      trackGain: number;
      trackPeak: number;
      albumGain: number;
      albumPeak: number;
    } {
      const { File: TagFile } = require('node-taglib-sharp');
      const file = TagFile.createFromPath(filePath);
      try {
        return {
          trackGain: file.tag.replayGainTrackGain,
          trackPeak: file.tag.replayGainTrackPeak,
          albumGain: file.tag.replayGainAlbumGain,
          albumPeak: file.tag.replayGainAlbumPeak,
        };
      } finally {
        file.dispose();
      }
    }

    /** Per-format coverage of all four fields round-tripping cleanly. */
    const cases: Array<{
      format: 'FLAC' | 'MP3' | 'M4A' | 'OGG' | 'Opus';
      generate: (dir: string, filename: string) => string;
      ext: string;
    }> = [
      { format: 'FLAC', generate: (d, n) => generateFlac(d, n), ext: 'flac' },
      { format: 'MP3', generate: (d, n) => generateMp3(d, n), ext: 'mp3' },
      { format: 'M4A', generate: (d, n) => generateM4a(d, n), ext: 'm4a' },
      // OGG/Vorbis and Opus share Vorbis comments but the container framing
      // differs; both are exercised to catch any per-format quirk.
      { format: 'OGG', generate: (d, n) => generateOgg(d, n), ext: 'ogg' },
      { format: 'Opus', generate: (d, n) => generateOpus(d, n), ext: 'opus' },
    ];

    for (const c of cases) {
      test(`${c.format}: writes all four ReplayGain fields and reads them back`, async () => {
        const filePath = c.generate(tempDir, `rg-all.${c.ext}`);
        await writer.writeTags(filePath, {
          replayGain: {
            trackGain: -7.42,
            trackPeak: 0.9876,
            albumGain: -6.5,
            albumPeak: 0.99,
          },
        });

        const observed = readReplayGain(filePath);
        // Tag formats serialise these as strings ("-7.42 dB", "0.987600",
        // …) and taglib parses them back into floats, so allow a tiny
        // tolerance for round-trip drift.
        expect(observed.trackGain).toBeCloseTo(-7.42, 2);
        expect(observed.trackPeak).toBeCloseTo(0.9876, 4);
        expect(observed.albumGain).toBeCloseTo(-6.5, 2);
        expect(observed.albumPeak).toBeCloseTo(0.99, 2);
      });

      test(`${c.format}: writes only trackGain when other fields are absent`, async () => {
        const filePath = c.generate(tempDir, `rg-track-only.${c.ext}`);
        await writer.writeTags(filePath, {
          replayGain: { trackGain: -3.21 },
        });

        const observed = readReplayGain(filePath);
        expect(observed.trackGain).toBeCloseTo(-3.21, 2);
      });

      test(`${c.format}: coalesces textual + ReplayGain in one save`, async () => {
        // The whole point of the refactor: when both kinds of update fire,
        // they ride on one taglib roundtrip. We can't observe the I/O
        // directly through music-metadata, but we can prove the writeTags
        // call accepts both and both survive the round-trip.
        const filePath = c.generate(tempDir, `rg-combined.${c.ext}`);
        await writer.writeTags(filePath, {
          title: 'Coalesced Title',
          artist: 'Coalesced Artist',
          replayGain: { trackGain: -4.0, trackPeak: 0.5 },
        });

        const observed = readReplayGain(filePath);
        expect(observed.trackGain).toBeCloseTo(-4.0, 2);
        expect(observed.trackPeak).toBeCloseTo(0.5, 4);
        const metadata = await mm.parseFile(filePath, { skipCovers: true });
        expect(metadata.common.title).toBe('Coalesced Title');
        expect(metadata.common.artist).toBe('Coalesced Artist');
      });
    }

    test('FLAC: omitting replayGain leaves existing tags untouched', async () => {
      const filePath = generateFlac(tempDir, 'rg-leave.flac');
      await writer.writeTags(filePath, {
        replayGain: { trackGain: -2.0, trackPeak: 0.7 },
      });
      // Subsequent write with no replayGain field must not clobber.
      await writer.writeTags(filePath, { title: 'New Title' });

      const observed = readReplayGain(filePath);
      expect(observed.trackGain).toBeCloseTo(-2.0, 2);
      expect(observed.trackPeak).toBeCloseTo(0.7, 4);
    });
  });

  // ---------------------------------------------------------------------------
  // writePicture (unchanged — kept as a separate concern from textual tags)
  // ---------------------------------------------------------------------------

  describe('writePicture', () => {
    test('embeds artwork in OGG/Opus file', async () => {
      const filePath = generateOpus(tempDir, 'test.opus');
      const imageData = generateTestImage();

      await writer.writePicture(filePath, imageData);

      const metadata = await mm.parseFile(filePath, { skipCovers: false });
      expect(metadata.common.picture).toBeDefined();
      expect(metadata.common.picture!.length).toBeGreaterThanOrEqual(1);
      expect(metadata.common.picture![0]!.format).toBe('image/jpeg');
      expect(metadata.common.picture![0]!.data.length).toBeGreaterThan(0);
    });

    test('preserves other metadata after picture write', async () => {
      const filePath = generateOpus(tempDir, 'preserve.opus');
      const imageData = generateTestImage();

      await writer.writePicture(filePath, imageData);

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Test Song');
      expect(metadata.common.artist).toBe('Test Artist');
    });

    test('embeds artwork in FLAC file', async () => {
      const filePath = generateFlac(tempDir, 'test-pic.flac');
      const imageData = generateTestImage();

      await writer.writePicture(filePath, imageData);

      const metadata = await mm.parseFile(filePath, { skipCovers: false });
      expect(metadata.common.picture).toBeDefined();
      expect(metadata.common.picture!.length).toBeGreaterThanOrEqual(1);
      expect(metadata.common.picture![0]!.format).toBe('image/jpeg');
    });

    test('preserves audio data (file is still valid)', async () => {
      const filePath = generateOpus(tempDir, 'valid.opus');
      const imageData = generateTestImage();

      await writer.writePicture(filePath, imageData);

      const metadata = await mm.parseFile(filePath, { duration: true });
      expect(metadata.format.duration).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Atomic write contract — pinning the tmp + rename guarantee
  //
  // These tests assert that writeTags and writePicture use the atomic-write
  // path: on success no .podkit-tmp remains; on rename failure the original
  // file body is untouched and no .podkit-tmp leaks to disk.
  // ---------------------------------------------------------------------------

  describe('atomic write contract', () => {
    test('writeTags: no .podkit-tmp left on success', async () => {
      const filePath = generateFlac(tempDir, 'atomic-tags.flac');

      await writer.writeTags(filePath, { comment: 'atomic-write-test' });

      const files = fs.readdirSync(tempDir);
      expect(files.some((f) => f.endsWith(PODKIT_TEMP_SUFFIX))).toBe(false);
    });

    test('writePicture: no .podkit-tmp left on success', async () => {
      const filePath = generateOpus(tempDir, 'atomic-pic.opus');
      const imageData = generateTestImage();

      await writer.writePicture(filePath, imageData);

      const files = fs.readdirSync(tempDir);
      expect(files.some((f) => f.endsWith(PODKIT_TEMP_SUFFIX))).toBe(false);
    });

    test('writeTags: rename failure leaves original file unchanged and no .podkit-tmp', async () => {
      const filePath = generateFlac(tempDir, 'rename-fail-tags.flac');
      const originalBytes = fs.readFileSync(filePath);

      const realRename = fs.promises.rename;
      (fs.promises as { rename: typeof fs.promises.rename }).rename = () =>
        Promise.reject(new Error('simulated rename failure'));
      try {
        await expect(writer.writeTags(filePath, { comment: 'should-not-land' })).rejects.toThrow(
          'simulated rename failure'
        );
        // Original file body must be intact — the rename never ran.
        expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);
        // No leaked .podkit-tmp debris.
        expect(fs.existsSync(filePath + PODKIT_TEMP_SUFFIX)).toBe(false);
      } finally {
        (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
      }
    });

    test('writePicture: rename failure leaves original file unchanged and no .podkit-tmp', async () => {
      const filePath = generateOpus(tempDir, 'rename-fail-pic.opus');
      const originalBytes = fs.readFileSync(filePath);
      const imageData = generateTestImage();

      const realRename = fs.promises.rename;
      (fs.promises as { rename: typeof fs.promises.rename }).rename = () =>
        Promise.reject(new Error('simulated rename failure'));
      try {
        await expect(writer.writePicture(filePath, imageData)).rejects.toThrow(
          'simulated rename failure'
        );
        expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);
        expect(fs.existsSync(filePath + PODKIT_TEMP_SUFFIX)).toBe(false);
      } finally {
        (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
      }
    });
  });
});
