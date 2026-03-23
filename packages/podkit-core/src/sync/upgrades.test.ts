/**
 * Unit tests for upgrade detection (self-healing sync)
 *
 * Tests cover:
 * 1. isQualityUpgrade: format and bitrate comparisons
 * 2. detectUpgrades: all upgrade categories
 * 3. computeMusicDiff integration: upgraded tracks route to toUpdate
 */

import { describe, expect, it } from 'bun:test';
import {
  isQualityUpgrade,
  detectUpgrades,
  isFileReplacementUpgrade,
  detectPresetChange,
  detectBitratePresetMismatch,
} from './upgrades.js';
import { computeMusicDiff } from './music-differ.js';
import type { CollectionTrack } from '../adapters/interface.js';
import type { IPodTrack } from './types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

let ipodTrackPathCounter = 0;

function createCollectionTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<CollectionTrack> = {}
): CollectionTrack {
  return {
    id: options.id ?? `${artist}-${title}-${album}`,
    artist,
    title,
    album,
    filePath: options.filePath ?? `/music/${artist}/${album}/${title}.flac`,
    fileType: options.fileType ?? 'flac',
    ...options,
  };
}

function createIPodTrack(
  artist: string,
  title: string,
  album: string,
  options: Partial<
    Omit<
      IPodTrack,
      'update' | 'remove' | 'copyFile' | 'setArtwork' | 'setArtworkFromData' | 'removeArtwork'
    >
  > = {}
): IPodTrack {
  const uniquePath =
    options.filePath ?? `:iPod_Control:Music:F00:TRACK${ipodTrackPathCounter++}.m4a`;
  const track: IPodTrack = {
    artist,
    title,
    album,
    duration: options.duration ?? 180000,
    bitrate: options.bitrate ?? 256,
    sampleRate: options.sampleRate ?? 44100,
    size: options.size ?? 5000000,
    mediaType: options.mediaType ?? 1,
    filePath: uniquePath,
    timeAdded: options.timeAdded ?? Math.floor(Date.now() / 1000),
    timeModified: options.timeModified ?? Math.floor(Date.now() / 1000),
    timePlayed: options.timePlayed ?? 0,
    timeReleased: options.timeReleased ?? 0,
    playCount: options.playCount ?? 0,
    skipCount: options.skipCount ?? 0,
    rating: options.rating ?? 0,
    hasArtwork: options.hasArtwork ?? false,
    hasFile: options.hasFile ?? true,
    compilation: options.compilation ?? false,
    albumArtist: options.albumArtist,
    genre: options.genre,
    composer: options.composer,
    comment: options.comment,
    grouping: options.grouping,
    trackNumber: options.trackNumber,
    totalTracks: options.totalTracks,
    discNumber: options.discNumber,
    totalDiscs: options.totalDiscs,
    year: options.year,
    bpm: options.bpm,
    filetype: options.filetype,
    soundcheck: options.soundcheck,
    update: () => track,
    remove: () => {},
    copyFile: () => track,
    setArtwork: () => track,
    setArtworkFromData: () => track,
    removeArtwork: () => track,
  };
  return track;
}

// =============================================================================
// isQualityUpgrade
// =============================================================================

describe('isQualityUpgrade', () => {
  describe('lossless vs lossy', () => {
    it('returns true for lossless source replacing lossy iPod (FLAC -> MP3)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        bitrate: 1000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns true for ALAC source replacing lossy iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'alac',
        lossless: true,
        bitrate: 800,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns true for WAV source replacing lossy iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'wav',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 320,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns false for lossy source replacing lossless iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'Apple Lossless audio file',
        bitrate: 800,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false for lossless replacing lossless (already best quality)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        bitrate: 1100,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'Apple Lossless audio file',
        bitrate: 900,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });
  });

  describe('lossy bitrate comparison (same format family)', () => {
    it('returns true for significant bitrate increase (MP3 128 -> 320)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns true for AAC bitrate increase (128 -> 256)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'm4a',
        lossless: false,
        bitrate: 256,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 128,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns true when absolute increase >= 64 kbps even if < 1.5x', () => {
      // 256 -> 320 = 64 kbps increase, 1.25x multiplier
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns true when multiplier >= 1.5x even if < 64 kbps absolute', () => {
      // 64 -> 96 = 32 kbps increase, 1.5x multiplier
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 96,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 64,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns false for small bitrate increase (below both thresholds)', () => {
      // 192 -> 224 = 32 kbps increase, 1.17x multiplier
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 224,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false for equal bitrate', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false for lower bitrate source', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 128,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });
  });

  describe('cross-format lossy', () => {
    it('returns false for MP3 -> AAC (different format family)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 128,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false for AAC -> MP3 (different format family)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'm4a',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false for OGG -> MP3 (different format family)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'ogg',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false when source bitrate is missing', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        // no bitrate
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false when iPod bitrate is 0', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 0,
      });
      // bitrate 0 is falsy, so can't determine upgrade
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('returns false when source bitrate is 0', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 0,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      // bitrate 0 is falsy, so can't determine upgrade
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('handles M4A with ALAC codec as lossless source', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'm4a',
        codec: 'alac',
        // lossless not set explicitly; should be detected from codec
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });

    it('returns false when iPod filetype is missing (unknown format)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        // no filetype
        bitrate: 128,
      });
      // Unknown iPod format family, so cross-format check fails
      expect(isQualityUpgrade(source, ipod)).toBe(false);
    });

    it('detects lossless from fileType when lossless field is undefined', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        // lossless not set
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });
      expect(isQualityUpgrade(source, ipod)).toBe(true);
    });
  });
});

