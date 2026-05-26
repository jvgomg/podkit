/**
 * Tests for metadata extraction utilities
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import {
  ensureFixturesExist,
  getGoldbergFixturesDir,
  getSyntheticTestsFixturesDir,
} from '@podkit/test-fixtures';
import { getFileDisplayMetadata, getFilesDisplayMetadata } from './extractor.js';

ensureFixturesExist('goldberg-selections');
ensureFixturesExist('synthetic-tests');

const GOLDBERG_DIR = getGoldbergFixturesDir();
const SYNTHETIC_DIR = getSyntheticTestsFixturesDir();

describe('getFileDisplayMetadata', () => {
  it('extracts artwork and bitrate from FLAC file with artwork', async () => {
    const filePath = join(GOLDBERG_DIR, '01-harmony.flac');
    const metadata = await getFileDisplayMetadata(filePath);

    expect(metadata.hasArtwork).toBe(true);
    expect(metadata.bitrate).toBeGreaterThan(0);
    expect(typeof metadata.bitrate).toBe('number');
  });

  it('returns hasArtwork=false for file without artwork', async () => {
    const filePath = join(SYNTHETIC_DIR, '03-dual-tone.flac');
    const metadata = await getFileDisplayMetadata(filePath);

    expect(metadata.hasArtwork).toBe(false);
    expect(metadata.bitrate).toBeGreaterThan(0);
  });

  it('returns defaults for non-existent file', async () => {
    const filePath = '/non/existent/file.flac';
    const metadata = await getFileDisplayMetadata(filePath);

    expect(metadata.hasArtwork).toBe(false);
    expect(metadata.bitrate).toBeUndefined();
  });

  it('returns bitrate in kbps (not bps)', async () => {
    const filePath = join(GOLDBERG_DIR, '01-harmony.flac');
    const metadata = await getFileDisplayMetadata(filePath);

    // Bitrate should be in reasonable kbps range (not raw bps)
    // FLAC files typically have bitrates between 50-1500 kbps
    expect(metadata.bitrate).toBeGreaterThan(50);
    expect(metadata.bitrate).toBeLessThan(2000);
  });
});

describe('getFilesDisplayMetadata', () => {
  it('extracts metadata from multiple files in parallel', async () => {
    const filePaths = [
      join(GOLDBERG_DIR, '01-harmony.flac'),
      join(GOLDBERG_DIR, '02-vibrato.flac'),
      join(SYNTHETIC_DIR, '03-dual-tone.flac'),
    ];

    const metadataMap = await getFilesDisplayMetadata(filePaths);

    expect(metadataMap.size).toBe(3);

    // Files with artwork
    const harmony = metadataMap.get(filePaths[0]!);
    expect(harmony?.hasArtwork).toBe(true);
    expect(harmony?.bitrate).toBeGreaterThan(0);

    const vibrato = metadataMap.get(filePaths[1]!);
    expect(vibrato?.hasArtwork).toBe(true);
    expect(vibrato?.bitrate).toBeGreaterThan(0);

    // File without artwork
    const dualTone = metadataMap.get(filePaths[2]!);
    expect(dualTone?.hasArtwork).toBe(false);
    expect(dualTone?.bitrate).toBeGreaterThan(0);
  });

  it('returns empty map for empty input', async () => {
    const metadataMap = await getFilesDisplayMetadata([]);
    expect(metadataMap.size).toBe(0);
  });

  it('handles mix of valid and invalid files gracefully', async () => {
    const filePaths = [join(GOLDBERG_DIR, '01-harmony.flac'), '/non/existent/file.flac'];

    const metadataMap = await getFilesDisplayMetadata(filePaths);

    expect(metadataMap.size).toBe(2);

    // Valid file
    const harmony = metadataMap.get(filePaths[0]!);
    expect(harmony?.hasArtwork).toBe(true);

    // Invalid file returns defaults
    const invalid = metadataMap.get(filePaths[1]!);
    expect(invalid?.hasArtwork).toBe(false);
    expect(invalid?.bitrate).toBeUndefined();
  });
});
