/**
 * Transfer-mode × artwork matrix — directory adapter, iPod.
 *
 * Walks (transfer-mode × format) over the embedded-art fixture on a database-
 * artwork device, asserting the gap between the two artwork signals:
 *
 *   - `dbHasArtwork` — the cover in the iTunesDB. Always present (the source
 *     has art), regardless of transfer mode.
 *   - `fileHasArt` — the cover still embedded in the *file* copied to the
 *     device. Stripped or kept per the transfer mode + action (doc-012):
 *     `portable` keeps it; `optimized` strips it everywhere; `fast` keeps it
 *     on a direct copy (mp3/aac) but strips it on a transcode.
 *
 * The strip is invisible to both the dry-run plan and `TrackInfo.hasArtwork`,
 * so this is the only matrix that reads the device file bytes (via
 * `probeFileArtwork`). iPod-only: the strip-vs-keep choice is specific to a
 * database-artwork device, where the file copy is redundant. The predictor
 * (`predictTransferArtwork`) and per-mode sync (`observeTransferArtwork`) live
 * in `../matrix/artwork-rules.ts`.
 *
 * @module
 */

import { cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatEmbeddedFixturesDir } from '@podkit/test-fixtures';

import { withTarget } from '../targets';
import { defineArtworkMatrix } from '../matrix/harness';
import { TRANSFER_MODES } from '../matrix/reference-model';
import {
  createPipelineConfig,
  observeTransferArtwork,
  predictTransferArtwork,
  transferArtCellKey,
  transferArtCellLabel,
  transferArtCells,
  type TransferArtObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format-embedded');

async function runPass(checkArtwork: boolean): Promise<Map<string, TransferArtObserved>> {
  const merged = new Map<string, TransferArtObserved>();
  // Each transfer mode is a sync-wide setting → its own fresh iPod.
  for (const transferMode of TRANSFER_MODES) {
    const partial = await withTarget(async (target) => {
      const configPath = await createPipelineConfig(
        getMultiFormatEmbeddedFixturesDir(),
        'transcode-aac'
      );
      try {
        return await observeTransferArtwork({ target, configPath, transferMode, checkArtwork });
      } finally {
        await cleanupTempConfig(configPath);
      }
    });
    for (const [key, observed] of partial) merged.set(key, observed);
  }
  return merged;
}

defineArtworkMatrix({
  title: 'artwork matrix — transfer-mode × artwork (file strip), iPod',
  cells: transferArtCells(),
  cellKey: transferArtCellKey,
  cellLabel: transferArtCellLabel,
  // The strip is a fresh-sync, transfer-mode-driven effect — independent of
  // --check-artwork, which only governs change detection. One pass suffices.
  passes: [false],
  passLabel: () => 'transfer-mode × artwork',
  predict: predictTransferArtwork,
  runPass,
  timeoutMs: 1800000,
});
