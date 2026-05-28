/**
 * Artwork-handling matrix — directory adapter.
 *
 * Walks the (scenario × format × --check-artwork) grid for podkit's directory
 * source adapter. For each cell, after a fresh sync we observe whether the
 * track landed, whether `device.hasArtwork` matches the prediction, and
 * whether a second sync avoids any artwork-churn op.
 *
 * The matrix is a frozen snapshot of current behaviour: the prediction (see
 * `predictDirectory` in `../matrix/artwork-rules.ts`) *is* the assertion. When
 * a code change flips a cell, the test fails and the maintainer accepts the
 * change (update the rule) or reverts the regression. No `expectedBroken`.
 *
 * Shared machinery (axes, reference model, op-classification, the two-pass
 * orchestration, the diff/assert) lives in `../matrix/`; this file only wires
 * the directory source into it. See doc-039 for the strategy.
 *
 * @module
 */

import { ensureFixturesExist, cleanupTempConfig, createTempConfig } from '@podkit/e2e-shared';
import { getStaticFixturesRoot } from '@podkit/test-fixtures';
import { join } from 'node:path';

import { withTarget } from '../targets';
import { scenarioFormatCells } from '../matrix/axes';
import { defineArtworkMatrix } from '../matrix/harness';
import {
  observeStaticArtwork,
  predictDirectory,
  staticCellKey,
  staticCellLabel,
  type StaticArtObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format');
ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-sidecar');
ensureFixturesExist('multi-format-both');

/**
 * The directory adapter scans the static fixtures root recursively. That root
 * contains goldberg, synthetic-tests, and the four multi-format scenarios as
 * siblings. The matrix only asserts on the 32 multi-format cells, so the extra
 * non-matrix tracks come along harmlessly.
 */
function getSourceRoot(): string {
  return join(getStaticFixturesRoot(), 'audio');
}

async function runPass(checkArtwork: boolean): Promise<Map<string, StaticArtObserved>> {
  return withTarget(async (target) => {
    const configPath = await createTempConfig(getSourceRoot());
    try {
      return await observeStaticArtwork({ target, configPath, checkArtwork });
    } finally {
      await cleanupTempConfig(configPath);
    }
  });
}

defineArtworkMatrix({
  title: 'artwork matrix — directory adapter',
  cells: scenarioFormatCells(),
  cellKey: staticCellKey,
  cellLabel: staticCellLabel,
  predict: predictDirectory,
  runPass,
});
