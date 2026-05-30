/**
 * Compilation artwork matrix — directory adapter, iPod.
 *
 * A various-artist album: 8 tracks sharing one album (`Various Artists
 * Compilation`) but each with a distinct artist. The embed-capable anchors
 * (FLAC/ALAC/MP3/AAC/AIFF) carry the cover; WAV/OGG/Opus ship bare.
 *
 * The point is the album artwork cache, which keys on `(artist, album)` (see
 * `@podkit/core` `album-cache.ts` / `pipeline.ts buildAlbumCandidates`). With
 * differing per-track artists, every track lands in its own single-element
 * candidate group, so a bare track inherits *no* cover from a sibling — a
 * *split*, not a collision. Anchors therefore land with art; bare tracks land
 * without. (In a single-artist album the bare tracks would inherit the anchor's
 * cover — that's exactly what `art-matrix.test.ts` scenario B asserts.) This
 * pins the deliberate `(artist, album)` keying from TASK-355.03.
 *
 * iPod-only: the split lives in the cache/pipeline layer and is device-agnostic,
 * and iPod sidesteps the mass-storage OGG/Opus execution bugs (doc-039
 * §"Mass-storage sync gaps"). The predictor (`predictCompilation`) and sync
 * sequence (`observeCompilation`) live in `../matrix/artwork-rules.ts`.
 *
 * @module
 */

import { cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatCompilationFixturesDir } from '@podkit/test-fixtures';

import { withTarget } from '../targets';
import { FORMATS } from '../matrix/axes';
import { defineArtworkMatrix } from '../matrix/harness';
import {
  createPipelineConfig,
  observeCompilation,
  predictCompilation,
  type CompilationObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format-compilation');

async function runPass(checkArtwork: boolean): Promise<Map<string, CompilationObserved>> {
  return withTarget(async (target) => {
    const configPath = await createPipelineConfig(
      getMultiFormatCompilationFixturesDir(),
      'transcode-aac'
    );
    try {
      return await observeCompilation({ target, configPath, checkArtwork });
    } finally {
      await cleanupTempConfig(configPath);
    }
  });
}

defineArtworkMatrix({
  title: 'artwork matrix — compilation (various-artist album), iPod',
  cells: FORMATS,
  cellKey: (format) => format,
  cellLabel: (format) => format,
  predict: predictCompilation,
  runPass,
});
