import { describe, expect, it } from 'bun:test';
import {
  VERSION,
  createError,
  PRESETS,
  IPOD_ARTWORK_FORMATS,
  EXTERNAL_ARTWORK_NAMES,
  IpodError,
  MediaType,
  IpodDatabase,
} from './index';
import type {
  AudioFileType,
  TrackMetadata,
  CollectionTrack,
  SyncOperation,
  ArtworkSource,
  TrackInput,
  TrackFields,
  IPodTrack,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  SaveResult,
  IpodErrorCode,
  MediaTypeValue,
} from './index';

describe('podkit-core', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.0.0');
  });

  describe('createError helper', () => {
    it('creates device-not-found error', () => {
      const error = createError('device-not-found', { message: 'iPod not found' });
      expect(error.type).toBe('device-not-found');
      expect(error.message).toBe('iPod not found');
    });

    it('creates space-error with required fields', () => {
      const error = createError('space-error', { required: 1000, available: 500 });
      expect(error.type).toBe('space-error');
      expect(error.required).toBe(1000);
      expect(error.available).toBe(500);
    });

    it('creates transcode-error with file path', () => {
      const error = createError('transcode-error', { file: '/path/to/file.flac', message: 'FFmpeg failed' });
      expect(error.type).toBe('transcode-error');
      expect(error.file).toBe('/path/to/file.flac');
      expect(error.message).toBe('FFmpeg failed');
    });
  });

  describe('PRESETS constant', () => {
    it('exports high preset with correct defaults', () => {
      expect(PRESETS.high).toEqual({
        name: 'high',
        codec: 'aac',
        container: 'm4a',
        bitrate: 256,
        sampleRate: 44100,
      });
    });

    it('exports medium preset with correct defaults', () => {
      expect(PRESETS.medium).toEqual({
        name: 'medium',
        codec: 'aac',
        container: 'm4a',
        bitrate: 192,
        sampleRate: 44100,
      });
    });

    it('exports low preset with correct defaults', () => {
      expect(PRESETS.low).toEqual({
        name: 'low',
        codec: 'aac',
        container: 'm4a',
        bitrate: 128,
        sampleRate: 44100,
      });
    });
  });

  describe('IPOD_ARTWORK_FORMATS constant', () => {
    it('exports video formats', () => {
      expect(IPOD_ARTWORK_FORMATS.video).toHaveLength(2);
      expect(IPOD_ARTWORK_FORMATS.video[0]).toEqual({ width: 100, height: 100, format: 'rgb565' });
      expect(IPOD_ARTWORK_FORMATS.video[1]).toEqual({ width: 200, height: 200, format: 'rgb565' });
    });

    it('exports nano formats', () => {
      expect(IPOD_ARTWORK_FORMATS.nano).toHaveLength(2);
      expect(IPOD_ARTWORK_FORMATS.nano[0]).toEqual({ width: 42, height: 42, format: 'rgb565' });
    });

    it('exports classic formats', () => {
      expect(IPOD_ARTWORK_FORMATS.classic).toHaveLength(3);
      expect(IPOD_ARTWORK_FORMATS.classic[2]).toEqual({ width: 320, height: 320, format: 'rgb565' });
    });
  });

  describe('EXTERNAL_ARTWORK_NAMES constant', () => {
    it('includes common cover filenames', () => {
      expect(EXTERNAL_ARTWORK_NAMES).toContain('cover.jpg');
      expect(EXTERNAL_ARTWORK_NAMES).toContain('cover.png');
      expect(EXTERNAL_ARTWORK_NAMES).toContain('folder.jpg');
      expect(EXTERNAL_ARTWORK_NAMES).toContain('album.jpg');
      expect(EXTERNAL_ARTWORK_NAMES).toContain('front.jpg');
    });

    it('has expected number of patterns', () => {
      expect(EXTERNAL_ARTWORK_NAMES.length).toBe(12);
    });
  });

  describe('type exports compile correctly', () => {
    // These tests verify that types are exported and can be used
    // They serve as compile-time checks

    it('can use AudioFileType', () => {
      const fileType: AudioFileType = 'flac';
      expect(fileType).toBe('flac');
    });

    it('can construct TrackMetadata', () => {
      const metadata: TrackMetadata = {
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
      };
      expect(metadata.title).toBe('Test Song');
    });

    it('can construct CollectionTrack', () => {
      const track: CollectionTrack = {
        id: 'test-id',
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        filePath: '/path/to/file.flac',
        fileType: 'flac',
      };
      expect(track.id).toBe('test-id');
    });

    it('can construct SyncOperation variants', () => {
      const copyOp: SyncOperation = {
        type: 'copy',
        source: {
          id: 'test',
          title: 'Test',
          artist: 'Artist',
          album: 'Album',
          filePath: '/path',
          fileType: 'mp3',
        },
      };
      expect(copyOp.type).toBe('copy');

      const transcodeOp: SyncOperation = {
        type: 'transcode',
        source: {
          id: 'test',
          title: 'Test',
          artist: 'Artist',
          album: 'Album',
          filePath: '/path',
          fileType: 'flac',
        },
        preset: { name: 'high' },
      };
      expect(transcodeOp.type).toBe('transcode');
    });

    it('can construct ArtworkSource variants', () => {
      const embedded: ArtworkSource = { type: 'embedded', audioFile: '/path/to/file.flac' };
      expect(embedded.type).toBe('embedded');

      const external: ArtworkSource = { type: 'external', imagePath: '/path/to/cover.jpg' };
      expect(external.type).toBe('external');

      const buffer: ArtworkSource = { type: 'buffer', data: Buffer.from('test'), mimeType: 'image/jpeg' };
      expect(buffer.type).toBe('buffer');
    });
  });

  describe('iPod database abstraction exports', () => {
    it('exports IpodDatabase class', () => {
      expect(IpodDatabase).toBeDefined();
      expect(typeof IpodDatabase.open).toBe('function');
    });

    it('exports IpodError class', () => {
      const error = new IpodError('test error', 'NOT_FOUND');
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('test error');
    });

    it('exports MediaType constants', () => {
      expect(MediaType.Audio).toBe(0x0001);
      expect(MediaType.Podcast).toBe(0x0004);
      expect(MediaType.Audiobook).toBe(0x0008);
      expect(MediaType.MusicVideo).toBe(0x0020);
      expect(MediaType.TVShow).toBe(0x0040);
    });

    it('can use IpodErrorCode type', () => {
      const code: IpodErrorCode = 'DATABASE_CORRUPT';
      expect(code).toBe('DATABASE_CORRUPT');
    });

    it('can use MediaTypeValue type', () => {
      const value: MediaTypeValue = MediaType.Audio;
      expect(value).toBe(0x0001);
    });

    it('can construct TrackInput', () => {
      const input: TrackInput = {
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        mediaType: MediaType.Audio,
      };
      expect(input.title).toBe('Test Song');
      expect(input.mediaType).toBe(0x0001);
    });

    it('can construct TrackFields', () => {
      const fields: TrackFields = {
        title: 'Updated Title',
        rating: 80,
      };
      expect(fields.title).toBe('Updated Title');
      expect(fields.rating).toBe(80);
    });

    it('can construct IpodDeviceInfo shape', () => {
      const device: IpodDeviceInfo = {
        modelName: 'iPod Video (60GB)',
        modelNumber: 'MA147',
        generation: 'video_1',
        capacity: 60,
        supportsArtwork: true,
        supportsVideo: true,
        supportsPhoto: true,
        supportsPodcast: true,
      };
      expect(device.modelName).toBe('iPod Video (60GB)');
      expect(device.capacity).toBe(60);
    });

    it('can construct IpodInfo shape', () => {
      const info: IpodInfo = {
        mountPoint: '/Volumes/IPOD',
        trackCount: 100,
        playlistCount: 5,
        device: {
          modelName: 'iPod Classic',
          modelNumber: null,
          generation: 'classic_1',
          capacity: 80,
          supportsArtwork: true,
          supportsVideo: true,
          supportsPhoto: true,
          supportsPodcast: true,
        },
      };
      expect(info.mountPoint).toBe('/Volumes/IPOD');
      expect(info.trackCount).toBe(100);
    });

    it('can construct SaveResult shape', () => {
      const result: SaveResult = {
        warnings: ['3 tracks have no audio file'],
      };
      expect(result.warnings).toHaveLength(1);
    });

    // IPodTrack and IpodPlaylist are interfaces with methods
    it('IPodTrack type is exported', () => {
      // Compile-time check - we can reference the type
      type TrackType = IPodTrack;
      const _typeCheck: TrackType | null = null;
      expect(_typeCheck).toBeNull();
    });

    it('IpodPlaylist type is exported', () => {
      // Compile-time check - we can reference the type
      type PlaylistType = IpodPlaylist;
      const _typeCheck: PlaylistType | null = null;
      expect(_typeCheck).toBeNull();
    });
  });
});
