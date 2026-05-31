/**
 * Codec-preference matrix — directory adapter, device axis.
 *
 * Walks (device × format × codec-config × transfer-mode) for the no-artwork
 * multi-format fixture and asserts, per cell, the `add-*` op type podkit picks
 * (copy sub-type vs transcode), the sync-wide resolved lossy codec, and that a
 * second dry-run is idempotent. The prediction (`predictCodec`) keys off each
 * device's capability snapshot — it is the first matrix to vary the device
 * axis across iPod + mass-storage presets (doc-039 P4). It subsumes the old
 * imperative `codec-preference.test.ts` (opus-first → opus on a codec-rich
 * device, → aac fallback elsewhere) and the echo-mini opus-fallback case from
 * `mass-storage-sync.test.ts`.
 *
 * @module
 */

import { ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatFixturesDir } from '@podkit/test-fixtures';

import { defineMatrix } from '../matrix/harness';
import {
  codecCellKey,
  codecCellLabel,
  codecCells,
  observeCodecMatrix,
  predictCodec,
  skipCodecCell,
  type CodecObserved,
} from '../matrix/codec-rules';

ensureFixturesExist('multi-format');

async function runPass(): Promise<Map<string, CodecObserved>> {
  return observeCodecMatrix(getMultiFormatFixturesDir());
}

defineMatrix({
  title: 'codec matrix — directory adapter, device axis',
  cells: codecCells(),
  cellKey: codecCellKey,
  cellLabel: codecCellLabel,
  passes: [false],
  passLabel: () => 'codec preference',
  predict: (cell) => predictCodec(cell),
  skip: skipCodecCell,
  runPass,
  timeoutMs: 1800000,
});
