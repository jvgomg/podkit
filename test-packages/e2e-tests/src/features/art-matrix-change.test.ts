/**
 * Artwork change-detection matrix — directory adapter.
 *
 * Where `art-matrix.test.ts` probes state after a single fresh sync, this one
 * probes podkit's ability to detect source artwork changing between syncs:
 * sync cover A, swap the source for cover B (identical tags, different cover
 * bytes), dry-run a second sync, observe which operations fire.
 *
 * `--check-artwork` exists because the cheap path can't detect artwork-only
 * changes: without it the directory adapter never computes
 * `source.artworkHash`, so the cover-swap is silently missed; with it the hash
 * mismatch fires `artwork-updated`. The predictor (`predictChange`) and the
 * mutate-between-syncs sequence (`observeChangePass`) live in
 * `../matrix/artwork-rules.ts`.
 *
 * Subsonic coverage of artwork-change is deferred (TASK-355.05) — it needs
 * Navidrome rescan plumbing in the test source.
 *
 * @module
 */

import { ensureFixturesExist } from '@podkit/e2e-shared';

import { withTarget } from '../targets';
import { FORMATS } from '../matrix/axes';
import { defineArtworkMatrix } from '../matrix/harness';
import { observeChangePass, predictChange, type ChangeObserved } from '../matrix/artwork-rules';

ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-embedded-alt');

async function runPass(checkArtwork: boolean): Promise<Map<string, ChangeObserved>> {
  return withTarget((target) => observeChangePass({ target, checkArtwork }));
}

defineArtworkMatrix({
  title: 'artwork change detection — directory adapter',
  cells: FORMATS,
  cellKey: (format) => format,
  cellLabel: (format) => format,
  predict: predictChange,
  runPass,
});
