/**
 * Integration tests for `sweepDeviceContent`.
 *
 * All tests operate on a temp directory that mimics an iPod's `iPod_Control`
 * tree — never a real device. The headline case asserts that an *orphan* audio
 * file (one no database references) is still removed, since the sweep walks the
 * disk, not the database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sweepDeviceContent, SweepContentError } from './sweep-device-content.js';

let root: string;

/**
 * Build a temp iPod tree with audio files under Music/F00 + F01 and artwork
 * files under Artwork. Returns the mount path (the temp root).
 */
function makeIpodTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'podkit-sweep-'));
  const musicF00 = join(dir, 'iPod_Control', 'Music', 'F00');
  const musicF01 = join(dir, 'iPod_Control', 'Music', 'F01');
  const artwork = join(dir, 'iPod_Control', 'Artwork');
  const itunes = join(dir, 'iPod_Control', 'iTunes');
  mkdirSync(musicF00, { recursive: true });
  mkdirSync(musicF01, { recursive: true });
  mkdirSync(artwork, { recursive: true });
  mkdirSync(itunes, { recursive: true });

  writeFileSync(join(musicF00, 'AAAA.mp3'), Buffer.alloc(1024, 1));
  writeFileSync(join(musicF00, 'BBBB.m4a'), Buffer.alloc(2048, 1));
  // Orphan: a file no database row references — must still be swept.
  writeFileSync(join(musicF01, 'ORPHAN.mp3'), Buffer.alloc(512, 1));

  writeFileSync(join(artwork, 'F1015_1.ithmb'), Buffer.alloc(4096, 1));
  writeFileSync(join(artwork, 'ArtworkDB'), Buffer.alloc(256, 1));

  // A non-content file that must survive (iTunesDB lives elsewhere, but prove
  // we don't touch unrelated files in the Artwork dir).
  writeFileSync(join(artwork, 'ArtworkDB.corrupt-backup'), Buffer.alloc(64, 1));

  return dir;
}

beforeEach(() => {
  root = makeIpodTree();
});

