import { describe, it, expect } from 'bun:test';
import type { MassStoragePreset } from '@podkit/devices-mass-storage';
import { assessMassStorageDevice, type MassStorageAssessment } from './mass-storage-identity.js';

describe('assessMassStorageDevice', () => {
  it('resolves a built-in preset (echo-mini) with default capabilities', () => {
    const result = assessMassStorageDevice('/Volumes/EchoMini', { presetId: 'echo-mini' });

    expect(result.identity).toEqual({ kind: 'mass-storage', presetId: 'echo-mini' });
    expect(result.preset).not.toBeNull();
    // echo-mini puts music at the device root (musicDir is an empty string)
    expect(result.preset?.contentPaths.musicDir).toBe('');
    expect(result.capabilities).not.toBeNull();
    expect(result.capabilities?.supportsVideo).toBe(false);
    expect(result.mountPoint).toBe('/Volumes/EchoMini');
  });

  it('resolves the generic preset', () => {
    const result = assessMassStorageDevice('/Volumes/SomeDap', { presetId: 'generic' });
    expect(result.preset).not.toBeNull();
    expect(result.capabilities).not.toBeNull();
  });

  it('returns preset: null and capabilities: null for unknown preset id', () => {
    const result = assessMassStorageDevice('/Volumes/X', { presetId: 'no-such-preset' });
    expect(result.identity.presetId).toBe('no-such-preset');
    expect(result.preset).toBeNull();
    expect(result.capabilities).toBeNull();
    expect(result.mountPoint).toBe('/Volumes/X');
  });

  it('applies per-call overrides on top of preset capabilities', () => {
    const result = assessMassStorageDevice('/Volumes/EchoMini', {
      presetId: 'echo-mini',
      overrides: { supportsVideo: true, artworkMaxResolution: 512 },
    });
    expect(result.capabilities?.supportsVideo).toBe(true);
    expect(result.capabilities?.artworkMaxResolution).toBe(512);
  });

  it('does not validate the mount path — passes it through verbatim', () => {
    const result = assessMassStorageDevice('/path/that/does/not/exist', {
      presetId: 'generic',
    });
    expect(result.mountPoint).toBe('/path/that/does/not/exist');
    expect(result.preset).not.toBeNull();
  });

  it('honours a user-supplied preset registry that shadows built-ins', () => {
    const customEchoMini: MassStoragePreset = {
      artworkSources: ['embedded'],
      artworkMaxResolution: 1024,
      supportedAudioCodecs: ['flac'],
      supportsVideo: true,
      audioNormalization: 'replaygain',
      supportsAlbumArtistBrowsing: true,
      contentPaths: {
        musicDir: 'Custom/Music',
        moviesDir: 'Custom/Movies',
        tvShowsDir: 'Custom/Shows',
      },
    };
    const result = assessMassStorageDevice('/Volumes/X', {
      presetId: 'echo-mini',
      presets: { 'echo-mini': customEchoMini },
    });
    expect(result.preset?.contentPaths.musicDir).toBe('Custom/Music');
    expect(result.capabilities?.artworkMaxResolution).toBe(1024);
    expect(result.capabilities?.supportedAudioCodecs).toEqual(['flac']);
  });

  it('produces a stable assessment shape consumable by callers', () => {
    const result: MassStorageAssessment = assessMassStorageDevice('/Volumes/X', {
      presetId: 'rockbox',
    });
    expect(result).toHaveProperty('identity');
    expect(result).toHaveProperty('preset');
    expect(result).toHaveProperty('capabilities');
    expect(result).toHaveProperty('mountPoint');
  });
});
