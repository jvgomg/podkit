/**
 * Pure unit tests for the helper utilities exported alongside `TagWriter`.
 * Kept separate from the `TagLibTagWriter` integration tests because these
 * don't need ffmpeg/audio fixtures.
 */

import { describe, expect, test } from 'bun:test';

import {
  buildTagFieldsFromInput,
  diffTagFields,
  runWithConcurrency,
} from './mass-storage-tag-writer.js';

describe('buildTagFieldsFromInput', () => {
  test('returns an empty object when no fields are supplied', () => {
    expect(buildTagFieldsFromInput({})).toEqual({});
  });

  test('copies every supplied textual field', () => {
    expect(
      buildTagFieldsFromInput({
        title: 'T',
        artist: 'A',
        albumArtist: 'AA',
        album: 'B',
        genre: 'G',
        year: 2030,
        trackNumber: 1,
        discNumber: 2,
        compilation: true,
        comment: 'C',
      })
    ).toEqual({
      title: 'T',
      artist: 'A',
      albumArtist: 'AA',
      album: 'B',
      genre: 'G',
      year: 2030,
      trackNumber: 1,
      discNumber: 2,
      compilation: true,
      comment: 'C',
    });
  });

  test('omits fields that are explicitly undefined', () => {
    expect(buildTagFieldsFromInput({ title: 'T', artist: undefined })).toEqual({
      title: 'T',
    });
  });
});

describe('diffTagFields', () => {
  test('returns empty when nothing actually differs', () => {
    expect(diffTagFields({ title: 'T', artist: 'A' }, { title: 'T', artist: 'A' })).toEqual({});
  });

  test('returns only the changed fields', () => {
    expect(
      diffTagFields(
        { title: 'Old', artist: 'A', album: 'B', year: 2010 },
        { title: 'New', artist: 'A', year: 2010 }
      )
    ).toEqual({ title: 'New' });
  });

  test('undefined incoming fields are not considered changes', () => {
    expect(diffTagFields({ title: 'T' }, { title: undefined, artist: 'A' })).toEqual({
      artist: 'A',
    });
  });

  test('handles boolean compilation toggle off explicitly', () => {
    expect(diffTagFields({ compilation: true }, { compilation: false })).toEqual({
      compilation: false,
    });
  });
});

describe('runWithConcurrency', () => {
  test('returns settled results in original order', async () => {
    const tasks = [
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ];
    const out = await runWithConcurrency(tasks, 2);
    expect(out.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual(['a', 'b', 'c']);
  });

  test('captures rejections without aborting siblings', async () => {
    const tasks = [
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve('also ok'),
    ];
    const out = await runWithConcurrency(tasks, 5);
    expect(out[0]!.status).toBe('fulfilled');
    expect(out[1]!.status).toBe('rejected');
    expect(out[2]!.status).toBe('fulfilled');
    if (out[1]!.status === 'rejected') {
      expect((out[1]!.reason as Error).message).toBe('boom');
    }
  });

  test('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 50 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 1;
    });

    await runWithConcurrency(tasks, 4);

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(0);
  });

  test('handles empty task list', async () => {
    expect(await runWithConcurrency([], 8)).toEqual([]);
  });

  test('clamps worker count to task count', async () => {
    // With limit > tasks, only as many workers as tasks are spawned.
    // Behaviour is observable only via the returned array length here.
    const out = await runWithConcurrency([() => Promise.resolve(1)], 100);
    expect(out).toHaveLength(1);
  });
});
