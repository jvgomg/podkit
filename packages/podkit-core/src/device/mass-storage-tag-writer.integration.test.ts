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

import { TagLibTagWriter, type TagFields } from './mass-storage-tag-writer.js';

// =============================================================================
// Helpers
// =============================================================================

function createTempDir(): string {
  return fs.mkdtempSync(path.join(tmpdir(), 'podkit-tag-writer-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Generate a minimal FLAC file with a sine tone */
function generateFlac(dir: string, filename: string, comment?: string): string {
  const outPath = path.join(dir, filename);
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1:sample_rate=44100',
    '-c:a',
    'flac',
    '-ar',
    '44100',
    '-metadata',
    'title=Test Song',
    '-metadata',
    'artist=Test Artist',
  ];
  if (comment) {
    args.push('-metadata', `comment=${comment}`);
  }
  args.push(outPath);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });

  // FFmpeg maps -metadata comment to DESCRIPTION, not COMMENT.
  // Use node-taglib-sharp to set the real COMMENT field for test setup.
  if (comment) {
    const { File: TagFile } = require('node-taglib-sharp');
    const file = TagFile.createFromPath(outPath);
    file.tag.comment = comment;
    file.save();
    file.dispose();
  }

  return outPath;
}

/** Generate a minimal M4A file */
function generateM4a(dir: string, filename: string, comment?: string): string {
  const outPath = path.join(dir, filename);
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1:sample_rate=44100',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-metadata',
    'title=Test Song',
    '-metadata',
    'artist=Test Artist',
  ];
  if (comment) {
    args.push('-metadata', `comment=${comment}`);
  }
  args.push('-f', 'ipod', outPath);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });
  return outPath;
}

/** Generate a minimal MP3 file */
function generateMp3(dir: string, filename: string, comment?: string): string {
  const outPath = path.join(dir, filename);
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1:sample_rate=44100',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    '-metadata',
    'title=Test Song',
    '-metadata',
    'artist=Test Artist',
  ];
  args.push(outPath);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });

  if (comment) {
    // FFmpeg maps comment to TXXX:comment for MP3, not COMM.
    // Set it properly via node-taglib-sharp after generation.
    const { File: TagFile } = require('node-taglib-sharp');
    const file = TagFile.createFromPath(outPath);
    file.tag.comment = comment;
    file.save();
    file.dispose();
  }

  return outPath;
}

/**
 * Whether the local FFmpeg build was compiled with libvorbis support. The
 * macOS Homebrew default omits it; CI Linux builds usually include it.
 * OGG-format tests skip when this is false rather than fail spuriously.
 */
const HAS_LIBVORBIS = (() => {
  try {
    const out = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return /\blibvorbis\b/.test(out);
  } catch {
    return false;
  }
})();

/** Generate a minimal OGG Vorbis file. Caller must guard on HAS_LIBVORBIS. */
function generateOgg(dir: string, filename: string): string {
  const outPath = path.join(dir, filename);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=44100',
      '-c:a',
      'libvorbis',
      '-q:a',
      '4',
      '-metadata',
      'title=Test Song',
      '-metadata',
      'artist=Test Artist',
      outPath,
    ],
    { stdio: 'pipe' }
  );
  return outPath;
}

/** Generate a minimal OGG/Opus file */
function generateOpus(dir: string, filename: string): string {
  const outPath = path.join(dir, filename);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1:sample_rate=48000',
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      '-metadata',
      'title=Test Song',
      '-metadata',
      'artist=Test Artist',
      '-vn',
      outPath,
    ],
    { stdio: 'pipe' }
  );
  return outPath;
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

    test.skipIf(!HAS_LIBVORBIS)('OGG: writes comment', async () => {
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

    test.skipIf(!HAS_LIBVORBIS)('OGG: round-trips every supported field', async () => {
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
});
