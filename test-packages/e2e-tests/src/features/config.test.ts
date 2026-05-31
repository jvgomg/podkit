/**
 * Config-inheritance matrix — end-to-end provenance for the decisions block.
 *
 * Walks (setting × source-level) for every key in `SyncDecisions` and asserts
 * the `{value, source}` pair on `json.decisions.<setting>` matches what the
 * resolver-chain + CLI-overlay should emit. The cell is the dimension the
 * unit tests cannot reach — `resolveDeviceSettings.test.ts` knows the
 * resolver in isolation, `sync-decisions.test.ts` knows `buildSyncDecisions`
 * in isolation, but neither proves the full pipeline (config loader →
 * resolver → decisions builder → JSON output).
 *
 * See matrix/config-rules.ts for the cell taxonomy and skip rules.
 *
 * @module
 */

import { ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatFixturesDir } from '@podkit/test-fixtures';

import { defineMatrix } from '../matrix/harness';
import {
  configCellKey,
  configCellLabel,
  configCells,
  observeConfigMatrix,
  predictConfig,
  skipConfigCell,
  type ConfigObserved,
} from '../matrix/config-rules';

ensureFixturesExist('multi-format');

async function runPass(): Promise<Map<string, ConfigObserved>> {
  return observeConfigMatrix(getMultiFormatFixturesDir());
}

defineMatrix({
  title: 'config-inheritance matrix — decisions provenance',
  cells: configCells(),
  cellKey: configCellKey,
  cellLabel: configCellLabel,
  passes: [false],
  passLabel: () => 'config inheritance',
  predict: (cell) => predictConfig(cell),
  skip: skipConfigCell,
  runPass,
  timeoutMs: 600000,
});
