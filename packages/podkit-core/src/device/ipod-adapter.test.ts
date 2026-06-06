/**
 * Unit tests for IpodDeviceAdapter — fast tests that don't need real libgpod.
 *
 * The full integration coverage lives in `ipod-adapter.integration.test.ts`
 * (real libgpod via `createTestIpod`). The tests here use a minimal
 * IpodDatabase stub to assert behaviour the integration tests can't
 * easily force — specifically, that libgpod failures coming OUT of the
 * mutators get wrapped in `DatabaseWriteError` so the executor's
 * categorizer reads them as `database` (no retry) rather than falling
 * through to the op-type fallback.
 */

import { describe, expect, it } from 'bun:test';

import { IpodDeviceAdapter } from './ipod-adapter.js';
import { DatabaseWriteError } from '../sync/engine/errors.js';
import type { DeviceCapabilities } from '@podkit/device-types';
import type { IpodDatabase } from '../ipod/database.js';
import type { IpodTrack } from '../ipod/types.js';

// =============================================================================
// Stub IpodDatabase — only the methods IpodDeviceAdapter touches.
// =============================================================================

interface MutatorOverrides {
  addTrack?: () => IpodTrack;
  updateTrack?: () => IpodTrack;
  removeTrack?: () => void;
  save?: () => Promise<void>;
}

function makeStubIpod(overrides: MutatorOverrides = {}): IpodDatabase {
  const stubTrack = {
    title: 'Stub',
    artist: 'Stub',
    album: 'Stub',
    filePath: 'Music/F00/X.mp3',
    _internalHandle: { index: 0 },
  } as unknown as IpodTrack;

  const stub = {
    mountPoint: '/stub',
    getTracks: () => [],
    addTrack: overrides.addTrack ?? (() => stubTrack),
    updateTrack: overrides.updateTrack ?? (() => stubTrack),
    removeTrack: overrides.removeTrack ?? (() => undefined),
    save: overrides.save ?? (async () => undefined),
    close: () => undefined,
  };
  return stub as unknown as IpodDatabase;
}

const MIN_CAPS: DeviceCapabilities = {
  artworkSources: ['database'],
  artworkMaxResolution: 320,
  supportedAudioCodecs: ['mp3', 'aac'],
  audioNormalization: 'soundcheck',
  supportsVideo: false,
  supportsAlbumArtistBrowsing: true,
} as DeviceCapabilities;

// =============================================================================
// Mutator wrap tests
// =============================================================================

describe('IpodDeviceAdapter mutator wraps libgpod errors in DatabaseWriteError', () => {
  it('addTrack: wraps a raw Error from libgpod', () => {
    const ipod = makeStubIpod({
      addTrack: () => {
        throw new Error('libgpod: itunesdb full');
      },
    });
    const adapter = new IpodDeviceAdapter(ipod, MIN_CAPS);

    let thrown: unknown;
    try {
      adapter.addTrack({ title: 'X', artist: 'Y', album: 'Z' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DatabaseWriteError);
    expect((thrown as DatabaseWriteError).category).toBe('database');
    expect((thrown as DatabaseWriteError).message).toContain('itunesdb full');
    expect((thrown as DatabaseWriteError).underlying).toBeDefined();
  });

  it('updateTrack: wraps a raw Error from libgpod', () => {
    const stubTrack = {
      title: 'X',
      artist: 'Y',
      album: 'Z',
      filePath: 'Music/F00/X.mp3',
      _internalHandle: { index: 0 },
    } as unknown as IpodTrack;
    const ipod = makeStubIpod({
      updateTrack: () => {
        throw new Error('libgpod: write failed');
      },
    });
    const adapter = new IpodDeviceAdapter(ipod, MIN_CAPS);

    let thrown: unknown;
    try {
      adapter.updateTrack(stubTrack, { title: 'New' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DatabaseWriteError);
    expect((thrown as DatabaseWriteError).category).toBe('database');
  });

  it('removeTrack: wraps a raw Error from libgpod', () => {
    const stubTrack = {
      title: 'X',
      artist: 'Y',
      album: 'Z',
      filePath: 'Music/F00/X.mp3',
      _internalHandle: { index: 0 },
    } as unknown as IpodTrack;
    const ipod = makeStubIpod({
      removeTrack: () => {
        throw new Error('libgpod: track handle invalid');
      },
    });
    const adapter = new IpodDeviceAdapter(ipod, MIN_CAPS);

    let thrown: unknown;
    try {
      adapter.removeTrack(stubTrack);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DatabaseWriteError);
    expect((thrown as DatabaseWriteError).category).toBe('database');
  });

  it('save: wraps a raw Error from libgpod', async () => {
    const ipod = makeStubIpod({
      save: async () => {
        throw new Error('libgpod: file write failed');
      },
    });
    const adapter = new IpodDeviceAdapter(ipod, MIN_CAPS);

    let thrown: unknown;
    try {
      await adapter.save();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DatabaseWriteError);
    expect((thrown as DatabaseWriteError).category).toBe('database');
  });

  it('passes an already-typed DatabaseWriteError through unwrapped', () => {
    // If libgpod-node ever starts throwing typed errors directly, the
    // wrap must not re-wrap them — otherwise `causes` would nest and
    // the underlying ref would be discarded.
    const inner = new DatabaseWriteError('explicit cause');
    const ipod = makeStubIpod({
      addTrack: () => {
        throw inner;
      },
    });
    const adapter = new IpodDeviceAdapter(ipod, MIN_CAPS);

    let thrown: unknown;
    try {
      adapter.addTrack({ title: 'X', artist: 'Y', album: 'Z' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(inner);
  });

  it('successful mutators return normally — no wrap overhead path', () => {
    const ipod = makeStubIpod();
    const adapter = new IpodDeviceAdapter(ipod, MIN_CAPS);
    const track = adapter.addTrack({ title: 'X', artist: 'Y', album: 'Z' });
    expect(track).toBeDefined();
    expect(() => adapter.updateTrack(track, { title: 'Renamed' })).not.toThrow();
    expect(() => adapter.removeTrack(track)).not.toThrow();
  });
});
