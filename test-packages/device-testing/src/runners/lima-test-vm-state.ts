/**
 * Stage and run apply-state.sh inside the substrate.
 *
 * Single-path implementation: copy `apply-state.sh` in, make it executable,
 * and run it with `sudo`. There is no snapshot fast-path — the
 * `vz` driver used by Lima 2.x on Apple Silicon never implemented snapshots,
 * and the apply-state.sh-every-time path is ~800ms per state, which is
 * negligible across the current 6-state matrix.
 *
 * Historical note: this module previously contained a snapshot-based
 * fast/slow path (QEMU-only; deleted May 2026). See ADR-016
 * §"Snapshot-based state layering (historical)" for the full rationale.
 *
 * @see docs/adr/adr-016-linux-vm-test-harness.md
 * @see test-packages/device-testing/scripts/apply-state.sh
 * @module
 */

import * as path from 'node:path';

import { guestCommandError, type SubstrateLink } from '@podkit/substrate';

import type { SystemStateId } from '../system-states/types.js';
import { deviceSubstrateLink } from './substrate.js';
import { devTestingPackageRoot } from './paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link applyState}. */
export interface ApplyStateOpts {
  /**
   * Link to the substrate to bring to `stateId`. Defaults to the selected
   * device substrate; tests inject a link over a scripted runner.
   */
  link?: SubstrateLink;
  /** SystemState id to apply (one of the 6 registered states). */
  stateId: SystemStateId;
  /**
   * Override the host path to `apply-state.sh`. Default resolves to
   * `test-packages/device-testing/scripts/apply-state.sh` relative to this
   * module's package layout. Tests use the override to point at a fixture or a
   * synthetic file.
   */
  applyStateScript?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bring the substrate to the system state identified by `stateId` by staging
 * and running `apply-state.sh` inside it.
 *
 * Steps:
 *   1. copy `<hostPath>` → `/tmp/apply-state.sh`
 *   2. `sudo chmod 0755 /tmp/apply-state.sh`
 *   3. `sudo /tmp/apply-state.sh <stateId>`
 *
 * A guest step that fails propagates with a descriptive message including the
 * guest's own stderr; a substrate that could not be reached throws
 * `SubstrateLinkError` instead.
 */
/**
 * Bound for one `apply-state.sh` run.
 *
 * The script mutates the substrate to match a `SystemState` — moving binaries aside,
 * changing permissions, remounting. It is a per-group cost measured in
 * seconds, so this is deliberately loose: it exists to catch a wedged transport
 * rather than to police the script's own runtime.
 */
export const APPLY_STATE_TIMEOUT_MS = 5 * 60_000;

/** Bound for the two small staging steps that precede the script run. */
const STAGE_TIMEOUT_MS = 60_000;

export async function applyState(opts: ApplyStateOpts): Promise<void> {
  const { stateId } = opts;
  const link = opts.link ?? deviceSubstrateLink();

  if (!stateId) {
    throw new Error('applyState: stateId is required.');
  }

  const scriptHostPath = opts.applyStateScript ?? defaultApplyStateScriptPath();
  const scriptVmPath = '/tmp/apply-state.sh';

  // ── Stage apply-state.sh inside the substrate ──────────────────────────────
  // Straight into /tmp rather than through `installIntoSubstrate`: this file's
  // destination IS the staging area, so there is nothing to promote.
  await link.copyIn(scriptHostPath, scriptVmPath, { timeoutMs: STAGE_TIMEOUT_MS });

  // ── Make script executable + invoke under sudo ─────────────────────────────
  const chmodResult = await link.exec(['sudo', 'chmod', '0755', scriptVmPath], {
    timeoutMs: STAGE_TIMEOUT_MS,
  });
  if (chmodResult.exitCode !== 0) {
    throw guestCommandError(`failed to chmod ${scriptVmPath} in ${link.description}`, chmodResult);
  }

  const applyResult = await link.exec(['sudo', scriptVmPath, stateId], {
    timeoutMs: APPLY_STATE_TIMEOUT_MS,
  });
  if (applyResult.exitCode !== 0) {
    throw guestCommandError(`apply-state.sh ${stateId} failed in ${link.description}`, applyResult);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the default host path to `apply-state.sh`.
 *
 * The package ships its source in `test-packages/device-testing/src/runners/`
 * and the script lives at `test-packages/device-testing/scripts/apply-state.sh`
 * — two directory levels up from this module's source/built file
 * (runners → src/dist → device-testing), then into `scripts/`.
 *
 * After bundling (`bun build`), the module's `import.meta.url` resolves into
 * `test-packages/device-testing/dist/runners/`. The path remains the same
 * number of levels up because `dist/` is a sibling of `src/`, so this
 * resolution works for both source and built layouts.
 */
function defaultApplyStateScriptPath(): string {
  return path.resolve(devTestingPackageRoot(), 'scripts', 'apply-state.sh');
}
