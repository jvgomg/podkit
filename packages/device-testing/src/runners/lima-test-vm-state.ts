/**
 * lima-test-vm-state — boot-once / apply-once / snapshot orchestration for
 * the Tier 3 `podkit-test-vm`.
 *
 * Glue layer between three pieces of the snapshot-based state-layering
 * system (ADR-016 §"Snapshot-based state layering"):
 *
 *   1. The named QEMU snapshots managed by `lima-test-vm-snapshots.ts`.
 *   2. The in-VM `tools/device-testing/scripts/apply-state.sh` mutator.
 *   3. The `SystemStateId` registry in `system-states/`.
 *
 * Algorithm (`applyState(opts)`):
 *
 *   1. If a snapshot tagged `base-<stateId>` already exists → restore it
 *      and return (the fast path, expected to be <1s).
 *   2. Otherwise: bring the VM to a known starting point. If a snapshot
 *      tagged `base-healthy` exists, restore it; if not, this must be the
 *      very first run on a freshly provisioned VM and we apply directly to
 *      the live state.
 *   3. Copy `apply-state.sh` into the VM under `/tmp/`.
 *   4. Run `sudo /tmp/apply-state.sh <stateId>` via `limactl shell`.
 *   5. Capture a fresh snapshot as `base-<stateId>` so the next run hits
 *      the fast path.
 *
 * The `lima-test-vm` runner (TASK-322.04) calls this once per
 * `SystemState` test group.
 *
 * @see adr/adr-016-linux-vm-test-harness.md §"Snapshot-based state layering"
 * @see tools/device-testing/scripts/apply-state.sh
 * @module
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { SystemStateId } from '../system-states/types.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl } from './lima-limactl.js';
import { createSnapshot, restoreSnapshot, snapshotExists } from './lima-test-vm-snapshots.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link applyState}. */
export interface ApplyStateOpts {
  /** Lima instance name (e.g. `podkit-test-vm`). */
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
   * `tools/device-testing/scripts/apply-state.sh` relative to this module's
   * package layout. Tests use the override to point at a fixture or a
   * synthetic file.
   */
  applyStateScript?: string;
}

/** Outcome of an {@link applyState} call. */
export interface ApplyStateResult {
  /** Final snapshot name in the VM (always `base-<stateId>`). */
  snapshotName: string;
  /**
   * `true` when a new snapshot was created during this call (slow path);
   * `false` when the snapshot already existed and was simply restored
   * (fast path).
   */
  created: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bring `vmName` to the system state identified by `stateId`, using a
 * snapshot when possible and applying mutations when not.
 *
 * On the fast path (snapshot already exists), this is a single
 * `limactl snapshot apply` call.
 *
 * On the slow path (first run for this state), this copies + executes
 * `apply-state.sh` and captures a new snapshot for future runs.
 *
 * Errors from any sub-step propagate with descriptive messages that include
 * the underlying `limactl` stderr.
 */
export async function applyState(opts: ApplyStateOpts): Promise<ApplyStateResult> {
  const { vmName, stateId } = opts;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  if (!vmName) {
    throw new Error('applyState: vmName is required.');
  }
  if (!stateId) {
    throw new Error('applyState: stateId is required.');
  }

  const snapshotName = `base-${stateId}`;

  // ── Fast path: snapshot already exists, restore and exit ───────────────────
  if (await snapshotExists({ vmName, snapshotName, subprocess })) {
    await restoreSnapshot({ vmName, snapshotName, subprocess });
    return { snapshotName, created: false };
  }

  // ── Slow path: bring VM to a known starting point ──────────────────────────
  // If `base-healthy` exists, restoring it is a much cheaper starting point
  // than "wherever the VM happens to be right now". Skip when the target IS
  // `base-healthy` — that would loop on first creation.
  if (stateId !== 'healthy') {
    const healthyExists = await snapshotExists({
      vmName,
      snapshotName: 'base-healthy',
      subprocess,
    });
    if (healthyExists) {
      await restoreSnapshot({
        vmName,
        snapshotName: 'base-healthy',
        subprocess,
      });
    }
  }

  // ── Stage apply-state.sh inside the VM ─────────────────────────────────────
  const scriptHostPath = opts.applyStateScript ?? defaultApplyStateScriptPath();
  const scriptVmPath = '/tmp/apply-state.sh';

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

  // ── Capture the resulting state as a snapshot ──────────────────────────────
  await createSnapshot({ vmName, snapshotName, subprocess });

  return { snapshotName, created: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the default host path to `apply-state.sh`.
 *
 * The package ships its source in `packages/device-testing/src/runners/` and
 * the script lives at `tools/device-testing/scripts/apply-state.sh` in the
 * repository root — four directory levels up from this module's source
 * file (runners → src/dist → device-testing → packages → repo root).
 *
 * After bundling (`bun build`), the module's `import.meta.url` resolves into
 * `packages/device-testing/dist/`. The repo-relative path remains the same
 * number of levels up because `dist/` is a sibling of `src/`, so this
 * resolution works for both source and built layouts.
 */
function defaultApplyStateScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(thisFile);
  // moduleDir is .../packages/device-testing/{src,dist}/runners/
  // repo root is four levels up.
  return path.resolve(
    moduleDir,
    '..',
    '..',
    '..',
    '..',
    'tools',
    'device-testing',
    'scripts',
    'apply-state.sh'
  );
}
