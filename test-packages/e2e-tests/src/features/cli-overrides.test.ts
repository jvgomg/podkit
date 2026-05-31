/**
 * CLI-override matrix — end-to-end precedence for the decisions block.
 *
 * Proves the wiring from `commander` option parsing → `deriveSettings()` →
 * `buildSyncDecisions()` → JSON output. The unit tests in
 * `sync-decisions.test.ts` cover the pure-function precedence; this matrix
 * catches commander option renames, missing thread-throughs, and other
 * full-pipeline regressions a unit test cannot reach.
 *
 * See matrix/cli-rules.ts for the combo taxonomy.
 *
 * @module
 */

import { ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatFixturesDir } from '@podkit/test-fixtures';

import { defineMatrix } from '../matrix/harness';
import {
  cliCellKey,
  cliCellLabel,
  cliCells,
  observeCliMatrix,
  predictCli,
  type CliObserved,
} from '../matrix/cli-rules';

ensureFixturesExist('multi-format');

async function runPass(): Promise<Map<string, CliObserved>> {
  return observeCliMatrix(getMultiFormatFixturesDir());
}

defineMatrix({
  title: 'cli-override matrix — decisions precedence',
  cells: cliCells(),
  cellKey: cliCellKey,
  cellLabel: cliCellLabel,
  passes: [false],
  passLabel: () => 'cli overrides',
  predict: (cell) => predictCli(cell),
  runPass,
  timeoutMs: 300000,
});
