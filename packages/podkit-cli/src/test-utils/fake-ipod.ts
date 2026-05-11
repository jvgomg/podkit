/**
 * Test-only factories for iPod adapter / openDevice stubs.
 *
 * Tests that drive past `IpodDatabase.open(...)` or `openDevice(core, ...)`
 * use these to assemble a minimal but type-correct stub. Per-test overrides
 * are merged on top of safe defaults, so a test only needs to spell out
 * what it cares about.
 */

import type { DeviceAdapter, DeviceCapabilities, IpodTrack } from '@podkit/core';
import type { IpodAdapterStub } from '../handler-deps.js';
import type { OpenDeviceResult } from '../commands/open-device.js';

/**
 * Build a fake `IpodAdapterStub` with safe defaults. Per-test overrides
 * replace any subset of fields.
 */
export function makeFakeIpodAdapter(overrides: Partial<IpodAdapterStub> = {}): IpodAdapterStub {
  return {
    trackCount: 0,
    device: {
      modelName: 'iPod nano (test)',
      modelNumber: 'TEST123',
      generation: 'nano_2g',
      capacity: 4,
    },
    getTracks: () => [],
    removeAllTracks: () => ({ removedCount: 0, fileDeleteErrors: [] }),
    removeTracksByContentType: () => ({ removedCount: 0, fileDeleteErrors: [] }),
    save: async () => {},
    close: () => {},
    ...overrides,
  };
}

/**
 * Build a minimal fake `IpodTrack`. Only the fields the runners read are
 * populated — extend via overrides when a specific test needs more.
 */
export function makeFakeIpodTrack(overrides: Partial<IpodTrack> = {}): IpodTrack {
  return {
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    albumArtist: '',
    genre: '',
    composer: '',
    comment: '',
    trackNumber: 0,
    discNumber: 0,
    year: 0,
    compilation: false,
    duration: 0,
    bitrate: 0,
    sampleRate: 0,
    size: 0,
    filetype: 'mp3',
    mediaType: 1, // 1 = audio (`isMusicMediaType` returns true)
    filePath: '/iPod_Control/Music/F00/track.mp3',
    hasArtwork: false,
    hasFile: true,
    normalization: undefined,
    syncTag: null,
    ...overrides,
  } as IpodTrack;
}

const NULL_CAPABILITIES: DeviceCapabilities = {
  artworkSources: [],
  artworkMaxResolution: 0,
  supportedAudioCodecs: ['mp3', 'aac'],
  supportsVideo: false,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

/**
 * Build a fake `OpenDeviceResult`. Pass `tracks` for the simple case where
 * the test wants a known set of tracks via `adapter.getTracks()`. Pass
 * `adapter` directly for finer control.
 */
export function makeFakeOpenDeviceResult(
  opts: {
    tracks?: IpodTrack[];
    capabilities?: Partial<DeviceCapabilities>;
    isIpodDevice?: boolean;
    adapter?: DeviceAdapter;
    ipod?: OpenDeviceResult['ipod'];
  } = {}
): OpenDeviceResult {
  const tracks = opts.tracks ?? [];
  const capabilities: DeviceCapabilities = { ...NULL_CAPABILITIES, ...(opts.capabilities ?? {}) };
  const adapter =
    opts.adapter ??
    ({
      getTracks: () => tracks,
      close: () => {},
    } as unknown as DeviceAdapter);
  return {
    adapter,
    capabilities,
    deviceSupportsAlac: capabilities.supportedAudioCodecs.includes('alac'),
    isIpodDevice: opts.isIpodDevice ?? true,
    ipod: opts.ipod,
  };
}
