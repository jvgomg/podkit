/**
 * Integration tests for embedded video metadata adapter
 *
 * These tests use actual video files with embedded metadata to verify
 * the adapter correctly extracts tags using ffprobe.
 */

import { describe, it, expect } from 'bun:test';
import * as path from 'node:path';
import { EmbeddedVideoMetadataAdapter } from './metadata-embedded.js';
import { isMovieMetadata, isTVShowMetadata } from './metadata.js';

// Path to test fixtures
const FIXTURES_DIR = path.resolve(__dirname, '../../../../test/fixtures/video');

describe('EmbeddedVideoMetadataAdapter integration', () => {
  describe('movie-with-metadata.mp4', () => {
    it('extracts embedded movie metadata', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      const filePath = path.join(FIXTURES_DIR, 'movie-with-metadata.mp4');

      const metadata = await adapter.getMetadata(filePath);

      expect(metadata).not.toBeNull();
      expect(isMovieMetadata(metadata!)).toBe(true);

      if (isMovieMetadata(metadata!)) {
        expect(metadata.title).toBe('Test Movie Title');
        expect(metadata.director).toBe('Test Director');
        expect(metadata.studio).toBe('Test Studio');
        expect(metadata.year).toBe(2024);
        expect(metadata.genre).toBe('Test');
        expect(metadata.description).toBe('A test movie with embedded metadata for validation purposes.');
      }
    });
  });

  describe('tvshow-episode.mp4', () => {
    it('extracts embedded TV show metadata', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      const filePath = path.join(FIXTURES_DIR, 'tvshow-episode.mp4');

      const metadata = await adapter.getMetadata(filePath);

      expect(metadata).not.toBeNull();
      expect(isTVShowMetadata(metadata!)).toBe(true);

      if (isTVShowMetadata(metadata!)) {
        expect(metadata.title).toBe('Pilot Episode');
        expect(metadata.seriesTitle).toBe('Test Show');
        expect(metadata.seasonNumber).toBe(1);
        expect(metadata.episodeNumber).toBe(1);
        expect(metadata.episodeId).toBe('S01E01');
        expect(metadata.network).toBe('Test Network');
        expect(metadata.year).toBe(2024);
        expect(metadata.genre).toBe('Drama');
        expect(metadata.description).toBe('The first episode of our test TV series.');
      }
    });
  });

  describe('compatible-h264.mp4', () => {
    it('extracts basic metadata from video without rich tags', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      const filePath = path.join(FIXTURES_DIR, 'compatible-h264.mp4');

      const metadata = await adapter.getMetadata(filePath);

      expect(metadata).not.toBeNull();
      // Should be detected as movie since no TV show tags
      expect(isMovieMetadata(metadata!)).toBe(true);

      if (isMovieMetadata(metadata!)) {
        expect(metadata.title).toBe('Compatible Test Video');
      }
    });
  });

  describe('canHandle', () => {
    it('returns true for mp4 fixture files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      const filePath = path.join(FIXTURES_DIR, 'movie-with-metadata.mp4');

      expect(await adapter.canHandle(filePath)).toBe(true);
    });

    it('returns true for mkv fixture files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      const filePath = path.join(FIXTURES_DIR, 'high-res-h264.mkv');

      expect(await adapter.canHandle(filePath)).toBe(true);
    });

    it('returns true for webm fixture files', async () => {
      const adapter = new EmbeddedVideoMetadataAdapter();
      const filePath = path.join(FIXTURES_DIR, 'incompatible-vp9.webm');

      expect(await adapter.canHandle(filePath)).toBe(true);
    });
  });
});
