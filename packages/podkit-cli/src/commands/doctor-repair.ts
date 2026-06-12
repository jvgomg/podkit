/**
 * Shared repair-execution pipeline for `podkit doctor --repair`.
 *
 * All three repair-runner shapes in `doctor.ts` (iPod via `runRepair`,
 * mass-storage via `runMassStorageRepair`, system-only via
 * `runSystemRepair`) share the same scaffold:
 *
 *  1. Print the "Repairing X: …" / "Dry run: X …" header.
 *  2. Install a SIGINT/SIGTERM shutdown controller and pipe a progress
 *     writer into `repair.run`.
 *  3. Call core's `runDiagnosticRepair`, which performs the
 *     cascade-unsupported pre-flight refusal for iPod-scope repairs and
 *     returns a typed `RepairExecutionResult`.
 *  4. Map the typed result back to CLI surface: refusal → CliError
 *     (INCOMPATIBLE_DEVICE_TYPE); failed → CliError (REPAIR_FAILED);
 *     ok → render `out.result(envelope, …)` with the success body.
 *
 * `runRepairPipeline` collapses that scaffold into one entry point.
 * Callers supply only the structurally varying bits — the RepairContext
 * factory and (optionally) whether to skip the shutdown controller for
 * lightweight system repairs that don't need cancellation.
 */

import type {
  DiagnosticCheck,
  DiagnosticDeviceType,
  RepairContext,
  RepairExecutionResult,
  RunDiagnosticRepairDeps,
} from '@podkit/core';
import { runDiagnosticRepair, assessRepairRefusal, DOCS_URLS } from '@podkit/core';
import type { OutputContext } from '../output/index.js';
import { CliError } from '../errors.js';
import { createShutdownController } from '../shutdown.js';

/**
 * Error codes the repair pipeline emits. Subset of `DoctorErrorCodes` —
 * surfaced here so the pipeline isn't coupled to the doctor command's
 * full error-code union.
 */
export const REPAIR_PIPELINE_ERROR_CODES = {
  INCOMPATIBLE_DEVICE_TYPE: 'INCOMPATIBLE_DEVICE_TYPE',
  REPAIR_FAILED: 'REPAIR_FAILED',
} as const;

/**
 * JSON envelope shape emitted on a successful repair. Defined here so
 * the pipeline can compose the `out.result<RepairOutput>(...)` call
 * without importing back from the doctor command file.
 */
export interface RepairOutput {
  success: true;
  summary: string;
  checkId: string;
  dryRun: boolean;
  details?: Record<string, unknown>;
}

/**
 * Refuse a mutating repair on a cascade-unsupported iPod BEFORE the
 * caller opens any device-side handle. Wraps core's `assessRepairRefusal`
 * with the CLI's `CliError(INCOMPATIBLE_DEVICE_TYPE)` shape.
 *
 * The CLI's iPod `--repair` path opens the iTunesDB when the repair
 * declares `'database'` in its requirements. Opening libgpod against
 * SQLite-based unsupported generations (hashAB nano 6/7, shuffle 3/4,
 * iOS) risks corrupting on-device state — so the refusal must happen
 * BEFORE the open call. The pipeline's `runDiagnosticRepair` would catch
 * the same refusal AFTER `IpodDatabase.open`, which is too late.
 *
 * Returns silently on non-iPod ctx, empty mountPoint, or supported
 * devices. Throws `CliError(INCOMPATIBLE_DEVICE_TYPE)` otherwise.
 */
export async function preflightCascadeRefusal(
  check: DiagnosticCheck,
  ctx: { deviceType: DiagnosticDeviceType; mountPoint: string },
  deps?: { assessIpodIdentity?: RunDiagnosticRepairDeps['assessIpodIdentity'] }
): Promise<void> {
  const reason = await assessRepairRefusal(ctx, deps ?? {});
  if (!reason) return;
  throw new CliError({
    message: reason.headline,
    code: REPAIR_PIPELINE_ERROR_CODES.INCOMPATIBLE_DEVICE_TYPE,
    details: { checkId: check.id, unsupported: reason },
    printText: (o) => {
      o.error(reason.headline);
      if (reason.details) {
        for (const line of reason.details) o.print(`  ${line}`);
      }
      o.print(`See: ${reason.docsUrl ?? DOCS_URLS.supportedDevices}`);
    },
  });
}

/**
 * Build the progress-emitter wired into `repair.run`. The default
 * formatter renders `current / total (NN%)` plus the iPod-specific
 * matched/no-source/no-artwork counters when present. Mass-storage
 * repairs use a stripped variant with just current/total.
 *
 * Routes through `out.progress` so the line flows through the
 * OutputContext sink — captured by buffer-sink test harnesses, gated
 * by JSON / quiet modes, switched between `\r`-overwrite and history
 * mode based on `tty` (convention §2).
 */