// =============================================================================
// detectUpgrades
// =============================================================================

describe('detectUpgrades', () => {
  describe('format-upgrade', () => {
    it('detects lossless source replacing lossy iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
    });

    it('does not detect format-upgrade for lossy replacing lossy', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('format-upgrade');
    });
  });

  describe('quality-upgrade', () => {
    it('detects significant bitrate increase within same format', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('quality-upgrade');
    });

    it('does not detect quality-upgrade for cross-format lossy', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 128,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('quality-upgrade');
    });

    it('does not report quality-upgrade when format-upgrade applies', () => {
      // When source is lossless, it's a format-upgrade not quality-upgrade
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        bitrate: 1000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
      expect(reasons).not.toContain('quality-upgrade');
    });
  });

  describe('artwork-added', () => {
    it('detects artwork-added when source has artwork and iPod does not', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('artwork-added');
    });

    it('does not detect artwork-added when source hasArtwork is undefined', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        // hasArtwork undefined
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-added');
    });

    it('does not detect artwork-added when iPod already has artwork', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-added');
    });

    it('does not detect artwork-added when source has no artwork', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: false,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-added');
    });

    it('detects artwork-added alongside other upgrades', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        hasArtwork: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
        hasArtwork: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
      expect(reasons).toContain('artwork-added');
    });
  });

  describe('artwork-removed', () => {
    it('detects artwork-removed when source has no artwork but iPod does', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: false,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('artwork-removed');
    });

    it('does not detect artwork-removed when source hasArtwork is undefined', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        // hasArtwork undefined
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-removed');
    });

    it('does not detect artwork-removed when iPod has no artwork', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: false,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-removed');
    });

    it('does not detect artwork-removed when both have artwork', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-removed');
    });

    it('artwork-removed is not a file replacement upgrade', () => {
      expect(isFileReplacementUpgrade('artwork-removed')).toBe(false);
    });

    it('artwork-removed appears between artwork-added and artwork-updated in priority', () => {
      // Verify artwork-removed comes before soundcheck-update in priority
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: false,
        soundcheck: 5000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        soundcheck: 3000,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('artwork-removed');
      expect(reasons).toContain('soundcheck-update');
      const artIdx = reasons.indexOf('artwork-removed');
      const scIdx = reasons.indexOf('soundcheck-update');
      expect(artIdx).toBeLessThan(scIdx);
    });
  });

  describe('artwork-updated', () => {
    it('detects artwork-updated when source artworkHash differs from sync tag', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabbccdd',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        comment: '[podkit:v1 quality=high encoding=vbr art=11223344]',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('artwork-updated');
    });

    it('does not detect artwork-updated when hashes match', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabbccdd',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        comment: '[podkit:v1 quality=high encoding=vbr art=aabbccdd]',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-updated');
    });

    it('does not detect artwork-updated when iPod has no sync tag', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabbccdd',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        // no comment / no sync tag
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-updated');
    });

    it('does not detect artwork-updated when iPod sync tag has no art field', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabbccdd',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        comment: '[podkit:v1 quality=high encoding=vbr]',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-updated');
    });

    it('does not detect artwork-updated when source has no artworkHash (checkArtwork disabled)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        // artworkHash undefined — checkArtwork not enabled
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        comment: '[podkit:v1 quality=high encoding=vbr art=11223344]',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('artwork-updated');
    });

    it('artwork-added and artwork-updated are mutually exclusive (iPod has no artwork triggers artwork-added, not artwork-updated)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabbccdd',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
        comment: '[podkit:v1 quality=high encoding=vbr art=11223344]',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('artwork-added');
      // artwork-updated should not fire because iPod has no artwork (hasArtwork: false)
      expect(reasons).not.toContain('artwork-updated');
    });

    it('artwork-updated appears after artwork-added in priority order', () => {
      // This test verifies that if both could theoretically fire (not a real case
      // due to mutual exclusivity), artwork-added would come first in the array.
      // We verify the ordering by checking a case where artwork-updated fires
      // alongside other reasons.
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabbccdd',
        soundcheck: 1000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
        comment: '[podkit:v1 quality=high encoding=vbr art=11223344]',
        // no soundcheck
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('artwork-updated');
      expect(reasons).toContain('soundcheck-update');
      // artwork-updated should come before soundcheck-update in priority
      const artIdx = reasons.indexOf('artwork-updated');
      const scIdx = reasons.indexOf('soundcheck-update');
      expect(artIdx).toBeLessThan(scIdx);
    });
  });

  describe('soundcheck-update', () => {
    it('detects soundcheck added (source has, iPod does not)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        soundcheck: 1000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'Apple Lossless audio file',
        bitrate: 900,
        // no soundcheck
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('soundcheck-update');
    });

    it('detects soundcheck changed (both have different values)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        soundcheck: 1500,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        soundcheck: 1000,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('soundcheck-update');
    });

    it('does not detect soundcheck when source has no value', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        // no soundcheck
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        soundcheck: 1000,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('soundcheck-update');
    });

    it('does not detect soundcheck when both have same value', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        soundcheck: 1000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        soundcheck: 1000,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('soundcheck-update');
    });
  });

  describe('metadata-correction', () => {
    it('detects genre change', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        genre: 'Progressive Rock',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        genre: 'Rock',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('metadata-correction');
    });

    it('detects year change', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        year: 1975,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        year: 1974,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('metadata-correction');
    });

    it('detects trackNumber change', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        trackNumber: 5,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        trackNumber: 3,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('metadata-correction');
    });

    it('detects discNumber change', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        discNumber: 2,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        discNumber: 1,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('metadata-correction');
    });

    it('detects albumArtist added', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        albumArtist: 'Various Artists',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        // no albumArtist
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('metadata-correction');
    });

    it('detects compilation flag change', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        compilation: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        compilation: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('metadata-correction');
    });

    it('does not detect metadata-correction when fields are equivalent', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        genre: 'Rock',
        year: 1975,
        trackNumber: 1,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        genre: 'Rock',
        year: 1975,
        trackNumber: 1,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('metadata-correction');
    });

    it('treats undefined and empty as equivalent (no false positive)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        // genre undefined
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        // genre undefined
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('metadata-correction');
    });

    it('treats compilation undefined and false as equivalent', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        // compilation undefined
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        compilation: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('metadata-correction');
    });

    it('case-insensitive genre comparison (no false positive)', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        genre: 'rock',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        genre: 'Rock',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('metadata-correction');
    });
  });

  describe('multiple reasons', () => {
    it('detects format-upgrade and soundcheck-update together', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        soundcheck: 1000,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
        // no soundcheck
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
      expect(reasons).toContain('soundcheck-update');
    });

    it('detects quality-upgrade, soundcheck-update, and metadata-correction together', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
        soundcheck: 1200,
        genre: 'Progressive Rock',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
        soundcheck: 800,
        genre: 'Rock',
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('quality-upgrade');
      expect(reasons).toContain('soundcheck-update');
      expect(reasons).toContain('metadata-correction');
    });
  });

  describe('edge cases', () => {
    it('explicit lossless: false wins over lossless fileType inference (contradictory metadata)', () => {
      // A track with fileType 'flac' but explicitly lossless: false
      // The explicit flag should take priority over format-based inference
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: false, // Contradicts fileType; explicit flag wins
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });

      const reasons = detectUpgrades(source, ipod);

      // Should NOT detect format-upgrade because lossless: false is explicit
      expect(reasons).not.toContain('format-upgrade');
      // But should still detect quality-upgrade if bitrate thresholds are met
      // (MP3 family: 320 vs 128 = 2.5x, well above 1.5x threshold)
      // However, source is 'flac' and iPod is 'mp3' — different format families
      // Cross-format lossy is never a quality upgrade
      expect(reasons).not.toContain('quality-upgrade');
    });

    it('artwork-added is not detected when source hasArtwork is undefined (adapter did not populate the field)', () => {
      // When source.hasArtwork is undefined (adapter didn't populate it), we must
      // not produce a false positive — we have no information about artwork presence.
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        // hasArtwork not set — adapter didn't determine it
      });
      const ipodNoArtwork = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
      });

      const reasons = detectUpgrades(source, ipodNoArtwork);
      expect(reasons).not.toContain('artwork-added');
    });

    it('artwork-added is not detected when source hasArtwork is false', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: false,
      });
      const ipodNoArtwork = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
      });

      const reasons = detectUpgrades(source, ipodNoArtwork);
      expect(reasons).not.toContain('artwork-added');
    });

    it('artwork-added is not detected when iPod already has artwork', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
      });
      const ipodWithArtwork = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: true,
      });

      const reasons = detectUpgrades(source, ipodWithArtwork);
      expect(reasons).not.toContain('artwork-added');
    });

    it('artwork-added is not re-triggered when sync tag already has matching artworkHash', () => {
      // This prevents infinite artwork-added loops for Subsonic tracks where the
      // server has album-level artwork but the audio file has no embedded artwork.
      // After the first sync attempt, the artworkHash is written to the sync tag.
      // On subsequent syncs, we skip artwork-added since re-downloading won't help.
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'aabb1122',
      });
      const ipodNoArtworkButHasHash = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
        comment: '[podkit:v1 quality=high encoding=vbr art=aabb1122]',
      });

      const reasons = detectUpgrades(source, ipodNoArtworkButHasHash);
      expect(reasons).not.toContain('artwork-added');
    });

    it('artwork-added IS triggered when sync tag has a different artworkHash', () => {
      // If the source artworkHash differs from what was previously attempted,
      // the artwork may have changed — re-attempt the transfer.
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        hasArtwork: true,
        artworkHash: 'newart99',
      });
      const ipodNoArtworkOldHash = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        hasArtwork: false,
        comment: '[podkit:v1 quality=high encoding=vbr art=oldart11]',
      });

      const reasons = detectUpgrades(source, ipodNoArtworkOldHash);
      expect(reasons).toContain('artwork-added');
    });
  });

  describe('bitrate 0 edge cases', () => {
    it('does not detect quality-upgrade when iPod bitrate is 0', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 320,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 0, // Unknown bitrate — should not trigger quality-upgrade
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('quality-upgrade');
    });

    it('does not detect quality-upgrade when source bitrate is 0', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 0,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).not.toContain('quality-upgrade');
    });

    it('still detects format-upgrade even when iPod bitrate is 0', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 0,
      });
      const reasons = detectUpgrades(source, ipod);
      // Format upgrade is lossless->lossy, independent of bitrate
      expect(reasons).toContain('format-upgrade');
    });
  });

  describe('format-upgrade detection for real-world format combinations', () => {
    it('detects format-upgrade: FLAC source, MP3 iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
    });

    it('detects format-upgrade: FLAC source, AAC iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
    });

    it('detects format-upgrade: ALAC source, MP3 iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'alac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
    });

    it('detects format-upgrade: WAV source, AAC iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'wav',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
    });

    it('detects format-upgrade: lossless M4A (ALAC codec) source, MP3 iPod', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'm4a',
        codec: 'alac',
        // lossless not set — should be inferred from codec
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toContain('format-upgrade');
    });
  });

  describe('no false positives on identical tracks', () => {
    it('returns empty array for identical tracks', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        genre: 'Rock',
        year: 1975,
        trackNumber: 1,
        discNumber: 1,
        soundcheck: 1000,
        compilation: false,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
        genre: 'Rock',
        year: 1975,
        trackNumber: 1,
        discNumber: 1,
        soundcheck: 1000,
        compilation: false,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toEqual([]);
    });

    it('returns empty array for tracks with all empty optional fields', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });
      const reasons = detectUpgrades(source, ipod);
      expect(reasons).toEqual([]);
    });
  });
});

