import { test, expect } from 'bun:test';
import type { DeviceCapabilities } from './index.js';

test('exports DeviceCapabilities type', () => {
  // Verify the type is importable and structurally valid at runtime via a noop assignment.
  const cap: DeviceCapabilities = {
    artworkSources: ['database'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'mp3'],
    supportsVideo: false,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  };
  expect(cap.artworkMaxResolution).toBe(320);
});
