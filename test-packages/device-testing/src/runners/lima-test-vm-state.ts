/**
 * lima-test-vm-state — stage and run apply-state.sh in the VM.
 *
 * Single-path implementation: copy `apply-state.sh` into the VM, make it
 * executable, and run it with `sudo`. There is no snapshot fast-path — the
 * `vz` driver used by Lima 2.x on Apple Silicon never implemented snapshots,
 * and the apply-state.sh-every-time path is ~800ms per state, which is
 * negligible across the current 6-state matrix.
 *
 * Historical note: this module previously contained a snapshot-based
 * fast/slow path (QEMU-only; deleted May 2026). See ADR-016
 * §"Snapshot-based state layering (historical)" for the full rationale.
 *
 * @see adr/adr-016-linux-vm-test-harness.md
 * @see test-packages/device-testing/scripts/apply-state.sh
 * @module
 */

import * as path from 'node:path';
import type { SystemStateId } from '../system-states/types.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl } from './lima-limactl.js';
import { devTestingPackageRoot } from './paths.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link applyState}. */
export interface ApplyStateOpts {
  /** Lima instance name (e.g. `podkit-device`). */
  vmName: string;
  /** SystemState id to apply (one of the 6 registered states). */
  stateId: SystemStateId;
  /**
   * Subprocess runner for `limactl` invocations. Production callers should
   * leave this unset — tests inject a scripted runner.
   */
  subprocess?: SubprocessRunner;
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
 * Bring `vmName` to the system state identified by `stateId` by staging and
 * running `apply-state.sh` inside the VM.
 *
 * Steps:
 *   1. `limactl copy <hostPath> <vmName>:/tmp/apply-state.sh`
 *   2. `limactl shell <vmName> -- sudo chmod 0755 /tmp/apply-state.sh`
 *   3. `limactl shell <vmName> -- sudo /tmp/apply-state.sh <stateId>`
 *
 * Errors from any sub-step propagate with descriptive messages that include
 * the underlying `limactl` stderr.
 */
export async function applyState(opts: ApplyStateOpts): Promise<void> {
  const { vmName, stateId } = opts;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  if (!vmName) {
    throw new Error('applyState: vmName is required.');
  }
  if (!stateId) {
    throw new Error('applyState: stateId is required.');
  }

  const scriptHostPath = opts.applyStateScript ?? defaultApplyStateScriptPath();
  const scriptVmPath = '/tmp/apply-state.sh';

  // ── Stage apply-state.sh inside the VM ─────────────────────────────────────
  const copyResult = await runLimactl(subprocess, [
    'copy',
    scriptHostPath,
    `${vmName}:${scriptVmPath}`,
  ]);
  if (copyResult.exitCode !== 0) {
    throw limactlError(`failed to copy apply-state.sh to ${vmName}:${scriptVmPath}`, copyResult);
  }

  // ── Make script executable + invoke under sudo ─────────────────────────────
  const chmodResult = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    'chmod',
    '0755',
    scriptVmPath,
  ]);
  if (chmodResult.exitCode !== 0) {
    throw limactlError(`failed to chmod ${scriptVmPath} in ${vmName}`, chmodResult);
  }

  const applyResult = await runLimactl(subprocess, [
    'shell',
    vmName,
    '--',
    'sudo',
    scriptVmPath,
    stateId,
  ]);
  if (applyResult.exitCode !== 0) {
    throw limactlError(`apply-state.sh ${stateId} failed in ${vmName}`, applyResult);
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