// =============================================================================
// isFileReplacementUpgrade
// =============================================================================

describe('isFileReplacementUpgrade', () => {
  it('returns true for format-upgrade', () => {
    expect(isFileReplacementUpgrade('format-upgrade')).toBe(true);
  });

  it('returns true for quality-upgrade', () => {
    expect(isFileReplacementUpgrade('quality-upgrade')).toBe(true);
  });

  it('returns true for artwork-added', () => {
    expect(isFileReplacementUpgrade('artwork-added')).toBe(true);
  });

  it('returns true for preset-upgrade', () => {
    expect(isFileReplacementUpgrade('preset-upgrade')).toBe(true);
  });

  it('returns true for preset-downgrade', () => {
    expect(isFileReplacementUpgrade('preset-downgrade')).toBe(true);
  });

  it('returns true for force-transcode', () => {
    expect(isFileReplacementUpgrade('force-transcode')).toBe(true);
  });

  it('returns true for transfer-mode-changed', () => {
    expect(isFileReplacementUpgrade('transfer-mode-changed')).toBe(true);
  });

  it('returns false for soundcheck-update', () => {
    expect(isFileReplacementUpgrade('soundcheck-update')).toBe(false);
  });

  it('returns false for metadata-correction', () => {
    expect(isFileReplacementUpgrade('metadata-correction')).toBe(false);
  });

  it('returns false for artwork-updated (metadata-only, no audio re-transfer)', () => {
    expect(isFileReplacementUpgrade('artwork-updated')).toBe(false);
  });
});

