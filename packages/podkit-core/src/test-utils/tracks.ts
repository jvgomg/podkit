/**
 * Shared track factory helpers for unit tests across podkit-core.
 *
 * Three factories mirror the three track shapes the codebase uses:
 *
 *   - `makeMockIpodTrack`       — a full `IpodTrack` with all required fields.
 *   - `makeMockDeviceTrack`     — a `DeviceTrack` (base interface, no iPod-only
 *                                  timestamp fields). Suitable for tests that
 *                                  drive sync logic without caring about iPod
 *                                  internals.
 *   - `makeMockCollectionTrack` — a minimal `CollectionTrack` for source-side
 *                                  tests.
 *
 * Every factory accepts `overrides?: Partial<T>` so callers only spell out
 * what they care about. When a future interface change adds a required field,
 * update the default here; all callers pick it up for free.
 *
 * Method stubs (update, remove, copyFile) use plain arrow functions, NOT
 * bun:test `mock()`. Tests that need call-counting can wrap with `mock()` in
 * the override, e.g.:
 *
 *   ```ts
 *   import { mock } from 'bun:test';
 *   const t = makeMockIpodTrack({ update: mock(() => ({}) as IpodTrack) });
 *   ```
 *
 * This keeps the factories importable outside of bun:test contexts (e.g. from
 * integration helpers that run without the full test harness).
 *
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { DeviceTrack } from '../device/adapter.js';
import type { IpodTrack } from '../ipod/types.js';

// ---------------------------------------------------------------------------
// IpodTrack
// ---------------------------------------------------------------------------

/**
 * Build a minimal `IpodTrack` stub with all required fields populated.
 *
 * Defaults:
 *   - `artworkSink: 'database'` (iPod always uses the iTunesDB path)
 *   - `hasArtwork: false`
 *   - `hasFile: true`
 *   - `compilation: false`
 *   - `syncTag: null`
 *   - All timestamp/counter fields: `0`
 *   - Operation stubs return `({} as IpodTrack)` / void — override with
 *     `mock()` when you need call-count assertions.
 */
export function makeMockIpodTrack(overrides: Partial<IpodTrack> = {}): IpodTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    comment: undefined,
    syncTag: null,
    duration: 180_000,
    bitrate: 256,
    sampleRate: 44_100,
    size: 5_000_000,
    mediaType: 1,
    filePath: ':iPod_Control:Music:F00:test.m4a',
    timeAdded: 0,
    timeModified: 0,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    artworkSink: 'database',
    update: () => ({}) as IpodTrack,
    remove: () => {},
    copyFile: () => ({}) as IpodTrack,
    ...overrides,
  } as IpodTrack;
}

// ---------------------------------------------------------------------------
// DeviceTrack
// ---------------------------------------------------------------------------

/**
 * Build a minimal `DeviceTrack` stub (base interface, no iPod-only fields).
 *
 * Defaults are iPod-shaped for historical reasons (most callers drove iPod
 * tests before the mass-storage adapters existed). Override `artworkSink` for
 * embedded/sidecar/noop device tests.
 */
export function makeMockDeviceTrack(overrides: Partial<DeviceTrack> = {}): DeviceTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    filePath: ':iPod_Control:Music:F00:test.m4a',
    duration: 180_000,
    bitrate: 256,
    sampleRate: 44_100,
    size: 5_000_000,
    mediaType: 1,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    syncTag: null,
    artworkSink: 'database',
    update: () => ({}) as DeviceTrack,
    remove: () => {},
    copyFile: () => ({}) as DeviceTrack,
    ...overrides,
  } as DeviceTrack;
}

// ---------------------------------------------------------------------------
// CollectionTrack
// ---------------------------------------------------------------------------

/**
 * Build a minimal `CollectionTrack` stub.
 *
 * Defaults to a lossless FLAC file so most classifier / planner tests get a
 * "transcode-needed" scenario without extra overrides.
 */
export function makeMockCollectionTrack(overrides: Partial<CollectionTrack> = {}): CollectionTrack {
  return {
    id: 'test-artist-test-track-test-album',
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    fileType: 'flac',
    filePath: '/music/test.flac',
    lossless: true,
    duration: 180_000,
    ...overrides,
  } as CollectionTrack;
}
