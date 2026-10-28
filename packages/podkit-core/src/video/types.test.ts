import { describe, it, expect } from 'bun:test';
import {
  // Types (runtime check via typeof)
  VIDEO_QUALITY_PRESETS,
  DEVICE_PROFILES,
  VIDEO_PRESET_SETTINGS,
  // Functions
  isValidVideoQualityPreset,
  getDeviceProfile,
  getDefaultDeviceProfile,
  getDeviceProfileNames,
  getDeviceProfileByGeneration,
  getDeviceProfileByIpodGeneration,
  getPresetSettings,
  getPresetSettingsWithFallback,
} from './types.js';
import { GENERATIONS } from '@podkit/devices-ipod';
import { calculateEffectiveSettings } from './quality.js';
import type {
  VideoQualityPreset,
  VideoDeviceProfile,
  VideoSourceAnalysis,
  VideoTranscodeSettings,
  VideoCompatibilityStatus,
  VideoCompatibility,
  VideoPresetSettings,
} from './types.js';

describe('video/types', () => {
  describe('VIDEO_QUALITY_PRESETS', () => {
    it('contains all expected presets', () => {
      expect(VIDEO_QUALITY_PRESETS).toContain('max');
      expect(VIDEO_QUALITY_PRESETS).toContain('high');
      expect(VIDEO_QUALITY_PRESETS).toContain('medium');
      expect(VIDEO_QUALITY_PRESETS).toContain('low');
      expect(VIDEO_QUALITY_PRESETS).toHaveLength(4);
    });

    it('is readonly', () => {
      // TypeScript prevents modification, but we verify structure
      expect(Array.isArray(VIDEO_QUALITY_PRESETS)).toBe(true);
    });
  });

  describe('isValidVideoQualityPreset', () => {
    it('returns true for valid presets', () => {
      expect(isValidVideoQualityPreset('max')).toBe(true);
      expect(isValidVideoQualityPreset('high')).toBe(true);
      expect(isValidVideoQualityPreset('medium')).toBe(true);
      expect(isValidVideoQualityPreset('low')).toBe(true);
    });

    it('returns false for invalid presets', () => {
      expect(isValidVideoQualityPreset('ultra')).toBe(false);
      expect(isValidVideoQualityPreset('')).toBe(false);
      expect(isValidVideoQualityPreset('HIGH')).toBe(false); // case-sensitive
      expect(isValidVideoQualityPreset('lossless')).toBe(false); // audio preset
    });
  });

  describe('DEVICE_PROFILES', () => {
    it('contains iPod Classic profile', () => {
      const profile = DEVICE_PROFILES['ipod-classic']!;
      expect(profile).toBeDefined();
      expect(profile.displayName).toBe('iPod Classic');
      expect(profile.maxWidth).toBe(640);
      expect(profile.maxHeight).toBe(480);
      expect(profile.videoProfile).toBe('main');
      expect(profile.videoLevel).toBe('3.1');
      expect(profile.maxVideoBitrate).toBe(2500);
      expect(profile.maxAudioBitrate).toBe(160);
    });

    it('contains iPod Video 5G profile', () => {
      const profile = DEVICE_PROFILES['ipod-video-5g']!;
      expect(profile).toBeDefined();
      expect(profile.displayName).toBe('iPod Video (5th Gen)');
      expect(profile.maxWidth).toBe(320);
      expect(profile.maxHeight).toBe(240);
      expect(profile.videoProfile).toBe('baseline');
      expect(profile.videoLevel).toBe('3.0');
      expect(profile.maxVideoBitrate).toBe(768);
      expect(profile.maxAudioBitrate).toBe(128);
    });

    it('contains iPod Nano 3G profile', () => {
      const profile = DEVICE_PROFILES['ipod-nano-3g']!;
      expect(profile).toBeDefined();
      expect(profile.displayName).toBe('iPod Nano (3rd-5th Gen)');
      expect(profile.maxWidth).toBe(320);
      expect(profile.maxHeight).toBe(240);
      expect(profile.videoProfile).toBe('baseline');
    });

    it('all profiles have required fields', () => {
      for (const [name, profile] of Object.entries(DEVICE_PROFILES)) {
        expect(profile.name).toBe(name);
        expect(typeof profile.displayName).toBe('string');
        expect(typeof profile.maxWidth).toBe('number');
        expect(typeof profile.maxHeight).toBe('number');
        expect(typeof profile.maxVideoBitrate).toBe('number');
        expect(typeof profile.maxAudioBitrate).toBe('number');
        expect(profile.videoCodec).toBe('h264');
        expect(['baseline', 'main']).toContain(profile.videoProfile);
        expect(typeof profile.videoLevel).toBe('string');
        expect(profile.audioCodec).toBe('aac');
        expect(typeof profile.maxFrameRate).toBe('number');
        expect(profile.supportsVideo).toBe(true);
      }
    });
  });

  describe('getDeviceProfile', () => {
    it('returns profile for valid name', () => {
      const profile = getDeviceProfile('ipod-classic');
      expect(profile).toBeDefined();
      expect(profile?.name).toBe('ipod-classic');
    });

    it('returns undefined for invalid name', () => {
      const profile = getDeviceProfile('invalid-device');
      expect(profile).toBeUndefined();
    });
  });

  describe('getDefaultDeviceProfile', () => {
    it('returns iPod Classic profile', () => {
      const profile = getDefaultDeviceProfile();
      expect(profile.name).toBe('ipod-classic');
      expect(profile.displayName).toBe('iPod Classic');
    });
  });

  describe('getDeviceProfileNames', () => {
    it('returns all profile names', () => {
      const names = getDeviceProfileNames();
      expect(names).toContain('ipod-classic');
      expect(names).toContain('ipod-video-5g');
      expect(names).toContain('ipod-nano-3g');
      expect(names).toContain('ipod-nano-7g');
      expect(names).toHaveLength(4);
    });
  });

  describe('getDeviceProfileByIpodGeneration', () => {
    it('selects the Nano 7G profile for nano_7g', () => {
      expect(getDeviceProfileByIpodGeneration('nano_7g')?.name).toBe('ipod-nano-7g');
    });

    it('covers every video-capable generation podkit can open, and nothing else', () => {
      for (const gen of Object.values(GENERATIONS)) {
        const expected = gen.supportsVideo && gen.support.access !== 'none';
        expect([gen.id, getDeviceProfileByIpodGeneration(gen.id) !== undefined]).toEqual([
          gen.id,
          expected,
        ]);
      }
    });

    it('agrees with the libgpod mapping for generations libgpod knows', () => {
      const pairs: Array<[string, string]> = [
        ['video_5g', 'video_1'],
        ['video_5_5g', 'video_2'],
        ['classic_6g', 'classic_1'],
        ['classic_7g', 'classic_3'],
        ['nano_3g', 'nano_3'],
        ['nano_5g', 'nano_5'],
      ];
      for (const [podkitId, libgpodId] of pairs) {
        expect(getDeviceProfileByIpodGeneration(podkitId)?.name).toBe(
          getDeviceProfileByGeneration(libgpodId).name
        );
      }
    });
  });

  describe('Nano 7G effective settings', () => {
    const source = (width: number, height: number): VideoSourceAnalysis => ({
      filePath: '/x.mkv',
      container: 'mkv',
      videoCodec: 'h264',
      videoProfile: 'high',
      videoLevel: '4.1',
      width,
      height,
      videoBitrate: 8000,
      frameRate: 60,
      audioCodec: 'ac3',
      audioBitrate: 384,
      audioChannels: 6,
      audioSampleRate: 48000,
      duration: 60,
      hasVideoStream: true,
      hasAudioStream: true,
    });
    const nano7 = DEVICE_PROFILES['ipod-nano-7g']!;

    it('fits 16:9 into 432x240 with even dimensions, Baseline 3.0, 30 fps', () => {
      const s = calculateEffectiveSettings(source(1920, 1080), 'high', nano7);
      expect([s.targetWidth, s.targetHeight]).toEqual([426, 240]);
      expect(s.videoProfile).toBe('baseline');
      expect(s.videoLevel).toBe('3.0');
      expect(s.frameRate).toBe(30);
      expect(s.targetVideoBitrate).toBe(800);
    });

    it('fits 4:3 by height and 2.39:1 by width', () => {
      const fourThree = calculateEffectiveSettings(source(1440, 1080), 'max', nano7);
      expect([fourThree.targetWidth, fourThree.targetHeight]).toEqual([320, 240]);
      const scope = calculateEffectiveSettings(source(1920, 804), 'low', nano7);
      expect([scope.targetWidth, scope.targetHeight]).toEqual([432, 180]);
      expect(scope.targetVideoBitrate).toBe(400);
    });
  });

  describe('VIDEO_PRESET_SETTINGS', () => {
    it('has settings for all device profiles', () => {
      for (const deviceName of getDeviceProfileNames()) {
        expect(VIDEO_PRESET_SETTINGS[deviceName]).toBeDefined();
      }
    });

    it('has settings for all quality presets per device', () => {
      for (const deviceName of getDeviceProfileNames()) {
        const settings = VIDEO_PRESET_SETTINGS[deviceName]!;
        for (const preset of VIDEO_QUALITY_PRESETS) {
          expect(settings[preset]).toBeDefined();
          expect(typeof settings[preset]!.videoBitrate).toBe('number');
          expect(typeof settings[preset]!.audioBitrate).toBe('number');
          expect(typeof settings[preset]!.crf).toBe('number');
        }
      }
    });

    it('has higher bitrate for higher quality presets', () => {
      const classic = VIDEO_PRESET_SETTINGS['ipod-classic']!;
      expect(classic.max.videoBitrate).toBeGreaterThan(classic.high.videoBitrate);
      expect(classic.high.videoBitrate).toBeGreaterThan(classic.medium.videoBitrate);
      expect(classic.medium.videoBitrate).toBeGreaterThan(classic.low.videoBitrate);
    });

    it('has lower CRF for higher quality presets (lower = better)', () => {
      const classic = VIDEO_PRESET_SETTINGS['ipod-classic']!;
      expect(classic.max.crf).toBeLessThan(classic.high.crf);
      expect(classic.high.crf).toBeLessThan(classic.medium.crf);
      expect(classic.medium.crf).toBeLessThan(classic.low.crf);
    });
  });

  describe('getPresetSettings', () => {
    it('returns settings for valid device and preset', () => {
      const settings = getPresetSettings('ipod-classic', 'high')!;
      expect(settings).toBeDefined();
      expect(settings.videoBitrate).toBe(2000);
      expect(settings.audioBitrate).toBe(128);
      expect(settings.crf).toBe(21);
    });

    it('returns undefined for invalid device', () => {
      const settings = getPresetSettings('invalid-device', 'high');
      expect(settings).toBeUndefined();
    });
  });

  describe('getPresetSettingsWithFallback', () => {
    it('returns settings for valid device', () => {
      const settings = getPresetSettingsWithFallback('ipod-video-5g', 'high');
      expect(settings.videoBitrate).toBe(600);
    });

    it('falls back to iPod Classic for invalid device', () => {
      const settings = getPresetSettingsWithFallback('invalid-device', 'high');
      expect(settings.videoBitrate).toBe(2000); // iPod Classic high
    });
  });

  describe('type exports', () => {
    it('VideoQualityPreset type is usable', () => {
      const preset: VideoQualityPreset = 'high';
      expect(isValidVideoQualityPreset(preset)).toBe(true);
    });

    it('VideoDeviceProfile type is usable', () => {
      const profile: VideoDeviceProfile = getDefaultDeviceProfile();
      expect(profile.supportsVideo).toBe(true);
    });

    it('VideoCompatibilityStatus type is usable', () => {
      const statuses: VideoCompatibilityStatus[] = ['passthrough', 'transcode', 'unsupported'];
      expect(statuses).toHaveLength(3);
    });

    it('VideoCompatibility type is usable', () => {
      const compatibility: VideoCompatibility = {
        status: 'transcode',
        reasons: ['Container is MKV, needs remux'],
        warnings: ['Low quality source'],
      };
      expect(compatibility.status).toBe('transcode');
      expect(compatibility.reasons).toHaveLength(1);
      expect(compatibility.warnings).toHaveLength(1);
    });

    it('VideoSourceAnalysis type is usable', () => {
      const analysis: VideoSourceAnalysis = {
        filePath: '/path/to/video.mkv',
        container: 'mkv',
        videoCodec: 'h264',
        videoProfile: 'main',
        videoLevel: '4.0',
        width: 1920,
        height: 1080,
        videoBitrate: 8000,
        frameRate: 24,
        audioCodec: 'aac',
        audioBitrate: 192,
        audioChannels: 2,
        audioSampleRate: 48000,
        duration: 7200,
        hasVideoStream: true,
        hasAudioStream: true,
      };
      expect(analysis.hasVideoStream).toBe(true);
    });

    it('VideoTranscodeSettings type is usable', () => {
      const settings: VideoTranscodeSettings = {
        targetWidth: 640,
        targetHeight: 480,
        targetVideoBitrate: 2000,
        targetAudioBitrate: 128,
        videoProfile: 'main',
        videoLevel: '3.1',
        crf: 21,
        frameRate: 30,
        useHardwareAcceleration: true,
      };
      expect(settings.useHardwareAcceleration).toBe(true);
    });

    it('VideoPresetSettings type is usable', () => {
      const settings: VideoPresetSettings = {
        videoBitrate: 2000,
        audioBitrate: 128,
        crf: 21,
      };
      expect(settings.crf).toBe(21);
    });
  });
});