// =============================================================================
// computeMusicDiff integration
// =============================================================================

describe('computeMusicDiff with upgrades', () => {
  it('routes format-upgraded track to toUpdate', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 192,
    });

    const diff = computeMusicDiff([source], [ipod]);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
    expect(diff.existing).toHaveLength(0);
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });

  it('routes quality-upgraded track to toUpdate', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
      bitrate: 320,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 128,
    });

    const diff = computeMusicDiff([source], [ipod]);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('quality-upgrade');
    expect(diff.existing).toHaveLength(0);
  });

  it('routes soundcheck-updated track to toUpdate', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
      bitrate: 256,
      soundcheck: 1200,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 256,
    });

    const diff = computeMusicDiff([source], [ipod]);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('soundcheck-update');
  });

  it('routes metadata-corrected track to toUpdate', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
      bitrate: 256,
      genre: 'Progressive Rock',
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 256,
      genre: 'Rock',
    });

    const diff = computeMusicDiff([source], [ipod]);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
  });

  it('includes metadata changes in toUpdate entry', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
      genre: 'Progressive Rock',
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 192,
      genre: 'Rock',
    });

    const diff = computeMusicDiff([source], [ipod]);

    expect(diff.toUpdate).toHaveLength(1);
    expect(diff.toUpdate[0]!.changes.length).toBeGreaterThan(0);
    // Should have a fileType change for format-upgrade
    const fileTypeChange = diff.toUpdate[0]!.changes.find((c) => c.field === 'fileType');
    expect(fileTypeChange).toBeDefined();
    expect(fileTypeChange!.to).toBe('flac');
  });

  it('keeps identical tracks in existing', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
      bitrate: 256,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 256,
    });

    const diff = computeMusicDiff([source], [ipod]);

    expect(diff.existing).toHaveLength(1);
    expect(diff.toUpdate).toHaveLength(0);
  });

  describe('skipUpgrades option', () => {
    it('suppresses file-replacement upgrades when skipUpgrades is true', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { skipUpgrades: true });

      // format-upgrade is a file-replacement, should be suppressed
      // Track should end up in existing (since no metadata-only upgrades apply)
      expect(diff.toUpdate).toHaveLength(0);
      expect(diff.existing).toHaveLength(1);
    });

    it('allows metadata-only upgrades when skipUpgrades is true', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
        soundcheck: 1200,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 256,
      });

      const diff = computeMusicDiff([source], [ipod], { skipUpgrades: true });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('soundcheck-update');
    });

    it('allows metadata-correction when skipUpgrades suppresses format-upgrade', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        genre: 'Progressive Rock',
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
        genre: 'Rock',
      });

      const diff = computeMusicDiff([source], [ipod], { skipUpgrades: true });

      // format-upgrade suppressed, but metadata-correction should still apply
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('metadata-correction');
    });

    it('does not suppress upgrades when skipUpgrades is false', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod], { skipUpgrades: false });

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
    });

    it('skipUpgrades with active transforms: both work together', () => {
      // When skipUpgrades is true AND transforms are active, both should apply:
      // - File-replacement upgrades suppressed
      // - Transform changes still applied
      const source = createCollectionTrack('Artist feat. Guest', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
        genre: 'Progressive Rock',
      });
      const ipod = createIPodTrack('Artist feat. Guest', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
        genre: 'Rock',
      });

      const transforms = {
        cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
      };

      const diff = computeMusicDiff([source], [ipod], {
        skipUpgrades: true,
        transforms,
      });

      // The transform should match and apply (transform-apply takes priority)
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('transform-apply');
    });

    it('does not suppress upgrades when skipUpgrades is not set', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([source], [ipod]);

      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
    });
  });

  describe('interaction with existing diff behavior', () => {
    it('still adds new tracks not on iPod', () => {
      const source1 = createCollectionTrack('Artist', 'Song 1', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const source2 = createCollectionTrack('Artist', 'Song 2', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 256,
      });

      const diff = computeMusicDiff([source1, source2], []);

      expect(diff.toAdd).toHaveLength(2);
      expect(diff.toUpdate).toHaveLength(0);
    });

    it('still removes iPod tracks not in collection', () => {
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 192,
      });

      const diff = computeMusicDiff([], [ipod]);

      expect(diff.toRemove).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(0);
    });

    it('handles mix of upgrades, adds, removes, and existing', () => {
      const sources = [
        // Will be added (not on iPod)
        createCollectionTrack('Artist', 'New Song', 'Album'),
        // Will be upgraded (lossless replacing lossy)
        createCollectionTrack('Artist', 'Upgrade Song', 'Album', {
          fileType: 'flac',
          lossless: true,
        }),
        // Will remain existing (same quality)
        createCollectionTrack('Artist', 'Same Song', 'Album', {
          fileType: 'mp3',
          lossless: false,
          bitrate: 256,
        }),
      ];

      const ipods = [
        // Matches "Upgrade Song" - lower quality
        createIPodTrack('Artist', 'Upgrade Song', 'Album', {
          filetype: 'MPEG audio file',
          bitrate: 192,
        }),
        // Matches "Same Song" - same quality
        createIPodTrack('Artist', 'Same Song', 'Album', {
          filetype: 'MPEG audio file',
          bitrate: 256,
        }),
        // Will be removed (not in collection)
        createIPodTrack('Artist', 'Old Song', 'Album', {
          filetype: 'MPEG audio file',
          bitrate: 128,
        }),
      ];

      const diff = computeMusicDiff(sources, ipods);

      expect(diff.toAdd).toHaveLength(1);
      expect(diff.toUpdate).toHaveLength(1);
      expect(diff.toUpdate[0]!.reason).toBe('format-upgrade');
      expect(diff.existing).toHaveLength(1);
      expect(diff.toRemove).toHaveLength(1);
    });
  });
});

