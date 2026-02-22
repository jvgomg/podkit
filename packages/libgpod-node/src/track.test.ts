/**
 * Unit tests for track utilities.
 * These tests don't require the native module.
 */

import { describe, it, expect } from 'bun:test';
import {
  starsToRating,
  ratingToStars,
  RATING_STEP,
  formatDuration,
  formatDurationLong,
  ipodPathToFilePath,
  filePathToIpodPath,
  estimateFileSize,
  createTrackInput,
  isAudioTrack,
  isVideoTrack,
  isPodcast,
  isAudiobook,
  trackDisplayName,
} from './track';
import { MediaType, type Track } from './types';

describe('track utilities', () => {
  describe('rating conversion', () => {
    it('RATING_STEP is 20', () => {
      expect(RATING_STEP).toBe(20);
    });

    it('converts 0 stars to 0 rating', () => {
      expect(starsToRating(0)).toBe(0);
    });

    it('converts 1-5 stars correctly', () => {
      expect(starsToRating(1)).toBe(20);
      expect(starsToRating(2)).toBe(40);
      expect(starsToRating(3)).toBe(60);
      expect(starsToRating(4)).toBe(80);
      expect(starsToRating(5)).toBe(100);
    });

    it('clamps stars to valid range', () => {
      expect(starsToRating(-1)).toBe(0);
      expect(starsToRating(6)).toBe(100);
      expect(starsToRating(100)).toBe(100);
    });

    it('rounds fractional stars', () => {
      expect(starsToRating(2.4)).toBe(40);
      expect(starsToRating(2.6)).toBe(60);
    });

    it('converts rating back to stars', () => {
      expect(ratingToStars(0)).toBe(0);
      expect(ratingToStars(20)).toBe(1);
      expect(ratingToStars(40)).toBe(2);
      expect(ratingToStars(60)).toBe(3);
      expect(ratingToStars(80)).toBe(4);
      expect(ratingToStars(100)).toBe(5);
    });

    it('floors intermediate ratings', () => {
      expect(ratingToStars(19)).toBe(0);
      expect(ratingToStars(39)).toBe(1);
      expect(ratingToStars(59)).toBe(2);
    });
  });

  describe('duration formatting', () => {
    it('formats zero duration', () => {
      expect(formatDuration(0)).toBe('0:00');
    });

    it('formats seconds only', () => {
      expect(formatDuration(1000)).toBe('0:01');
      expect(formatDuration(9000)).toBe('0:09');
      expect(formatDuration(59000)).toBe('0:59');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1:00');
      expect(formatDuration(61000)).toBe('1:01');
      expect(formatDuration(90000)).toBe('1:30');
      expect(formatDuration(599000)).toBe('9:59');
    });

    it('formats long durations', () => {
      expect(formatDuration(3600000)).toBe('60:00');
      expect(formatDuration(3661000)).toBe('61:01');
    });

    it('pads seconds with zero', () => {
      expect(formatDuration(61000)).toBe('1:01');
      expect(formatDuration(69000)).toBe('1:09');
    });
  });

  describe('long duration formatting', () => {
    it('uses mm:ss for durations under an hour', () => {
      expect(formatDurationLong(0)).toBe('0:00');
      expect(formatDurationLong(3599000)).toBe('59:59');
    });

    it('uses h:mm:ss for durations over an hour', () => {
      expect(formatDurationLong(3600000)).toBe('1:00:00');
      expect(formatDurationLong(3661000)).toBe('1:01:01');
      expect(formatDurationLong(7323000)).toBe('2:02:03');
    });
  });

  describe('path conversion', () => {
    it('converts iPod path to file path', () => {
      expect(ipodPathToFilePath(':iPod_Control:Music:F00:ABCD.mp3')).toBe(
        'iPod_Control/Music/F00/ABCD.mp3'
      );
    });

    it('handles paths without leading colon', () => {
      expect(ipodPathToFilePath('iPod_Control:Music:F00:ABCD.mp3')).toBe(
        'iPod_Control/Music/F00/ABCD.mp3'
      );
    });

    it('converts file path to iPod path', () => {
      expect(filePathToIpodPath('iPod_Control/Music/F00/ABCD.mp3')).toBe(
        ':iPod_Control:Music:F00:ABCD.mp3'
      );
    });

    it('handles paths with leading slash', () => {
      expect(filePathToIpodPath('/iPod_Control/Music/F00/ABCD.mp3')).toBe(
        ':iPod_Control:Music:F00:ABCD.mp3'
      );
    });
  });

  describe('file size estimation', () => {
    it('estimates size for 320kbps 3-minute track', () => {
      const size = estimateFileSize(180000, 320);
      // 180 seconds * 320000 bits/sec / 8 = 7,200,000 bytes
      expect(size).toBe(7200000);
    });

    it('estimates size for 128kbps 4-minute track', () => {
      const size = estimateFileSize(240000, 128);
      // 240 seconds * 128000 bits/sec / 8 = 3,840,000 bytes
      expect(size).toBe(3840000);
    });
  });

  describe('createTrackInput', () => {
    it('creates input with just title', () => {
      const input = createTrackInput('My Song');
      expect(input.title).toBe('My Song');
    });

    it('creates input with additional metadata', () => {
      const input = createTrackInput('My Song', {
        artist: 'My Artist',
        album: 'My Album',
        year: 2024,
      });
      expect(input.title).toBe('My Song');
      expect(input.artist).toBe('My Artist');
      expect(input.album).toBe('My Album');
      expect(input.year).toBe(2024);
    });
  });

  describe('media type checks', () => {
    const createTrack = (mediaType: number): Track =>
      ({
        id: 1,
        dbid: BigInt(1),
        title: 'Test',
        artist: null,
        album: null,
        albumArtist: null,
        genre: null,
        composer: null,
        comment: null,
        grouping: null,
        trackNumber: 0,
        totalTracks: 0,
        discNumber: 0,
        totalDiscs: 0,
        year: 0,
        duration: 0,
        bitrate: 0,
        sampleRate: 0,
        size: 0,
        bpm: 0,
        filetype: null,
        mediaType,
        ipodPath: null,
        timeAdded: 0,
        timeModified: 0,
        timePlayed: 0,
        timeReleased: 0,
        playCount: 0,
        skipCount: 0,
        rating: 0,
        hasArtwork: false,
        compilation: false,
        transferred: false,
      }) as Track;

    it('identifies audio tracks', () => {
      expect(isAudioTrack(createTrack(MediaType.Audio))).toBe(true);
      expect(isAudioTrack(createTrack(MediaType.Movie))).toBe(false);
    });

    it('identifies video tracks', () => {
      expect(isVideoTrack(createTrack(MediaType.Movie))).toBe(true);
      expect(isVideoTrack(createTrack(MediaType.Audio))).toBe(false);
    });

    it('identifies podcasts', () => {
      expect(isPodcast(createTrack(MediaType.Podcast))).toBe(true);
      expect(isPodcast(createTrack(MediaType.Audio))).toBe(false);
    });

    it('identifies audiobooks', () => {
      expect(isAudiobook(createTrack(MediaType.Audiobook))).toBe(true);
      expect(isAudiobook(createTrack(MediaType.Audio))).toBe(false);
    });

    it('handles combined media types', () => {
      const videoPodcast = MediaType.Movie | MediaType.Podcast;
      const track = createTrack(videoPodcast);
      expect(isVideoTrack(track)).toBe(true);
      expect(isPodcast(track)).toBe(true);
      expect(isAudioTrack(track)).toBe(false);
    });
  });

  describe('trackDisplayName', () => {
    const createTrack = (
      title: string | null,
      artist: string | null
    ): Track =>
      ({
        id: 1,
        dbid: BigInt(1),
        title,
        artist,
        album: null,
        albumArtist: null,
        genre: null,
        composer: null,
        comment: null,
        grouping: null,
        trackNumber: 0,
        totalTracks: 0,
        discNumber: 0,
        totalDiscs: 0,
        year: 0,
        duration: 0,
        bitrate: 0,
        sampleRate: 0,
        size: 0,
        bpm: 0,
        filetype: null,
        mediaType: MediaType.Audio,
        ipodPath: null,
        timeAdded: 0,
        timeModified: 0,
        timePlayed: 0,
        timeReleased: 0,
        playCount: 0,
        skipCount: 0,
        rating: 0,
        hasArtwork: false,
        compilation: false,
        transferred: false,
      }) as Track;

    it('formats artist and title', () => {
      expect(trackDisplayName(createTrack('Song', 'Artist'))).toBe(
        'Artist - Song'
      );
    });

    it('handles missing artist', () => {
      expect(trackDisplayName(createTrack('Song', null))).toBe(
        'Unknown Artist - Song'
      );
    });

    it('handles missing title', () => {
      expect(trackDisplayName(createTrack(null, 'Artist'))).toBe(
        'Artist - Unknown Title'
      );
    });

    it('handles both missing', () => {
      expect(trackDisplayName(createTrack(null, null))).toBe(
        'Unknown Artist - Unknown Title'
      );
    });
  });
});
