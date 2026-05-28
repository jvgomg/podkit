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

import { withTarget } from '../targets';
import { PIPELINES } from '../matrix/reference-model';
import { defineArtworkMatrix } from '../matrix/harness';
import {
  createPipelineConfig,
  observeStaticArtwork,
  pipelineCellKey,
  pipelineCellLabel,
  pipelineCells,
  predictDirectory,
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

async function runPass(checkArtwork: boolean): Promise<Map<string, StaticArtObserved>> {
  const merged = new Map<string, StaticArtObserved>();
  // Each pipeline syncs onto its OWN fresh iPod — sharing one device would let
  // the second pipeline's sync diff against the first's tracks and fire preset
  // changes, polluting the idempotency observation.
  for (const pipeline of PIPELINES) {
    const partial = await withTarget((target) => {
      return (async () => {
        const configPath = await createPipelineConfig(getSourceRoot(), pipeline);
        try {
          return await observeStaticArtwork({ target, configPath, checkArtwork });
        } finally {
          await cleanupTempConfig(configPath);
        }
      })();
    });
    for (const cell of pipelineCells()) {
      if (cell.pipeline !== pipeline) continue;
      const observed = partial.get(staticCellKey(cell));
      if (observed) merged.set(pipelineCellKey(cell), observed);
    }
  }
  return merged;
}

defineArtworkMatrix({
  title: 'artwork matrix — directory adapter',
  cells: pipelineCells(),
  cellKey: pipelineCellKey,
  cellLabel: pipelineCellLabel,
  predict: predictDirectory,
  runPass,
  timeoutMs: 1500000,
});
