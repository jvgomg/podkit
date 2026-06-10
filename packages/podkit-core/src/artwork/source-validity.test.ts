/**
 * Unit tests for the per-track source-file validity probe.
 *
 * Each `reason` in {@link SourceValidityReason} is exercised directly via
 * temp-file fixtures. The probe is sync, so the tests don't need fake-fs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSourceFileValidity } from './source-validity.js';

const PAD = Buffer.alloc(64, 0); // generic padding so magic-byte file size is > MIN

function writeFixture(dir: string, name: string, head: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.concat([head, PAD]));
  return path;
}

describe('checkSourceFileValidity', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'podkit-srcvalid-'));
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  // ── Negative cases ────────────────────────────────────────────────────────

  it('reports `missing` when the file does not exist', () => {
    const result = checkSourceFileValidity(join(root, 'does-not-exist.flac'));
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports `truncated` for an empty file', () => {
    const path = join(root, 'empty.flac');
    writeFileSync(path, Buffer.alloc(0));
    expect(checkSourceFileValidity(path)).toEqual({ ok: false, reason: 'truncated' });
  });

  it('reports `truncated` for a file smaller than the minimum audio header size', () => {
    const path = join(root, 'tiny.flac');
    writeFileSync(path, Buffer.from('fLaC')); // 4 bytes — under the 16-byte floor
    expect(checkSourceFileValidity(path)).toEqual({ ok: false, reason: 'truncated' });
  });

  it('reports `badMagic` for a file whose header is not a known audio container', () => {
    const path = join(root, 'corrupt.flac');
    writeFileSync(path, Buffer.from('NOT_A_VALID_FLAC_FILE_AT_ALL'));
    expect(checkSourceFileValidity(path)).toEqual({ ok: false, reason: 'badMagic' });
  });

  it('reports `unreadable` when the path is a directory', () => {
    const path = join(root, 'directory.flac');
    mkdirSync(path);
    expect(checkSourceFileValidity(path)).toEqual({ ok: false, reason: 'unreadable' });
  });

  // chmod-based permission test only runs when not under root; CI may not
  // honour mode bits inside containers. Skip if the chmod doesn't actually
  // restrict access.
  it('reports `unreadable` when the file cannot be opened due to permissions', () => {
    if (process.getuid?.() === 0) {
      // root bypasses mode bits — can't make a file unreadable to itself
      return;
    }
    const path = writeFixture(root, 'locked.flac', Buffer.from('fLaC'));
    chmodSync(path, 0o000);
    try {
      const result = checkSourceFileValidity(path);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('unreadable');
      }
    } finally {
      // Restore so afterEach can clean up.
      chmodSync(path, 0o644);
    }
  });

  // ── Positive cases — each supported container ─────────────────────────────

  it('accepts a FLAC header (`fLaC` at offset 0)', () => {
    const path = writeFixture(root, 'song.flac', Buffer.from('fLaC'));
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts an OGG/Opus header (`OggS` at offset 0)', () => {
    const path = writeFixture(root, 'song.opus', Buffer.from('OggS'));
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts an MP3 file with an ID3v2 tag (`ID3` at offset 0)', () => {
    const path = writeFixture(root, 'song.mp3', Buffer.from('ID3'));
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts an MP3 file with a raw MPEG sync (0xFF 0xFB)', () => {
    const path = writeFixture(root, 'song-raw.mp3', Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts an MP4 / M4A container (`ftyp` at offset 4)', () => {
    // 4 length bytes followed by `ftyp` + 4 brand bytes.
    const head = Buffer.from([
      0x00,
      0x00,
      0x00,
      0x20, // size
      0x66,
      0x74,
      0x79,
      0x70, // 'ftyp'
      0x4d,
      0x34,
      0x41,
      0x20, // 'M4A '
    ]);
    const path = writeFixture(root, 'song.m4a', head);
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts a WAV container (`RIFF` + `WAVE`)', () => {
    const head = Buffer.from([
      0x52,
      0x49,
      0x46,
      0x46, // 'RIFF'
      0x24,
      0x00,
      0x00,
      0x00, // size
      0x57,
      0x41,
      0x56,
      0x45, // 'WAVE'
    ]);
    const path = writeFixture(root, 'song.wav', head);
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts an AIFF container (`FORM` + `AIFF`)', () => {
    const head = Buffer.from([
      0x46,
      0x4f,
      0x52,
      0x4d, // 'FORM'
      0x00,
      0x00,
      0x00,
      0x24, // size
      0x41,
      0x49,
      0x46,
      0x46, // 'AIFF'
    ]);
    const path = writeFixture(root, 'song.aiff', head);
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });

  it('accepts an AIFF-C container (`FORM` + `AIFC`)', () => {
    const head = Buffer.from([
      0x46,
      0x4f,
      0x52,
      0x4d, // 'FORM'
      0x00,
      0x00,
      0x00,
      0x24, // size
      0x41,
      0x49,
      0x46,
      0x43, // 'AIFC'
    ]);
    const path = writeFixture(root, 'song.aifc', head);
    expect(checkSourceFileValidity(path)).toEqual({ ok: true });
  });
});
