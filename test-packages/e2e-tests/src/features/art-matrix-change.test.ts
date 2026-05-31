/**
 * Artwork change-detection matrix — directory adapter.
 *
 * Where `art-matrix.test.ts` probes state after a single fresh sync, this one
 * probes podkit's ability to detect source artwork *changing* between syncs.
 * Two mutations are swept (the `transition` axis):
 *
 *   - `updated`: sync cover A, swap the source for cover B (identical tags,
 *     different cover bytes), dry-run a second sync.
 *   - `removed`: sync the embedded variant, swap in the stripped variant
 *     (identical tags, no embedded art), dry-run a second sync.
 *
 * `--check-artwork` exists because the cheap path can't detect artwork-only
 * changes: podkit's self-healing is metadata-based (ADR-009) and only ever
 * *adds* art, so neither a swap nor a removal is seen without it. With it, the
 * `source.artworkHash` vs `syncTag.artworkHash` comparison fires
 * `artwork-updated` / `artwork-removed`. The predictor (`predictChange`) and
 * the mutate-between-syncs sequence (`observeChangePass`) live in
 * `../matrix/artwork-rules.ts`.
 *
 * Subsonic coverage of artwork-change is deferred (TASK-355.05) — it needs
 * Navidrome rescan plumbing in the test source.
 *
 * @module
 */

import { ensureFixturesExist } from '@podkit/e2e-shared';

import { withTarget } from '../targets';
import { defineMatrix } from '../matrix/harness';
import {
  CHANGE_TRANSITIONS,
  changeCellKey,
  changeCellLabel,
  changeCells,
  observeChangePass,
  predictChange,
  type ChangeObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-embedded-alt');
ensureFixturesExist('multi-format-embedded-stripped');

async function runPass(checkArtwork: boolean): Promise<Map<string, ChangeObserved>> {
  const merged = new Map<string, ChangeObserved>();
  for (const transition of CHANGE_TRANSITIONS) {
    // Each transition mutates its own source root and syncs onto its OWN fresh
    // target — sharing one would let the second transition diff against the
    // first transition's tracks and pollute the observation.
    const partial = await withTarget((target) =>
      observeChangePass({ target, checkArtwork, transition })
    );
    for (const [format, observed] of partial) {
      merged.set(`${transition}/${format}`, observed);
    }
  }
  return merged;
}

defineMatrix({
  title: 'artwork change detection — directory adapter',
  cells: changeCells(),
  cellKey: changeCellKey,
  cellLabel: changeCellLabel,
  passes: [false, true],
  passLabel: (pass) => `--check-artwork ${pass ? 'on' : 'off'}`,
  predict: predictChange,
  runPass,
});
