/**
 * Tests for iPod generation metadata and utilities
 */

import { describe, expect, it } from 'bun:test';
import {
  IPOD_GENERATIONS,
  supportsAlac,
  supportsVideo,
} from './generation.js';

describe('supportsAlac', () => {
  it('returns true for iPod Video 5G', () => {
    expect(supportsAlac('video_1')).toBe(true);
  });

  it('returns true for iPod Video 5.5G', () => {
    expect(supportsAlac('video_2')).toBe(true);
  });

  it('returns true for all Classic generations', () => {
    expect(supportsAlac('classic_1')).toBe(true);
    expect(supportsAlac('classic_2')).toBe(true);
    expect(supportsAlac('classic_3')).toBe(true);
  });

  it('returns true for Nano 3G-5G', () => {
    expect(supportsAlac('nano_3')).toBe(true);
    expect(supportsAlac('nano_4')).toBe(true);
    expect(supportsAlac('nano_5')).toBe(true);
  });

  it('returns false for Nano 1G-2G', () => {
    expect(supportsAlac('nano_1')).toBe(false);
    expect(supportsAlac('nano_2')).toBe(false);
  });

  it('returns false for Nano 6G', () => {
    expect(supportsAlac('nano_6')).toBe(false);
  });

  it('returns false for Shuffle', () => {
    expect(supportsAlac('shuffle_1')).toBe(false);
    expect(supportsAlac('shuffle_2')).toBe(false);
    expect(supportsAlac('shuffle_3')).toBe(false);
    expect(supportsAlac('shuffle_4')).toBe(false);
  });

  it('returns false for Mini', () => {
    expect(supportsAlac('mini_1')).toBe(false);
    expect(supportsAlac('mini_2')).toBe(false);
  });

  it('returns false for Touch', () => {
    expect(supportsAlac('touch_1')).toBe(false);
    expect(supportsAlac('touch_2')).toBe(false);
    expect(supportsAlac('touch_3')).toBe(false);
    expect(supportsAlac('touch_4')).toBe(false);
  });

  it('returns false for unknown generation', () => {
    expect(supportsAlac('unknown')).toBe(false);
  });

  it('returns false for unrecognized generation string', () => {
    expect(supportsAlac('nonexistent_gen')).toBe(false);
  });

  it('returns false for early iPods', () => {
    expect(supportsAlac('first')).toBe(false);
    expect(supportsAlac('second')).toBe(false);
    expect(supportsAlac('third')).toBe(false);
    expect(supportsAlac('fourth')).toBe(false);
    expect(supportsAlac('photo')).toBe(false);
  });
});

describe('IPOD_GENERATIONS metadata', () => {
  it('all ALAC-capable generations also support video', () => {
    // All ALAC-capable models happen to be video-capable too
    for (const [id, metadata] of Object.entries(IPOD_GENERATIONS)) {
      if (metadata.supportsAlac) {
        expect(supportsVideo(id)).toBe(true);
      }
    }
  });

  it('supportsAlac field is consistent with supportsAlac function', () => {
    for (const [id, metadata] of Object.entries(IPOD_GENERATIONS)) {
      expect(supportsAlac(id)).toBe(metadata.supportsAlac ?? false);
    }
  });
});