// =============================================================================
// detectBitratePresetMismatch (shared between audio and video)
// Now uses percentage-based tolerance (ratio 0.0-1.0) instead of fixed kbps.
// Default tolerance is 0.3 (30% of preset target).
// =============================================================================

describe('detectBitratePresetMismatch', () => {
  it('returns preset-upgrade when bitrate is below target minus tolerance', () => {
    // 128 vs 256 target: diff = -128, tolerance = 256 * 0.3 = 76.8 → upgrade
    expect(detectBitratePresetMismatch(128, 256)).toBe('preset-upgrade');
  });

  it('returns preset-downgrade when bitrate is above target plus tolerance', () => {
    // 400 vs 256 target: diff = 144, tolerance = 256 * 0.3 = 76.8 → downgrade
    expect(detectBitratePresetMismatch(400, 256)).toBe('preset-downgrade');
  });

  it('returns null when bitrate is within tolerance', () => {
    // 260 vs 256 target: diff = 4, tolerance = 256 * 0.3 = 76.8 → within
    expect(detectBitratePresetMismatch(260, 256)).toBeNull();
  });

  it('returns null when bitrate is undefined', () => {
    expect(detectBitratePresetMismatch(undefined, 256)).toBeNull();
  });

  it('returns null when bitrate is zero', () => {
    expect(detectBitratePresetMismatch(0, 256)).toBeNull();
  });

  it('returns null when bitrate is below minimum threshold', () => {
    expect(detectBitratePresetMismatch(17, 256)).toBeNull();
  });

  it('respects custom tolerance ratio', () => {
    // 230 vs 256: diff = -26
    // Default 30% tolerance = 76.8 → within tolerance
    expect(detectBitratePresetMismatch(230, 256)).toBeNull();
    // Custom 5% tolerance = 12.8 → outside tolerance
    expect(detectBitratePresetMismatch(230, 256, 0.05)).toBe('preset-upgrade');
  });

  it('respects custom minBitrate', () => {
    // 50 is below default min of 64
    expect(detectBitratePresetMismatch(50, 256)).toBeNull();
    // But above custom min of 30
    expect(detectBitratePresetMismatch(50, 256, 0.3, 30)).toBe('preset-upgrade');
  });

  it('uses VBR tolerance (30%) by default', () => {
    // 256 * 0.3 = 76.8 kbps tolerance
    // 179 is just below 256 - 76.8 = 179.2 → upgrade
    expect(detectBitratePresetMismatch(179, 256)).toBe('preset-upgrade');
    // 180 is within tolerance (256 - 76.8 = 179.2)
    expect(detectBitratePresetMismatch(180, 256)).toBeNull();
  });

  it('detects with CBR tolerance (10%)', () => {
    // 256 * 0.1 = 25.6 kbps tolerance
    // 230 is below 256 - 25.6 = 230.4 → upgrade
    expect(detectBitratePresetMismatch(230, 256, 0.1)).toBe('preset-upgrade');
    // 231 is within tolerance
    expect(detectBitratePresetMismatch(231, 256, 0.1)).toBeNull();
  });

  it('works for video bitrate ranges (iPod Classic)', () => {
    // iPod Classic: low=1096, medium=1628, high=2128, max=2660
    // 1096 vs 2128: diff = -1032, tolerance = 2128 * 0.3 = 638.4 → upgrade
    expect(detectBitratePresetMismatch(1096, 2128)).toBe('preset-upgrade');
    // 2660 vs 1096: diff = 1564, tolerance = 1096 * 0.3 = 328.8 → downgrade
    expect(detectBitratePresetMismatch(2660, 1096)).toBe('preset-downgrade');
    expect(detectBitratePresetMismatch(2128, 2128)).toBeNull();
  });

  it('works for video bitrate ranges (iPod Video 5G)', () => {
    // iPod Video 5G: low=396, medium=496, high=728, max=896
    // 396 vs 728: diff = -332, tolerance = 728 * 0.3 = 218.4 → upgrade
    expect(detectBitratePresetMismatch(396, 728)).toBe('preset-upgrade');
    // 896 vs 396: diff = 500, tolerance = 396 * 0.3 = 118.8 → downgrade
    expect(detectBitratePresetMismatch(896, 396)).toBe('preset-downgrade');
    expect(detectBitratePresetMismatch(728, 728)).toBeNull();
  });

  it('handles very low bitrate floor correctly', () => {
    // 65 is above the 64 min threshold
    // 65 vs 256: diff = -191, tolerance = 256 * 0.3 = 76.8 → upgrade
    expect(detectBitratePresetMismatch(65, 256)).toBe('preset-upgrade');
    // 63 is below the 64 min threshold → null
    expect(detectBitratePresetMismatch(63, 256)).toBeNull();
  });

  it('handles tolerance at exact boundary', () => {
    // 256 * 0.3 = 76.8, so boundary is 256 - 76.8 = 179.2
    // 180 (above 179.2) → within tolerance
    expect(detectBitratePresetMismatch(180, 256)).toBeNull();
    // 179 (below 179.2) → outside tolerance
    expect(detectBitratePresetMismatch(179, 256)).toBe('preset-upgrade');
  });
});

