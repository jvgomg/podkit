/**
 * Transfer-mode × artwork matrix — directory adapter, device axis.
 *
 * Walks (device × transfer-mode × format) over the embedded-art fixture and
 * asserts the three artwork signals on each cell:
 *
 *   - `dbHasArtwork` — iTunesDB cover (iPod only, `null` elsewhere).
 *   - `fileHasArt` — the cover still embedded in the *file* copied to the
 *     device. Stripped or kept per the transfer mode + action (doc-012):
 *     `portable` keeps it; `optimized` strips it everywhere; `fast` keeps it
 *     on a direct copy (mp3/aac) but strips it on a transcode.
 *   - `sidecarPresent` / `sidecarSize` — peer `cover.jpg` for sidecar-primary
 *     devices (rockbox). Lands at `artworkMaxResolution` in every mode.
 *
 * Database (iPod) and sidecar-primary (rockbox) cells are exercised together;
 * embedded-primary devices live in the resize matrix instead. Predictor
 * (`predictTransferArtwork`) and per-cell sync (`observeTransferArtwork`)
 * live in `../matrix/artwork-rules.ts`.
 *
 * @module
 */

import { cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatEmbeddedFixturesDir } from '@podkit/test-fixtures';

import { DEVICE_SPEC_BY_ID, deviceAddressing } from '../matrix/devices';
import { defineMatrix } from '../matrix/harness';
import { TRANSFER_MODES } from '../matrix/reference-model';
import {
  TRANSFER_ART_DEVICE_IDS,
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
  for (const deviceId of TRANSFER_ART_DEVICE_IDS) {
    const spec = DEVICE_SPEC_BY_ID[deviceId];
    // Each transfer mode is a sync-wide setting → its own fresh target.
    for (const transferMode of TRANSFER_MODES) {
      const target = await spec.create();
      const { configFragment, deviceArg } = deviceAddressing(target);
      const device = configFragment ? { fragment: configFragment, name: deviceArg } : undefined;
      const configPath = await createPipelineConfig(
        getMultiFormatEmbeddedFixturesDir(),
        'transcode-aac',
        device
      );
      try {
        const partial = await observeTransferArtwork({
          target,
          configPath,
          device: deviceId,
          transferMode,
          checkArtwork,
        });
        for (const [key, observed] of partial) merged.set(key, observed);
      } finally {
        await cleanupTempConfig(configPath);
        await target.cleanup();
      }
    }
  }
  return merged;
}

defineMatrix({
  title: 'artwork matrix — transfer-mode × artwork (file strip + sidecar write), device axis',
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
