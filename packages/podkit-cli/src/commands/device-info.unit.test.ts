/**
 * Unit tests for `device info` path-mode helpers.
 *
 * The full-integration coverage (real iPod, full action body) lives in
 * `device.integration.test.ts`. These tests target the small helper that
 * makes the path-mode optimisation possible: synthesising a
 * `PlatformDeviceInfo` from a user-supplied path so the readiness pipeline
 * can run without `manager.scan({ kinds: ['ipod'] })`.
 */

import { describe, it, expect } from 'bun:test';
import { synthesizePathModeDeviceInfo } from './device.js';

describe('synthesizePathModeDeviceInfo', () => {
  it('populates fields read by the readiness pipeline', () => {
    const info = synthesizePathModeDeviceInfo('/Volumes/TERAPOD', 'ABC-123-UUID');
    expect(info.mountPoint).toBe('/Volumes/TERAPOD');
    expect(info.isMounted).toBe(true);
    expect(info.volumeUuid).toBe('ABC-123-UUID');
    expect(info.volumeName).toBe('TERAPOD');
  });

  it('derives volumeName from the path basename', () => {
    expect(synthesizePathModeDeviceInfo('/mnt/iPod Music', 'X').volumeName).toBe('iPod Music');
    expect(synthesizePathModeDeviceInfo('/tmp/test-ipod-AbCdEf', 'X').volumeName).toBe(
      'test-ipod-AbCdEf'
    );
  });

  it('handles a UUID-less path by using an empty string', () => {
    // Empty string (rather than undefined) keeps PlatformDeviceInfo's
    // `volumeUuid: string` shape intact for downstream consumers.
    const info = synthesizePathModeDeviceInfo('/Volumes/iPod', undefined);
    expect(info.volumeUuid).toBe('');
  });

  it('uses a stable, namespaced identifier (path:<mountPoint>)', () => {
    // Identifier is only used for display in readiness stage details, but
    // it must be deterministic so two synthesised infos for the same path
    // compare equal (e.g. for cache keys, log dedup).
    const a = synthesizePathModeDeviceInfo('/Volumes/iPod', 'X');
    const b = synthesizePathModeDeviceInfo('/Volumes/iPod', 'X');
    expect(a.identifier).toBe(b.identifier);
    expect(a.identifier).toContain('/Volumes/iPod');
  });

  it('falls back to the full path when split returns empty (trailing slash)', () => {
    // '/Volumes/iPod/'.split('/').pop() === '' — the `|| mountPoint` fallback
    // kicks in so volumeName is never an empty string.
    const info = synthesizePathModeDeviceInfo('/Volumes/iPod/', 'X');
    expect(info.volumeName).toBe('/Volumes/iPod/');
  });

  it('handles a path without slashes by using the input as-is', () => {
    const info = synthesizePathModeDeviceInfo('weird-input', 'X');
    expect(info.volumeName).toBe('weird-input');
  });
});
