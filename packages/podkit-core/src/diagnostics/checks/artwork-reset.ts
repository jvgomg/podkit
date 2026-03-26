/**
 * Artwork reset diagnostic check
 *
 * Provides a repair-only check that clears all artwork from an iPod without
 * requiring a source collection. After a reset, the next `podkit sync` will
 * naturally re-add artwork since the cleared sync tags signal that artwork
 * needs to be set.
 *
 * Unlike `artwork-rebuild`, this check does not detect corruption — it only
 * offers the reset repair. It always reports as a pass (there is nothing to
 * "fail") but exposes a repair action for direct invocation via
 * `podkit doctor --repair artwork-reset`.
 */

import { resetArtworkDatabase } from '../../artwork/repair.js';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

export const artworkResetCheck: DiagnosticCheck = {
  id: 'artwork-reset',
  name: 'Artwork Reset',
  applicableTo: ['ipod'],
  repairOnly: true,

  async check(_ctx: DiagnosticContext): Promise<CheckResult> {
    // This is a repair-only check — no detection logic
    return {
      status: 'skip',
      summary: 'Artwork reset is a repair-only action (run with --repair artwork-reset)',
      repairable: false,
    };
  },

  repair: {
    description: 'Clear all artwork from the iPod without requiring a source collection',
    requirements: [],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      const result = await resetArtworkDatabase(ctx.db!, ctx.mountPoint, {
        dryRun: options?.dryRun,
      });

      const summary = options?.dryRun
        ? `Dry run: ${result.tracksCleared} / ${result.totalTracks} tracks have artwork that would be cleared`
        : `Cleared artwork from ${result.tracksCleared} / ${result.totalTracks} tracks (${result.orphanedFilesRemoved} orphaned .ithmb files removed)`;

      return {
        success: true,
        summary,
        details: {
          tracksCleared: result.tracksCleared,
          totalTracks: result.totalTracks,
          orphanedFilesRemoved: result.orphanedFilesRemoved,
        },
      };
    },
  },
};