// =============================================================================
// detectPresetChange (audio-specific wrapper)
// Now supports percentage-based tolerance, encoding mode, and ALAC detection.
// =============================================================================

describe('detectPresetChange', () => {
  it('returns preset-upgrade when iPod bitrate is below preset target', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
    });

    // 128 vs 256: diff = -128, tolerance = 256 * 0.3 = 76.8 → upgrade
    expect(detectPresetChange(source, ipod, 256)).toBe('preset-upgrade');
  });

  it('returns preset-downgrade when iPod bitrate is above preset target', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 256,
    });

    // 256 vs 128: diff = 128, tolerance = 128 * 0.3 = 38.4 → downgrade
    expect(detectPresetChange(source, ipod, 128)).toBe('preset-downgrade');
  });

  it('returns null when iPod bitrate is within tolerance of preset target', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 260,
    });

    expect(detectPresetChange(source, ipod, 256)).toBeNull();
  });

  it('returns null for lossy source (copied as-is, preset irrelevant)', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'mp3',
      lossless: false,
      bitrate: 192,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'MPEG audio file',
      bitrate: 128,
    });

    expect(detectPresetChange(source, ipod, 256)).toBeNull();
  });

  it('returns null when iPod has no bitrate', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 0,
    });

    expect(detectPresetChange(source, ipod, 256)).toBeNull();
  });

  it('returns null when iPod bitrate is below minimum threshold (short file artifact)', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 17,
    });

    expect(detectPresetChange(source, ipod, 256)).toBeNull();
  });

  it('detects lossless-to-lossy preset change as preset-downgrade', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // ALAC on iPod (900 kbps) vs 256 target: diff = 644, tolerance = 76.8 → downgrade
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'Apple Lossless audio file',
      bitrate: 900,
    });

    expect(detectPresetChange(source, ipod, 256)).toBe('preset-downgrade');
  });

  it('returns null at exactly the VBR tolerance boundary', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // 256 * 0.3 = 76.8, boundary = 256 - 76.8 = 179.2
    // 180 is above 179.2 → within tolerance
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 180,
    });

    expect(detectPresetChange(source, ipod, 256)).toBeNull();
  });

  it('returns preset-upgrade just beyond the VBR tolerance boundary', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    // 256 * 0.3 = 76.8, boundary = 256 - 76.8 = 179.2
    // 179 is below 179.2 → outside tolerance
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 179,
    });

    expect(detectPresetChange(source, ipod, 256)).toBe('preset-upgrade');
  });

  it('detects upgrade across adjacent presets (low → medium) with VBR tolerance', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 128,
    });

    // 128 vs 192: diff = -64, tolerance = 192 * 0.3 = 57.6 → upgrade
    expect(detectPresetChange(source, ipod, 192)).toBe('preset-upgrade');
  });

  it('detects downgrade across adjacent presets (medium → low) with VBR tolerance', () => {
    const source = createCollectionTrack('Artist', 'Song', 'Album', {
      fileType: 'flac',
      lossless: true,
    });
    const ipod = createIPodTrack('Artist', 'Song', 'Album', {
      filetype: 'AAC audio file',
      bitrate: 192,
    });

    // 192 vs 128: diff = 64, tolerance = 128 * 0.3 = 38.4 → downgrade
    expect(detectPresetChange(source, ipod, 128)).toBe('preset-downgrade');
  });

  describe('CBR encoding mode', () => {
    it('uses tighter tolerance (10%) for CBR', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 230,
      });

      // 230 vs 256: diff = -26
      // VBR tolerance = 256 * 0.3 = 76.8 → within tolerance
      expect(detectPresetChange(source, ipod, 256)).toBeNull();
      // CBR tolerance = 256 * 0.1 = 25.6 → outside tolerance
      expect(detectPresetChange(source, ipod, 256, { encodingMode: 'cbr' })).toBe('preset-upgrade');
    });
  });

  describe('custom bitrateTolerance', () => {
    it('overrides default tolerance', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 240,
      });

      // 240 vs 256: diff = -16
      // Default VBR 30% tolerance = 76.8 → within
      expect(detectPresetChange(source, ipod, 256)).toBeNull();
      // Custom 5% tolerance = 12.8 → outside
      expect(detectPresetChange(source, ipod, 256, { bitrateTolerance: 0.05 })).toBe(
        'preset-upgrade'
      );
    });

    it('custom tolerance overrides encoding mode default', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 220,
      });

      // 220 vs 256: diff = -36
      // CBR 10% tolerance = 25.6 → outside, but custom 0.2 = 51.2 → within
      expect(
        detectPresetChange(source, ipod, 256, { encodingMode: 'cbr', bitrateTolerance: 0.2 })
      ).toBeNull();
    });
  });

  describe('ALAC format-based detection', () => {
    it('returns null when iPod track is already ALAC', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'Apple Lossless audio file',
        bitrate: 900,
      });

      expect(detectPresetChange(source, ipod, 256, { isAlacPreset: true })).toBeNull();
    });

    it('returns preset-upgrade when iPod track is AAC and should be ALAC', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'AAC audio file',
        bitrate: 256,
      });

      expect(detectPresetChange(source, ipod, 256, { isAlacPreset: true })).toBe('preset-upgrade');
    });

    it('returns preset-upgrade when iPod filetype is unknown and ALAC preset', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'flac',
        lossless: true,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        bitrate: 256,
      });

      expect(detectPresetChange(source, ipod, 256, { isAlacPreset: true })).toBe('preset-upgrade');
    });

    it('does not apply ALAC detection for lossy sources', () => {
      const source = createCollectionTrack('Artist', 'Song', 'Album', {
        fileType: 'mp3',
        lossless: false,
        bitrate: 192,
      });
      const ipod = createIPodTrack('Artist', 'Song', 'Album', {
        filetype: 'MPEG audio file',
        bitrate: 128,
      });

      // Lossy source → always null regardless of isAlacPreset
      expect(detectPresetChange(source, ipod, 256, { isAlacPreset: true })).toBeNull();
    });
  });
});
