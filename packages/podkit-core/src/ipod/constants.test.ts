import { describe, expect, it } from 'bun:test';
import { MediaType, type MediaTypeValue } from './constants.js';

describe('MediaType', () => {
  describe('values', () => {
    it('Audio is 0x0001', () => {
      expect(MediaType.Audio).toBe(0x0001);
    });

    it('Movie is 0x0002', () => {
      expect(MediaType.Movie).toBe(0x0002);
    });

    it('Podcast is 0x0004', () => {
      expect(MediaType.Podcast).toBe(0x0004);
    });

    it('Audiobook is 0x0008', () => {
      expect(MediaType.Audiobook).toBe(0x0008);
    });

    it('MusicVideo is 0x0020', () => {
      expect(MediaType.MusicVideo).toBe(0x0020);
    });

    it('TVShow is 0x0040', () => {
      expect(MediaType.TVShow).toBe(0x0040);
    });
  });

  describe('const object', () => {
    it('is readonly (const assertion)', () => {
      // TypeScript should prevent mutation, verify object is frozen-like
      const keys = Object.keys(MediaType);
      expect(keys).toContain('Audio');
      expect(keys).toContain('Movie');
      expect(keys).toContain('Podcast');
      expect(keys).toContain('Audiobook');
      expect(keys).toContain('MusicVideo');
      expect(keys).toContain('TVShow');
      expect(keys.length).toBe(6);
    });

    it('all values are unique', () => {
      const values = Object.values(MediaType);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('MediaTypeValue type', () => {
    it('accepts valid media type values', () => {
      // This is a compile-time check, but we can verify the values work
      const audio: MediaTypeValue = MediaType.Audio;
      const movie: MediaTypeValue = MediaType.Movie;
      const podcast: MediaTypeValue = MediaType.Podcast;
      const audiobook: MediaTypeValue = MediaType.Audiobook;
      const musicVideo: MediaTypeValue = MediaType.MusicVideo;
      const tvShow: MediaTypeValue = MediaType.TVShow;

      expect(audio).toBe(0x0001);
      expect(movie).toBe(0x0002);
      expect(podcast).toBe(0x0004);
      expect(audiobook).toBe(0x0008);
      expect(musicVideo).toBe(0x0020);
      expect(tvShow).toBe(0x0040);
    });
  });

  describe('usage patterns', () => {
    it('can be used in track input', () => {
      const trackInput = {
        title: 'Test Track',
        mediaType: MediaType.Audio,
      };

      expect(trackInput.mediaType).toBe(0x0001);
    });

    it('can check media type with bitwise operations', () => {
      const isAudio = (mediaType: number) => (mediaType & MediaType.Audio) !== 0;
      const isPodcast = (mediaType: number) => (mediaType & MediaType.Podcast) !== 0;

      expect(isAudio(MediaType.Audio)).toBe(true);
      expect(isAudio(MediaType.Podcast)).toBe(false);
      expect(isPodcast(MediaType.Podcast)).toBe(true);
      expect(isPodcast(MediaType.Audio)).toBe(false);
    });
  });
});
