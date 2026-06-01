import { describe, test, expect } from 'bun:test';
import {
  buildSyncDecisions,
  codecsForOp,
  type ResolvedConfigForDecisions,
} from './sync-decisions.js';

function makeResolved(
  overrides: Partial<ResolvedConfigForDecisions> = {}
): ResolvedConfigForDecisions {
  return {
    transferMode: { value: 'fast', source: 'default' },
    audio: { value: 'high', source: 'default' },
    checkArtwork: { value: false, source: 'default' },
    ...overrides,
  };
}

describe('buildSyncDecisions — provenance attribution', () => {
  test('CLI flag wins over resolved config', () => {
    const d = buildSyncDecisions({
      resolved: makeResolved({
        transferMode: { value: 'optimized', source: 'device' },
      }),
      overrides: { transferMode: 'fast' },
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: null,
      lossyPreference: ['aac', 'mp3'],
      losslessPreference: ['source'],
      codecPreferenceSource: 'default',
    });
    expect(d.transferMode).toEqual({ value: 'fast', source: 'cli' });
  });

  test('absent CLI flag carries through resolved source attribution', () => {
    const d = buildSyncDecisions({
      resolved: makeResolved({
        transferMode: { value: 'optimized', source: 'device' },
      }),
      overrides: {},
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: null,
      lossyPreference: ['aac', 'mp3'],
      losslessPreference: ['source'],
      codecPreferenceSource: 'default',
    });
    expect(d.transferMode).toEqual({ value: 'optimized', source: 'device' });
  });

  test('audioQuality CLI flag takes priority over generic quality flag', () => {
    const d = buildSyncDecisions({
      resolved: makeResolved(),
      overrides: { audioQuality: 'max', quality: 'low' },
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: null,
      lossyPreference: ['aac'],
      losslessPreference: ['source'],
      codecPreferenceSource: 'default',
    });
    expect(d.quality).toEqual({ value: 'max', source: 'cli' });
  });

  test('checkArtwork explicit false from CLI is distinguishable from absent', () => {
    // Both `undefined` and `false` are falsy — buildSyncDecisions must use
    // `!== undefined`, otherwise a user explicitly typing `--no-check-artwork`
    // would be mis-attributed as a config/default value.
    const withFlag = buildSyncDecisions({
      resolved: makeResolved({ checkArtwork: { value: true, source: 'global' } }),
      overrides: { checkArtwork: false },
      resolvedLossyCodec: undefined,
      resolvedLosslessCodec: null,
      lossyPreference: [],
      losslessPreference: [],
      codecPreferenceSource: 'default',
    });
    expect(withFlag.checkArtwork).toEqual({ value: false, source: 'cli' });

    const withoutFlag = buildSyncDecisions({
      resolved: makeResolved({ checkArtwork: { value: true, source: 'global' } }),
      overrides: {},
      resolvedLossyCodec: undefined,
      resolvedLosslessCodec: null,
      lossyPreference: [],
      losslessPreference: [],
      codecPreferenceSource: 'default',
    });
    expect(withoutFlag.checkArtwork).toEqual({ value: true, source: 'global' });
  });

  test('codec preference source carries through unchanged', () => {
    // The builder forwards codecPreferenceSource onto all four codec keys
    // (lossyCodec, losslessCodec, lossyPreference, losslessPreference). The
    // resolver computes the source upstream; the builder is a pass-through.
    const fromGlobal = buildSyncDecisions({
      resolved: makeResolved(),
      overrides: {},
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: 'flac',
      lossyPreference: ['aac'],
      losslessPreference: ['flac'],
      codecPreferenceSource: 'global',
    });
    expect(fromGlobal.lossyCodec.source).toBe('global');
    expect(fromGlobal.losslessCodec.source).toBe('global');
    expect(fromGlobal.lossyPreference.source).toBe('global');
    expect(fromGlobal.losslessPreference.source).toBe('global');

    const fromDefault = buildSyncDecisions({
      resolved: makeResolved(),
      overrides: {},
      resolvedLossyCodec: 'opus',
      resolvedLosslessCodec: null,
      lossyPreference: ['opus', 'aac', 'mp3'],
      losslessPreference: ['source'],
      codecPreferenceSource: 'default',
    });
    expect(fromDefault.lossyCodec.source).toBe('default');
  });

  test('device-level codec preference attributes all four codec keys to source=device', () => {
    // Regression for the device-level codec mis-attribution bug: when a user
    // pins `[devices.<n>.codec]`, the decisions block must report
    // `source: 'device'` on all four codec keys, not `'global'`. The matrix
    // (e2e config-rules) covers the end-to-end flow; this unit pin keeps the
    // builder contract from drifting.
    const fromDevice = buildSyncDecisions({
      resolved: makeResolved(),
      overrides: {},
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: 'flac',
      lossyPreference: ['aac'],
      losslessPreference: ['flac'],
      codecPreferenceSource: 'device',
    });
    expect(fromDevice.lossyCodec.source).toBe('device');
    expect(fromDevice.losslessCodec.source).toBe('device');
    expect(fromDevice.lossyPreference.source).toBe('device');
    expect(fromDevice.losslessPreference.source).toBe('device');
  });

  test('losslessCodec defaults to null when undefined input', () => {
    const d = buildSyncDecisions({
      resolved: makeResolved(),
      overrides: {},
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: undefined,
      lossyPreference: ['aac'],
      losslessPreference: ['source'],
      codecPreferenceSource: 'default',
    });
    expect(d.losslessCodec.value).toBe(null);
  });

  test('losslessCodec preserves null when caller normalised "source" away', () => {
    // The caller (sync.ts) normalises the 'source' sentinel to null before
    // passing in. Verify the builder doesn't second-guess that and accidentally
    // re-string the value.
    const d = buildSyncDecisions({
      resolved: makeResolved(),
      overrides: {},
      resolvedLossyCodec: 'aac',
      resolvedLosslessCodec: null,
      lossyPreference: ['aac'],
      losslessPreference: ['source', 'flac', 'alac'],
      codecPreferenceSource: 'default',
    });
    expect(d.losslessCodec.value).toBe(null);
    // The preference array keeps 'source' so consumers can assert ordering.
    expect(d.losslessPreference.value).toEqual(['source', 'flac', 'alac']);
  });
});

