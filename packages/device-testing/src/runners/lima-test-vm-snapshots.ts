/**
 * lima-test-vm-snapshots — wrappers around `limactl snapshot {create,apply,
 * delete,list}` for the Tier 3 `podkit-test-vm`.
 *
 * Snapshots are the primary state-layering mechanism for Tier 3 tests
 * (see ADR-016 §"Snapshot-based state layering"). Each `SystemState` in
 * `@podkit/device-testing` has a corresponding QEMU disk snapshot named
 * `base-<state-id>`; restoring takes ~1s and is much cheaper than re-running
 * apt/chmod/modprobe per test.
 *
 * Why `limactl snapshot` and not direct `qemu-img`:
 *
 * - Lima 1.0+ ships native snapshot CLI subcommands (`create`, `apply`,
 *   `delete`, `list`) that abstract the underlying disk path and instance
 *   pause/resume semantics. Calling `qemu-img` directly would require us to
 *   know where Lima stores the VM's disk image and to handle the live-vs-
 *   stopped distinction ourselves.
 * - Lima's `apply` (restore) handles the pause/resume dance internally for
 *   running VMs. For stopped VMs it operates on the disk image in place.
 *   Either way, the caller need not coordinate VM lifecycle.
 *
 * All operations go through `SubprocessRunner` so tests can replay them
 * without touching a real VM.
 *
 * @see adr/adr-016-linux-vm-test-harness.md §"Snapshot-based state layering"
 * @see tools/device-testing/lima/test-vm.yaml
 * @module
 */

import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl, type LimactlResult } from './lima-limactl.js';

// ---------------------------------------------------------------------------
// Snapshot-unsupported warning (once-per-process, mirrors skipWarningEmitted
// in tier3-runtime-setup.ts)
// ---------------------------------------------------------------------------

let snapshotUnsupportedWarningEmitted = false;

/** Reset the once-per-session snapshot-unsupported warning. Tests only — never call from production. */
export function resetSnapshotUnsupportedWarning(): void {
  snapshotUnsupportedWarningEmitted = false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options shared by all snapshot operations. */
export interface SnapshotOpts {
  /** Lima instance name (e.g. `podkit-test-vm`). */
  vmName: string;
  /** Snapshot tag (e.g. `base-healthy`). */
  snapshotName: string;
  /**
   * Subprocess runner for `limactl` invocations. Production callers should
   * leave this unset — tests inject a scripted runner.
   */
  subprocess?: SubprocessRunner;
  /**
   * Warning emitter DI seam. Used by tests to capture the snapshot-unsupported
   * warning without touching stderr. Defaults to `console.warn`.
   */
  warn?: (msg: string) => void;
}

/** Options for `listSnapshots`. */
export interface ListSnapshotsOpts {
  vmName: string;
  subprocess?: SubprocessRunner;
  /** Warning emitter DI seam — see {@link SnapshotOpts.warn}. */
  warn?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a named snapshot of `vmName`.
 *
 * Invokes `limactl snapshot create <vmName> --tag <snapshotName>`. Throws a
 * descriptive `Error` (including `limactl` stderr) on any non-zero exit,
 * EXCEPT when the underlying driver does not support snapshots (Lima 2.x's
 * `vz` driver reports "unimplemented") — that case is a silent no-op so
 * `applyState` can degrade to apply-state.sh-every-time.
 *
 * If a snapshot with the same name already exists, `limactl snapshot create`
 * fails — callers that want overwrite semantics should delete first or guard
 * with {@link snapshotExists}.
 */
export async function createSnapshot(opts: SnapshotOpts): Promise<void> {
  const { vmName, snapshotName } = opts;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  validate(vmName, snapshotName, 'createSnapshot');

  const result = await runLimactl(subprocess, [
    'snapshot',
    'create',
    vmName,
    '--tag',
    snapshotName,
  ]);
  if (result.exitCode !== 0) {
    if (isSnapshotUnsupported(result, opts.warn)) return;
    throw limactlError(`failed to create snapshot '${snapshotName}' on ${vmName}`, result);
  }
}

/**
 * Apply (restore) a named snapshot to `vmName`.
 *
 * Invokes `limactl snapshot apply <vmName> --tag <snapshotName>`. Throws if
 * the snapshot does not exist or `limactl` returns non-zero.
 *
 * Lima's `apply` handles the running-vs-stopped VM distinction internally:
 * on a running VM it pauses, swaps the disk state, and resumes; on a stopped
 * VM it edits the disk image in place. From the caller's perspective the
 * operation is atomic. As of Lima 1.0+ this typically completes in under a
 * second on small VMs.
 */
export async function restoreSnapshot(opts: SnapshotOpts): Promise<void> {
  const { vmName, snapshotName } = opts;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  validate(vmName, snapshotName, 'restoreSnapshot');

  const result = await runLimactl(subprocess, ['snapshot', 'apply', vmName, '--tag', snapshotName]);
  if (result.exitCode !== 0) {
    // Silently degrade when the driver doesn't support snapshots (e.g.
    // Lima 2.x `vz` on Apple Silicon). Callers will have observed
    // `snapshotExists() === false` first and gone through the slow path,
    // so reaching this case here would imply a stale check; treat as a
    // no-op rather than fail the run.
    if (isSnapshotUnsupported(result, opts.warn)) return;
    throw limactlError(`failed to restore snapshot '${snapshotName}' on ${vmName}`, result);
  }
}

/**
 * Delete a named snapshot from `vmName`.
 *
 * Invokes `limactl snapshot delete <vmName> --tag <snapshotName>`. Throws on
 * non-zero `limactl` exit. Useful for reprovisioning when a snapshot becomes
 * stale (e.g. after a Debian point-release bump).
 */
export async function deleteSnapshot(opts: SnapshotOpts): Promise<void> {
  const { vmName, snapshotName } = opts;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  validate(vmName, snapshotName, 'deleteSnapshot');

  const result = await runLimactl(subprocess, [
    'snapshot',
    'delete',
    vmName,
    '--tag',
    snapshotName,
  ]);
  if (result.exitCode !== 0) {
    throw limactlError(`failed to delete snapshot '${snapshotName}' on ${vmName}`, result);
  }
}

/**
 * Return `true` when a snapshot tagged `snapshotName` exists on `vmName`.
 *
 * Uses `limactl snapshot list <vmName> --quiet`, which prints one tag per
 * line. Returns `false` for missing instances *or* missing tags — the
 * orchestrator does not need to distinguish: in both cases the next step is
 * "fall back to apply-state.sh and create the snapshot".
 *
 * If `limactl snapshot list` returns non-zero for a reason OTHER than the
 * instance being missing, the error propagates so a transient `limactl`
 * failure is not silently treated as "no snapshot".
 */
export async function snapshotExists(opts: SnapshotOpts): Promise<boolean> {
  const tags = await listSnapshotsSafe({
    vmName: opts.vmName,
    subprocess: opts.subprocess,
    warn: opts.warn,
  });
  if (tags === null) return false;
  return tags.includes(opts.snapshotName);
}

/**
 * List all snapshot tags for `vmName`.
 *
 * Returns the tag names exactly as `limactl snapshot list --quiet` prints
 * them. Empty array when the instance has no snapshots. Throws on `limactl`
 * failure (use {@link snapshotExists} when "instance missing" should map to
 * "no snapshot").
 */
export async function listSnapshots(opts: ListSnapshotsOpts): Promise<string[]> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) {
    throw new Error('listSnapshots: vmName is required.');
  }

  const result = await runLimactl(subprocess, ['snapshot', 'list', opts.vmName, '--quiet']);
  if (result.exitCode !== 0) {
    throw limactlError(`failed to list snapshots on ${opts.vmName}`, result);
  }
  return parseSnapshotList(result.stdout);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Variant of {@link listSnapshots} used internally by {@link snapshotExists}.
 * Returns `null` when the instance itself is missing (so the caller can map
 * to "no snapshot" without erroring); rethrows other limactl failures.
 */
async function listSnapshotsSafe(opts: ListSnapshotsOpts): Promise<string[] | null> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) {
    throw new Error('snapshotExists: vmName is required.');
  }

  const result = await runLimactl(subprocess, ['snapshot', 'list', opts.vmName, '--quiet']);
  if (result.exitCode !== 0) {
    if (isInstanceMissing(result)) return null;
    if (isSnapshotUnsupported(result, opts.warn)) return null;
    throw limactlError(`failed to list snapshots on ${opts.vmName}`, result);
  }
  return parseSnapshotList(result.stdout);
}

