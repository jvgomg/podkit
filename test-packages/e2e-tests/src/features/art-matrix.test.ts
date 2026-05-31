/**
 * Artwork-handling matrix — directory adapter.
 *
 * Walks the (scenario × format × pipeline × --check-artwork) grid for podkit's
 * directory source adapter. The `pipeline` axis pins a codec config so the
 * copy path and the transcode path are exercised deliberately rather than as
 * an accident of each format's default (doc-039 P2):
 *
 *   - `prefer-copy`   (quality=max, lossless ['source']): device-native
 *     formats (ALAC/WAV/AIFF/MP3/AAC) copy; FLAC/OGG/Opus transcode.
 *   - `transcode-aac` (quality=high, lossy ['aac']): lossless + incompatible
 *     formats transcode to AAC; MP3/AAC copy.
 *
 * For each cell, after a fresh sync we observe whether the track landed,
 * whether `device.hasArtwork` matches the prediction, and whether a second
 * sync avoids artwork churn. The prediction (`predictDirectory`) *is* the
 * assertion. Shared machinery lives in `../matrix/`.
 *
 * @module
 */

import { ensureFixturesExist, cleanupTempConfig } from '@podkit/e2e-shared';
import { getStaticFixturesRoot } from '@podkit/test-fixtures';
import { join } from 'node:path';

import { DEVICE_SPEC_BY_ID, deviceAddressing } from '../matrix/devices';
import { PIPELINES } from '../matrix/reference-model';
import { defineMatrix } from '../matrix/harness';
import {
  ARTWORK_DEVICE_IDS,
  createPipelineConfig,
  observeStaticArtwork,
  pipelineDeviceCellKey,
  pipelineDeviceCellLabel,
  pipelineDeviceCells,
  predictDirectory,
  skipArtworkCell,
  staticCellKey,
  type StaticArtObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format');
ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-sidecar');
ensureFixturesExist('multi-format-both');

/**
 * The directory adapter scans the static fixtures root recursively. That root
 * contains goldberg, synthetic-tests, and the four multi-format scenarios as
 * siblings. The matrix only asserts on the multi-format cells, so the extra
 * non-matrix tracks come along harmlessly.
 */
function getSourceRoot(): string {
  return join(getStaticFixturesRoot(), 'audio');
}

/** Skip whole syncs that have no asserted cell (e.g. mass-storage prefer-copy). */
function syncIsLive(device: (typeof ARTWORK_DEVICE_IDS)[number], pipeline: string): boolean {
  return pipelineDeviceCells().some(
    (c) => c.device === device && c.pipeline === pipeline && skipArtworkCell(c) === null
  );
}

async function runPass(checkArtwork: boolean): Promise<Map<string, StaticArtObserved>> {
  const merged = new Map<string, StaticArtObserved>();
  // Each (device × pipeline) syncs onto its OWN fresh target — sharing one
  // would let a later sync diff against an earlier sync's tracks and fire
  // preset/codec changes, polluting the idempotency observation.
  for (const deviceId of ARTWORK_DEVICE_IDS) {
    const spec = DEVICE_SPEC_BY_ID[deviceId];
    for (const pipeline of PIPELINES) {
      if (!syncIsLive(deviceId, pipeline)) continue;
      const target = await spec.create();
      const { deviceArg, configFragment } = deviceAddressing(target);
      const device = configFragment ? { fragment: configFragment, name: deviceArg } : undefined;
      const configPath = await createPipelineConfig(getSourceRoot(), pipeline, device);
      try {
        const partial = await observeStaticArtwork({ target, configPath, checkArtwork });
        for (const cell of pipelineDeviceCells()) {
          if (cell.device !== deviceId || cell.pipeline !== pipeline) continue;
          const observed = partial.get(staticCellKey(cell));
          if (observed) merged.set(pipelineDeviceCellKey(cell), observed);
        }
      } finally {
        await cleanupTempConfig(configPath);
        await target.cleanup();
      }
    }
  }
  return merged;
}

defineMatrix({
  title: 'artwork matrix — directory adapter, device axis',
  cells: pipelineDeviceCells(),
  cellKey: pipelineDeviceCellKey,
  cellLabel: pipelineDeviceCellLabel,
  passes: [false, true],
  passLabel: (pass) => `--check-artwork ${pass ? 'on' : 'off'}`,
  predict: predictDirectory,
  skip: skipArtworkCell,
  runPass,
  timeoutMs: 1800000,
});
