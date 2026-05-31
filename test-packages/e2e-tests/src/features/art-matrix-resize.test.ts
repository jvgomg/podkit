/**
 * Artwork resize matrix — directory adapter, device axis.
 *
 * Syncs the high-resolution (1024px cover) embedded fixture and asserts the
 * cover dimensions in the file written to the device, against each device's
 * `artworkMaxResolution`:
 *
 *   - `ms-generic` (embedded artwork, max 500) → file cover downscaled to 500
 *     in **every** transfer mode (mode doesn't change an embedded device's resize).
 *   - iPod (database artwork, max 320) → file cover left at the source 1024
 *     where it survives (portable / a fast direct copy) and stripped otherwise;
 *     the iTunesDB thumbnail is resized within 320 in **every** mode.
 *
 * Resize is invisible to the dry-run plan and to `TrackInfo.hasArtwork` (a bare
 * boolean), so this reads the device file bytes via `probeFileArtwork` and the
 * iTunesDB thumbnail via `probeIpodDbArtwork`. Swept across all three transfer
 * modes — the artwork size must match the device configuration for each.
 * Restricted to the attached_pic image-stream formats (FLAC/ALAC/MP3/AAC/AIFF)
 * whose cover dimensions are cleanly ffprobe-readable. The predictor
 * (`predictResize`) and per-mode sync (`observeResize`) live in
 * `../matrix/artwork-rules.ts`.
 *
 * @module
 */

import { cleanupTempConfig, ensureFixturesExist } from '@podkit/e2e-shared';
import { getMultiFormatEmbeddedHiresFixturesDir } from '@podkit/test-fixtures';

import { DEVICE_SPEC_BY_ID, deviceAddressing } from '../matrix/devices';
import { defineMatrix } from '../matrix/harness';
import { TRANSFER_MODES } from '../matrix/reference-model';
import {
  RESIZE_DEVICE_IDS,
  RESIZE_PIPELINE,
  createPipelineConfig,
  observeResize,
  predictResize,
  resizeCellKey,
  resizeCellLabel,
  resizeCells,
  type ResizeObserved,
} from '../matrix/artwork-rules';

ensureFixturesExist('multi-format-embedded-hires');

async function runPass(): Promise<Map<string, ResizeObserved>> {
  const merged = new Map<string, ResizeObserved>();
  for (const deviceId of RESIZE_DEVICE_IDS) {
    const spec = DEVICE_SPEC_BY_ID[deviceId];
    // Each transfer mode is a sync-wide setting → its own fresh target.
    for (const transferMode of TRANSFER_MODES) {
      const target = await spec.create();
      const { deviceArg, configFragment } = deviceAddressing(target);
      const device = configFragment ? { fragment: configFragment, name: deviceArg } : undefined;
      const configPath = await createPipelineConfig(
        getMultiFormatEmbeddedHiresFixturesDir(),
        RESIZE_PIPELINE,
        device
      );
      try {
        const partial = await observeResize({ target, configPath, transferMode });
        for (const [format, observed] of partial) {
          merged.set(`${deviceId}/${transferMode}/${format}`, observed);
        }
      } finally {
        await cleanupTempConfig(configPath);
        await target.cleanup();
      }
    }
  }
  return merged;
}

defineMatrix({
  title: 'artwork matrix — resize vs artworkMaxResolution',
  cells: resizeCells(),
  cellKey: resizeCellKey,
  cellLabel: resizeCellLabel,
  passes: [false],
  passLabel: () => 'resize',
  predict: predictResize,
  runPass,
  timeoutMs: 1800000,
});