describe('codecsForOp — per-op codec derivation', () => {
  test('add-transcode: input = source codec, output = resolved lossy', () => {
    expect(codecsForOp({ type: 'add-transcode', source: { fileType: 'flac' } }, 'aac')).toEqual({
      inputCodec: 'flac',
      outputCodec: 'aac',
    });
  });

  test('add-direct-copy: input === output (no codec change)', () => {
    expect(codecsForOp({ type: 'add-direct-copy', source: { fileType: 'mp3' } }, 'aac')).toEqual({
      inputCodec: 'mp3',
      outputCodec: 'mp3',
    });
  });

  test('add-optimized-copy: input === output (artwork stripped, codec unchanged)', () => {
    expect(codecsForOp({ type: 'add-optimized-copy', source: { fileType: 'aac' } }, 'aac')).toEqual(
      { inputCodec: 'aac', outputCodec: 'aac' }
    );
  });

  test('upgrade-artwork: no codec fields (parallel to update-metadata)', () => {
    // The artwork-only path doesn't transcode and doesn't change the codec;
    // emitting half a codec decision (inputCodec without outputCodec) would
    // suggest the op touches audio. Omit both.
    expect(codecsForOp({ type: 'upgrade-artwork', source: { fileType: 'flac' } }, 'aac')).toEqual({
      inputCodec: undefined,
      outputCodec: undefined,
    });
  });

  test('remove: no codecs (no source, no output file)', () => {
    expect(codecsForOp({ type: 'remove' }, 'aac')).toEqual({
      inputCodec: undefined,
      outputCodec: undefined,
    });
  });

  test('update-metadata / update-sync-tag / relocate: no codecs', () => {
    for (const type of ['update-metadata', 'update-sync-tag', 'relocate']) {
      expect(codecsForOp({ type }, 'aac')).toEqual({
        inputCodec: undefined,
        outputCodec: undefined,
      });
    }
  });

  test('upgrade-transcode: input = source codec, output = resolved lossy', () => {
    expect(codecsForOp({ type: 'upgrade-transcode', source: { fileType: 'wav' } }, 'opus')).toEqual(
      { inputCodec: 'wav', outputCodec: 'opus' }
    );
  });

  test('resolvedLossyCodec undefined leaves transcode outputCodec undefined', () => {
    expect(codecsForOp({ type: 'add-transcode', source: { fileType: 'flac' } }, undefined)).toEqual(
      { inputCodec: 'flac', outputCodec: undefined }
    );
  });
});
