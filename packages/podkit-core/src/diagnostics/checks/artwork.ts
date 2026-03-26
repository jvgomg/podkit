/**
 * Artwork integrity diagnostic check
 *
 * Parses the iPod's ArtworkDB binary file and verifies that all thumbnail
 * references point to valid data within the .ithmb files. Detects the
 * corruption pattern where the ArtworkDB references offsets beyond the
 * ithmb file boundaries.
 *
 * When corruption is detected, the repair delegates to rebuildArtworkDatabase
 * — the reusable primitive that resets and re-extracts artwork from sources.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArtworkDB } from '../../artwork/artworkdb-parser.js';
import { checkIntegrity } from '../../artwork/integrity.js';
import { rebuildArtworkDatabase } from '../../artwork/repair.js';
import type {
  DiagnosticCheck,
  CheckResult,
  DiagnosticContext,
  RepairContext,
  RepairRunOptions,
  RepairResult,
} from '../types.js';

const DOCS_URL = 'https://jvgomg.github.io/podkit/troubleshooting/artwork-repair';

export const artworkRebuildCheck: DiagnosticCheck = {
  id: 'artwork-rebuild',
  name: 'Artwork Integrity',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    if (!ctx.db) {
      return { status: 'skip', summary: 'No iPod database', repairable: false };
    }

    const artworkDbPath = join(ctx.mountPoint, 'iPod_Control', 'Artwork', 'ArtworkDB');

    // Skip if no ArtworkDB exists (iPod has no artwork)
    if (!existsSync(artworkDbPath)) {
      return {
        status: 'skip',
        summary: 'No ArtworkDB found (iPod has no artwork)',
        repairable: false,
      };
    }

    let buffer: Buffer;
    try {
      buffer = readFileSync(artworkDbPath);
    } catch (error) {
      return {
        status: 'warn',
        summary: `Could not read ArtworkDB: ${error instanceof Error ? error.message : String(error)}`,
        repairable: false,
      };
    }

    if (buffer.length === 0) {
      return {
        status: 'skip',
        summary: 'ArtworkDB is empty',
        repairable: false,
      };
    }

    let db;
    try {
      db = parseArtworkDB(buffer);
    } catch (error) {
      return {
        status: 'warn',
        summary: `Could not parse ArtworkDB: ${error instanceof Error ? error.message : String(error)}`,
        repairable: false,
      };
    }

    if (db.images.length === 0) {
      return {
        status: 'pass',
        summary: 'ArtworkDB is empty (no artwork entries)',
        repairable: false,
      };
    }

    const report = checkIntegrity(db, ctx.mountPoint);
    const { outOfBoundsCount, totalMHNI, totalMHII, formats } = report.summary;

    if (outOfBoundsCount === 0) {
      const formatDesc = formats.map((f) => f.formatId).join(', ');
      return {
        status: 'pass',
        summary: `${totalMHII.toLocaleString()} entries, ${formats.length} format${formats.length === 1 ? '' : 's'} (${formatDesc}), all offsets valid`,
        repairable: false,
        details: {
          totalEntries: totalMHNI,
          formats: formats.map((f) => ({
            id: f.formatId,
            slotSize: f.slotSize,
            fileSize: f.fileSize,
            entries: f.totalEntries,
          })),
        },
      };
    }

    // Corruption detected — count against MHNI (thumbnail entries), not MHII (images)
    const pct = Math.round((outOfBoundsCount / totalMHNI) * 100);
    const healthyCount = totalMHNI - outOfBoundsCount;

    return {
      status: 'fail',
      summary: 'CORRUPTION DETECTED',
      repairable: true,
      details: {
        totalEntries: totalMHNI,
        corruptEntries: outOfBoundsCount,
        healthyEntries: healthyCount,
        corruptPercent: pct,
        formats: formats.map((f) => ({
          id: f.formatId,
          slotSize: f.slotSize,
          fileSize: f.fileSize,
          totalEntries: f.totalEntries,
          outOfBoundsEntries: f.outOfBoundsEntries,
        })),
      },
      docsUrl: DOCS_URL,
    };
  },

  repair: {
    description: 'Rebuild artwork database from source collection',
    requirements: ['source-collection'],

    async run(ctx: RepairContext, options?: RepairRunOptions): Promise<RepairResult> {
      const result = await rebuildArtworkDatabase(
        { db: ctx.db!, adapters: ctx.adapters },
        {
          dryRun: options?.dryRun,
          onProgress: options?.onProgress
            ? (p) => options.onProgress!(p as unknown as Record<string, unknown>)
            : undefined,
          signal: options?.signal,
        }
      );

      const summary = options?.dryRun
        ? `Dry run: ${result.matched} tracks would be repaired, ${result.noSource} no source, ${result.noArtwork} no artwork`
        : `Rebuilt artwork for ${result.matched} tracks (${result.noSource} no source, ${result.noArtwork} no artwork, ${result.errors} errors)`;

      return {
        success: result.errors === 0,
        summary,
        details: {
          totalTracks: result.totalTracks,
          matched: result.matched,
          noSource: result.noSource,
          noArtwork: result.noArtwork,
          errors: result.errors,
          errorDetails: result.errorDetails.length > 0 ? result.errorDetails : undefined,
        },
      };
    },
  },
};
