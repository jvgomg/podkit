/**
 * Artwork change-detection matrix — Subsonic / Navidrome adapter.
 *
 * Companion to `art-matrix-change.test.ts`: same axes (transition × format ×
 * --check-artwork) and the same prediction-vs-observation contract, but with
 * Navidrome between podkit and the source.
 *
 * Library mutations between syncs go through {@link SubsonicTestSource.mutateLibrary},
 * which restarts the container with a fresh database — Navidrome's artwork
 * cache is keyed on the path-derived coverArt ID, so the cheaper startScan
 * endpoint can serve stale art for the same file path even after the bytes
 * change on disk.
 *
 * The shared harness, reference model, and predictors live in `../matrix/`;
 * the only differences from the host change test are the source (Subsonic
 * container with mutateLibrary plumbing) and the predictor
 * (`predictSubsonicChange`, which models the cheap-path `hasArtwork=undefined`
 * short-circuit).
 *
 * @module
 */

import { ensureFixturesExist } from '@podkit/e2e-shared';

import { SubsonicTestSource, isDockerAvailable } from '../sources/subsonic';
import { createSubsonicConfig } from '../helpers/subsonic-config';
import { withTarget } from '../targets';
import { defineMatrix } from '../matrix/harness';
import {
  CHANGE_TRANSITIONS,
  changeCellKey,
  changeCellLabel,
  changeCells,
  observeChangePassSubsonic,
  predictSubsonicChange,
  type ChangeObserved,
  type MutableLibrarySource,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-embedded-alt');
ensureFixturesExist('multi-format-embedded-stripped');

let source: SubsonicTestSource | null = null;

async function buildConfig(src: MutableLibrarySource): Promise<string> {
  return createSubsonicConfig(src.serverUrl, src.username);
}

async function runPass(checkArtwork: boolean): Promise<Map<string, ChangeObserved>> {
  const merged = new Map<string, ChangeObserved>();
  for (const transition of CHANGE_TRANSITIONS) {
    // Each transition uses its OWN fresh iPod target so the second transition
    // doesn't diff against the first transition's tracks.
    const partial = await withTarget((target) =>
      observeChangePassSubsonic({
        target,
        source: source!,
        buildConfig,
        checkArtwork,
        transition,
      })
    );
    for (const [format, observed] of partial) {
      merged.set(`${transition}/${format}`, observed);
    }
  }
  return merged;
}

defineMatrix({
  title: 'artwork change detection — subsonic adapter',
  cells: changeCells(),
  cellKey: changeCellKey,
  cellLabel: changeCellLabel,
  passes: [false, true],
  passLabel: (pass) => `--check-artwork ${pass ? 'on' : 'off'}`,
  predict: predictSubsonicChange,
  runPass,
  // Two transitions × four syncs/transition × Navidrome restart overhead.
  // Doubled vs the static docker matrix to absorb container-restart variance
  // on busy CI hosts.
  timeoutMs: 3000000,
  setup: async () => {
    if (!(await isDockerAvailable())) {
      throw new Error(
        'Docker is not available — required for the art-matrix-change subsonic suite.'
      );
    }
    // populate: false — the change test places its own minimal fixture set
    // (one album) via mutateLibrary; auto-copying the full audio tree would
    // pad the library for no benefit and lengthen scans.
    source = new SubsonicTestSource({ writable: true, populate: false });
    console.log('Starting Navidrome container for art-change matrix...');
    await source.setup();
    console.log(`Navidrome ready at ${source.serverUrl}`);
  },
  teardown: async () => {
    if (source) {
      console.log('Stopping Navidrome container...');
      await source.teardown();
      source = null;
    }
  },
});