/**
 * Detect Lima's "snapshot is unimplemented for this driver" failure.
 *
 * Lima 2.x's `vz` driver (Apple Virtualization framework, default on Apple
 * Silicon) does not implement snapshots. `limactl snapshot list` exits 1
 * with stderr `level=fatal msg=unimplemented` (plus an `is experimental`
 * warning). Detecting this lets the orchestrator degrade to
 * apply-state.sh-every-time rather than fail every Tier-3 test. See
 * TASK-322.02 implementation notes for the architecture-level discussion.
 *
 * Emits a single stderr warning the first time this returns true in the
 * process lifetime. Subsequent calls are silent. `warn` is a DI seam for
 * tests; production callers leave it unset (defaults to console.warn).
 */
function isSnapshotUnsupported(
  result: LimactlResult,
  warn: (msg: string) => void = (msg) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
): boolean {
  const haystack = `${result.stderr}\n${result.stdout}`.toLowerCase();
  const unsupported =
    haystack.includes('unimplemented') ||
    haystack.includes('not supported') ||
    haystack.includes('not implemented');
  if (unsupported && !snapshotUnsupportedWarningEmitted) {
    snapshotUnsupportedWarningEmitted = true;
    warn(
      '[lima-test-vm] snapshot driver unimplemented (vz); using apply-state.sh fallback — see TASK-322.02.01'
    );
  }
  return unsupported;
}

function isInstanceMissing(result: LimactlResult): boolean {
  // Heuristic match against Lima 1.x's "instance ... not found" / "does not
  // exist" error wording (verified against `limactl snapshot list <unknown>`
  // on Lima 1.x). The substring check is intentionally narrow — a `qemu-img`
  // I/O error that happens to include the word "instance" plus "not found"
  // could be misclassified as missing. Re-verify on Lima version bumps; if
  // the wording shifts, prefer parsing a structured exit code over greping.
  const haystack = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return (
    haystack.includes('instance') &&
    (haystack.includes('not found') ||
      haystack.includes("doesn't exist") ||
      haystack.includes('does not exist'))
  );
}

function parseSnapshotList(stdout: string): string[] {
  // `--quiet` prints one tag per line, no header. Blank lines are filtered
  // so a trailing newline does not produce an empty-string entry.
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function validate(vmName: string, snapshotName: string, fn: string): void {
  if (!vmName) {
    throw new Error(`${fn}: vmName is required.`);
  }
  if (!snapshotName) {
    throw new Error(`${fn}: snapshotName is required.`);
  }
}