afterEach(() => {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('sweepDeviceContent: full wipe', () => {
  it('removes all audio (including orphans) and all artwork', () => {
    const result = sweepDeviceContent(root, { music: true, artwork: true });

    // 3 audio files (2 in F00 + 1 orphan in F01)
    expect(result.musicFilesRemoved).toBe(3);
    // 2 artwork files (.ithmb + ArtworkDB), NOT the .corrupt-backup
    expect(result.artworkFilesRemoved).toBe(2);
    expect(result.bytesFreed).toBe(1024 + 2048 + 512 + 4096 + 256);
    expect(result.musicSwept).toBe(true);
    expect(result.artworkSwept).toBe(true);

    const f00 = join(root, 'iPod_Control', 'Music', 'F00');
    const f01 = join(root, 'iPod_Control', 'Music', 'F01');
    const artwork = join(root, 'iPod_Control', 'Artwork');

    // Audio gone, F-dir skeleton preserved.
    expect(existsSync(f00)).toBe(true);
    expect(existsSync(f01)).toBe(true);
    expect(readdirSync(f00)).toHaveLength(0);
    expect(readdirSync(f01)).toHaveLength(0);
    // Orphan removed.
    expect(existsSync(join(f01, 'ORPHAN.mp3'))).toBe(false);

    // .ithmb + ArtworkDB gone; unrelated file survives.
    expect(existsSync(join(artwork, 'F1015_1.ithmb'))).toBe(false);
    expect(existsSync(join(artwork, 'ArtworkDB'))).toBe(false);
    expect(existsSync(join(artwork, 'ArtworkDB.corrupt-backup'))).toBe(true);
  });
});

describe('sweepDeviceContent: toggles', () => {
  it('music: false leaves audio, removes artwork', () => {
    const result = sweepDeviceContent(root, { music: false, artwork: true });
    expect(result.musicFilesRemoved).toBe(0);
    expect(result.artworkFilesRemoved).toBe(2);
    expect(result.musicSwept).toBe(false);
    expect(result.artworkSwept).toBe(true);

    expect(existsSync(join(root, 'iPod_Control', 'Music', 'F00', 'AAAA.mp3'))).toBe(true);
    expect(existsSync(join(root, 'iPod_Control', 'Artwork', 'ArtworkDB'))).toBe(false);
  });

  it('artwork: false removes audio, leaves artwork', () => {
    const result = sweepDeviceContent(root, { music: true, artwork: false });
    expect(result.musicFilesRemoved).toBe(3);
    expect(result.artworkFilesRemoved).toBe(0);
    expect(result.musicSwept).toBe(true);
    expect(result.artworkSwept).toBe(false);

    expect(existsSync(join(root, 'iPod_Control', 'Music', 'F00', 'AAAA.mp3'))).toBe(false);
    expect(existsSync(join(root, 'iPod_Control', 'Artwork', 'F1015_1.ithmb'))).toBe(true);
  });

  it('defaults to sweeping both', () => {
    const result = sweepDeviceContent(root);
    expect(result.musicSwept).toBe(true);
    expect(result.artworkSwept).toBe(true);
    expect(result.musicFilesRemoved).toBe(3);
    expect(result.artworkFilesRemoved).toBe(2);
  });
});

describe('sweepDeviceContent: database branch', () => {
  it('deletes track-referencing DB files but preserves settings/control files', () => {
    const itunes = join(root, 'iPod_Control', 'iTunes');
    // Track-referencing DB files that must be removed.
    writeFileSync(join(itunes, 'iTunesDB'), Buffer.alloc(2048, 1));
    writeFileSync(join(itunes, 'iTunesCDB'), Buffer.alloc(1024, 1));
    writeFileSync(join(itunes, 'Play Counts'), Buffer.alloc(128, 1));
    writeFileSync(join(itunes, 'OTGPlaylistInfo'), Buffer.alloc(64, 1));
    // Settings / control files that must SURVIVE.
    writeFileSync(join(itunes, 'iTunesPrefs'), Buffer.alloc(32, 1));
    writeFileSync(join(itunes, 'iTunesControl'), Buffer.alloc(16, 1));

    const result = sweepDeviceContent(root, { music: false, artwork: false, database: true });

    expect(result.databaseSwept).toBe(true);
    expect(result.databaseFilesRemoved).toBe(4);
    expect(existsSync(join(itunes, 'iTunesDB'))).toBe(false);
    expect(existsSync(join(itunes, 'iTunesCDB'))).toBe(false);
    expect(existsSync(join(itunes, 'Play Counts'))).toBe(false);
    expect(existsSync(join(itunes, 'OTGPlaylistInfo'))).toBe(false);
    // Survivors.
    expect(existsSync(join(itunes, 'iTunesPrefs'))).toBe(true);
    expect(existsSync(join(itunes, 'iTunesControl'))).toBe(true);
  });

  it('database: false leaves the iTunesDB intact', () => {
    const itunes = join(root, 'iPod_Control', 'iTunes');
    writeFileSync(join(itunes, 'iTunesDB'), Buffer.alloc(2048, 1));

    const result = sweepDeviceContent(root, { music: true, artwork: true, database: false });

    expect(result.databaseSwept).toBe(false);
    expect(result.databaseFilesRemoved).toBe(0);
    expect(existsSync(join(itunes, 'iTunesDB'))).toBe(true);
  });
});

describe('sweepDeviceContent: safety guard', () => {
  it('rejects an empty mount path', () => {
    expect(() => sweepDeviceContent('')).toThrow(SweepContentError);
    try {
      sweepDeviceContent('   ');
    } catch (err) {
      expect(err).toBeInstanceOf(SweepContentError);
      expect((err as SweepContentError).code).toBe('INVALID_MOUNT_PATH');
    }
  });

  it('rejects the filesystem root', () => {
    try {
      sweepDeviceContent('/');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SweepContentError);
      expect((err as SweepContentError).code).toBe('INVALID_MOUNT_PATH');
    }
  });

  it('rejects bare /Volumes', () => {
    try {
      sweepDeviceContent('/Volumes');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SweepContentError);
      expect((err as SweepContentError).code).toBe('INVALID_MOUNT_PATH');
    }
  });

  it('rejects a path without an iPod_Control directory', () => {
    const bogus = mkdtempSync(join(tmpdir(), 'podkit-not-ipod-'));
    try {
      sweepDeviceContent(bogus);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SweepContentError);
      expect((err as SweepContentError).code).toBe('NOT_AN_IPOD');
    } finally {
      rmSync(bogus, { recursive: true, force: true });
    }
  });

  it('does not delete outside the resolved tree for a relative path', () => {
    // A relative path resolves to a real absolute dir; with no iPod_Control it
    // is refused rather than sweeping anything (it never escapes the tree).
    expect(() => sweepDeviceContent('./does-not-exist-relative')).toThrow(SweepContentError);
    try {
      sweepDeviceContent('./does-not-exist-relative');
    } catch (err) {
      expect((err as SweepContentError).code).toBe('NOT_AN_IPOD');
    }
  });
});
