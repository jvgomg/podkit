/**
 * Tests for TagLibTagWriter
 *
 * Integration tests that create real audio files, write comment tags
 * via node-taglib-sharp, and read them back with music-metadata to
 * verify the round-trip works across FLAC, M4A, and MP3 containers.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as mm from 'music-metadata';

import { TagLibTagWriter } from './mass-storage-tag-writer.js';

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
  if (comment) {
    // FFmpeg maps comment to TXXX:comment for MP3, not COMM.
    // Set it properly via node-taglib-sharp after generation.
  }
  args.push(outPath);
  execFileSync('ffmpeg', args, { stdio: 'pipe' });

  if (comment) {
    const { File: TagFile } = require('node-taglib-sharp');
    const file = TagFile.createFromPath(outPath);
    file.tag.comment = comment;
    file.save();
    file.dispose();
  }

  return outPath;
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

  describe('FLAC files', () => {
    test('writes comment to file without existing comment', async () => {
      const filePath = generateFlac(tempDir, 'no-comment.flac');
      const syncTag = '[podkit:v1 quality=high encoding=vbr]';

      await writer.writeComment(filePath, syncTag);

      const comment = await readComment(filePath);
      expect(comment).toBe(syncTag);
    });

    test('overwrites existing comment', async () => {
      const filePath = generateFlac(tempDir, 'has-comment.flac', 'original comment');
      const syncTag = '[podkit:v1 quality=medium encoding=cbr]';

      await writer.writeComment(filePath, syncTag);

      const comment = await readComment(filePath);
      expect(comment).toBe(syncTag);
    });

    test('preserves other metadata after write', async () => {
      const filePath = generateFlac(tempDir, 'preserve-meta.flac');

      await writer.writeComment(filePath, 'sync tag');

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Test Song');
      expect(metadata.common.artist).toBe('Test Artist');
    });

    test('preserves audio data (file is still valid)', async () => {
      const filePath = generateFlac(tempDir, 'valid-audio.flac');
      const sizeBefore = fs.statSync(filePath).size;

      await writer.writeComment(filePath, '[podkit:v1 quality=high]');

      const sizeAfter = fs.statSync(filePath).size;
      // File size should be similar (comment adds a few bytes, no re-encoding)
      expect(Math.abs(sizeAfter - sizeBefore)).toBeLessThan(1000);

      // Should still parse without error
      const metadata = await mm.parseFile(filePath, { duration: true });
      expect(metadata.format.duration).toBeGreaterThan(0);
    });
  });

  describe('M4A files', () => {
    test('writes comment to M4A file', async () => {
      const filePath = generateM4a(tempDir, 'test.m4a');
      const syncTag = '[podkit:v1 quality=high encoding=vbr art=a1b2c3d4]';

      await writer.writeComment(filePath, syncTag);

      const comment = await readComment(filePath);
      expect(comment).toBe(syncTag);
    });

    test('preserves metadata in M4A', async () => {
      const filePath = generateM4a(tempDir, 'preserve.m4a');

      await writer.writeComment(filePath, 'sync tag');

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Test Song');
      expect(metadata.common.artist).toBe('Test Artist');
    });
  });

  describe('MP3 files', () => {
    test('writes comment to MP3 file', async () => {
      const filePath = generateMp3(tempDir, 'test.mp3');
      const syncTag = '[podkit:v1 quality=copy transfer=fast]';

      await writer.writeComment(filePath, syncTag);

      const comment = await readComment(filePath);
      expect(comment).toBe(syncTag);
    });

    test('preserves metadata in MP3', async () => {
      const filePath = generateMp3(tempDir, 'preserve.mp3');

      await writer.writeComment(filePath, 'sync tag');

      const metadata = await mm.parseFile(filePath, { skipCovers: true });
      expect(metadata.common.title).toBe('Test Song');
      expect(metadata.common.artist).toBe('Test Artist');
    });
  });

  describe('edge cases', () => {
    test('handles sync tag with all fields', async () => {
      const filePath = generateFlac(tempDir, 'full-tag.flac');
      const syncTag = '[podkit:v1 quality=high encoding=vbr art=abcd1234 transfer=optimized]';

      await writer.writeComment(filePath, syncTag);

      const comment = await readComment(filePath);
      expect(comment).toBe(syncTag);
    });

    test('successive writes update the comment', async () => {
      const filePath = generateFlac(tempDir, 'successive.flac');

      await writer.writeComment(filePath, '[podkit:v1 quality=high]');
      await writer.writeComment(filePath, '[podkit:v1 quality=high art=deadbeef]');

      const comment = await readComment(filePath);
      expect(comment).toBe('[podkit:v1 quality=high art=deadbeef]');
    });

    test('does not leave temp files', async () => {
      const filePath = generateFlac(tempDir, 'cleanup.flac');

      await writer.writeComment(filePath, 'tag');

      // Only the original file should exist
      const files = fs.readdirSync(tempDir);
      expect(files).toEqual(['cleanup.flac']);
    });

    test('throws for nonexistent file', async () => {
      await expect(
        writer.writeComment(path.join(tempDir, 'nonexistent.flac'), 'tag')
      ).rejects.toThrow();
    });
  });

  describe('writePicture', () => {
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

    test('embeds artwork in OGG/Opus file', async () => {
      const filePath = generateOpus(tempDir, 'test.opus');
      const imageData = generateTestImage();

      await writer.writePicture(filePath, imageData);

      // Verify artwork was embedded by reading back with music-metadata
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

      // Should still parse without error
      const metadata = await mm.parseFile(filePath, { duration: true });
      expect(metadata.format.duration).toBeGreaterThan(0);
    });
  });
});
