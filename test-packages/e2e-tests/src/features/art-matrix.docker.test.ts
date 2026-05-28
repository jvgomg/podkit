/**
 * Artwork-handling matrix — Subsonic / Navidrome adapter.
 *
 * Companion to `art-matrix.test.ts`: same axes (scenario × format ×
 * --check-artwork) and the same prediction-vs-observation contract, but the
 * source is a Navidrome container instead of the local filesystem.
 *
 * The shared harness, reference model, and observation sequence live in
 * `../matrix/`; the only differences from the host matrix are the source
 * (a Navidrome container + Subsonic config/env) and the predictor
 * (`predictSubsonic`, which models Navidrome's optimistic `coverArt` reporting
 * and the `--check-artwork` placeholder filter). See doc-039 for the strategy.
 *
 * @module
 */

import { cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';

import { SubsonicTestSource, isDockerAvailable } from '../sources/subsonic';
import { createSubsonicConfig } from '../helpers/subsonic-config';
import { withTarget } from '../targets';
import { scenarioFormatCells } from '../matrix/axes';
import { defineArtworkMatrix } from '../matrix/harness';
import {
  observeStaticArtwork,
  predictSubsonic,
  staticCellKey,
  staticCellLabel,
  type StaticArtObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format');
ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-sidecar');
ensureFixturesExist('multi-format-both');

let source: SubsonicTestSource | null = null;

async function runPass(checkArtwork: boolean): Promise<Map<string, StaticArtObserved>> {
  return withTarget(async (target) => {
    const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);
    try {
      return await observeStaticArtwork({
        target,
        configPath,
        checkArtwork,
        env: source!.getEnv(),
        initTimeoutMs: 300000,
        dryTimeoutMs: 180000,
      });
    } finally {
      await cleanupTempConfig(configPath);
    }
  });
}

defineArtworkMatrix({
  title: 'artwork matrix — subsonic adapter',
  cells: scenarioFormatCells(),
  cellKey: staticCellKey,
  cellLabel: staticCellLabel,
  predict: predictSubsonic,
  runPass,
  timeoutMs: 1500000,
  setup: async () => {
    if (!(await isDockerAvailable())) {
      throw new Error('Docker is not available — required for the art-matrix subsonic suite.');
    }
    source = new SubsonicTestSource();
    console.log('Starting Navidrome container for art matrix...');
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