function makeProgressHandler(out: OutputContext, opts: { extended: boolean }) {
  return (progress: Record<string, unknown>) => {
    if (typeof progress.current === 'number' && typeof progress.total === 'number') {
      const pct = Math.round((progress.current / progress.total) * 100);
      let line = `  ${progress.current} / ${progress.total}  (${pct}%)`;
      if (opts.extended) {
        if (typeof progress.matched === 'number') line += `  Matched: ${progress.matched}`;
        if (typeof progress.noSource === 'number') line += `  No source: ${progress.noSource}`;
        if (typeof progress.noArtwork === 'number') line += `  No artwork: ${progress.noArtwork}`;
      }
      out.progress(line);
    } else if (typeof progress.message === 'string') {
      out.progress(`  ${progress.message}`);
    }
  };
}

export interface RunRepairPipelineArgs {
  check: DiagnosticCheck;
  ctx: RepairContext;
  dryRun: boolean;
  verbose: number;
  out: OutputContext;
  /** Skip the shutdown controller + progress writer. Used by system-only repairs that complete synchronously. */
  withoutShutdown?: boolean;
  /** Drop the iPod-specific Matched/NoSource/NoArtwork progress counters (mass-storage). */
  compactProgress?: boolean;
  /** Override the cascade-unsupported pre-flight assessor (tests). */
  deps?: RunDiagnosticRepairDeps;
  /**
   * Optional success-line override. iPod + mass-storage print
   * "Repair complete. Run `podkit doctor` to verify."; system repairs
   * print "Repair complete." (no verify-on-device hint).
   */
  successLine?: string;
}

/**
 * Single repair-execution scaffold. Returns nothing — emits via
 * `out.result()` on success and throws `CliError` on refusal or
 * failure.
 */
export async function runRepairPipeline(args: RunRepairPipelineArgs): Promise<void> {
  const { check, ctx, dryRun, verbose, out } = args;
  const repair = check.repair;
  if (!repair) {
    throw new CliError({
      message: `Check "${check.id}" has no repair defined`,
      code: REPAIR_PIPELINE_ERROR_CODES.REPAIR_FAILED,
    });
  }

  // Header — matches the historical wording byte-for-byte.
  out.print(
    dryRun ? `Dry run: ${repair.description}...` : `Repairing ${check.id}: ${repair.description}...`
  );
  out.newline();

  const shutdown = args.withoutShutdown ? null : createShutdownController();
  shutdown?.install();

  let result: RepairExecutionResult;
  try {
    result = await runDiagnosticRepair(
      check,
      ctx,
      {
        dryRun,
        verbose,
        ...(shutdown ? { signal: shutdown.signal } : {}),
        ...(args.withoutShutdown
          ? {}
          : { onProgress: makeProgressHandler(out, { extended: !args.compactProgress }) }),
      },
      args.deps ?? {}
    );
  } catch (err) {
    out.clearProgress();
    if (err instanceof CliError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError({
      message: `Repair failed: ${message}`,
      code: REPAIR_PIPELINE_ERROR_CODES.REPAIR_FAILED,
      details: { checkId: check.id },
    });
  } finally {
    shutdown?.uninstall();
  }

  out.clearProgress();

  if (result.status === 'refused') {
    throw new CliError({
      message: result.reason.headline,
      code: REPAIR_PIPELINE_ERROR_CODES.INCOMPATIBLE_DEVICE_TYPE,
      details: { checkId: check.id, unsupported: result.reason },
      printText: (o) => {
        o.error(result.reason.headline);
        if (result.reason.details) {
          for (const line of result.reason.details) o.print(`  ${line}`);
        }
        o.print(`See: ${result.reason.docsUrl ?? DOCS_URLS.supportedDevices}`);
      },
    });
  }

  if (result.status === 'failed') {
    throw new CliError({
      message: result.summary,
      code: REPAIR_PIPELINE_ERROR_CODES.REPAIR_FAILED,
      details: { checkId: check.id, dryRun, ...result.details },
    });
  }

  const output: RepairOutput = {
    success: true,
    summary: result.summary,
    checkId: check.id,
    dryRun,
    ...(result.details !== undefined ? { details: result.details } : {}),
  };

  out.result<RepairOutput>(output, () => {
    out.print(result.summary);
    if (!dryRun) {
      out.newline();
      out.success(args.successLine ?? 'Repair complete. Run `podkit doctor` to verify.');
    }
  });
}
