/**
 * Smoke tests for the SyncTarget abstraction (TASK-356.03).
 *
 * Proves both backends report sane capabilities and a normalised track
 * listing — the contract the device matrix axis (P4) will rely on. Does not
 * exercise a full sync (that's the matrix's job).
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';

import { ensureFixturesExist, requireFfprobe } from '@podkit/e2e-shared';
import { getMultiFormatEmbeddedFixturesDir } from '@podkit/test-fixtures';

import { createTarget, createMassStorageTarget } from '../targets';

requireFfprobe();
ensureFixturesExist('multi-format-embedded');

describe('SyncTarget — iPod backend', () => {
  it('reports iPod kind, model, and capabilities; no device config block', async () => {
    const target = await createTarget();
    try {
      expect(target.kind).toBe('ipod');
      expect(target.model).toBe('MA147');
      expect(target.capabilities.supportedAudioCodecs).toEqual(
        expect.arrayContaining(['aac', 'mp3', 'alac', 'wav', 'aiff'])
      );
      expect(target.capabilities.artworkSources).toContain('database');
      // iPod is addressed by path + auto-detected — no [devices.*] stanza.
      expect(target.deviceConfig()).toBeNull();
      // Fresh dummy iPod has no tracks.
      expect(await target.getTracks()).toEqual([]);
    } finally {
      await target.cleanup();
    }
  });
});

describe('SyncTarget — mass-storage backend', () => {
  it('reports preset capabilities and a [devices.*] config block', async () => {
    const target = await createMassStorageTarget({ preset: 'echo-mini' });
    try {
      expect(target.kind).toBe('mass-storage');
      expect(target.model).toBe('echo-mini');
      // echo-mini preset codecs (vorbis, not opus).
      expect(target.capabilities.supportedAudioCodecs).toEqual(
        expect.arrayContaining(['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'])
      );
      const cfg = target.deviceConfig();
      expect(cfg).not.toBeNull();
      expect(cfg!.name).toBe('test');
      expect(cfg!.toml).toContain('type = "echo-mini"');
      expect(cfg!.toml).toContain(`path = "${target.path}"`);
    } finally {
      await target.cleanup();
    }
  });

  it('reads embedded-art tracks via ffprobe into normalised TrackInfo', async () => {
    // echo-mini's music dir is the device root, so files placed there are found.
    const target = await createMassStorageTarget({ preset: 'echo-mini' });
    try {
      await cp(
        join(getMultiFormatEmbeddedFixturesDir(), '03-flac-track.flac'),
        join(target.path, '03-flac-track.flac')
      );
      const tracks = await target.getTracks();
      const flac = tracks.find((t) => t.title === 'FLAC Test Track');
      expect(flac).toBeDefined();
      expect(flac!.artist).toBe('Multi-Format Embedded');
      expect(flac!.album).toBe('Lossless Collection (Embedded)');
      expect(flac!.hasArtwork).toBe(true);
    } finally {
      await target.cleanup();
    }
  });
});
